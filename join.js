#!/usr/bin/env node
const { WebSocket } = require('ws');
const crypto = require('crypto');
const readline = require('readline');

const C = { reset:'\x1b[0m', cyan:'\x1b[96m', green:'\x1b[32m', yellow:'\x1b[33m', red:'\x1b[31m', gray:'\x1b[90m', white:'\x1b[97m', bold:'\x1b[1m', blue:'\x1b[34m' };
function ts() { return new Date().toTimeString().slice(0,8); }

const BANNER = [
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

function printBanner(extra) {
  const width = process.stdout.columns || 80;
  const center = (t) => ' '.repeat(Math.max(0, Math.floor((width - t.length) / 2))) + t;
  console.clear();
  BANNER.forEach(line => console.log(`${C.white}${C.bold}${center(line)}${C.reset}`));
  console.log();
  if (extra) extra.forEach(l => console.log(l));
  console.log();
}

const setup = readline.createInterface({ input: process.stdin, output: process.stdout });
function ask(q) { return new Promise(r => setup.question(q, r)); }

async function main() {
  printBanner();

  const ip   = (await ask(`  ipv4: `)).trim();
  const port = (await ask(`  port: `)).trim() || '1000';
  const pass = (await ask(`  pass: `)).trim();
  const name = (await ask(`  name: `)).trim() || 'anon';
  setup.close();
  process.stdin.resume();

  const KEY = crypto.pbkdf2Sync(pass, '8d1b65c00f12d31b2065bfb7e65e8cd884a00651749b46d921018f5e3c3b2831', 100000, 32, 'sha256');

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

  printBanner();

  let currentInput = '';
  let connected = false;
  const ws = new WebSocket(`ws://${ip}:${port}`);

  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);

  process.stdout.on('resize', () => {
    printBanner();
    process.stdout.write('> ' + currentInput);
  });

  process.stdin.on('keypress', (ch, key) => {
    if (!key) return;
    if (key.ctrl && key.name === 'c') { console.log(`\n${C.gray}gone.${C.reset}`); ws.close(); process.exit(0); }
    if (key.name === 'return') {
      const text = currentInput.trim();
      currentInput = '';
      process.stdout.write('\r\x1b[2K');
      if (!text || !connected) return;
      ws.send(JSON.stringify({ type:'msg', payload:{ data: encrypt(JSON.stringify({ text, from: name })) } }));
      printLine(`${C.gray}[${ts()}] [${C.reset}${C.blue}${C.bold}${name}${C.reset}${C.gray}]${C.reset} ${C.white}${text}${C.reset}`);
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

  ws.on('open', () => {
    connected = true;
    ws.send(JSON.stringify({ type:'join', payload:{ room: pass, name } }));
    process.stdout.write('> ');
  });
  ws.on('message', (data) => {
    let msg; try { msg = JSON.parse(data); } catch(e) { return; }
    if (msg.type === 'status') {
      if (msg.payload.code === 'JOINED') printSystem(`${msg.payload.name} joined.`, C.white);
      else if (msg.payload.code === 'LEFT') printSystem(`${msg.payload.name} left.`, C.red);
    } else if (msg.type === 'msg') {
      try {
        const { text, from } = JSON.parse(decrypt(msg.payload.data));
        printMsg(from, text);
      } catch(e) { printSystem('could not decrypt.', C.red); }
    }
  });
  ws.on('error', (e) => { printSystem(`error: ${e.message}`, C.red); process.exit(1); });
  ws.on('close', () => { printSystem('disconnected.', C.gray); process.exit(0); });
}

main();
