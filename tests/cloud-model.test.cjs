const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../dist/cloud-model.js");
const roster = name => ({ [M.KEYS[0]]: { classes: [{ id: "c1", name: "3A", students: [{ id: "s1", name }] }] } });
test("capture includes only requested data, never board contents, links, preferences or auth tokens", () => {
  const values = new Map(Object.entries({ [M.KEYS[0]]: JSON.stringify(roster("學生")[M.KEYS[0]]), "teacher-dashboard-whiteboards-v1": "PRIVATE-DRAWING", "teacher-dashboard-homework-papers-v1": "PRIVATE-PICTURE-LINK", "teacher-cloud-session:test": "SECRET-TOKEN" }));
  assert.deepEqual(M.capture({ getItem: k => values.get(k) ?? null }), roster("學生"));
  assert.throws(() => M.validate({ "teacher-dashboard-whiteboards-v1": {} }));
});
test("independent score additions and edits to different students merge without losing either", () => {
  const base = { entries: [{ id: "old", studentId: "s1", points: 1 }], rules: [], plants: {} };
  const local = { ...base, entries: [...base.entries, { id: "a", studentId: "s1", points: 2 }] };
  const remote = { ...base, entries: [...base.entries, { id: "b", studentId: "s2", points: 3 }] };
  assert.deepEqual(new Set(M.merge(base, local, remote).value.entries.map(e => e.id)), new Set(["old", "a", "b"]));
  assert.deepEqual(new Set(M.merge(undefined, { ...base, entries: [{ id: "a", points: 1 }] }, { ...base, entries: [{ id: "b", points: 2 }] }).value.entries.map(e => e.id)), new Set(["a", "b"]));
  const before = [{ id: "s1", name: "A" }, { id: "s2", name: "B" }];
  assert.deepEqual(M.merge(before, [{ id: "s1", name: "AA" }, before[1]], [before[0], { id: "s2", name: "BB" }]).value, [{ id: "s1", name: "AA" }, { id: "s2", name: "BB" }]);
});
test("same-field edits and deletion versus editing require a choice; safe deletion is preserved", () => {
  assert.equal(M.merge(roster("A"), roster("B"), roster("C")).ok, false);
  assert.equal(M.merge([{ id: "s1", name: "A" }], [], [{ id: "s1", name: "B" }]).ok, false);
  assert.deepEqual(M.merge([{ id: "s1", name: "A" }], [], [{ id: "s1", name: "A" }]).value, []);
});
test("first connection is explicit, unchanged local data pulls and corrupt history stops", () => {
  const base = { revision: "a", snapshot: roster("A") }, remote = { revision: "b", snapshot: roster("B") };
  assert.equal(M.decide(null, roster("A"), remote).kind, "initial");
  assert.equal(M.decide(base, roster("A"), remote).kind, "pull");
  assert.equal(M.decide(base, roster("C"), remote).kind, "conflict");
  assert.throws(() => M.decide(base, roster("A"), { revision: "a", snapshot: roster("B") }));
  assert.throws(() => M.validate(roster("學".repeat(400000))));
});
