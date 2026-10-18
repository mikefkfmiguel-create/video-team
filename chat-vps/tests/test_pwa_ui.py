# -*- coding: utf-8 -*-
"""A pagina do chat (PWA) servida pelo servidor do VPS, no Edge sem janela: telemovel (Ana) + computador (regie). Nada de producao.
Uso: .venv\\Scripts\\python tests\\test_pwa_ui.py [pasta para capturas]"""
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.request

from playwright.sync_api import sync_playwright

AQUI = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.join(AQUI, '..', 'server.py')
PORTA = 8792
B = 'http://127.0.0.1:%d' % PORTA
SEGREDO = 'segredo-de-teste'
SHOT = sys.argv[1] if len(sys.argv) > 1 else None
KEY = 'os:900:Portugal Digital Summit'
falhas = 0


def ok(c, n):
    global falhas
    print(('OK    ' if c else 'FALHA ') + n, flush=True)
    if not c:
        falhas += 1


def admin(caminho, corpo=None):
    r = urllib.request.Request(B + caminho, data=json.dumps(corpo).encode() if corpo is not None else None, method='POST' if corpo is not None else 'GET',
                               headers={'X-Chat-Admin': SEGREDO, 'Content-Type': 'application/json'})
    return json.loads(urllib.request.urlopen(r).read())


pasta = tempfile.mkdtemp(prefix='vtchat_ui_')
env = dict(os.environ, VTCHAT_DATA=pasta, VTCHAT_SECRET=SEGREDO, VTCHAT_PORT=str(PORTA), PYTHONIOENCODING='utf-8')
proc = subprocess.Popen([sys.executable, SERVER], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(60):
        try:
            urllib.request.urlopen(B + '/chat/', timeout=2).read()
            break
        except Exception:
            time.sleep(0.5)
    c = admin('/chat/api/admin/criar', {'key': KEY, 'label': 'Portugal Digital Summit', 'ate': '2099-10-22', 'donoNome': 'Mike',
                                          'membros': [{'id': '1', 'name': 'Ana Silva', 'grupo': 'Vídeo'}, {'id': '2', 'name': 'Rui Costa', 'grupo': 'Vídeo'}]})
    tok = {m['id']: m['token'] for m in c['membros']}

    with sync_playwright() as p:
        nav = p.chromium.launch(channel='msedge', headless=True)
        tel = nav.new_context(viewport={'width': 390, 'height': 780}, has_touch=True, is_mobile=True, device_scale_factor=2)
        pc = nav.new_context(viewport={'width': 1100, 'height': 760})
        # o Web Push a sério precisa do servico do Google/Mozilla: aqui a subscricao e simulada
        tel.add_init_script("""
          window.__subs = [];
          if (window.PushManager) {
            PushManager.prototype.getSubscription = function () { return Promise.resolve(window.__sub || null); };
            PushManager.prototype.subscribe = function (o) { window.__sub = { endpoint: 'https://push.exemplo/ana-tel', toJSON: function () { return { endpoint: 'https://push.exemplo/ana-tel', keys: { p256dh: 'BPk', auth: 'au' } }; } }; window.__subOpts = !!o.userVisibleOnly && o.applicationServerKey.length > 60; return Promise.resolve(window.__sub); };
          }
        """)
        ana, regie, rui = tel.new_page(), pc.new_page(), pc.new_page()
        erros = []
        for pg in (ana, regie, rui):
            pg.on('pageerror', lambda e: erros.append(str(e)))

        # ---- sem link / link falso
        sem = pc.new_page()
        sem.goto(B + '/chat/')
        ok('Falta o teu link' in sem.inner_text('body'), 'sem link: diz que falta o link pessoal')
        sem.goto(B + '/chat/#' + 'a' * 40)
        sem.wait_for_function("document.getElementById('cTit').textContent.includes('já não é válido')", timeout=10000)
        ok(True, 'um link falso mostra «Este link já não é válido»')
        sem.close()

        # ---- entrar (PWA)
        ana.goto(B + '/chat/#' + tok['1'])
        ana.wait_for_selector('#app:not([hidden])', timeout=15000)
        ok(ana.inner_text('#evento') == 'Portugal Digital Summit' and 'Chat' in ana.title(), 'a Ana entra: titulo com o nome do evento')
        ok('#' not in ana.evaluate('location.href'), 'o token sai do endereco depois de entrar')
        mf = ana.evaluate("document.getElementById('mf').href")
        ok('manifest.webmanifest?k=' + tok['1'] in mf, 'o manifesto da PWA leva o link pessoal (para o atalho abrir logo o chat)')
        with urllib.request.urlopen(mf) as r:
            ok(json.loads(r.read())['start_url'] == '/chat/#' + tok['1'], '...e o start_url do atalho traz o token')
        ana.wait_for_function("navigator.serviceWorker && navigator.serviceWorker.controller !== null || true")
        ana.evaluate("navigator.serviceWorker.ready.then(() => 1)")
        ok(ana.evaluate("navigator.serviceWorker.ready.then(r => r.scope)") == B + '/chat/', 'service worker registado com o ambito /chat/')

        regie.goto(B + '/chat/#' + c['dono']['token'])
        regie.wait_for_selector('#app:not([hidden])', timeout=15000)
        rui.goto(B + '/chat/#' + tok['2'])
        rui.wait_for_selector('#app:not([hidden])', timeout=15000)
        ok(regie.is_visible('#modoAviso') and not ana.is_visible('#modoAviso'), 'so a regie tem o botao «Aviso»')
        ana.wait_for_function("document.getElementById('subTxt').textContent.includes('3 online')", timeout=10000)
        ok(True, 'a Ana ve «3 online · 3 pessoas»')

        # ---- adaptado ao telemovel: nada passa da largura do ecra (a regie tem o botao «Aviso» e o rodape mais largo)
        tel_estreito = nav.new_context(viewport={'width': 260, 'height': 600}, has_touch=True, is_mobile=True, device_scale_factor=2)   # equivale a um telemovel com zoom de pagina ou letra grande
        regie_tel = tel_estreito.new_page()
        regie_tel.goto(B + '/chat/#' + c['dono']['token'])
        regie_tel.wait_for_selector('#app:not([hidden])', timeout=15000)
        regie_tel.fill('#texto', 'uma mensagem comprida ' * 12)
        medidas = regie_tel.evaluate("""(() => { const w = innerWidth, r = (s) => document.querySelector(s).getBoundingClientRect();
          return { w, sw: document.documentElement.scrollWidth, vv: visualViewport.width, app: r('#app').width, appL: r('#app').left, enviar: r('#enviar').right, enviarL: r('#enviar').left, aviso: r('#modoAviso').left, logo: r('.logo').left, sino: r('#btPessoas').right }; })()""")
        ok(medidas['sw'] <= medidas['w'] and medidas['vv'] <= medidas['w'] + 1, 'a pagina nao e mais larga que o telemovel (scrollWidth %d, ecra %d)' % (medidas['sw'], medidas['w']))
        ok(medidas['enviar'] <= medidas['w'] and medidas['aviso'] >= 0 and medidas['logo'] >= 0 and medidas['sino'] <= medidas['w'] and abs(medidas['appL']) < 1, 'cabecalho e rodape (Aviso, caixa, enviar) cabem no ecra: %s' % {k: round(v) for k, v in medidas.items()})
        regie_tel.close()

        # ---- notificacoes
        ana.wait_for_selector('#dica:not([hidden])', timeout=8000)
        ok('avisado quando chegar uma mensagem' in ana.inner_text('#dica') and ana.is_visible('#btSino'), 'pergunta se quer notificacoes (faixa e sino)')
        tel.grant_permissions(['notifications'], origin=B)       # o utilizador carrega em «Permitir» no pedido do navegador
        ana.click('#dicaSim')
        ana.wait_for_function("window.__sub && window.__subOpts === true", timeout=8000)
        con = sqlite3.connect(os.path.join(pasta, 'chat.db'))
        for _ in range(30):
            if con.execute("SELECT COUNT(*) FROM push WHERE endpoint='https://push.exemplo/ana-tel'").fetchone()[0]:
                break
            time.sleep(0.2)
        ok(con.execute("SELECT COUNT(*) FROM push WHERE endpoint='https://push.exemplo/ana-tel'").fetchone()[0] == 1, 'ativar: subscreve com a chave do servidor e o servidor guarda a subscricao')
        ana.wait_for_function("document.getElementById('dica').hidden", timeout=5000)
        ok(ana.evaluate("document.getElementById('btSino').classList.contains('on')"), 'a faixa some e o sino fica ligado')

        # ---- conversa
        ana.fill('#texto', 'Chego às 8h, entrada B https://exemplo.pt/mapa')
        ana.click('#enviar')
        ana.wait_for_selector('.linha.eu .bal:not(.pend)', timeout=8000)
        regie.wait_for_selector('.linha:not(.eu) .txt', timeout=8000)
        ok('Chego às 8h' in regie.inner_text('#lista') and regie.locator(".txt a[href='https://exemplo.pt/mapa']").count() == 1, 'a regie ve a mensagem em tempo real, com o link clicavel')
        regie.fill('#texto', '<img src=x onerror=alert(1)> ok')
        regie.press('#texto', 'Enter')
        rui.wait_for_function("document.getElementById('lista').innerText.includes('onerror')", timeout=8000)
        ok(rui.locator('#lista img').count() == 0, 'HTML numa mensagem aparece como texto')
        regie.click('#modoAviso')
        regie.fill('#texto', 'Chegada às 7h, entrada B')
        regie.click('#enviar')
        ana.wait_for_selector('#fixas:not([hidden])', timeout=8000)
        ok('Chegada às 7h' in ana.inner_text('#fixas'), 'o aviso da regie fica fixo no topo')
        regie.locator('.linha:not(.eu) .bal').first.click(position={'x': 8, 'y': 6})
        regie.once('dialog', lambda d: d.accept())
        regie.click(".acoes button:has-text('Apagar')")
        ana.wait_for_function("!document.getElementById('lista').innerText.includes('Chego às 8h')", timeout=8000)
        ok(True, 'a regie apaga a mensagem da Ana e some do telemovel dela')
        ana.click('#btPessoas')
        ok(ana.locator('#pessoas .pessoa').count() == 3, 'lista de pessoas')
        if SHOT:
            ana.screenshot(path=os.path.join(SHOT, 'pwa-pessoas.png'))
        ana.click('#fechaFolha')
        if SHOT:
            ana.screenshot(path=os.path.join(SHOT, 'pwa-telemovel.png'))
            regie.screenshot(path=os.path.join(SHOT, 'pwa-computador.png'))

        # ---- sem rede
        ana.goto(B + '/chat/?hb=1000')
        ana.wait_for_selector('#app:not([hidden])', timeout=15000)
        ok('Chegada às 7h' in ana.inner_text('#fixas'), 'reabrir sem o # (token guardado no aparelho): entra na mesma')
        tel.set_offline(True)
        ana.wait_for_function("!document.getElementById('estado').hidden", timeout=30000)
        ok('Sem ligação' in ana.inner_text('#estado'), 'sem rede: aviso «Sem ligação»')
        tel.set_offline(False)
        regie.fill('#texto', 'voltaste?')
        regie.press('#texto', 'Enter')
        ana.wait_for_function("document.getElementById('lista').innerText.includes('voltaste?')", timeout=40000)
        ok(True, 'a rede volta e a Ana apanha o que perdeu')

        # ---- retirada
        admin('/chat/api/admin/remover', {'key': KEY, 'id': '1'})
        ana.wait_for_function("document.getElementById('cTit').textContent.includes('já não é válido')", timeout=30000)
        ok(True, 'retirada da sala, a Ana fica com «link ja nao e valido»')
        ok(not erros, 'sem erros na pagina %s' % erros[:2])
        nav.close()
except Exception:
    import traceback
    traceback.print_exc()
    falhas += 1
finally:
    subprocess.run(['taskkill', '/F', '/T', '/PID', str(proc.pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print('\nfalhas: %d' % falhas)
sys.exit(1 if falhas else 0)
