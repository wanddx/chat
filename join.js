#!/usr/bin/env node
const { WebSocket } = require('ws');
const crypto = require('crypto');
const readline = require('readline');

const C = { reset:'\x1b[0m', cyan:'\x1b[96m', green:'\x1b[32m', yellow:'\x1b[33m', red:'\x1b[31m', gray:'\x1b[90m', white:'\x1b[97m', bold:'\x1b[1m' };
function ts() { return new Date().toTimeString().slice(0,8); }
function clearLine() { process.stdout.write('\r\x1b[2K'); }

const setup = readline.createInterface({ input: process.stdin, output: process.stdout });
function ask(q) { return new Promise(r => setup.question(q, r)); }

async function main() {
  console.clear();

  const ip   = (await ask(`  ip:   `)).trim();
  const port = (await ask(`  port: `)).trim() || '1000';
  const pass = (await ask(`  pass: `)).trim();
  const name = (await ask(`  name: `)).trim() || 'anon';
  setup.close();

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

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true, prompt: `> ` });

  function printMsg(who, text, color) { clearLine(); console.log(`${C.gray}[${ts()}] [${C.reset}${C.white}${C.bold}${who}${C.reset}${C.gray}]${C.reset} ${C.white}${text}${C.reset}`); }
  function printSystem(text, color=C.yellow) { clearLine(); console.log(`${C.gray}[${ts()}]${C.reset} ${color}${text}${C.reset}`); }

  const ws = new WebSocket(`ws://${ip}:${port}`);

  ws.on('open', () => {
    ws.send(JSON.stringify({ type:'join', payload:{ room: pass, name } }));
    console.clear();
    printSystem(`joined as ${C.cyan}${C.bold}${name}${C.reset}${C.yellow}.`, C.yellow);
    rl.prompt();
  });

  ws.on('message', (data) => {
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

  ws.on('error', (e) => { printSystem(`error ${e.message}`, C.red); process.exit(1); });
  ws.on('close', () => { printSystem('disconnected.', C.gray); process.exit(0); });

  rl.on('line', (line) => {
    const text = line.trim();
    if (!text) { rl.prompt(); return; }
    ws.send(JSON.stringify({ type:'msg', payload:{ data: encrypt(JSON.stringify({ text, from: name })) } }));
    clearLine();
    console.log(`${C.gray}[${ts()}] [${C.reset}${C.white}${C.bold}${name}${C.reset}${C.gray}]${C.reset} ${C.white}${text}${C.reset}`);
    rl.prompt();
  });
  rl.on('close', () => { console.log(`\n${C.gray}gone.${C.reset}`); ws.close(); process.exit(0); });
}

main();
