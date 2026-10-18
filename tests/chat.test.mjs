// node tests/chat.test.mjs — Worker REAL em `wrangler dev --local` (KV e Durable Object locais, estado novo), porta 8786.
// Nada de producao; o 7Eventos nunca e contactado (o chat nao precisa dele). Usa o wrangler da pasta do Fotowall se este nao estiver instalado aqui.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.join(AQUI, '..', 'worker');
const WRANGLER = [path.join(WORKER, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), path.join(AQUI, '..', '..', 'FOTOWALL', 'worker', 'node_modules', 'wrangler', 'bin', 'wrangler.js')].find((p) => fs.existsSync(p));
const PORTA = 8786;
const B = `http://127.0.0.1:${PORTA}`;
const WS = `ws://127.0.0.1:${PORTA}`;
let falhas = 0;
const ok = (c, n) => { console.log((c ? 'OK    ' : 'FALHA ') + n); if (!c) falhas++; };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
async function ate(cond, ms = 5000) { const fim = Date.now() + ms; while (Date.now() < fim) { if (cond()) return true; await espera(40); } return cond(); }

const proc = spawn(process.execPath, [WRANGLER, 'dev', '--local', '--port', String(PORTA), '--persist-to', fs.mkdtempSync(path.join(os.tmpdir(), 'vt_chat_')), '--var', 'VT_PIN_ADMIN:dono-teste', '--var', 'ALLOWED_ORIGINS:http://x'], { cwd: WORKER, stdio: 'ignore' });
const sair = (cod) => { try { proc.kill(); } catch (e) { /* ja morreu */ } process.exit(cod); };

const api = async (caminho, { pin, k, method = 'GET', body } = {}) => {
  const h = { 'Content-Type': 'application/json' };
  if (pin) h['X-PIN'] = pin;
  if (k) h['X-Chat'] = k;
  const r = await fetch(B + caminho, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (e) { /* sem corpo */ }
  return { s: r.status, j };
};
const dono = (caminho, body, method = 'POST') => api(caminho, { pin: 'dono-teste', method, body });

try {
  for (let i = 0; i < 120; i++) { try { await fetch(B + '/api/ping'); break; } catch (e) { await espera(500); } }

  const KEY = 'os:900:Congresso Teste';
  const membros = [{ id: '11', name: 'Ana Silva', grupo: 'Vídeo' }, { id: '12', name: 'Rui Costa', grupo: 'Vídeo' }, { id: '13', name: 'Marta Lopes', grupo: 'Luz' }];

  // ---- criar
  const sem = await api('/api/admin/chat/criar', { pin: 'ninguem', method: 'POST', body: { key: KEY, membros } });
  ok(sem.s === 401, 'sem a chave do dono nao se cria nada (' + sem.s + ')');
  let c = await dono('/api/admin/chat/criar', { key: KEY, label: 'Congresso Teste', ate: '2099-01-02', membros, donoNome: 'Mike (Régie)' });
  ok(c.s === 200 && c.j.novo && c.j.membros.length === 3 && c.j.dono.token, 'o dono cria a sala com 3 pessoas e fica com o seu link');
  const tok = Object.fromEntries(c.j.membros.map((m) => [m.id, m.token]));
  ok(Object.values(tok).every((t) => /^[a-f0-9]{40}$/.test(t)) && new Set(Object.values(tok)).size === 3, 'cada pessoa tem um link (token) diferente');
  const c2 = await dono('/api/admin/chat/criar', { key: KEY, label: 'Congresso Teste', membros: [...membros, { id: '14', name: 'Hugo Dias' }] });
  ok(c2.j.membros.length === 4 && !c2.j.novo && c2.j.membros.find((m) => m.id === '11').token === tok['11'], 'criar outra vez acrescenta pessoas e mantem os links que ja foram enviados');
  tok['14'] = c2.j.membros.find((m) => m.id === '14').token;
  const ver = await dono('/api/admin/chat?key=' + encodeURIComponent(KEY), null, 'GET');
  ok(ver.j.existe && ver.j.membros.length === 4 && ver.j.dono.token === c.j.dono.token, 'o dono volta a ver a sala e os links');
  ok((await dono('/api/admin/chat?key=nada', null, 'GET')).j.existe === false, 'evento sem sala: existe=false');
  const longe = await dono('/api/admin/chat/criar', { key: 'os:1:Antigo', membros: [membros[0]], ate: '2001-01-01' });
  ok(longe.j.expira > Date.now() + 86400e3, 'um prazo ja passado nao cria uma sala que expira logo');

  // ---- entrar
  ok((await api('/api/chat/sala', { k: 'x'.repeat(40) })).s === 401, 'um link inventado nao entra');
  ok((await api('/api/chat/sala')).s === 401, 'sem link nao entra');
  const sala = await api('/api/chat/sala', { k: tok['11'] });
  ok(sala.s === 200 && sala.j.eu.pid === '11' && sala.j.eu.nome === 'Ana Silva' && sala.j.evento === 'Congresso Teste' && sala.j.msgs.length === 0, 'a Ana entra: sabe quem e, o evento e a sala vem vazia');
  ok(sala.j.membros.length === 5 && !JSON.stringify(sala.j).includes(tok['12']), 've quem esta na sala, mas nunca os links dos outros');

  // ---- mensagens por HTTP
  const m1 = await api('/api/chat/enviar', { k: tok['11'], method: 'POST', body: { texto: '  Chego às 8h, entrada B  ' } });
  ok(m1.s === 200 && m1.j.m.texto === 'Chego às 8h, entrada B' && m1.j.m.nome === 'Ana Silva' && !m1.j.m.aviso, 'enviar guarda a mensagem com o nome certo (sem espacos a mais)');
  ok((await api('/api/chat/enviar', { k: tok['11'], method: 'POST', body: { texto: '   ' } })).s === 400, 'mensagem vazia recusada');
  const falsoAviso = await api('/api/chat/enviar', { k: tok['12'], method: 'POST', body: { texto: 'sou o chefe', aviso: true } });
  ok(falsoAviso.j.m.aviso === 0 && falsoAviso.j.m.fixa === 0, 'um membro nao consegue fazer aviso fixo');
  const grande = await api('/api/chat/enviar', { k: tok['12'], method: 'POST', body: { texto: 'a'.repeat(5000) } });
  ok(grande.j.m.texto.length === 2000, 'texto limitado a 2000 caracteres');
  const lista = await api('/api/chat/msgs?depois=' + m1.j.m.id, { k: tok['13'] });
  ok(lista.j.msgs.length === 2 && lista.j.msgs[0].nome === 'Rui Costa', 'outra pessoa le o que veio depois de uma mensagem (polling)');

  // ---- tempo real
  const recebidas = { a: [], b: [] };
  const abrir = (k, destino) => new Promise((res, rej) => {
    const ws = new WebSocket(`${WS}/api/chat/ws?k=${k}`);
    ws.onmessage = (e) => destino.push(JSON.parse(e.data));
    ws.onopen = () => res(ws);
    ws.onerror = () => rej(new Error('ws'));
  });
  const wa = await abrir(tok['11'], recebidas.a);
  ok(await ate(() => recebidas.a.some((x) => x.t === 'ola' && x.msgs.length === 3)), 'ao ligar, recebe o historico (3 mensagens)');
  const wb = await abrir(tok['13'], recebidas.b);
  ok(await ate(() => recebidas.a.some((x) => x.t === 'online' && x.online.includes('13'))), 'a Ana ve que a Marta entrou (online)');
  wa.send(JSON.stringify({ t: 'msg', texto: 'Alguém tem um cabo HDMI?', cid: 'c1' }));
  ok(await ate(() => recebidas.b.some((x) => x.t === 'msg' && x.m.texto === 'Alguém tem um cabo HDMI?' && x.m.nome === 'Ana Silva')), 'a Marta recebe logo a mensagem da Ana (tempo real)');
  ok(await ate(() => recebidas.a.some((x) => x.t === 'ok' && x.cid === 'c1')), 'a Ana recebe a confirmacao do envio');
  wa.send(JSON.stringify({ t: 'ping' }));
  ok(await ate(() => recebidas.a.some((x) => x.t === 'pong')), 'ping/pong');

  // ---- ritmo
  for (let i = 0; i < 20; i++) wb.send(JSON.stringify({ t: 'msg', texto: 'spam ' + i, cid: 's' + i }));
  ok(await ate(() => recebidas.b.some((x) => x.t === 'erro' && x.erro === 'devagar')), 'enviar demasiado depressa trava (anti-spam)');

  // ---- a regie
  const aviso = await api('/api/chat/enviar', { k: c.j.dono.token, method: 'POST', body: { texto: 'Chegada às 7h, entrada B', aviso: true } });
  ok(aviso.j.m.aviso === 1 && aviso.j.m.fixa === 1 && aviso.j.m.nome === 'Mike (Régie)', 'a regie faz um aviso fixo');
  ok(await ate(() => recebidas.a.some((x) => x.t === 'msg' && x.m.aviso === 1)), 'o aviso chega a todos em tempo real');
  const s2 = await api('/api/chat/sala', { k: tok['13'] });
  ok(s2.j.fixas.length === 1 && s2.j.fixas[0].texto.includes('7h'), 'quem entra depois ve o aviso fixo no topo');
  ok((await api('/api/chat/apagar', { k: tok['11'], method: 'POST', body: { id: m1.j.m.id } })).s === 403, 'um membro nao apaga mensagens');
  ok((await api('/api/chat/apagar', { k: c.j.dono.token, method: 'POST', body: { id: m1.j.m.id } })).s === 200, 'a regie apaga uma mensagem');
  ok(await ate(() => recebidas.b.some((x) => x.t === 'del' && x.id === m1.j.m.id)), 'a mensagem apagada some a todos');
  ok(!(await api('/api/chat/msgs', { k: tok['13'] })).j.msgs.some((x) => x.id === m1.j.m.id), '...e nao volta ao reabrir');

  // ---- retirar uma pessoa
  let fechou = false; wa.onclose = (e) => { fechou = e.code; };
  const rem = await dono('/api/admin/chat/remover', { key: KEY, id: '11' });
  ok(rem.j.membros.length === 3, 'a Ana e retirada da sala');
  ok((await api('/api/chat/sala', { k: tok['11'] })).s === 401, 'o link da Ana deixa de funcionar na hora');
  ok(await ate(() => fechou === 4001), 'e a ligacao dela em direto e cortada');
  wb.close();

  // ---- fechar
  const fe = await dono('/api/admin/chat/fechar', { key: KEY });
  ok(fe.j.ok && (await api('/api/chat/sala', { k: tok['12'] })).s === 401 && (await api('/api/chat/sala', { k: c.j.dono.token })).s === 401, 'fechar a sala invalida todos os links');
  const nova = await dono('/api/admin/chat/criar', { key: KEY, label: 'Congresso Teste', membros });
  const s3 = await api('/api/chat/sala', { k: nova.j.membros[0].token });
  ok(s3.s === 200 && s3.j.msgs.length === 0, 'uma sala nova com o mesmo evento comeca sem mensagens antigas');
  ok(nova.j.membros[0].token !== tok['11'], '...e com links novos');
} catch (e) {
  console.log('ERRO ' + (e && e.stack || e));
  falhas++;
}
console.log('\nfalhas: ' + falhas);
sair(falhas ? 1 : 0);
