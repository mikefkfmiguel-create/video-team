// node tests/share-filtro.test.mjs — o link «so deste evento» so mostra as pessoas do filtro do dono. Worker com KV em memoria, sem rede.
import assert from 'node:assert/strict';
import worker from '../worker/src/index.js';

crypto.subtle.timingSafeEqual ||= (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
globalThis.fetch = async (u) => { throw new Error('rede bloqueada no teste: ' + u); };

const store = new Map();
const KV = {
  async get(k, type) { const v = store.get(k); if (v == null) return null; return type === 'json' ? JSON.parse(v) : v; },
  async put(k, v) { store.set(k, v); },
  async delete(k) { store.delete(k); },
  async list() { return { keys: [] }; },
};
const env = { FOTOS: KV, VT_PIN_ADMIN: 'dono', ALLOWED_ORIGINS: 'http://x' };
const SIG = 'os:900:Evento Teste';
const ev = { kind: 'os', code: '900', event: 'Evento Teste', osFull: '900', client: '', hor: '', prop: null };
const day = (d) => `2026-10-${d}`;
const days = ['13', '14', '15'].map(day);
const person = (id, name, grupo) => ({ id, name, grupo, foto: null, empresa: '', stats: '', cells: Object.fromEntries(days.map((d) => [d, [ev]])) });
const janela = ['10', '11', '12', '13', '14', '15', '16', '17', '18'].map(day);
store.set('escala:13-10-2026', JSON.stringify({ days: janela, special: {}, at: Date.now(), people: [
  person('1', 'Ana Silva', 'Técnico de Video'), person('2', 'Rui Costa*_12H', 'Técnico de Video'), person('3', 'Mario Ribeiro', 'Técnico de Estruturas'), person('4', 'Bernardo Sobral', 'Técnico de Iluminação'),
] }));
const call = (path, { pin = 'dono', method = 'GET', body } = {}) =>
  worker.fetch(new Request('http://w' + path, { method, headers: { 'X-PIN': pin, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil() {} });
const J = async (r) => ({ status: r.status, body: await r.json() });
let n = 0;
const t = async (nome, f) => { await f(); n++; console.log('OK    ' + nome); };

await t('sem filtro (como antes): o link mostra toda a equipa do evento', async () => {
  const s = await J(await call('/api/admin/share', { method: 'POST', body: { key: SIG, label: 'Evento Teste', d: '13-10-2026' } }));
  const v = await J(await call('/api/projeto', { pin: s.body.token }));
  assert.equal(v.status, 200);
  assert.equal(v.body.crew.length, 4);
});

await t('com o filtro do dono (so Video): o link so tem essas pessoas', async () => {
  const s = await J(await call('/api/admin/share', { method: 'POST', body: { key: SIG, label: 'Evento Teste', d: '13-10-2026', ids: ['1', '2'] } }));
  const v = await J(await call('/api/projeto', { pin: s.body.token }));
  assert.deepEqual(v.body.crew.map((c) => c.id).sort(), ['1', '2']);
  assert.ok(!JSON.stringify(v.body).includes('Mario Ribeiro') && !JSON.stringify(v.body).includes('Bernardo'), 'as outras categorias nao aparecem');
});

await t('ids invalidos ou repetidos nao estragam nada', async () => {
  const s = await J(await call('/api/admin/share', { method: 'POST', body: { key: SIG, label: 'x', d: '13-10-2026', ids: ['1', '1', '', null, '999'] } }));
  const v = await J(await call('/api/projeto', { pin: s.body.token }));
  assert.deepEqual(v.body.crew.map((c) => c.id), ['1']);
});

await t('com um filtro que nao apanha ninguem do evento, o link fica vazio (nunca abre a equipa toda)', async () => {
  const s = await J(await call('/api/admin/share', { method: 'POST', body: { key: SIG, label: 'x', d: '13-10-2026', ids: ['777'] } }));
  const v = await J(await call('/api/projeto', { pin: s.body.token }));
  assert.equal(v.status, 200);
  assert.equal(v.body.crew.length, 0);
});

console.log('\n' + n + ' testes ok');
