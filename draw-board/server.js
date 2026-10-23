// draw-board server relay (trusted.server). Runs in the dedicated trusted child process; the only thing the game calls
// is `activate(api)`. It keeps each live room's strokes in memory and exposes two HTTP routes under /x/draw-board/.
//
// The trusted HTTP bridge passes only `{ method, path, url }` to a route handler — no request body, no peer address —
// so all stroke data travels in the URL query string and a route cannot authenticate a caller. That leaves two attack
// surfaces this module closes as far as the bridge allows:
//
//   1. Memory exhaustion: an attacker POSTs/GETs with endlessly many fabricated room codes, each of which would be
//      kept forever. Fixed by an allow-list of rooms that actually exist (fed by the lobby's roomCreated/roomClosed
//      events), so fabricated codes are never stored, plus a defensive cap on tracked rooms and per-room byte/stroke
//      limits.
//   2. Flooding a real room: a per-room POST rate limit and the per-room byte cap bound the damage.

const MAX_ROOMS = 1024;            // defensive ceiling on tracked rooms (the lobby alone normally stays far below)
const MAX_STROKES = 4000;          // per room, events kept
const MAX_POINTS = 400;            // per single posted stroke (the client also splits at this size)
const MAX_BYTES = 2 * 1024 * 1024; // per room, rough point-storage budget
const POST_INTERVAL_MS = 50;       // per room, minimum gap between stroke posts (20/s is far above human drawing)

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_INDEX = (() => {
  const m = Object.create(null);
  for (let i = 0; i < B64.length; i++) m[B64[i]] = i;
  return m;
})();

// Live rooms, keyed by their join code, with the per-room storage they may write into.
const rooms = new Map(); // code -> { seq, events, lastPostAt }
const liveCodes = new Set(); // room codes the lobby says exist right now

function validRoom(code) {
  return typeof code === 'string' && /^[A-Za-z0-9]{1,16}$/.test(code);
}

function sanitizeColor(c) {
  if (typeof c !== 'string') return null;
  const m = /^([0-9a-f]{6})$/i.exec(c);
  return m ? m[1].toLowerCase() : null;
}

function sanitizeWidth(w) {
  const n = Number(w);
  return Number.isFinite(n) && Number.isInteger(n) && n >= 1 && n <= 64 ? n : null;
}

// 4 base64url chars = 24 bits = x (12 bits) + y (12 bits), each axis 0..4095.
function decodePoints(s) {
  const out = [];
  if (typeof s !== 'string' || !s) return out;
  for (let i = 0; i + 3 < s.length; i += 4) {
    const a = B64_INDEX[s[i]], b = B64_INDEX[s[i + 1]], c = B64_INDEX[s[i + 2]], d = B64_INDEX[s[i + 3]];
    if (a === undefined || b === undefined || c === undefined || d === undefined) continue;
    const v = (a << 18) | (b << 12) | (c << 6) | d;
    out.push((v >> 12) / 4095, (v & 4095) / 4095);
  }
  return out;
}

function strokeBytes(s) { return s.points ? s.points.length * 2 : 0; }

function trimRoom(r) {
  const cut = r.events.findIndex((e) => e.t === 'c');
  if (cut >= 0) r.events = r.events.slice(cut);
  let bytes = 0;
  for (const e of r.events) bytes += strokeBytes(e);
  while (r.events.length > MAX_STROKES) { bytes -= strokeBytes(r.events[0]); r.events.shift(); }
  while (bytes > MAX_BYTES && r.events.length > 1) { bytes -= strokeBytes(r.events[0]); r.events.shift(); }
}

export default function activate(api) {
  api.lobby.on('roomCreated', (ev) => {
    const code = ev && ev.room && ev.room.code;
    if (!validRoom(code)) return;
    if (liveCodes.size >= MAX_ROOMS && !liveCodes.has(code)) return;
    liveCodes.add(code);
    if (!rooms.has(code)) rooms.set(code, { seq: 0, events: [], lastPostAt: 0 });
  });

  api.lobby.on('roomClosed', (ev) => {
    const code = ev && ev.room && ev.room.code;
    if (!validRoom(code)) return;
    liveCodes.delete(code);
    rooms.delete(code);
  });

  api.http.route('/x/draw-board/strokes', (req) => {
    const u = new URL(req.url, 'http://localhost');
    const code = u.searchParams.get('room') || '';
    if (!validRoom(code) || !liveCodes.has(code)) return { ok: false, error: 'unknown room' };
    const r = rooms.get(code);

    if (req.method === 'POST') {
      const now = Date.now();
      if (now - r.lastPostAt < POST_INTERVAL_MS) return { ok: false, error: 'rate limited' };
      const color = sanitizeColor(u.searchParams.get('c'));
      const width = sanitizeWidth(u.searchParams.get('w'));
      const points = decodePoints(u.searchParams.get('p'));
      if (!color || width === null || points.length < 4 || points.length > MAX_POINTS * 2) return { ok: false, error: 'bad stroke' };
      r.lastPostAt = now;
      r.seq += 1;
      r.events.push({ seq: r.seq, t: 's', color, width, erase: u.searchParams.get('e') === '1', points });
      trimRoom(r);
      return { ok: true, seq: r.seq };
    }

    // GET: poll for events newer than `since` (a read of a live room; never allocates).
    const since = Math.max(0, parseInt(u.searchParams.get('since') || '0', 10) || 0);
    return { ok: true, seq: r.seq, events: r.events.filter((e) => e.seq > since) };
  });

  api.http.route('/x/draw-board/clear', (req) => {
    const u = new URL(req.url, 'http://localhost');
    const code = u.searchParams.get('room') || '';
    if (!validRoom(code) || !liveCodes.has(code)) return { ok: false, error: 'unknown room' };
    const r = rooms.get(code);
    r.seq += 1;
    r.events = [{ seq: r.seq, t: 'c' }];
    return { ok: true, seq: r.seq };
  });

  api.health.extend({
    rooms: liveCodes.size,
    strokes: [...rooms.values()].reduce((n, r) => n + r.events.filter((e) => e.t === 's').length, 0),
  });
}
