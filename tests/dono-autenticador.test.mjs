// node tests/dono-autenticador.test.mjs — entrada do dono com o autenticador (TOTP): Worker com KV em memoria, sem rede.
import assert from 'node:assert/strict';
import worker from '../worker/src/index.js';
import { codigoTotp } from '../worker/src/autenticador.js';

crypto.subtle.timingSafeEqual ||= (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
globalThis.fetch = async (u) => { throw new Error('rede bloqueada no teste: ' + u); };

const store = new Map();
const KV = {
  async get(k, type) { const v = store.get(k); if (v == null) return null; return type === 'json' ? JSON.parse(v) : v; },
  async put(k, v) { store.set(k, v); },
  async delete(k) { store.delete(k); },
  async list() { return { keys: [] }; },
};
const env = { FOTOS: KV, VT_PIN_ADMIN: 'chave-do-dono', ALLOWED_ORIGINS: 'http://x' };
let n = 0;
const t = async (nome, f) => { await f(); n++; console.log('OK    ' + nome); };
const call = (path, { pin, method = 'GET', body, ip = '1.1.1.1' } = {}) =>
  worker.fetch(new Request('http://w' + path, { method, headers: { ...(pin ? { 'X-PIN': pin } : {}), 'Content-Type': 'application/json', 'CF-Connecting-IP': ip }, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil() {} });
const J = async (r) => ({ status: r.status, body: await r.json() });
const passoAgora = () => Math.floor(Date.now() / 30000);

await t('antes de ativar: o estado diz que nao ha autenticador e entrar com um codigo falha', async () => {
  assert.equal((await J(await call('/api/dono/estado'))).body.autenticador, false);
  assert.equal((await call('/api/dono/entrar', { method: 'POST', body: { codigo: '123456' } })).status, 401);
});

let segredo;
await t('so o dono prepara o autenticador', async () => {
  assert.equal((await call('/api/admin/autenticador/preparar', { method: 'POST' })).status, 401);
  const r = await J(await call('/api/admin/autenticador/preparar', { pin: 'chave-do-dono', method: 'POST' }));
  assert.equal(r.status, 200);
  segredo = r.body.segredo;
  assert.match(r.body.otpauth, /^otpauth:\/\/totp\/Video%20Team:dono\?secret=[A-Z2-7]{32}&issuer=Video%20Team&algorithm=SHA1&digits=6&period=30$/);
});

let recuperacao;
await t('confirmar com um codigo errado falha; com o certo ativa e da 8 codigos de recuperacao', async () => {
  assert.equal((await call('/api/admin/autenticador/confirmar', { pin: 'chave-do-dono', method: 'POST', body: { codigo: '000000' } })).status, 400);
  const bom = await codigoTotp(segredo, passoAgora());
  const r = await J(await call('/api/admin/autenticador/confirmar', { pin: 'chave-do-dono', method: 'POST', body: { codigo: bom } }));
  assert.equal(r.status, 200);
  assert.equal(r.body.recuperacao.length, 8);
  assert.match(r.body.recuperacao[0], /^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
  recuperacao = r.body.recuperacao;
  assert.equal((await J(await call('/api/dono/estado'))).body.autenticador, true);
});

let sessao;
await t('entrar com o codigo do autenticador da uma sessao que vale como dono', async () => {
  const cod = await codigoTotp(segredo, passoAgora() + 1);          // o seguinte (o atual ja foi gasto a confirmar)
  const r = await J(await call('/api/dono/entrar', { method: 'POST', body: { codigo: cod } }));
  assert.equal(r.status, 200);
  assert.match(r.body.token, /^S-[A-Z2-7]{52}$/);
  assert.equal(r.body.role, 'owner');
  sessao = r.body.token;
  const ping = await J(await call('/api/ping', { pin: sessao }));
  assert.equal(ping.status, 200);
  assert.equal(ping.body.role, 'owner');
  assert.equal((await call('/api/admin/chat?key=x', { pin: sessao })).status !== 401, true, 'a sessao passa nas rotas do dono');
});

await t('o mesmo codigo nao se usa duas vezes (nem o anterior)', async () => {
  const cod = await codigoTotp(segredo, passoAgora() + 1);
  assert.equal((await call('/api/dono/entrar', { method: 'POST', body: { codigo: cod } })).status, 401);
  const velho = await codigoTotp(segredo, passoAgora() - 1);
  assert.equal((await call('/api/dono/entrar', { method: 'POST', body: { codigo: velho } })).status, 401);
});

await t('uma sessao inventada ou alterada nao entra', async () => {
  assert.equal((await call('/api/ping', { pin: 'S-' + 'A'.repeat(52) })).status, 401);
  assert.equal((await call('/api/ping', { pin: sessao.slice(0, -1) + (sessao.endsWith('A') ? 'B' : 'A') })).status, 401);
});

await t('a chave fixa do dono continua a servir (recuperacao)', async () => {
  assert.equal((await J(await call('/api/ping', { pin: 'chave-do-dono' }))).body.role, 'owner');
});

await t('codigo de recuperacao: serve uma vez', async () => {
  const c = recuperacao[0].toLowerCase();
  const r1 = await J(await call('/api/dono/entrar', { method: 'POST', body: { recuperacao: c } }));
  assert.equal(r1.status, 200);
  assert.equal((await call('/api/dono/entrar', { method: 'POST', body: { recuperacao: recuperacao[0] } })).status, 401);
  assert.equal((await call('/api/dono/entrar', { method: 'POST', body: { recuperacao: recuperacao[1] } })).status, 200, 'os outros continuam validos');
});

await t('tentativas a mais do mesmo endereco ficam bloqueadas (429)', async () => {
  let ultimo;
  for (let i = 0; i < 10; i++) ultimo = (await call('/api/dono/entrar', { method: 'POST', ip: '9.9.9.9', body: { codigo: '111111' } })).status;
  assert.equal(ultimo, 429);
  assert.equal((await call('/api/dono/entrar', { method: 'POST', ip: '8.8.8.8', body: { codigo: '222222' } })).status, 401, 'outro endereco nao e afetado');
});

await t('um membro da equipa nao consegue preparar o autenticador', async () => {
  store.set('req:equipa', JSON.stringify({ status: 'approved', role: 'video', expiresAt: Date.now() + 1e6 }));
  assert.equal((await call('/api/admin/autenticador/preparar', { pin: 'equipa', method: 'POST' })).status, 401);
});

console.log('\n' + n + ' testes ok');
