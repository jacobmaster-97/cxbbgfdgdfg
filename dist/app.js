const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  announce: localStorage.getItem("announce") !== "off",
  monthOffset: 0,
  score: 28,
  toastTimer: null,
  exam: {
    schedule: null,
    clockAnchor: null,
    timerId: null,
    wakeLock: null,
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
const WHITEBOARD_STORAGE_KEYS = {
  board: "teacher-dashboard-whiteboards-v1",
  homework: "teacher-dashboard-homework-papers-v1",
};
const HOMEWORK_BACKGROUNDS = {
  gridFine: { label: "幼方格功課紙", asset: "./assets/homework-grid-fine.png", ratio: "1119 / 1405" },
  gridWide: { label: "大方格功課紙", asset: "./assets/homework-grid-wide.png", ratio: "1118 / 1407" },
  lined: { label: "橫線功課紙", asset: "./assets/homework-lined.png", ratio: "1121 / 1403" },
};

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
const bingoGame = $("#bingoGame");
const treasureGame = $("#treasureGame");

function pad(value) { return String(value).padStart(2, "0"); }

function updateClock() {
  const now = new Date();
  const display = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
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
  grid.innerHTML = cells.map(({ day, muted }) => `<button type="button" class="${muted ? "is-muted" : ""} ${!muted && day === now.getDate() && month === now.getMonth() && year === now.getFullYear() ? "is-today" : ""}" data-day="${day}" ${muted ? "aria-label=\"相鄰月份\"" : ""}>${day}</button>`).join("");
  $$("button:not(.is-muted)", grid).forEach(button => button.addEventListener("click", () => {
    $$("button", grid).forEach(item => item.classList.remove("is-today"));
    button.classList.add("is-today");
    $("#selectedEvent").innerHTML = `<span></span> ${button.dataset.day}日：尚未加入事項`;
  }));
}

const descriptions = {
  "班別管理": ["管理班別與學生名單", "這是班別管理的示範入口。完整版本可加入出席、分組與學生資料。"],
  "加分": ["課堂即時加分", "點按下方按鈕可示範全班累積分數。"],
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
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (Array.isArray(saved?.boards) && saved.boards.length) {
      state.whiteboard.boards = saved.boards;
      state.whiteboard.activeId = saved.activeId && saved.boards.some(board => board.id === saved.activeId) ? saved.activeId : saved.boards[0].id;
      return;
    }
  } catch {
    localStorage.removeItem(storageKey);
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
    localStorage.setItem(whiteboardStorageKey(), JSON.stringify({ boards: state.whiteboard.boards, activeId: state.whiteboard.activeId }));
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
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function parseLocalDateTime(dateValue, timeValue) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hours, minutes] = timeValue.split(":").map(Number);
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

function savedExamSettings() {
  const defaults = { subject: "", examDate: localDateValue(), startTime: "09:00", endTime: "10:30" };
  try {
    const saved = JSON.parse(localStorage.getItem(EXAM_SETTINGS_KEY));
    if (!saved) return defaults;
    return { ...defaults, ...saved };
  } catch {
    localStorage.removeItem(EXAM_SETTINGS_KEY);
    return defaults;
  }
}

function stopExamTimer() {
  if (state.exam.timerId) clearTimeout(state.exam.timerId);
  state.exam.timerId = null;
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
  state.exam.schedule = null;
  releaseWakeLock();
  const offset = -new Date().getTimezoneOffset() / 60;
  const zoneWarning = offset === 8 ? "" : `<p class="exam-timezone-warning">目前裝置時區為 UTC${offset >= 0 ? "+" : "−"}${Math.abs(offset)}，請先核對是否為香港時間（UTC+8）。</p>`;
  dialogBody.innerHTML = `<section class="exam-tool" aria-labelledby="examSetupTitle">
    <button type="button" class="timer-back" data-timer-hub="home">‹ 返回計時工具</button>
    <div class="exam-intro"><div><p class="exam-kicker">考試時間顯示器</p><h3 id="examSetupTitle">設定考試時間</h3><p>顯示會讀取此裝置的本機時間，適合投影到電子白板。</p></div><strong class="exam-device-time" id="examDeviceTime">${formatClock(new Date())}</strong></div>
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
  state.exam.schedule = { ...settings, start, end };
  state.exam.clockAnchor = { epoch: Date.now(), monotonic: performance.now() };
  localStorage.setItem(EXAM_SETTINGS_KEY, JSON.stringify(settings));
  const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
  projectionContent.innerHTML = `<div class="projection-meta"><p>${escapeHTML(formatFullDate(start))}</p><h1>${escapeHTML(settings.subject)}</h1><strong>${escapeHTML(settings.startTime)} 至 ${escapeHTML(settings.endTime)}（${minutes}分鐘）</strong></div>
    <div class="projection-clock-stage"><div class="projection-digital-block"><strong class="projection-digital-clock" id="projectionMainClock">--:--:--</strong><span class="sr-only" id="projectionStatus">尚未開始</span></div>
      <div class="projection-analog-clock" role="img" aria-label="目前時間的指針時鐘">${clockNumbers()}<i class="projection-hand projection-hour" id="projectionHourHand"></i><i class="projection-hand projection-minute" id="projectionMinuteHand"></i><i class="projection-hand projection-second" id="projectionSecondHand"></i><i class="projection-pin"></i></div></div>`;
  if (dialog.open) dialog.close();
  document.body.classList.add("is-projecting");
  examProjection.hidden = false;
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
  }
  if (Math.abs(Date.now() - timestamp) > 2500) $("#projectionAlert")?.classList.add("show");
  state.exam.timerId = setTimeout(updateExamDisplay, 250);
}

function exitExamProjection({ openSettings = false } = {}) {
  const settings = state.exam.schedule ? { ...state.exam.schedule } : savedExamSettings();
  stopExamTimer();
  releaseWakeLock();
  state.exam.schedule = null;
  examProjection.hidden = true;
  document.body.classList.remove("is-projecting");
  $("#projectionAlert")?.classList.remove("show");
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
  renderExamDisplay(settings);
}

function openApp(name) {
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
  dialogTitle.textContent = name;
  if (name === "加分") {
    dialogBody.innerHTML = `<div class="demo-card"><div class="score-preview"><div><h3>3A 全班積分</h3><p>今日課堂表現</p></div><strong id="scoreValue">${state.score}</strong></div><div class="demo-actions"><button class="primary-action" data-score="1">+1 分</button><button class="primary-action" data-score="2">+2 分</button><button class="secondary-action" data-demo-action="close">完成</button></div></div>`;
  } else if (name === "計時工具") {
    renderTimerHub();
  } else if (name === "設定") {
    dialogBody.innerHTML = `<div class="demo-card"><h3>顯示設定</h3><div class="settings-row"><span>介面色彩</span><div class="swatches"><button class="swatch" data-theme="sunset" aria-label="日落色"></button><button class="swatch" data-theme="ocean" aria-label="海洋色"></button><button class="swatch" data-theme="forest" aria-label="森林色"></button></div></div><label class="settings-row"><span>介面大小</span><input id="scaleSlider" type="range" min="90" max="115" value="100" /></label><div class="settings-row"><span>減少動畫</span><button class="secondary-action" data-demo-action="motion">切換</button></div></div>`;
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
  const lesson = event.target.closest(".lesson");
  if (lesson) {
    $$(".lesson").forEach(item => item.classList.remove("active"));
    lesson.classList.add("active");
    showToast(`已選擇 ${$("time", lesson).textContent} ${$("span", lesson).textContent}`);
  }
  const scoreButton = event.target.closest("[data-score]");
  if (scoreButton) {
    state.score += Number(scoreButton.dataset.score);
    $("#scoreValue").textContent = state.score;
    showToast(`已加 ${scoreButton.dataset.score} 分`);
  }
  const timerAction = event.target.closest("[data-timer-action]");
  if (timerAction) {
    const { timerAction: action } = timerAction.dataset;
    if (action === "clear") {
      localStorage.removeItem(EXAM_SETTINGS_KEY);
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
    if (projectionAction.dataset.projectionAction === "acknowledge") {
      state.exam.clockAnchor = { epoch: Date.now(), monotonic: performance.now() };
      $("#projectionAlert")?.classList.remove("show");
    }
  }
  const demoAction = event.target.closest("[data-demo-action]");
  if (demoAction?.dataset.demoAction === "close") closeApp();
  if (demoAction?.dataset.demoAction === "start") showToast(`${dialogTitle.textContent}示範已啟動`);
  if (demoAction?.dataset.demoAction === "motion") {
    document.body.classList.toggle("reduce-motion");
    showToast("動畫設定已切換");
  }
  const swatch = event.target.closest(".swatch");
  if (swatch) {
    const themes = { sunset: ["#ff875f", "#8658d7"], ocean: ["#23a6d5", "#5b4ad9"], forest: ["#28a078", "#365ca8"] };
    const [first, second] = themes[swatch.dataset.theme];
    $("#desktop").style.background = `radial-gradient(circle at 82% 13%, ${second} 0 18%, transparent 42%), linear-gradient(135deg, ${first}, ${second})`;
    showToast("主題色彩已更新");
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
    case "toggle-timer": $("#wbTimer").classList.toggle("is-collapsed"); break;
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
dialog.addEventListener("click", event => { if (event.target === dialog) closeApp(); });
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
window.addEventListener("resize", () => { if (!whiteboard.hidden) resizeWhiteboardCanvas(); });
announceToggle.addEventListener("click", () => {
  state.announce = !state.announce;
  localStorage.setItem("announce", state.announce ? "on" : "off");
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
  if (event.target.id === "scaleSlider") document.documentElement.style.setProperty("--scale", event.target.value / 100);
  if (event.target.id === "standaloneMinutes" || event.target.id === "standaloneSeconds") resetStandaloneTimer();
});

updateAnnouncement();
updateFullscreenButton();
buildCalendar();
updateClock();
setInterval(updateClock, 1000);
