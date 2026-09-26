const test = require("node:test"), assert = require("node:assert/strict"), { randomUUID } = require("node:crypto");
const { fixture } = require("./cloud-db-fixture.cjs"), M = require("../dist/cloud-model.js");
test("actual PostgreSQL schema, RLS, permissions, CAS and request retry", async t => {
  const f = await fixture(), [owner, other] = f.users;
  const payload = { [M.KEYS[0]]: { classes: [{ id: "c1", name: "3A", students: [{ id: "s1", name: "測試" }] }] } };
  const request = { p_expected_revision: null, p_request_id: randomUUID(), p_snapshot: payload, p_device: "desktop" };
  try {
    await t.test("anonymous cannot use RPC or select teacher tables", async () => {
      await assert.rejects(f.rpc(null, "teacher_read_workspace"), /permission denied/);
      await assert.rejects(f.as(null, db => db.query("select * from public.teacher_workspaces")), /permission denied/);
    });
    await t.test("first creation is accepted once and replayed without a second write", async () => {
      assert.equal((await f.rpc(owner, "teacher_read_workspace")).workspace, null);
      assert.equal((await f.rpc(owner, "teacher_save_workspace", request)).kind, "saved");
      assert.equal((await f.rpc(owner, "teacher_save_workspace", request)).kind, "saved");
      assert.equal((await f.db.query("select count(*)::int n from public.teacher_workspace_versions")).rows[0].n, 1);
      await assert.rejects(f.rpc(owner, "teacher_save_workspace", { ...request, p_snapshot: {} }), /內容不一致/);
    });
    await t.test("stale writer returns a conflict with the preserved current data", async () => {
      const loser = await f.rpc(owner, "teacher_save_workspace", { ...request, p_request_id: randomUUID() });
      assert.equal(loser.kind, "conflict"); assert.equal(loser.workspace.revision, request.p_request_id);
      assert.deepEqual(loser.workspace.snapshot, payload);
    });
    await t.test("other accounts see neither current data nor history; direct writes are denied", async () => {
      assert.equal((await f.rpc(other, "teacher_read_workspace")).workspace, null);
      assert.equal((await f.as(other, db => db.query("select * from public.teacher_workspaces"))).rows.length, 0);
      assert.equal((await f.as(other, db => db.query("select * from public.teacher_workspace_versions"))).rows.length, 0);
      await assert.rejects(f.as(owner, db => db.query("update public.teacher_workspaces set snapshot='{}'")), /permission denied/);
    });
    await t.test("media, corrupt shapes and oversize payloads cannot be written", async () => {
      for (const invalid of [{ whiteboards: {} }, { [M.KEYS[0]]: { classes: null } }, { [M.KEYS[0]]: { classes: [{ id: "x", name: "x", students: [null] }] } }, { [M.KEYS[1]]: { classes: [], lessons: {}, extra: "字".repeat(400000) } }]) {
        await assert.rejects(f.rpc(owner, "teacher_save_workspace", { ...request, p_expected_revision: request.p_request_id, p_request_id: randomUUID(), p_snapshot: invalid }), /格式不正確/);
      }
    });
    await t.test("latest 50 versions are retained and old accepted requests cannot overwrite newer data", async () => {
      let revision = request.p_request_id;
      for (let i = 0; i < 52; i++) {
        const next = { ...request, p_expected_revision: revision, p_request_id: randomUUID() };
        assert.equal((await f.rpc(owner, "teacher_save_workspace", next)).kind, "saved"); revision = next.p_request_id;
      }
      assert.equal((await f.db.query("select count(*)::int n from public.teacher_workspace_versions")).rows[0].n, 50);
      assert.equal((await f.rpc(owner, "teacher_save_workspace", request)).kind, "conflict");
    });
  } finally { await f.close(); }
});
