// draw-board client (trusted.page). Imported by the game page after every player consents.
// Alt toggles "paint mode": while it is on the screen dims, the circular toolbar shows and dragging paints
// (brush or eraser). Paint mode off restores the game and hides the toolbar. Strokes are posted to the relay
// and polled back so every player in the room sees the same board.
(() => {
if (window.__drawBoardInstalled) return;
window.__drawBoardInstalled = true;

const MAX_POINTS = 400; // per posted chunk, matches the server

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_INDEX = (() => { const m = Object.create(null); for (let i = 0; i < B64.length; i++) m[B64[i]] = i; return m; })();

function encodePoints(pts) {
  let out = '';
  for (let i = 0; i + 1 < pts.length; i += 2) {
    const x = Math.max(0, Math.min(4095, Math.round(pts[i] * 4095)));
    const y = Math.max(0, Math.min(4095, Math.round(pts[i + 1] * 4095)));
    const v = (x << 12) | y;
    out += B64[(v >>> 18) & 63] + B64[(v >>> 12) & 63] + B64[(v >>> 6) & 63] + B64[v & 63];
  }
  return out;
}

function decodePoints(s) {
  const out = [];
  if (typeof s !== 'string') return out;
  for (let i = 0; i + 3 < s.length; i += 4) {
    const a = B64_INDEX[s[i]], b = B64_INDEX[s[i + 1]], c = B64_INDEX[s[i + 2]], d = B64_INDEX[s[i + 3]];
    if (a === undefined || b === undefined || c === undefined || d === undefined) continue;
    const v = (a << 18) | (b << 12) | (c << 6) | d;
    out.push((v >> 12) / 4095, (v & 4095) / 4095);
  }
  return out;
}

// The room this page is in, kept in step with the game's own store (the SPA can change rooms without a reload).
const appStore = globalThis.__SP__ && globalThis.__SP__.store;
let currentRoom = '';
function readRoom() {
  try { return (appStore && appStore.get && appStore.get().room && appStore.get().room.code) || ''; } catch { return ''; }
}
function syncRoom() {
  const r = readRoom();
  if (r === currentRoom) return;
  currentRoom = r;
  strokes.length = 0;
  lastSeq = 0;
  ctx.clearRect(0, 0, W, H);
}

// This player's id ('p_' + 10 hex): the relay requires it so only room members can read or write strokes.
function readPid() {
  try { return (appStore && appStore.get && appStore.get().me && appStore.get().me.playerId) || ''; } catch { return ''; }
}

// ---- state ----
let paintMode = false;
let tool = 'brush'; // 'brush' | 'eraser'
let color = '#ff2d55';
let width = 8;

// ---- canvas ----
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');
let W = 1, H = 1;

function resize() {
  const dpr = window.devicePixelRatio || 1;
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.max(1, Math.round(W * dpr));
  canvas.height = Math.max(1, Math.round(H * dpr));
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  redrawAll();
}

canvas.style.cssText = 'position:fixed;inset:0;z-index:2147483000;pointer-events:none;touch-action:none;';
(document.documentElement || document.body).appendChild(canvas);

// The dim layer behind the ink (below the canvas, above the game) — visible only in paint mode.
const dim = document.createElement('div');
dim.style.cssText = 'position:fixed;inset:0;z-index:2147482990;pointer-events:none;background:rgba(0,0,0,0.4);display:none;';
(document.documentElement || document.body).appendChild(dim);

// Every stroke this page knows (its own and remote), in draw order, points normalized to 0..1.
const strokes = [];

function drawStroke(s) {
  const n = s.points.length;
  if (n < 2) return;
  ctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';
  ctx.strokeStyle = s.erase ? 'rgba(0,0,0,1)' : s.color;
  ctx.lineWidth = s.width;
  ctx.beginPath();
  ctx.moveTo(s.points[0] * W, s.points[1] * H);
  for (let i = 2; i + 1 < n; i += 2) ctx.lineTo(s.points[i] * W, s.points[i + 1] * H);
  ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';
}

function redrawAll() {
  ctx.clearRect(0, 0, W, H);
  for (const s of strokes) drawStroke(s);
}

function paintSegment(x0, y0, x1, y1, erase) {
  ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
  ctx.strokeStyle = erase ? 'rgba(0,0,0,1)' : color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';
}

// ---- mode ----
function setPaintMode(on) {
  paintMode = on;
  dim.style.display = on ? 'block' : 'none';
  dock.style.display = on ? 'block' : 'none';
  if (on) { updateCenter(); canvas.style.pointerEvents = 'auto'; canvas.style.cursor = 'crosshair'; }
  else { canvas.style.pointerEvents = 'none'; canvas.style.cursor = ''; }
}

// ---- input ----
let drawing = false;
let curPts = [];
let lastX = 0, lastY = 0;

function inEditor() {
  const el = document.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Alt') {
    if (e.repeat) return;
    e.preventDefault();
    setPaintMode(!paintMode);
    if (!paintMode && drawing) finishStroke();
    return;
  }
  if (inEditor() || !paintMode) return;
  const k = e.key.toLowerCase();
  if (k === 'b' || k === 'p') { setTool('brush'); }
  else if (k === 'e') { setTool('eraser'); }
  else if (e.key === '[') { width = Math.max(2, width - 4); updateCenter(); }
  else if (e.key === ']') { width = Math.min(64, width + 4); updateCenter(); }
  else if (e.key === 'Escape') { setPaintMode(false); }
});

window.addEventListener('blur', () => { if (drawing) finishStroke(); setPaintMode(false); });
window.addEventListener('resize', resize);

canvas.addEventListener('pointerdown', (e) => {
  if (!paintMode || drawing) return;
  e.preventDefault();
  drawing = true;
  curPts = [];
  const p = [e.clientX / W, e.clientY / H];
  curPts.push(p[0], p[1]);
  lastX = p[0] * W; lastY = p[1] * H;
  try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
});

canvas.addEventListener('pointermove', (e) => {
  if (!drawing) return;
  e.preventDefault();
  const p = [e.clientX / W, e.clientY / H];
  curPts.push(p[0], p[1]);
  const x = p[0] * W, y = p[1] * H;
  paintSegment(lastX, lastY, x, y, tool === 'eraser');
  lastX = x; lastY = y;
});

function finishStroke() {
  drawing = false;
  if (curPts.length >= 4) {
    const s = { color, width, erase: tool === 'eraser', points: curPts };
    strokes.push(s);
    sendStroke(s);
  }
  curPts = [];
}

canvas.addEventListener('pointerup', finishStroke);
canvas.addEventListener('pointercancel', finishStroke);

// ---- relay ----
async function postStroke(room, s, pts) {
  const pid = readPid();
  const q = new URLSearchParams({ room, pid, c: s.color.slice(1), w: String(s.width), e: s.erase ? '1' : '0' });
  q.set('p', encodePoints(pts));
  try { await fetch(`/x/draw-board/strokes?${q.toString()}`, { method: 'POST', cache: 'no-store' }); } catch { /* offline: local drawing still works */ }
}

function sendStroke(s) {
  if (!currentRoom) return;
  for (let i = 0; i < s.points.length; i += MAX_POINTS * 2) void postStroke(currentRoom, s, s.points.slice(i, i + MAX_POINTS * 2));
}

let lastSeq = 0;
async function poll() {
  if (!currentRoom) return;
  const pid = readPid();
  try {
    const res = await fetch(`/x/draw-board/strokes?room=${currentRoom}&pid=${pid}&since=${lastSeq}`, { cache: 'no-store' });
    const data = await res.json();
    if (!data || data.ok !== true) return;
    for (const ev of data.events || []) {
      if (typeof ev.seq !== 'number' || ev.seq <= lastSeq) continue;
      lastSeq = ev.seq;
      if (ev.t === 'c') { strokes.length = 0; ctx.clearRect(0, 0, W, H); }
      else if (ev.t === 's' && ev.color && typeof ev.width === 'number' && Array.isArray(ev.points) && ev.points.length >= 4) {
        const s = { color: '#' + ev.color, width: ev.width, erase: !!ev.erase, points: ev.points };
        strokes.push(s);
        drawStroke(s);
      }
    }
    if (typeof data.seq === 'number' && data.seq > lastSeq) lastSeq = data.seq;
  } catch { /* relay unreachable; keep polling */ }
}
setInterval(poll, 150);

async function clearAll() {
  strokes.length = 0;
  ctx.clearRect(0, 0, W, H);
  if (currentRoom) try { await fetch(`/x/draw-board/clear?room=${currentRoom}&pid=${readPid()}`, { method: 'POST', cache: 'no-store' }); } catch { /* ignore */ }
}

// ---- circular toolbar (visible in paint mode) ----
const PRESETS = ['#ff2d55', '#ff9500', '#ffd60a', '#30d158', '#0a84ff', '#bf5af2', '#ffffff', '#000000'];
let presetIndex = 0;

const RING = 68;   // radius of the button ring
const DOCK = 180;  // dock disc hit area
const CENTER = 64; // center disc diameter
const BTN = 42;    // ring button diameter

const dock = document.createElement('div');
dock.style.cssText = `position:fixed;left:24px;bottom:24px;width:${DOCK}px;height:${DOCK}px;z-index:2147483100;`
  + 'border-radius:50%;pointer-events:none;display:none;user-select:none;touch-action:none;';
(document.documentElement || document.body).appendChild(dock);

function disc(label, title, size, bg) {
  const b = document.createElement('button');
  b.textContent = label;
  b.title = title;
  b.style.cssText = `position:absolute;left:${DOCK / 2 - size / 2}px;top:${DOCK / 2 - size / 2}px;width:${size}px;height:${size}px;`
    + 'border-radius:50%;border:1px solid rgba(255,255,255,0.25);color:#fff;cursor:pointer;pointer-events:auto;'
    + 'font:16px/1 system-ui,sans-serif;display:flex;align-items:center;justify-content:center;'
    + `background:${bg};`;
  return b;
}

const center = disc('', '点击切换预设颜色', CENTER, color);
const brushBtn = disc('🖌️', '画笔 (B)', BTN, 'rgba(10,132,255,0.7)');
const eraserBtn = disc('🧽', '橡皮 (E)', BTN, 'rgba(120,120,128,0.7)');
const plusBtn = disc('➕', '加粗 (])', BTN, 'rgba(48,209,88,0.7)');
const minusBtn = disc('➖', '变细 ([)', BTN, 'rgba(10,132,255,0.7)');
const clearBtn = disc('🗑️', '清空所有人的涂鸦', BTN, 'rgba(255,59,48,0.7)');

// 颜色：用 label 包住原生取色器，点击 label 由浏览器转发打开（程序化 .click() 在部分浏览器打不开）。
const colorLabel = document.createElement('label');
colorLabel.title = '颜色';
colorLabel.style.cssText = `position:absolute;width:${BTN}px;height:${BTN}px;border-radius:50%;border:1px solid rgba(255,255,255,0.25);`
  + 'cursor:pointer;pointer-events:auto;display:flex;align-items:center;justify-content:center;'
  + 'font:16px/1 system-ui,sans-serif;background:rgba(255,149,0,0.7);';
const colorInput = document.createElement('input');
colorInput.type = 'color';
colorInput.value = color;
colorInput.style.cssText = 'position:absolute;opacity:0;width:1px;height:1px;';
colorLabel.appendChild(colorInput);
const colorIcon = document.createElement('span');
colorIcon.textContent = '🎨';
colorIcon.style.cssText = 'pointer-events:none;';
colorLabel.appendChild(colorIcon);

function place(el, angleDeg) {
  const a = angleDeg * Math.PI / 180;
  el.style.left = (DOCK / 2 + Math.cos(a) * RING - BTN / 2) + 'px';
  el.style.top = (DOCK / 2 + Math.sin(a) * RING - BTN / 2) + 'px';
}
place(brushBtn, -90); place(eraserBtn, -30); place(colorLabel, 30); place(plusBtn, 90); place(minusBtn, 150); place(clearBtn, 210);

for (const el of [brushBtn, eraserBtn, colorLabel, plusBtn, minusBtn, clearBtn, center]) dock.appendChild(el);

function updateCenter() {
  center.style.fontSize = '15px';
  if (tool === 'eraser') { center.style.background = 'rgba(120,120,128,0.95)'; center.textContent = 'E' + width; }
  else { center.style.background = color; center.textContent = String(width); }
  const ring = '0 0 0 3px #ffffff, 0 0 16px rgba(255,255,255,0.65)';
  brushBtn.style.background = tool === 'brush' ? 'rgba(10,132,255,0.95)' : 'rgba(10,132,255,0.28)';
  brushBtn.style.boxShadow = tool === 'brush' ? ring : 'none';
  eraserBtn.style.background = tool === 'eraser' ? 'rgba(150,150,160,0.95)' : 'rgba(120,120,128,0.32)';
  eraserBtn.style.boxShadow = tool === 'eraser' ? ring : 'none';
}

function setTool(t) { tool = t; updateCenter(); }
function setColor(c) {
  if (!/^#[0-9a-f]{6}$/i.test(c)) return;
  color = c.toLowerCase();
  colorInput.value = color;
  updateCenter();
}

brushBtn.addEventListener('click', () => setTool('brush'));
eraserBtn.addEventListener('click', () => setTool('eraser'));
plusBtn.addEventListener('click', () => { width = Math.min(64, width + 4); updateCenter(); });
minusBtn.addEventListener('click', () => { width = Math.max(2, width - 4); updateCenter(); });
clearBtn.addEventListener('click', () => clearAll());
center.addEventListener('click', () => { presetIndex = (presetIndex + 1) % PRESETS.length; setColor(PRESETS[presetIndex]); });
colorInput.addEventListener('input', () => setColor(colorInput.value));

updateCenter();
resize();
if (appStore && appStore.subscribe) appStore.subscribe(syncRoom);
syncRoom();
})();
