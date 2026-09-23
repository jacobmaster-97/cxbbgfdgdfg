/* Shared local data operations for the Settings panel. */
const SettingsData = (() => {
  const CLASS_KEY = "teacher-dashboard-class-management-v1";
  const LEGACY_CLASS_KEY = "teacher-tools-class-management-prototype-v2";
  const TIMETABLE_KEYS = ["cycle-timetable-prototype-v4", "teacher-dashboard-timetable-v1"];
  const SCORE_KEY = "teacher-dashboard-scores-v1";
  const BOARD_KEY = "teacher-dashboard-whiteboards-v1";
  const categories = {
    classes: "班別",
    students: "學生",
    timetable: "時間表",
    scores: "加分紀錄",
  };
  const read = key => { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; } };
  const object = value => value && typeof value === "object" && !Array.isArray(value);
  const classes = () => read(CLASS_KEY) || read(LEGACY_CLASS_KEY) || { classes: [], selectedClassId: "" };
  const validClass = item => object(item) && typeof item.id === "string" && item.id && typeof item.name === "string" && item.name;
  const validStudent = item => object(item) && typeof item.id === "string" && item.id && typeof item.name === "string";
  const storageBytes = keys => keys.reduce((sum, key) => {
    const value = localStorage.getItem(key);
    return sum + (value === null ? 0 : (key.length + value.length) * 2);
  }, 0);

  function exportPayload(category) {
    const roster = classes();
    let data;
    if (category === "classes") data = { classes: (roster.classes || []).map(({ id, name }) => ({ id, name })), selectedClassId: roster.selectedClassId || "" };
    if (category === "students") data = { classes: (roster.classes || []).map(({ id, name, students }) => ({ id, name, students: students || [] })) };
    if (category === "timetable") {
      data = Object.fromEntries(TIMETABLE_KEYS.filter(key => localStorage.getItem(key) !== null).map(key => [key, read(key)]));
      if (!Object.keys(data).length) data[TIMETABLE_KEYS[1]] = typeof timetable === "undefined" ? { classes: [], lessons: {} } : timetable;
    }
    if (category === "scores") data = read(SCORE_KEY) || { rules: [], entries: [], plants: {}, selectedClassId: "" };
    return { app: "teacher-dashboard", version: 1, category, exportedAt: new Date().toISOString(), data };
  }

  function validate(payload) {
    if (!object(payload) || payload.app !== "teacher-dashboard" || payload.version !== 1 || !categories[payload.category]) throw new Error("檔案並非此工具支援的備份格式");
    const { category, data } = payload;
    if (!object(data)) throw new Error("備份內容不完整");
    if (category === "classes" && (!Array.isArray(data.classes) || !data.classes.every(validClass))) throw new Error("班別資料格式不正確");
    if (category === "students" && (!Array.isArray(data.classes) || !data.classes.every(item => validClass(item) && Array.isArray(item.students) && item.students.every(validStudent)))) throw new Error("學生資料格式不正確");
    if (category === "timetable" && (!TIMETABLE_KEYS.some(key => object(data[key]) && Array.isArray(data[key].classes) && object(data[key].lessons)) || Object.entries(data).some(([key, value]) => !TIMETABLE_KEYS.includes(key) || !object(value) || !Array.isArray(value.classes) || !object(value.lessons)))) throw new Error("時間表資料格式不正確");
    if (category === "scores" && (!Array.isArray(data.entries) || !Array.isArray(data.rules) || !object(data.plants))) throw new Error("加分紀錄格式不正確");
    return payload;
  }

  function summary(category, data) {
    if (category === "classes") return `${data.classes.length} 個班別：${data.classes.slice(0, 5).map(item => item.name).join("、") || "無"}${data.classes.length > 5 ? "…" : ""}`;
    if (category === "students") return `${data.classes.length} 個班別，共 ${data.classes.reduce((sum, item) => sum + item.students.length, 0)} 位學生`;
    if (category === "timetable") return `${Object.keys(data).length} 份時間表資料，${Object.values(data).reduce((sum, item) => sum + Object.keys(item.lessons || {}).length, 0)} 個班別有課表`;
    return `${data.entries.length} 筆加減分紀錄，${data.rules.length} 條規則`;
  }

  function importPayload(payload) {
    validate(payload);
    const { category, data } = payload;
    if (category === "classes" || category === "students") {
      const current = classes();
      const next = { ...current, classes: Array.isArray(current.classes) ? [...current.classes] : [] };
      data.classes.forEach(incoming => {
        const index = next.classes.findIndex(item => item.id === incoming.id || item.name === incoming.name);
        if (category === "classes") {
          if (index < 0) next.classes.push({ id: incoming.id, name: incoming.name, students: [] });
          else next.classes[index] = { ...next.classes[index], name: incoming.name };
        } else {
          if (index < 0) next.classes.push({ id: incoming.id, name: incoming.name, students: incoming.students });
          else next.classes[index] = { ...next.classes[index], students: incoming.students };
        }
      });
      if (!next.classes.some(item => item.id === next.selectedClassId)) next.selectedClassId = next.classes[0]?.id || "";
      localStorage.setItem(CLASS_KEY, JSON.stringify(next));
    }
    if (category === "timetable") {
      const fallback = data[TIMETABLE_KEYS[0]] || data[TIMETABLE_KEYS[1]];
      TIMETABLE_KEYS.forEach(key => localStorage.setItem(key, JSON.stringify(data[key] || fallback)));
    }
    if (category === "scores") localStorage.setItem(SCORE_KEY, JSON.stringify(data));
  }

  function status() {
    const roster = classes();
    const score = read(SCORE_KEY);
    const board = read(BOARD_KEY);
    const classCount = Array.isArray(roster.classes) ? roster.classes.length : 0;
    const studentCount = Array.isArray(roster.classes) ? roster.classes.reduce((sum, item) => sum + (Array.isArray(item.students) ? item.students.length : 0), 0) : 0;
    const timetable = TIMETABLE_KEYS.map(read).find(item => object(item) && Array.isArray(item.classes));
    const bytes = storageBytes([CLASS_KEY, LEGACY_CLASS_KEY, ...TIMETABLE_KEYS, SCORE_KEY, BOARD_KEY, "teacher-dashboard-homework-papers-v1"]);
    return { classCount, studentCount, timetableCount: timetable?.classes?.length || 0, scoreCount: score?.entries?.length || 0, boardCount: board?.boards?.length || 0, bytes };
  }

  function clear(category) {
    if (category === "whiteboard") localStorage.removeItem(BOARD_KEY);
    if (category === "scores") {
      const saved = read(SCORE_KEY);
      if (object(saved)) localStorage.setItem(SCORE_KEY, JSON.stringify({ ...saved, entries: [], plants: {} }));
    }
  }
  return { categories, exportPayload, validate, summary, importPayload, status, clear };
})();
