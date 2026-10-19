# -*- coding: utf-8 -*-
"""Video Team — Chat por evento (servidor no VPS).

Uma sala por evento, com as pessoas que o dono escolheu; cada pessoa entra com o seu link pessoal (um token). Mensagens em tempo real por
WebSocket (com HTTP de reserva), avisos fixos da regie, notificacoes push (PWA) a quem nao esta com o chat aberto.
Serve tambem a propria pagina do chat (static/), instalavel como PWA, em /chat/.

O servidor NUNCA guarda telefones nem emails: so nomes, ids do 7Eventos e os links (tokens). Os contactos ficam no aparelho do dono.
A criacao/fecho das salas e feita pelo Worker do Video Team (que tem a chave do dono) com o segredo VTCHAT_SECRET (cabecalho X-Chat-Admin).

Ambiente: VTCHAT_DATA (pasta de dados), VTCHAT_SECRET (segredo do Worker), VTCHAT_HOST/VTCHAT_PORT, VTCHAT_VAPID_SUB (mailto: tecnico para o Web Push).
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
MINIMO = 2 * 3600             # nunca expira em menos de 2 horas (evento a acabar hoje, data enganada...)
TTL_PADRAO = 30 * DIA
TTL_MAX = 120 * DIA
MAX_MEMBROS = 150
RITMO_N, RITMO_S = 15, 30     # 15 mensagens por 30 s por pessoa
TOKEN_RE = re.compile(r'^[a-f0-9]{40}$')
FOTO_RE = re.compile(r'^[a-f0-9]{16}$')
FOTO_MAX = 1_500_000                     # a foto, ja reduzida pelo telemovel (1600 px, JPEG): perto de 0,3 MB
MINI_MAX = 150_000                       # a miniatura (360 px): perto de 30 KB
FOTOS_HORA = 20                          # fotos por pessoa por hora
SALA_FOTOS_MAX = 400 * 1024 * 1024       # tecto de fotos por sala
TIPOS = ('participante', 'leitura', 'gestor')   # participante le e escreve; leitura so le; gestor tambem trata dos participantes de fora e das mensagens
log = logging.getLogger('vtchat')
# o Web Push (py_vapid, modo estrito) so aceita «mailto:». E um contacto tecnico para os servicos de push (Google, Apple, Mozilla), nao o teu email pessoal.
VAPID_SUB_PADRAO = 'mailto:admin@mike-app.com'


def agora_ms():
    return int(time.time() * 1000)


def limpa(s, n):
    return re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', ' ', str(s if s is not None else '')).strip()[:n]


def novo_token():
    return secrets.token_hex(20)


def id_da_sala(key):
    return hashlib.sha256(str(key).encode('utf-8')).hexdigest()[:16]


def calc_expira(ate, agora):
    """O chat dura o tempo do evento: ate ao fim do ULTIMO dia (23:59 hora de Lisboa). Depois apaga-se tudo sozinho."""
    t = agora + TTL_PADRAO * 1000                      # sem data: 30 dias
    if isinstance(ate, str) and re.match(r'^\d{4}-\d{2}-\d{2}$', ate):
        try:
            y, m, d = (int(x) for x in ate.split('-'))
            try:
                from datetime import datetime
                from zoneinfo import ZoneInfo
                t = int(datetime(y, m, d, 23, 59, 59, tzinfo=ZoneInfo('Europe/Lisbon')).timestamp() * 1000)
            except Exception:                           # sem base de fusos horarios: UTC (diferenca de 1 hora no verao)
                import calendar
                t = calendar.timegm((y, m, d, 23, 59, 59)) * 1000
        except (ValueError, OverflowError):
            pass
    return max(agora + MINIMO * 1000, min(t, agora + TTL_MAX * 1000))


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
        CREATE TABLE IF NOT EXISTS uso (dia TEXT PRIMARY KEY, pedidos INTEGER NOT NULL DEFAULT 0, msgs INTEGER NOT NULL DEFAULT 0, bytes_saida INTEGER NOT NULL DEFAULT 0, ws_pico INTEGER NOT NULL DEFAULT 0, erros INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS eventos (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, tipo TEXT NOT NULL, sala TEXT NOT NULL, evento TEXT NOT NULL, dados TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS convite (sala TEXT PRIMARY KEY REFERENCES sala(id) ON DELETE CASCADE, token TEXT NOT NULL UNIQUE, ativo INTEGER NOT NULL DEFAULT 1, criado INTEGER NOT NULL);
        """)
        cols = [c['name'] for c in self.c.execute('PRAGMA table_info(membro)').fetchall()]
        if 'tipo' not in cols:
            self.c.execute("ALTER TABLE membro ADD COLUMN tipo TEXT NOT NULL DEFAULT 'participante'")
        if 'externo' not in cols:
            self.c.execute('ALTER TABLE membro ADD COLUMN externo INTEGER NOT NULL DEFAULT 0')   # 1 = nao vem da escala (acrescentado a mao)
        if 'enviado' not in cols:
            self.c.execute("ALTER TABLE membro ADD COLUMN enviado TEXT NOT NULL DEFAULT ''")      # canais por onde o dono ja enviou o link (wa,sms,mail): so a marca, nunca o contacto
        mc = [c['name'] for c in self.c.execute('PRAGMA table_info(msg)').fetchall()]
        for col, tipo in (('foto', 'TEXT'), ('foto_bytes', 'INTEGER NOT NULL DEFAULT 0'), ('foto_w', 'INTEGER NOT NULL DEFAULT 0'), ('foto_h', 'INTEGER NOT NULL DEFAULT 0')):
            if col not in mc:
                self.c.execute('ALTER TABLE msg ADD COLUMN %s %s' % (col, tipo))
        sc = [c['name'] for c in self.c.execute('PRAGMA table_info(sala)').fetchall()]
        if 'pico_ws' not in sc:
            self.c.execute('ALTER TABLE sala ADD COLUMN pico_ws INTEGER NOT NULL DEFAULT 0')
        if 'pushes' not in sc:
            self.c.execute('ALTER TABLE sala ADD COLUMN pushes INTEGER NOT NULL DEFAULT 0')
        if 'reclamado' not in cols:
            self.c.execute('ALTER TABLE membro ADD COLUMN reclamado INTEGER NOT NULL DEFAULT 0')   # o lugar ja foi tomado (pelo link pessoal ou pelo geral)
            # quem ja escreveu no chat (versao anterior, sem link geral) ja tem o lugar
            self.c.execute('UPDATE membro SET reclamado=1 WHERE EXISTS (SELECT 1 FROM msg WHERE msg.sala=membro.sala AND msg.pid=membro.pid)')

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
    def __init__(self, pasta, segredo, vapid_sub=VAPID_SUB_PADRAO):
        os.makedirs(pasta, exist_ok=True)
        self.pasta = pasta
        self.fotos_recentes = {}   # (sala, pid) -> instantes dos ultimos envios de fotos
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
        self.inicio = time.time()
        self.uso = {}             # dia -> {pedidos, msgs, bytes, ws_pico, erros} ainda por gravar (a vigia le isto + a tabela `uso`)
        self.tarefas = set()

    # ---- identificacao
    def quem(self, req):
        return self.por_token((req.headers.get('X-Chat') or req.query.get('k') or '').strip())

    def por_token(self, token):
        if not TOKEN_RE.match(token):
            return None
        agora = agora_ms()
        m = self.bd.um('SELECT m.sala, m.pid, m.nome, m.tipo, m.externo, s.expira, s.evento FROM membro m JOIN sala s ON s.id = m.sala WHERE m.token = ?', token)
        if m and m['expira'] > agora:
            return {'sala': m['sala'], 'pid': m['pid'], 'nome': m['nome'], 'papel': 'membro', 'tipo': m['tipo'], 'externo': bool(m['externo']), 'token': token}
        d = self.bd.um('SELECT id, dono_nome, expira FROM sala WHERE dono_token = ?', token)
        if d and d['expira'] > agora:
            return {'sala': d['id'], 'pid': 'dono', 'nome': d['dono_nome'], 'papel': 'dono', 'tipo': 'dono', 'externo': False, 'token': token}
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

    def contar(self, **kw):
        d = time.strftime('%Y-%m-%d')
        u = self.uso.setdefault(d, {'pedidos': 0, 'msgs': 0, 'bytes': 0, 'ws_pico': 0, 'erros': 0})
        for k, v in kw.items():
            if k == 'ws_pico':
                u['ws_pico'] = max(u['ws_pico'], v)
            else:
                u[k] = u.get(k, 0) + v

    def foto_sala(self, sala, pasta):
        """O peso de uma sala neste momento (para o relatorio de quando e criada e de quando e apagada)."""
        bd = self.bd
        s_ = bd.um('SELECT * FROM sala WHERE id=?', sala)
        if not s_:
            return None
        n = lambda sql, *a: bd.um(sql, *a)['n']
        msgs = n('SELECT COUNT(*) AS n FROM msg WHERE sala=?', sala)
        texto = n('SELECT COALESCE(SUM(LENGTH(texto)),0) AS n FROM msg WHERE sala=?', sala)
        membros = n('SELECT COUNT(*) AS n FROM membro WHERE sala=?', sala)
        db = 0
        for nome in ('chat.db', 'chat.db-wal'):
            try:
                db += os.path.getsize(os.path.join(pasta, nome))
            except OSError:
                pass
        rss = 0
        try:
            with open('/proc/self/status') as f:
                for ln in f:
                    if ln.startswith('VmRSS:'):
                        rss = int(ln.split()[1]) * 1024
        except OSError:
            pass
        try:
            import shutil
            livre = shutil.disk_usage(pasta).free
        except OSError:
            livre = 0
        return {
            'criada': s_['criada'], 'expira': s_['expira'], 'membros': membros,
            'externos': n('SELECT COUNT(*) AS n FROM membro WHERE sala=? AND externo=1', sala), 'gestores': n("SELECT COUNT(*) AS n FROM membro WHERE sala=? AND tipo='gestor'", sala),
            'entraram': n('SELECT COUNT(*) AS n FROM membro WHERE sala=? AND reclamado=1', sala),
            'mensagens': msgs, 'texto_bytes': texto, 'pico_ws': s_['pico_ws'], 'pushes': s_['pushes'],
            'fotos': n('SELECT COUNT(*) AS n FROM msg WHERE sala=? AND foto IS NOT NULL AND apagada=0', sala), 'fotos_bytes': n('SELECT COALESCE(SUM(foto_bytes),0) AS n FROM msg WHERE sala=? AND foto IS NOT NULL AND apagada=0', sala),
            'push_subscricoes': n('SELECT COUNT(*) AS n FROM push WHERE token IN (SELECT token FROM membro WHERE sala=?) OR token=(SELECT dono_token FROM sala WHERE id=?)', sala, sala),
            'espaco_estimado_bytes': texto + msgs * 160 + membros * 220 + n('SELECT COALESCE(SUM(foto_bytes),0) AS n FROM msg WHERE sala=? AND foto IS NOT NULL', sala),       # o que a sala ocupa na base de dados (texto + linhas)
            'db_bytes': db, 'rss_bytes': rss, 'disco_livre': livre,
            'salas_ativas': n('SELECT COUNT(*) AS n FROM sala'), 'ws_ativos': sum(len(v) for v in self.ws.values()),
        }

    def evento(self, tipo, sala, nome, pasta, foto=None):
        """Regista «criada», «fechada» (pelo dono) ou «expirada» (apagada sozinha), com a foto do peso. Guarda os ultimos 500."""
        foto = foto or self.foto_sala(sala, pasta) or {}
        self.bd.x('INSERT INTO eventos (ts,tipo,sala,evento,dados) VALUES (?,?,?,?,?)', agora_ms(), tipo, sala, nome, json.dumps(foto, ensure_ascii=False))
        self.bd.x('DELETE FROM eventos WHERE id <= (SELECT MAX(id) FROM eventos) - 500')

    def gravar_uso(self):
        for d, u in list(self.uso.items()):
            self.bd.x('INSERT INTO uso (dia,pedidos,msgs,bytes_saida,ws_pico,erros) VALUES (?,?,?,?,?,?) ON CONFLICT(dia) DO UPDATE SET pedidos=pedidos+excluded.pedidos, msgs=msgs+excluded.msgs, '
                      'bytes_saida=bytes_saida+excluded.bytes_saida, ws_pico=MAX(ws_pico,excluded.ws_pico), erros=erros+excluded.erros', d, u['pedidos'], u['msgs'], u['bytes'], u['ws_pico'], u['erros'])
            u.update(pedidos=0, msgs=0, bytes=0, erros=0)           # o pico de hoje fica (e e gravado com MAX)
        self.bd.x("DELETE FROM uso WHERE dia < date('now', '-90 day')")

    def metricas(self, pasta):
        self.gravar_uso()
        bd = self.bd
        n = lambda sql, *a: bd.um(sql, *a)['n']
        rss = 0
        try:
            with open('/proc/self/status') as f:
                for ln in f:
                    if ln.startswith('VmRSS:'):
                        rss = int(ln.split()[1]) * 1024
        except OSError:
            pass
        tam = lambda nome: os.path.getsize(os.path.join(pasta, nome)) if os.path.exists(os.path.join(pasta, nome)) else 0
        maior = bd.um('SELECT s.evento AS evento, (SELECT COUNT(*) FROM membro WHERE sala=s.id) AS membros, (SELECT COUNT(*) FROM msg WHERE sala=s.id) AS msgs FROM sala s ORDER BY msgs DESC LIMIT 1')
        return {
            'agora': agora_ms(), 'uptime_s': int(time.time() - self.inicio), 'rss_bytes': rss,
            'db_bytes': tam('chat.db'), 'wal_bytes': tam('chat.db-wal'),
            'salas': n('SELECT COUNT(*) AS n FROM sala'), 'membros': n('SELECT COUNT(*) AS n FROM membro'), 'externos': n('SELECT COUNT(*) AS n FROM membro WHERE externo=1'),
            'mensagens': n('SELECT COUNT(*) AS n FROM msg'), 'texto_bytes': n('SELECT COALESCE(SUM(LENGTH(texto)),0) AS n FROM msg'),
            'fotos': n('SELECT COUNT(*) AS n FROM msg WHERE foto IS NOT NULL AND apagada=0'), 'fotos_bytes': n('SELECT COALESCE(SUM(foto_bytes),0) AS n FROM msg WHERE foto IS NOT NULL AND apagada=0'),
            'push_subscricoes': n('SELECT COUNT(*) AS n FROM push'), 'ws_ativos': sum(len(v) for v in self.ws.values()),
            'maior_sala': dict(maior) if maior else None,
            'salas_lista': [dict(x) for x in bd.q('SELECT s.evento AS evento, s.expira AS expira, (SELECT COUNT(*) FROM membro WHERE sala=s.id) AS membros, (SELECT COUNT(*) FROM msg WHERE sala=s.id) AS msgs, (SELECT COUNT(*) FROM msg WHERE sala=s.id AND foto IS NOT NULL AND apagada=0) AS fotos, (SELECT COALESCE(SUM(foto_bytes),0) FROM msg WHERE sala=s.id AND foto IS NOT NULL AND apagada=0) AS fotos_bytes FROM sala s ORDER BY s.expira')],
            'dias': [dict(x) for x in bd.q('SELECT dia, pedidos, msgs, bytes_saida, ws_pico, erros FROM uso ORDER BY dia DESC LIMIT 30')],
        }

    def pasta_fotos(self, sala):
        return os.path.join(self.pasta, 'fotos', sala)

    def apagar_ficheiros_foto(self, sala, fid):
        for suf in ('.jpg', '_t.jpg'):
            try:
                os.remove(os.path.join(self.pasta_fotos(sala), fid + suf))
            except OSError:
                pass

    def apagar_fotos_da_sala(self, sala):
        import shutil
        shutil.rmtree(self.pasta_fotos(sala), ignore_errors=True)

    @staticmethod
    def gere(q):
        return q['papel'] == 'dono' or q.get('tipo') == 'gestor'

    # ---- mensagens
    def listar(self, sala, depois):
        if depois > 0:
            msgs = self.bd.q('SELECT id,pid,nome,texto,ts,aviso,fixa,foto,foto_w,foto_h FROM msg WHERE sala=? AND apagada=0 AND id>? ORDER BY id LIMIT 500', sala, depois)
        else:
            msgs = self.bd.q('SELECT * FROM (SELECT id,pid,nome,texto,ts,aviso,fixa,foto,foto_w,foto_h FROM msg WHERE sala=? AND apagada=0 ORDER BY id DESC LIMIT ?) ORDER BY id', sala, HISTORICO)
        fixas = self.bd.q('SELECT id,pid,nome,texto,ts,aviso,fixa,foto,foto_w,foto_h FROM msg WHERE sala=? AND apagada=0 AND fixa=1 ORDER BY id DESC LIMIT 5', sala)
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
                self.contar(bytes=len(s))
            except Exception:
                pass

    def guardar(self, q, texto, aviso):
        texto = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', str(texto if texto is not None else '').replace('\r\n', '\n').replace('\r', '\n')).strip()[:MAX_TEXTO]
        if not texto:
            return None, 'vazia', 400
        if q.get('tipo') == 'leitura':
            return None, 'leitura', 403                       # «so leitura»: le tudo, nao escreve
        agora = agora_ms()
        chave = (q['sala'], q['pid'])
        lista = [t for t in self.recentes.get(chave, []) if agora - t < RITMO_S * 1000]
        if len(lista) >= RITMO_N:
            return None, 'devagar', 429
        lista.append(agora)
        self.recentes[chave] = lista
        e_aviso = 1 if (aviso and self.gere(q)) else 0
        cur = self.bd.x('INSERT INTO msg (sala,pid,nome,texto,ts,aviso,fixa) VALUES (?,?,?,?,?,?,?)', q['sala'], q['pid'], q['nome'], texto, agora, e_aviso, e_aviso)
        mid = cur.lastrowid
        self.contar(msgs=1)
        total = self.bd.um('SELECT COUNT(*) AS n FROM msg WHERE sala=?', q['sala'])['n']
        if total > MAX_MENSAGENS:
            for velho in self.bd.q('SELECT foto FROM msg WHERE id IN (SELECT id FROM msg WHERE sala=? ORDER BY id LIMIT ?) AND foto IS NOT NULL', q['sala'], total - MAX_MENSAGENS):
                self.apagar_ficheiros_foto(q['sala'], velho['foto'])
            self.bd.x('DELETE FROM msg WHERE id IN (SELECT id FROM msg WHERE sala=? ORDER BY id LIMIT ?)', q['sala'], total - MAX_MENSAGENS)
        return {'id': mid, 'pid': q['pid'], 'nome': q['nome'], 'texto': texto, 'ts': agora, 'aviso': e_aviso, 'fixa': e_aviso, 'foto': None}, None, 200

    def guardar_foto(self, q, legenda, principal, mini, w, h):
        """Guarda uma foto (ja reduzida pelo telemovel) e a mensagem dela. Devolve (mensagem, erro, estado)."""
        if q.get('tipo') == 'leitura':
            return None, 'leitura', 403
        agora = agora_ms()
        chave = (q['sala'], q['pid'])
        lista = [t for t in self.fotos_recentes.get(chave, []) if agora - t < 3600 * 1000]
        if len(lista) >= FOTOS_HORA:
            return None, 'muitas fotos', 429
        usado = self.bd.um('SELECT COALESCE(SUM(foto_bytes),0) AS n FROM msg WHERE sala=? AND foto IS NOT NULL', q['sala'])['n']
        if usado + len(principal) + len(mini) > SALA_FOTOS_MAX:
            return None, 'sala cheia', 413
        lista.append(agora)
        self.fotos_recentes[chave] = lista
        fid = secrets.token_hex(8)
        pasta = self.pasta_fotos(q['sala'])
        os.makedirs(pasta, exist_ok=True)
        with open(os.path.join(pasta, fid + '.jpg'), 'wb') as f:
            f.write(principal)
        with open(os.path.join(pasta, fid + '_t.jpg'), 'wb') as f:
            f.write(mini)
        legenda = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', str(legenda or '').replace('\r\n', '\n')).strip()[:500]
        w, h = max(0, min(int(w or 0), 6000)), max(0, min(int(h or 0), 6000))
        cur = self.bd.x('INSERT INTO msg (sala,pid,nome,texto,ts,aviso,fixa,foto,foto_bytes,foto_w,foto_h) VALUES (?,?,?,?,?,0,0,?,?,?,?)', q['sala'], q['pid'], q['nome'], legenda, agora, fid, len(principal) + len(mini), w, h)
        self.contar(msgs=1)
        return {'id': cur.lastrowid, 'pid': q['pid'], 'nome': q['nome'], 'texto': legenda, 'ts': agora, 'aviso': 0, 'fixa': 0, 'foto': fid, 'foto_w': w, 'foto_h': h}, None, 200

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
        texto = ('📷 ' + (m['texto'] or 'Foto')) if m.get('foto') else m['texto'].replace('\n', ' ')
        base = {'t': ('📌 ' if m['aviso'] else '') + s['evento'], 'b': '%s: %s' % (m['nome'], texto[:140] + ('…' if len(texto) > 140 else '')), 'g': sala}
        loop = asyncio.get_running_loop()
        for token in alvo:
            dados = dict(base, u=PREFIXO + '/#' + token)      # o clique abre o chat ja com o link pessoal (o iPhone nao partilha o armazenamento)
            for r in self.bd.q('SELECT endpoint, p256dh, auth FROM push WHERE token=?', token):
                res = await loop.run_in_executor(None, self.vapid.enviar, {'endpoint': r['endpoint'], 'keys': {'p256dh': r['p256dh'], 'auth': r['auth']}}, dados)
                if res == 'ok':
                    self.bd.x('UPDATE sala SET pushes=pushes+1 WHERE id=?', sala)
                if res == 'morta':
                    self.bd.x('DELETE FROM push WHERE endpoint=?', r['endpoint'])
                elif res != 'ok':
                    log.info('push falhou: %s', res)

    # ---- limpeza
    async def fechar_ws_expiradas(self):
        """No fim do evento corta as ligacoes em direto das salas que ja expiraram: os ecras abertos passam logo a «link ja nao e valido»."""
        for r_ in self.bd.q('SELECT id FROM sala WHERE expira < ?', agora_ms()):
            for (w, _p, _n, _pp) in list(self.ws.get(r_['id'], set())):
                try:
                    await w.close(code=4001, message=b'fim do evento')
                except Exception:
                    pass

    def limpar_expiradas(self, pasta=None):
        ids = [r['id'] for r in self.bd.q('SELECT id FROM sala WHERE expira < ?', agora_ms())]     # acabou o evento: apaga-se tudo
        for i in ids:
            nome_ = self.bd.um('SELECT evento FROM sala WHERE id=?', i)
            if nome_ and pasta:
                self.evento('expirada', i, nome_['evento'], pasta)
            self.bd.x('DELETE FROM push WHERE token IN (SELECT token FROM membro WHERE sala=?)', i)
            self.bd.x('DELETE FROM sala WHERE id=?', i)
            self.apagar_fotos_da_sala(i)
        if ids:
            log.info('salas expiradas apagadas: %d', len(ids))
        return len(ids)


def vista_dono(bd, sala):
    s = bd.um('SELECT * FROM sala WHERE id=?', sala)
    if not s:
        return {'existe': False}
    cv = bd.um('SELECT token, ativo FROM convite WHERE sala=?', sala)
    return {
        'existe': True, 'sala': s['id'], 'evento': s['evento'], 'expira': s['expira'],
        'dono': {'nome': s['dono_nome'], 'token': s['dono_token']},
        'membros': [{'id': r['pid'], 'name': r['nome'], 'grupo': r['grupo'], 'token': r['token'], 'entrou': bool(r['reclamado']), 'tipo': r['tipo'], 'externo': bool(r['externo']), 'enviado': [x for x in (r['enviado'] or '').split(',') if x]} for r in bd.q('SELECT * FROM membro WHERE sala=? ORDER BY externo, nome', sala)],
        'convite': ({'token': cv['token'], 'ativo': bool(cv['ativo'])} if cv else None),
    }


def json_resp(obj, status=200):
    return web.json_response(obj, status=status, headers={'Cache-Control': 'no-store'}, dumps=lambda o: json.dumps(o, ensure_ascii=False))


async def ler_json(req):
    try:
        d = await req.json()
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def criar_app(pasta, segredo, vapid_sub=VAPID_SUB_PADRAO):
    chat = Chat(pasta, segredo, vapid_sub)
    @web.middleware
    async def contar_pedidos(req, handler):
        try:
            resp = await handler(req)
        except web.HTTPException as e:
            chat.contar(pedidos=1, erros=1 if e.status >= 500 else 0)
            raise
        except Exception:
            chat.contar(pedidos=1, erros=1)
            raise
        corpo = getattr(resp, 'body', None)
        chat.contar(pedidos=1, bytes=len(corpo) if isinstance(corpo, (bytes, bytearray)) else 0)
        return resp

    app = web.Application(client_max_size=64 * 1024, middlewares=[contar_pedidos])
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
        start, nome, idm = P + '/', 'Video Team · Chat', P + '/app'      # identificador proprio (nao colide com o do Video Team nem com instalacoes antigas)
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
                {'src': P + '/icons/chat-192.png', 'sizes': '192x192', 'type': 'image/png'},
                {'src': P + '/icons/chat-512.png', 'sizes': '512x512', 'type': 'image/png'},
                {'src': P + '/icons/chat-maskable-512.png', 'sizes': '512x512', 'type': 'image/png', 'purpose': 'maskable'},
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
        v = vista_dono(chat.bd, id_da_sala(key))
        if v.get('existe'):
            v['online'] = chat.presentes(v['sala'])          # quem esta ligado agora (referencia real para o painel do dono)
        return json_resp(v)

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
        if novo:
            chat.evento('criada', sala, evento, pasta)
        return json_resp(v)

    @r.post(P + '/api/admin/adicionar')
    async def admin_adicionar(req):
        chat.exige_admin(req)
        b = await ler_json(req)
        sala = id_da_sala(limpa(b.get('key'), 300))
        if not chat.bd.um('SELECT 1 FROM sala WHERE id=?', sala):
            return json_resp({'error': 'nao encontrado'}, 404)
        nome = re.sub(r'\s+', ' ', limpa(b.get('nome'), 80))
        tipo = limpa(b.get('tipo'), 20) or 'participante'
        if len(nome) < 2 or tipo not in TIPOS:
            return json_resp({'error': 'nome ou tipo invalido'}, 400)
        m = criar_externo(sala, nome, tipo)
        if not m:
            return json_resp({'error': 'sala cheia'}, 409)
        await chat.difundir(sala, {'t': 'membros'})
        return json_resp(vista_dono(chat.bd, sala))

    @r.post(P + '/api/admin/tipo')
    async def admin_tipo(req):
        chat.exige_admin(req)
        b = await ler_json(req)
        sala = id_da_sala(limpa(b.get('key'), 300))
        tipo = limpa(b.get('tipo'), 20)
        if tipo not in TIPOS:
            return json_resp({'error': 'tipo invalido'}, 400)
        cur = chat.bd.x('UPDATE membro SET tipo=? WHERE sala=? AND pid=?', tipo, sala, limpa(b.get('id'), 24))
        if cur.rowcount != 1:
            return json_resp({'error': 'nao encontrado'}, 404)
        await chat.difundir(sala, {'t': 'membros'})
        return json_resp(vista_dono(chat.bd, sala))

    @r.post(P + '/api/admin/enviado')
    async def admin_enviado(req):
        chat.exige_admin(req)
        b = await ler_json(req)
        sala = id_da_sala(limpa(b.get('key'), 300))
        canal = limpa(b.get('canal'), 10)
        if canal not in ('wa', 'sms', 'mail'):
            return json_resp({'error': 'canal invalido'}, 400)
        ids = b.get('ids')
        pids = [limpa(x, 24) for x in ids[:200]] if isinstance(ids, list) else [limpa(b.get('id'), 24)]      # uma pessoa ou varias de uma vez
        achou = False
        for pid in pids:
            m = chat.bd.um('SELECT enviado FROM membro WHERE sala=? AND pid=?', sala, pid)
            if not m:
                continue
            achou = True
            canais = set(x for x in (m['enviado'] or '').split(',') if x)
            if b.get('valor', True):
                canais.add(canal)
            else:
                canais.discard(canal)
            chat.bd.x('UPDATE membro SET enviado=? WHERE sala=? AND pid=?', ','.join(sorted(canais)), sala, pid)
        if not achou:
            return json_resp({'error': 'nao encontrado'}, 404)
        v = vista_dono(chat.bd, sala)
        v['online'] = chat.presentes(sala)
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
        await chat.difundir(sala, {'t': 'membros'})
        return json_resp(vista_dono(chat.bd, sala))

    @r.post(P + '/api/admin/convite')
    async def admin_convite(req):
        chat.exige_admin(req)
        b = await ler_json(req)
        sala = id_da_sala(limpa(b.get('key'), 300))
        if not chat.bd.um('SELECT 1 FROM sala WHERE id=?', sala):
            return json_resp({'error': 'nao encontrado'}, 404)
        ativo = 0 if b.get('ativo') is False else 1
        atual = chat.bd.um('SELECT token FROM convite WHERE sala=?', sala)
        if b.get('renovar') or not atual:
            chat.bd.x('INSERT OR REPLACE INTO convite (sala, token, ativo, criado) VALUES (?,?,?,?)', sala, novo_token(), ativo, agora_ms())   # token novo: o link antigo deixa de servir
        else:
            chat.bd.x('UPDATE convite SET ativo=? WHERE sala=?', ativo, sala)
        return json_resp(vista_dono(chat.bd, sala))

    @r.get(P + '/api/admin/eventos')
    async def admin_eventos(req):
        chat.exige_admin(req)
        try:
            depois = int(req.query.get('depois', '0'))
        except ValueError:
            depois = 0
        rows = chat.bd.q('SELECT id, ts, tipo, sala, evento, dados FROM eventos WHERE id > ? ORDER BY id LIMIT 200', depois)
        return json_resp({'eventos': [{'id': x['id'], 'ts': x['ts'], 'tipo': x['tipo'], 'evento': x['evento'], 'dados': json.loads(x['dados'] or '{}')} for x in rows],
                          'ultimo': (chat.bd.um('SELECT COALESCE(MAX(id),0) AS n FROM eventos')['n'])})

    @r.get(P + '/api/admin/metricas')
    async def admin_metricas(req):
        chat.exige_admin(req)
        return json_resp(chat.metricas(pasta))

    @r.post(P + '/api/admin/prolongar')
    async def admin_prolongar(req):
        chat.exige_admin(req)
        b = await ler_json(req)
        sala = id_da_sala(limpa(b.get('key'), 300))
        s_ = chat.bd.um('SELECT expira FROM sala WHERE id=?', sala)
        if not s_:
            return json_resp({'error': 'nao encontrado'}, 404)
        try:
            dias = max(1, min(30, int(b.get('dias') or 1)))
        except (TypeError, ValueError):
            dias = 1
        agora = agora_ms()
        nova = min(max(s_['expira'], agora) + dias * DIA * 1000, agora + TTL_MAX * 1000)
        chat.bd.x('UPDATE sala SET expira=? WHERE id=?', nova, sala)
        return json_resp(vista_dono(chat.bd, sala))

    @r.post(P + '/api/admin/libertar')
    async def admin_libertar(req):
        chat.exige_admin(req)
        b = await ler_json(req)
        sala = id_da_sala(limpa(b.get('key'), 300))
        pid = limpa(b.get('id'), 24)
        if not chat.bd.um('SELECT 1 FROM membro WHERE sala=? AND pid=?', sala, pid):
            return json_resp({'error': 'nao encontrado'}, 404)
        old = chat.bd.um('SELECT token FROM membro WHERE sala=? AND pid=?', sala, pid)['token']
        chat.bd.x('DELETE FROM push WHERE token=?', old)
        chat.bd.x('UPDATE membro SET reclamado=0, token=? WHERE sala=? AND pid=?', novo_token(), sala, pid)   # o aparelho de antes perde o acesso
        for (w, p_, _n, _pp) in list(chat.ws.get(sala, set())):
            if p_ == pid:
                await w.close(code=4001, message=b'lugar libertado')
        return json_resp(vista_dono(chat.bd, sala))

    @r.post(P + '/api/admin/fechar')
    async def admin_fechar(req):
        chat.exige_admin(req)
        b = await ler_json(req)
        sala = id_da_sala(limpa(b.get('key'), 300))
        sx = chat.bd.um('SELECT evento FROM sala WHERE id=?', sala)
        if sx:
            chat.evento('fechada', sala, sx['evento'], pasta)           # a foto do peso e tirada ANTES de apagar
        for (w, _p, _n, _pp) in list(chat.ws.get(sala, set())):
            await w.close(code=4001, message=b'sala fechada')
        chat.bd.x('DELETE FROM push WHERE token IN (SELECT token FROM membro WHERE sala=?) OR token IN (SELECT dono_token FROM sala WHERE id=?)', sala, sala)
        chat.bd.x('DELETE FROM sala WHERE id=?', sala)                         # apaga membros e mensagens em cascata
        chat.apagar_fotos_da_sala(sala)
        chat.ws.pop(sala, None)
        return json_resp({'ok': True})

    # ---------------------------------------------------------- link geral: cada pessoa escolhe o seu nome
    def convite_de(req, token):
        if not TOKEN_RE.match(str(token or '')):
            return None
        return chat.bd.um('SELECT c.sala, c.ativo, s.evento, s.expira FROM convite c JOIN sala s ON s.id = c.sala WHERE c.token = ?', token)

    def limite_ip(req, n, janela=600):
        ip = req.headers.get('CF-Connecting-IP') or req.remote or '?'
        agora = time.time()
        lista = [t for t in chat.falhas.get(ip, []) if agora - t < janela]
        if len(lista) >= n:
            chat.falhas[ip] = lista
            return False
        lista.append(agora)
        chat.falhas[ip] = lista
        return True

    @r.get(P + '/api/convite')
    async def convite_get(req):
        if not limite_ip(req, 60):
            return json_resp({'error': 'devagar'}, 429)
        cv = convite_de(req, req.query.get('c'))
        if not cv or not cv['ativo'] or cv['expira'] <= agora_ms():
            await asyncio.sleep(0.8)
            return json_resp({'error': 'convite'}, 404)
        ms = chat.bd.q('SELECT pid, nome, grupo, reclamado FROM membro WHERE sala=? AND externo=0 ORDER BY nome', cv['sala'])
        return json_resp({'evento': cv['evento'], 'membros': [{'pid': m['pid'], 'nome': m['nome'], 'grupo': m['grupo'], 'livre': not m['reclamado']} for m in ms]})

    @r.post(P + '/api/convite/entrar')
    async def convite_entrar(req):
        if not limite_ip(req, 20):
            return json_resp({'error': 'devagar'}, 429)
        b = await ler_json(req)
        cv = convite_de(req, b.get('c'))
        if not cv or not cv['ativo'] or cv['expira'] <= agora_ms():
            await asyncio.sleep(0.8)
            return json_resp({'error': 'convite'}, 404)
        pid = limpa(b.get('pid'), 24)
        # a tomada do lugar e atomica: so quem passar de 0 para 1 fica com o link
        cur = chat.bd.x('UPDATE membro SET reclamado=1 WHERE sala=? AND pid=? AND reclamado=0 AND externo=0', cv['sala'], pid)
        if cur.rowcount != 1:
            existe = chat.bd.um('SELECT 1 FROM membro WHERE sala=? AND pid=? AND externo=0', cv['sala'], pid)
            return json_resp({'error': 'ocupado' if existe else 'nome'}, 409 if existe else 404)
        m = chat.bd.um('SELECT token FROM membro WHERE sala=? AND pid=?', cv['sala'], pid)
        return json_resp({'token': m['token']})

    # ---------------------------------------------------------- membros: o chat
    @r.get(P + '/api/sala')
    async def sala_get(req):
        q = await chat.exige(req)
        if q['papel'] == 'membro':
            chat.bd.x('UPDATE membro SET reclamado=1 WHERE sala=? AND pid=? AND reclamado=0', q['sala'], q['pid'])
        s = chat.bd.um('SELECT * FROM sala WHERE id=?', q['sala'])
        membros = [{'pid': 'dono', 'nome': s['dono_nome'], 'tipo': 'dono'}] + [{'pid': m['pid'], 'nome': m['nome'], 'grupo': m['grupo'], 'tipo': m['tipo'], 'externo': bool(m['externo'])} for m in chat.bd.q('SELECT pid,nome,grupo,tipo,externo FROM membro WHERE sala=? ORDER BY externo, nome', q['sala'])]
        return json_resp({'evento': s['evento'], 'expira': s['expira'], 'eu': {'pid': q['pid'], 'nome': q['nome'], 'papel': q['papel'], 'tipo': q['tipo'], 'gere': chat.gere(q)}, 'membros': membros,
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

    async def ler_parte(parte, limite):
        buf = bytearray()
        while True:
            pedaco = await parte.read_chunk(64 * 1024)
            if not pedaco:
                return bytes(buf)
            buf.extend(pedaco)
            if len(buf) > limite:
                return None

    @r.post(P + '/api/foto')
    async def foto_post(req):
        q = await chat.exige(req)
        if q.get('tipo') == 'leitura':
            return json_resp({'error': 'leitura'}, 403)
        try:
            if int(req.headers.get('Content-Length') or 0) > FOTO_MAX + MINI_MAX + 20000:
                return json_resp({'error': 'grande'}, 413)
        except ValueError:
            return json_resp({'error': 'pedido'}, 400)
        campos = {}
        try:
            leitor = await req.multipart()
            async for parte in leitor:
                if parte.name == 'foto':
                    campos['foto'] = await ler_parte(parte, FOTO_MAX)
                elif parte.name == 'mini':
                    campos['mini'] = await ler_parte(parte, MINI_MAX)
                elif parte.name in ('texto', 'w', 'h'):
                    campos[parte.name] = (await ler_parte(parte, 4000) or b'').decode('utf-8', 'replace')
        except Exception:
            return json_resp({'error': 'pedido'}, 400)
        if campos.get('foto') is None or campos.get('mini') is None:
            return json_resp({'error': 'grande'}, 413)
        for k in ('foto', 'mini'):
            b = campos.get(k) or b''
            if len(b) < 100 or b[:3] != b'\xff\xd8\xff' or b'\xff\xd9' not in b[-64:]:     # so JPEG inteiro (o telemovel reencoda sempre)
                return json_resp({'error': 'formato'}, 400)
        try:
            w, h = int(campos.get('w') or 0), int(campos.get('h') or 0)
        except ValueError:
            w = h = 0
        m, erro, status = chat.guardar_foto(q, campos.get('texto'), campos['foto'], campos['mini'], w, h)
        if erro:
            return json_resp({'error': erro}, status)
        await chat.difundir(q['sala'], {'t': 'msg', 'm': m})
        t = asyncio.ensure_future(chat.push_ausentes(q['sala'], m))
        chat.tarefas.add(t)
        t.add_done_callback(chat.tarefas.discard)
        return json_resp({'m': m})

    @r.get(P + '/api/foto/{fid}')
    async def foto_get(req):
        q = await chat.exige(req)
        fid = req.match_info['fid']
        if not FOTO_RE.match(fid):
            return json_resp({'error': 'nao encontrada'}, 404)
        m = chat.bd.um('SELECT sala FROM msg WHERE foto=? AND apagada=0', fid)
        if not m or m['sala'] != q['sala']:
            return json_resp({'error': 'nao encontrada'}, 404)
        caminho = os.path.join(chat.pasta_fotos(q['sala']), fid + ('_t' if req.query.get('t') else '') + '.jpg')
        if not os.path.exists(caminho):
            return json_resp({'error': 'nao encontrada'}, 404)
        return web.FileResponse(caminho, headers={'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff'})

    @r.post(P + '/api/apagar')
    async def apagar(req):
        q = await chat.exige(req)
        if not chat.gere(q):
            return json_resp({'error': 'so a regie e os gestores'}, 403)
        mid = int((await ler_json(req)).get('id') or 0)
        mf = chat.bd.um('SELECT foto FROM msg WHERE id=? AND sala=?', mid, q['sala'])
        if mf and mf['foto']:
            chat.apagar_ficheiros_foto(q['sala'], mf['foto'])
        chat.bd.x('UPDATE msg SET apagada=1, fixa=0 WHERE id=? AND sala=?', mid, q['sala'])
        await chat.difundir(q['sala'], {'t': 'del', 'id': mid})
        return json_resp({'ok': True})

    @r.post(P + '/api/fixar')
    async def fixar(req):
        q = await chat.exige(req)
        if not chat.gere(q):
            return json_resp({'error': 'so a regie e os gestores'}, 403)
        b = await ler_json(req)
        mid, fx = int(b.get('id') or 0), 1 if b.get('fixa') else 0
        chat.bd.x('UPDATE msg SET fixa=? WHERE id=? AND sala=? AND apagada=0', fx, mid, q['sala'])
        await chat.difundir(q['sala'], {'t': 'fixa', 'id': mid, 'fixa': fx})
        return json_resp({'ok': True})

    # ---------------------------------------------------------- gestao dos participantes (dono e gestores, no proprio chat)
    def membro_json(m, com_token):
        d = {'pid': m['pid'], 'nome': m['nome'], 'grupo': m['grupo'], 'tipo': m['tipo'], 'externo': bool(m['externo']), 'entrou': bool(m['reclamado'])}
        if com_token:
            d['token'] = m['token']
        return d

    async def exige_gestao(req):
        q = await chat.exige(req)
        if not chat.gere(q):
            raise web.HTTPForbidden(text=json.dumps({'error': 'so a regie e os gestores'}), content_type='application/json')
        return q

    def criar_externo(sala, nome, tipo):
        if chat.bd.um('SELECT COUNT(*) AS n FROM membro WHERE sala=?', sala)['n'] >= MAX_MEMBROS:
            return None
        pid = 'x' + secrets.token_hex(4)
        chat.bd.x('INSERT INTO membro (sala,pid,nome,grupo,token,tipo,externo,reclamado) VALUES (?,?,?,?,?,?,1,1)', sala, pid, nome, 'De fora', novo_token(), tipo)
        return chat.bd.um('SELECT * FROM membro WHERE sala=? AND pid=?', sala, pid)

    @r.get(P + '/api/gestao/membros')
    async def g_membros(req):
        q = await exige_gestao(req)
        ms = chat.bd.q('SELECT * FROM membro WHERE sala=? ORDER BY externo DESC, nome', q['sala'])
        return json_resp({'membros': [membro_json(m, bool(m['externo'])) for m in ms]})       # o link so se mostra das pessoas de fora (para o reenviar)

    @r.post(P + '/api/gestao/adicionar')
    async def g_adicionar(req):
        q = await exige_gestao(req)
        b = await ler_json(req)
        nome = re.sub(r'\s+', ' ', limpa(b.get('nome'), 80))
        tipo = limpa(b.get('tipo'), 20) or 'participante'
        permitidos = TIPOS if q['papel'] == 'dono' else ('participante', 'leitura')      # um gestor nao cria gestores
        if len(nome) < 2:
            return json_resp({'error': 'escreve o nome'}, 400)
        if tipo not in permitidos:
            return json_resp({'error': 'tipo nao permitido'}, 403)
        m = criar_externo(q['sala'], nome, tipo)
        if not m:
            return json_resp({'error': 'sala cheia'}, 409)
        await chat.difundir(q['sala'], {'t': 'membros'})
        return json_resp({'membro': membro_json(m, True)})

    @r.post(P + '/api/gestao/remover')
    async def g_remover(req):
        q = await exige_gestao(req)
        pid = limpa((await ler_json(req)).get('pid'), 24)
        m = chat.bd.um('SELECT * FROM membro WHERE sala=? AND pid=?', q['sala'], pid)
        if not m:
            return json_resp({'error': 'nao encontrado'}, 404)
        if q['papel'] != 'dono' and (not m['externo'] or pid == q['pid']):
            return json_resp({'error': 'um gestor so retira pessoas de fora'}, 403)
        chat.bd.x('DELETE FROM push WHERE token=?', m['token'])
        chat.bd.x('DELETE FROM membro WHERE sala=? AND pid=?', q['sala'], pid)
        for (w, p_, _n, _pp) in list(chat.ws.get(q['sala'], set())):
            if p_ == pid:
                await w.close(code=4001, message=b'removido')
        await chat.difundir(q['sala'], {'t': 'membros'})
        return json_resp({'ok': True})

    @r.post(P + '/api/gestao/tipo')
    async def g_tipo(req):
        q = await exige_gestao(req)
        if q['papel'] != 'dono':
            return json_resp({'error': 'so o dono muda o tipo'}, 403)
        b = await ler_json(req)
        pid, tipo = limpa(b.get('pid'), 24), limpa(b.get('tipo'), 20)
        if tipo not in TIPOS:
            return json_resp({'error': 'tipo invalido'}, 400)
        cur = chat.bd.x('UPDATE membro SET tipo=? WHERE sala=? AND pid=?', tipo, q['sala'], pid)
        if cur.rowcount != 1:
            return json_resp({'error': 'nao encontrado'}, 404)
        await chat.difundir(q['sala'], {'t': 'membros'})
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
        chat.contar(ws_pico=sum(len(v) for v in chat.ws.values()))
        chat.bd.x('UPDATE sala SET pico_ws=MAX(pico_ws,?) WHERE id=?', len(chat.ws.get(sala, set())), sala)
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
                    atual = chat.por_token(q['token'])
                    if not atual:
                        await ws.close(code=4001, message=b'removido')
                        break
                    m, erro, _st = await chat.enviar_msg(atual, d.get('texto'), bool(d.get('aviso')))
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
                    await chat.fechar_ws_expiradas()
                    chat.limpar_expiradas(pasta)
                    chat.gravar_uso()
                except Exception:
                    log.exception('limpeza')
                await asyncio.sleep(600)
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
    app = criar_app(pasta, segredo, os.environ.get('VTCHAT_VAPID_SUB', VAPID_SUB_PADRAO))
    web.run_app(app, host=os.environ.get('VTCHAT_HOST', '127.0.0.1'), port=int(os.environ.get('VTCHAT_PORT', '8782')), access_log=None, print=None)


if __name__ == '__main__':
    main()
