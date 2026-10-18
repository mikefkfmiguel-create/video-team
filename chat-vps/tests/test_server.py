# -*- coding: utf-8 -*-
"""Servidor do chat (chat-vps/server.py) em memoria, sem rede: python tests/test_server.py  (com o venv de chat-vps)."""
import asyncio
import json
import os
import sys
import tempfile
import time

import aiohttp
from aiohttp import web
from aiohttp.test_utils import TestServer

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(AQUI, '..'))
import server as S  # noqa: E402

SEGREDO = 'segredo-de-teste'
falhas = 0


def ok(c, n):
    global falhas
    print(('OK    ' if c else 'FALHA ') + n, flush=True)
    if not c:
        falhas += 1


async def esperar(cond, t=5.0):
    fim = time.time() + t
    while time.time() < fim:
        if cond():
            return True
        await asyncio.sleep(0.03)
    return bool(cond())


async def main():
    pasta = tempfile.mkdtemp(prefix='vtchat_')
    app = S.criar_app(pasta, SEGREDO)
    chat = app['chat']
    envios = []                                   # push "enviados" (o Web Push a sério nao sai daqui)
    mortos = set()

    def falso_enviar(sub, dados):
        envios.append((sub['endpoint'], dados))
        return 'morta' if sub['endpoint'] in mortos else 'ok'
    chat.vapid.enviar = falso_enviar

    srv = TestServer(app)
    await srv.start_server()
    B = str(srv.make_url('')).rstrip('/')
    async with aiohttp.ClientSession() as http:
        async def api(metodo, caminho, k=None, admin=None, corpo=None):
            h = {}
            if k:
                h['X-Chat'] = k
            if admin is not None:
                h['X-Chat-Admin'] = admin
            async with http.request(metodo, B + caminho, headers=h, json=corpo) as r:
                try:
                    j = await r.json()
                except Exception:
                    j = None
                return r.status, j

        KEY = 'os:900:Congresso Teste'
        MEMBROS = [{'id': '11', 'name': 'Ana Silva', 'grupo': 'Vídeo'}, {'id': '12', 'name': 'Rui Costa', 'grupo': 'Vídeo'}, {'id': '13', 'name': 'Marta Lopes', 'grupo': 'Luz'}]

        # ---- admin
        s, _ = await api('POST', '/chat/api/admin/criar', corpo={'key': KEY, 'membros': MEMBROS})
        ok(s == 401, 'criar sem o segredo: 401')
        s, _ = await api('POST', '/chat/api/admin/criar', admin='errado', corpo={'key': KEY, 'membros': MEMBROS})
        ok(s == 401, 'criar com o segredo errado: 401')
        s, c = await api('POST', '/chat/api/admin/criar', admin=SEGREDO, corpo={'key': KEY, 'label': 'Congresso Teste', 'ate': '2099-01-02', 'membros': MEMBROS, 'donoNome': 'Mike (Régie)'})
        ok(s == 200 and c['novo'] and len(c['membros']) == 3 and c['dono']['token'], 'o Worker cria a sala com 3 pessoas e o link da regie')
        tok = {m['id']: m['token'] for m in c['membros']}
        ok(len(set(tok.values())) == 3 and all(len(t) == 40 for t in tok.values()), 'links (tokens) diferentes, 40 hex')
        s, c2 = await api('POST', '/chat/api/admin/criar', admin=SEGREDO, corpo={'key': KEY, 'label': 'Congresso Teste', 'membros': MEMBROS + [{'id': '14', 'name': 'Hugo Dias'}]})
        ok(len(c2['membros']) == 4 and not c2['novo'] and {m['id']: m['token'] for m in c2['membros']}['11'] == tok['11'], 'criar outra vez acrescenta e mantem os links ja enviados')
        tok['14'] = {m['id']: m['token'] for m in c2['membros']}['14']
        s, v = await api('GET', '/chat/api/admin/ver?key=' + KEY, admin=SEGREDO)
        ok(v['existe'] and len(v['membros']) == 4, 'ver a sala')
        s, v = await api('GET', '/chat/api/admin/ver?key=nada', admin=SEGREDO)
        ok(v['existe'] is False, 'evento sem sala')
        s, _ = await api('POST', '/chat/api/admin/criar', admin=SEGREDO, corpo={'key': KEY, 'membros': []})
        ok(s == 400, 'sem pessoas: 400')
        s, longe = await api('POST', '/chat/api/admin/criar', admin=SEGREDO, corpo={'key': 'os:1:Antigo', 'membros': [MEMBROS[0]], 'ate': '2001-01-01'})
        ok(S.agora_ms() + 3600e3 < longe['expira'] < S.agora_ms() + 3 * 3600e3, 'prazo ja passado: ainda assim dura 2 horas (nao expira logo)')

        # ---- entrar
        ok((await api('GET', '/chat/api/sala', k='a' * 40))[0] == 401, 'link inventado: 401')
        ok((await api('GET', '/chat/api/sala'))[0] == 401, 'sem link: 401')
        s, sala = await api('GET', '/chat/api/sala', k=tok['11'])
        ok(s == 200 and {k: sala['eu'][k] for k in ('pid', 'nome', 'papel', 'tipo')} == {'pid': '11', 'nome': 'Ana Silva', 'papel': 'membro', 'tipo': 'participante'} and sala['evento'] == 'Congresso Teste' and sala['msgs'] == [] and sala['push'] is True, 'a Ana entra (sala vazia, push disponivel)')
        ok(len(sala['membros']) == 5 and tok['12'] not in json.dumps(sala), 've quem esta na sala, nunca os links')

        # ---- mensagens por HTTP
        s, m1 = await api('POST', '/chat/api/enviar', k=tok['11'], corpo={'texto': '  Chego às 8h  '})
        ok(s == 200 and m1['m']['texto'] == 'Chego às 8h' and m1['m']['nome'] == 'Ana Silva' and m1['m']['aviso'] == 0, 'enviar: texto limpo e nome certo')
        ok((await api('POST', '/chat/api/enviar', k=tok['11'], corpo={'texto': '   '}))[0] == 400, 'mensagem vazia: 400')
        s, fa = await api('POST', '/chat/api/enviar', k=tok['12'], corpo={'texto': 'sou o chefe', 'aviso': True})
        ok(fa['m']['aviso'] == 0 and fa['m']['fixa'] == 0, 'um membro nao faz aviso fixo')
        s, gr = await api('POST', '/chat/api/enviar', k=tok['12'], corpo={'texto': 'a' * 5000})
        ok(len(gr['m']['texto']) == 2000, 'limite de 2000 caracteres')
        s, ls_ = await api('GET', '/chat/api/msgs?depois=%d' % m1['m']['id'], k=tok['13'])
        ok(len(ls_['msgs']) == 2, 'ler o que veio depois de uma mensagem')

        # ---- tempo real
        rec = {'a': [], 'b': []}

        async def ouvir(ws, dest):
            async for msg in ws:
                if msg.type == aiohttp.WSMsgType.TEXT:
                    dest.append(json.loads(msg.data))
        wa = await http.ws_connect(B + '/chat/api/ws?k=' + tok['11'])
        ta = asyncio.ensure_future(ouvir(wa, rec['a']))
        ok(await esperar(lambda: any(x['t'] == 'ola' and len(x['msgs']) == 3 for x in rec['a'])), 'ao ligar recebe o historico')
        wb = await http.ws_connect(B + '/chat/api/ws?k=' + tok['13'])
        tb = asyncio.ensure_future(ouvir(wb, rec['b']))
        ok(await esperar(lambda: any(x['t'] == 'online' and '13' in x['online'] for x in rec['a'])), 'a Ana ve a Marta online')
        await wa.send_str(json.dumps({'t': 'msg', 'texto': 'Alguém tem um cabo HDMI?', 'cid': 'c1'}))
        ok(await esperar(lambda: any(x['t'] == 'msg' and x['m']['texto'].startswith('Alguém') for x in rec['b'])), 'a Marta recebe em tempo real')
        ok(await esperar(lambda: any(x['t'] == 'ok' and x['cid'] == 'c1' for x in rec['a'])), 'a Ana recebe a confirmacao')
        await wa.send_str('{"t":"ping"}')
        ok(await esperar(lambda: any(x['t'] == 'pong' for x in rec['a'])), 'ping/pong')
        for i in range(20):
            await wb.send_str(json.dumps({'t': 'msg', 'texto': 'spam %d' % i, 'cid': 's%d' % i}))
        ok(await esperar(lambda: any(x['t'] == 'erro' and x['erro'] == 'devagar' for x in rec['b'])), 'anti-spam')

        # ---- push: so a quem nao tem o chat aberto
        ok((await api('POST', '/chat/api/push/inscrever', k=tok['12'], corpo={'subscription': {'endpoint': 'http://x', 'keys': {}}}))[0] == 400, 'subscricao invalida recusada')
        for pid, ep in (('12', 'https://push.exemplo/rui'), ('11', 'https://push.exemplo/ana'), ('14', 'https://push.exemplo/hugo-morto')):
            s, _ = await api('POST', '/chat/api/push/inscrever', k=tok[pid], corpo={'subscription': {'endpoint': ep, 'keys': {'p256dh': 'BPk', 'auth': 'au'}}})
            ok(s == 200, 'subscricao guardada (%s)' % pid)
        mortos.add('https://push.exemplo/hugo-morto')
        s, ch = await api('GET', '/chat/api/push/chave', k=tok['12'])
        ok(s == 200 and len(ch['chave']) > 60, 'chave publica VAPID')
        envios.clear()
        s, _ = await api('POST', '/chat/api/enviar', k=c['dono']['token'], corpo={'texto': 'Chegada às 7h, entrada B', 'aviso': True})
        ok(await esperar(lambda: any('hugo-morto' in e for e, _d in envios)) and any('push.exemplo/rui' in e for e, _d in envios), 'push para quem nao esta online (Rui, Hugo)')
        ok(not any('push.exemplo/ana' in e for e, _d in envios), 'e nao para a Ana (tem o chat aberto)')
        d_rui = [d for e, d in envios if e.endswith('/rui')][0]
        ok(d_rui['t'].startswith('📌') and 'Régie' in d_rui['b'] and d_rui['u'] == '/chat/#' + tok['12'], 'o aviso chega com titulo 📌 e abre o chat com o link pessoal')
        ok(await esperar(lambda: chat.bd.um('SELECT 1 FROM push WHERE endpoint=?', 'https://push.exemplo/hugo-morto') is None), 'subscricao morta (410) e apagada')
        envios.clear()
        await api('POST', '/chat/api/enviar', k=tok['11'], corpo={'texto': 'olá'})
        await asyncio.sleep(0.3)
        ok(not any('/ana' in e for e, _d in envios), 'quem escreve nunca recebe o proprio push')

        # ---- o contacto do Web Push tem de ser aceite pelo py_vapid (modo estrito): senao NENHUMA notificacao sai (aconteceu em producao)
        try:
            chat.vapid.v.sign({'sub': chat.vapid.sub, 'aud': 'https://fcm.googleapis.com'})
            assinou = True
        except Exception as e:
            assinou = False
            print('   erro:', e)
        ok(assinou and chat.vapid.sub.startswith('mailto:'), 'a assinatura VAPID aceita o contacto configurado (%s)' % chat.vapid.sub)

        # ---- regie
        s, f = await api('GET', '/chat/api/sala', k=tok['13'])
        ok(len(f['fixas']) == 1 and '7h' in f['fixas'][0]['texto'], 'aviso fixo visto por quem entra')
        ok((await api('POST', '/chat/api/apagar', k=tok['11'], corpo={'id': m1['m']['id']}))[0] == 403, 'membro nao apaga')
        ok((await api('POST', '/chat/api/apagar', k=c['dono']['token'], corpo={'id': m1['m']['id']}))[0] == 200, 'regie apaga')
        ok(await esperar(lambda: any(x['t'] == 'del' for x in rec['b'])), 'apagar chega a todos')
        ok(m1['m']['id'] not in [x['id'] for x in (await api('GET', '/chat/api/msgs', k=tok['13']))[1]['msgs']], 'e nao volta')

        # ---- manifesto e estaticos (PWA)
        async with http.get(B + '/chat/manifest.webmanifest?k=' + tok['12']) as r:
            mf = await r.json(content_type=None)
        ok(mf['start_url'] == '/chat/#' + tok['12'] and mf['scope'] == '/chat/' and mf['display'] == 'standalone' and 'Congresso Teste' in mf['name'], 'manifesto com o link pessoal no start_url')
        async with http.get(B + '/chat/manifest.webmanifest?k=' + 'b' * 40) as r:
            mf2 = await r.json(content_type=None)
        ok(mf2['start_url'] == '/chat/' and 'Congresso' not in mf2['name'], 'manifesto sem token valido: generico')
        async with http.get(B + '/chat/') as r:
            ok(r.status == 200 and 'text/html' in r.headers['Content-Type'] and 'Video Team' in await r.text(), 'a pagina do chat e servida em /chat/')
        async with http.get(B + '/chat/sw') as r:
            ok(r.status == 200 and r.headers.get('Service-Worker-Allowed') == '/chat/' and 'javascript' in r.headers['Content-Type'], 'service worker com o ambito /chat/')
        async with http.get(B + '/chat/icons/icon-192.png') as r:
            ok(r.status == 200 and r.headers['Content-Type'] == 'image/png', 'icones')
        async with http.get(B + '/chat', allow_redirects=False) as r:
            ok(r.status == 301 and r.headers['Location'] == '/chat/', '/chat vai para /chat/')

        # ---- link geral: cada pessoa escolhe o seu nome
        s, _ = await api('POST', '/chat/api/admin/convite', corpo={'key': KEY})
        ok(s == 401, 'criar o link geral sem o segredo: 401')
        s, cv = await api('POST', '/chat/api/admin/convite', admin=SEGREDO, corpo={'key': KEY})
        ok(s == 200 and cv['convite']['ativo'] and len(cv['convite']['token']) == 40, 'o dono cria o link geral')
        tok_c = cv['convite']['token']
        s, c2_ = await api('POST', '/chat/api/admin/convite', admin=SEGREDO, corpo={'key': KEY})
        ok(c2_['convite']['token'] == tok_c, 'pedir outra vez devolve o mesmo link (nao muda sozinho)')
        s, lst = await api('GET', '/chat/api/convite?c=' + tok_c)
        ok(s == 200 and lst['evento'] == 'Congresso Teste' and len(lst['membros']) == 4, 'o link mostra o evento e os nomes (sem tokens)')
        ok(tok['12'] not in json.dumps(lst) and all(set(m) == {'pid', 'nome', 'grupo', 'livre'} for m in lst['membros']), 'e nunca os links pessoais nem outros dados')
        ok((await api('GET', '/chat/api/convite?c=' + 'a' * 40))[0] == 404 and (await api('GET', '/chat/api/convite'))[0] == 404, 'link geral inventado: 404')
        s, ent = await api('POST', '/chat/api/convite/entrar', corpo={'c': tok_c, 'pid': '12'})
        ok(s == 200 and ent['token'] == tok['12'], 'o Rui escolhe o nome dele e recebe o link pessoal')
        s, sala12 = await api('GET', '/chat/api/sala', k=ent['token'])
        ok(s == 200 and sala12['eu']['nome'] == 'Rui Costa', 'e esse link abre o chat como o Rui')
        s, outra = await api('POST', '/chat/api/convite/entrar', corpo={'c': tok_c, 'pid': '12'})
        ok(s == 409 and outra['error'] == 'ocupado', 'outro aparelho nao pode tomar o mesmo nome (409)')
        s, lst2 = await api('GET', '/chat/api/convite?c=' + tok_c)
        ok([m['livre'] for m in lst2['membros'] if m['pid'] == '12'] == [False], 'o nome do Rui aparece como «ja entrou»')
        ok((await api('POST', '/chat/api/convite/entrar', corpo={'c': tok_c, 'pid': 'zzz'}))[0] == 404, 'nome que nao existe: 404')
        ok((await api('POST', '/chat/api/convite/entrar', corpo={'c': 'b' * 40, 'pid': '13'}))[0] == 404, 'entrar com um link geral falso: 404')
        # quem entrou pelo link pessoal tambem ocupa o lugar (ninguem o toma pelo link geral)
        await api('GET', '/chat/api/sala', k=tok['13'])
        ok((await api('POST', '/chat/api/convite/entrar', corpo={'c': tok_c, 'pid': '13'}))[0] == 409, 'o lugar de quem ja abriu o link pessoal tambem esta ocupado')
        s, ver_ = await api('GET', '/chat/api/admin/ver?key=' + KEY, admin=SEGREDO)
        ok({m['id']: m['entrou'] for m in ver_['membros']}['12'] is True and ver_['convite']['ativo'], 'o dono ve quem ja entrou')
        s, lib = await api('POST', '/chat/api/admin/libertar', admin=SEGREDO, corpo={'key': KEY, 'id': '12'})
        novo12 = {m['id']: m for m in lib['membros']}['12']
        ok(not novo12['entrou'] and novo12['token'] != tok['12'], 'libertar o lugar: fica livre e o link pessoal muda')
        ok((await api('GET', '/chat/api/sala', k=tok['12']))[0] == 401, '...e o aparelho de antes perde o acesso')
        s, ent2 = await api('POST', '/chat/api/convite/entrar', corpo={'c': tok_c, 'pid': '12'})
        ok(s == 200 and ent2['token'] == novo12['token'], 'outra pessoa pode escolher o nome libertado')
        tok['12'] = ent2['token']
        s, off = await api('POST', '/chat/api/admin/convite', admin=SEGREDO, corpo={'key': KEY, 'ativo': False})
        ok(not off['convite']['ativo'] and (await api('GET', '/chat/api/convite?c=' + tok_c))[0] == 404, 'desativar o link geral: deixa de funcionar')
        s, on = await api('POST', '/chat/api/admin/convite', admin=SEGREDO, corpo={'key': KEY, 'ativo': True})
        ok(on['convite']['ativo'] and on['convite']['token'] == tok_c and (await api('GET', '/chat/api/convite?c=' + tok_c))[0] == 200, 'e volta a ativar com o mesmo link')
        s, nv = await api('POST', '/chat/api/admin/convite', admin=SEGREDO, corpo={'key': KEY, 'renovar': True})
        ok(nv['convite']['token'] != tok_c and (await api('GET', '/chat/api/convite?c=' + tok_c))[0] == 404, 'link novo: o antigo deixa de servir')
        for _ in range(25):
            await api('POST', '/chat/api/convite/entrar', corpo={'c': 'c' * 40, 'pid': '1'})
        ok((await api('POST', '/chat/api/convite/entrar', corpo={'c': 'c' * 40, 'pid': '1'}))[0] == 429, 'muitas tentativas do mesmo endereco: 429')
        chat.falhas.clear()

        # ---- papeis: dono, gestor, participante e so leitura; pessoas de fora
        dono_tk = c['dono']['token']
        chat.recentes.clear()          # o teste de spam (Marta) ja gastou o limite de ritmo dela
        s_, tp = await api('POST', '/chat/api/gestao/tipo', k=tok['11'], corpo={'pid': '13', 'tipo': 'gestor'})
        ok(s_ == 403, 'um participante normal nao gere nada (403)')
        s_, _ = await api('POST', '/chat/api/gestao/adicionar', k=tok['11'], corpo={'nome': 'Intruso'})
        ok(s_ == 403 and (await api('GET', '/chat/api/gestao/membros', k=tok['11']))[0] == 403, '...nem acrescenta pessoas de fora nem ve a gestao')
        s_, g1 = await api('POST', '/chat/api/gestao/tipo', k=dono_tk, corpo={'pid': '13', 'tipo': 'gestor'})
        ok(s_ == 200, 'o dono faz da Marta gestora')
        s_, sala13 = await api('GET', '/chat/api/sala', k=tok['13'])
        ok(sala13['eu']['tipo'] == 'gestor' and sala13['eu']['gere'] is True, 'a Marta passa a ver que e gestora')
        ok({m['pid']: m['tipo'] for m in sala13['membros']}['13'] == 'gestor' and {m['pid']: m['tipo'] for m in sala13['membros']}['dono'] == 'dono', 'todos veem o tipo de cada pessoa')
        ok((await api('POST', '/chat/api/gestao/tipo', k=dono_tk, corpo={'pid': '13', 'tipo': 'chefe'}))[0] == 400, 'tipo invalido: 400')
        ok((await api('POST', '/chat/api/gestao/tipo', k=dono_tk, corpo={'pid': 'zzz', 'tipo': 'leitura'}))[0] == 404, 'pessoa que nao existe: 404')
        ok((await api('POST', '/chat/api/gestao/tipo', k=tok['13'], corpo={'pid': '12', 'tipo': 'leitura'}))[0] == 403, 'uma gestora NAO muda o tipo de ninguem (so o dono)')

        # a gestora acrescenta uma pessoa de fora
        s_, ext = await api('POST', '/chat/api/gestao/adicionar', k=tok['13'], corpo={'nome': '  Cliente  Externo ', 'tipo': 'participante'})
        ok(s_ == 200 and ext['membro']['nome'] == 'Cliente Externo' and ext['membro']['externo'] and len(ext['membro']['token']) == 40 and ext['membro']['pid'].startswith('x'), 'a gestora acrescenta uma pessoa de fora e recebe o link dela')
        tok_ext = ext['membro']['token']
        s_, se = await api('GET', '/chat/api/sala', k=tok_ext)
        ok(s_ == 200 and se['eu']['nome'] == 'Cliente Externo' and se['eu']['gere'] is False, 'a pessoa de fora entra no chat como participante')
        s_, mx = await api('POST', '/chat/api/enviar', k=tok_ext, corpo={'texto': 'Boa tarde a todos'})
        ok(s_ == 200 and mx['m']['nome'] == 'Cliente Externo', 'e pode escrever')
        ok((await api('POST', '/chat/api/gestao/adicionar', k=tok['13'], corpo={'nome': 'Outro Gestor', 'tipo': 'gestor'}))[0] == 403, 'uma gestora NAO cria outros gestores')
        ok((await api('POST', '/chat/api/gestao/adicionar', k=tok['13'], corpo={'nome': 'A'}))[0] == 400, 'nome demasiado curto: 400')
        s_, ro = await api('POST', '/chat/api/gestao/adicionar', k=tok['13'], corpo={'nome': 'Observador', 'tipo': 'leitura'})
        tok_ro = ro['membro']['token']
        ok(s_ == 200 and ro['membro']['tipo'] == 'leitura', 'a gestora pode acrescentar alguem so de leitura')
        s_, lm = await api('GET', '/chat/api/gestao/membros', k=tok['13'])
        so_ext = {m['pid']: m for m in lm['membros']}
        ok(all('token' in m for m in lm['membros'] if m['externo']) and all('token' not in m for m in lm['membros'] if not m['externo']), 'a gestao mostra o link so das pessoas de fora (para o reenviar), nunca o dos outros')

        # so leitura
        s_, er = await api('POST', '/chat/api/enviar', k=tok_ro, corpo={'texto': 'posso escrever?'})
        ok(s_ == 403 and er['error'] == 'leitura', 'so leitura: nao pode escrever (403)')
        s_, er2 = await api('POST', '/chat/api/enviar', k=tok_ro, corpo={'texto': 'aviso', 'aviso': True})
        ok(s_ == 403, '...nem fazer avisos')
        ok((await api('GET', '/chat/api/msgs', k=tok_ro))[0] == 200 and (await api('GET', '/chat/api/sala', k=tok_ro))[1]['eu']['tipo'] == 'leitura', 'mas le tudo')
        wro = await http.ws_connect(B + '/chat/api/ws?k=' + tok_ro)
        await wro.receive()
        await wro.send_str(json.dumps({'t': 'msg', 'texto': 'pelo websocket', 'cid': 'r1'}))
        resp_ws = json.loads((await wro.receive()).data)
        ok(resp_ws.get('t') == 'erro' and resp_ws.get('erro') == 'leitura', 'tambem pelo tempo real: «so leitura» nao escreve')
        await wro.close()
        s_, _ = await api('POST', '/chat/api/gestao/tipo', k=dono_tk, corpo={'pid': '12', 'tipo': 'leitura'})
        ok((await api('POST', '/chat/api/enviar', k=tok['12'], corpo={'texto': 'x'}))[0] == 403, 'o dono passa o Rui a so leitura: deixa de poder escrever logo')
        s_, _ = await api('POST', '/chat/api/gestao/tipo', k=dono_tk, corpo={'pid': '12', 'tipo': 'participante'})
        ok((await api('POST', '/chat/api/enviar', k=tok['12'], corpo={'texto': 'voltei'}))[0] == 200, '...e volta a participante: escreve outra vez')

        # a gestora modera (aviso fixo, apagar, fixar)
        s_, av = await api('POST', '/chat/api/enviar', k=tok['13'], corpo={'texto': 'Aviso da gestora', 'aviso': True})
        ok(s_ == 200 and av['m']['aviso'] == 1 and av['m']['fixa'] == 1, 'a gestora faz avisos fixos')
        ok((await api('POST', '/chat/api/apagar', k=tok['13'], corpo={'id': mx['m']['id']}))[0] == 200, 'e apaga mensagens dos outros')
        ok((await api('POST', '/chat/api/fixar', k=tok['12'], corpo={'id': av['m']['id'], 'fixa': 0}))[0] == 403, 'um participante nao fixa nem apaga')

        # retirar
        ok((await api('POST', '/chat/api/gestao/remover', k=tok['13'], corpo={'pid': '12'}))[0] == 403, 'a gestora NAO retira gente da escala (so pessoas de fora)')
        ok((await api('POST', '/chat/api/gestao/remover', k=tok['13'], corpo={'pid': '13'}))[0] == 403, '...nem a si propria')
        ok((await api('POST', '/chat/api/gestao/remover', k=tok['13'], corpo={'pid': ro['membro']['pid']}))[0] == 200, 'mas retira uma pessoa de fora')
        ok((await api('GET', '/chat/api/sala', k=tok_ro))[0] == 401, '...e o link dela deixa de funcionar na hora')
        ok((await api('POST', '/chat/api/gestao/remover', k=dono_tk, corpo={'pid': '14'}))[0] == 200 and (await api('GET', '/chat/api/sala', k=tok['14']))[0] == 401, 'o dono retira qualquer pessoa (tambem da escala)')
        tok.pop('14', None)

        # o link geral nunca entrega pessoas de fora
        s_, cvx = await api('POST', '/chat/api/admin/convite', admin=SEGREDO, corpo={'key': KEY})
        s_, lg = await api('GET', '/chat/api/convite?c=' + cvx['convite']['token'])
        ok(all(not m['pid'].startswith('x') for m in lg['membros']) and 'Cliente Externo' not in json.dumps(lg), 'o link geral nao mostra as pessoas de fora')
        s_, rec = await api('POST', '/chat/api/convite/entrar', corpo={'c': cvx['convite']['token'], 'pid': ext['membro']['pid']})
        ok(s_ == 404, '...nem deixa tomar o lugar de uma delas')

        # o Video Team (dono, pelo Worker) tambem acrescenta e muda tipos
        s_, ad = await api('POST', '/chat/api/admin/adicionar', admin=SEGREDO, corpo={'key': KEY, 'nome': 'Fornecedor Som', 'tipo': 'gestor'})
        novo_g = [m for m in ad['membros'] if m['name'] == 'Fornecedor Som'][0]
        ok(s_ == 200 and novo_g['tipo'] == 'gestor' and novo_g['externo'] and novo_g['token'], 'o dono (Video Team) acrescenta uma pessoa de fora ja como gestora')
        s_, ti = await api('POST', '/chat/api/admin/tipo', admin=SEGREDO, corpo={'key': KEY, 'id': novo_g['id'], 'tipo': 'leitura'})
        ok({m['id']: m['tipo'] for m in ti['membros']}[novo_g['id']] == 'leitura', 'e muda-lhe o tipo')
        ok((await api('POST', '/chat/api/admin/adicionar', corpo={'key': KEY, 'nome': 'X Y'}))[0] == 401, 'sem o segredo: 401')

        # avisa os aparelhos ligados quando a lista muda (para atualizarem o chat)
        recm = []

        async def ouvir_m(ws):
            async for msg in ws:
                if msg.type == aiohttp.WSMsgType.TEXT:
                    recm.append(json.loads(msg.data))
        wm = await http.ws_connect(B + '/chat/api/ws?k=' + tok['11'])
        tm = asyncio.ensure_future(ouvir_m(wm))
        await asyncio.sleep(0.3)
        await api('POST', '/chat/api/gestao/adicionar', k=dono_tk, corpo={'nome': 'Mais Um'})
        ok(await esperar(lambda: any(x['t'] == 'membros' for x in recm)), 'quando alguem entra/sai ou muda de tipo, os aparelhos ligados sao avisados')
        tm.cancel()
        await wm.close()

        # ---- metricas (para a vigia)
        ok((await api('GET', '/chat/api/admin/metricas'))[0] == 401, 'as metricas pedem o segredo')
        s_, mt = await api('GET', '/chat/api/admin/metricas', admin=SEGREDO)
        ok(s_ == 200 and all(k in mt for k in ('db_bytes', 'wal_bytes', 'rss_bytes', 'salas', 'membros', 'mensagens', 'ws_ativos', 'push_subscricoes', 'dias', 'salas_lista', 'uptime_s')), 'as metricas trazem tamanhos, contagens e o uso por dia')
        ok(mt['salas'] >= 1 and mt['mensagens'] >= 1 and mt['db_bytes'] > 0 and mt['dias'][0]['pedidos'] > 10 and mt['dias'][0]['msgs'] >= 1 and mt['dias'][0]['bytes_saida'] > 1000, 'e contam de facto (pedidos, mensagens e bytes de hoje)')
        ok('token' not in json.dumps(mt) and tok['12'] not in json.dumps(mt), 'sem expor links nem conteudo das mensagens')

        # ---- retirar / fechar
        fechou = []

        async def vigia():
            while True:                                  # ignora os avisos «membros» ate chegar o fecho
                msg = await wa.receive()
                if msg.type == aiohttp.WSMsgType.CLOSE:
                    fechou.append(msg.data)
                    return
                if msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                    fechou.append(None)
                    return
        ta.cancel()
        vg = asyncio.ensure_future(vigia())
        await asyncio.sleep(0.1)
        antes_n = chat.bd.um('SELECT COUNT(*) AS n FROM membro WHERE sala=?', nova_sala_id := S.id_da_sala(KEY))['n']
        s, rem = await api('POST', '/chat/api/admin/remover', admin=SEGREDO, corpo={'key': KEY, 'id': '11'})
        ok(s == 200 and len(rem['membros']) == antes_n - 1, 'a Ana e retirada')
        ok((await api('GET', '/chat/api/sala', k=tok['11']))[0] == 401, 'o link dela deixa de funcionar')
        ok(await esperar(lambda: fechou == [4001]), 'e a ligacao em direto dela e cortada (4001)')
        ok(chat.bd.um('SELECT 1 FROM push WHERE token=?', tok['11']) is None, 'e as notificacoes dela apagadas')
        vg.cancel()
        await wb.close()
        tb.cancel()
        s, fe = await api('POST', '/chat/api/admin/fechar', admin=SEGREDO, corpo={'key': KEY})
        ok(fe['ok'] and (await api('GET', '/chat/api/sala', k=tok['12']))[0] == 401 and (await api('GET', '/chat/api/sala', k=c['dono']['token']))[0] == 401, 'fechar: todos os links invalidos')
        ok(chat.bd.um('SELECT COUNT(*) AS n FROM msg')['n'] == 0 and chat.bd.um('SELECT COUNT(*) AS n FROM push')['n'] == 0, 'mensagens e notificacoes apagadas')
        s, nova = await api('POST', '/chat/api/admin/criar', admin=SEGREDO, corpo={'key': KEY, 'label': 'Congresso Teste', 'membros': MEMBROS})
        s, sn = await api('GET', '/chat/api/sala', k=nova['membros'][0]['token'])
        ok(sn['msgs'] == [] and nova['membros'][0]['token'] != tok['11'], 'sala nova: sem mensagens antigas e com links novos')

        # ---- o chat dura o tempo do evento: acaba no fim do ultimo dia (23:59 de Lisboa)
        import datetime as _dt
        from zoneinfo import ZoneInfo as _Z
        hoje = _dt.datetime.now(_Z('Europe/Lisbon')).date()
        fim = _dt.datetime(hoje.year, hoje.month, hoje.day, 23, 59, 59, tzinfo=_Z('Europe/Lisbon')).timestamp() * 1000
        s, ev = await api('POST', '/chat/api/admin/criar', admin=SEGREDO, corpo={'key': 'os:5:Hoje', 'label': 'Acaba hoje', 'ate': hoje.isoformat(), 'membros': [MEMBROS[0]]})
        ok(abs(ev['expira'] - max(fim, S.agora_ms() + 2 * 3600e3)) < 2000, 'um evento que acaba hoje expira hoje as 23:59 (hora de Lisboa) ou daqui a 2 h, o que for mais tarde')
        amanha = (hoje + _dt.timedelta(days=3)).isoformat()
        s, ev3 = await api('POST', '/chat/api/admin/criar', admin=SEGREDO, corpo={'key': 'os:6:Tres', 'label': 'Tres dias', 'ate': amanha, 'membros': [MEMBROS[0]]})
        fim3 = _dt.datetime.fromisoformat(amanha + 'T23:59:59').replace(tzinfo=_Z('Europe/Lisbon')).timestamp() * 1000
        ok(abs(ev3['expira'] - fim3) < 2000, 'um evento de varios dias dura ate ao fim do ultimo dia (sem dias de folga)')
        s, pro = await api('POST', '/chat/api/admin/prolongar', admin=SEGREDO, corpo={'key': 'os:6:Tres', 'dias': 1})
        ok(abs(pro['expira'] - (fim3 + 86400e3)) < 2000, 'prolongar 1 dia empurra o fim um dia')
        ok((await api('POST', '/chat/api/admin/prolongar', admin=SEGREDO, corpo={'key': 'nada'}))[0] == 404, 'prolongar uma sala que nao existe: 404')

        # ---- expirar
        chat.bd.x('UPDATE sala SET expira=? WHERE id=?', S.agora_ms() - 1000, nova['sala'])
        ok((await api('GET', '/chat/api/sala', k=nova['membros'][0]['token']))[0] == 401, 'passado o prazo o link deixa de entrar')
        ok(chat.limpar_expiradas() >= 1 and chat.bd.um('SELECT 1 FROM sala WHERE id=?', nova['sala']) is None, 'a limpeza apaga as salas expiradas')
        ok('912' not in open(os.path.join(pasta, 'chat.db'), 'rb').read().decode('latin-1'), 'a base de dados nao tem telefones')

    await srv.close()
    print('\nfalhas: %d' % falhas)
    return falhas


if __name__ == '__main__':
    sys.exit(1 if asyncio.run(main()) else 0)
