// Sanity check: spawns the quickstart server, does the MCP handshake over stdio,
// lists the tools and calls list_tickets, delete_ticket and create_ticket (invalid).
// Run from the repo root: node examples/quickstart/smoke.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const server = fileURLToPath(new URL('./server.ts', import.meta.url));
const child = spawn('npx', ['tsx', server], {
  shell: process.platform === 'win32',
  stdio: ['pipe', 'pipe', 'inherit'],
  cwd: fileURLToPath(new URL('../..', import.meta.url)),
});

const pending = new Map();
let buf = '';
child.stdout.on('data', (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id !== undefined && pending.has(msg.id)) pending.get(msg.id)(msg);
  }
});

let nextId = 1;
const send = (obj) => child.stdin.write(JSON.stringify(obj) + '\n');
const request = (method, params) =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    send({ jsonrpc: '2.0', id, method, params });
  });
const call = (name, args) => request('tools/call', { name, arguments: args });

await request('initialize', {
  protocolVersion: '2025-03-26',
  capabilities: {},
  clientInfo: { name: 'smoke', version: '0' },
});
send({ jsonrpc: '2.0', method: 'notifications/initialized' });

const tools = (await request('tools/list', {})).result.tools;
console.log(`tools/list -> ${tools.length} tools`);
for (const t of tools) console.log(`  ${t.name}: ${t.description.match(/\[risk: \w+\]/)?.[0] ?? '(no risk tag)'}`);

for (const [name, args] of [
  ['list_tickets', { status: 'open' }],
  ['create_ticket', { customer_id: 1 }],
  ['delete_ticket', { ticket_id: 1 }],
]) {
  const r = (await call(name, args)).result;
  console.log(`\ntools/call ${name} ${JSON.stringify(args)} -> isError=${r.isError ?? false}`);
  console.log(r.content[0].text);
  if (r.structuredContent) console.log('structuredContent:', JSON.stringify(r.structuredContent).slice(0, 400));
}

child.kill();
