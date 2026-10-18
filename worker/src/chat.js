// Chat por evento (Video Team): o servidor do chat vive no VPS (https://things-on.mike-app.com/chat/, ver chat-vps/).
// Este Worker so faz de ponte para o DONO: confere a chave do dono (VT_PIN_ADMIN, em index.js) e reencaminha criar/ver/remover/fechar
// para o servidor do chat com o segredo CHAT_SECRET (so o Worker e o VPS o conhecem). Nunca guarda mensagens, links nem contactos.

const CAMINHOS = { '/criar': 'POST', '/remover': 'POST', '/fechar': 'POST', '/convite': 'POST', '/libertar': 'POST', '/prolongar': 'POST', '/adicionar': 'POST', '/tipo': 'POST' };

export async function handleChatAdmin(url, req, env, h, { json }) {
  if (!env.CHAT_URL || !env.CHAT_SECRET) return json({ error: 'o chat ainda nao esta configurado neste servidor' }, 503, h);
  const rota = url.pathname.replace('/api/admin/chat', '') || '/';
  let destino;
  let init = { method: 'GET', headers: { 'X-Chat-Admin': env.CHAT_SECRET } };
  if (rota === '/' && req.method === 'GET') {
    destino = '/chat/api/admin/ver?key=' + encodeURIComponent(String(url.searchParams.get('key') || '').slice(0, 300));
  } else if (CAMINHOS[rota] && req.method === CAMINHOS[rota]) {
    destino = '/chat/api/admin' + rota;
    init = { method: 'POST', headers: { 'X-Chat-Admin': env.CHAT_SECRET, 'Content-Type': 'application/json' }, body: await req.text() };
  } else {
    return json({ error: 'rota' }, 404, h);
  }
  let r;
  try {
    r = await fetch(env.CHAT_URL.replace(/\/$/, '') + destino, init);
  } catch (e) {
    return json({ error: 'o servidor do chat nao respondeu' }, 502, h);
  }
  let corpo = null;
  try { corpo = await r.json(); } catch (e) { /* sem corpo */ }
  if (r.status === 401 || r.status === 403) return json({ error: 'o Worker e o servidor do chat nao se entendem (segredo)' }, 502, h);   // nunca 401: o ecra tomava-o por «chave do dono errada»
  return json(corpo || { error: 'resposta invalida do servidor do chat' }, corpo ? r.status : 502, h);
}

// Sem chave e sem dados: so diz se o Worker consegue falar com o servidor do chat com o segredo certo (serve para conferir a instalacao).
export async function saudeChat(env, h, { json }) {
  if (!env.CHAT_URL || !env.CHAT_SECRET) return json({ ok: false, motivo: 'nao configurado' }, 200, h);
  try {
    const r = await fetch(env.CHAT_URL.replace(/\/$/, '') + '/chat/api/admin/ver?key=saude', { headers: { 'X-Chat-Admin': env.CHAT_SECRET } });
    return json(r.ok ? { ok: true } : { ok: false, motivo: r.status === 401 ? 'segredo diferente' : 'erro ' + r.status }, 200, h);
  } catch (e) {
    return json({ ok: false, motivo: 'servidor do chat nao responde' }, 200, h);
  }
}
