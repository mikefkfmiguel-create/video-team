// Equipa por sala/funcao: um documento por evento no KV (sala:<hash do sig>).
// So o dono (VT_PIN_ADMIN) le/escreve o documento completo; o link de projeto recebe
// apenas a vista publica (publicView), e so se o dono ligou "publicado".
// Nunca guarda nem devolve contactos: so ids de tecnicos (7Eventos) e ids de salas/funcoes.

const DOC_TTL = 400 * 24 * 3600; // renova a cada gravacao
const BAK_TTL = 30 * 24 * 3600; // copia da versao anterior
const CREW_TTL = 600; // cache da equipa oficial do evento (s)
const MAX_BYTES = 200 * 1024;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DMY_RE = /^\d{2}-\d{2}-\d{4}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,16}$/;
const TECH_RE = /^[\w .\-À-ÿ]{1,60}$/;
const RULES = ['semDestino', 'duasSalas', 'foraEscala', 'salaSemMix', 'salaSemCam'];

export class BadDoc extends Error {}

const str = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

export async function docId(sig) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(sig)));
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function list(v, max, what) {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > max) throw new BadDoc(`${what} invalido`);
  return v;
}

// valida e normaliza; qualquer referencia partida (sala/funcao inexistente, dia fora do evento) rejeita
export function sanitize(d) {
  if (!d || typeof d !== 'object') throw new BadDoc('documento invalido');
  const out = {
    v: 1,
    code: str(d.code, 40),
    evento: str(d.evento, 160),
    ancora: DMY_RE.test(d.ancora) ? d.ancora : '',
    dias: [],
    grupos: list(d.grupos, 10, 'grupos').map((g) => str(g, 60)).filter(Boolean),
    salas: [],
    funcoes: [],
    regras: {},
    aloc: {},
    nomes: {},
    ignorar: list(d.ignorar, 500, 'ignorar').map((s) => str(s, 200)).filter(Boolean),
    link: { publicado: !!(d.link && d.link.publicado), mostra: 'equipa' },
  };

  const days = new Set();
  for (const k of list(d.dias, 62, 'dias')) {
    if (!DAY_RE.test(k)) throw new BadDoc('dia invalido');
    days.add(k);
  }
  out.dias = [...days].sort();

  const salaIds = new Set(), funIds = new Set();
  for (const s of list(d.salas, 40, 'salas')) {
    if (!s || !ID_RE.test(s.id) || salaIds.has(s.id)) throw new BadDoc('sala invalida');
    salaIds.add(s.id);
    const nome = str(s.nome, 60);
    if (!nome) throw new BadDoc('sala sem nome');
    out.salas.push({
      id: s.id, nome, curto: str(s.curto, 30) || nome.toUpperCase(),
      alias: list(s.alias, 10, 'alias').map((a) => str(a, 40)).filter(Boolean),
      regras: s.regras === 'off' ? 'off' : 'herdar',
    });
  }
  for (const f of list(d.funcoes, 30, 'funcoes')) {
    if (!f || !ID_RE.test(f.id) || funIds.has(f.id)) throw new BadDoc('funcao invalida');
    funIds.add(f.id);
    const nome = str(f.nome, 60);
    if (!nome) throw new BadDoc('funcao sem nome');
    out.funcoes.push({
      id: f.id, nome, curto: str(f.curto, 30) || nome.toUpperCase(),
      conta: f.conta === 'mix' || f.conta === 'cam' ? f.conta : null,
      alias: list(f.alias, 10, 'alias').map((a) => str(a, 40)).filter(Boolean),
    });
  }
  for (const r of RULES) out.regras[r] = d.regras && d.regras[r] === 'off' ? 'off' : 'aviso';

  const aloc = d.aloc && typeof d.aloc === 'object' ? d.aloc : {};
  const techs = Object.keys(aloc);
  if (techs.length > 400) throw new BadDoc('demasiados tecnicos');
  for (const t of techs) {
    if (!TECH_RE.test(t)) throw new BadDoc('tecnico invalido');
    const byDay = {};
    for (const day of Object.keys(aloc[t] || {})) {
      if (!days.has(day)) throw new BadDoc('dia fora do evento');
      const items = list(aloc[t][day], 4, 'atribuicoes');
      const clean = items.map((x) => {
        const sala = x && x.sala != null ? String(x.sala) : null;
        if (sala !== null && !salaIds.has(sala)) throw new BadDoc('sala inexistente');
        const f = list(x && x.f, 6, 'funcoes').map(String);
        for (const id of f) if (!funIds.has(id)) throw new BadDoc('funcao inexistente');
        return { sala, f: [...new Set(f)] };
      }).filter((x) => x.sala !== null || x.f.length);
      if (clean.length) byDay[day] = clean;
    }
    if (Object.keys(byDay).length) out.aloc[t] = byDay;
  }
  const nomes = d.nomes && typeof d.nomes === 'object' ? d.nomes : {};
  for (const t of Object.keys(nomes).slice(0, 400)) {
    if (TECH_RE.test(t) && nomes[t] && nomes[t].folha) out.nomes[t] = { folha: str(nomes[t].folha, 80) };
  }
  if (JSON.stringify(out).length > MAX_BYTES) throw new BadDoc('documento demasiado grande');
  return out;
}

// o que o link de projeto pode ver: so atribuicoes de quem esta na equipa, sem avisos nem tabela da folha
export function publicView(doc, crewIds) {
  if (!doc || !doc.link || !doc.link.publicado) return null;
  const ids = new Set(crewIds);
  const aloc = {};
  for (const t of Object.keys(doc.aloc)) if (ids.has(t)) aloc[t] = doc.aloc[t];
  return {
    dias: doc.dias,
    grupos: doc.grupos,
    salas: doc.salas.map((s) => ({ id: s.id, nome: s.nome })),
    funcoes: doc.funcoes.map((f) => ({ id: f.id, nome: f.nome })),
    aloc,
  };
}

export async function loadDoc(env, sig) {
  return env.FOTOS.get(`sala:${await docId(sig)}`, 'json');
}

// equipa oficial do evento, com cache curta (varrer o 7Eventos custa varias chamadas)
async function crewFor(env, sig, anchor, fresh, deps) {
  const ck = `salacrew:${await docId(sig)}`;
  if (!fresh) {
    const hit = await env.FOTOS.get(ck, 'json');
    if (hit) return hit;
  }
  const view = await deps.projectView(env, { project: sig, anchor, name: sig });
  const out = view
    ? { at: Date.now(), event: view.event, code: view.code, days: view.days, crew: view.crew.map((c) => ({ id: c.id, name: c.name, grupo: c.grupo, days: c.days })) }
    : { at: Date.now(), event: '', code: '', days: [], crew: [] };
  await env.FOTOS.put(ck, JSON.stringify(out), { expirationTtl: CREW_TTL });
  return out;
}

// GET /api/admin/sala?key=<sig>&d=<dd-mm-aaaa>[&fresh=1]
// POST /api/admin/sala/guardar {key, doc, rev}
export async function handleSala(url, req, env, h, deps) {
  const { json, readJson, todayDMY } = deps;
  if (url.pathname === '/api/admin/sala' && req.method === 'GET') {
    const key = url.searchParams.get('key') || '';
    if (!key) return json({ error: 'evento invalido' }, 400, h);
    const dRaw = url.searchParams.get('d') || '';
    const doc = await loadDoc(env, key);
    const anchor = DMY_RE.test(dRaw) ? dRaw : (doc && doc.ancora) || todayDMY();
    const crew = await crewFor(env, key, anchor, url.searchParams.get('fresh') === '1', deps);
    return json({ doc, crew, anchor }, 200, h);
  }
  if (url.pathname === '/api/admin/sala/guardar' && req.method === 'POST') {
    const body = await readJson(req);
    const key = String((body && body.key) || '');
    if (!key) return json({ error: 'evento invalido' }, 400, h);
    let clean;
    try { clean = sanitize(body.doc); } catch (e) {
      if (e instanceof BadDoc) return json({ error: e.message }, 400, h);
      throw e;
    }
    const id = await docId(key);
    const prev = await env.FOTOS.get(`sala:${id}`, 'json');
    const rev = Number(body.rev) || 0;
    if (prev && prev.rev !== rev) return json({ error: 'rev', doc: prev }, 409, h);
    if (!prev && rev !== 0) return json({ error: 'rev', doc: null }, 409, h);
    clean.sig = key;
    clean.rev = (prev ? prev.rev : 0) + 1;
    clean.atualizadoEm = Date.now();
    if (prev) await env.FOTOS.put(`salabak:${id}`, JSON.stringify(prev), { expirationTtl: BAK_TTL });
    await env.FOTOS.put(`sala:${id}`, JSON.stringify(clean), { expirationTtl: DOC_TTL });
    return json({ rev: clean.rev, atualizadoEm: clean.atualizadoEm }, 200, h);
  }
  return json({ error: 'nada aqui' }, 404, h);
}
