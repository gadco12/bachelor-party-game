const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;
const HOST_KEY = process.env.HOST_KEY || 'GAD2025';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Single global game ──
let game = freshGame();
let sseClients = [];

function freshGame() {
  return { players: {}, status: 'waiting', results: null };
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ── Compatibility scoring ──
function pairScore(x, y) {
  let s = 0;

  // Sleep duration (15) — most critical for roommates
  const d = Math.abs((x.sleep || 7) - (y.sleep || 7));
  s += d === 0 ? 15 : d === 1 ? 7 : 0;

  // Music (8)
  s += x.music === y.music ? 8 : 0;

  // Sleep conditions (10)
  s += x.sleepCond === y.sleepCond ? 10 : 0;

  // Shower/poop (12)
  s += x.shower === y.shower ? 12 : 0;

  // Snoring (8)
  s += x.snoring === y.snoring ? 8 : 0;

  // Wait 45 min (5)
  s += x.wait45 === y.wait45 ? 5 : 0;

  // Gad music at night (10)
  if (x.gadMusic === 'yes' && y.gadMusic === 'yes') s += 10;
  else if (x.gadMusic === 'no' && y.gadMusic === 'no') s += 10;
  else if (x.gadMusic === 'depends' && y.gadMusic === 'depends') s += 7;
  else if ((x.gadMusic === 'yes' && y.gadMusic === 'no') || (x.gadMusic === 'no' && y.gadMusic === 'yes')) s -= 5;
  else s += 3;

  // Drugs (10)
  s += x.drugs === y.drugs ? 10 : 0;

  // Living creature (12)
  if (x.creature === 'no' && y.creature === 'no') s += 12;
  else if (x.creature === y.creature) s += 6;

  // Towel (4)
  s += x.towel === y.towel ? 4 : 0;

  // 500 shekel (4)
  s += x.money === y.money ? 4 : 0;

  // Body count proximity (5)
  const co = ['low', 'medium', 'high', 'lost'];
  const ci = co.indexOf(x.bodyCount), cj = co.indexOf(y.bodyCount);
  if (ci >= 0 && cj >= 0) s += Math.abs(ci - cj) <= 1 ? 5 : 0;

  // Vanilla → unhinged proximity (6)
  const vo = ['vanilla', 'sprinkles', 'rocky', 'unhinged'];
  const vi = vo.indexOf(x.vanilla), vj = vo.indexOf(y.vanilla);
  if (vi >= 0 && vj >= 0) s += Math.abs(vi - vj) <= 1 ? 6 : 0;

  // Hotel hookup (5)
  s += x.hotelHookup === y.hotelHookup ? 5 : 0;

  // Drunk alter ego (4)
  s += x.drunkEgo === y.drunkEgo ? 4 : 0;

  // Faked it (3)
  s += x.fakedIt === y.fakedIt ? 3 : 0;

  // Morning (3)
  s += x.morning === y.morning ? 3 : 0;

  // Monkey (4)
  if (x.monkey === y.monkey) s += 4;
  else if (x.monkey !== 'no' && y.monkey !== 'no') s += 2;

  // Lights on/off (6)
  s += x.lights === y.lights ? 6 : 0;

  // Gay kiss for money (4)
  s += x.gayKiss === y.gayKiss ? 4 : 0;

  // Strip club vibe (5)
  s += x.stripClub === y.stripClub ? 5 : 0;

  // Talk during sex (4)
  s += x.sexTalk === y.sexTalk ? 4 : 0;

  // Gay friend support (3)
  s += x.gaySupport === y.gaySupport ? 3 : 0;

  // Beautiful woman judgment (4)
  s += x.beautifulWoman === y.beautifulWoman ? 4 : 0;

  // Life after love (3)
  s += x.lifeAfterLove === y.lifeAfterLove ? 3 : 0;

  // Above average (3)
  s += x.aboveAverage === y.aboveAverage ? 3 : 0;

  // Riddles (3 each)
  s += x.riddle1 === y.riddle1 ? 3 : 0;
  s += x.riddle2 === y.riddle2 ? 3 : 0;

  // Gad playlist (4)
  s += x.gadPlaylist === y.gadPlaylist ? 4 : 0;

  // Gad king (5) — always
  s += 5;

  // Falafel (2)
  s += x.falafel === y.falafel ? 2 : 0;

  // Luffy (3) — always
  s += 3;

  // Eyal Golan (3)
  s += x.eyal === y.eyal ? 3 : 0;

  // Ibiza (4)
  s += x.ibiza === y.ibiza ? 4 : 0;

  return Math.max(0, s);
}

const MAX_PAIR = 230;

function groupScore(grp, mat) {
  let t = 0;
  for (let i = 0; i < grp.length; i++)
    for (let j = i + 1; j < grp.length; j++)
      t += mat[grp[i]][grp[j]];
  return t;
}

function getGroupSizes(n) {
  const threes = Math.floor(n / 3), rem = n % 3;
  if (rem === 0) return Array(threes).fill(3);
  if (rem === 1) return threes > 0 ? [...Array(threes - 1).fill(3), 2, 2] : [1];
  return [...Array(threes).fill(3), 2];
}

const ROOM_NAMES = ['The Penthouse 🏰', 'The Loft 🌆', 'The Jungle Suite 🌴', 'The Cave 🦇', 'Suite 5 🏠', 'Suite 6 🏠'];

function getRoomTagline(players) {
  const as = players.map(p => p.answers);
  const tags = [];
  const avg = as.reduce((t, a) => t + (a.sleep || 7), 0) / as.length;
  tags.push(avg <= 4 ? '🦇 The Sleep Resisters' : avg >= 7.5 ? '😴 The Beauty Sleep Council' : '⚖️ The Balanced Sleepers');
  const mv = {};
  as.forEach(a => mv[a.music] = (mv[a.music] || 0) + 1);
  const top = Object.entries(mv).sort((a, b) => b[1] - a[1])[0]?.[0];
  const ml = { EDM: '🎧 EDM Degenerates', HIPHOP: '🎤 Hip Hop Heads', TECHNO: '⚡ Techno Warriors', MIZRAHIT: '🎻 Mizrahit Forever' };
  if (top) tags.push(ml[top] || top);
  if (as.every(a => a.vanilla === 'unhinged')) tags.push('💀 The Unhinged Room');
  if (as.every(a => a.gadMusic === 'yes')) tags.push("🔊 Gad's Night Crew");
  return tags.slice(0, 2).join(' · ');
}

function runCalculation(players) {
  const n = players.length;
  const mat = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => i === j ? 0 : pairScore(players[i].answers, players[j].answers))
  );
  const sizes = getGroupSizes(n);
  let best = -Infinity, bestG = null;
  for (let it = 0; it < 3000; it++) {
    const ord = [...Array(n).keys()].sort(() => Math.random() - .5);
    const gs = []; let st = 0;
    for (const sz of sizes) { gs.push(ord.slice(st, st + sz)); st += sz; }
    const sc = gs.reduce((t, g) => t + groupScore(g, mat), 0);
    if (sc > best) { best = sc; bestG = gs.map(g => [...g]); }
  }
  return bestG.map((g, ri) => {
    const rp = g.map(i => players[i]);
    let total = 0, pairs = 0;
    for (let i = 0; i < g.length; i++)
      for (let j = i + 1; j < g.length; j++) { total += mat[g[i]][g[j]]; pairs++; }
    const pct = pairs ? Math.round((total / (pairs * MAX_PAIR)) * 100) : 0;
    return { name: ROOM_NAMES[ri] || `Room ${ri + 1}`, members: rp.map(p => p.name), pct, tagline: getRoomTagline(rp) };
  }).sort((a, b) => b.pct - a.pct);
}

// ── SSE broadcast ──
function publicGame() {
  return {
    status: game.status,
    results: game.results,
    players: Object.entries(game.players).map(([id, p]) => ({ id, name: p.name, done: !!p.answers }))
  };
}

function broadcast() {
  const data = `data: ${JSON.stringify(publicGame())}\n\n`;
  sseClients.forEach(res => { try { res.write(data); } catch (e) { } });
}

// ── API ──

// Join game
app.post('/api/join', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Nickname required' });
  const taken = Object.values(game.players).some(p => p.name.toLowerCase() === name.toLowerCase());
  if (taken) return res.status(400).json({ error: 'That nickname is taken!' });
  const id = genId();
  game.players[id] = { name, answers: null, joinedAt: Date.now() };
  broadcast();
  res.json({ playerId: id });
});

// Submit answers
app.post('/api/answers/:id', (req, res) => {
  const p = game.players[req.params.id];
  if (!p) return res.status(404).json({ error: 'Player not found' });
  p.answers = req.body.answers;
  broadcast();
  res.json({ ok: true });
});

// Get game state
app.get('/api/state', (req, res) => res.json(publicGame()));

// SSE stream
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  sseClients.push(res);
  res.write(`data: ${JSON.stringify(publicGame())}\n\n`);
  const ka = setInterval(() => res.write(': ka\n\n'), 20000);
  req.on('close', () => { clearInterval(ka); sseClients = sseClients.filter(c => c !== res); });
});

// ── Admin (host only) ──

function checkKey(req, res) {
  if (req.body?.key !== HOST_KEY && req.query?.key !== HOST_KEY) {
    res.status(403).json({ error: 'Wrong passkey' });
    return false;
  }
  return true;
}

// Verify passkey
app.post('/api/admin/verify', (req, res) => {
  if (req.body.key !== HOST_KEY) return res.status(403).json({ error: 'Wrong passkey' });
  res.json({ ok: true });
});

// Calculate rooms
app.post('/api/admin/calculate', (req, res) => {
  if (!checkKey(req, res)) return;
  const done = Object.values(game.players).filter(p => p.answers);
  if (done.length < 3) return res.status(400).json({ error: 'Need at least 3 players with answers' });
  game.results = runCalculation(done);
  game.status = 'done';
  broadcast();
  res.json({ ok: true });
});

// Edit results
app.put('/api/admin/results', (req, res) => {
  if (!checkKey(req, res)) return;
  if (!req.body.results) return res.status(400).json({ error: 'Results required' });
  game.results = req.body.results;
  broadcast();
  res.json({ ok: true });
});

// Reset game
app.post('/api/admin/reset', (req, res) => {
  if (!checkKey(req, res)) return;
  game = freshGame();
  sseClients.forEach(c => { try { c.write(`data: ${JSON.stringify(publicGame())}\n\n`); } catch (e) { } });
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`🎉 Server on port ${PORT}`));
