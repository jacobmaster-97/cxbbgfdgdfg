const CLASS_KEY = "teacher-dashboard-class-management-v1";
const SCORE_KEY = "teacher-dashboard-scores-v1";
const PLANT_LEVEL_POINTS = 10;
const PLANT_MATURE_POINTS = 90;
if (new URLSearchParams(location.search).has("embed")) document.body.classList.add("embed");
const $ = selector => document.querySelector(selector);
const makeId = prefix => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const defaultRules = () => [
  { id: "positive-answer", name: "主動回答", kind: "positive", points: 1 },
  { id: "positive-help", name: "幫助同學", kind: "positive", points: 1 },
  { id: "positive-homework", name: "準時交功課", kind: "positive", points: 1 },
  { id: "positive-effort", name: "認真參與", kind: "positive", points: 2 },
  { id: "negative-homework", name: "欠交功課", kind: "negative", points: 1 },
  { id: "negative-disruption", name: "干擾課堂", kind: "negative", points: 1 },
];
function readJson(key) { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; } }
function loadScores() {
  const saved = readJson(SCORE_KEY);
  return { rules: Array.isArray(saved?.rules) ? saved.rules : defaultRules(), entries: Array.isArray(saved?.entries) ? saved.entries : [], plants: saved?.plants && typeof saved.plants === "object" ? saved.plants : {}, selectedClassId: saved?.selectedClassId || "" };
}
function loadClasses() {
  const data = readJson(CLASS_KEY);
  return Array.isArray(data?.classes) ? data.classes.filter(item => item && typeof item.id === "string" && typeof item.name === "string").map(item => ({ ...item, students: Array.isArray(item.students) ? item.students.filter(student => student && typeof student.id === "string") : [] })) : [];
}
let scores = loadScores();
let classes = loadClasses();
let selectedIds = new Set();
let multiMode = false;
let activeKind = "positive";
let pendingDeduction = null;
let recentlyWateredIds = new Set();
function persist() { localStorage.setItem(SCORE_KEY, JSON.stringify(scores)); }
function currentClass() { return classes.find(item => item.id === scores.selectedClassId) || null; }
function sortedStudents(students) { return [...students].sort((a, b) => (Number(a.seat) || 9999) - (Number(b.seat) || 9999) || String(a.name || "").localeCompare(String(b.name || ""), "zh-Hant")); }
function totalForStudent(id) { return scores.entries.reduce((sum, entry) => sum + (entry.studentId === id && Number.isFinite(entry.points) ? entry.points : 0), 0); }
function classEntries(item) { const ids = new Set(item.students.map(student => student.id)); return scores.entries.filter(entry => ids.has(entry.studentId)); }
function plantCycles(studentId) {
  const saved = scores.plants[studentId]?.cycles;
  return Array.isArray(saved) && saved.length ? saved : [{ id: `initial:${studentId}` }];
}
function ensurePlantRecord(studentId) {
  if (!Array.isArray(scores.plants[studentId]?.cycles) || !scores.plants[studentId].cycles.length) {
    scores.plants[studentId] = { cycles: [{ id: `initial:${studentId}` }] };
  }
  return scores.plants[studentId];
}
function plantInfo(studentId) {
  const cycles = plantCycles(studentId);
  const entries = scores.entries.filter(entry => entry.studentId === studentId);
  let carry = 0;
  let completed = 0;
  let water = 0;
  cycles.forEach((cycle, index) => {
    let running = carry;
    let peak = running;
    entries.forEach(entry => {
      if (entry.plantCycleId === cycle.id || (index === 0 && !entry.plantCycleId)) {
        running += Number.isFinite(entry.points) ? entry.points : 0;
        peak = Math.max(peak, running);
      }
    });
    if (peak >= PLANT_MATURE_POINTS) completed += 1;
    water = Math.max(0, running);
    carry = Math.max(0, running - PLANT_MATURE_POINTS);
  });
  return { level: Math.min(10, Math.floor(water / PLANT_LEVEL_POINTS) + 1), water, completed, canReplant: water >= PLANT_MATURE_POINTS, cycleId: cycles.at(-1).id };
}
function plantSvg(level) {
  const leaf = (x, y, side, scale = 1) => `<path d="M ${x} ${y} Q ${x + side*25*scale} ${y-28*scale} ${x + side*35*scale} ${y-4*scale} Q ${x+side*18*scale} ${y+13*scale} ${x} ${y} Z" fill="var(--plant-leaf)" stroke="var(--plant-leaf-dark)" stroke-width="1.4"/>`;
  let growth = "";
  if (level <= 4) {
    const top = [128, 116, 99, 84][level - 1];
    growth += `<path d="M 100 164 C 98 147 101 ${top+18} 100 ${top}" fill="none" stroke="var(--plant-leaf-dark)" stroke-width="${3+level}" stroke-linecap="round"/>`;
    if (level === 1) growth += leaf(100, 137, -1, .55) + leaf(100, 137, 1, .55);
    if (level >= 2) growth += leaf(99, 142, -1, .65) + leaf(101, 142, 1, .65) + leaf(100, top+13, -1, .68) + leaf(100, top+13, 1, .68);
    if (level >= 3) growth += leaf(100, 119, -1, .74) + leaf(100, 119, 1, .74);
    if (level >= 4) growth += leaf(100, 97, -1, .82) + leaf(100, 97, 1, .82) + `<ellipse cx="100" cy="${top}" rx="8" ry="13" fill="var(--plant-leaf-light)"/>`;
  } else {
    const stage = level - 5;
    const top = 91 - stage*5;
    const spread = 23 + stage*6;
    const crownY = top - 4;
    growth += `<path d="M 99 164 C 96 140 103 119 100 ${top}" fill="none" stroke="var(--plant-wood)" stroke-width="${8+stage*1.5}" stroke-linecap="round"/>`;
    growth += `<path d="M 99 130 Q 82 ${114-stage} ${70-stage*2} ${108-stage*2} M 101 117 Q 123 ${108-stage} ${134+stage*2} ${97-stage*2}" fill="none" stroke="var(--plant-wood)" stroke-width="${4+stage*.55}" stroke-linecap="round"/>`;
    if (level >= 7) growth += `<path d="M 99 104 Q 82 ${87-stage} ${72-stage*2} ${74-stage*2} M 102 99 Q 120 ${82-stage} ${130+stage*2} ${76-stage*2}" fill="none" stroke="var(--plant-wood)" stroke-width="${3+stage*.45}" stroke-linecap="round"/>`;
    growth += `<ellipse cx="100" cy="${crownY}" rx="${spread}" ry="${20+stage*4}" fill="var(--plant-leaf-dark)"/><ellipse cx="${100-spread*.55}" cy="${crownY+7}" rx="${spread*.58}" ry="${17+stage*2.4}" fill="var(--plant-leaf)"/><ellipse cx="${100+spread*.55}" cy="${crownY+6}" rx="${spread*.58}" ry="${17+stage*2.4}" fill="var(--plant-leaf)"/><ellipse cx="100" cy="${crownY-9}" rx="${spread*.72}" ry="${18+stage*3}" fill="var(--plant-leaf-light)"/>`;
    if (level >= 8) growth += `<ellipse cx="${100-spread*.73}" cy="${crownY+18}" rx="${spread*.32}" ry="${12+stage}" fill="var(--plant-leaf-dark)"/><ellipse cx="${100+spread*.75}" cy="${crownY+17}" rx="${spread*.33}" ry="${12+stage}" fill="var(--plant-leaf-dark)"/>`;
  }
  return `<svg viewBox="0 0 200 190" aria-hidden="true" focusable="false"><ellipse cx="100" cy="171" rx="49" ry="8" fill="var(--plant-earth)" opacity=".22"/><path d="M 62 166 Q 100 150 138 166 Q 100 176 62 166 Z" fill="var(--plant-earth)"/>${growth}</svg>`;
}
function toast(message, undoBatchId = null) {
  const node = $("#toast");
  node.replaceChildren(document.createTextNode(message));
  if (undoBatchId) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "撤銷剛才操作";
    button.dataset.undoBatch = undoBatchId;
    node.append(button);
  }
  node.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove("show"), undoBatchId ? 8000 : 3000);
}
function signed(points) { return `${points > 0 ? "+" : ""}${points}`; }
function refreshClasses() {
  classes = loadClasses();
  if (!classes.some(item => item.id === scores.selectedClassId)) {
    const preferredId = readJson(CLASS_KEY)?.selectedClassId;
    scores.selectedClassId = classes.find(item => item.id === preferredId)?.id || classes[0]?.id || "";
    persist();
  }
}
function studentCard(student) {
  const plant = plantInfo(student.id);
  const progress = plant.level === 10 ? 100 : (plant.water % PLANT_LEVEL_POINTS) * 10;
  const remaining = plant.level === 10 ? 0 : plant.level * PLANT_LEVEL_POINTS - plant.water;
  return `<article class="student-card ${selectedIds.has(student.id) ? "selected" : ""} ${recentlyWateredIds.has(student.id) ? "just-watered" : ""}">
    <button class="student-main" type="button" data-student-id="${escapeHtml(student.id)}" aria-pressed="${selectedIds.has(student.id)}" aria-label="${escapeHtml(student.name || "未命名學生")}，目前總分 ${signed(totalForStudent(student.id))}，植物 LV${plant.level}，已長成 ${plant.completed} 棵。${multiMode ? "點選以選擇" : "點選加分或減分"}">
      <span class="student-top"><span class="seat">${escapeHtml(student.seat || "—")}</span><strong class="student-name">${escapeHtml(student.name || "未命名學生")}</strong><span class="student-score">${signed(totalForStudent(student.id))} 分</span></span>
      <span class="plant-art">${plantSvg(plant.level)}${recentlyWateredIds.has(student.id) ? '<span class="water-drop" aria-hidden="true">💧</span>' : ""}</span>
      <span class="plant-meta"><strong>LV${plant.level}${plant.level === 10 ? " · 大樹" : ""}</strong><span>已長成 ${plant.completed} 棵</span></span>
      <span class="plant-progress" role="progressbar" aria-label="${escapeHtml(student.name || "學生")}植物灌溉進度" aria-valuemin="0" aria-valuemax="10" aria-valuenow="${plant.level === 10 ? 10 : plant.water % PLANT_LEVEL_POINTS}"><span style="width:${progress}%"></span></span>
      <span class="card-hint">${multiMode ? (selectedIds.has(student.id) ? "✓ 已選擇" : "點選以加入") : plant.canReplant ? "可以種下一棵" : `距離下一級還差 ${remaining} 分`}</span>
    </button>
    ${plant.canReplant && !multiMode ? `<button class="replant-button" type="button" data-replant-student-id="${escapeHtml(student.id)}">＋ 種下一棵</button>` : ""}
  </article>`;
}
function render() {
  refreshClasses();
  const current = currentClass();
  $("#classSelect").innerHTML = classes.length ? classes.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === scores.selectedClassId ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("") : '<option value="">尚未建立班別</option>';
  $("#classSelect").disabled = !classes.length;
  $("#className").textContent = current?.name || "—";
  $("#studentCount").textContent = current?.students.length || 0;
  $("#classTotal").textContent = current ? classEntries(current).reduce((sum, entry) => sum + (Number.isFinite(entry.points) ? entry.points : 0), 0) : 0;
  $("#classPlants").textContent = `${current ? current.students.reduce((sum, student) => sum + plantInfo(student.id).completed, 0) : 0} 棵`;
  $("#multiButton").setAttribute("aria-pressed", String(multiMode));
  $("#multiButton").textContent = multiMode ? "完成多選" : "多選學生";
  const query = $("#studentSearch").value.trim().toLocaleLowerCase();
  const students = current ? sortedStudents(current.students).filter(student => `${student.seat || ""} ${student.name || ""} ${student.englishName || ""}`.toLocaleLowerCase().includes(query)) : [];
  $("#studentGrid").innerHTML = students.map(studentCard).join("");
  const empty = $("#emptyState");
  empty.hidden = Boolean(students.length);
  empty.innerHTML = !current ? '<h2>尚未建立班別</h2><p>請先到班別管理建立班別和學生名單。</p><a href="./class-management.html" target="_top">前往班別管理</a>' : !current.students.length ? '<h2>這個班別尚未有學生</h2><p>加入學生後即可記錄加分及減分。</p><a href="./class-management.html" target="_top">加入學生</a>' : '<h2>找不到相符的學生</h2><p>請嘗試其他姓名或座號。</p>';
  $("#selectionBar").hidden = !multiMode || !selectedIds.size;
  $("#selectionCount").textContent = `已選 ${selectedIds.size} 位學生`;
}
function recipients() { const current = currentClass(); return current ? sortedStudents(current.students).filter(student => selectedIds.has(student.id)) : []; }
function renderRules() {
  $("#positiveTab").setAttribute("aria-selected", String(activeKind === "positive"));
  $("#negativeTab").setAttribute("aria-selected", String(activeKind === "negative"));
  const rules = scores.rules.filter(rule => rule.kind === activeKind);
  const cards = rules.map(rule => `<button type="button" class="rule-card ${activeKind}" data-rule-id="${escapeHtml(rule.id)}"><span><strong>${escapeHtml(rule.name)}</strong><small>${activeKind === "positive" ? `灌溉 +${rule.points}` : `灌溉 −${rule.points}`}</small></span><b>${activeKind === "positive" ? "+" : "−"}${rule.points}</b></button>`).join("");
  const customLabel = activeKind === "positive" ? "自訂加分" : "自訂減分";
  const customCard = `<button type="button" id="customScoreButton" class="rule-card custom-score-button ${activeKind}"><span><strong>${customLabel}</strong><small>選擇原因，調整今次分值</small></span><b>${activeKind === "positive" ? "+" : "−"}</b></button>`;
  $("#ruleList").innerHTML = (cards || '<p class="history-empty">尚未有這類項目；可自訂今次原因及分值。</p>') + customCard;
}
function openScoreDialog() {
  const people = recipients();
  if (!people.length) return;
  activeKind = "positive";
  pendingDeduction = null;
  $("#deductionConfirm").hidden = true;
  $("#customScoreForm").hidden = true;
  $("#customScoreForm").reset();
  $("#scoreDialogTitle").textContent = `為 ${people.length === 1 ? people[0].name : `${people.length} 位學生`}加分／減分`;
  $("#recipientSummary").hidden = people.length === 1;
  $("#recipientSummary").textContent = people.length === 1 ? "" : `對象：${people.map(student => student.name).join("、")}`;
  renderRules();
  $("#scoreDialog").showModal();
}
function applyRule(rule) {
  const current = currentClass();
  const people = recipients();
  if (!current || !people.length || !rule) return;
  const before = new Map(people.map(student => [student.id, plantInfo(student.id)]));
  const points = rule.kind === "negative" ? -rule.points : rule.points;
  const createdAt = new Date().toISOString();
  const batchId = makeId("batch");
  const entries = people.map(student => ({ id: makeId("entry"), batchId, classId: current.id, studentId: student.id, studentName: student.name, plantCycleId: ensurePlantRecord(student.id).cycles.at(-1).id, ruleId: rule.id, reason: rule.name, points, createdAt }));
  scores.entries.push(...entries);
  try { persist(); } catch { scores.entries.splice(-entries.length); toast("儲存失敗，請檢查裝置儲存空間。"); return; }
  const after = new Map(people.map(student => [student.id, plantInfo(student.id)]));
  const grown = people.filter(student => after.get(student.id).completed > before.get(student.id).completed).length;
  const advanced = people.filter(student => after.get(student.id).level > before.get(student.id).level).length;
  const regressed = people.filter(student => after.get(student.id).level < before.get(student.id).level).length;
  $("#scoreDialog").close();
  selectedIds.clear();
  recentlyWateredIds = points > 0 ? new Set(people.map(student => student.id)) : new Set();
  render();
  if (recentlyWateredIds.size) setTimeout(() => { recentlyWateredIds.clear(); document.querySelectorAll(".student-card.just-watered").forEach(card => card.classList.remove("just-watered")); }, 1400);
  const growthMessage = grown ? `，${grown} 棵植物長成` : advanced ? `，${advanced} 位學生的植物升級` : regressed ? `，${regressed} 位學生的植物倒退` : "";
  toast(`已為 ${people.length} 位學生記錄「${rule.name}」${signed(points)} 分${growthMessage}`, batchId);
}
function renderManageRules() {
  $("#manageRuleList").innerHTML = ["positive", "negative"].map(kind => `<section><h3>${kind === "positive" ? "加分項" : "減分項"}</h3>${scores.rules.filter(rule => rule.kind === kind).map(rule => `<div class="manage-rule"><span>${escapeHtml(rule.name)} <b class="${kind}">${kind === "positive" ? "+" : "−"}${rule.points}</b></span><div><button type="button" data-edit-rule="${escapeHtml(rule.id)}">修改</button><button type="button" data-delete-rule="${escapeHtml(rule.id)}">刪除</button></div></div>`).join("") || '<p class="history-empty">暫無項目</p>'}</section>`).join("");
}
function resetRuleForm() { $("#ruleForm").reset(); $("#ruleId").value = ""; $("#saveRule").textContent = "新增項目"; $("#cancelRuleEdit").hidden = true; }
$("#classSelect").addEventListener("change", event => { scores.selectedClassId = event.target.value; selectedIds.clear(); persist(); render(); });
$("#studentSearch").addEventListener("input", render);
$("#multiButton").addEventListener("click", () => { multiMode = !multiMode; selectedIds.clear(); render(); });
$("#clearSelection").addEventListener("click", () => { selectedIds.clear(); render(); });
$("#applySelection").addEventListener("click", openScoreDialog);
$("#studentGrid").addEventListener("click", event => { const button = event.target.closest("[data-student-id]"); if (!button) return; const id = button.dataset.studentId; if (multiMode) { selectedIds.has(id) ? selectedIds.delete(id) : selectedIds.add(id); render(); } else { selectedIds = new Set([id]); openScoreDialog(); } });
$("#studentGrid").addEventListener("click", event => {
  const button = event.target.closest("[data-replant-student-id]");
  if (!button) return;
  const student = currentClass()?.students.find(item => item.id === button.dataset.replantStudentId);
  if (!student || !plantInfo(student.id).canReplant || !confirm(`為「${student.name}」種下一棵植物？已長成的植物會保留在總數中。`)) return;
  const record = ensurePlantRecord(student.id);
  const cycle = { id: makeId("plant"), plantedAt: new Date().toISOString() };
  record.cycles.push(cycle);
  try { persist(); } catch { record.cycles.pop(); toast("儲存失敗，請檢查裝置儲存空間。"); return; }
  render();
  toast(`已為 ${student.name} 種下一棵植物`);
});
$("#scoreDialog").addEventListener("click", event => {
  const tab = event.target.closest("[data-kind]");
  if (tab) { activeKind = tab.dataset.kind; pendingDeduction = null; $("#deductionConfirm").hidden = true; $("#customScoreForm").hidden = true; renderRules(); return; }
  if (event.target.closest("#customScoreButton")) {
    const rules = scores.rules.filter(rule => rule.kind === activeKind);
    const positive = activeKind === "positive";
    $("#customScoreForm").reset();
    $("#customScoreReason").innerHTML = rules.map(rule => `<option value="${escapeHtml(rule.id)}">${escapeHtml(rule.name)}</option>`).join("") + '<option value="__custom__">其他（自填原因）</option>';
    $("#customScoreReason").value = rules[0]?.id || "__custom__";
    $("#customScorePoints").value = rules[0]?.points || 1;
    $("#customScoreNameField").hidden = Boolean(rules.length);
    $("#customScoreName").required = !rules.length;
    $("#customScoreTitle").textContent = `自訂${positive ? "加分" : "減分"}（只適用於今次）`;
    $("#customScoreHelp").textContent = positive ? "可沿用現有原因，單獨調整今次分值；預設項目不會更改。" : "可沿用現有原因，單獨調整今次分值；確認後才會扣分。";
    $("#submitCustomScore").textContent = positive ? "確認加分" : "繼續確認減分";
    $("#customScoreForm").classList.toggle("negative", !positive);
    $("#deductionConfirm").hidden = true;
    updateCustomScorePreview();
    $("#customScoreForm").hidden = false;
    $("#customScorePoints").focus();
    return;
  }
  const button = event.target.closest("[data-rule-id]");
  if (!button) return;
  const rule = scores.rules.find(item => item.id === button.dataset.ruleId);
  if (!rule) return;
  if (rule.kind === "negative") { showDeductionConfirm(rule); }
  else applyRule(rule);
});
function updateCustomScorePreview() {
  const points = Number($("#customScorePoints").value);
  const amount = Number.isInteger(points) && points > 0 && points <= 99 ? `${activeKind === "negative" ? "−" : "+"}${points}` : "—";
  $("#customScorePreview").textContent = `每位學生今次${activeKind === "negative" ? "減分" : "加分"}：${amount} 分`;
}
function showDeductionConfirm(rule) {
  pendingDeduction = { id: rule.id, name: rule.name, kind: "negative", points: rule.points };
  $("#customScoreForm").hidden = true;
  $("#deductionMessage").textContent = `將因「${rule.name}」為 ${recipients().length} 位學生各記錄 −${rule.points} 分。`;
  $("#deductionConfirm").hidden = false;
  $("#confirmDeduction").focus();
}
$("#customScoreReason").addEventListener("change", event => {
  const rule = scores.rules.find(item => item.kind === activeKind && item.id === event.target.value);
  $("#customScoreNameField").hidden = Boolean(rule);
  $("#customScoreName").required = !rule;
  $("#customScorePoints").value = rule?.points || 1;
  updateCustomScorePreview();
  if (!rule) $("#customScoreName").focus();
});
$("#customScorePoints").addEventListener("input", updateCustomScorePreview);
$("#cancelCustomScore").addEventListener("click", () => { $("#customScoreForm").hidden = true; });
$("#customScoreForm").addEventListener("submit", event => {
  event.preventDefault();
  const rule = scores.rules.find(item => item.kind === activeKind && item.id === $("#customScoreReason").value);
  const name = rule?.name || $("#customScoreName").value.trim();
  const points = Number($("#customScorePoints").value);
  if (!name || !Number.isInteger(points) || points < 1 || points > 99) { toast("請填寫原因及 1 至 99 的整數分值。"); return; }
  const oneOffRule = { id: rule?.id || null, name, kind: activeKind, points };
  if (activeKind === "negative") showDeductionConfirm(oneOffRule);
  else applyRule(oneOffRule);
});
$("#cancelDeduction").addEventListener("click", () => { pendingDeduction = null; $("#deductionConfirm").hidden = true; });
$("#confirmDeduction").addEventListener("click", () => { if (pendingDeduction?.kind === "negative") applyRule(pendingDeduction); });
$("#rulesButton").addEventListener("click", () => { resetRuleForm(); renderManageRules(); $("#rulesDialog").showModal(); });
$("#ruleForm").addEventListener("submit", event => {
  event.preventDefault();
  const name = $("#ruleName").value.trim();
  const kind = $("#ruleKind").value;
  const points = Number($("#rulePoints").value);
  if (!name || !["positive", "negative"].includes(kind) || !Number.isInteger(points) || points < 1 || points > 99) { toast("請填寫名稱及 1 至 99 的整數分值。"); return; }
  const id = $("#ruleId").value;
  if (id) { const rule = scores.rules.find(item => item.id === id); if (!rule) return; Object.assign(rule, { name, kind, points }); }
  else scores.rules.push({ id: makeId("rule"), name, kind, points });
  persist(); resetRuleForm(); renderManageRules(); toast(id ? "項目已修改" : "項目已新增");
});
$("#cancelRuleEdit").addEventListener("click", resetRuleForm);
$("#manageRuleList").addEventListener("click", event => {
  const edit = event.target.closest("[data-edit-rule]");
  if (edit) { const rule = scores.rules.find(item => item.id === edit.dataset.editRule); if (!rule) return; $("#ruleId").value = rule.id; $("#ruleName").value = rule.name; $("#ruleKind").value = rule.kind; $("#rulePoints").value = rule.points; $("#saveRule").textContent = "儲存修改"; $("#cancelRuleEdit").hidden = false; $("#ruleName").focus(); return; }
  const remove = event.target.closest("[data-delete-rule]");
  if (remove) { const rule = scores.rules.find(item => item.id === remove.dataset.deleteRule); if (!rule || !confirm(`刪除項目「${rule.name}」？已記錄的分數會保留。`)) return; scores.rules = scores.rules.filter(item => item.id !== rule.id); persist(); resetRuleForm(); renderManageRules(); toast("項目已刪除"); }
});
$("#toast").addEventListener("click", event => {
  const button = event.target.closest("[data-undo-batch]");
  if (!button) return;
  const entries = scores.entries.filter(item => item.batchId === button.dataset.undoBatch);
  if (!entries.length) return;
  const previousEntries = scores.entries;
  scores.entries = scores.entries.filter(item => item.batchId !== button.dataset.undoBatch);
  try { persist(); } catch { scores.entries = previousEntries; toast("撤銷失敗，請檢查裝置儲存空間。"); return; }
  render();
  toast("剛才的操作已撤銷");
});
document.addEventListener("click", event => { const button = event.target.closest("[data-close]"); if (button) $("#" + button.dataset.close)?.close(); });
$("#scoreDialog").addEventListener("close", () => { pendingDeduction = null; if (!multiMode) selectedIds.clear(); render(); });
window.addEventListener("pageshow", render);
window.addEventListener("storage", event => { if (event.key === CLASS_KEY) { selectedIds.clear(); render(); } if (event.key === SCORE_KEY) { scores = loadScores(); selectedIds.clear(); render(); } });
render();
