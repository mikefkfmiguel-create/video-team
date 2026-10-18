// node tests/chat.test.mjs — o Worker REAL (`wrangler dev --local`, porta 8786) a reencaminhar o que o dono faz para o servidor do chat
// (chat-vps/server.py, porta 8793, base nova). Nada de producao. Precisa do venv de chat-vps (aiohttp, pywebpush).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(AQUI, '..');
const WORKER = path.join(RAIZ, 'worker');
const WRANGLER = [path.join(WORKER, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), path.join(RAIZ, '..', 'FOTOWALL', 'worker', 'node_modules', 'wrangler', 'bin', 'wrangler.js')].find((p) => fs.existsSync(p));
const PY = path.join(RAIZ, 'chat-vps', '.venv', 'Scripts', 'python.exe');
const W = 'http://127.0.0.1:8786';
const C = 'http://127.0.0.1:8793';
const SEGREDO = 'segredo-so-de-teste';
let falhas = 0;
const ok = (c, n) => { console.log((c ? 'OK    ' : 'FALHA ') + n); if (!c) falhas++; };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

const srv = spawn(PY, [path.join(RAIZ, 'chat-vps', 'server.py')], { env: { ...process.env, VTCHAT_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'vt_chatw_')), VTCHAT_SECRET: SEGREDO, VTCHAT_PORT: '8793' }, stdio: 'ignore' });
const wr = spawn(process.execPath, [WRANGLER, 'dev', '--local', '--port', '8786', '--persist-to', fs.mkdtempSync(path.join(os.tmpdir(), 'vt_chatw2_')), '--var', 'VT_PIN_ADMIN:dono-teste', '--var', 'CHAT_URL:' + C, '--var', 'CHAT_SECRET:' + SEGREDO, '--var', 'ALLOWED_ORIGINS:http://x'], { cwd: WORKER, stdio: 'ignore' });
const matar = (p) => { try { spawnSync('taskkill', ['/F', '/T', '/PID', String(p.pid)], { stdio: 'ignore' }); } catch (e) { /* ja morreu */ } };
const sair = (cod) => { matar(wr); matar(srv); process.exit(cod); };

const dono = async (caminho, corpo, pin = 'dono-teste') => {
  const r = await fetch(W + caminho, { method: corpo ? 'POST' : 'GET', headers: { 'X-PIN': pin, 'Content-Type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined });
  let j = null; try { j = await r.json(); } catch (e) { /* sem corpo */ }
  return { s: r.status, j };
};
const membro = async (k) => { const r = await fetch(C + '/chat/api/sala', { headers: { 'X-Chat': k } }); return { s: r.status, j: r.ok ? await r.json() : null }; };

try {
  for (let i = 0; i < 120; i++) { try { await fetch(W + '/api/ping'); await fetch(C + '/chat/'); break; } catch (e) { await espera(500); } }
  const KEY = 'os:900:Congresso Teste';
  const membros = [{ id: '11', name: 'Ana Silva', grupo: 'Vídeo' }, { id: '12', name: 'Rui Costa', grupo: 'Vídeo' }];

  const saude = await (await fetch(W + '/api/chat-saude')).json();
  ok(saude.ok === true, 'a verificacao de saude confirma que o Worker fala com o servidor do chat com o segredo certo');
  ok((await dono('/api/admin/chat/criar', { key: KEY, membros }, 'ninguem')).s === 401, 'sem a chave do dono o Worker nem reencaminha (401)');
  const c = await dono('/api/admin/chat/criar', { key: KEY, label: 'Congresso Teste', ate: '2099-01-02', membros, donoNome: 'Mike' });
  ok(c.s === 200 && c.j.novo && c.j.membros.length === 2 && c.j.dono.token, 'o dono cria a sala (Worker -> servidor do chat)');
  const tok = Object.fromEntries(c.j.membros.map((m) => [m.id, m.token]));
  const s1 = await membro(tok['11']);
  ok(s1.s === 200 && s1.j.eu.nome === 'Ana Silva' && s1.j.evento === 'Congresso Teste', 'o link da Ana abre direto no servidor do chat');
  const v = await dono('/api/admin/chat?key=' + encodeURIComponent(KEY));
  ok(v.j.existe && v.j.membros.length === 2 && v.j.dono.token === c.j.dono.token, 'o dono volta a ver a sala');
  ok((await dono('/api/admin/chat?key=nada')).j.existe === false, 'evento sem sala');
  const c2 = await dono('/api/admin/chat/criar', { key: KEY, label: 'Congresso Teste', membros: [...membros, { id: '13', name: 'Marta Lopes' }] });
  ok(c2.j.membros.length === 3 && !c2.j.novo && c2.j.membros.find((m) => m.id === '11').token === tok['11'], 'acrescentar pessoas mantem os links');
  const rem = await dono('/api/admin/chat/remover', { key: KEY, id: '12' });
  ok(rem.j.membros.length === 2 && (await membro(tok['12'])).s === 401, 'retirar: o link deixa de funcionar');
  ok((await dono('/api/admin/chat/nada', { x: 1 })).s === 404, 'rota desconhecida: 404');
  const fe = await dono('/api/admin/chat/fechar', { key: KEY });
  ok(fe.j.ok && (await membro(tok['11'])).s === 401, 'fechar a sala invalida os links');
  const semSegredoNoCorpo = JSON.stringify(c.j);
  ok(!semSegredoNoCorpo.includes(SEGREDO), 'o segredo do servidor nunca aparece nas respostas');

  matar(srv);
  await espera(800);
  const off = await dono('/api/admin/chat?key=x');
  ok(off.s === 502 && /nao respondeu/.test(off.j.error), 'servidor do chat em baixo: o Worker responde 502 claro (nao 401)');
  ok((await (await fetch(W + '/api/chat-saude')).json()).ok === false, 'e a verificacao de saude diz que nao esta bem');
} catch (e) {
  console.log('ERRO ' + (e && e.stack || e));
  falhas++;
}
console.log('\nfalhas: ' + falhas);
sair(falhas ? 1 : 0);
