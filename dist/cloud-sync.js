(function () {
  "use strict";
  const C = window.TEACHER_CLOUD_CONFIG, M = window.TeacherCloudModel;
  if (!C || !M) return;
  // Embedded scores share the dashboard's session and one sync queue.
  try {
    if (window.parent !== window && window.parent.TeacherCloud) {
      window.TeacherCloud = window.parent.TeacherCloud;
      window.TeacherStorage = window.parent.TeacherStorage;
      let dirty = false;
      document.addEventListener("input", event => { if (event.target.closest("#ruleForm,#customScoreForm")) dirty = true; });
      window.TeacherSyncEditing = () => dirty || !!document.querySelector("dialog[open]");
      window.addEventListener("teacher-data-reloaded", () => { dirty = false; });
      document.addEventListener("submit", () => { dirty = false; });
      return;
    }
  } catch {}
  const project = new URL(C.url).hostname.split(".")[0];
  const sessionKey = `teacher-cloud-session:${project}`;
  const recoveryKey = "teacher-dashboard-class-management-3d-recovery-v1";
  const scoped = new Set([...M.KEYS, M.LEGACY, recoveryKey, "teacher-dashboard-timetable-snapshots-v1", "cycle-timetable-prototype-v3"]);
  const readJSON = key => { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; } };
  let session = readJSON(sessionKey);
  if (!session?.user?.id || !session.access_token || !session.refresh_token) session = null;
  let epoch = 0, busy = false, authBusy = false, expired = false, dirty = false;
  let choice = null, deferred = false, errorText = "", lastSync = 0, timer;
  let dialog, badge, statusNode, choiceNode, authForm;
  const uid = () => crypto.randomUUID();
  let device = localStorage.getItem("teacher-cloud-device-v1");
  if (!device) { device = uid(); localStorage.setItem("teacher-cloud-device-v1", device); }
  const accountPrefix = () => `teacher-cloud-data:${project}:${session?.user.id}:`;
  const keyFor = key => session && scoped.has(key) ? accountPrefix() + key : key;
  if (session) localStorage.setItem(keyFor(recoveryKey), "done");
  const metaKey = () => accountPrefix() + "sync-meta";
  function meta() {
    const value = readJSON(metaKey()) || {};
    if (value.base) workspace(value.base);
    if (value.pending) M.validate(value.pending.p_snapshot);
    return value;
  }
  function saveMeta(value) { localStorage.setItem(metaKey(), JSON.stringify(value)); }
  function storageWrite(method, key, value) {
    localStorage[method](keyFor(key), ...(method === "setItem" ? [value] : []));
    if (M.KEYS.includes(key) || key === M.LEGACY) changed();
  }
  window.TeacherStorage = {
    getItem: key => localStorage.getItem(keyFor(key)),
    setItem: (key, value) => storageWrite("setItem", key, value),
    removeItem: key => storageWrite("removeItem", key),
  };
  const capture = () => M.capture(window.TeacherStorage);
  function schedule(delay = 2000) { clearTimeout(timer); timer = setTimeout(() => sync(), delay); }
  function changed() { dirty = false; errorText = ""; update(); if (session) schedule(); }
  function editing() {
    return dirty || !!document.querySelector("dialog[open]:not(#teacherCloudDialog)") || [...document.querySelectorAll("iframe")].some(frame => {
      try { return !!frame.contentWindow.TeacherSyncEditing?.(); } catch { return false; }
    });
  }
  window.TeacherSyncEditing = editing;
  function textStatus() {
    if (errorText) return errorText;
    if (!session) return "本機模式：登入後共用資料";
    if (!navigator.onLine) return "離線：修改保存在此帳戶的本機資料，連線後同步";
    if (expired) return "登入已失效，請重新登入；本機修改保留";
    if (busy || authBusy) return "正在同步…";
    if (deferred) return "雲端有新資料；完成並儲存編輯後再載入";
    if (choice) return choice.kind === "initial" ? "首次連接：請選擇使用哪份資料" : "資料有衝突：請選擇保留的版本";
    try { const v = meta(); if (v.pending || (v.base && M.stable(capture()) !== M.stable(v.base.snapshot))) return "修改保存在本機，等待寫回"; } catch (error) { return error.message; }
    return lastSync ? `已同步 · ${new Date(lastSync).toLocaleTimeString("zh-HK", { hour: "2-digit", minute: "2-digit" })}` : "已登入，等待讀取";
  }
  function update() {
    const status = textStatus();
    if (badge) { badge.textContent = `☁ ${!session ? "登入與同步" : status.startsWith("已同步") ? "已同步" : choice ? "需處理" : "雲端資料"}`; badge.title = status; }
    if (!dialog) return;
    statusNode.textContent = status;
    dialog.querySelector("[data-cloud-account]").textContent = session ? `登入帳戶：${session.user.email || session.user.id}` : "尚未登入";
    authForm.hidden = !!session && !expired;
    dialog.querySelector('[data-cloud-action="logout"]').hidden = !session;
    dialog.querySelector('[data-cloud-action="sync"]').disabled = !session || busy || authBusy || expired;
    dialog.querySelectorAll("[data-cloud-choice]").forEach(button => { button.disabled = busy || authBusy; });
    authForm.querySelector('button[type="submit"]').disabled = authBusy || busy;
    document.querySelectorAll("[data-cloud-status]").forEach(node => { node.textContent = status; });
  }
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function renderChoices() {
    if (!choiceNode) return;
    if (!choice) { choiceNode.innerHTML = ""; update(); return; }
    let local;
    try { local = capture(); } catch (error) { errorText = error.message; update(); return; }
    choiceNode.innerHTML = `<section class="teacher-sync-choice"><h3>${choice.kind === "initial" ? "選擇首次共用資料" : "兩份資料有不同修改"}</h3><p>本機：${escape(M.summary(local))}</p>${choice.remote ? `<p>雲端：${escape(M.summary(choice.remote.snapshot))}<br>${escape(new Date(choice.remote.updated_at).toLocaleString("zh-HK"))}</p>` : "<p>此帳戶還沒有雲端資料。</p>"}<p>衝突時請先下載備份；選擇本機會發布整份本機資料，選擇雲端會取代本機共用資料。</p><button type="button" data-cloud-choice="local">${choice.remote ? "使用本機資料作為共用版本" : "把本機資料首次存入雲端"}</button>${choice.remote ? '<button type="button" data-cloud-choice="remote">使用雲端資料</button>' : ""}</section>`;
    update();
  }
  function guard(run) {
    const stored = readJSON(sessionKey);
    if (run !== epoch || !session || stored?.user?.id !== session.user.id) throw Object.assign(new Error("登入帳戶已改變，已停止原有同步。"), { cancelled: true });
  }
  async function request(path, options = {}) {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(C.url + path, {
        ...options, signal: controller.signal,
        headers: { apikey: C.publishableKey, "Content-Type": "application/json", ...options.headers },
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message = payload?.msg || payload?.message || payload?.error_description || payload?.error || `HTTP ${response.status}`;
        const error = new Error(message); error.status = response.status; error.code = payload?.code; throw error;
      }
      return payload;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("等候雲端逾時；本機修改保留，稍後會檢查寫入結果。");
      throw error;
    } finally { clearTimeout(timeout); }
  }
  function storeSession(payload) {
    if (!payload?.user?.id || !payload.access_token || !payload.refresh_token) throw new Error("登入回應不完整。");
    const next = { user: { id: payload.user.id, email: payload.user.email }, access_token: payload.access_token, refresh_token: payload.refresh_token, expires_at: payload.expires_at || Math.floor(Date.now() / 1000) + payload.expires_in };
    localStorage.setItem(sessionKey, JSON.stringify(next)); session = next; expired = false;
  }
  async function token(run, force = false) {
    guard(run);
    const renew = async () => {
      guard(run);
      const saved = readJSON(sessionKey);
      if (saved?.user?.id === session.user.id) session = saved;
      if (!force && Number(session.expires_at) > Date.now() / 1000 + 60) return session.access_token;
      const owner = session.user.id;
      const result = await request("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: JSON.stringify({ refresh_token: session.refresh_token }) });
      guard(run);
      if (result.user?.id !== owner) throw new Error("登入帳戶不一致，已停止同步。");
      storeSession(result); return session.access_token;
    };
    try {
      return navigator.locks ? await navigator.locks.request(`teacher-cloud-auth:${project}`, renew) : await renew();
    } catch (error) { if (error.status === 400 || error.status === 401 || error.status === 403) expired = true; throw error; }
  }
  async function rpc(name, body, run) {
    let access = await token(run);
    let result;
    const call = () => request(`/rest/v1/rpc/${name}`, { method: "POST", headers: { Authorization: `Bearer ${access}` }, body: JSON.stringify(body) });
    try { result = await call(); } catch (error) {
      if (error.status !== 401) throw error;
      access = await token(run, true); result = await call();
    }
    guard(run); return result;
  }
  function workspace(value) {
    if (value === null) return null;
    if (!value || typeof value.revision !== "string" || !Number.isFinite(Date.parse(value.updated_at))) throw new Error("雲端版本格式不正確。");
    M.validate(value.snapshot); return value;
  }
  async function read(run) {
    const result = await rpc("teacher_read_workspace", {}, run);
    if (result?.version !== 1) throw new Error("資料庫設定版本不符，請執行 Supabase 設定檔。");
    if (result.owner_id !== session.user.id) throw new Error("登入帳戶與雲端身分不一致，請重新登入；本機資料保留。");
    return workspace(result.workspace);
  }
  function saveBackup(snapshot, label = "載入前") {
    localStorage.setItem(accountPrefix() + "recovery", JSON.stringify({ app: "teacher-dashboard-shared", version: 1, savedAt: new Date().toISOString(), label, data: snapshot }));
  }
  function apply(snapshot) {
    M.validate(snapshot);
    if (M.stable(capture()) === M.stable(snapshot)) return;
    const previous = capture(); saveBackup(previous);
    const old = [...M.KEYS, M.LEGACY, recoveryKey].map(key => [keyFor(key), localStorage.getItem(keyFor(key))]);
    try {
      for (const key of M.KEYS) {
        if (Object.hasOwn(snapshot, key)) localStorage.setItem(keyFor(key), JSON.stringify(snapshot[key]));
        else localStorage.removeItem(keyFor(key));
      }
      localStorage.removeItem(keyFor(M.LEGACY)); localStorage.setItem(keyFor(recoveryKey), "done");
    } catch (error) {
      for (const [key, value] of old) { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); }
      throw new Error("本機空間不足，已保留原資料；請先下載備份。");
    }
    reloadViews();
  }
  function reloadViews() {
    dirty = false; deferred = false;
    window.dispatchEvent(new CustomEvent("teacher-data-reloaded"));
    document.querySelectorAll("iframe").forEach(frame => { try { frame.contentWindow.dispatchEvent(new CustomEvent("teacher-data-reloaded")); } catch {} });
  }
  async function push(snapshot, parent, value, run) {
    const pending = value.pending || { p_expected_revision: parent?.revision || null, p_request_id: uid(), p_snapshot: M.validate(snapshot), p_device: device };
    value.pending = pending; saveMeta(value);
    const result = await rpc("teacher_save_workspace", pending, run);
    if (result?.kind === "conflict") {
      delete value.pending; saveMeta(value);
      choice = { kind: "conflict", remote: workspace(result.workspace) }; renderChoices(); return false;
    }
    const saved = workspace(result?.workspace);
    if (result?.kind !== "saved" || saved?.revision !== pending.p_request_id || M.stable(saved.snapshot) !== M.stable(pending.p_snapshot)) throw new Error("無法確認雲端寫入結果；稍後會安全重試。");
    value.base = saved; delete value.pending; saveMeta(value); return true;
  }
  async function synchronize(selection, run, expected) {
    guard(run);
    let value = meta(), remote = await read(run);
    if (value.pending) {
      if (remote?.revision === value.pending.p_request_id) {
        if (M.stable(remote.snapshot) !== M.stable(value.pending.p_snapshot)) throw new Error("待上傳版本與雲端內容不一致。");
        value.base = remote; delete value.pending; saveMeta(value);
      } else {
        // Retrying the identical request is safe even if another device wrote
        // after it: the server checks the retained request ID before its parent.
        if (!await push(value.pending.p_snapshot, null, value, run)) return;
        remote = await read(run);
      }
    }
    if (selection) {
      if ((remote?.revision || null) !== expected) { choice = { kind: "conflict", remote }; renderChoices(); errorText = "雲端資料剛有更新，請重新選擇。"; return; }
      if (selection === "remote") {
        if (!remote || !confirm("載入雲端資料會取代本機共用資料，載入前會保存一份本機備份。是否繼續？")) return;
        if (editing()) throw new Error("請先完成或關閉正在編輯的表單。");
        apply(remote.snapshot); value.base = remote; saveMeta(value);
      } else if (!await push(capture(), remote, value, run)) return;
      choice = null; lastSync = Date.now(); renderChoices(); return;
    }
    const local = capture(), decision = M.decide(value.base, local, remote);
    if (["initial", "conflict"].includes(decision.kind)) { choice = { kind: decision.kind, remote }; renderChoices(); return; }
    choice = null;
    if (["pull", "merge"].includes(decision.kind) && editing()) { deferred = true; return; }
    deferred = false;
    if (decision.kind === "push") {
      if (!await push(local, remote, value, run)) return;
      if (M.stable(capture()) !== M.stable(value.base.snapshot)) schedule();
    } else if (decision.kind === "pull") {
      apply(remote.snapshot); value.base = remote; saveMeta(value);
    } else if (decision.kind === "merge") {
      apply(decision.snapshot);
      if (!await push(capture(), remote, value, run)) return;
    } else if (decision.kind === "adopt") { value.base = remote; saveMeta(value); }
    lastSync = Date.now(); renderChoices();
  }
  function report(error) {
    if (error.cancelled) return;
    if (error.code === "PGRST202" || error.code === "42P01") errorText = "資料庫尚未設定。請在 Supabase SQL Editor 執行 supabase/setup.sql。";
    else if (error.status === 400 && /credentials/i.test(error.message)) errorText = "電郵或密碼不正確。";
    else if (error.status === 401 || expired) errorText = "登入已失效，請重新登入；本機修改保留。";
    else if (error instanceof TypeError) errorText = "無法連接雲端；請檢查網絡或 Supabase 專案是否暫停。本機修改保留。";
    else errorText = error.message;
    update();
  }
  async function sync(selection) {
    if (busy || authBusy || !session || expired || !navigator.onLine) { update(); return; }
    const run = epoch, expected = choice?.remote?.revision || null;
    busy = true; errorText = ""; update();
    try {
      const task = () => synchronize(selection, run, expected);
      if (navigator.locks) await navigator.locks.request(`teacher-cloud-workspace:${project}:${session.user.id}`, task);
      else await task();
    } catch (error) { report(error); }
    finally { busy = false; update(); }
  }
  async function login(email, password) {
    if (busy || authBusy) return;
    if (editing()) { errorText = "請先完成或關閉正在編輯的表單，再登入。"; update(); return; }
    authBusy = true; errorText = ""; update();
    try {
      const result = await request("/auth/v1/token?grant_type=password", { method: "POST", body: JSON.stringify({ email, password }) });
      const different = session?.user.id !== result.user?.id;
      storeSession(result); epoch++; choice = null; deferred = false; lastSync = 0;
      if (different) { localStorage.setItem(keyFor(recoveryKey), "done"); reloadViews(); }
    } catch (error) { report(error); }
    finally { authBusy = false; if (authForm) authForm.elements.password.value = ""; update(); }
    if (session && !expired && !errorText) await sync();
  }
  async function logout() {
    if (busy || authBusy || !session) return;
    if (editing()) { errorText = "請先完成或關閉正在編輯的表單，再登出。"; update(); return; }
    if (!confirm("登出後會返回原有的本機模式。此帳戶尚未上傳的修改會保留在這部裝置，重新登入可繼續同步。是否登出？")) return;
    const previous = session;
    localStorage.removeItem(sessionKey); session = null; epoch++; clearTimeout(timer);
    choice = null; expired = false; lastSync = 0; errorText = ""; reloadViews(); renderChoices();
    // Local scope leaves the tablet's separate login session intact.
    request("/auth/v1/logout?scope=local", { method: "POST", headers: { Authorization: `Bearer ${previous.access_token}` } }).catch(() => {});
  }
  function download(name, value) {
    const a = document.createElement("a"), url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
    a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function backup() { return { app: "teacher-dashboard-shared", version: 1, savedAt: new Date().toISOString(), data: capture() }; }
  function open() { if (dialog && !dialog.open) dialog.showModal(); renderChoices(); update(); }
  function mount() {
    const stylesheet = document.createElement("link"); stylesheet.rel = "stylesheet";
    stylesheet.href = new URL("cloud-sync.css", document.querySelector('script[src$="cloud-sync.js"]').src).href; document.head.append(stylesheet);
    badge = document.createElement("button"); badge.type = "button"; badge.className = "teacher-sync-trigger"; badge.addEventListener("click", open);
    const anchor = document.querySelector(".status-icons,.topbar-actions,.window-header,.top-actions");
    if (anchor) anchor.prepend(badge);
    else { badge.classList.add("teacher-sync-floating"); document.body.append(badge); }
    dialog = document.createElement("dialog"); dialog.id = "teacherCloudDialog"; dialog.className = "teacher-sync-dialog";
    dialog.setAttribute("aria-labelledby", "teacherCloudTitle");
    dialog.innerHTML = `<div class="teacher-sync-heading"><h2 id="teacherCloudTitle">登入與共用資料</h2><button type="button" data-cloud-action="close" aria-label="關閉">×</button></div><p>共用班別、學生、時間表、校曆和加分紀錄。白板筆跡、圖片、功課紙及顯示設定只保存在本機，不會上傳內容或連結。</p><p data-cloud-account></p><p class="teacher-sync-status" role="status" aria-live="polite"></p><form data-cloud-login><label>登入電郵<input name="email" type="email" autocomplete="username" required></label><label>密碼<input name="password" type="password" autocomplete="current-password" required></label><button type="submit">登入</button><p class="teacher-sync-note">帳戶由專案擁有者建立。忘記密碼時請到 Supabase 控制台處理；此版沒有公開註冊或寄信功能。</p></form><div class="teacher-sync-actions"><button type="button" data-cloud-action="sync">立即同步</button><button type="button" data-cloud-action="backup">下載本機共用資料備份</button><button type="button" data-cloud-action="recovery">下載上次載入前備份</button><button type="button" data-cloud-action="logout">登出</button></div><div data-cloud-choices></div><details><summary>匯入共用資料或舊本機資料</summary><p>匯入會取代目前帳戶的本機共用資料。原本未登入時的資料另行保留，白板與圖片不受影響。</p><button type="button" data-cloud-action="legacy">匯入原有本機資料</button><label>選擇整合 JSON 備份<input data-cloud-import type="file" accept=".json,application/json"></label><p data-cloud-preview role="status"></p><button type="button" data-cloud-action="restore" disabled>確認還原至本機</button></details><p class="teacher-sync-note">儲存修改約 2 秒後寫回，每 30 秒檢查更新。同一欄位有不同修改時需選擇版本；不同學生或不同加分紀錄可安全合併。每個帳戶只可存取自己的資料，雲端保留最近 50 個版本。</p>`;
    document.body.append(dialog); statusNode = dialog.querySelector(".teacher-sync-status"); choiceNode = dialog.querySelector("[data-cloud-choices]"); authForm = dialog.querySelector("form");
    authForm.addEventListener("submit", event => { event.preventDefault(); login(authForm.elements.email.value.trim(), authForm.elements.password.value); });
    let draft;
    dialog.querySelector("[data-cloud-import]").addEventListener("change", async event => {
      draft = null; dialog.querySelector('[data-cloud-action="restore"]').disabled = true;
      const file = event.target.files[0]; if (!file) return;
      try {
        if (file.size > 1200000) throw new Error("備份檔案太大。");
        const value = JSON.parse(await file.text());
        if (value.app !== "teacher-dashboard-shared" || value.version !== 1) throw new Error("請選擇此面板下載的整合 JSON 備份。");
        draft = M.validate(value.data); dialog.querySelector("[data-cloud-preview]").textContent = M.summary(draft);
        dialog.querySelector('[data-cloud-action="restore"]').disabled = false;
      } catch (error) { dialog.querySelector("[data-cloud-preview]").textContent = error.message; }
    });
    dialog.addEventListener("click", async event => {
      const selection = event.target.closest("[data-cloud-choice]")?.dataset.cloudChoice;
      if (selection) { await sync(selection); return; }
      const action = event.target.closest("[data-cloud-action]")?.dataset.cloudAction;
      try {
        if (action === "close") dialog.close();
        if (action === "sync") await sync();
        if (action === "logout") await logout();
        if (action === "backup") download("教師工具-共用資料備份.json", backup());
        if (action === "recovery") { const previous = readJSON(accountPrefix() + "recovery"); if (!previous) throw new Error("沒有載入前備份。"); download("教師工具-載入前備份.json", previous); }
        if (action === "legacy" || action === "restore") {
          if (busy || authBusy || editing()) throw new Error("請先完成同步或關閉正在編輯的表單。");
          if (action === "legacy" && !session) throw new Error("請先登入要接收資料的教師帳戶。");
          const incoming = action === "legacy" ? M.capture(localStorage) : draft;
          if (!incoming) return;
          if (!confirm(`將以這份資料取代目前本機共用資料：${M.summary(incoming)}。是否繼續？`)) return;
          apply(incoming); changed(); errorText = "已還原至本機；如有版本選擇，請選本機資料以發布。"; renderChoices();
        }
      } catch (error) { report(error); }
    });
    document.addEventListener("input", event => {
      if (event.target.closest("#teacherCloudDialog") || ["studentSearch", "classSelect"].includes(event.target.id)) return;
      if (event.target.closest("#editorForm,#quickClassForm,#ruleForm,#customScoreForm,.timetable-tool") || location.pathname.includes("timetable-prototype/")) dirty = true;
    });
    document.addEventListener("click", event => {
      if (["add-calendar-entry", "remove-calendar-entry", "add-period", "remove-period", "add-block", "remove-block", "add-exception", "remove-exception"].includes(event.target.closest("[data-action]")?.dataset.action || event.target.closest("[data-tt-action]")?.dataset.ttAction)) dirty = true;
    });
    document.addEventListener("close", event => {
      if (event.target instanceof HTMLDialogElement && event.target !== dialog) { dirty = false; schedule(0); }
    }, true);
    window.addEventListener("storage", event => {
      if (event.key === sessionKey) {
        const next = readJSON(sessionKey);
        if (next?.user?.id === session?.user?.id) { session = next; return; }
        session = next?.user?.id ? next : null; epoch++; choice = null; expired = false; errorText = ""; lastSync = 0;
        reloadViews(); renderChoices(); schedule(0);
      } else if (event.key?.startsWith(accountPrefix()) && M.KEYS.some(key => event.key.endsWith(":" + key))) {
        if (!editing()) reloadViews(); schedule(); update();
      }
    });
    window.addEventListener("online", () => schedule(0));
    document.addEventListener("visibilitychange", () => { if (!document.hidden) schedule(0); });
    setInterval(() => { if (!document.hidden) sync(); }, 30000);
    update(); if (session) schedule(0);
  }
  window.TeacherCloud = { open, sync, changed, status: textStatus, backup, account: () => session?.user || null };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
