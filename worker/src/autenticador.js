// Entrada do DONO com o autenticador (TOTP, RFC 6238), em vez de uma chave fixa para decorar.
// O dono escreve o codigo de 6 digitos da app de autenticador e recebe uma SESSAO (token aleatorio, 7 dias) que o ecra usa no lugar da chave
// (cabecalho X-PIN, como ate aqui). A chave fixa (VT_PIN_ADMIN) continua a servir de recuperacao, e ha 8 codigos de recuperacao de uso unico.
// KV `FOTOS`: totp:segredo (base32) · totp:pendente (15 min) · totp:ultimo (ultimo passo aceite) · totp:rec (hashes) · sess:<sha256 do token> · rl:<ip>
// Nada disto se mistura com os pedidos de acesso da equipa (req:*).

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const SESSAO_S = 7 * 24 * 3600;
const PREFIXO_SESSAO = 'S-';
const LIMITE_FALHAS = 8;
const JANELA_FALHAS_S = 600;

export function base32(bytes) {
  let bits = 0, valor = 0, saida = '';
  for (const b of bytes) {
    valor = (valor << 8) | b;
    bits += 8;
    while (bits >= 5) { saida += B32[(valor >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) saida += B32[(valor << (5 - bits)) & 31];
  return saida;
}

function base32Bytes(txt) {
  let bits = 0, valor = 0;
  const out = [];
  for (const c of String(txt).toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    valor = (valor << 5) | B32.indexOf(c);
    bits += 5;
    if (bits >= 8) { out.push((valor >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}

async function sha256Hex(txt) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt)));
  return [...h].map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function igual(a, b) {
  const [x, y] = await Promise.all([sha256Hex(String(a)), sha256Hex(String(b))]);
  return x === y;
}

function aleatorioB32(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return base32(b);
}

export async function codigoTotp(segredoB32, passo) {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setUint32(4, passo >>> 0);
  new DataView(buf).setUint32(0, Math.floor(passo / 4294967296));
  const k = await crypto.subtle.importKey('raw', base32Bytes(segredoB32), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', k, buf));
  const o = h[19] & 15;
  const n = (((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1000000;
  return String(n).padStart(6, '0');
}

// devolve o passo aceite ou null; aceita +-1 passo (30 s) e nunca repete um passo ja usado
export async function totpValido(segredoB32, codigo, ultimoPasso, agoraMs = Date.now()) {
  const dado = String(codigo || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(dado)) return null;
  const agora = Math.floor(agoraMs / 30000);
  for (const d of [0, -1, 1]) {
    const passo = agora + d;
    if (passo <= (ultimoPasso || 0)) continue;
    if (await igual(await codigoTotp(segredoB32, passo), dado)) return passo;
  }
  return null;
}

// ---- sessoes
export async function sessaoValida(env, token) {
  if (!token || !String(token).startsWith(PREFIXO_SESSAO) || token.length < 20 || token.length > 80) return false;
  return (await env.FOTOS.get(`sess:${await sha256Hex(token)}`)) === '1';
}

async function criarSessao(env) {
  const token = PREFIXO_SESSAO + aleatorioB32(32);
  await env.FOTOS.put(`sess:${await sha256Hex(token)}`, '1', { expirationTtl: SESSAO_S });
  return token;
}

async function falhasDoIp(req, env) {
  const chave = `rl:${req.headers.get('CF-Connecting-IP') || '?'}`;
  return { chave, falhas: parseInt((await env.FOTOS.get(chave)) || '0', 10) || 0 };
}

// ---- rotas publicas
export async function estadoDono(env, h, { json }) {
  return json({ ok: true, autenticador: !!(await env.FOTOS.get('totp:segredo')) }, 200, h);
}

// POST /api/dono/entrar  { codigo } | { recuperacao }
export async function entrarDono(req, env, h, { json, readJson }) {
  const rl = await falhasDoIp(req, env);
  if (rl.falhas >= LIMITE_FALHAS) return json({ error: 'Demasiadas tentativas. Espera uns minutos.' }, 429, h);
  const corpo = (await readJson(req)) || {};
  const segredo = await env.FOTOS.get('totp:segredo');
  let ok = false;
  if (corpo.codigo && segredo) {
    const ultimo = parseInt((await env.FOTOS.get('totp:ultimo')) || '0', 10) || 0;
    const passo = await totpValido(segredo, corpo.codigo, ultimo);
    if (passo) { await env.FOTOS.put('totp:ultimo', String(passo)); ok = true; }
  } else if (corpo.recuperacao) {
    const hsh = await sha256Hex(String(corpo.recuperacao).toUpperCase().replace(/[^A-Z0-9]/g, ''));
    const lista = (await env.FOTOS.get('totp:rec', 'json')) || [];
    const i = lista.indexOf(hsh);
    if (i >= 0) { lista.splice(i, 1); await env.FOTOS.put('totp:rec', JSON.stringify(lista)); ok = true; }
  }
  if (!ok) {
    await env.FOTOS.put(rl.chave, String(rl.falhas + 1), { expirationTtl: JANELA_FALHAS_S });
    await new Promise((r) => setTimeout(r, 600));
    return json({ error: corpo.codigo ? (segredo ? 'Código errado ou já usado. Espera pelo próximo e tenta outra vez.' : 'O autenticador ainda não está ativo.') : 'Dados errados.' }, 401, h);
  }
  return json({ ok: true, token: await criarSessao(env), role: 'owner', expiresAt: Date.now() + SESSAO_S * 1000 }, 200, h);
}

// ---- rotas do dono (ja autenticado em index.js)
// POST /api/admin/autenticador/preparar -> segredo novo (15 min) para por na app de autenticador
export async function prepararAutenticador(env, h, { json }) {
  const segredo = aleatorioB32(20);
  await env.FOTOS.put('totp:pendente', segredo, { expirationTtl: 900 });
  return json({ ok: true, segredo, otpauth: `otpauth://totp/Video%20Team:dono?secret=${segredo}&issuer=Video%20Team&algorithm=SHA1&digits=6&period=30`, jaAtivo: !!(await env.FOTOS.get('totp:segredo')) }, 200, h);
}

// POST /api/admin/autenticador/confirmar { codigo } -> ativa e devolve 8 codigos de recuperacao (so desta vez)
export async function confirmarAutenticador(req, env, h, { json, readJson }) {
  const corpo = (await readJson(req)) || {};
  const pendente = await env.FOTOS.get('totp:pendente');
  if (!pendente) return json({ error: 'Já passaram 15 minutos. Começa outra vez.' }, 410, h);
  const passo = await totpValido(pendente, corpo.codigo, 0);
  if (!passo) return json({ error: 'Esse código não bate certo. Confirma a hora do telemóvel e tenta o seguinte.' }, 400, h);
  const codigos = [], hashes = [];
  for (let i = 0; i < 8; i++) {
    const c = aleatorioB32(6);               // 6 bytes = 10 caracteres
    codigos.push(c.slice(0, 5) + '-' + c.slice(5));
    hashes.push(await sha256Hex(c));
  }
  await env.FOTOS.put('totp:segredo', pendente);
  await env.FOTOS.put('totp:ultimo', String(passo));
  await env.FOTOS.put('totp:rec', JSON.stringify(hashes));
  await env.FOTOS.delete('totp:pendente');
  return json({ ok: true, recuperacao: codigos }, 200, h);
}
