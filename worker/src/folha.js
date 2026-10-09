// Importacao unica da folha do Google + ficheiros temporarios (exportar/imprimir).
// A folha tem nomes e telefones: aqui corta-se tudo o que nao e a coluna TECNICO e os dias,
// e qualquer numero parecido com telefone, para que NUNCA cheguem a app.

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1uZ7o2sLkpPkL2awYIubdGWOECElYVYmdRZUl2hM2aoo/export?format=csv&gid=2001861610';
const PHONE_RE = /(\+?\d{2,3}[ .-]?)?\b\d{3}[ .-]?\d{3}[ .-]?\d{3}\b/g;
export const DL_TTL = 600; // ficheiros temporarios para abrir no browser do sistema (s)

export class BadFolha extends Error {}

// CSV com aspas; devolve linhas de celulas
export function parseCsv(text) {
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

const clean = (v, n) => String(v == null ? '' : v).replace(PHONE_RE, '').replace(/\s+/g, ' ').trim().slice(0, n);
const nrm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export function folhaLimpa(csv) {
  const rows = parseCsv(csv);
  const hi = rows.findIndex((r) => r.some((c) => nrm(c) === 'tecnico'));
  if (hi < 0) throw new BadFolha('nao encontrei a coluna TECNICO na folha');
  const c0 = rows[hi].findIndex((c) => nrm(c) === 'tecnico');
  const header = rows[hi].slice(c0 + 1).map((c) => clean(c, 20));
  const out = [];
  for (const r of rows.slice(hi + 1, hi + 1 + 600)) {
    const nome = clean(r[c0], 80);
    if (!nome) continue;
    out.push({ nome, cells: header.map((_, i) => clean(r[c0 + 1 + i], 120)) });
  }
  return { header, rows: out };
}

export async function fetchFolha(env) {
  const res = await fetch(env.VT_SHEET_URL || SHEET_URL, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new BadFolha('a folha respondeu ' + res.status + ' (esta partilhada para ver sem login?)');
  const text = await res.text();
  if (text.length > 500 * 1024) throw new BadFolha('folha demasiado grande');
  return text;
}

export const randomToken = () => [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, '0')).join('');

// GET /dl/<token>: ficheiro temporario (CSV ou pagina para imprimir); o token e o segredo
export async function serveDl(env, token, h) {
  const f = /^[a-f0-9]{32}$/.test(token) && (await env.FOTOS.get(`dl:${token}`, 'json'));
  if (!f) return new Response('Link expirado. Volta a gerar no Video Team.', { status: 404, headers: { ...h, 'Content-Type': 'text/plain; charset=utf-8' } });
  const html = f.tipo === 'html';
  return new Response(f.conteudo, {
    headers: {
      ...h,
      'Content-Type': html ? 'text/html; charset=utf-8' : 'text/csv; charset=utf-8',
      ...(html ? { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'" } : { 'Content-Disposition': `attachment; filename="${f.nome}"` }),
      'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
    },
  });
}
