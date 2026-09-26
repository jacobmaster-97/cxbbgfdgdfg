/* Real static app + real local PostgreSQL RPCs; only Supabase Auth/HTTP is mocked. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { fixture } = require("./cloud-db-fixture.cjs");
const fs = require("node:fs"), path = require("node:path"), http = require("node:http"), assert = require("node:assert/strict");
const M = require("../dist/cloud-model.js");
const project = "kcsnbhhwgmcenvnkqzum", base = `https://${project}.supabase.co`;
const root = path.resolve(__dirname, "../dist");
const sessionKey = `teacher-cloud-session:${project}`;
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };
const server = http.createServer((req, res) => {
  const target = path.resolve(root, "." + new URL(req.url, "http://local").pathname);
  if (!target.startsWith(root + "/") || !fs.existsSync(target) || !fs.statSync(target).isFile()) { res.writeHead(404); res.end(); return; }
  res.setHeader("Content-Type", mime[path.extname(target)] || "application/octet-stream"); res.end(fs.readFileSync(target));
});
async function synced(page) {
  await page.waitForFunction(() => window.TeacherCloud.status().startsWith("已同步"));
}
async function sync(page) { await page.evaluate(() => TeacherCloud.sync()); }
async function status(page) { return page.evaluate(() => TeacherCloud.status()); }
async function modify(page, name) {
  await page.evaluate(name => {
    const key = "teacher-dashboard-class-management-v1", value = JSON.parse(TeacherStorage.getItem(key));
    value.classes[0].students[0].name = name; TeacherStorage.setItem(key, JSON.stringify(value));
  }, name);
}
async function login(page, email = "teacher@example.test") {
  await page.locator(".teacher-sync-trigger").click();
  await page.locator('[data-cloud-login] input[name="email"]').fill(email);
  await page.locator('[data-cloud-login] input[name="password"]').fill("test-password-only");
  await page.locator('[data-cloud-login] button[type="submit"]').click();
  await page.waitForFunction(() => TeacherCloud.status().includes("首次") || TeacherCloud.status().startsWith("已同步"));
}
async function choose(page, selection) {
  await page.evaluate(() => TeacherCloud.open());
  await page.locator(`[data-cloud-choice="${selection}"]`).click(); await synced(page);
  await page.locator('[data-cloud-action="close"]').click();
}
(async () => {
  const f = await fixture(); let browser, writes = 0, refreshes = 0, lose = false, block = null, offline = new Set();
  const errors = [], tokens = new Map();
  function session(owner) {
    const access = `mock-access-${owner}-${Math.random()}`, refresh = `mock-refresh-${owner}-${Math.random()}`;
    tokens.set(access, owner); tokens.set(refresh, owner);
    return { access_token: access, refresh_token: refresh, expires_in: 3600, user: { id: owner, email: owner === f.users[0] ? "teacher@example.test" : "other@example.test" } };
  }
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" });
    const desktop = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const tablet = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true });
    for (const context of [desktop, tablet]) {
      await context.route(`${base}/**`, async route => {
        if (offline.has(context)) { await route.abort("internetdisconnected"); return; }
        const request = route.request(), endpoint = new URL(request.url()).pathname, args = request.postDataJSON() || {};
        assert.equal(request.headers().apikey, "sb_publishable_xBTmo1ar128ffuBmrF95Qg_cakk86z4");
        if (endpoint === "/auth/v1/token") {
          if (request.url().includes("refresh_token")) {
            const owner = tokens.get(args.refresh_token); assert.ok(owner); refreshes++;
            await route.fulfill({ json: session(owner) });
          } else if (args.password !== "test-password-only") {
            await route.fulfill({ status: 400, json: { msg: "Invalid login credentials" } });
          } else await route.fulfill({ json: session(args.email === "teacher@example.test" ? f.users[0] : f.users[1]) });
          return;
        }
        if (endpoint === "/auth/v1/logout") { await route.fulfill({ status: 204 }); return; }
        const owner = tokens.get(request.headers().authorization?.replace("Bearer ", "")); assert.ok(owner);
        assert.ok(!JSON.stringify(args).includes("PRIVATE-DRAWING")); assert.ok(!JSON.stringify(args).includes("PRIVATE-PICTURE-LINK"));
        if (endpoint.endsWith("teacher_save_workspace") && block) {
          const barrier = block; barrier.count++; if (barrier.count === 2) { block = null; barrier.release(); } await barrier.promise;
        }
        try {
          const name = endpoint.split("/").pop();
          assert.ok(["teacher_read_workspace", "teacher_save_workspace"].includes(name));
          const result = await f.rpc(owner, name, args);
          if (name === "teacher_save_workspace" && result.kind === "saved") {
            writes++;
            if (lose) { lose = false; await route.abort("connectionreset"); return; }
          }
          await route.fulfill({ json: result });
        } catch (error) { await route.fulfill({ status: 400, json: { message: error.message } }); }
      });
    }
    const a = await desktop.newPage(), b = await tablet.newPage();
    for (const page of [a, b]) { page.on("pageerror", e => errors.push(e.message)); page.on("dialog", d => d.accept()); }
    await a.goto(url + "/class-management.html");
    await a.evaluate(() => {
      localStorage.setItem("teacher-dashboard-whiteboards-v1", '{"image":"PRIVATE-DRAWING"}');
      localStorage.setItem("teacher-dashboard-homework-papers-v1", '{"url":"PRIVATE-PICTURE-LINK"}');
    });
    assert.equal(await a.locator(".student-name").count(), 2);
    await login(a);
    await a.locator("details summary").click(); await a.locator('[data-cloud-action="legacy"]').click();
    await choose(a, "local");
    assert.equal((await f.rpc(f.users[0], "teacher_read_workspace")).workspace.snapshot[M.KEYS[0]].classes[0].students.length, 2);
    await b.goto(url + "/class-management.html"); await login(b); await choose(b, "remote");
    assert.equal(await b.locator(".student-name").first().textContent(), "陳樂欣");
    // Actual form save schedules an automatic upload.
    await a.locator('[data-action="edit-student"]').first().click();
    await a.locator('#editorForm input[name="name"]').fill("桌機新名");
    await a.locator('#editorForm button[type="submit"]').click(); await synced(a);
    await sync(b); await synced(b); assert.equal(await b.locator(".student-name").first().textContent(), "桌機新名");
    offline.add(tablet); await modify(b, "平板離線修改"); await sync(b); assert.match(await status(b), /無法連接/);
    await modify(a, "桌機另一修改"); await sync(a); await synced(a);
    offline.delete(tablet); await sync(b); assert.match(await status(b), /衝突/);
    await choose(b, "local"); await sync(a); await synced(a);
    const count = (await f.db.query("select count(*)::int n from public.teacher_workspace_versions")).rows[0].n;
    lose = true; await modify(a, "寫入回應遺失"); await sync(a); assert.equal(lose, false);
    await sync(a); await synced(a);
    assert.equal((await f.db.query("select count(*)::int n from public.teacher_workspace_versions")).rows[0].n, count + 1);
    await sync(b); await synced(b);
    let release; block = { count: 0, promise: new Promise(resolve => { release = resolve; }), release: () => release() };
    await modify(a, "同時桌機"); await modify(b, "同時平板"); await Promise.all([sync(a), sync(b)]);
    const loser = (await status(a)).includes("衝突") ? a : b, winner = loser === a ? b : a;
    assert.match(await status(loser), /衝突/); await choose(loser, "local"); await sync(winner); await synced(winner);
    // First-ever score snapshots on both devices can merge their distinct IDs.
    for (const [page, id] of [[a, "desktop-score"], [b, "tablet-score"]]) {
      await page.evaluate(id => TeacherStorage.setItem("teacher-dashboard-scores-v1", JSON.stringify({
        rules: [{ id: "positive-answer", name: "主動回答", kind: "positive", points: 1 }],
        entries: [{ id, studentId: "s-1", points: 1, reason: "測試", createdAt: new Date().toISOString() }], plants: {},
      })), id);
    }
    await sync(a); await synced(a); await sync(b); await synced(b); await sync(a); await synced(a);
    assert.equal((await f.rpc(f.users[0], "teacher_read_workspace")).workspace.snapshot[M.KEYS[3]].entries.length, 2);
    // Do not replace a student draft; canceling it releases deferred cloud data.
    await b.locator('[data-action="add-student"]').click(); await b.locator('#editorForm input[name="name"]').fill("未儲存");
    await modify(a, "雲端更新"); await sync(a); await synced(a); await sync(b);
    assert.match(await status(b), /完成並儲存/); assert.equal(await b.locator('#editorForm input[name="name"]').inputValue(), "未儲存");
    await b.locator('#editorDialog [data-action="close-dialog"]').first().click(); await sync(b); await synced(b);
    // Refresh token persistence, reload and another tab all retain the account.
    await a.evaluate(key => { const value = JSON.parse(localStorage.getItem(key)); value.expires_at = 1; localStorage.setItem(key, JSON.stringify(value)); }, sessionKey);
    await a.reload(); await synced(a); assert.ok(refreshes > 0);
    const otherTab = await desktop.newPage(); await otherTab.goto(url + "/timetable-view.html"); await synced(otherTab);
    await a.goto(url + "/index.html"); await synced(a);
    await a.locator('[data-app="加分"]').click();
    const score = a.locator(".score-frame").contentFrame();
    await score.locator('[data-student-id="s-1"]').click(); await score.locator('[data-rule-id="positive-answer"]').click();
    await synced(a);
    assert.equal((await f.rpc(f.users[0], "teacher_read_workspace")).workspace.snapshot[M.KEYS[3]].entries.length, 3);
    await a.locator("#closeDialog").click();
    await a.goto(url + "/timetable-prototype/index.html"); await synced(a);
    await a.locator('[data-tab="timetable"]').click(); await a.locator('.slot[data-section="morning"] [data-slot-field="subject"]').first().fill("中文");
    await a.locator('[data-action="save-timetable"]').click(); await synced(a);
    // Switching accounts does not publish the first teacher's roster.
    await a.locator(".teacher-sync-trigger").click(); await a.locator('[data-cloud-action="logout"]').click();
    await a.locator('[data-cloud-action="close"]').click();
    await a.goto(url + "/class-management.html"); await login(a, "other@example.test");
    assert.equal(await a.locator(".student-name").count(), 0);
    const beforeOther = writes;
    await sync(a); assert.equal(writes, beforeOther); assert.equal((await f.rpc(f.users[1], "teacher_read_workspace")).workspace, null);
    // Sign back into the original account: its cache and unsent data survive.
    await a.locator('[data-cloud-action="logout"]').click(); await a.locator('[data-cloud-action="close"]').click();
    await login(a); await synced(a); await a.locator('[data-cloud-action="close"]').click();
    assert.equal(await a.locator(".student-name").count(), 2);
    assert.equal(await a.evaluate(() => localStorage.getItem("teacher-dashboard-whiteboards-v1")), '{"image":"PRIVATE-DRAWING"}');
    assert.equal(await a.evaluate(() => localStorage.getItem("teacher-dashboard-homework-papers-v1")), '{"url":"PRIVATE-PICTURE-LINK"}');
    await a.locator(".teacher-sync-trigger").click();
    const backup = await a.evaluate(() => TeacherCloud.backup()); assert.equal(JSON.stringify(backup).includes("mock-access"), false);
    await a.locator("details summary").click();
    await a.locator('[data-cloud-import]').setInputFiles({ name: "備份.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup)) });
    await a.locator('[data-cloud-action="restore"]').click(); await a.locator('[data-cloud-action="close"]').click(); await sync(a); await synced(a);
    await a.locator(".teacher-sync-trigger").click(); await a.screenshot({ path: "/private/tmp/teacher-supabase-desktop.png" });
    await b.goto(url + "/index.html"); await sync(b); await synced(b); await b.locator(".teacher-sync-trigger").click();
    await b.screenshot({ path: "/private/tmp/teacher-supabase-tablet.png" });
    assert.deepEqual(errors, []);
    console.log("PASS: desktop/tablet login, real PostgreSQL RPCs, migration, automatic save, offline conflict, CAS, retry, drafts, refresh, tabs, embedded scores, timetable, account isolation, backups and local-only media.");
  } finally { if (browser) await browser.close(); server.close(); await f.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
