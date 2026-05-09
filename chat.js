const { WebSocket, WebSocketServer } = require('ws');
const crypto = require('crypto');
const readline = require('readline');
const http = require('http');
const os = require('os');

const PORT = 1000;
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

const C = { reset:'\x1b[0m', cyan:'\x1b[96m', green:'\x1b[32m', yellow:'\x1b[33m', red:'\x1b[31m', gray:'\x1b[90m', white:'\x1b[97m', bold:'\x1b[1m', blue:'\x1b[34m' };
function ts() { return new Date().toTimeString().slice(0,8); }

const asciiTop = [
  "                  .n                   .                 .                  n.          ",
  "               ..dP                  dP                   9b                 9b.    .   ",
  "           4    qXb         .       dX                     Xb       .        dXp     t  ",
  "          dX.    9Xb      .dXb    __                         __    dXb.     dXP     .9Xb",
  "        9XXb._       _.dXXXXb dXXXXbo.                 .odXXXXb dXXXXb._       _.dXXP   ",
  "         9XXXXXXXXXXXXXXXXXXXVXXXXXXXXOo.           .oOXXXXXXXXVXXXXXXXXXXXXXXXXXXXP    ",
  "         `9XXXXXXXXXXXXXXXXXXXXX'~   ~`OOO8b   d8OOO'~   ~`XXXXXXXXXXXXXXXXXXXXXP'      ",
  "               ~~~~~~~       9X.          .db|db.          .XP       ~~~~~~~            ",
  "                               )b.  .dbo.dP'`v'`9b.odb.  .dX(                           ",
  "                             ,dXXXXXXXXXXXb     dXXXXXXXXXXXb.                          ",
  "                            dXXXXXXXXXXXP'   .   `9XXXXXXXXXXXb                         ",
  "                           dXXXXXXXXXXXXb   d|b   dXXXXXXXXXXXXb                        ",
  "                           9XXb'   `XXXXXb.dX|Xb.dXXXXX'   `dXXP                        ",
  "                            `'      9XXXXXX(   )XXXXXXP      `'                         ",
  "                                     XXXX X.`v'.X XXXX                                  ",
  "                                     XP^X'`b   d'`X^XX                                  ",
  "                                     X. 9  `   '  P )X                                  ",
  "                                     `b  `       '  d'                                  ",
  "                                      `             '                                   "
];

function printBanner(info = {}) {
  const width = process.stdout.columns || 80;
  const center = (t) => ' '.repeat(Math.max(0, Math.floor((width - t.length) / 2))) + t;
  console.clear();
  asciiTop.forEach(line => console.log(`${C.white}${C.bold}${center(line)}${C.reset}`));
  console.log();
  console.log(`  link: npx github:wanddx/chat join`);
  console.log(`  host: chat-production-7e44.up.railway.app`);
  console.log(`  pass: ${info.pass || ''}`);
  console.log();
}

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
  const hostName = 'wand';
  const bannerInfo = { pass: PASS };
  printBanner(bannerInfo);

  const client = new WebSocket(`ws://localhost:${PORT}`);
  let connected = false;
  let currentInput = '';

  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);

  process.stdout.on('resize', () => {
    printBanner(bannerInfo);
    process.stdout.write('> ' + currentInput);
  });

  process.stdin.on('keypress', (ch, key) => {
    if (!key) return;
    if (key.ctrl && key.name === 'c') { console.log(`\n${C.gray}gone.${C.reset}`); process.exit(0); }
    if (key.name === 'return') {
      const text = currentInput.trim();
      currentInput = '';
      process.stdout.write('\r\x1b[2K');
      if (!text || !connected) return;
      client.send(JSON.stringify({ type:'msg', payload:{ data: encrypt(JSON.stringify({ text, from: hostName })) } }));
      printLine(`${C.gray}[${ts()}] [${C.reset}${C.blue}${C.bold}${hostName}${C.reset}${C.gray}]${C.reset} ${C.white}${text}${C.reset}`);
      process.stdout.write('> ');
    } else if (key.name === 'backspace') {
      currentInput = currentInput.slice(0, -1);
      process.stdout.write('\r\x1b[2K> ' + currentInput);
    } else if (ch && !key.ctrl && !key.meta) {
      currentInput += ch;
      process.stdout.write('\r\x1b[2K> ' + currentInput);
    }
  });

  function printLine(line) {
    process.stdout.write('\r\x1b[2K');
    console.log(line);
    process.stdout.write('> ' + currentInput);
  }
  function printMsg(who, text) {
    printLine(`${C.gray}[${ts()}] [${C.reset}${C.white}${C.bold}${who}${C.reset}${C.gray}]${C.reset} ${C.white}${text}${C.reset}`);
  }
  function printSystem(text, color) {
    printLine(`${C.gray}[${ts()}]${C.reset} ${color}${text}${C.reset}`);
  }

  client.on('open', () => {
    connected = true;
    client.send(JSON.stringify({ type:'join', payload:{ room: PASS, name: hostName } }));
    process.stdout.write('> ');
  });
  client.on('message', (data) => {
    let msg; try { msg = JSON.parse(data); } catch(e) { return; }
    if (msg.type === 'status') {
      if (msg.payload.code === 'JOINED') printSystem(`${msg.payload.name} joined.`, C.green);
      else if (msg.payload.code === 'LEFT') printSystem(`${msg.payload.name} left.`, C.red);
    } else if (msg.type === 'msg') {
      try {
        const { text, from } = JSON.parse(decrypt(msg.payload.data));
        printMsg(from, text);
      } catch(e) { printSystem('could not decrypt.', C.red); }
    }
  });
  client.on('error', (e) => { printSystem(`error: ${e.message}`, C.red); });
});
