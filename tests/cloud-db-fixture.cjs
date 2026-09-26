const { PGlite } = require(process.env.PGLITE_MODULE || "@electric-sql/pglite");
const fs = require("node:fs"), path = require("node:path");
const USERS = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"];
async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;
    insert into auth.users values ('${USERS[0]}'),('${USERS[1]}');`);
  const sql = fs.readFileSync(path.resolve(__dirname, "../supabase/setup.sql"), "utf8");
  await db.exec(sql);
  // Re-execution is also part of the supported user setup flow.
  await db.exec(sql);
  let queue = Promise.resolve();
  const exclusive = task => { const result = queue.then(task); queue = result.catch(() => {}); return result; };
  async function as(owner, task) {
    return exclusive(async () => {
      await db.exec(`set role ${owner ? "authenticated" : "anon"}`);
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner || ""]);
      try { return await task(db); } finally { await db.exec("reset role"); }
    });
  }
  async function rpc(owner, name, args = {}) {
    return as(owner, async connection => {
      const query = name === "teacher_read_workspace" ? "select public.teacher_read_workspace() result" : "select public.teacher_save_workspace($1,$2,$3::jsonb,$4) result";
      const params = name === "teacher_read_workspace" ? [] : [args.p_expected_revision, args.p_request_id, JSON.stringify(args.p_snapshot), args.p_device];
      return (await connection.query(query, params)).rows[0].result;
    });
  }
  return { db, as, rpc, users: USERS, close: () => db.close() };
}
module.exports = { fixture, USERS };
