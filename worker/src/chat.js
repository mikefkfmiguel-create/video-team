// Chat por evento (Video Team). Uma sala por evento, com as pessoas escolhidas pelo dono.
// - KV `FOTOS`: chat:<sala> = documento da sala (evento, membros e os seus tokens, validade);
//               cm:<token>  = quem e (sala, pid, nome, papel) — o link pessoal de cada pessoa.
// - Durable Object `SalaChat` (SQLite): as mensagens de UMA sala + as ligacoes WebSocket (tempo real).
// Nunca guarda telefones nem emails: os contactos ficam so no aparelho do dono (usa-os para enviar os links).
// Os links apagam-se sozinhos (KV) e a sala apaga as mensagens depois do prazo (alarme do Durable Object).

import { docId } from './salas.js';

const DIA = 24 * 3600;
const MAX_TEXTO = 2000;
const HISTORICO = 150;            // mensagens enviadas a quem entra
const MAX_MENSAGENS = 5000;       // por sala
const GRACA = 7 * DIA;            // depois do ultimo dia do evento
const TTL_PADRAO = 30 * DIA;
const TTL_MAX = 120 * DIA;
const MAX_MEMBROS = 150;

const str = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').trim().slice(0, n);

function randomToken() {
  const b = crypto.getRandomValues(new Uint8Array(20));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// ate (aaaa-mm-dd do ultimo dia do evento) -> instante em que tudo expira
function calcExpira(ate, agora) {
  let t = agora + TTL_PADRAO * 1000;
  if (typeof ate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ate)) {
    const d = Date.parse(ate + 'T23:59:59Z');
    if (isFinite(d)) t = d + GRACA * 1000;
  }
  return Math.max(agora + 2 * DIA * 1000, Math.min(t, agora + TTL_MAX * 1000));
}

const ttlAte = (expira, agora) => Math.max(60, Math.floor((expira - agora) / 1000));

function stubDe(env, sala) {
  return env.CHAT.get(env.CHAT.idFromName(sala));
}

// ---------------------------------------------------------------- dono: criar / ver / fechar
export async function handleChatAdmin(url, req, env, h, { json, readJson }) {
  const rota = url.pathname.replace('/api/admin/chat', '') || '/';

  if (rota === '/' && req.method === 'GET') {
    const key = str(url.searchParams.get('key'), 300);
    if (!key) return json({ error: 'evento invalido' }, 400, h);
    const doc = await env.FOTOS.get('chat:' + (await docId(key)), 'json');
    return json(doc ? vistaDono(doc) : { existe: false }, 200, h);
  }

  if (rota === '/criar' && req.method === 'POST') {
    const b = await readJson(req);
    const key = str(b && b.key, 300);
    if (!key) return json({ error: 'evento invalido' }, 400, h);
    if (!Array.isArray(b.membros) || !b.membros.length || b.membros.length > MAX_MEMBROS) return json({ error: 'escolhe entre 1 e ' + MAX_MEMBROS + ' pessoas' }, 400, h);
    const sala = await docId(key);
    const agora = Date.now();
    let doc = await env.FOTOS.get('chat:' + sala, 'json');
    const expira = calcExpira(b.ate, agora);
    const novo = !doc;
    if (!doc) doc = { v: 1, sala, key, criada: agora, membros: {}, dono: null };
    doc.evento = str(b.label, 120) || doc.evento || 'Evento';
    doc.expira = Math.max(expira, doc.expira || 0);
    const ttl = ttlAte(doc.expira, agora);

    // o dono tem sempre o seu link (escreve como «Régie»)
    if (!doc.dono) doc.dono = { token: randomToken() };
    doc.dono.nome = str(b.donoNome, 40) || doc.dono.nome || 'Régie';
    await env.FOTOS.put('cm:' + doc.dono.token, JSON.stringify({ sala, pid: 'dono', nome: doc.dono.nome, papel: 'dono', expira: doc.expira }), { expirationTtl: ttl });

    for (const m of b.membros) {
      const pid = str(m && m.id, 24);
      const nome = str(m && m.name, 80);
      if (!pid || !nome || pid === 'dono') continue;
      const atual = doc.membros[pid];
      const token = atual ? atual.token : randomToken();
      doc.membros[pid] = { nome, token, grupo: str(m.grupo, 60) };
      await env.FOTOS.put('cm:' + token, JSON.stringify({ sala, pid, nome, papel: 'membro', expira: doc.expira }), { expirationTtl: ttl });
    }
    await env.FOTOS.put('chat:' + sala, JSON.stringify(doc), { expirationTtl: ttl });
    // o Durable Object limpa-se sozinho passado o prazo
    await stubDe(env, sala).fetch('https://sala/iniciar', { method: 'POST', body: JSON.stringify({ expira: doc.expira, evento: doc.evento }) });
    return json({ ...vistaDono(doc), novo }, 200, h);
  }

  if (rota === '/remover' && req.method === 'POST') {
    const b = await readJson(req);
    const sala = await docId(str(b && b.key, 300));
    const doc = await env.FOTOS.get('chat:' + sala, 'json');
    const pid = str(b && b.id, 24);
    if (!doc || !doc.membros[pid]) return json({ error: 'nao encontrado' }, 404, h);
    await env.FOTOS.delete('cm:' + doc.membros[pid].token);   // o link deixa de funcionar na hora
    delete doc.membros[pid];
    await env.FOTOS.put('chat:' + sala, JSON.stringify(doc), { expirationTtl: ttlAte(doc.expira, Date.now()) });
    await stubDe(env, sala).fetch('https://sala/expulsar', { method: 'POST', body: JSON.stringify({ pid }) });
    return json(vistaDono(doc), 200, h);
  }

  if (rota === '/fechar' && req.method === 'POST') {
    const b = await readJson(req);
    const sala = await docId(str(b && b.key, 300));
    const doc = await env.FOTOS.get('chat:' + sala, 'json');
    if (!doc) return json({ ok: true }, 200, h);
    for (const m of Object.values(doc.membros)) await env.FOTOS.delete('cm:' + m.token);
    if (doc.dono) await env.FOTOS.delete('cm:' + doc.dono.token);
    await env.FOTOS.delete('chat:' + sala);
    await stubDe(env, sala).fetch('https://sala/limpar', { method: 'POST' });
    return json({ ok: true }, 200, h);
  }

  return json({ error: 'rota' }, 404, h);
}

function vistaDono(doc) {
  return {
    existe: true, sala: doc.sala, evento: doc.evento, expira: doc.expira,
    dono: doc.dono ? { nome: doc.dono.nome, token: doc.dono.token } : null,
    membros: Object.entries(doc.membros).map(([id, m]) => ({ id, name: m.nome, grupo: m.grupo || '', token: m.token })),
  };
}

// ---------------------------------------------------------------- membros: o chat
async function quemE(url, req, env) {
  const token = str(req.headers.get('X-Chat') || url.searchParams.get('k'), 64);
  if (!/^[a-f0-9]{40}$/.test(token)) return null;
  const q = await env.FOTOS.get('cm:' + token, 'json');
  return q && q.expira > Date.now() ? q : null;
}

export async function handleChat(url, req, env, h, { json, readJson }) {
  const q = await quemE(url, req, env);
  if (!q) {
    await new Promise((r) => setTimeout(r, 800));
    return json({ error: 'link' }, 401, h);
  }
  const rota = url.pathname.replace('/api/chat', '') || '/';
  const doc = await env.FOTOS.get('chat:' + q.sala, 'json');
  if (!doc) return json({ error: 'sala' }, 404, h);
  // os membros podem ter sido retirados pelo dono depois de o link ter sido emitido
  if (q.papel === 'membro' && !doc.membros[q.pid]) return json({ error: 'link' }, 401, h);
  const stub = stubDe(env, q.sala);
  const quem = encodeURIComponent(JSON.stringify({ pid: q.pid, nome: q.nome, papel: q.papel }));
  const interno = (caminho, init = {}) => stub.fetch('https://sala' + caminho, { ...init, headers: { ...(init.headers || {}), 'X-Quem': quem } });

  if (rota === '/sala' && req.method === 'GET') {
    const r = await (await interno('/msgs')).json();
    return json({
      evento: doc.evento, expira: doc.expira, eu: { pid: q.pid, nome: q.nome, papel: q.papel },
      membros: [{ pid: 'dono', nome: (doc.dono && doc.dono.nome) || 'Régie' }, ...Object.entries(doc.membros).map(([pid, m]) => ({ pid, nome: m.nome, grupo: m.grupo || '' }))],
      ...r,
    }, 200, h);
  }
  if (rota === '/msgs' && req.method === 'GET') {
    return json(await (await interno('/msgs?depois=' + encodeURIComponent(url.searchParams.get('depois') || '0'))).json(), 200, h);
  }
  if (rota === '/enviar' && req.method === 'POST') {
    const b = await readJson(req);
    const r = await interno('/enviar', { method: 'POST', body: JSON.stringify({ texto: b && b.texto, aviso: b && b.aviso }) });
    return json(await r.json(), r.status, h);
  }
  if ((rota === '/apagar' || rota === '/fixar') && req.method === 'POST') {
    if (q.papel !== 'dono') return json({ error: 'so a regie' }, 403, h);
    const b = await readJson(req);
    const r = await interno(rota, { method: 'POST', body: JSON.stringify(b || {}) });
    return json(await r.json(), r.status, h);
  }
  if (rota === '/ws') {
    if ((req.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') return json({ error: 'websocket' }, 426, h);
    return interno('/ws', { headers: { Upgrade: 'websocket' } });
  }
  return json({ error: 'rota' }, 404, h);
}

// ---------------------------------------------------------------- Durable Object: as mensagens de uma sala
export class SalaChat {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sql = state.storage.sql;
    this.esquema();
    this.recentes = new Map();   // pid -> instantes das ultimas mensagens (limite de ritmo)
  }

  esquema() {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS msg (
      id INTEGER PRIMARY KEY AUTOINCREMENT, pid TEXT NOT NULL, nome TEXT NOT NULL, texto TEXT NOT NULL, ts INTEGER NOT NULL,
      aviso INTEGER NOT NULL DEFAULT 0, fixa INTEGER NOT NULL DEFAULT 0, apagada INTEGER NOT NULL DEFAULT 0)`);
    this.sql.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)');
  }

  quem(req) {
    try { return JSON.parse(decodeURIComponent(req.headers.get('X-Quem') || '')); } catch (e) { return null; }
  }

  listar(depois) {
    const msgs = depois > 0
      ? this.sql.exec('SELECT id,pid,nome,texto,ts,aviso,fixa FROM msg WHERE apagada=0 AND id>? ORDER BY id LIMIT 500', depois).toArray()
      : this.sql.exec(`SELECT * FROM (SELECT id,pid,nome,texto,ts,aviso,fixa FROM msg WHERE apagada=0 ORDER BY id DESC LIMIT ${HISTORICO}) ORDER BY id`).toArray();
    const fixas = this.sql.exec('SELECT id,pid,nome,texto,ts,aviso,fixa FROM msg WHERE apagada=0 AND fixa=1 ORDER BY id DESC LIMIT 5').toArray();
    return { msgs, fixas };
  }

  difundir(obj, exceto) {
    const s = JSON.stringify(obj);
    for (const ws of this.state.getWebSockets()) {
      if (ws === exceto) continue;
      try { ws.send(s); } catch (e) { /* ligacao morta: o runtime fecha-a */ }
    }
  }

  presentes() {
    const set = new Set();
    for (const ws of this.state.getWebSockets()) {
      if (ws.readyState !== 1) continue;      // so as ligacoes abertas
      const a = ws.deserializeAttachment();
      if (a && a.pid) set.add(a.pid);
    }
    return [...set];
  }

  guardar(q, texto, aviso) {
    texto = String(texto == null ? '' : texto).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, MAX_TEXTO);
    if (!texto) return { erro: 'vazia', status: 400 };
    const agora = Date.now();
    const lista = (this.recentes.get(q.pid) || []).filter((t) => agora - t < 30000);
    if (lista.length >= 15) return { erro: 'devagar', status: 429 };
    lista.push(agora); this.recentes.set(q.pid, lista);
    const eAviso = aviso && q.papel === 'dono' ? 1 : 0;
    this.sql.exec('INSERT INTO msg (pid,nome,texto,ts,aviso,fixa) VALUES (?,?,?,?,?,?)', q.pid, q.nome, texto, agora, eAviso, eAviso);
    const id = this.sql.exec('SELECT last_insert_rowid() AS id').one().id;
    // o historico nao cresce sem fim
    const total = this.sql.exec('SELECT COUNT(*) AS n FROM msg').one().n;
    if (total > MAX_MENSAGENS) this.sql.exec('DELETE FROM msg WHERE id IN (SELECT id FROM msg ORDER BY id LIMIT ?)', total - MAX_MENSAGENS);
    const m = { id, pid: q.pid, nome: q.nome, texto, ts: agora, aviso: eAviso, fixa: eAviso };
    this.difundir({ t: 'msg', m });
    return { m };
  }

  async fetch(req) {
    const url = new URL(req.url);
    const q = this.quem(req);

    if (url.pathname === '/iniciar' && req.method === 'POST') {
      const b = await req.json();
      this.sql.exec('INSERT OR REPLACE INTO meta (k,v) VALUES (?,?)', 'expira', String(b.expira || 0));
      if (b.expira) await this.state.storage.setAlarm(Number(b.expira) + 24 * 3600 * 1000);
      return new Response('{}');
    }
    if (url.pathname === '/limpar' && req.method === 'POST') {
      for (const ws of this.state.getWebSockets()) { try { ws.close(4001, 'sala fechada'); } catch (e) { /* ja fechada */ } }
      await this.state.storage.deleteAlarm();
      await this.state.storage.deleteAll();
      this.esquema();                 // a sala pode voltar a ser usada (mesmo evento, links novos)
      return new Response('{}');
    }
    if (url.pathname === '/expulsar' && req.method === 'POST') {
      const b = await req.json();
      for (const ws of this.state.getWebSockets()) {
        const a = ws.deserializeAttachment();
        if (a && a.pid === b.pid) { try { ws.close(4001, 'removido'); } catch (e) { /* ja fechada */ } }
      }
      return new Response('{}');
    }

    if (!q || !q.pid) return new Response('{"error":"quem"}', { status: 401 });

    if (url.pathname === '/msgs' && req.method === 'GET') {
      return Response.json({ ...this.listar(Number(url.searchParams.get('depois')) || 0), online: this.presentes() });
    }
    if (url.pathname === '/enviar' && req.method === 'POST') {
      const b = await req.json();
      const r = this.guardar(q, b.texto, !!b.aviso);
      return Response.json(r.erro ? { error: r.erro } : { m: r.m }, { status: r.erro ? r.status : 200 });
    }
    if (url.pathname === '/apagar' && req.method === 'POST') {
      const b = await req.json();
      this.sql.exec('UPDATE msg SET apagada=1, fixa=0 WHERE id=?', Number(b.id) || 0);
      this.difundir({ t: 'del', id: Number(b.id) || 0 });
      return Response.json({ ok: true });
    }
    if (url.pathname === '/fixar' && req.method === 'POST') {
      const b = await req.json();
      this.sql.exec('UPDATE msg SET fixa=? WHERE id=? AND apagada=0', b.fixa ? 1 : 0, Number(b.id) || 0);
      this.difundir({ t: 'fixa', id: Number(b.id) || 0, fixa: b.fixa ? 1 : 0 });
      return Response.json({ ok: true });
    }
    if (url.pathname === '/ws') {
      const par = new WebSocketPair();
      const [cliente, servidor] = Object.values(par);
      this.state.acceptWebSocket(servidor);
      servidor.serializeAttachment({ pid: q.pid, nome: q.nome, papel: q.papel });
      servidor.send(JSON.stringify({ t: 'ola', ...this.listar(0), online: this.presentes() }));
      this.difundir({ t: 'online', online: this.presentes() }, servidor);
      return new Response(null, { status: 101, webSocket: cliente });
    }
    return new Response('{"error":"rota"}', { status: 404 });
  }

  webSocketMessage(ws, msg) {
    const a = ws.deserializeAttachment();
    if (!a || typeof msg !== 'string' || msg.length > MAX_TEXTO * 4) return;
    let d;
    try { d = JSON.parse(msg); } catch (e) { return; }
    if (d.t === 'ping') { ws.send('{"t":"pong"}'); return; }
    if (d.t === 'msg') {
      const r = this.guardar(a, d.texto, !!d.aviso);
      if (r.erro) ws.send(JSON.stringify({ t: 'erro', erro: r.erro, cid: d.cid }));
      else ws.send(JSON.stringify({ t: 'ok', cid: d.cid, id: r.m.id }));
    }
  }

  webSocketClose(ws) {
    try { ws.close(); } catch (e) { /* ja fechada */ }
    this.difundir({ t: 'online', online: this.presentes() });
  }

  webSocketError() { /* o runtime fecha a ligacao */ }

  async alarm() {
    // passou o prazo da sala: apaga tudo
    await this.state.storage.deleteAll();
    this.esquema();
  }
}
