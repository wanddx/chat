const { WebSocket, WebSocketServer } = require('ws');
const crypto = require('crypto');
const readline = require('readline');
const http = require('http');
const os = require('os');

const PORT = 1000;
const ROOM = crypto.randomBytes(4).toString('hex');
const PASS = crypto.randomBytes(8).toString('hex');
const KEY  = crypto.pbkdf2Sync(PASS, '8d1b65c00f12d31b2065bfb7e65e8cd884a00651749b46d921018f5e3c3b2831', 100000, 32, 'sha256');

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}
function decrypt(b64) {
  const buf = Buffer.from(b64, 'base64');
  const iv = buf.slice(0,16), tag = buf.slice(16,32), enc = buf.slice(32);
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

function getIP() {
  for (const ifaces of Object.values(os.networkInterfaces()))
    for (const i of ifaces)
      if (i.family === 'IPv4' && !i.internal) return i.address;
  return 'localhost';
}

const C = { reset:'\x1b[0m', cyan:'\x1b[96m', green:'\x1b[32m', yellow:'\x1b[33m', red:'\x1b[31m', gray:'\x1b[90m', white:'\x1b[97m', bold:'\x1b[1m' };
function ts() { return new Date().toTimeString().slice(0,8); }
function clearLine() { process.stdout.write('\r\x1b[2K'); }

const rooms = new Map();

function broadcast(roomId, type, payload, exclude) {
  const members = rooms.get(roomId) || [];
  for (const m of members) {
    if (m !== exclude && m.readyState === 1) {
      try { m.send(JSON.stringify({ type, payload })); } catch(e) {}
    }
  }
}

const server = http.createServer();
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  let roomId = null;
  let memberName = 'anon';

  ws.on('message', (data) => {
    let msg; try { msg = JSON.parse(data); } catch(e) { return; }
    if (msg.type === 'join') {
      roomId = msg.payload.room;
      memberName = msg.payload.name || 'anon';
      if (!rooms.has(roomId)) rooms.set(roomId, []);
      rooms.get(roomId).push(ws);
      broadcast(roomId, 'status', { code: 'JOINED', name: memberName }, ws);
    } else if (msg.type === 'msg') {
      broadcast(roomId, 'msg', msg.payload, ws);
    }
  });

  ws.on('close', () => {
    if (roomId && rooms.has(roomId)) {
      rooms.set(roomId, rooms.get(roomId).filter(m => m !== ws));
      broadcast(roomId, 'status', { code: 'LEFT', name: memberName }, ws);
      if (rooms.get(roomId).length === 0) rooms.delete(roomId);
    }
  });

  ws.on('error', () => {});
});

server.listen(PORT, '0.0.0.0', () => {
  const ip = getIP();
  const hostName = 'wand';
  console.clear();
  console.log(`ipv4 : \x1b[96m${ip}\x1b[0m`);
  console.log(`port : \x1b[96m${PORT}\x1b[0m`);
  console.log(`pass : \x1b[96m${PASS}\x1b[0m`);

  const client = new WebSocket(`ws://localhost:${PORT}`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true, prompt: `${C.cyan}${hostName}: ${C.reset}` });
  let connected = false;

  function printMsg(who, text, color) { clearLine(); console.log(`${C.gray}[${ts()}]${C.reset} ${color}${C.bold}${who}${C.reset} ${C.white}${text}${C.reset}`); rl.prompt(true); }
  function printSystem(text, color=C.yellow) { clearLine(); console.log(`${C.gray}[${ts()}]${C.reset} ${color}${text}${C.reset}`); rl.prompt(true); }

  client.on('open', () => {
    connected = true;
    client.send(JSON.stringify({ type:'join', payload:{ room: PASS, name: hostName } }));
    printSystem('waiting for others.', C.yellow);
    rl.prompt();
  });

  client.on('message', (data) => {
    let msg; try { msg = JSON.parse(data); } catch(e) { return; }
    if (msg.type === 'status') {
      if (msg.payload.code === 'JOINED') printSystem(`${msg.payload.name} joined.`, C.green);
      else if (msg.payload.code === 'LEFT') printSystem(`${msg.payload.name} left.`, C.red);
    } else if (msg.type === 'msg') {
      try {
        const { text, from } = JSON.parse(decrypt(msg.payload.data));
        printMsg(from, text, C.cyan);
      } catch(e) { printSystem('could not decrypt.', C.red); }
    }
  });

  client.on('error', (e) => { printSystem(`error:${e.message}`, C.red); process.exit(1); });

  rl.on('line', (line) => {
    const text = line.trim();
    if (!text) { rl.prompt(); return; }
    if (!connected) { printSystem('not connected yet.', C.yellow); rl.prompt(); return; }
    client.send(JSON.stringify({ type:'msg', payload:{ data: encrypt(JSON.stringify({ text, from: hostName })) } }));
    clearLine();
    console.log(`${C.gray}[${ts()}]${C.reset} ${C.green}${C.bold}${hostName}${C.reset} ${text}`);
    rl.prompt();
  });

  rl.on('close', () => { console.log(`\n${C.gray}gone.${C.reset}`); process.exit(0); });
});
