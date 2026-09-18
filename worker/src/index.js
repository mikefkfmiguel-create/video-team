// Video Team — Worker que faz de ponte entre a pagina (GitHub Pages) e o 7Eventos.
// Faz login com as credenciais guardadas como segredos, le a escala e devolve JSON.
// So LE dados. Segredos: VT_USER, VT_PASSWORD, VT_PIN (equipa: so video), VT_PIN_ADMIN (tudo).
// Variavel: ALLOWED_ORIGINS.
import { parseEscala } from './parse.js';

const BASE = 'http://7eventos.avk.pt/7Eventos';
const FRESH = 5 * 60 * 1000; // depois disto, responde com a copia e atualiza por tras
const KEEP = 24 * 3600; // quanto tempo a copia fica guardada (s)

// cookies da sessao 7Eventos, vivem enquanto o isolate estiver quente
let jar = {};

function cookieHeader() {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

function absorb(res) {
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
}

async function login(env) {
  jar = {};
  const page = await fetch(`${BASE}/Account/Login`, { redirect: 'manual' });
  absorb(page);
  const m = (await page.text()).match(/name="__RequestVerificationToken" type="hidden" value="([^"]+)"/);
  if (!m) throw new Error('Pagina de login mudou');
  const body = new URLSearchParams({
    __RequestVerificationToken: m[1],
    UserName: env.VT_USER,
    Password: env.VT_PASSWORD,
    RememberMe: 'true',
  });
  const res = await fetch(`${BASE}/Account/Login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader() },
    body,
  });
  absorb(res);
  if (res.status !== 302 || /Account\/Login/i.test(res.headers.get('Location') || '')) {
    throw new Error('Login no 7Eventos falhou');
  }
}

async function fetchEscala(env, d) {
  const res = await authed(env, '/EscalasTecnicos/VistaSemanal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `txt_Periodo=${d}`,
  });
  if (!res.ok) throw new Error(`7Eventos respondeu ${res.status}`);
  const data = parseEscala(await res.text());
  data.at = Date.now();
  await caches.default.put(escalaKey(d), new Response(JSON.stringify(data), { headers: { 'Cache-Control': `max-age=${KEEP}` } }));
  return data;
}

const escalaKey = (d) => new Request(`https://cache.videoteam/escala/${d}`);

function todayDMY() {
  const p = new Intl.DateTimeFormat('pt-PT', { timeZone: 'Europe/Lisbon', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(new Date());
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g('day')}-${g('month')}-${g('year')}`;
}

// GET/POST autenticado; se cair no login, entra e tenta outra vez
async function authed(env, path, init = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!Object.keys(jar).length) await login(env);
    const res = await fetch(BASE + path, {
      ...init,
      redirect: 'manual',
      headers: { ...(init.headers || {}), Cookie: cookieHeader() },
    });
    if (res.status === 302 && /Account\/Login/i.test(res.headers.get('Location') || '')) {
      jar = {};
      continue;
    }
    return res;
  }
  throw new Error('Sessao 7Eventos recusada');
}

function cors(req, env) {
  const origin = req.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0] || '*',
    'Access-Control-Allow-Headers': 'X-PIN',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

// o link do PDF abre numa aba nova: um erro tem de ser uma pagina legivel, nao JSON
function pdfError(headers) {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PDF indisponível</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0C1020;color:#e8ecf5;font:15px system-ui,sans-serif;text-align:center;padding:24px">
<div><h2 style="margin:0 0 8px">PDF indisponível</h2><p style="color:#8f9ab0;max-width:340px">O 7Eventos não conseguiu gerar esta proposta técnica (erro do próprio 7Eventos). Tenta mais tarde ou abre-a no 7Eventos.</p></div></body>`;
  return new Response(html, { status: 502, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

async function same(a, b) {
  if (!a || !b) return false;
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  return crypto.subtle.timingSafeEqual(x, y);
}

// 'admin' ve todos os grupos; 'video' so os tecnicos de video
async function roleOf(pin, env) {
  if (await same(pin, env.VT_PIN_ADMIN)) return 'admin';
  if (await same(pin, env.VT_PIN)) return 'video';
  return null;
}

const isVideo = (p) => p.grupo.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes('video');

function forRole(data, role) {
  return role === 'admin' ? data : { ...data, people: data.people.filter(isVideo) };
}

export default {
  // cron: mantem a escala de hoje quente para ninguem esperar pelo 7Eventos
  async scheduled(_ev, env, ctx) {
    ctx.waitUntil(fetchEscala(env, todayDMY()));
  },

  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const h = cors(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    if (req.method !== 'GET') return json({ error: 'metodo' }, 405, h);

    const pin = req.headers.get('X-PIN') || url.searchParams.get('k');
    const role = await roleOf(pin, env);
    if (!role) {
      await new Promise((r) => setTimeout(r, 800)); // trava tentativas em serie
      return json({ error: 'pin' }, 401, h);
    }

    try {
      // /api/escala?d=dd-mm-yyyy
      if (url.pathname === '/api/escala') {
        const d = url.searchParams.get('d') || '';
        if (!/^\d{2}-\d{2}-\d{4}$/.test(d)) return json({ error: 'data' }, 400, h);
        if (url.searchParams.get('fresh') !== '1') {
          const hit = await caches.default.match(escalaKey(d));
          if (hit) {
            const data = await hit.json();
            if (Date.now() - data.at > FRESH) ctx.waitUntil(fetchEscala(env, d).catch(() => {}));
            return json(forRole(data, role), 200, h);
          }
        }
        return json(forRole(await fetchEscala(env, d), role), 200, h);
      }

      // /foto/203  -> foto do tecnico
      const fm = url.pathname.match(/^\/foto\/(\d+)$/);
      if (fm) {
        // miniatura guardada no KV (gerada por thumbs.py); senao a original
        const thumb = env.FOTOS && (await env.FOTOS.get(`t:${fm[1]}`, 'arrayBuffer'));
        if (thumb && !url.searchParams.has('orig')) {
          return new Response(thumb, { headers: { ...h, 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=604800' } });
        }
        const cache = caches.default;
        const key = new Request(`https://cache.videoteam/foto/${fm[1]}`);
        let img = await cache.match(key);
        if (!img) {
          const res = await authed(env, `/Images/FotosTecnicos/${fm[1]}.jpg`);
          if (!res.ok) return new Response(null, { status: 404, headers: h });
          img = new Response(res.body, {
            headers: { 'Content-Type': res.headers.get('Content-Type') || 'image/jpeg', 'Cache-Control': 'max-age=86400' },
          });
          ctx.waitUntil(cache.put(key, img.clone()));
        }
        return new Response(img.body, { headers: { ...h, 'Content-Type': img.headers.get('Content-Type'), 'Cache-Control': 'private, max-age=86400' } });
      }

      // /pdf/70733?d=dd-mm-yyyy  -> proposta tecnica (PDF) de um trabalho
      const pm = url.pathname.match(/^\/pdf\/(\d+)$/);
      if (pm) {
        const id = pm[1];
        if (role !== 'admin') {
          // a equipa so abre propostas de trabalhos que aparecem na escala dela
          const d = url.searchParams.get('d') || todayDMY();
          if (!/^\d{2}-\d{2}-\d{4}$/.test(d)) return json({ error: 'data' }, 400, h);
          const hit = await caches.default.match(escalaKey(d));
          const data = forRole(hit ? await hit.json() : await fetchEscala(env, d), role);
          const ok = data.people.some((p) => Object.values(p.cells).some((l) => l.some((e) => e.prop === id)));
          if (!ok) return json({ error: 'sem acesso a esta proposta' }, 403, h);
        }
        const key = new Request(`https://cache.videoteam/pdf/${id}`);
        let pdf = await caches.default.match(key);
        if (!pdf) {
          const res = await authed(env, `/mapas/ImprimirStream?model=Propostas&map=P05_PropostaTecnica&column=Propostas.Id&value=${id}`);
          if (!res.ok || !/pdf/i.test(res.headers.get('Content-Type') || '')) return pdfError(h);
          pdf = new Response(await res.arrayBuffer(), { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'max-age=600' } });
          ctx.waitUntil(caches.default.put(key, pdf.clone()));
        }
        const name = (url.searchParams.get('n') || `proposta-${id}`).replace(/[^\w.-]+/g, '_');
        return new Response(pdf.body, {
          headers: { ...h, 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${name}.pdf"`, 'Cache-Control': 'private, max-age=600' },
        });
      }

      if (url.pathname === '/api/ping') return json({ ok: true, role }, 200, h);
      if (url.pathname === '/api/fotos') {
        // lista de ids de fotos (para o thumbs.py)
        const hit = await caches.default.match(escalaKey(todayDMY()));
        const data = hit ? await hit.json() : await fetchEscala(env, todayDMY());
        return json([...new Set(data.people.map((p) => p.foto).filter(Boolean))], 200, h);
      }
      return json({ error: 'nada aqui' }, 404, h);
    } catch (e) {
      return json({ error: e.message || String(e) }, 502, h);
    }
  },
};
