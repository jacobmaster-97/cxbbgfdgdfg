const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  announce: window.TeacherStorage.getItem("announce") !== "off",
  monthOffset: 0,
  ui: { theme: "sunset", scale: 100, dark: false, reduceMotion: false, largeText: false, highContrast: false, clockFormat: "24", examAlarmVolume: 70 },
  toastTimer: null,
  exam: {
    schedule: null,
    clockAnchor: null,
    timerId: null,
    wakeLock: null,
    alarmContext: null,
    alarmInterval: null,
    alarmNodes: new Set(),
    alarmActive: false,
    alarmPreview: false,
    alarmPlayed: false,
  },
  standaloneTimer: {
    seconds: 300,
    endAt: null,
    timerId: null,
    minimized: false,
  },
  whiteboard: {
    mode: "board",
    boards: [],
    activeId: null,
    canvas: null,
    context: null,
    tool: "pen",
    color: "#111827",
    size: 6,
    drawing: false,
    pointerId: null,
    previousPoint: null,
    history: [],
    redo: [],
    saveTimer: null,
    timerSeconds: 300,
    timerEnd: null,
    timerId: null,
    penSeenAt: 0,
    panning: false,
    panStart: null,
    lineStart: null,
    lineBase: null,
  },
};

const EXAM_SETTINGS_KEY = "teacher-dashboard-exam-settings-v1";
const UI_PREFERENCES_KEY = "teacher-dashboard-ui-preferences-v1";
let pendingSettingsImport = null;
const HIDDEN_DOCK_APPS_KEY = "teacher-dashboard-hidden-dock-apps-v1";
const UI_THEMES = {
  sunset: ["#ff875f", "#8658d7"],
  ocean: ["#23a6d5", "#5b4ad9"],
  forest: ["#28a078", "#365ca8"],
};
const APP_LIBRARY = {
  "班別管理": "建立班別與學生名單",
  "上課時間表": "循環周課表、校曆與公眾假期",
  "加分": "按學生記錄課堂加分與減分",
  "計時工具": "考試投影與獨立倒數",
  "電子白板": "書寫、繪圖與課堂計時",
  "功課紙": "方格與橫線功課紙",
  "數學賓果": "分隊數學賓果遊戲",
  "乘法寶藏": "乘法分隊挑戰遊戲",
  "設定": "主題、顯示比例與動畫",
};
const WHITEBOARD_STORAGE_KEYS = {
  board: "teacher-dashboard-whiteboards-v1",
  homework: "teacher-dashboard-homework-papers-v1",
};
const HOMEWORK_BACKGROUNDS = {
  gridFine: { label: "幼方格功課紙", asset: "./assets/homework-grid-fine.png", ratio: "1119 / 1405" },
  gridWide: { label: "大方格功課紙", asset: "./assets/homework-grid-wide.png", ratio: "1118 / 1407" },
  lined: { label: "橫線功課紙", asset: "./assets/homework-lined.png", ratio: "1121 / 1403" },
};

const TIMETABLE_STORAGE_KEY = "teacher-dashboard-timetable-v1";
const TIMETABLE_PUBLIC_HOLIDAYS = [
  ["2026-09-26", "中秋節翌日"], ["2026-10-01", "國慶日"], ["2026-10-19", "重陽節翌日"], ["2026-12-25", "聖誕節"], ["2026-12-26", "聖誕節後第一個周日"], ["2027-01-01", "一月一日"], ["2027-02-06", "農曆年初一"], ["2027-02-08", "農曆年初三"], ["2027-02-09", "農曆年初四"], ["2027-03-26", "耶穌受難節"], ["2027-03-27", "耶穌受難節翌日"], ["2027-03-29", "復活節星期一"], ["2027-04-05", "清明節"], ["2027-05-01", "勞動節"], ["2027-05-13", "佛誕"], ["2027-06-09", "端午節"], ["2027-07-01", "香港特別行政區成立紀念日"],
].map(([start, name]) => ({ start, end: "", note: `公眾假期：${name}`, source: "公眾假期 JSON" }));
const TIMETABLE_DEFAULT = {
  setup: { termName: "2026–27 第一學期", cycleStart: "2026-09-07", cycleEnd: "2027-07-09", cycleLength: 6 },
  classes: ["3A", "3B"], selectedClass: "3A", exceptions: [], publicHolidays: [],
  morningPeriods: [{ name: "第 1 節", start: "08:25", end: "09:05" }, { name: "第 2 節", start: "09:05", end: "09:45" }, { name: "第 3 節", start: "10:00", end: "10:40" }, { name: "第 4 節", start: "10:40", end: "11:20" }, { name: "第 5 節", start: "11:35", end: "12:15" }, { name: "第 6 節", start: "12:15", end: "12:55" }],
  afternoonPeriods: [{ name: "第 7 節", start: "14:05", end: "14:45" }, { name: "第 8 節", start: "14:45", end: "15:25" }],
  lessons: { "3A": { "morning-1-0": { subject: "中文", room: "201" }, "morning-1-2": { subject: "數學", room: "201" }, "morning-2-1": { subject: "英文", room: "201" }, "afternoon-0-0": { subject: "常識", room: "201" } }, "3B": {} },
};

function cloneTimetableDefault() { return JSON.parse(JSON.stringify(TIMETABLE_DEFAULT)); }
function loadTimetable() {
  try {
    const prototype = JSON.parse(window.TeacherStorage.getItem("cycle-timetable-prototype-v4") || "{}");
    const dashboard = JSON.parse(window.TeacherStorage.getItem(TIMETABLE_STORAGE_KEY) || "{}");
    const saved = prototype.setup ? { ...prototype, exceptions: prototype.excludedRanges || [] } : dashboard;
    const result = { ...cloneTimetableDefault(), ...saved, setup: { ...TIMETABLE_DEFAULT.setup, ...(saved.setup || {}) }, exceptions: saved.exceptions || [], publicHolidays: saved.publicHolidays || [], lessons: { ...TIMETABLE_DEFAULT.lessons, ...(saved.lessons || {}) } };
    result.selectedClass = result.classes.includes(result.selectedClass) ? result.selectedClass : result.classes[0];
    return result;
  } catch { return cloneTimetableDefault(); }
}
let timetable = loadTimetable();
let timetableTab = "today";
function saveTimetable() { window.TeacherStorage.setItem(TIMETABLE_STORAGE_KEY, JSON.stringify(timetable)); }
function timetableDateValue(date) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
function timetableLocalDate(value) { return new Date(`${value}T12:00:00`); }
function timetableWeekday(date) { return date.getDay() !== 0 && date.getDay() !== 6; }
function timetableCycleLabel(day) { return `Day ${String.fromCharCode(64 + Number(day))}`; }
function timetableHoliday(date) {
  const value = timetableDateValue(date); const all = new Map(TIMETABLE_PUBLIC_HOLIDAYS.map(entry => [entry.start, entry]));
  (timetable.publicHolidays || []).forEach(entry => all.set(entry.start, entry));
  return [...all.values()].find(entry => value >= entry.start && value <= (entry.end || entry.start));
}
function timetableException(date) { const value = timetableDateValue(date); return timetable.exceptions.find(entry => entry.start && value >= entry.start && value <= (entry.end || entry.start)); }
function timetableSchoolDay(date) {
  const target = new Date(date); target.setHours(12, 0, 0, 0);
  const { cycleStart, cycleEnd, cycleLength } = timetable.setup; const start = timetableLocalDate(cycleStart); const end = timetableLocalDate(cycleEnd);
  if (!cycleStart || !cycleEnd || target < start || target > end) return { active: false, reason: "循環周外" };
  const closed = timetableException(target) || timetableHoliday(target);
  if (closed) return { active: false, reason: closed.note || "不適用日", closed };
  if (!timetableWeekday(target)) return { active: false, reason: "星期六日" };
  let count = 0; const cursor = new Date(start);
  while (cursor <= target) { if (timetableWeekday(cursor) && !timetableException(cursor) && !timetableHoliday(cursor)) count += 1; cursor.setDate(cursor.getDate() + 1); }
  return { active: true, day: ((count - 1) % Number(cycleLength)) + 1 };
}
function timetableLessonsFor(date, className = timetable.selectedClass) {
  const info = timetableSchoolDay(date); if (!info.active) return [];
  const lessons = timetable.lessons[className] || []; const weekday = date.getDay() - 1;
  const morning = timetable.morningPeriods.map((period, index) => ({ period, entry: lessons[`morning-${info.day}-${index}`] })).filter(item => item.entry?.subject);
  const afternoon = weekday >= 0 && weekday < 5 ? timetable.afternoonPeriods.map((period, index) => ({ period, entry: lessons[`afternoon-${weekday}-${index}`] })).filter(item => item.entry?.subject) : [];
  return [...morning, ...afternoon].sort((a, b) => a.period.start.localeCompare(b.period.start));
}
function timetableEscape(value) { return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }
function renderDashboardSchedule() {
  const box = $("#dashboardSchedule"); if (!box) return;
  const classSelect = $("#dashboardClassSelect");
  if (classSelect) classSelect.innerHTML = timetable.classes.map(name => `<option value="${timetableEscape(name)}" ${name === timetable.selectedClass ? "selected" : ""}>${timetableEscape(name)}</option>`).join("");
  const now = new Date(); const info = timetableSchoolDay(now); const lessons = timetableLessonsFor(now);
  if (!info.active) { box.innerHTML = `<div class="lesson active"><time>—</time><span>${timetableEscape(info.reason)}</span><b>今天停課</b></div>`; return; }
  if (!lessons.length) { box.innerHTML = `<div class="lesson active"><time>${timetableCycleLabel(info.day)}</time><span>${timetableEscape(timetable.selectedClass)} 尚未安排課堂</span><b></b></div>`; return; }
  const nowTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  box.innerHTML = lessons.map((item, index) => { const status = nowTime >= item.period.start && nowTime < item.period.end ? "進行中" : nowTime < item.period.start && !lessons.slice(0, index).some(previous => nowTime < previous.period.start) ? "下一節" : ""; return `<div class="lesson ${status === "進行中" ? "active" : ""}"><time>${item.period.start}</time><span>${timetableEscape(item.entry.subject)} · ${timetableEscape(timetable.selectedClass)}</span><b>${status}</b></div>`; }).join("");
}

const heroTime = $("#heroTime");
const statusTime = $("#statusTime");
const digitalTime = $("#digitalTime");
const heroDate = $("#heroDate");
const hourHand = $("#hourHand");
const minuteHand = $("#minuteHand");
const secondHand = $("#secondHand");
const announceToggle = $("#announceToggle");
const dialog = $("#appDialog");
const dialogTitle = $("#dialogTitle");
const dialogBody = $("#dialogBody");
const standaloneTimerMini = $("#standaloneTimerMini");
const toast = $("#toast");
const fullscreenButton = $("#fullscreenButton");
const examProjection = $("#examProjection");
const projectionContent = $("#projectionContent");
const whiteboard = $("#whiteboard");
const wbCanvasWrap = $("#wbCanvasWrap");
const wbCanvas = $("#wbCanvas");
const wbToolbar = $(".wb-toolbar");
const wbLeftActions = $(".wb-left-actions");
const wbTimer = $("#wbTimer");
const bingoGame = $("#bingoGame");
const treasureGame = $("#treasureGame");
const appSidebar = $("#appSidebar");
const appLibraryButton = $("#appLibraryButton");
const appLibraryList = $("#appLibraryList");

function savedUIPreferences() {
  try {
    const preferences = { theme: "sunset", scale: 100, dark: false, reduceMotion: false, largeText: false, highContrast: false, clockFormat: "24", examAlarmVolume: 70, ...JSON.parse(window.TeacherStorage.getItem(UI_PREFERENCES_KEY) || "{}") };
    preferences.examAlarmVolume = Math.max(0, Math.min(100, Number(preferences.examAlarmVolume) || 0));
    return preferences;
  } catch {
    return { theme: "sunset", scale: 100, dark: false, reduceMotion: false, largeText: false, highContrast: false, clockFormat: "24", examAlarmVolume: 70 };
  }
}

function saveUIPreferences() {
  window.TeacherStorage.setItem(UI_PREFERENCES_KEY, JSON.stringify(state.ui));
}

function applyUIPreferences() {
  const [first, second] = UI_THEMES[state.ui.theme] || UI_THEMES.sunset;
  document.documentElement.style.setProperty("--scale", (state.ui.scale / 100) * (state.ui.largeText ? 1.15 : 1));
  $("#desktop").style.background = `radial-gradient(circle at 82% 13%, ${second} 0 18%, transparent 42%), linear-gradient(135deg, ${first}, ${second})`;
  document.body.classList.toggle("is-dark", state.ui.dark);
  document.body.classList.toggle("reduce-motion", state.ui.reduceMotion);
  document.body.classList.toggle("high-contrast", state.ui.highContrast);
  document.body.classList.toggle("clock-12", state.ui.clockFormat === "12");
  $("meta[name='theme-color']")?.setAttribute("content", state.ui.dark ? "#172044" : second);
}

function hiddenDockApps() {
  try { return new Set(JSON.parse(window.TeacherStorage.getItem(HIDDEN_DOCK_APPS_KEY) || "[]")); } catch { return new Set(); }
}

function applyDockVisibility() {
  const hidden = hiddenDockApps();
  $$(".dock-item").forEach(item => { item.hidden = hidden.has(item.dataset.app); });
}

function renderAppLibrary() {
  const hidden = hiddenDockApps();
  appLibraryList.innerHTML = Object.entries(APP_LIBRARY).map(([name, description]) => `<article class="library-item"><div><h3>${name}</h3><p>${description}</p></div><div class="library-actions"><button type="button" data-library-open="${name}">開啟</button><button type="button" data-library-toggle="${name}">${hidden.has(name) ? "加入捷徑" : "移除捷徑"}</button></div></article>`).join("");
}

function openAppLibrary() {
  renderAppLibrary();
  appSidebar.hidden = false;
  document.body.classList.add("sidebar-open");
  appLibraryButton.setAttribute("aria-expanded", "true");
}

function closeAppLibrary() {
  appSidebar.hidden = true;
  document.body.classList.remove("sidebar-open");
  appLibraryButton.setAttribute("aria-expanded", "false");
}

function pad(value) { return String(value).padStart(2, "0"); }
function displayClock(date, seconds = false) {
  const hour = state.ui.clockFormat === "12" ? (date.getHours() % 12 || 12) : date.getHours();
  const time = `${pad(hour)}:${pad(date.getMinutes())}${seconds ? `:${pad(date.getSeconds())}` : ""}`;
  return state.ui.clockFormat === "12" ? `${date.getHours() < 12 ? "上午" : "下午"} ${time}` : time;
}

function updateClock() {
  const now = new Date();
  const display = displayClock(now);
  heroTime.textContent = display;
  statusTime.textContent = display;
  digitalTime.textContent = display;
  heroDate.textContent = new Intl.DateTimeFormat("zh-HK", { weekday: "long", month: "long", day: "numeric" }).format(now);
  hourHand.style.transform = `translateX(-50%) rotate(${(now.getHours() % 12) * 30 + now.getMinutes() / 2}deg)`;
  minuteHand.style.transform = `translateX(-50%) rotate(${now.getMinutes() * 6}deg)`;
  secondHand.style.transform = `translateX(-50%) rotate(${now.getSeconds() * 6}deg)`;
  const examDeviceTime = $("#examDeviceTime");
  if (examDeviceTime) examDeviceTime.textContent = formatClock(now);
  const hourlyKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}`;
  if (state.announce && now.getMinutes() === 0 && now.getSeconds() < 2 && sessionStorage.getItem("lastAnnouncement") !== hourlyKey) {
    sessionStorage.setItem("lastAnnouncement", hourlyKey);
    speakTime();
  }
}

function speakTime() {
  if (!("speechSynthesis" in window)) {
    showToast("此瀏覽器暫不支援語音報時");
    return;
  }
  const now = new Date();
  const period = now.getHours() < 12 ? "上午" : now.getHours() < 18 ? "下午" : "晚上";
  const hour = now.getHours() % 12 || 12;
  const minute = now.getMinutes();
  const message = `${period}${hour}時${minute === 0 ? "正" : `${minute}分`}`;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(message);
  utterance.lang = "zh-HK";
  utterance.rate = 0.92;
  speechSynthesis.speak(utterance);
  showToast(`正在報時：${message}`);
}

function updateAnnouncement() {
  announceToggle.classList.toggle("is-on", state.announce);
  announceToggle.setAttribute("aria-pressed", String(state.announce));
  $("span", announceToggle).textContent = `整點報時：${state.announce ? "開" : "關"}`;
}

function buildCalendar() {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth() + state.monthOffset, 1);
  const year = target.getFullYear();
  const month = target.getMonth();
  $("#monthLabel").textContent = `${year}年${month + 1}月`;
  const startDay = target.getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const previousDays = new Date(year, month, 0).getDate();
  const cells = [];
  for (let i = startDay - 1; i >= 0; i--) cells.push({ day: previousDays - i, muted: true });
  for (let day = 1; day <= days; day++) cells.push({ day, muted: false });
  let next = 1;
  while (cells.length < 42) cells.push({ day: next++, muted: true });
  const grid = $("#calendarGrid");
  grid.innerHTML = cells.map(({ day, muted }) => {
    const date = new Date(year, month, day, 12); const info = muted ? null : timetableSchoolDay(date);
    const statusClass = info?.active ? "is-school-day" : info?.closed ? "is-calendar-off" : "";
    const label = info?.active ? timetableCycleLabel(info.day) : info?.closed ? info.reason.replace("公眾假期：", "") : "";
    return `<button type="button" class="${muted ? "is-muted" : ""} ${statusClass} ${!muted && day === now.getDate() && month === now.getMonth() && year === now.getFullYear() ? "is-today" : ""}" data-day="${day}" data-calendar-date="${timetableDateValue(date)}" title="${timetableEscape(label)}" ${muted ? "aria-label=\"相鄰月份\"" : ""}>${day}${label ? `<small>${timetableEscape(label)}</small>` : ""}</button>`;
  }).join("");
  $$("button:not(.is-muted)", grid).forEach(button => button.addEventListener("click", () => {
    $$("button", grid).forEach(item => item.classList.remove("is-today"));
    button.classList.add("is-today");
    const info = timetableSchoolDay(timetableLocalDate(button.dataset.calendarDate));
    $("#selectedEvent").innerHTML = `<span></span> ${button.dataset.day}日：${timetableEscape(info.active ? timetableCycleLabel(info.day) : info.reason)}`;
  }));
}

function timetableTabButton(value, label) { return `<button type="button" class="tt-tab ${timetableTab === value ? "is-active" : ""}" data-tt-action="tab" data-tt-tab="${value}">${label}</button>`; }
function timetableTodayView() {
  const now = new Date(); const info = timetableSchoolDay(now); const lessons = timetableLessonsFor(now);
  return `<section class="timetable-tool"><div class="tt-intro"><p>今日課堂</p><h3>${timetableEscape(timetable.setup.termName)}</h3><span>${timetableEscape(timetable.selectedClass)} · ${timetableEscape(info.active ? timetableCycleLabel(info.day) : info.reason)}</span></div><div class="tt-today-list">${info.active ? (lessons.length ? lessons.map(item => `<article><time>${item.period.start}–${item.period.end}</time><div><strong>${timetableEscape(item.entry.subject)}</strong><small>${timetableEscape(item.entry.room || "")}</small></div></article>`).join("") : "<p>今天尚未安排課堂。</p>") : `<p>${timetableEscape(info.reason)}，不會顯示班別課堂。</p>`}</div></section>`;
}
function timetableSetupView() {
  const exceptions = timetable.exceptions.length ? timetable.exceptions.map((entry, index) => `<div class="tt-exception" data-tt-exception="${index}"><input type="date" data-tt-field="start" value="${entry.start}"><input type="date" data-tt-field="end" value="${entry.end || ""}" aria-label="結束日期"><input data-tt-field="note" value="${timetableEscape(entry.note || "")}" placeholder="備註"><button type="button" data-tt-action="remove-exception">移除</button></div>`).join("") : "<p class=\"tt-empty\">尚未加入不適用日期。</p>";
  return `<section class="timetable-tool"><div class="tt-form-grid"><label>學期名稱<input id="ttTermName" value="${timetableEscape(timetable.setup.termName)}"></label><label>循環周開始日<input id="ttCycleStart" type="date" value="${timetable.setup.cycleStart}"></label><label>循環周結束日<input id="ttCycleEnd" type="date" value="${timetable.setup.cycleEnd}"></label><label>循環日數<select id="ttCycleLength">${[5, 6].map(value => `<option value="${value}" ${Number(timetable.setup.cycleLength) === value ? "selected" : ""}>${value} 日</option>`).join("")}</select></label></div><div class="tt-section-heading"><div><h3>不適用日期</h3><p>填寫開始日；結束日留空即為單日。</p></div><button type="button" class="secondary-action" data-tt-action="add-exception">加入日期</button></div><div id="ttExceptionList">${exceptions}</div><div class="demo-actions"><button type="button" class="primary-action" data-tt-action="save-setup">儲存校曆設定</button></div></section>`;
}
function timetableScheduleView() {
  const classOptions = timetable.classes.map(name => `<option value="${timetableEscape(name)}" ${name === timetable.selectedClass ? "selected" : ""}>${timetableEscape(name)}</option>`).join("");
  const cell = (section, day, period) => { const entry = timetable.lessons[timetable.selectedClass]?.[`${section}-${day}-${period}`] || {}; return `<td><input data-tt-slot="${section}-${day}-${period}" data-tt-slot-field="subject" placeholder="科目" value="${timetableEscape(entry.subject || "")}"><input data-tt-slot-field="room" placeholder="課室／備註" value="${timetableEscape(entry.room || "")}"></td>`; };
  const morningRows = timetable.morningPeriods.map((period, periodIndex) => `<tr><th>${timetableEscape(period.name)}<small>${period.start}–${period.end}</small></th>${Array.from({ length: Number(timetable.setup.cycleLength) }, (_, day) => cell("morning", day + 1, periodIndex)).join("")}</tr>`).join("");
  const afternoonRows = timetable.afternoonPeriods.map((period, periodIndex) => `<tr><th>${timetableEscape(period.name)}<small>${period.start}–${period.end}</small></th>${[0, 1, 2, 3, 4].map(day => cell("afternoon", day, periodIndex)).join("")}</tr>`).join("");
  return `<section class="timetable-tool"><div class="tt-class-row"><label>班別<select id="ttClassSelect">${classOptions}</select></label><button type="button" class="secondary-action" data-tt-action="add-class">新增班別</button><button type="button" class="primary-action" data-tt-action="save-lessons">儲存課表</button></div><h3>上午：循環日課表</h3><div class="tt-table-wrap"><table class="tt-grid"><thead><tr><th>節次</th>${Array.from({ length: Number(timetable.setup.cycleLength) }, (_, day) => `<th>${timetableCycleLabel(day + 1)}</th>`).join("")}</tr></thead><tbody>${morningRows}</tbody></table></div><h3>下午：星期課表</h3><div class="tt-table-wrap"><table class="tt-grid"><thead><tr><th>節次</th>${["星期一", "星期二", "星期三", "星期四", "星期五"].map(day => `<th>${day}</th>`).join("")}</tr></thead><tbody>${afternoonRows}</tbody></table></div></section>`;
}
function timetableImportView() { return `<section class="timetable-tool"><div class="tt-import-card"><h3>時間表照片／PDF 匯入</h3><p>上載來源後，將辨認結果貼入 JSON，系統會按班別、上午 Day A–F 及下午星期欄位匯入。</p><label class="secondary-action">選擇圖片或 PDF<input id="ttSourceInput" type="file" accept="image/*,application/pdf" hidden></label><span id="ttSourceStatus" class="tt-source-status"></span><label>辨認結果（JSON）<textarea id="ttRecognition" rows="8" placeholder='[{"section":"morning","day":"Day A","period":"第 1 節","subject":"中文","room":"201"}]'></textarea></label><div class="demo-actions"><button type="button" class="primary-action" data-tt-action="apply-recognition">確認匯入</button></div></div></section>`; }
function renderTimetableTool() {
  const views = { today: timetableTodayView, setup: timetableSetupView, schedule: timetableScheduleView, import: timetableImportView };
  dialogBody.innerHTML = `<div class="tt-tabs">${timetableTabButton("today", "今日課堂")}${timetableTabButton("setup", "校曆資料")}${timetableTabButton("schedule", "班別時間表")}${timetableTabButton("import", "時間表匯入")}</div>${views[timetableTab]()}`;
}
function saveTimetableSetup() {
  timetable.setup = { termName: $("#ttTermName").value.trim() || "未命名學期", cycleStart: $("#ttCycleStart").value, cycleEnd: $("#ttCycleEnd").value, cycleLength: Number($("#ttCycleLength").value) };
  timetable.exceptions = $$("[data-tt-exception]").map(row => ({ start: $("[data-tt-field=\"start\"]", row).value, end: $("[data-tt-field=\"end\"]", row).value, note: $("[data-tt-field=\"note\"]", row).value.trim(), source: "手動" })).filter(entry => entry.start && (!entry.end || entry.end >= entry.start));
  saveTimetable(); renderTimetableTool(); buildCalendar(); renderDashboardSchedule(); showToast("校曆設定已儲存");
}
function saveTimetableLessons() {
  const className = $("#ttClassSelect").value; timetable.lessons[className] = {};
  $$('[data-tt-slot]').forEach(input => { if (input.dataset.ttSlotField !== "subject") return; const key = input.dataset.ttSlot; const room = $(`[data-tt-slot="${key}"][data-tt-slot-field="room"]`).value.trim(); const subject = input.value.trim(); if (subject || room) timetable.lessons[className][key] = { subject, room }; });
  saveTimetable(); renderDashboardSchedule(); showToast(`${className} 課表已儲存`);
}
function applyTimetableRecognition() {
  try {
    const rows = JSON.parse($("#ttRecognition").value); if (!Array.isArray(rows)) throw new Error(); const className = timetable.selectedClass; timetable.lessons[className] ||= {};
    let count = 0; rows.forEach(row => { const afternoon = /afternoon|week|下午|星期/i.test(String(row.section || row.day || "")); const period = Number(String(row.period || "").match(/\d+/)?.[0]) - (afternoon ? 7 : 1); const dayText = String(row.day || row.weekday || ""); const cycleLetter = dayText.match(/DAY\s*([A-F])/i)?.[1] || dayText.match(/^\s*([A-F])\s*$/i)?.[1]; const day = afternoon ? ["一", "二", "三", "四", "五"].findIndex(value => dayText.includes(value)) : (cycleLetter ? cycleLetter.toUpperCase().charCodeAt(0) - 64 : NaN); if (period < 0 || !Number.isInteger(day) || day < 0 || !row.subject) return; timetable.lessons[className][`${afternoon ? "afternoon" : "morning"}-${day}-${period}`] = { subject: String(row.subject), room: String(row.room || "") }; count += 1; });
    if (!count) throw new Error(); saveTimetable(); renderDashboardSchedule(); showToast(`已匯入 ${count} 節課`);
  } catch { showToast("無法讀取辨認結果，請核對 JSON 欄位"); }
}

const descriptions = {
  "班別管理": ["管理班別與學生名單", "建立並管理班別及學生資料。"],
  "計時工具": ["計時工具", "可選擇考試時間顯示或獨立倒數計時。"],
  "電子白板": ["電子白板", "此處將提供筆、擦膠、顏色與連結計時器等白板工具。"],
  "功課紙": ["空白功課紙", "選擇範本後，可快速加入班別、姓名及日期簿頭。"],
  "快問快答": ["快問快答", "以快速題目及全班作答模式開始小遊戲。"],
  "乘法寶藏": ["乘法寶藏爭奪戰", "答對 1–10 乘法題，打開寶藏地圖格子並與另一隊競賽。"],
  "上課時間表": ["上課時間表", "查看全日課堂並標記目前及下一節課。"],
};

function genericDemo(name) {
  const [title, copy] = descriptions[name] || [name, "這是功能的互動介面示範。"];
  return `<div class="demo-card"><h3>${title}</h3><p>${copy}</p><div class="demo-actions"><button class="primary-action" data-demo-action="start">開始示範</button><button class="secondary-action" data-demo-action="close">返回桌面</button></div></div>`;
}

function createWhiteboardRecord(index = 1) {
  const homework = state.whiteboard.mode === "homework";
  return {
    id: `${homework ? "paper" : "wb"}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: `${homework ? "功課紙" : "白板"} ${index}`,
    background: homework ? "gridFine" : "paper",
    image: "",
    view: homework ? { scale: 1, x: 0, y: 0 } : null,
    updatedAt: Date.now(),
  };
}

function whiteboardStorageKey() {
  return WHITEBOARD_STORAGE_KEYS[state.whiteboard.mode];
}

function loadWhiteboardRecords() {
  const storageKey = whiteboardStorageKey();
  try {
    const saved = JSON.parse(window.TeacherStorage.getItem(storageKey));
    if (Array.isArray(saved?.boards) && saved.boards.length) {
      state.whiteboard.boards = saved.boards;
      state.whiteboard.activeId = saved.activeId && saved.boards.some(board => board.id === saved.activeId) ? saved.activeId : saved.boards[0].id;
      return;
    }
  } catch {
    window.TeacherStorage.removeItem(storageKey);
  }
  const board = createWhiteboardRecord();
  state.whiteboard.boards = [board];
  state.whiteboard.activeId = board.id;
}

function activeWhiteboard() {
  return state.whiteboard.boards.find(board => board.id === state.whiteboard.activeId);
}

function isHomeworkPaper() {
  return state.whiteboard.mode === "homework";
}

function paperView() {
  const board = activeWhiteboard();
  if (!board) return { scale: 1, x: 0, y: 0 };
  if (!board.view || !Number.isFinite(board.view.scale)) board.view = { scale: 1, x: 0, y: 0 };
  return board.view;
}

function updatePaperView() {
  if (!isHomeworkPaper()) return;
  const view = paperView();
  wbCanvasWrap.style.setProperty("--paper-scale", String(view.scale));
  wbCanvasWrap.style.setProperty("--paper-x", `${view.x}px`);
  wbCanvasWrap.style.setProperty("--paper-y", `${view.y}px`);
  const zoom = $("#wbPaperZoom");
  if (zoom) zoom.textContent = `${Math.round(view.scale * 100)}%`;
}

function changePaperZoom(amount) {
  if (!isHomeworkPaper()) return;
  const view = paperView();
  view.scale = Math.min(2.5, Math.max(.55, Math.round((view.scale + amount) * 100) / 100));
  updatePaperView();
  persistWhiteboardRecords();
}

function resetPaperView() {
  if (!isHomeworkPaper()) return;
  const view = paperView();
  view.scale = 1;
  view.x = 0;
  view.y = 0;
  updatePaperView();
  persistWhiteboardRecords();
}

function persistWhiteboardRecords() {
  try {
    window.TeacherStorage.setItem(whiteboardStorageKey(), JSON.stringify({ boards: state.whiteboard.boards, activeId: state.whiteboard.activeId }));
  } catch {
    showToast(`${state.whiteboard.mode === "homework" ? "功課紙" : "白板"}內容過大，未能再儲存到此裝置`);
  }
}

function whiteboardSnapshot() {
  const canvas = state.whiteboard.canvas;
  if (!canvas) return "";
  const maximumWidth = 1600;
  const scale = Math.min(1, maximumWidth / canvas.width);
  if (scale === 1) return canvas.toDataURL("image/png");
  const copy = document.createElement("canvas");
  copy.width = Math.round(canvas.width * scale);
  copy.height = Math.round(canvas.height * scale);
  copy.getContext("2d").drawImage(canvas, 0, 0, copy.width, copy.height);
  return copy.toDataURL("image/png");
}

function saveActiveWhiteboard() {
  const board = activeWhiteboard();
  if (!board || !state.whiteboard.canvas) return;
  board.image = whiteboardSnapshot();
  board.updatedAt = Date.now();
  persistWhiteboardRecords();
  renderWhiteboardBoards();
}

function scheduleWhiteboardSave() {
  clearTimeout(state.whiteboard.saveTimer);
  state.whiteboard.saveTimer = setTimeout(saveActiveWhiteboard, 650);
}

function setupWhiteboardContext() {
  const context = state.whiteboard.context;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.imageSmoothingEnabled = true;
}

function resizeWhiteboardCanvas() {
  if (whiteboard.hidden) return;
  const oldCanvas = state.whiteboard.canvas;
  const previous = oldCanvas?.width ? document.createElement("canvas") : null;
  if (previous) {
    previous.width = oldCanvas.width;
    previous.height = oldCanvas.height;
    previous.getContext("2d").drawImage(oldCanvas, 0, 0);
  }
  const rect = { width: wbCanvasWrap.offsetWidth, height: wbCanvasWrap.offsetHeight };
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  wbCanvas.width = Math.max(1, Math.round(rect.width * ratio));
  wbCanvas.height = Math.max(1, Math.round(rect.height * ratio));
  state.whiteboard.canvas = wbCanvas;
  state.whiteboard.context = wbCanvas.getContext("2d");
  setupWhiteboardContext();
  if (previous) state.whiteboard.context.drawImage(previous, 0, 0, previous.width, previous.height, 0, 0, wbCanvas.width, wbCanvas.height);
}

function applyWhiteboardBackground() {
  const board = activeWhiteboard();
  if (!board) return;
  const homeworkBackground = HOMEWORK_BACKGROUNDS[board.background];
  wbCanvasWrap.classList.toggle("wb-chalk", board.background === "chalk");
  wbCanvasWrap.classList.toggle("wb-paper", !homeworkBackground && board.background !== "chalk");
  wbCanvasWrap.classList.toggle("wb-template", Boolean(homeworkBackground));
  wbCanvasWrap.style.backgroundImage = homeworkBackground ? `url("${homeworkBackground.asset}")` : "";
  if (homeworkBackground) wbCanvasWrap.style.setProperty("--paper-ratio", homeworkBackground.ratio);
  else wbCanvasWrap.style.removeProperty("--paper-ratio");
  updatePaperView();
  $("#wbBoardIndicator").textContent = board.title;
}

function resetWhiteboardHistory() {
  state.whiteboard.history = [wbCanvas.toDataURL("image/png")];
  state.whiteboard.redo = [];
}

function loadWhiteboardImage(source) {
  const context = state.whiteboard.context;
  context.clearRect(0, 0, wbCanvas.width, wbCanvas.height);
  if (!source) {
    resetWhiteboardHistory();
    return;
  }
  const image = new Image();
  const boardId = state.whiteboard.activeId;
  image.onload = () => {
    if (boardId !== state.whiteboard.activeId) return;
    context.clearRect(0, 0, wbCanvas.width, wbCanvas.height);
    context.drawImage(image, 0, 0, image.width, image.height, 0, 0, wbCanvas.width, wbCanvas.height);
    resetWhiteboardHistory();
  };
  image.src = source;
}

function rememberWhiteboardState() {
  const history = state.whiteboard.history;
  history.push(wbCanvas.toDataURL("image/png"));
  if (history.length > 16) history.shift();
  state.whiteboard.redo = [];
}

function restoreWhiteboardState(source) {
  const image = new Image();
  image.onload = () => {
    state.whiteboard.context.clearRect(0, 0, wbCanvas.width, wbCanvas.height);
    state.whiteboard.context.drawImage(image, 0, 0, image.width, image.height, 0, 0, wbCanvas.width, wbCanvas.height);
    scheduleWhiteboardSave();
  };
  image.src = source;
}

function undoWhiteboard() {
  if (!state.whiteboard.history.length) return;
  state.whiteboard.redo.push(wbCanvas.toDataURL("image/png"));
  restoreWhiteboardState(state.whiteboard.history.pop());
}

function redoWhiteboard() {
  if (!state.whiteboard.redo.length) return;
  state.whiteboard.history.push(wbCanvas.toDataURL("image/png"));
  restoreWhiteboardState(state.whiteboard.redo.pop());
}

function canvasPoint(event) {
  const rect = wbCanvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * (wbCanvas.width / rect.width), y: (event.clientY - rect.top) * (wbCanvas.height / rect.height) };
}

function drawWhiteboardSegment(from, to, event) {
  const { context, tool, size, color } = state.whiteboard;
  const pressure = event.pointerType === "pen" && event.pressure ? 0.45 + event.pressure * 0.55 : 1;
  context.save();
  context.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
  context.globalAlpha = tool === "highlighter" ? 0.34 : 1;
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = size * (window.devicePixelRatio || 1) * pressure * (tool === "eraser" ? 3.2 : 1);
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.stroke();
  context.restore();
}

function beginWhiteboardStroke(event) {
  if (event.pointerType === "touch" && Date.now() - state.whiteboard.penSeenAt < 800) return;
  if (event.pointerType === "pen") state.whiteboard.penSeenAt = Date.now();
  if ((state.whiteboard.drawing || state.whiteboard.panning) || event.button > 0) return;
  event.preventDefault();
  if (isHomeworkPaper() && state.whiteboard.tool === "move") {
    const view = paperView();
    state.whiteboard.panning = true;
    state.whiteboard.pointerId = event.pointerId;
    state.whiteboard.panStart = { clientX: event.clientX, clientY: event.clientY, x: view.x, y: view.y };
    wbCanvas.setPointerCapture?.(event.pointerId);
    return;
  }
  rememberWhiteboardState();
  state.whiteboard.drawing = true;
  state.whiteboard.pointerId = event.pointerId;
  state.whiteboard.previousPoint = canvasPoint(event);
  wbCanvas.setPointerCapture?.(event.pointerId);
  if (state.whiteboard.tool === "line") {
    const base = document.createElement("canvas");
    base.width = wbCanvas.width;
    base.height = wbCanvas.height;
    base.getContext("2d").drawImage(wbCanvas, 0, 0);
    state.whiteboard.lineStart = state.whiteboard.previousPoint;
    state.whiteboard.lineBase = base;
    return;
  }
  drawWhiteboardSegment(state.whiteboard.previousPoint, { x: state.whiteboard.previousPoint.x + .01, y: state.whiteboard.previousPoint.y + .01 }, event);
}

function continueWhiteboardStroke(event) {
  if (state.whiteboard.panning && event.pointerId === state.whiteboard.pointerId) {
    event.preventDefault();
    const view = paperView();
    view.x = state.whiteboard.panStart.x + event.clientX - state.whiteboard.panStart.clientX;
    view.y = state.whiteboard.panStart.y + event.clientY - state.whiteboard.panStart.clientY;
    updatePaperView();
    return;
  }
  if (!state.whiteboard.drawing || event.pointerId !== state.whiteboard.pointerId) return;
  event.preventDefault();
  if (state.whiteboard.tool === "line" && state.whiteboard.lineBase) {
    const point = canvasPoint(event);
    state.whiteboard.context.clearRect(0, 0, wbCanvas.width, wbCanvas.height);
    state.whiteboard.context.drawImage(state.whiteboard.lineBase, 0, 0);
    drawWhiteboardSegment(state.whiteboard.lineStart, point, event);
    state.whiteboard.previousPoint = point;
    return;
  }
  const events = event.getCoalescedEvents ? event.getCoalescedEvents() : [event];
  events.forEach(move => {
    const point = canvasPoint(move);
    drawWhiteboardSegment(state.whiteboard.previousPoint, point, move);
    state.whiteboard.previousPoint = point;
  });
}

function endWhiteboardStroke(event) {
  if (state.whiteboard.panning && (!event || event.pointerId === state.whiteboard.pointerId)) {
    state.whiteboard.panning = false;
    state.whiteboard.pointerId = null;
    state.whiteboard.panStart = null;
    persistWhiteboardRecords();
    return;
  }
  if (!state.whiteboard.drawing || (event && event.pointerId !== state.whiteboard.pointerId)) return;
  state.whiteboard.drawing = false;
  state.whiteboard.pointerId = null;
  state.whiteboard.previousPoint = null;
  state.whiteboard.lineStart = null;
  state.whiteboard.lineBase = null;
  scheduleWhiteboardSave();
}

function setWhiteboardTool(tool) {
  state.whiteboard.tool = tool;
  $$("[data-wb-tool]").forEach(button => {
    const active = button.dataset.wbTool === tool;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  wbCanvas.style.cursor = tool === "eraser" ? "cell" : tool === "move" ? "grab" : "crosshair";
}

function setWhiteboardColor(color) {
  state.whiteboard.color = color;
  if (state.whiteboard.tool === "eraser") setWhiteboardTool("pen");
  $$("[data-wb-color]").forEach(button => button.classList.toggle("is-active", button.dataset.wbColor === color));
}

function renderWhiteboardBoards() {
  const list = $("#wbBoardsList");
  if (!list) return;
  list.innerHTML = state.whiteboard.boards.map(board => `<button class="wb-board-entry ${board.id === state.whiteboard.activeId ? "is-active" : ""}" type="button" data-wb-board="${board.id}"><span>${escapeHTML(board.title)}<small>${new Intl.DateTimeFormat("zh-HK", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(board.updatedAt || Date.now()))}</small></span><i class="${board.background === "chalk" ? "chalk" : HOMEWORK_BACKGROUNDS[board.background] ? "template" : ""}"></i></button>`).join("");
}

function renderWhiteboardBackgroundMenu() {
  const menu = $("#wbBackgroundMenu");
  const homework = state.whiteboard.mode === "homework";
  menu.setAttribute("aria-label", homework ? "功課紙背景" : "白板背景");
  menu.innerHTML = homework
    ? `<p>選擇功課紙</p>${Object.entries(HOMEWORK_BACKGROUNDS).map(([id, background]) => `<button type="button" data-wb-background="${id}"><i class="bg-sample template" style="background-image:url('${background.asset}')"></i>${background.label}</button>`).join("")}`
    : `<p>選擇背景</p><button type="button" data-wb-background="paper"><i class="bg-sample paper"></i>純白</button><button type="button" data-wb-background="chalk"><i class="bg-sample chalk"></i>仿課室黑板</button>`;
  $("#wbBoardsMenu").setAttribute("aria-label", homework ? "功課紙列表" : "白板列表");
  $("#wbBoardsMenu .wb-popover-title p").textContent = homework ? "我的功課紙" : "我的白板";
  $("#wbBoardsMenu [data-wb-action=\"new-board\"]").textContent = homework ? "＋ 建立新功課紙" : "＋ 建立新白板";
}

function selectWhiteboard(id) {
  if (id === state.whiteboard.activeId) return;
  saveActiveWhiteboard();
  state.whiteboard.activeId = id;
  const board = activeWhiteboard();
  applyWhiteboardBackground();
  loadWhiteboardImage(board.image);
  persistWhiteboardRecords();
  renderWhiteboardBoards();
  $("#wbBoardsMenu").hidden = true;
}

function newWhiteboard() {
  saveActiveWhiteboard();
  const board = createWhiteboardRecord(state.whiteboard.boards.length + 1);
  state.whiteboard.boards.push(board);
  state.whiteboard.activeId = board.id;
  applyWhiteboardBackground();
  state.whiteboard.context.clearRect(0, 0, wbCanvas.width, wbCanvas.height);
  resetWhiteboardHistory();
  persistWhiteboardRecords();
  renderWhiteboardBoards();
  $("#wbBoardsMenu").hidden = true;
  showToast(`${board.title} 已建立`);
}

function setWhiteboardBackground(background) {
  const board = activeWhiteboard();
  if (!board) return;
  board.background = background;
  applyWhiteboardBackground();
  persistWhiteboardRecords();
  renderWhiteboardBoards();
  $("#wbBackgroundMenu").hidden = true;
}

function clearWhiteboard() {
  const name = state.whiteboard.mode === "homework" ? "功課紙" : "白板";
  $("#wbClearConfirmTitle").textContent = `清除這張${name}的所有筆跡？`;
  $("#wbClearConfirm").hidden = false;
  $("[data-wb-action='confirm-clear']").focus();
}

function cancelClearWhiteboard() {
  $("#wbClearConfirm").hidden = true;
}

function confirmClearWhiteboard() {
  cancelClearWhiteboard();
  rememberWhiteboardState();
  state.whiteboard.context.clearRect(0, 0, wbCanvas.width, wbCanvas.height);
  scheduleWhiteboardSave();
}

function loadExportBackground(asset) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = asset;
  });
}

async function exportWhiteboardPNG() {
  const output = document.createElement("canvas");
  output.width = wbCanvas.width;
  output.height = wbCanvas.height;
  const context = output.getContext("2d");
  const board = activeWhiteboard();
  const template = HOMEWORK_BACKGROUNDS[board?.background];
  if (template) {
    try {
      const image = await loadExportBackground(template.asset);
      context.drawImage(image, 0, 0, output.width, output.height);
    } catch {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, output.width, output.height);
    }
  } else {
    context.fillStyle = board?.background === "chalk" ? "#153d38" : "#ffffff";
    context.fillRect(0, 0, output.width, output.height);
  }
  context.drawImage(wbCanvas, 0, 0);
  const link = document.createElement("a");
  link.href = output.toDataURL("image/png");
  link.download = `${board?.title || "白板"}.png`;
  link.click();
  showToast("已匯出 PNG 圖片");
}

function formatWhiteboardTimer(seconds) {
  return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
}

function updateWhiteboardTimer() {
  const timer = state.whiteboard;
  if (timer.timerEnd) timer.timerSeconds = Math.max(0, Math.ceil((timer.timerEnd - Date.now()) / 1000));
  $("#wbTimerDisplay").textContent = formatWhiteboardTimer(timer.timerSeconds);
  if (timer.timerEnd && timer.timerSeconds > 0) {
    timer.timerId = setTimeout(updateWhiteboardTimer, 250);
  } else if (timer.timerEnd) {
    timer.timerEnd = null;
    timer.timerId = null;
    ringWhiteboardTimer();
    showToast("計時完成");
  }
}

function ringWhiteboardTimer() {
  try {
    const audio = new (window.AudioContext || window.webkitAudioContext)();
    [0, .22, .44].forEach(delay => {
      const tone = audio.createOscillator();
      const gain = audio.createGain();
      tone.frequency.value = 880;
      gain.gain.setValueAtTime(.05, audio.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + delay + .16);
      tone.connect(gain).connect(audio.destination);
      tone.start(audio.currentTime + delay);
      tone.stop(audio.currentTime + delay + .17);
    });
  } catch { /* visual alert still appears */ }
}

function startWhiteboardTimer() {
  clearTimeout(state.whiteboard.timerId);
  if (!state.whiteboard.timerSeconds) {
    state.whiteboard.timerSeconds = Math.max(0, Number($("#wbTimerMinutes").value || 0) * 60 + Number($("#wbTimerSeconds").value || 0));
  }
  if (!state.whiteboard.timerSeconds) return showToast("請先設定計時時間");
  state.whiteboard.timerEnd = Date.now() + state.whiteboard.timerSeconds * 1000;
  updateWhiteboardTimer();
}

function pauseWhiteboardTimer() {
  if (!state.whiteboard.timerEnd) return;
  state.whiteboard.timerSeconds = Math.max(0, Math.ceil((state.whiteboard.timerEnd - Date.now()) / 1000));
  state.whiteboard.timerEnd = null;
  clearTimeout(state.whiteboard.timerId);
  state.whiteboard.timerId = null;
  updateWhiteboardTimer();
}

function resetWhiteboardTimer() {
  pauseWhiteboardTimer();
  state.whiteboard.timerSeconds = Math.max(0, Number($("#wbTimerMinutes").value || 0) * 60 + Number($("#wbTimerSeconds").value || 0));
  updateWhiteboardTimer();
}

async function toggleWhiteboardFullscreen() {
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    else if (document.exitFullscreen) await document.exitFullscreen();
  } catch { showToast("此瀏覽器暫不支援原生全螢幕"); }
}

async function enterWhiteboardFullscreen() {
  if (document.fullscreenElement || !document.documentElement.requestFullscreen) return;
  try { await document.documentElement.requestFullscreen(); } catch { /* page-filling whiteboard remains available */ }
}

function positionWhiteboardFloat(element, left, top) {
  const toolbarTop = wbToolbar.getBoundingClientRect().top;
  const maxLeft = Math.max(10, window.innerWidth - element.offsetWidth - 10);
  const maxTop = Math.max(10, toolbarTop - element.offsetHeight - 12);
  element.style.left = `${Math.min(maxLeft, Math.max(10, left))}px`;
  element.style.top = `${Math.min(maxTop, Math.max(10, top))}px`;
  element.style.right = "auto";
  element.style.bottom = "auto";
}

function layoutWhiteboardControls() {
  if (whiteboard.hidden) return;
  if (window.matchMedia("(min-width: 701px) and (max-width: 1750px)").matches) {
    wbToolbar.style.setProperty("--wb-toolbar-scale", String(Math.min(1, (window.innerWidth - 24) / wbToolbar.offsetWidth)));
  } else {
    wbToolbar.style.removeProperty("--wb-toolbar-scale");
  }
  for (const element of [wbLeftActions, wbTimer]) {
    if (!element.style.left) continue;
    const rect = element.getBoundingClientRect();
    positionWhiteboardFloat(element, rect.left, rect.top);
  }
}

function makeWhiteboardControlDraggable(handle, element) {
  let pointer = null;
  let suppressClick = false;
  handle.addEventListener("pointerdown", event => {
    if (event.button !== 0 || whiteboard.hidden) return;
    suppressClick = false;
    const rect = element.getBoundingClientRect();
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener("pointermove", event => {
    if (!pointer || event.pointerId !== pointer.id) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    if (!pointer.moved && Math.hypot(dx, dy) < 6) return;
    pointer.moved = true;
    handle.classList.add("is-dragging");
    event.preventDefault();
    positionWhiteboardFloat(element, pointer.left + dx, pointer.top + dy);
  });
  const finish = event => {
    if (!pointer || event.pointerId !== pointer.id) return;
    if (pointer.moved) {
      suppressClick = true;
    }
    pointer = null;
    handle.classList.remove("is-dragging");
  };
  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);
  handle.addEventListener("click", event => {
    if (!suppressClick) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    suppressClick = false;
  }, true);
}

function closeWhiteboard() {
  if (whiteboard.hidden) return;
  saveActiveWhiteboard();
  whiteboard.hidden = true;
  document.body.classList.remove("is-whiteboard");
  clearTimeout(state.whiteboard.timerId);
  state.whiteboard.timerId = null;
  state.whiteboard.timerEnd = null;
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  $$(".dock-item").forEach(item => item.classList.toggle("active", item.dataset.action === "home"));
}

function openWhiteboard(mode = "board") {
  if (state.whiteboard.mode !== mode) {
    state.whiteboard.mode = mode;
    state.whiteboard.boards = [];
    state.whiteboard.activeId = null;
  }
  if (!state.whiteboard.boards.length) loadWhiteboardRecords();
  if (mode === "board" && state.whiteboard.tool === "move") setWhiteboardTool("pen");
  if (dialog.open) dialog.close();
  whiteboard.hidden = false;
  whiteboard.classList.toggle("is-homework-paper", mode === "homework");
  whiteboard.setAttribute("aria-label", mode === "homework" ? "功課紙" : "電子白板");
  wbCanvas.setAttribute("aria-label", mode === "homework" ? "功課紙書寫畫布" : "電子白板書寫畫布");
  renderWhiteboardBackgroundMenu();
  document.body.classList.add("is-whiteboard");
  enterWhiteboardFullscreen();
  requestAnimationFrame(() => {
    layoutWhiteboardControls();
    resizeWhiteboardCanvas();
    applyWhiteboardBackground();
    loadWhiteboardImage(activeWhiteboard()?.image || "");
    renderWhiteboardBoards();
    updateWhiteboardTimer();
  });
  $$(".dock-item").forEach(item => item.classList.toggle("active", item.dataset.app === (mode === "homework" ? "功課紙" : "電子白板")));
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
}

function localDateValue(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatFullDate(date) {
  return new Intl.DateTimeFormat("zh-HK", { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(date);
}

function formatClock(date) {
  return displayClock(date, true);
}

function parseLocalDateTime(dateValue, timeValue) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hours, minutes] = timeValue.split(":").map(Number);
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

function savedExamSettings() {
  const defaults = { subject: "", examDate: localDateValue(), startTime: "09:00", endTime: "10:30" };
  try {
    const saved = JSON.parse(window.TeacherStorage.getItem(EXAM_SETTINGS_KEY));
    if (!saved) return defaults;
    return { ...defaults, ...saved };
  } catch {
    window.TeacherStorage.removeItem(EXAM_SETTINGS_KEY);
    return defaults;
  }
}

function stopExamTimer() {
  if (state.exam.timerId) clearTimeout(state.exam.timerId);
  state.exam.timerId = null;
}

function primeExamAlarmAudio() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  try {
    const context = state.exam.alarmContext ||= new AudioContextClass();
    context.resume().catch(() => {});
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    gain.gain.value = 0;
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + .02);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  } catch { /* The visible end-time notice remains available if audio is blocked. */ }
}

function playExamAlarmPulse() {
  const context = state.exam.alarmContext;
  const volume = Math.max(0, Math.min(100, Number(state.ui.examAlarmVolume) || 0));
  if (!state.exam.alarmActive || !context || !volume) return;
  if (context.state !== "running") {
    context.resume().catch(() => {});
    return;
  }
  const now = context.currentTime;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sawtooth";
  oscillator.frequency.setValueAtTime(720, now);
  oscillator.frequency.setValueAtTime(880, now + .48);
  oscillator.frequency.setValueAtTime(720, now + .96);
  const level = Math.pow(volume / 100, 1.4) * .13;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(level, now + .05);
  gain.gain.setValueAtTime(level, now + 1.42);
  gain.gain.linearRampToValueAtTime(0, now + 1.52);
  oscillator.connect(gain).connect(context.destination);
  const node = { oscillator, gain };
  state.exam.alarmNodes.add(node);
  oscillator.onended = () => {
    state.exam.alarmNodes.delete(node);
    oscillator.disconnect();
    gain.disconnect();
  };
  oscillator.start(now);
  oscillator.stop(now + 1.54);
}

function stopExamAlarm() {
  clearInterval(state.exam.alarmInterval);
  state.exam.alarmInterval = null;
  state.exam.alarmActive = false;
  state.exam.alarmPreview = false;
  const now = state.exam.alarmContext?.currentTime || 0;
  for (const { oscillator, gain } of state.exam.alarmNodes) {
    gain.gain.cancelScheduledValues(now);
    gain.gain.setTargetAtTime(0, now, .01);
    try { oscillator.stop(now + .05); } catch { /* The pulse may have ended already. */ }
  }
  const previewButton = $("[data-ui-action='preview-alarm']");
  if (previewButton) previewButton.textContent = "試聽鬧鐘";
}

function startExamAlarm(preview = false) {
  if (state.exam.alarmActive) stopExamAlarm();
  state.exam.alarmActive = true;
  state.exam.alarmPreview = preview;
  if (state.exam.alarmContext && Number(state.ui.examAlarmVolume) > 0) {
    playExamAlarmPulse();
    state.exam.alarmInterval = setInterval(playExamAlarmPulse, 1700);
  }
  const previewButton = $("[data-ui-action='preview-alarm']");
  if (previewButton && preview) previewButton.textContent = "停止試聽";
}

function releaseWakeLock() {
  if (state.exam.wakeLock) state.exam.wakeLock.release().catch(() => {});
  state.exam.wakeLock = null;
}

async function requestExamWakeLock() {
  if (!("wakeLock" in navigator) || state.exam.wakeLock) return;
  try { state.exam.wakeLock = await navigator.wakeLock.request("screen"); } catch { state.exam.wakeLock = null; }
}

function renderExamForm(settings = savedExamSettings(), error = "") {
  stopExamTimer();
  stopExamAlarm();
  state.exam.schedule = null;
  releaseWakeLock();
  const offset = -new Date().getTimezoneOffset() / 60;
  const zoneWarning = offset === 8 ? "" : `<p class="exam-timezone-warning">目前裝置時區為 UTC${offset >= 0 ? "+" : "−"}${Math.abs(offset)}，請先核對是否為香港時間（UTC+8）。</p>`;
  dialogBody.innerHTML = `<section class="exam-tool" aria-labelledby="examSetupTitle">
    <button type="button" class="timer-back" data-timer-hub="home">‹ 返回計時工具</button>
    <div class="exam-intro"><div><p class="exam-kicker">考試時間顯示器</p><h3 id="examSetupTitle">設定考試時間</h3><p>顯示會讀取此裝置的本機時間；結束時鬧鐘會持續響至手動停止。</p></div><strong class="exam-device-time" id="examDeviceTime">${formatClock(new Date())}</strong></div>
    ${zoneWarning}
    <form class="exam-settings-form" id="examSettingsForm" novalidate>
      <label class="exam-field exam-field-wide"><span>科目</span><input id="examSubject" maxlength="40" autocomplete="off" placeholder="例如：中文科" value="${escapeHTML(settings.subject)}" required></label>
      <label class="exam-field exam-field-wide"><span>考試日期</span><input id="examDate" type="date" value="${escapeHTML(settings.examDate)}" required></label>
      <label class="exam-field"><span>開始時間</span><input id="examStartTime" type="time" value="${escapeHTML(settings.startTime)}" required></label>
      <label class="exam-field"><span>結束時間</span><input id="examEndTime" type="time" value="${escapeHTML(settings.endTime)}" required></label>
      <p class="exam-form-error ${error ? "show" : ""}" id="examFormError" role="alert">${escapeHTML(error)}</p>
      <div class="exam-form-actions"><button class="secondary-action" type="button" data-timer-action="clear">清除設定</button><button class="primary-action" type="submit">開始顯示</button></div>
    </form>
  </section>`;
}

function formatStandaloneTimer(seconds) {
  return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
}

function updateStandaloneTimer() {
  const timer = state.standaloneTimer;
  if (timer.endAt) timer.seconds = Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000));
  const display = $("#standaloneTimerDisplay");
  if (display) display.textContent = formatStandaloneTimer(timer.seconds);
  const miniDisplay = $("#standaloneMiniDisplay");
  if (miniDisplay) miniDisplay.textContent = formatStandaloneTimer(timer.seconds);
  const start = $("[data-standalone-action=\"start\"]");
  const pause = $("[data-standalone-action=\"pause\"]");
  if (start) start.textContent = timer.endAt ? "進行中" : "開始";
  if (pause) pause.disabled = !timer.endAt;
  if (timer.endAt && timer.seconds > 0) {
    timer.timerId = setTimeout(updateStandaloneTimer, 250);
  } else if (timer.endAt) {
    timer.endAt = null;
    timer.timerId = null;
    ringWhiteboardTimer();
    showToast("計時完成");
  }
}

function pauseStandaloneTimer() {
  const timer = state.standaloneTimer;
  if (!timer.endAt) return;
  timer.seconds = Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000));
  timer.endAt = null;
  clearTimeout(timer.timerId);
  timer.timerId = null;
  updateStandaloneTimer();
}

function setStandaloneTimer(seconds) {
  const timer = state.standaloneTimer;
  pauseStandaloneTimer();
  timer.seconds = Math.max(0, Math.min(10800, Math.floor(seconds)));
  const minutes = $("#standaloneMinutes");
  const secondsInput = $("#standaloneSeconds");
  if (minutes) minutes.value = Math.floor(timer.seconds / 60);
  if (secondsInput) secondsInput.value = timer.seconds % 60;
  updateStandaloneTimer();
}

function setStandaloneTimerFromInputs() {
  const minutes = Number($("#standaloneMinutes")?.value || 0);
  const seconds = Number($("#standaloneSeconds")?.value || 0);
  setStandaloneTimer(minutes * 60 + seconds);
}

function startStandaloneTimer() {
  const timer = state.standaloneTimer;
  if (timer.endAt) return;
  if (!timer.seconds) setStandaloneTimerFromInputs();
  if (!timer.seconds) return showToast("請先設定計時時間");
  clearTimeout(timer.timerId);
  timer.endAt = Date.now() + timer.seconds * 1000;
  updateStandaloneTimer();
}

function resetStandaloneTimer() {
  pauseStandaloneTimer();
  setStandaloneTimerFromInputs();
}

function minimizeStandaloneTimer() {
  state.standaloneTimer.minimized = true;
  standaloneTimerMini.hidden = false;
  if (dialog.open) dialog.close();
  updateStandaloneTimer();
}

function expandStandaloneTimer() {
  state.standaloneTimer.minimized = false;
  standaloneTimerMini.hidden = true;
  dialogTitle.textContent = "計時工具";
  renderStandaloneTimer();
  if (!dialog.open) dialog.showModal();
}

function dismissStandaloneTimer() {
  pauseStandaloneTimer();
  state.standaloneTimer.minimized = false;
  standaloneTimerMini.hidden = true;
}

function renderStandaloneTimer() {
  const timer = state.standaloneTimer;
  timer.minimized = false;
  standaloneTimerMini.hidden = true;
  const minutes = Math.floor(timer.seconds / 60);
  const seconds = timer.seconds % 60;
  dialogBody.innerHTML = `<section class="standalone-timer" aria-labelledby="standaloneTimerTitle">
    <button type="button" class="timer-back" data-timer-hub="home">‹ 返回計時工具</button>
    <div class="standalone-timer-card">
      <p class="timer-kicker">獨立計時</p><h3 id="standaloneTimerTitle">課堂倒數計時器</h3>
      <strong class="standalone-display" id="standaloneTimerDisplay">${formatStandaloneTimer(timer.seconds)}</strong>
      <div class="standalone-inputs"><label>分<input id="standaloneMinutes" type="number" min="0" max="180" value="${minutes}" inputmode="numeric"></label><label>秒<input id="standaloneSeconds" type="number" min="0" max="59" value="${seconds}" inputmode="numeric"></label></div>
      <div class="timer-presets" aria-label="快速設定"><button type="button" data-standalone-preset="60">1 分</button><button type="button" data-standalone-preset="180">3 分</button><button type="button" data-standalone-preset="300">5 分</button><button type="button" data-standalone-preset="600">10 分</button></div>
      <div class="standalone-actions"><button class="timer-start" type="button" data-standalone-action="start">開始</button><button type="button" data-standalone-action="pause" ${timer.endAt ? "" : "disabled"}>暫停</button><button type="button" data-standalone-action="add">+1 分</button><button type="button" data-standalone-action="reset">重設</button><button class="timer-minimize" type="button" data-standalone-action="minimize">縮小至浮窗</button></div>
    </div>
  </section>`;
  updateStandaloneTimer();
}

function renderTimerHub() {
  if (!state.standaloneTimer.minimized) pauseStandaloneTimer();
  dialogBody.innerHTML = `<section class="timer-hub" aria-labelledby="timerHubTitle"><div class="timer-hub-intro"><p class="timer-kicker">計時工具</p><h3 id="timerHubTitle">選擇計時方式</h3><p>按課堂需要，使用考試時間顯示或獨立倒數計時。</p></div><div class="timer-choice-grid"><button type="button" class="timer-choice exam-choice" data-timer-hub="exam"><span>◷</span><strong>考試時間顯示器</strong><small>設定科目及考試時段，以投影方式顯示目前時間。</small></button><button type="button" class="timer-choice standalone-choice" data-timer-hub="standalone"><span>⏱</span><strong>獨立計時</strong><small>開始、暫停、重設與快速加時，適合課堂活動。</small></button></div></section>`;
}

function stableExamNow() {
  const anchor = state.exam.clockAnchor;
  return anchor ? anchor.epoch + (performance.now() - anchor.monotonic) : Date.now();
}

function renderExamDisplay(settings) {
  enterExamProjection(settings);
}

function clockNumbers() {
  return Array.from({ length: 12 }, (_, index) => `<span class="projection-number" style="--n:${index + 1}">${index + 1}</span>`).join("");
}

async function requestProjectionFullscreen() {
  if (document.fullscreenElement || !document.documentElement.requestFullscreen) return;
  try {
    await document.documentElement.requestFullscreen();
  } catch {
    // The projection still fills the page if the browser blocks native fullscreen.
  }
}

function enterExamProjection(settings) {
  const start = parseLocalDateTime(settings.examDate, settings.startTime);
  const end = parseLocalDateTime(settings.examDate, settings.endTime);
  stopExamAlarm();
  state.exam.schedule = { ...settings, start, end };
  state.exam.alarmPlayed = Date.now() >= end.getTime();
  state.exam.clockAnchor = { epoch: Date.now(), monotonic: performance.now() };
  window.TeacherStorage.setItem(EXAM_SETTINGS_KEY, JSON.stringify(settings));
  const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
  projectionContent.innerHTML = `<div class="projection-meta"><p>${escapeHTML(formatFullDate(start))}</p><h1>${escapeHTML(settings.subject)}</h1><strong>${escapeHTML(settings.startTime)} 至 ${escapeHTML(settings.endTime)}（${minutes}分鐘）</strong></div>
    <div class="projection-clock-stage"><div class="projection-digital-block"><strong class="projection-digital-clock" id="projectionMainClock">--:--:--</strong><span class="sr-only" id="projectionStatus">尚未開始</span></div>
      <div class="projection-analog-clock" role="img" aria-label="目前時間的指針時鐘">${clockNumbers()}<i class="projection-hand projection-hour" id="projectionHourHand"></i><i class="projection-hand projection-minute" id="projectionMinuteHand"></i><i class="projection-hand projection-second" id="projectionSecondHand"></i><i class="projection-pin"></i></div></div>`;
  if (dialog.open) dialog.close();
  document.body.classList.add("is-projecting");
  examProjection.hidden = false;
  $("#projectionFinishedAlarm").hidden = true;
  stopExamTimer();
  updateExamDisplay();
  requestExamWakeLock();
  requestProjectionFullscreen();
}

function updateExamDisplay() {
  const schedule = state.exam.schedule;
  if (!schedule || examProjection.hidden) return;
  const timestamp = stableExamNow();
  const now = new Date(timestamp);
  const clock = $("#projectionMainClock");
  if (!clock) return;
  clock.textContent = formatClock(now);
  const seconds = now.getSeconds() + now.getMilliseconds() / 1000;
  const minutes = now.getMinutes() + seconds / 60;
  const hours = (now.getHours() % 12) + minutes / 60;
  $("#projectionSecondHand").style.transform = `translateX(-50%) rotate(${seconds * 6}deg)`;
  $("#projectionMinuteHand").style.transform = `translateX(-50%) rotate(${minutes * 6}deg)`;
  $("#projectionHourHand").style.transform = `translateX(-50%) rotate(${hours * 30}deg)`;
  const status = $("#projectionStatus");
  if (timestamp < schedule.start.getTime()) {
    status.textContent = "尚未開始";
  } else if (timestamp < schedule.end.getTime()) {
    status.textContent = "考試進行中";
  } else {
    status.textContent = "考試結束";
    if (!state.exam.alarmPlayed) {
      state.exam.alarmPlayed = true;
      const notice = $("#projectionFinishedAlarm");
      notice.hidden = false;
      $("[data-projection-action='stop-alarm']", notice).textContent = Number(state.ui.examAlarmVolume) > 0 ? "停止鬧鐘" : "知道了";
      startExamAlarm();
    }
  }
  if (Math.abs(Date.now() - timestamp) > 2500) $("#projectionAlert")?.classList.add("show");
  state.exam.timerId = setTimeout(updateExamDisplay, 250);
}

function exitExamProjection({ openSettings = false } = {}) {
  const settings = state.exam.schedule ? { ...state.exam.schedule } : savedExamSettings();
  stopExamTimer();
  stopExamAlarm();
  releaseWakeLock();
  state.exam.schedule = null;
  examProjection.hidden = true;
  document.body.classList.remove("is-projecting");
  $("#projectionAlert")?.classList.remove("show");
  $("#projectionFinishedAlarm").hidden = true;
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  if (openSettings) {
    dialogTitle.textContent = "計時工具";
    renderExamForm(settings);
    if (!dialog.open) dialog.showModal();
  }
}

function submitExamSettings() {
  const settings = {
    subject: $("#examSubject").value.trim(),
    examDate: $("#examDate").value,
    startTime: $("#examStartTime").value,
    endTime: $("#examEndTime").value,
  };
  let error = "";
  const start = settings.examDate && settings.startTime ? parseLocalDateTime(settings.examDate, settings.startTime) : null;
  const end = settings.examDate && settings.endTime ? parseLocalDateTime(settings.examDate, settings.endTime) : null;
  if (!settings.subject || !settings.examDate || !settings.startTime || !settings.endTime) error = "請填寫科目、日期、開始時間及結束時間。";
  else if (!Number.isFinite(start?.getTime()) || !Number.isFinite(end?.getTime()) || end <= start) error = "結束時間必須遲於開始時間。";
  if (error) {
    renderExamForm(settings, error);
    return;
  }
  primeExamAlarmAudio();
  renderExamDisplay(settings);
}

function settingsStatusMarkup() {
  const info = SettingsData.status();
  return `<p class="settings-help">資料只儲存在此瀏覽器；清除瀏覽器網站資料會令資料消失。</p><div class="settings-stats"><span>班別 <b>${info.classCount}</b></span><span>學生 <b>${info.studentCount}</b></span><span>時間表班別 <b>${info.timetableCount}</b></span><span>加分紀錄 <b>${info.scoreCount}</b></span><span>白板 <b>${info.boardCount}</b></span><span>已用約 <b>${(info.bytes / 1024).toFixed(1)} KB</b></span></div>`;
}

function renderSettings() {
  const info = SettingsData.status();
  dialogBody.innerHTML = `<div class="settings-panel">
    <section class="demo-card"><h3>外觀</h3><div class="settings-row"><span>介面色彩</span><div class="swatches"><button class="swatch ${state.ui.theme === "sunset" ? "is-active" : ""}" data-theme="sunset" aria-label="日落色" aria-pressed="${state.ui.theme === "sunset"}"></button><button class="swatch ${state.ui.theme === "ocean" ? "is-active" : ""}" data-theme="ocean" aria-label="海洋色" aria-pressed="${state.ui.theme === "ocean"}"></button><button class="swatch ${state.ui.theme === "forest" ? "is-active" : ""}" data-theme="forest" aria-label="森林色" aria-pressed="${state.ui.theme === "forest"}"></button></div></div><label class="settings-row"><span>介面大小</span><input id="scaleSlider" type="range" min="90" max="115" value="${state.ui.scale}" /></label><div class="settings-row"><span>深色模式</span><button class="secondary-action" data-ui-action="dark" aria-pressed="${state.ui.dark}">${state.ui.dark ? "已開啟" : "已關閉"}</button></div><div class="settings-row"><span>減少動畫</span><button class="secondary-action" data-ui-action="motion" aria-pressed="${state.ui.reduceMotion}">${state.ui.reduceMotion ? "已開啟" : "已關閉"}</button></div></section>
    <section class="demo-card"><h3>輔助模式</h3><div class="settings-row"><span>大字模式</span><button class="secondary-action" data-ui-action="largeText" aria-pressed="${state.ui.largeText}">${state.ui.largeText ? "已開啟" : "已關閉"}</button></div><div class="settings-row"><span>高對比模式</span><button class="secondary-action" data-ui-action="highContrast" aria-pressed="${state.ui.highContrast}">${state.ui.highContrast ? "已開啟" : "已關閉"}</button></div><label class="settings-row"><span>時鐘顯示格式</span><select id="clockFormat"><option value="24" ${state.ui.clockFormat === "24" ? "selected" : ""}>24 小時</option><option value="12" ${state.ui.clockFormat === "12" ? "selected" : ""}>12 小時（上午／下午）</option></select></label></section>
    <section class="demo-card"><h3>聲音</h3><div class="settings-row"><label for="examAlarmVolume">考試鬧鐘音量</label><div class="settings-volume-controls"><input id="examAlarmVolume" type="range" min="0" max="100" step="5" value="${state.ui.examAlarmVolume}" aria-label="考試鬧鐘音量"><output id="examAlarmVolumeValue" for="examAlarmVolume">${state.ui.examAlarmVolume}%</output><button class="secondary-action" type="button" data-ui-action="preview-alarm">${state.exam.alarmPreview ? "停止試聽" : "試聽鬧鐘"}</button></div></div><p class="settings-help">音量 0% 為靜音；考試到時仍會顯示提示。實際聲量也受裝置音量影響。</p></section>
    <section class="demo-card"><h3>資料備份與還原</h3><p class="settings-help">按類別下載 JSON 備份。匯入時會先顯示檔案內容及影響範圍。</p><div class="settings-export-grid">${Object.entries(SettingsData.categories).map(([key, name]) => `<button type="button" class="secondary-action" data-settings-export="${key}">匯出${name}</button>`).join("")}</div><label class="settings-file-label">選擇備份檔案以預覽<input id="settingsImportFile" type="file" accept=".json,application/json"></label><div id="settingsImportPreview" aria-live="polite"></div></section>
    <section class="demo-card"><h3>帳戶與共用資料</h3><p data-cloud-status>${window.TeacherCloud.status()}</p><button type="button" class="secondary-action" data-cloud-open>登入與同步設定</button></section>
    <section class="demo-card"><h3>資料管理</h3><div id="settingsStorageStatus">${settingsStatusMarkup()}</div><div class="settings-clear-list"><div><span>白板資料 <small>${info.boardCount} 張</small></span><button type="button" class="secondary-action danger-action" data-settings-clear="whiteboard" ${info.boardCount ? "" : "disabled"}>清除白板</button></div><div><span>遊戲進度 <small>遊戲沒有本機紀錄；可重設目前進行中的兩個遊戲</small></span><button type="button" class="secondary-action danger-action" data-settings-clear="games">重設遊戲</button></div><div><span>加分紀錄 <small>${info.scoreCount} 筆；保留自訂規則</small></span><button type="button" class="secondary-action danger-action" data-settings-clear="scores" ${info.scoreCount ? "" : "disabled"}>清除紀錄</button></div></div></section>
  </div>`;
}

function downloadSettingsBackup(category) {
  const payload = SettingsData.exportPayload(category);
  const name = SettingsData.categories[category];
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `教師工具-${name}-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(`已匯出${name}備份`);
}

function showSettingsImportPreview(payload) {
  const current = SettingsData.exportPayload(payload.category);
  const categoryName = SettingsData.categories[payload.category];
  const effect = payload.category === "classes" ? "相同班別會更新名稱；其他班別和學生保留。" : payload.category === "students" ? "相同班別的學生名單會被替換；其他班別保留。" : payload.category === "timetable" ? "檔案所包含的時間表儲存版本會被替換。" : "現有加分紀錄、規則及植物進度會被替換。";
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&#39;" })[char]);
  $("#settingsImportPreview").innerHTML = `<div class="settings-preview"><h4>匯入預覽：${categoryName}</h4><p>備份日期：${escape(new Date(payload.exportedAt).toLocaleString("zh-HK"))}</p><p>檔案內容：${escape(SettingsData.summary(payload.category, payload.data))}</p><p>目前資料：${escape(SettingsData.summary(current.category, current.data))}</p><p><strong>套用後：</strong>${effect}</p><div class="demo-actions"><button type="button" class="primary-action" data-settings-import="confirm">確認匯入</button><button type="button" class="secondary-action" data-settings-import="cancel">取消</button></div></div>`;
}

function openApp(name) {
  if (name === "班別管理") {
    window.location.href = "./class-management.html";
    return;
  }
  if (name === "上課時間表檢閱") {
    window.location.href = "./timetable-view.html";
    return;
  }
  if (name === "上課時間表") {
    window.location.href = "./timetable-prototype/index.html";
    return;
  }
  if (name === "數學賓果") {
    openBingoGame();
    return;
  }
  if (name === "乘法寶藏") {
    openTreasureGame();
    return;
  }
  if (name === "電子白板") {
    openWhiteboard("board");
    return;
  }
  if (name === "功課紙") {
    openWhiteboard("homework");
    return;
  }
  dialogTitle.textContent = name === "加分" ? "課堂加分／減分" : name;
  if (name === "加分") {
    dialogBody.innerHTML = '<iframe class="score-frame" src="./score.html?embed=1" title="課堂加分／減分"></iframe>';
  } else if (name === "計時工具") {
    renderTimerHub();
  } else if (name === "設定") {
    pendingSettingsImport = null;
    renderSettings();
  } else {
    dialogBody.innerHTML = genericDemo(name);
  }
  if (!dialog.open) dialog.showModal();
  $$(".dock-item").forEach(item => item.classList.toggle("active", item.dataset.app === name));
}

function openBingoGame() {
  if (dialog.open) dialog.close();
  closeWhiteboard();
  closeTreasureGame();
  exitExamProjection();
  bingoGame.hidden = false;
  $$(".dock-item").forEach(item => item.classList.toggle("active", item.dataset.app === "數學賓果"));
}

function closeBingoGame() {
  bingoGame.hidden = true;
}

function openTreasureGame() {
  if (dialog.open) dialog.close();
  closeWhiteboard();
  closeBingoGame();
  exitExamProjection();
  treasureGame.hidden = false;
  $$(".dock-item").forEach(item => item.classList.toggle("active", item.dataset.app === "乘法寶藏"));
}

function closeTreasureGame() {
  treasureGame.hidden = true;
}

function closeApp() {
  if (state.exam.alarmPreview) stopExamAlarm();
  closeWhiteboard();
  closeBingoGame();
  closeTreasureGame();
  exitExamProjection();
  if (!state.standaloneTimer.minimized) pauseStandaloneTimer();
  stopExamTimer();
  releaseWakeLock();
  state.exam.schedule = null;
  if (dialog.open) dialog.close();
  $$(".dock-item").forEach(item => item.classList.toggle("active", item.dataset.action === "home"));
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
}

async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) {
      if (!document.documentElement.requestFullscreen) throw new Error("unsupported");
      await document.documentElement.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch {
    showToast("此瀏覽器暫不支援全螢幕顯示");
  }
}

function updateFullscreenButton() {
  const active = Boolean(document.fullscreenElement);
  fullscreenButton.setAttribute("aria-pressed", String(active));
  fullscreenButton.setAttribute("aria-label", active ? "退出全螢幕" : "進入全螢幕");
  $("span", fullscreenButton).textContent = active ? "退出全螢幕" : "全螢幕";
}

document.addEventListener("click", (event) => {
  const launcher = event.target.closest("[data-app]");
  if (launcher) openApp(launcher.dataset.app);
  const timetableAction = event.target.closest("[data-tt-action]");
  if (timetableAction) {
    const action = timetableAction.dataset.ttAction;
    if (action === "tab") { timetableTab = timetableAction.dataset.ttTab; renderTimetableTool(); }
    if (action === "add-exception") { timetable.exceptions.push({ start: "", end: "", note: "", source: "手動" }); renderTimetableTool(); }
    if (action === "remove-exception") { timetable.exceptions.splice(Number(timetableAction.closest("[data-tt-exception]").dataset.ttException), 1); renderTimetableTool(); }
    if (action === "save-setup") saveTimetableSetup();
    if (action === "save-lessons") saveTimetableLessons();
    if (action === "add-class") { const name = prompt("新班別名稱，例如：4A"); if (name?.trim() && !timetable.classes.includes(name.trim())) { timetable.classes.push(name.trim()); timetable.lessons[name.trim()] = {}; timetable.selectedClass = name.trim(); saveTimetable(); renderTimetableTool(); } }
    if (action === "apply-recognition") applyTimetableRecognition();
  }
  const lesson = event.target.closest(".lesson");
  if (lesson) {
    $$(".lesson").forEach(item => item.classList.remove("active"));
    lesson.classList.add("active");
    showToast(`已選擇 ${$("time", lesson).textContent} ${$("span", lesson).textContent}`);
  }
  const timerAction = event.target.closest("[data-timer-action]");
  if (timerAction) {
    const { timerAction: action } = timerAction.dataset;
    if (action === "clear") {
      window.TeacherStorage.removeItem(EXAM_SETTINGS_KEY);
      renderExamForm();
    }
    if (action === "edit") renderExamForm(state.exam.schedule || savedExamSettings());
    if (action === "fullscreen" && state.exam.schedule) enterExamProjection(state.exam.schedule);
    if (action === "acknowledge") {
      state.exam.clockAnchor = { epoch: Date.now(), monotonic: performance.now() };
      $("#projectionAlert")?.classList.remove("show");
    }
  }
  const timerHub = event.target.closest("[data-timer-hub]");
  if (timerHub) {
    if (timerHub.dataset.timerHub === "home") renderTimerHub();
    if (timerHub.dataset.timerHub === "exam") renderExamForm();
    if (timerHub.dataset.timerHub === "standalone") renderStandaloneTimer();
  }
  const standalonePreset = event.target.closest("[data-standalone-preset]");
  if (standalonePreset) setStandaloneTimer(Number(standalonePreset.dataset.standalonePreset));
  const standaloneAction = event.target.closest("[data-standalone-action]");
  if (standaloneAction) {
    const action = standaloneAction.dataset.standaloneAction;
    if (action === "start") startStandaloneTimer();
    if (action === "pause") pauseStandaloneTimer();
    if (action === "add") {
      state.standaloneTimer.seconds += 60;
      if (state.standaloneTimer.endAt) state.standaloneTimer.endAt += 60000;
      updateStandaloneTimer();
    }
    if (action === "reset") resetStandaloneTimer();
    if (action === "minimize") minimizeStandaloneTimer();
  }
  const miniTimerAction = event.target.closest("[data-mini-timer-action]");
  if (miniTimerAction) {
    if (miniTimerAction.dataset.miniTimerAction === "expand") expandStandaloneTimer();
    if (miniTimerAction.dataset.miniTimerAction === "close") dismissStandaloneTimer();
  }
  const projectionAction = event.target.closest("[data-projection-action]");
  if (projectionAction) {
    if (projectionAction.dataset.projectionAction === "exit") exitExamProjection();
    if (projectionAction.dataset.projectionAction === "edit") exitExamProjection({ openSettings: true });
    if (projectionAction.dataset.projectionAction === "stop-alarm") {
      stopExamAlarm();
      $("#projectionFinishedAlarm").hidden = true;
    }
    if (projectionAction.dataset.projectionAction === "acknowledge") {
      state.exam.clockAnchor = { epoch: Date.now(), monotonic: performance.now() };
      $("#projectionAlert")?.classList.remove("show");
    }
  }
  const demoAction = event.target.closest("[data-demo-action]");
  if (demoAction?.dataset.demoAction === "close") closeApp();
  if (demoAction?.dataset.demoAction === "start") showToast(`${dialogTitle.textContent}示範已啟動`);
  const uiAction = event.target.closest("[data-ui-action]");
  if (uiAction?.dataset.uiAction === "dark") {
    state.ui.dark = !state.ui.dark;
    saveUIPreferences();
    applyUIPreferences();
    openApp("設定");
  }
  if (uiAction?.dataset.uiAction === "motion") {
    state.ui.reduceMotion = !state.ui.reduceMotion;
    saveUIPreferences();
    applyUIPreferences();
    openApp("設定");
    showToast(state.ui.reduceMotion ? "減少動畫已開啟" : "減少動畫已關閉");
  }
  if (["largeText", "highContrast"].includes(uiAction?.dataset.uiAction)) {
    const key = uiAction.dataset.uiAction;
    state.ui[key] = !state.ui[key];
    saveUIPreferences();
    applyUIPreferences();
    renderSettings();
  }
  if (uiAction?.dataset.uiAction === "preview-alarm") {
    if (state.exam.alarmPreview) stopExamAlarm();
    else if (Number(state.ui.examAlarmVolume) === 0) showToast("請先調高考試鬧鐘音量");
    else {
      primeExamAlarmAudio();
      if (state.exam.alarmContext) startExamAlarm(true);
      else showToast("此瀏覽器未能播放考試鬧鐘");
    }
  }
  const settingsExport = event.target.closest("[data-settings-export]");
  if (settingsExport) downloadSettingsBackup(settingsExport.dataset.settingsExport);
  const settingsImport = event.target.closest("[data-settings-import]");
  if (settingsImport?.dataset.settingsImport === "cancel") {
    pendingSettingsImport = null;
    $("#settingsImportPreview").innerHTML = "";
    $("#settingsImportFile").value = "";
  }
  if (settingsImport?.dataset.settingsImport === "confirm" && pendingSettingsImport) {
    try {
      const name = SettingsData.categories[pendingSettingsImport.category];
      SettingsData.importPayload(pendingSettingsImport);
      pendingSettingsImport = null;
      timetable = loadTimetable();
      buildCalendar();
      renderDashboardSchedule();
      renderSettings();
      showToast(`已匯入${name}；重新開啟相關工具即可查看`);
    } catch { showToast("匯入失敗，請檢查瀏覽器儲存空間"); }
  }
  const settingsClear = event.target.closest("[data-settings-clear]");
  if (settingsClear) {
    const category = settingsClear.dataset.settingsClear;
    const label = category === "whiteboard" ? "所有本機白板與筆跡" : category === "games" ? "目前進行中的數學賓果與乘法寶藏進度" : "所有加減分紀錄及植物進度（自訂規則會保留）";
    if (window.confirm(`確定要清除${label}？此動作無法復原。`)) {
      try {
        if (category === "games") {
          ["#bingoFrame", "#treasureFrame"].forEach(selector => { const frame = $(selector); frame.src = frame.src; });
        } else SettingsData.clear(category);
        renderSettings();
        showToast("資料已清除");
      } catch { showToast("清除失敗，請再試一次"); }
    }
  }
  const swatch = event.target.closest(".swatch");
  if (swatch) {
    state.ui.theme = swatch.dataset.theme;
    saveUIPreferences();
    applyUIPreferences();
    openApp("設定");
    showToast("主題色彩已更新");
  }
  const libraryOpen = event.target.closest("[data-library-open]");
  if (libraryOpen) {
    closeAppLibrary();
    openApp(libraryOpen.dataset.libraryOpen);
  }
  const libraryToggle = event.target.closest("[data-library-toggle]");
  if (libraryToggle) {
    const hidden = hiddenDockApps();
    const name = libraryToggle.dataset.libraryToggle;
    if (hidden.has(name)) hidden.delete(name); else hidden.add(name);
    window.TeacherStorage.setItem(HIDDEN_DOCK_APPS_KEY, JSON.stringify([...hidden]));
    applyDockVisibility();
    renderAppLibrary();
  }
});

document.addEventListener("click", event => {
  const tool = event.target.closest("[data-wb-tool]");
  if (tool) setWhiteboardTool(tool.dataset.wbTool);
  const color = event.target.closest("[data-wb-color]");
  if (color) setWhiteboardColor(color.dataset.wbColor);
  const background = event.target.closest("[data-wb-background]");
  if (background) setWhiteboardBackground(background.dataset.wbBackground);
  const board = event.target.closest("[data-wb-board]");
  if (board) selectWhiteboard(board.dataset.wbBoard);
  const action = event.target.closest("[data-wb-action]");
  if (!action) return;
  switch (action.dataset.wbAction) {
    case "exit": closeWhiteboard(); break;
    case "undo": undoWhiteboard(); break;
    case "redo": redoWhiteboard(); break;
    case "clear": clearWhiteboard(); break;
    case "cancel-clear": cancelClearWhiteboard(); break;
    case "confirm-clear": confirmClearWhiteboard(); break;
    case "export": exportWhiteboardPNG(); break;
    case "background": $("#wbBackgroundMenu").hidden = !$("#wbBackgroundMenu").hidden; $("#wbBoardsMenu").hidden = true; break;
    case "boards": renderWhiteboardBoards(); $("#wbBoardsMenu").hidden = !$("#wbBoardsMenu").hidden; $("#wbBackgroundMenu").hidden = true; break;
    case "new-board": newWhiteboard(); break;
    case "zoom-out": changePaperZoom(-.1); break;
    case "zoom-in": changePaperZoom(.1); break;
    case "reset-view": resetPaperView(); break;
    case "fullscreen": toggleWhiteboardFullscreen(); break;
    case "toggle-timer": wbTimer.classList.toggle("is-collapsed"); requestAnimationFrame(layoutWhiteboardControls); break;
    case "timer-start": startWhiteboardTimer(); break;
    case "timer-pause": pauseWhiteboardTimer(); break;
    case "timer-add": clearTimeout(state.whiteboard.timerId); state.whiteboard.timerSeconds += 60; if (state.whiteboard.timerEnd) state.whiteboard.timerEnd += 60000; updateWhiteboardTimer(); break;
    case "timer-reset": resetWhiteboardTimer(); break;
    default: break;
  }
});

dialog.addEventListener("submit", event => {
  if (event.target.id !== "examSettingsForm") return;
  event.preventDefault();
  submitExamSettings();
});

$("#closeDialog").addEventListener("click", closeApp);
$("#closeBingoGame").addEventListener("click", closeApp);
$("#closeTreasureGame").addEventListener("click", closeApp);
appLibraryButton.addEventListener("click", () => appSidebar.hidden ? openAppLibrary() : closeAppLibrary());
$("#closeAppSidebar").addEventListener("click", closeAppLibrary);
dialog.addEventListener("click", event => { if (event.target === dialog) closeApp(); });
dialog.addEventListener("close", () => { if (state.exam.alarmPreview) stopExamAlarm(); });
const homeButton = $("[data-action=\"home\"]");
if (homeButton) homeButton.addEventListener("click", closeApp);
$("#speakNow").addEventListener("click", speakTime);
fullscreenButton.addEventListener("click", toggleFullscreen);
document.addEventListener("fullscreenchange", updateFullscreenButton);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.exam.schedule) {
    if (!state.exam.wakeLock) requestExamWakeLock();
    stopExamTimer();
    updateExamDisplay();
  }
});
document.addEventListener("keydown", event => {
  if (!appSidebar.hidden && event.key === "Escape") {
    event.preventDefault();
    closeAppLibrary();
    return;
  }
  if (!whiteboard.hidden) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (!$("#wbClearConfirm").hidden) {
        cancelClearWhiteboard();
        return;
      }
      closeWhiteboard();
    }
    return;
  }
  if (!document.body.classList.contains("is-projecting")) return;
  if (event.key === "Escape") {
    event.preventDefault();
    exitExamProjection();
  }
  if (event.key.toLowerCase() === "e") exitExamProjection({ openSettings: true });
});
wbCanvas.addEventListener("pointerdown", beginWhiteboardStroke);
wbCanvas.addEventListener("pointermove", continueWhiteboardStroke);
wbCanvas.addEventListener("pointerup", endWhiteboardStroke);
wbCanvas.addEventListener("pointercancel", endWhiteboardStroke);
wbCanvas.addEventListener("pointerleave", event => { if (event.pointerType === "mouse") endWhiteboardStroke(event); });
$("#wbSize").addEventListener("input", event => { state.whiteboard.size = Number(event.target.value); });
$("#wbTimerMinutes").addEventListener("input", resetWhiteboardTimer);
$("#wbTimerSeconds").addEventListener("input", resetWhiteboardTimer);
makeWhiteboardControlDraggable($(".wb-float-button"), wbLeftActions);
makeWhiteboardControlDraggable($(".wb-timer-summary"), wbTimer);
window.addEventListener("resize", () => { if (!whiteboard.hidden) { layoutWhiteboardControls(); resizeWhiteboardCanvas(); } });
document.addEventListener("fullscreenchange", () => requestAnimationFrame(layoutWhiteboardControls));
announceToggle.addEventListener("click", () => {
  state.announce = !state.announce;
  window.TeacherStorage.setItem("announce", state.announce ? "on" : "off");
  updateAnnouncement();
  showToast(state.announce ? "整點報時已開啟" : "整點報時已關閉");
});
$("#focusButton").addEventListener("click", event => {
  const on = $("#desktop").classList.toggle("is-focus");
  event.currentTarget.setAttribute("aria-pressed", String(on));
  event.currentTarget.textContent = on ? "結束專注" : "專注模式";
});
$("#prevMonth").addEventListener("click", () => { state.monthOffset--; buildCalendar(); });
$("#nextMonth").addEventListener("click", () => { state.monthOffset++; buildCalendar(); });
dialog.addEventListener("input", event => {
  if (event.target.id === "scaleSlider") {
    state.ui.scale = Number(event.target.value);
    saveUIPreferences();
    applyUIPreferences();
  }
  if (event.target.id === "examAlarmVolume") {
    state.ui.examAlarmVolume = Math.max(0, Math.min(100, Number(event.target.value) || 0));
    $("#examAlarmVolumeValue").textContent = `${state.ui.examAlarmVolume}%`;
    saveUIPreferences();
  }
  if (event.target.id === "standaloneMinutes" || event.target.id === "standaloneSeconds") resetStandaloneTimer();
});
dialog.addEventListener("change", async event => {
  if (event.target.id === "clockFormat") {
    state.ui.clockFormat = event.target.value === "12" ? "12" : "24";
    saveUIPreferences();
    applyUIPreferences();
    updateClock();
    if (!examProjection.hidden) $("#projectionMainClock").textContent = formatClock(new Date());
  }
  if (event.target.id === "settingsImportFile") {
    pendingSettingsImport = null;
    const preview = $("#settingsImportPreview");
    const file = event.target.files[0];
    if (file) {
      try {
        if (file.size > 10 * 1024 * 1024) throw new Error("檔案超過 10 MB");
        const payload = SettingsData.validate(JSON.parse((await file.text()).replace(/^\uFEFF/, "")));
        pendingSettingsImport = payload;
        showSettingsImportPreview(payload);
      } catch (error) {
        preview.textContent = error.message || "無法讀取備份檔案";
      }
    }
  }
  if (event.target.id === "ttClassSelect") { timetable.selectedClass = event.target.value; saveTimetable(); renderTimetableTool(); renderDashboardSchedule(); }
  if (event.target.id === "ttSourceInput") { $("#ttSourceStatus").textContent = event.target.files[0] ? `已選擇：${event.target.files[0].name}` : ""; }
  if (event.target.id === "ttPublicHolidayInput") {
    try {
      const payload = JSON.parse((await event.target.files[0].text()).replace(/^\uFEFF/, "")); const events = payload.vcalendar?.flatMap(calendar => calendar.vevent || []) || [];
      const imported = events.flatMap(event => { const raw = Array.isArray(event.dtstart) ? event.dtstart[0] : event.dtstart; const value = String(raw || ""); return /^\d{8}$/.test(value) ? [{ start: `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`, end: "", note: `公眾假期：${event.summary || "未命名"}`, source: "公眾假期 JSON" }] : []; });
      timetable.publicHolidays = imported; saveTimetable(); buildCalendar(); renderDashboardSchedule(); showToast(`已套用 ${imported.length} 個公眾假期`);
    } catch { showToast("無法讀取公眾假期 JSON"); }
  }
});
document.addEventListener("change", event => {
  if (event.target.id !== "dashboardClassSelect") return;
  timetable.selectedClass = event.target.value;
  try {
    const prototype = JSON.parse(window.TeacherStorage.getItem("cycle-timetable-prototype-v4") || "{}");
    if (prototype.setup) { prototype.selectedClass = timetable.selectedClass; window.TeacherStorage.setItem("cycle-timetable-prototype-v4", JSON.stringify(prototype)); }
    else saveTimetable();
  } catch { saveTimetable(); }
  renderDashboardSchedule();
});

updateAnnouncement();
state.ui = savedUIPreferences();
applyUIPreferences();
applyDockVisibility();
updateFullscreenButton();
buildCalendar();
renderDashboardSchedule();
updateClock();
setInterval(updateClock, 1000);
window.addEventListener("teacher-data-reloaded", () => {
  timetable = loadTimetable(); buildCalendar(); renderDashboardSchedule();
  if (document.querySelector(".settings-panel")) renderSettings();
});
document.addEventListener("click", event => {
  if (event.target.closest("[data-cloud-open]")) {
    document.querySelector("#appDialog")?.close(); window.TeacherCloud.open();
  }
});
