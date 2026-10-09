// node tests/worker-salas.test.mjs — Worker com KV em memoria e escala falsa (nada de producao)
import assert from 'node:assert/strict';
import worker from '../worker/src/index.js';

// timingSafeEqual so existe no runtime do Cloudflare
crypto.subtle.timingSafeEqual ||= (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

// nunca sair para a rede (o Worker iria ao 7Eventos a sério)
globalThis.fetch = async (u) => { throw new Error('rede bloqueada no teste: ' + u); };

const store = new Map();
const KV = {
  async get(k, type) { const v = store.get(k); if (v == null) return null; return type === 'json' ? JSON.parse(v) : v; },
  async put(k, v) { store.set(k, v); },
  async list() { return { keys: [] }; },
};
const env = { FOTOS: KV, VT_PIN_ADMIN: 'dono', ALLOWED_ORIGINS: 'http://x' };
const SIG = 'os:900:Evento Teste';
const ev = { kind: 'os', code: '900', event: 'Evento Teste', osFull: '900', client: '', hor: '', prop: null };
const day = (d) => `2026-10-${d}`;
const days = ['13', '14', '15'].map(day);
const person = (id, name, ds, grupo = 'Tecnicos de Video') => ({ id, name, grupo, foto: null, empresa: '912 345 678', stats: '', cells: Object.fromEntries(ds.map((d) => [d, [ev]])) });
const window = ['10', '11', '12', ...['13', '14', '15'], '16', '17', '18'].map(day); // janela maior que o evento: nao toca as bordas
store.set('escala:13-10-2026', JSON.stringify({ days: window, special: {}, at: Date.now(), people: [person('1', 'Ana Silva', days), person('2', 'Rui Costa', [days[0], days[1]]), person('3', 'Outro Grupo', days, 'Luz')] }));
store.set('req:linkp', JSON.stringify({ name: 'x', project: SIG, anchor: '13-10-2026', role: 'project', status: 'approved' }));
store.set('req:adm', JSON.stringify({ role: 'fulladmin', status: 'approved', expiresAt: Date.now() + 1e6 }));

const call = (path, { pin = 'dono', method = 'GET', body } = {}) =>
  worker.fetch(new Request('http://w' + path, { method, headers: { 'X-PIN': pin, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil() {} });
const J = async (r) => ({ status: r.status, body: await r.json() });

const q = '/api/admin/sala?key=' + encodeURIComponent(SIG) + '&d=13-10-2026';

// so o dono
assert.equal((await call(q, { pin: 'adm' })).status, 403);
assert.equal((await call(q, { pin: 'errado' })).status, 401);

// sem documento ainda: devolve a equipa oficial (sem telefones/empresa)
let r = await J(await call(q));
assert.equal(r.status, 200);
assert.equal(r.body.doc, null);
assert.equal(r.body.crew.crew.length, 3);
assert.ok(!JSON.stringify(r.body).includes('912 345'));

const doc = {
  dias: days, grupos: ['Tecnicos de Video'],
  salas: [{ id: 's1', nome: 'Auditório 1' }, { id: 's2', nome: 'Auditório 2' }],
  funcoes: [{ id: 'f1', nome: 'MIX', conta: 'mix' }, { id: 'f2', nome: 'CAM', conta: 'cam' }],
  aloc: { 1: { [days[0]]: [{ sala: 's1', f: ['f1'] }] }, 2: { [days[0]]: [{ sala: 's1', f: ['f2'] }] } },
  link: { publicado: false },
};
const save = async (d, rev) => J(await call('/api/admin/sala/guardar', { method: 'POST', body: { key: SIG, doc: d, rev } }));

// referencias partidas sao rejeitadas
assert.equal((await save({ ...doc, aloc: { 1: { [days[0]]: [{ sala: 'xx', f: [] }] } } }, 0)).status, 400);
assert.equal((await save({ ...doc, aloc: { 1: { '2030-01-01': [{ sala: 's1', f: [] }] } } }, 0)).status, 400);

// gravar, e conflito de revisao
r = await save(doc, 0);
assert.equal(r.status, 200); assert.equal(r.body.rev, 1);
assert.equal((await save(doc, 0)).status, 409);
r = await save({ ...doc, link: { publicado: true } }, 1);
assert.equal(r.body.rev, 2);
assert.ok(store.has('salabak:' + [...store.keys()].find((k) => k.startsWith('sala:')).slice(5)));

// lê de volta
r = await J(await call(q));
assert.equal(r.body.doc.rev, 2);
assert.equal(r.body.doc.link.publicado, true);

// link do projeto: ve sala/funcao so se publicado, sem lixo
r = await J(await call('/api/projeto', { pin: 'linkp' }));
assert.equal(r.status, 200);
assert.deepEqual(Object.keys(r.body.salas).sort(), ['aloc', 'dias', 'funcoes', 'grupos', 'salas']);
assert.deepEqual(Object.keys(r.body.salas.aloc).sort(), ['1', '2']);
assert.ok(!JSON.stringify(r.body).includes('912 345'));
r = await save({ ...doc, link: { publicado: false } }, 2);
r = await J(await call('/api/projeto', { pin: 'linkp' }));
assert.equal(r.body.salas, undefined);

// o link de projeto nao acede ao editor
assert.equal((await call(q, { pin: 'linkp' })).status, 401);
// importar a folha: corta a coluna dos contactos e telefones soltos; so o dono
const csv = ',TECNICO,13,14\n"Chefe Falso   911 849 762",ANA SILVA,"CIENCIA, AUDI 1, CAM",\n,RUI COSTA 912 345 678,,"CIENCIA, RUNNER"\n,,,\n';
assert.equal((await call('/api/admin/sala/folha', { pin: 'adm', method: 'POST', body: { csv } })).status, 403);
r = await J(await call('/api/admin/sala/folha', { method: 'POST', body: { csv } }));
assert.equal(r.status, 200);
assert.deepEqual(r.body.header, ['13', '14']);
assert.equal(r.body.rows.length, 2);
assert.equal(r.body.rows[0].cells[0], 'CIENCIA, AUDI 1, CAM');
assert.equal(r.body.rows[1].nome, 'RUI COSTA');
assert.ok(!JSON.stringify(r.body).match(/\d{3} \d{3} \d{3}|Chefe/));
assert.equal((await call('/api/admin/sala/folha', { method: 'POST', body: { csv: 'a,b\n1,2' } })).status, 400);
// sem csv vai a rede (bloqueada no teste): nunca acontece em silencio
assert.equal((await call('/api/admin/sala/folha', { method: 'POST', body: {} })).status, 502);

// ficheiro temporario: cria com PIN, abre sem PIN, expira
r = await J(await call('/api/admin/sala/ficheiro', { method: 'POST', body: { nome: 'equipa x.csv', tipo: 'csv', conteudo: 'TECNICO,13\r\n' } }));
assert.equal(r.status, 200);
const dlPath = new URL(r.body.url).pathname;
let f = await worker.fetch(new Request('http://w' + dlPath), env, { waitUntil() {} });
assert.equal(f.status, 200);
assert.match(f.headers.get('Content-Disposition'), /equipa_x\.csv/);
assert.equal(await f.text(), 'TECNICO,13\r\n');
store.delete('dl:' + dlPath.split('/').pop());
assert.equal((await worker.fetch(new Request('http://w' + dlPath), env, { waitUntil() {} })).status, 404);
assert.equal((await call('/api/admin/sala/ficheiro', { pin: 'adm', method: 'POST', body: { tipo: 'csv', conteudo: 'x' } })).status, 403);
r = await J(await call('/api/admin/sala/ficheiro', { method: 'POST', body: { tipo: 'html', conteudo: '<p>x</p>' } }));
f = await worker.fetch(new Request('http://w' + new URL(r.body.url).pathname), env, { waitUntil() {} });
assert.match(f.headers.get('Content-Security-Policy'), /default-src 'none'/);

console.log('worker salas: ok');
