# -*- coding: utf-8 -*-
"""Video Team — Chat por evento (servidor no VPS).

Uma sala por evento, com as pessoas que o dono escolheu; cada pessoa entra com o seu link pessoal (um token). Mensagens em tempo real por
WebSocket (com HTTP de reserva), avisos fixos da regie, notificacoes push (PWA) a quem nao esta com o chat aberto.
Serve tambem a propria pagina do chat (static/), instalavel como PWA, em /chat/.

O servidor NUNCA guarda telefones nem emails: so nomes, ids do 7Eventos e os links (tokens). Os contactos ficam no aparelho do dono.
A criacao/fecho das salas e feita pelo Worker do Video Team (que tem a chave do dono) com o segredo VTCHAT_SECRET (cabecalho X-Chat-Admin).

Ambiente: VTCHAT_DATA (pasta de dados), VTCHAT_SECRET (segredo do Worker), VTCHAT_HOST/VTCHAT_PORT, VTCHAT_VAPID_SUB (mailto: para o Web Push).
"""
import asyncio
import base64
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import sqlite3
import time

from aiohttp import WSMsgType, web

PREFIXO = '/chat'
AQUI = os.path.dirname(os.path.abspath(__file__))
ESTATICO = os.path.join(AQUI, 'static')

DIA = 24 * 3600
MAX_TEXTO = 2000
HISTORICO = 150               # mensagens enviadas a quem entra
MAX_MENSAGENS = 5000          # por sala
GRACA = 7 * DIA               # a sala vive ate 7 dias depois do ultimo dia do evento
TTL_PADRAO = 30 * DIA
TTL_MAX = 120 * DIA
MAX_MEMBROS = 150
RITMO_N, RITMO_S = 15, 30     # 15 mensagens por 30 s por pessoa
TOKEN_RE = re.compile(r'^[a-f0-9]{40}$')
log = logging.getLogger('vtchat')


def agora_ms():
    return int(time.time() * 1000)


def limpa(s, n):
    return re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', ' ', str(s if s is not None else '')).strip()[:n]


def novo_token():
    return secrets.token_hex(20)


def id_da_sala(key):
    return hashlib.sha256(str(key).encode('utf-8')).hexdigest()[:16]


def calc_expira(ate, agora):
    t = agora + TTL_PADRAO * 1000
    if isinstance(ate, str) and re.match(r'^\d{4}-\d{2}-\d{2}$', ate):
        try:
            import calendar
            y, m, d = (int(x) for x in ate.split('-'))
            t = calendar.timegm((y, m, d, 23, 59, 59)) * 1000 + GRACA * 1000
        except (ValueError, OverflowError):
            pass
    return max(agora + 2 * DIA * 1000, min(t, agora + TTL_MAX * 1000))


# ---------------------------------------------------------------- base de dados
class BD:
    def __init__(self, caminho):
        self.c = sqlite3.connect(caminho, isolation_level=None, check_same_thread=False)
        self.c.row_factory = sqlite3.Row
        self.c.execute('PRAGMA journal_mode=WAL')
        self.c.execute('PRAGMA foreign_keys=ON')
        self.c.executescript("""
        CREATE TABLE IF NOT EXISTS sala (id TEXT PRIMARY KEY, evento TEXT NOT NULL, criada INTEGER NOT NULL, expira INTEGER NOT NULL, dono_nome TEXT NOT NULL, dono_token TEXT NOT NULL UNIQUE);
        CREATE TABLE IF NOT EXISTS membro (sala TEXT NOT NULL REFERENCES sala(id) ON DELETE CASCADE, pid TEXT NOT NULL, nome TEXT NOT NULL, grupo TEXT NOT NULL DEFAULT '', token TEXT NOT NULL UNIQUE, PRIMARY KEY (sala, pid));
        CREATE TABLE IF NOT EXISTS msg (id INTEGER PRIMARY KEY AUTOINCREMENT, sala TEXT NOT NULL REFERENCES sala(id) ON DELETE CASCADE, pid TEXT NOT NULL, nome TEXT NOT NULL, texto TEXT NOT NULL, ts INTEGER NOT NULL,
                                  aviso INTEGER NOT NULL DEFAULT 0, fixa INTEGER NOT NULL DEFAULT 0, apagada INTEGER NOT NULL DEFAULT 0);
        CREATE INDEX IF NOT EXISTS msg_sala ON msg (sala, id);
        CREATE TABLE IF NOT EXISTS push (endpoint TEXT PRIMARY KEY, token TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, ts INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS push_token ON push (token);
        """)

    def q(self, sql, *a):
        return self.c.execute(sql, a).fetchall()

    def um(self, sql, *a):
        return self.c.execute(sql, a).fetchone()

    def x(self, sql, *a):
        return self.c.execute(sql, a)


# ---------------------------------------------------------------- Web Push (VAPID)
class Vapid:
    def __init__(self, pasta, sub):
        from py_vapid import Vapid01
        self.sub = sub
        self.pem = os.path.join(pasta, 'vapid_private.pem')
        if not os.path.exists(self.pem):
            v = Vapid01()
            v.generate_keys()
            v.save_key(self.pem)
            os.chmod(self.pem, 0o600)
        self.v = Vapid01.from_file(self.pem)
        from cryptography.hazmat.primitives import serialization
        pub = self.v.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
        self.chave_publica = base64.urlsafe_b64encode(pub).decode().rstrip('=')

    def enviar(self, sub, dados):
        from pywebpush import WebPushException, webpush
        try:
            webpush(subscription_info=sub, data=json.dumps(dados, ensure_ascii=False), vapid_private_key=self.pem, vapid_claims={'sub': self.sub}, ttl=12 * 3600)
            return 'ok'
        except WebPushException as e:
            code = getattr(getattr(e, 'response', None), 'status_code', None)
            return 'morta' if code in (404, 410) else 'erro:%s' % (code or e)
        except Exception as e:      # rede, chave invalida...
            return 'erro:%s' % e


# ---------------------------------------------------------------- a aplicacao
class Chat:
    def __init__(self, pasta, segredo, vapid_sub='https://things-on.mike-app.com/chat/'):
        os.makedirs(pasta, exist_ok=True)
        self.bd = BD(os.path.join(pasta, 'chat.db'))
        self.segredo = segredo or ''
        self.vapid = None
        try:
            self.vapid = Vapid(pasta, vapid_sub)
        except Exception as e:
            log.warning('Web Push desligado (%s)', e)
        self.ws = {}              # sala -> set de (ws, pid, nome, papel)
        self.recentes = {}        # (sala, pid) -> instantes
        self.falhas = {}          # ip -> instantes (tokens invalidos)
        self.tarefas = set()

    # ---- identificacao
    def quem(self, req):
        return self.por_token((req.headers.get('X-Chat') or req.query.get('k') or '').strip())

    def por_token(self, token):
        if not TOKEN_RE.match(token):
            return None
        agora = agora_ms()
        m = self.bd.um('SELECT m.sala, m.pid, m.nome, s.expira, s.evento FROM membro m JOIN sala s ON s.id = m.sala WHERE m.token = ?', token)
        if m and m['expira'] > agora:
            return {'sala': m['sala'], 'pid': m['pid'], 'nome': m['nome'], 'papel': 'membro', 'token': token}
        d = self.bd.um('SELECT id, dono_nome, expira FROM sala WHERE dono_token = ?', token)
        if d and d['expira'] > agora:
            return {'sala': d['id'], 'pid': 'dono', 'nome': d['dono_nome'], 'papel': 'dono', 'token': token}
        return None

    async def exige(self, req):
        q = self.quem(req)
        if not q:
            await asyncio.sleep(0.8)        # trava tentativas em serie
            raise web.HTTPUnauthorized(text=json.dumps({'error': 'link'}), content_type='application/json')
        return q

    def exige_admin(self, req):
        dado = req.headers.get('X-Chat-Admin', '')
        if not self.segredo or not hmac.compare_digest(dado.encode(), self.segredo.encode()):
            raise web.HTTPUnauthorized(text=json.dumps({'error': 'admin'}), content_type='application/json')

    # ---- mensagens
    def listar(self, sala, depois):
        if depois > 0:
            msgs = self.bd.q('SELECT id,pid,nome,texto,ts,aviso,fixa FROM msg WHERE sala=? AND apagada=0 AND id>? ORDER BY id LIMIT 500', sala, depois)
        else:
            msgs = self.bd.q('SELECT * FROM (SELECT id,pid,nome,texto,ts,aviso,fixa FROM msg WHERE sala=? AND apagada=0 ORDER BY id DESC LIMIT ?) ORDER BY id', sala, HISTORICO)
        fixas = self.bd.q('SELECT id,pid,nome,texto,ts,aviso,fixa FROM msg WHERE sala=? AND apagada=0 AND fixa=1 ORDER BY id DESC LIMIT 5', sala)
        return {'msgs': [dict(r) for r in msgs], 'fixas': [dict(r) for r in fixas]}

    def presentes(self, sala):
        return sorted({pid for (_w, pid, _n, _p) in self.ws.get(sala, set())})

    async def difundir(self, sala, obj, exceto=None):
        s = json.dumps(obj, ensure_ascii=False)
        for (w, _pid, _n, _p) in list(self.ws.get(sala, set())):
            if w is exceto or w.closed:
                continue
            try:
                await w.send_str(s)
            except Exception:
                pass

    def guardar(self, q, texto, aviso):
        texto = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', str(texto if texto is not None else '').replace('\r\n', '\n').replace('\r', '\n')).strip()[:MAX_TEXTO]
        if not texto:
            return None, 'vazia', 400
        agora = agora_ms()
        chave = (q['sala'], q['pid'])
        lista = [t for t in self.recentes.get(chave, []) if agora - t < RITMO_S * 1000]
        if len(lista) >= RITMO_N:
            return None, 'devagar', 429
        lista.append(agora)
        self.recentes[chave] = lista
        e_aviso = 1 if (aviso and q['papel'] == 'dono') else 0
        cur = self.bd.x('INSERT INTO msg (sala,pid,nome,texto,ts,aviso,fixa) VALUES (?,?,?,?,?,?,?)', q['sala'], q['pid'], q['nome'], texto, agora, e_aviso, e_aviso)
        mid = cur.lastrowid
        total = self.bd.um('SELECT COUNT(*) AS n FROM msg WHERE sala=?', q['sala'])['n']
        if total > MAX_MENSAGENS:
            self.bd.x('DELETE FROM msg WHERE id IN (SELECT id FROM msg WHERE sala=? ORDER BY id LIMIT ?)', q['sala'], total - MAX_MENSAGENS)
        return {'id': mid, 'pid': q['pid'], 'nome': q['nome'], 'texto': texto, 'ts': agora, 'aviso': e_aviso, 'fixa': e_aviso}, None, 200

    async def enviar_msg(self, q, texto, aviso):
        m, erro, status = self.guardar(q, texto, aviso)
        if erro:
            return None, erro, status
        await self.difundir(q['sala'], {'t': 'msg', 'm': m})
        t = asyncio.ensure_future(self.push_ausentes(q['sala'], m))
        self.tarefas.add(t)
        t.add_done_callback(self.tarefas.discard)
        return m, None, 200

    # ---- push: so a quem nao tem o chat aberto
    async def push_ausentes(self, sala, m):
        if not self.vapid:
            return
        s = self.bd.um('SELECT evento FROM sala WHERE id=?', sala)
        if not s:
            return
        online = set(self.presentes(sala))
        tokens = {}
        for r in self.bd.q('SELECT pid, token FROM membro WHERE sala=?', sala):
            tokens[r['pid']] = r['token']
        d = self.bd.um('SELECT dono_token FROM sala WHERE id=?', sala)
        if d:
            tokens['dono'] = d['dono_token']
        alvo = [t for pid, t in tokens.items() if pid not in online and pid != m['pid']]
        if not alvo:
            return
        texto = m['texto'].replace('\n', ' ')
        base = {'t': ('📌 ' if m['aviso'] else '') + s['evento'], 'b': '%s: %s' % (m['nome'], texto[:140] + ('…' if len(texto) > 140 else '')), 'g': sala}
        loop = asyncio.get_running_loop()
        for token in alvo:
            dados = dict(base, u=PREFIXO + '/#' + token)      # o clique abre o chat ja com o link pessoal (o iPhone nao partilha o armazenamento)
            for r in self.bd.q('SELECT endpoint, p256dh, auth FROM push WHERE token=?', token):
                res = await loop.run_in_executor(None, self.vapid.enviar, {'endpoint': r['endpoint'], 'keys': {'p256dh': r['p256dh'], 'auth': r['auth']}}, dados)
                if res == 'morta':
                    self.bd.x('DELETE FROM push WHERE endpoint=?', r['endpoint'])
                elif res != 'ok':
                    log.info('push falhou: %s', res)

    # ---- limpeza
    def limpar_expiradas(self):
        limite = agora_ms() - 24 * 3600 * 1000
        ids = [r['id'] for r in self.bd.q('SELECT id FROM sala WHERE expira < ?', limite)]
        for i in ids:
            self.bd.x('DELETE FROM push WHERE token IN (SELECT token FROM membro WHERE sala=?)', i)
            self.bd.x('DELETE FROM sala WHERE id=?', i)
        if ids:
            log.info('salas expiradas apagadas: %d', len(ids))
        return len(ids)


def vista_dono(bd, sala):
    s = bd.um('SELECT * FROM sala WHERE id=?', sala)
    if not s:
        return {'existe': False}
    return {
        'existe': True, 'sala': s['id'], 'evento': s['evento'], 'expira': s['expira'],
        'dono': {'nome': s['dono_nome'], 'token': s['dono_token']},
        'membros': [{'id': r['pid'], 'name': r['nome'], 'grupo': r['grupo'], 'token': r['token']} for r in bd.q('SELECT * FROM membro WHERE sala=? ORDER BY nome', sala)],
    }


def json_resp(obj, status=200):
    return web.json_response(obj, status=status, headers={'Cache-Control': 'no-store'}, dumps=lambda o: json.dumps(o, ensure_ascii=False))


async def ler_json(req):
    try:
        d = await req.json()
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def criar_app(pasta, segredo, vapid_sub='https://things-on.mike-app.com/chat/'):
    chat = Chat(pasta, segredo, vapid_sub)
    app = web.Application(client_max_size=64 * 1024)
    app['chat'] = chat
    r = web.RouteTableDef()
    P = PREFIXO

    # ---------------------------------------------------------- estaticos (a pagina do chat, PWA)
    NOCACHE = {'Cache-Control': 'no-cache'}

    async def pagina(req):
        return web.FileResponse(os.path.join(ESTATICO, 'chat.html'), headers=NOCACHE)

    async def sw(req):
        return web.FileResponse(os.path.join(ESTATICO, 'sw.js'), headers=dict(NOCACHE, **{'Service-Worker-Allowed': P + '/', 'Content-Type': 'text/javascript; charset=utf-8'}))

    async def manifesto(req):
        k = req.query.get('k', '')
        start, nome, idm = P + '/', 'Video Team · Chat', P + '/'
        if TOKEN_RE.match(k):
            q = chat.quem(req)
            if q:
                s = chat.bd.um('SELECT evento FROM sala WHERE id=?', q['sala'])
                start = P + '/#' + k           # o atalho do ecra principal abre ja com o link pessoal (o iPhone nao partilha o localStorage com o Safari)
                idm = P + '/?s=' + q['sala'][:8]
                nome = ('%s · Chat' % s['evento'])[:45] if s else nome
        corpo = {
            'id': idm, 'name': nome, 'short_name': 'VT Chat', 'description': 'Chat do evento', 'start_url': start, 'scope': P + '/', 'display': 'standalone',
            'background_color': '#0C1020', 'theme_color': '#0C1020', 'lang': 'pt-PT',
            'icons': [
                {'src': P + '/icons/icon-192.png', 'sizes': '192x192', 'type': 'image/png'},
                {'src': P + '/icons/icon-512.png', 'sizes': '512x512', 'type': 'image/png'},
                {'src': P + '/icons/icon-maskable-512.png', 'sizes': '512x512', 'type': 'image/png', 'purpose': 'maskable'},
            ],
        }
        return web.Response(text=json.dumps(corpo, ensure_ascii=False), content_type='application/manifest+json', headers={'Cache-Control': 'no-store'})

    async def barra(req):
        raise web.HTTPMovedPermanently(P + '/')

    app.router.add_get(P, barra)
    app.router.add_get(P + '/', pagina)
    app.router.add_get(P + '/sw', sw)       # sem extensao: a Cloudflare nao o guarda em cache (um .js seria guardado horas)
    app.router.add_get(P + '/manifest.webmanifest', manifesto)
    app.router.add_static(P + '/icons/', os.path.join(ESTATICO, 'icons'), append_version=False)

    # ---------------------------------------------------------- admin (o Worker, com o segredo)
    @r.get(P + '/api/admin/ver')
    async def admin_ver(req):
        chat.exige_admin(req)
        key = limpa(req.query.get('key'), 300)
        if not key:
            return json_resp({'error': 'evento invalido'}, 400)
        return json_resp(vista_dono(chat.bd, id_da_sala(key)))

    @r.post(P + '/api/admin/criar')
    async def admin_criar(req):
        chat.exige_admin(req)
        b = await ler_json(req)
        key = limpa(b.get('key'), 300)
        membros = b.get('membros')
        if not key:
            return json_resp({'error': 'evento invalido'}, 400)
        if not isinstance(membros, list) or not membros or len(membros) > MAX_MEMBROS:
            return json_resp({'error': 'escolhe entre 1 e %d pessoas' % MAX_MEMBROS}, 400)
        sala = id_da_sala(key)
        agora = agora_ms()
        bd = chat.bd
        novo = bd.um('SELECT 1 FROM sala WHERE id=?', sala) is None
        expira = calc_expira(b.get('ate'), agora)
        evento = limpa(b.get('label'), 120) or 'Evento'
        dono_nome = limpa(b.get('donoNome'), 40) or 'Régie'
        bd.x('BEGIN')
        try:
            if novo:
                bd.x('INSERT INTO sala (id,evento,criada,expira,dono_nome,dono_token) VALUES (?,?,?,?,?,?)', sala, evento, agora, expira, dono_nome, novo_token())
            else:
                bd.x('UPDATE sala SET evento=?, expira=MAX(expira,?), dono_nome=? WHERE id=?', evento, expira, dono_nome, sala)
            for m in membros:
                if not isinstance(m, dict):
                    continue
                pid, nome = limpa(m.get('id'), 24), limpa(m.get('name'), 80)
                if not pid or not nome or pid == 'dono':
                    continue
                atual = bd.um('SELECT token FROM membro WHERE sala=? AND pid=?', sala, pid)
                if atual:
                    bd.x('UPDATE membro SET nome=?, grupo=? WHERE sala=? AND pid=?', nome, limpa(m.get('grupo'), 60), sala, pid)   # o link ja enviado mantem-se
                else:
                    bd.x('INSERT INTO membro (sala,pid,nome,grupo,token) VALUES (?,?,?,?,?)', sala, pid, nome, limpa(m.get('grupo'), 60), novo_token())
            bd.x('COMMIT')
        except Exception:
            bd.x('ROLLBACK')
            raise
        v = vista_dono(bd, sala)
        v['novo'] = novo
        return json_resp(v)

    @r.post(P + '/api/admin/remover')
    async def admin_remover(req):
        chat.exige_admin(req)
        b = await ler_json(req)
        sala = id_da_sala(limpa(b.get('key'), 300))
        pid = limpa(b.get('id'), 24)
        m = chat.bd.um('SELECT token FROM membro WHERE sala=? AND pid=?', sala, pid)
        if not m:
            return json_resp({'error': 'nao encontrado'}, 404)
        chat.bd.x('DELETE FROM push WHERE token=?', m['token'])
        chat.bd.x('DELETE FROM membro WHERE sala=? AND pid=?', sala, pid)       # o link deixa de funcionar na hora
        for (w, p, _n, _pp) in list(chat.ws.get(sala, set())):
            if p == pid:
                await w.close(code=4001, message=b'removido')
        return json_resp(vista_dono(chat.bd, sala))

    @r.post(P + '/api/admin/fechar')
    async def admin_fechar(req):
        chat.exige_admin(req)
        b = await ler_json(req)
        sala = id_da_sala(limpa(b.get('key'), 300))
        for (w, _p, _n, _pp) in list(chat.ws.get(sala, set())):
            await w.close(code=4001, message=b'sala fechada')
        chat.bd.x('DELETE FROM push WHERE token IN (SELECT token FROM membro WHERE sala=?) OR token IN (SELECT dono_token FROM sala WHERE id=?)', sala, sala)
        chat.bd.x('DELETE FROM sala WHERE id=?', sala)                         # apaga membros e mensagens em cascata
        chat.ws.pop(sala, None)
        return json_resp({'ok': True})

    # ---------------------------------------------------------- membros: o chat
    @r.get(P + '/api/sala')
    async def sala_get(req):
        q = await chat.exige(req)
        s = chat.bd.um('SELECT * FROM sala WHERE id=?', q['sala'])
        membros = [{'pid': 'dono', 'nome': s['dono_nome']}] + [{'pid': m['pid'], 'nome': m['nome'], 'grupo': m['grupo']} for m in chat.bd.q('SELECT pid,nome,grupo FROM membro WHERE sala=? ORDER BY nome', q['sala'])]
        return json_resp({'evento': s['evento'], 'expira': s['expira'], 'eu': {'pid': q['pid'], 'nome': q['nome'], 'papel': q['papel']}, 'membros': membros,
                          'online': chat.presentes(q['sala']), 'push': bool(chat.vapid), **chat.listar(q['sala'], 0)})

    @r.get(P + '/api/msgs')
    async def msgs_get(req):
        q = await chat.exige(req)
        try:
            depois = int(req.query.get('depois', '0'))
        except ValueError:
            depois = 0
        return json_resp({**chat.listar(q['sala'], depois), 'online': chat.presentes(q['sala'])})

    @r.post(P + '/api/enviar')
    async def enviar(req):
        q = await chat.exige(req)
        b = await ler_json(req)
        m, erro, status = await chat.enviar_msg(q, b.get('texto'), bool(b.get('aviso')))
        return json_resp({'error': erro} if erro else {'m': m}, status)

    @r.post(P + '/api/apagar')
    async def apagar(req):
        q = await chat.exige(req)
        if q['papel'] != 'dono':
            return json_resp({'error': 'so a regie'}, 403)
        mid = int((await ler_json(req)).get('id') or 0)
        chat.bd.x('UPDATE msg SET apagada=1, fixa=0 WHERE id=? AND sala=?', mid, q['sala'])
        await chat.difundir(q['sala'], {'t': 'del', 'id': mid})
        return json_resp({'ok': True})

    @r.post(P + '/api/fixar')
    async def fixar(req):
        q = await chat.exige(req)
        if q['papel'] != 'dono':
            return json_resp({'error': 'so a regie'}, 403)
        b = await ler_json(req)
        mid, fx = int(b.get('id') or 0), 1 if b.get('fixa') else 0
        chat.bd.x('UPDATE msg SET fixa=? WHERE id=? AND sala=? AND apagada=0', fx, mid, q['sala'])
        await chat.difundir(q['sala'], {'t': 'fixa', 'id': mid, 'fixa': fx})
        return json_resp({'ok': True})

    # ---------------------------------------------------------- push (PWA)
    @r.get(P + '/api/push/chave')
    async def push_chave(req):
        await chat.exige(req)
        if not chat.vapid:
            return json_resp({'error': 'push desligado'}, 503)
        return json_resp({'chave': chat.vapid.chave_publica})

    @r.post(P + '/api/push/inscrever')
    async def push_inscrever(req):
        q = await chat.exige(req)
        sub = (await ler_json(req)).get('subscription') or {}
        keys = sub.get('keys') or {}
        ep = str(sub.get('endpoint') or '')
        if not ep.startswith('https://') or len(ep) > 600 or not keys.get('p256dh') or not keys.get('auth'):
            return json_resp({'error': 'subscricao invalida'}, 400)
        n = chat.bd.um('SELECT COUNT(*) AS n FROM push WHERE token=?', q['token'])['n']
        if n >= 6:
            chat.bd.x('DELETE FROM push WHERE endpoint IN (SELECT endpoint FROM push WHERE token=? ORDER BY ts LIMIT ?)', q['token'], n - 5)
        chat.bd.x('INSERT OR REPLACE INTO push (endpoint, token, p256dh, auth, ts) VALUES (?,?,?,?,?)', ep, q['token'], str(keys['p256dh'])[:200], str(keys['auth'])[:100], agora_ms())
        return json_resp({'ok': True})

    @r.post(P + '/api/push/cancelar')
    async def push_cancelar(req):
        q = await chat.exige(req)
        ep = str((await ler_json(req)).get('endpoint') or '')
        chat.bd.x('DELETE FROM push WHERE endpoint=? AND token=?', ep, q['token'])
        return json_resp({'ok': True})

    # ---------------------------------------------------------- tempo real
    @r.get(P + '/api/ws')
    async def ws_handler(req):
        q = await chat.exige(req)
        ws = web.WebSocketResponse(heartbeat=25, max_msg_size=MAX_TEXTO * 4)
        await ws.prepare(req)
        sala = q['sala']
        ent = (ws, q['pid'], q['nome'], q['papel'])
        chat.ws.setdefault(sala, set()).add(ent)
        await ws.send_str(json.dumps({'t': 'ola', **chat.listar(sala, 0), 'online': chat.presentes(sala)}, ensure_ascii=False))
        await chat.difundir(sala, {'t': 'online', 'online': chat.presentes(sala)}, exceto=ws)
        try:
            async for msg in ws:
                if msg.type != WSMsgType.TEXT:
                    continue
                try:
                    d = json.loads(msg.data)
                except ValueError:
                    continue
                if not isinstance(d, dict):
                    continue
                if d.get('t') == 'ping':
                    await ws.send_str('{"t":"pong"}')
                elif d.get('t') == 'msg':
                    # o token pode ter sido retirado entretanto
                    if not chat.por_token(q['token']):
                        await ws.close(code=4001, message=b'removido')
                        break
                    m, erro, _st = await chat.enviar_msg(q, d.get('texto'), bool(d.get('aviso')))
                    if erro:
                        await ws.send_str(json.dumps({'t': 'erro', 'erro': erro, 'cid': d.get('cid')}))
                    else:
                        await ws.send_str(json.dumps({'t': 'ok', 'cid': d.get('cid'), 'id': m['id']}))
        finally:
            chat.ws.get(sala, set()).discard(ent)
            await chat.difundir(sala, {'t': 'online', 'online': chat.presentes(sala)})
        return ws

    app.add_routes(r)

    async def limpeza(app_):
        async def laco():
            while True:
                try:
                    chat.limpar_expiradas()
                except Exception:
                    log.exception('limpeza')
                await asyncio.sleep(1800)
        t = asyncio.ensure_future(laco())
        yield
        t.cancel()

    app.cleanup_ctx.append(limpeza)
    return app


def main():
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    pasta = os.environ.get('VTCHAT_DATA', '/var/lib/vt-chat')
    segredo = os.environ.get('VTCHAT_SECRET', '')
    if not segredo:
        log.warning('VTCHAT_SECRET vazio: o Worker nao consegue criar salas')
    app = criar_app(pasta, segredo, os.environ.get('VTCHAT_VAPID_SUB', 'https://things-on.mike-app.com/chat/'))
    web.run_app(app, host=os.environ.get('VTCHAT_HOST', '127.0.0.1'), port=int(os.environ.get('VTCHAT_PORT', '8782')), access_log=None, print=None)


if __name__ == '__main__':
    main()
