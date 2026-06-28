const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── In-memory storage ──
const rooms = {};
const sse = {}; // code -> [res, ...]

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do { code = Array.from({length:4}, ()=>chars[Math.floor(Math.random()*chars.length)]).join(''); }
  while (rooms[code]);
  return code;
}

// ── Compatibility algorithm ──
function pairScore(x, y) {
  let s = 0;

  // Sleep duration (15) – CRITICAL
  const d = Math.abs((x.sleep||7)-(y.sleep||7));
  s += d===0?15:d===1?7:0;

  // Music (8)
  s += x.music===y.music?8:0;

  // Sleep conditions (10)
  s += x.sleepCond===y.sleepCond?10:0;

  // Shower/poop (12)
  s += x.shower===y.shower?12:0;

  // Snoring tolerance (8) – CRITICAL
  s += x.snoring===y.snoring?8:0;

  // Roommate not ready (5)
  s += x.wait45===y.wait45?5:0;

  // Gad music at night (10) – CRITICAL
  if(x.gadMusic==='yes'&&y.gadMusic==='yes') s+=10;
  else if(x.gadMusic==='no'&&y.gadMusic==='no') s+=10;
  else if(x.gadMusic==='depends'&&y.gadMusic==='depends') s+=7;
  else if((x.gadMusic==='yes'&&y.gadMusic==='no')||(x.gadMusic==='no'&&y.gadMusic==='yes')) s-=5;
  else s+=3;

  // Drugs (10)
  s += x.drugs===y.drugs?10:0;

  // Living creature (12)
  if(x.creature==='no'&&y.creature==='no') s+=12;
  else if(x.creature===y.creature) s+=6;

  // Body count proximity (5)
  const co=['low','medium','high','lost'];
  const ci=co.indexOf(x.bodyCount), cj=co.indexOf(y.bodyCount);
  if(ci>=0&&cj>=0) s += Math.abs(ci-cj)<=1?5:0;

  // Vanilla to unhinged proximity (6)
  const vo=['vanilla','sprinkles','rocky','unhinged'];
  const vi=vo.indexOf(x.vanilla), vj=vo.indexOf(y.vanilla);
  if(vi>=0&&vj>=0) s += Math.abs(vi-vj)<=1?6:0;

  // Hotel hookup with roommate (5)
  s += x.hotelHookup===y.hotelHookup?5:0;

  // Drunk alter ego (4)
  s += x.drunkEgo===y.drunkEgo?4:0;

  // Faked it (3)
  s += x.fakedIt===y.fakedIt?3:0;

  // Morning situation (3)
  s += x.morning===y.morning?3:0;

  // Choke the monkey (4)
  if(x.monkey===y.monkey) s+=4;
  else if(x.monkey!=='no'&&y.monkey!=='no') s+=2;

  // Towel dilemma (3)
  s += x.towel===y.towel?3:0;

  // 500 shekel (3)
  s += x.money===y.money?3:0;

  // Riddles – same answer = intellectually aligned (3 each)
  s += x.riddle1===y.riddle1?3:0;
  s += x.riddle2===y.riddle2?3:0;

  // Gad king (5) – all options positive, always matches
  s += 5;

  // Gad falafel (2)
  s += x.falafel===y.falafel?2:0;

  // Gad is Luffy (3) – all positive
  s += 3;

  // Eyal Golan (3)
  s += x.eyal===y.eyal?3:0;

  // Ibiza (4)
  s += x.ibiza===y.ibiza?4:0;

  return Math.max(0, s);
}

const MAX_PAIR = 180;

function groupScore(grp, mat) {
  let t=0;
  for(let i=0;i<grp.length;i++) for(let j=i+1;j<grp.length;j++) t+=mat[grp[i]][grp[j]];
  return t;
}

function getGroupSizes(n) {
  const threes=Math.floor(n/3), rem=n%3;
  if(rem===0) return Array(threes).fill(3);
  if(rem===1) return threes>0?[...Array(threes-1).fill(3),2,2]:[1];
  return [...Array(threes).fill(3),2];
}

const ROOM_NAMES = ['The Penthouse 🏰','The Loft 🌆','The Jungle Suite 🌴','The Cave 🦇','Suite 5 🏠','Suite 6 🏠'];

function getRoomTagline(players) {
  const as=players.map(p=>p.answers);
  const tags=[];
  const avg=as.reduce((t,a)=>t+(a.sleep||7),0)/as.length;
  tags.push(avg<=4?'🦇 The Sleep Resisters':avg>=7.5?'😴 The Beauty Sleep Council':'⚖️ The Balanced Sleepers');
  const mv={}; as.forEach(a=>mv[a.music]=(mv[a.music]||0)+1);
  const top=Object.entries(mv).sort((a,b)=>b[1]-a[1])[0]?.[0];
  const ml={EDM:'🎧 EDM Degenerates',HIPHOP:'🎤 Hip Hop Heads',TECHNO:'⚡ Techno Warriors',MIZRAHIT:'🎻 Mizrahit Forever'};
  if(top) tags.push(ml[top]||top);
  if(as.every(a=>a.gadMusic==='yes')) tags.push("🔊 Gad's Night Crew");
  else if(as.every(a=>a.gadMusic==='no')) tags.push('🤫 Silent Hours Coalition');
  if(as.every(a=>a.vanilla==='unhinged')) tags.push('💀 The Unhinged Room');
  return tags.slice(0,2).join(' · ');
}

function calculateRooms(players) {
  const n=players.length;
  const mat=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>i===j?0:pairScore(players[i].answers,players[j].answers)));
  const sizes=getGroupSizes(n);
  let best=-Infinity, bestG=null;
  for(let it=0;it<3000;it++){
    const ord=[...Array(n).keys()].sort(()=>Math.random()-.5);
    const gs=[]; let st=0;
    for(const sz of sizes){gs.push(ord.slice(st,st+sz));st+=sz;}
    const sc=gs.reduce((t,g)=>t+groupScore(g,mat),0);
    if(sc>best){best=sc;bestG=gs.map(g=>[...g]);}
  }
  return bestG.map((g,ri)=>{
    const rp=g.map(i=>players[i]);
    let total=0,pairs=0;
    for(let i=0;i<g.length;i++) for(let j=i+1;j<g.length;j++){total+=mat[g[i]][g[j]];pairs++;}
    const pct=pairs?Math.round((total/(pairs*MAX_PAIR))*100):0;
    return { name:ROOM_NAMES[ri]||`Room ${ri+1}`, members:rp.map(p=>p.name), pct, tagline:getRoomTagline(rp) };
  }).sort((a,b)=>b.pct-a.pct);
}

// ── Helpers ──
function publicRoom(room) {
  return {
    code: room.code,
    hostName: room.hostName,
    status: room.status,
    results: room.results,
    players: Object.entries(room.players).map(([id,p])=>({ id, name:p.name, done:!!p.answers }))
  };
}

function broadcast(code) {
  const room=rooms[code];
  if(!room||!sse[code]) return;
  const data=`data: ${JSON.stringify(publicRoom(room))}\n\n`;
  sse[code].forEach(c=>{ try{c.write(data);}catch(e){} });
}

// ── API ──

// Create room
app.post('/api/rooms', (req,res)=>{
  const {hostName}=req.body;
  if(!hostName) return res.status(400).json({error:'Name required'});
  const code=genCode();
  rooms[code]={ code, hostName, createdAt:Date.now(), players:{}, status:'waiting', results:null, hostId:null };
  sse[code]=[];
  setTimeout(()=>{ delete rooms[code]; delete sse[code]; }, 12*60*60*1000);
  res.json({code});
});

// Join room
app.post('/api/rooms/:code/join', (req,res)=>{
  const code=req.params.code.toUpperCase();
  const {name}=req.body;
  const room=rooms[code];
  if(!room) return res.status(404).json({error:'Room not found — check the code!'});
  if(!name) return res.status(400).json({error:'Name required'});
  const id=Date.now().toString(36)+Math.random().toString(36).slice(2,6);
  room.players[id]={name, joinedAt:Date.now(), answers:null};
  if(!room.hostId) room.hostId=id; // first player = host
  broadcast(code);
  res.json({playerId:id, isHost:room.hostId===id, hostName:room.hostName});
});

// Submit answers
app.post('/api/rooms/:code/players/:id/answers', (req,res)=>{
  const code=req.params.code.toUpperCase();
  const {id}=req.params;
  const {answers}=req.body;
  const room=rooms[code];
  if(!room||!room.players[id]) return res.status(404).json({error:'Not found'});
  room.players[id].answers=answers;
  broadcast(code);
  res.json({ok:true});
});

// Calculate rooms
app.post('/api/rooms/:code/calculate', (req,res)=>{
  const code=req.params.code.toUpperCase();
  const room=rooms[code];
  if(!room) return res.status(404).json({error:'Room not found'});
  const done=Object.values(room.players).filter(p=>p.answers);
  if(done.length<3) return res.status(400).json({error:'Need at least 3 players'});
  room.results=calculateRooms(done);
  room.status='done';
  broadcast(code);
  res.json({ok:true});
});

// Edit results (host only)
app.put('/api/rooms/:code/results', (req,res)=>{
  const code=req.params.code.toUpperCase();
  const room=rooms[code];
  if(!room) return res.status(404).json({error:'Room not found'});
  if(!req.body.results) return res.status(400).json({error:'Results required'});
  room.results=req.body.results;
  broadcast(code);
  res.json({ok:true});
});

// Get room
app.get('/api/rooms/:code', (req,res)=>{
  const room=rooms[req.params.code.toUpperCase()];
  if(!room) return res.status(404).json({error:'Room not found'});
  res.json(publicRoom(room));
});

// SSE stream
app.get('/api/rooms/:code/events', (req,res)=>{
  const code=req.params.code.toUpperCase();
  if(!rooms[code]) return res.status(404).end();
  res.setHeader('Content-Type','text/event-stream');
  res.setHeader('Cache-Control','no-cache');
  res.setHeader('Connection','keep-alive');
  res.flushHeaders();
  sse[code].push(res);
  res.write(`data: ${JSON.stringify(publicRoom(rooms[code]))}\n\n`);
  const ka=setInterval(()=>res.write(': ka\n\n'),20000);
  req.on('close',()=>{ clearInterval(ka); sse[code]=(sse[code]||[]).filter(c=>c!==res); });
});

app.listen(PORT, ()=>console.log(`🎉 Server on port ${PORT}`));
