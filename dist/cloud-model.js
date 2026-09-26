/* Only structured teacher data crosses the cloud boundary. */
(function (root) {
  "use strict";
  const KEYS = Object.freeze(["teacher-dashboard-class-management-v1", "teacher-dashboard-timetable-v1", "cycle-timetable-prototype-v4", "teacher-dashboard-scores-v1"]);
  const LEGACY = "teacher-tools-class-management-prototype-v2";
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  function stable(value) {
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
    if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
    return JSON.stringify(value);
  }
  function validate(snapshot) {
    if (!object(snapshot) || Object.keys(snapshot).some(key => !KEYS.includes(key))) throw new Error("共用資料包含不支援的欄位，已停止同步。");
    for (const [key, value] of Object.entries(snapshot)) {
      if (!object(value)) throw new Error("共用資料格式不完整。");
      if (key === KEYS[0]) {
        if (!Array.isArray(value.classes) || !value.classes.every(c => object(c) && typeof c.id === "string" && typeof c.name === "string" && Array.isArray(c.students) && c.students.every(s => object(s) && typeof s.id === "string" && typeof s.name === "string"))) throw new Error("班別或學生資料格式不正確。");
      } else if (key === KEYS[3]) {
        if (!Array.isArray(value.entries) || !Array.isArray(value.rules) || !object(value.plants)) throw new Error("加分資料格式不正確。");
      } else if (!Array.isArray(value.classes) || !value.classes.every(c => typeof c === "string") || !object(value.lessons)) throw new Error("時間表或校曆資料格式不正確。");
    }
    if (new TextEncoder().encode(stable(snapshot)).length > 900000) throw new Error("共用資料超過 900 KB，請先備份並整理加分紀錄。");
    return snapshot;
  }
  function capture(storage) {
    const result = {};
    for (const key of KEYS) {
      const raw = storage.getItem(key) ?? (key === KEYS[0] ? storage.getItem(LEGACY) : null);
      if (raw !== null) {
        try { result[key] = JSON.parse(raw); } catch { throw new Error("本機資料無法讀取，請先檢查備份。"); }
      }
    }
    return validate(result);
  }
  // Conservative three-way merge: different fields and stable-ID records can
  // merge; edits to the same value, or deletion versus editing, require a choice.
  function merge(base, local, remote) {
    if (stable(local) === stable(remote)) return { ok: true, value: local };
    if (stable(local) === stable(base)) return { ok: true, value: remote };
    if (stable(remote) === stable(base)) return { ok: true, value: local };
    if ((object(base) || base === undefined) && object(local) && object(remote)) {
      base ||= {};
      const result = {};
      for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
        const part = merge(base[key], local[key], remote[key]);
        if (!part.ok) return { ok: false };
        if (part.value !== undefined) result[key] = part.value;
      }
      return { ok: true, value: result };
    }
    const keyed = list => Array.isArray(list) && list.every(item => object(item) && typeof item.id === "string") && new Set(list.map(item => item.id)).size === list.length;
    if ((keyed(base) || base === undefined) && keyed(local) && keyed(remote)) {
      base ||= [];
      const map = list => Object.fromEntries(list.map(item => [item.id, item]));
      const merged = merge(map(base), map(local), map(remote));
      if (!merged.ok) return merged;
      const ids = [...new Set([...remote.map(item => item.id), ...local.map(item => item.id)])];
      return { ok: true, value: ids.filter(id => merged.value[id]).map(id => merged.value[id]) };
    }
    return { ok: false };
  }
  function decide(base, local, remote) {
    if (!base) return { kind: "initial" };
    if (!remote) throw new Error("雲端原有資料已不存在，請備份本機資料並檢查資料庫。");
    if (remote.revision === base.revision) {
      if (stable(remote.snapshot) !== stable(base.snapshot)) throw new Error("雲端版本內容不一致，已停止同步。");
      return { kind: stable(local) === stable(base.snapshot) ? "idle" : "push" };
    }
    if (stable(local) === stable(remote.snapshot)) return { kind: "adopt" };
    if (stable(local) === stable(base.snapshot)) return { kind: "pull" };
    const combined = merge(base.snapshot, local, remote.snapshot);
    return combined.ok ? { kind: "merge", snapshot: validate(combined.value) } : { kind: "conflict" };
  }
  function summary(snapshot) {
    const roster = snapshot[KEYS[0]], timetable = snapshot[KEYS[2]] || snapshot[KEYS[1]];
    return `${roster?.classes?.length || 0} 個班別、${roster?.classes?.reduce((sum, c) => sum + c.students.length, 0) || 0} 位學生、${timetable?.classes?.length || 0} 個班別課表、${snapshot[KEYS[3]]?.entries?.length || 0} 筆加分紀錄`;
  }
  const api = { KEYS, LEGACY, stable, validate, capture, decide, merge, summary };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TeacherCloudModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
