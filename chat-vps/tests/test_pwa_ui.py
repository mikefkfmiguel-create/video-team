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
        # a regie num telemovel normal: a caixa de texto tem espaco para «Escreve uma mensagem» numa linha (Fixar e camara sao so icones)
        t390 = nav.new_context(viewport={'width': 390, 'height': 780}, has_touch=True, is_mobile=True, device_scale_factor=2)
        r390 = t390.new_page()
        r390.goto(B + '/chat/#' + c['dono']['token'])
        r390.wait_for_selector('#app:not([hidden])', timeout=15000)
        cx = r390.evaluate("""(() => { const t = document.getElementById('texto'); const b = t.getBoundingClientRect();
          const c = document.createElement('canvas').getContext('2d'); const cs = getComputedStyle(t); c.font = cs.fontSize + ' ' + cs.fontFamily;
          return { w: b.width, h: b.height, txt: c.measureText(t.placeholder).width, pad: parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) }; })()""")
        ok(cx['h'] <= 48 and cx['w'] - cx['pad'] >= cx['txt'], 'no telemovel a caixa mostra o texto de ajuda numa so linha (caixa %dpx, texto %dpx)' % (cx['w'] - cx['pad'], cx['txt']))
        if SHOT:
            r390.screenshot(path=os.path.join(SHOT, 'pwa-regie-telemovel.png'))
        t390.close()

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

        # ---- definicoes das notificacoes (toque, vibracao, lembretes, silencio, teste)
        def prefs_servidor():
            r = urllib.request.Request(B + '/chat/api/prefs', headers={'X-Chat': tok['1']})
            return json.loads(urllib.request.urlopen(r).read())
        ok(ana.is_visible('#btDefs'), 'botao das definicoes de notificacao visivel')
        ana.click('#btDefs')
        ana.wait_for_selector('#defs:not([hidden])', timeout=5000)
        ana.wait_for_function("document.getElementById('dfToque').options.length === 6", timeout=5000)
        ok(ana.evaluate("document.getElementById('dfVibra').options.length === 4 && document.getElementById('dfInsiste').options.length === 4 && document.getElementById('dfSilIni').options.length === 25"), 'as listas (toques, vibracoes, lembretes, horas) estao preenchidas')
        ok(ana.input_value('#dfToque') == 'campainha' and ana.input_value('#dfInsiste') == '5', 'valores por omissao')
        ana.select_option('#dfToque', 'sirene')
        ana.select_option('#dfVibra', 'sos')
        ana.select_option('#dfInsiste', '10')
        ana.select_option('#dfSilIni', '22')
        ana.select_option('#dfSilFim', '7')
        for _ in range(30):
            pf = prefs_servidor()
            if pf['toque'] == 'sirene' and pf['vibra'] == 'sos' and pf['insiste'] == 10 and pf['silencio_ini'] == 22 and pf['silencio_fim'] == 7:
                break
            time.sleep(0.2)
        ok(pf['toque'] == 'sirene' and pf['vibra'] == 'sos' and pf['insiste'] == 10 and (pf['silencio_ini'], pf['silencio_fim']) == (22, 7), 'as escolhas ficam guardadas no servidor (valem em qualquer aparelho)')
        ana.click('#dfOuvir')
        ana.click('#dfSentir')
        ana.click('#dfTeste')
        ana.wait_for_function("document.getElementById('dfMsg').textContent.length > 0 && document.getElementById('dfMsg').textContent !== 'A enviar…'", timeout=15000)
        ok('Enviada' in ana.inner_text('#dfMsg') or 'não aceitou' in ana.inner_text('#dfMsg'), 'testar notificacao responde na pagina: %s' % ana.inner_text('#dfMsg'))
        ana.reload()
        ana.wait_for_selector('#app:not([hidden])', timeout=8000)
        ana.click('#btDefs')
        ana.wait_for_function("document.getElementById('dfToque').value === 'sirene'", timeout=5000)
        ok(ana.input_value('#dfInsiste') == '10', 'ao reabrir o chat as escolhas continuam la')
        ana.click('#fechaDefs')
        ok(ana.evaluate("document.getElementById('defs').hidden"), 'fechar o painel das definicoes')
        ana.select_option  # (so para o leitor: o painel fecha e a conversa continua)
        ok(ana.evaluate("typeof window.AudioContext !== 'undefined'"), 'o navegador deixa tocar o toque dentro da pagina')

        # ---- notificacoes bloqueadas no navegador: a pagina explica em vez de um alert() seco
        bloq = pc.new_page()
        dialogos = []
        bloq.on('dialog', lambda d: (dialogos.append(d.message), d.dismiss()))
        bloq.goto(B + '/chat/#' + tok['2'])
        bloq.wait_for_selector('#app:not([hidden])', timeout=8000)
        bloq.wait_for_function("!document.getElementById('btSino').hidden", timeout=8000)
        ok(bloq.evaluate("Notification.permission") != 'granted', 'ponto de partida: o navegador nao deu permissao')
        bloq.click('#btSino')
        bloq.wait_for_function("!document.getElementById('dica').hidden && /bloqueadas|Partilhar/.test(document.getElementById('dicaTxt').textContent)", timeout=8000)
        ok('Permissões' in bloq.inner_text('#dicaTxt') and bloq.is_visible('#dicaSim') and 'Já permiti' in bloq.inner_text('#dicaSim') and not dialogos, 'bloqueadas: a faixa diz o caminho (Permissoes > Notificacoes > Permitir) e tem «Ja permiti», sem alert()')
        bloq.click('#dicaSim')
        bloq.wait_for_function("/Ainda estão bloqueadas/.test(document.getElementById('dicaTxt').textContent)", timeout=8000)
        ok(True, 'se continua bloqueado, «Ja permiti» diz que ainda esta bloqueado')
        bloq.close()

        # ---- conversa
        ana.fill('#texto', 'Chego às 8h, entrada B https://exemplo.pt/mapa')
        ana.click('#enviar')
        ana.wait_for_selector('.linha.eu .bal:not(.pend)', timeout=8000)
        ok(ana.evaluate("document.getElementById('texto').getBoundingClientRect().height") <= 50, 'depois de enviar, a caixa de escrever volta a ter uma linha (nao fica gigante por causa do texto de ajuda)')
        regie.wait_for_selector('.linha:not(.eu) .txt', timeout=8000)
        ok('Chego às 8h' in regie.inner_text('#lista') and regie.locator(".txt a[href='https://exemplo.pt/mapa']").count() == 1, 'a regie ve a mensagem em tempo real, com o link clicavel')
        # a escrever: pin e camara desaparecem e a caixa fica larga; texto comprido: ecra inteiro com o mesmo texto
        ok(ana.is_visible('#camara'), 'antes de escrever a camara esta visivel')
        ana.click('#texto')
        ok(ana.is_hidden('#camara') and ana.is_hidden('#modoAviso') and ana.is_visible('#enviar'), 'ao tocar para escrever, camara e pin desaparecem e fica so a caixa e o botao de enviar')
        ana.press('#texto', 'Tab')
        ok(ana.is_visible('#camara'), 'sem texto e fora da caixa, a camara volta')
        ana.click('#texto')
        ana.fill('#texto', chr(10).join('linha %d do relatorio do palco' % i for i in range(1, 13)))
        ana.wait_for_selector('#editor:not([hidden])', timeout=5000)
        ok(True, 'com texto comprido o ecra inteiro abre sozinho')
        ana.click('#edFecha')
        ana.wait_for_selector('#expandir:not([hidden])', timeout=5000)
        ok(ana.is_hidden('#editor') and ana.input_value('#texto').startswith('linha 1 do relatorio'), 'voltar com «←» fecha-o, guarda o texto e deixa o botao ⤢ (nao volta a saltar)')
        ana.fill('#texto', ana.input_value('#texto') + ' mais um bocado')
        ok(ana.is_hidden('#editor'), 'continuar a escrever na caixa pequena nao reabre o ecra inteiro')
        ana.click('#expandir')
        ana.wait_for_selector('#editor:not([hidden])', timeout=5000)
        ok(ana.input_value('#textoGrande').startswith('linha 1 do relatorio') and 'linha 12' in ana.input_value('#textoGrande') and ana.inner_text('#edConta').endswith('/ 2000') and int(ana.inner_text('#edConta').split()[0]) > 300, 'o ecra inteiro abre com o mesmo texto desde o inicio e conta os caracteres')
        ana.focus('#textoGrande')
        ana.keyboard.press('Control+End')
        ana.keyboard.type(' FIM')
        ana.click('#edEnviar')
        regie.wait_for_function("document.getElementById('lista').innerText.includes('linha 12 do relatorio do palco mais um bocado FIM')", timeout=8000)
        ok(ana.is_hidden('#editor') and ana.input_value('#texto') == '' and ana.is_hidden('#expandir'), 'enviar a partir do ecra inteiro: a regie recebe o texto todo e a caixa fica vazia')
        regie.fill('#texto', '<img src=x onerror=alert(1)> ok')
        regie.press('#texto', 'Enter')
        rui.wait_for_function("document.getElementById('lista').innerText.includes('onerror')", timeout=8000)
        ok(rui.locator('#lista img').count() == 0, 'HTML numa mensagem aparece como texto')
        regie.click('#modoAviso')
        regie.wait_for_selector('#editor.fixa:not([hidden])', timeout=5000)
        ok('fixa' in regie.inner_text('#edTit') and regie.get_attribute('#textoGrande', 'placeholder').startswith('Esta mensagem fica fixa'), 'o pin abre o espaco de escrita proprio das mensagens fixas (amarelo)')
        regie.fill('#textoGrande', 'Chegada às 7h, entrada B')
        regie.click('#edEnviar')
        ana.wait_for_selector('#fixas:not([hidden])', timeout=8000)
        ok('Chegada às 7h' in ana.inner_text('#fixas'), 'o aviso da regie fica fixo no topo')
        regie.locator('.linha:not(.eu) .bal').first.click(position={'x': 8, 'y': 6})
        regie.once('dialog', lambda d: d.accept())
        regie.click(".acoes button:has-text('Apagar')")
        ana.wait_for_function("!document.getElementById('lista').innerText.includes('Chego às 8h')", timeout=8000)
        ok(True, 'a regie apaga a mensagem da Ana e some do telemovel dela')
        # mensagem com link: o botao ⋯ da regie abre as opcoes sem tocar no link
        ana.fill('#texto', 'Escala: https://exemplo.pt/escala?p=abc')
        ana.click('#enviar')
        regie.wait_for_function("document.getElementById('lista').innerText.includes('Escala: https')", timeout=8000)
        bal_link = regie.locator('.linha:not(.eu) .bal', has_text='Escala: https')
        bal_link.locator('.mn').click()
        ok(bal_link.locator('.acoes').count() == 1, 'o botao ⋯ abre «Fixar/Apagar» numa mensagem com link (sem tocar no link)')
        regie.once('dialog', lambda d: d.accept())
        bal_link.locator(".acoes button:has-text('Apagar')").click()
        ana.wait_for_function("!document.getElementById('lista').innerText.includes('Escala: https')", timeout=8000)
        ok(True, 'apagada: some da conversa de todos')
        ok(ana.locator('.mn').count() == 0, 'quem nao e regie nao tem o botao ⋯')
        # ---- fotos: o telemovel reduz a imagem antes de enviar
        import struct
        import zlib

        def png(w, h):
            def chunk(t, d):
                return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
            linha = b'\x00' + bytes([200, 60, 40]) * w
            return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(linha * h)) + chunk(b'IEND', b'')
        foto_png = os.path.join(pasta, 'grande.png')
        open(foto_png, 'wb').write(png(3200, 2400))
        ok(ana.is_visible('#camara'), 'a Ana tem o botao da camara')
        ana.fill('#texto', 'Cabo partido no palco')
        ana.set_input_files('#ficheiroFoto', foto_png)
        ana.wait_for_selector('.linha.eu .foto img', timeout=15000)
        regie.wait_for_selector('.linha:not(.eu) .foto img', timeout=15000)
        regie.wait_for_function("(() => { const i = document.querySelector('.foto img'); return i && i.complete && i.naturalWidth > 0; })()", timeout=10000)
        ok('Cabo partido' in regie.inner_text('#lista'), 'a regie ve a foto (miniatura) e a legenda em tempo real')
        con2 = sqlite3.connect(os.path.join(pasta, 'chat.db'))
        fb = con2.execute('SELECT foto_bytes, foto_w, foto_h FROM msg WHERE foto IS NOT NULL').fetchone()
        ok(fb and fb[1] == 1600 and fb[2] == 1200 and fb[0] < 400_000, 'a foto de 3200x2400 foi reduzida no telemovel para 1600x1200 e pesa %s KB (com miniatura)' % (fb and fb[0] // 1024))
        regie.locator('.foto').first.click()
        regie.wait_for_selector('#grande:not([hidden])', timeout=5000)
        regie.wait_for_function("(() => { const i = document.getElementById('grandeImg'); return i.complete && i.naturalWidth === 1600; })()", timeout=10000)
        ok(True, 'tocar na foto abre-a grande (1600 px)')
        regie.click('#fechaGrande')
        ok(regie.is_hidden('#grande'), 'e fecha')
        admin('/chat/api/admin/tipo', {'key': KEY, 'id': '2', 'tipo': 'leitura'})
        rui.wait_for_function("document.getElementById('camara').hidden", timeout=8000)
        ok(rui.is_hidden('#camara') and rui.is_disabled('#texto'), 'quem passa a «so leitura» perde o botao da camara em direto')
        admin('/chat/api/admin/tipo', {'key': KEY, 'id': '2', 'tipo': 'participante'})
        rui.wait_for_function("!document.getElementById('camara').hidden", timeout=8000)
        ana.click('#btPessoas')
        ok(ana.locator('#pessoas .pessoa').count() == 3, 'lista de pessoas')
        if SHOT:
            ana.screenshot(path=os.path.join(SHOT, 'pwa-pessoas.png'))
        ana.click('#fechaFolha')
        if SHOT:
            ana.screenshot(path=os.path.join(SHOT, 'pwa-telemovel.png'))
            regie.screenshot(path=os.path.join(SHOT, 'pwa-computador.png'))

        # ---- link geral: escolher o nome numa lista (aparelho novo, sem link pessoal)
        tok3 = {m['id']: m['token'] for m in admin('/chat/api/admin/criar', {'key': KEY, 'label': 'Portugal Digital Summit', 'membros': [{'id': '1', 'name': 'Ana Silva'}, {'id': '2', 'name': 'Rui Costa'}, {'id': '3', 'name': 'Marta Lopes'}]})['membros']}
        cv = admin('/chat/api/admin/convite', {'key': KEY})['convite']['token']
        novo = nav.new_context(viewport={'width': 390, 'height': 780}, has_touch=True, is_mobile=True)
        pg_c = novo.new_page()
        pg_c.goto(B + '/chat/#c=' + cv)
        pg_c.wait_for_selector('#cvLista .nome', timeout=10000)
        ok('Portugal Digital Summit' in pg_c.inner_text('#conviteCol') and pg_c.locator('#cvLista .nome').count() == 3, 'o link geral mostra o evento e a lista de nomes')
        ok(pg_c.locator('#cvLista .nome[disabled]').count() == 2 and 'já entrou' in pg_c.inner_text('#cvLista'), 'quem ja abriu o seu link pessoal (Ana, Rui) aparece como «ja entrou»')
        pg_c.fill('#cvBusca', 'mar')
        ok(pg_c.locator('#cvLista .nome').count() == 1, 'procurar o nome filtra a lista')
        pg_c.click('#cvLista .nome:not([disabled])')
        ok('És mesmo Marta Lopes' in pg_c.inner_text('#conviteCol'), 'pede confirmacao antes de entrar')
        pg_c.click('#cvNao')
        pg_c.fill('#cvBusca', 'mar')
        pg_c.click('#cvLista .nome:not([disabled])')
        pg_c.click('#cvSim')
        pg_c.wait_for_selector('#app:not([hidden])', timeout=15000)
        ok(pg_c.inner_text('#evento') == 'Portugal Digital Summit' and '#' not in pg_c.evaluate('location.href'), 'escolhido o nome, entra direto no chat (e o # sai do endereco)')
        pg_c.reload()
        pg_c.wait_for_selector('#app:not([hidden])', timeout=15000)
        ok(True, 'ao reabrir (ou pelo atalho) continua la, sem escolher outra vez')
        pg_c.goto(B + '/chat/#c=' + cv)
        pg_c.wait_for_selector('#app:not([hidden])', timeout=15000)
        ok(True, 'abrir o link geral de novo no mesmo aparelho: entra direto (ja e a Marta)')
        outro = nav.new_context(viewport={'width': 390, 'height': 780}, has_touch=True, is_mobile=True)
        pg_o = outro.new_page()
        pg_o.goto(B + '/chat/#c=' + cv)
        pg_o.wait_for_selector('#cvLista .nome', timeout=10000)
        ok(pg_o.locator('#cvLista .nome[disabled]').count() == 3, 'noutro aparelho o nome da Marta ja aparece ocupado (os tres)')
        novo.close()
        outro.close()
        pg_f = nav.new_context().new_page()
        pg_f.goto(B + '/chat/#c=' + 'f' * 40)
        pg_f.wait_for_function("document.getElementById('conviteCol').innerText.includes('já não é válido')", timeout=8000)
        ok(True, 'um link geral falso ou desativado diz que ja nao e valido')

        # ---- papeis: o dono acrescenta pessoas de fora, faz gestora a Marta, e a gestora acrescenta alguem so de leitura
        regie.goto(B + '/chat/#' + c['dono']['token'])      # (as paginas do mesmo contexto partilham o token guardado: entra-se outra vez com o da regie)
        regie.wait_for_selector('#app:not([hidden])', timeout=15000)
        regie.click('#btPessoas')
        regie.wait_for_selector('#gxNome', timeout=8000)
        ok(regie.is_visible('#gestaoBox') and regie.locator('#gxTipo option').count() == 3, 'o dono ve «Adicionar pessoa de fora» com os tres tipos (participante, so leitura, gestor)')
        regie.fill('#gxNome', 'Cliente  Externo')
        regie.click('#gxAdd')
        regie.wait_for_selector('#gxCopia', timeout=8000)
        link_ext = regie.inner_text('#gxRes .lk').strip()
        ok('/chat/#' in link_ext and 'Cliente Externo' in regie.inner_text('#gxRes'), 'acrescentada: mostra o link dela e os botoes de copiar / WhatsApp')
        ok(regie.get_attribute('#gxRes a', 'href').startswith('https://wa.me/?text='), 'com botao «Enviar por WhatsApp»')
        ok('de fora' in regie.inner_text('#pessoas') and regie.locator('#pessoas .pessoa', has_text='Cliente Externo').locator('select').count() == 1, 'na lista aparece «de fora» e o dono pode mudar-lhe o tipo')
        pg_ext = nav.new_context(viewport={'width': 390, 'height': 780}, has_touch=True, is_mobile=True).new_page()
        pg_ext.goto(link_ext)
        pg_ext.wait_for_selector('#app:not([hidden])', timeout=15000)
        pg_ext.fill('#texto', 'Boa tarde')
        pg_ext.click('#enviar')
        regie.click('#fechaFolha')
        regie.wait_for_function("document.getElementById('lista').innerText.includes('Boa tarde')", timeout=8000)
        ok(not pg_ext.is_visible('#modoAviso') and pg_ext.locator('.mn').count() == 0, 'a pessoa de fora entra como participante: escreve, mas nao tem Aviso nem ⋯')

        # o dono faz da Marta gestora
        regie.click('#btPessoas')
        regie.locator('#pessoas .pessoa', has_text='Marta Lopes').locator('select').select_option('gestor')
        marta = nav.new_context(viewport={'width': 390, 'height': 780}, has_touch=True, is_mobile=True).new_page()
        marta.goto(B + '/chat/#' + tok3['3'])
        marta.wait_for_selector('#app:not([hidden])', timeout=15000)
        marta.wait_for_function("!document.getElementById('modoAviso').hidden", timeout=8000)
        ok(True, 'a Marta, agora gestora, passa a ter o botao «Aviso»')
        marta.click('#btPessoas')
        marta.wait_for_selector('#gxNome', timeout=8000)
        ok(marta.locator('#gxTipo option').count() == 2 and marta.locator('#pessoas select').count() == 0, 'a gestora acrescenta pessoas mas NAO tem «Gestor» nem muda tipos')
        marta.fill('#gxNome', 'Observador')
        marta.select_option('#gxTipo', 'leitura')
        marta.click('#gxAdd')
        marta.wait_for_selector('#gxCopia', timeout=8000)
        link_ro = marta.inner_text('#gxRes .lk').strip()
        ok('/chat/#' in link_ro, 'a gestora acrescenta uma pessoa so de leitura e recebe o link')
        ro = nav.new_context(viewport={'width': 390, 'height': 780}, has_touch=True, is_mobile=True).new_page()
        ro.goto(link_ro)
        ro.wait_for_selector('#app:not([hidden])', timeout=15000)
        ro.wait_for_function("document.getElementById('texto').disabled", timeout=8000)
        ok(ro.get_attribute('#texto', 'placeholder') == 'Só podes ler este chat' and not ro.is_visible('#enviar') and not ro.is_visible('#modoAviso'), 'so leitura: a caixa fica bloqueada («Só podes ler este chat») e sem botao de enviar')
        ok('Boa tarde' in ro.inner_text('#lista'), '...mas le a conversa toda')
        marta.click('#fechaFolha')
        # o dono passa o Observador a participante: desbloqueia na hora, sem recarregar
        regie.locator('#pessoas .pessoa', has_text='Observador').locator('select').select_option('participante')
        ro.wait_for_function("!document.getElementById('texto').disabled", timeout=8000)
        ok(True, 'o dono muda-o para participante e a caixa desbloqueia no aparelho dele, sem recarregar')
        regie.locator('#pessoas .pessoa', has_text='Observador').locator('select').select_option('leitura')
        ro.wait_for_function("document.getElementById('texto').disabled", timeout=8000)
        # a gestora retira uma pessoa de fora; o dono retira qualquer uma
        marta.click('#btPessoas')
        marta.once('dialog', lambda d: d.accept())
        marta.locator('#pessoas .pessoa', has_text='Observador').get_by_role('button', name='Retirar').click()
        ro.wait_for_function("document.getElementById('cTit').textContent.includes('já não é válido')", timeout=10000)
        ok(True, 'a gestora retira a pessoa de fora: o link dela deixa de valer na hora')
        ok(marta.locator('#pessoas .pessoa', has_text='Rui Costa').get_by_role('button', name='Retirar').count() == 0, 'a gestora nao tem «Retirar» nas pessoas da escala (so o dono)')
        ana3 = nav.new_context(viewport={'width': 390, 'height': 780}, has_touch=True, is_mobile=True).new_page()
        ana3.goto(B + '/chat/#' + tok3['1'])
        ana3.wait_for_selector('#app:not([hidden])', timeout=15000)
        ana3.click('#btPessoas')
        ok(not ana3.is_visible('#gestaoBox') and ana3.locator('#pessoas select').count() == 0, 'um participante normal nao ve nenhuma gestao')

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
        ok(ana.evaluate("document.getElementById('lista').children.length === 0 && document.getElementById('app').hidden && !localStorage.getItem('vt.chat.k')"), 'e nao fica nada da conversa no ecra nem o link guardado no aparelho')
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
