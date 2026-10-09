// node tests/dev-server.mjs [porta]  — serve docs/ + o Worker REAL com KV em memoria e escala FALSA.
// Nao fala com o 7Eventos nem com o Cloudflare. PIN do dono: "dono".
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../worker/src/index.js';

crypto.subtle.timingSafeEqual ||= (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
globalThis.fetch = async (u) => { throw new Error('rede bloqueada: ' + u); };

const PORT = +(process.argv[2] || 5599);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const pad = (n) => String(n).padStart(2, '0');
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const EV = { kind: 'os', code: '900', osFull: '900', event: 'Ciência Viva', client: 'Pavilhão', hor: '09:00–18:00', prop: null };
const EV_DAYS = ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17'];
const PEOPLE = [
  ['1', 'Ana Silva', 'Técnicos de Vídeo', EV_DAYS], ['2', 'Rui Costa', 'Técnicos de Vídeo', EV_DAYS.slice(0, 4)],
  ['3', 'Marta Lopes', 'Técnicos de Vídeo', EV_DAYS], ['4', 'Pedro Gomes', 'Técnicos de Vídeo', EV_DAYS.slice(1, 5)],
  ['5', 'Joana Reis', 'Técnicos de Vídeo', EV_DAYS.slice(0, 2)], ['6', 'Hugo Dias', 'Técnicos de Luz', EV_DAYS],
];
function escala(dmy) {
  const [dd, mm, yy] = dmy.split('-').map(Number), c = new Date(yy, mm - 1, dd), days = [];
  for (let i = -10; i <= 30; i++) { const d = new Date(c); d.setDate(d.getDate() + i); days.push(key(d)); }
  return {
    days, special: {}, at: Date.now(),
    people: PEOPLE.map(([id, name, grupo, ds]) => ({ id, name, grupo, foto: null, empresa: '', stats: '', cells: Object.fromEntries(ds.filter((d) => days.includes(d)).map((d) => [d, [EV]])) })),
  };
}
const mem = new Map();
const KV = {
  async get(k, type) { let v = mem.get(k); if (v == null && k.startsWith('escala:')) v = JSON.stringify(escala(k.slice(7))); if (v == null) return null; return type === 'json' ? JSON.parse(v) : v; },
  async put(k, v) { mem.set(k, v); }, async list() { return { keys: [] }; },
};
const env = { FOTOS: KV, VT_PIN_ADMIN: 'dono', ALLOWED_ORIGINS: `http://localhost:${PORT}` };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png' };

http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  if (u.pathname.startsWith('/api/') || u.pathname.startsWith('/foto/') || u.pathname.startsWith('/pdf/') || u.pathname.startsWith('/dl/')) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await worker.fetch(new Request(u, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }), env, { waitUntil() {} });
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  let f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nao'); return; }
  let body = fs.readFileSync(f);
  if (f.endsWith('index.html')) body = Buffer.from(body.toString().replace(/var API = '[^']+';/, `var API = 'http://localhost:${PORT}';`));
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(body);
}).listen(PORT, () => console.log('dev em http://localhost:' + PORT));
