const STORAGE_KEY = "cycle-timetable-prototype-v4";
const WEEKDAYS = ["星期一", "星期二", "星期三", "星期四", "星期五"];
const DEFAULT = {
  setup: { termName: "未命名學期", cycleLength: 6 }, classes: ["3A", "3B"],
  morningPeriods: [{ name: "第 1 節", start: "08:25", end: "09:05" }, { name: "第 2 節", start: "09:05", end: "09:45" }, { name: "第 3 節", start: "10:00", end: "10:40" }, { name: "第 4 節", start: "10:40", end: "11:20" }, { name: "第 5 節", start: "11:35", end: "12:15" }, { name: "第 6 節", start: "12:15", end: "12:55" }],
  afternoonPeriods: [{ name: "第 7 節", start: "14:05", end: "14:45" }, { name: "第 8 節", start: "14:45", end: "15:25" }], blocks: [], lessons: {},
};
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
function load() { try { const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); return { ...DEFAULT, ...saved, setup: { ...DEFAULT.setup, ...(saved.setup || {}) }, lessons: saved.lessons || {}, morningPeriods: saved.morningPeriods || DEFAULT.morningPeriods, afternoonPeriods: saved.afternoonPeriods || DEFAULT.afternoonPeriods, blocks: saved.blocks || [] }; } catch { return DEFAULT; } }
const data = load(); let selectedClass = data.classes[0];
function dayLabel(day) { return `Day ${String.fromCharCode(64 + day)}`; }
function lessonCell(section, day, period) { const lesson = data.lessons[selectedClass]?.[`${section}-${day}-${period}`]; return `<td>${lesson?.subject ? `<strong>${esc(lesson.subject)}</strong>${lesson.room ? `<small>${esc(lesson.room)}</small>` : ""}` : ""}</td>`; }
function blocks(section, after, span) { return data.blocks.filter(block => block.section === section && Number(block.after) === after).map(block => `<tr class="block"><td></td><td>${esc(block.start)}${block.end ? `–${esc(block.end)}` : ""}</td><td colspan="${span}">${esc(block.label)}</td></tr>`).join(""); }
function table(section, label, columns) { const periods = data[`${section}Periods`]; let rows = blocks(section, -1, columns.length); periods.forEach((period, index) => { rows += `<tr><th>${esc(period.name)}</th><td>${esc(period.start)}–${esc(period.end)}</td>${columns.map(column => lessonCell(section, column.value, index)).join("")}</tr>${blocks(section, index, columns.length)}`; }); return `<section class="table-section"><h2>${label}</h2><div class="scroll"><table><thead><tr><th>節數</th><th>時間</th>${columns.map(column => `<th>${esc(column.label)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div></section>`; }
function render() { $("#termName").textContent = data.setup.termName; $("#classSelect").innerHTML = data.classes.map(name => `<option ${name === selectedClass ? "selected" : ""}>${esc(name)}</option>`).join(""); const cycle = Array.from({ length: Number(data.setup.cycleLength) || 6 }, (_, index) => ({ value: index + 1, label: dayLabel(index + 1) })); const weekdays = WEEKDAYS.map((label, index) => ({ value: index, label })); $("#timetable").innerHTML = table("morning", "上午：循環日課表", cycle) + table("afternoon", "下午：星期課表", weekdays); }
$("#classSelect").addEventListener("change", event => { selectedClass = event.target.value; render(); });
render();
