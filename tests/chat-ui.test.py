# -*- coding: utf-8 -*-
"""docs/chat.html contra o Worker REAL em `wrangler dev --local` (porta 8787): telemovel (Ana) + computador (regie).
Nada de producao. Uso: python tests/chat-ui.test.py [pasta para capturas]"""
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

from playwright.sync_api import sync_playwright

AQUI = os.path.dirname(os.path.abspath(__file__))
WORKER = os.path.join(AQUI, "..", "worker")
WR = next(p for p in (os.path.join(WORKER, "node_modules", "wrangler", "bin", "wrangler.js"),
                       os.path.join(AQUI, "..", "..", "FOTOWALL", "worker", "node_modules", "wrangler", "bin", "wrangler.js")) if os.path.exists(p))
PORTA, PAG = 8787, 5701
API = "http://127.0.0.1:%d" % PORTA
ORIGEM = "http://127.0.0.1:%d" % PAG
SHOT = sys.argv[1] if len(sys.argv) > 1 else None
KEY = "os:900:Portugal Digital Summit"
falhas = 0


def ok(c, n):
    global falhas
    print(("OK    " if c else "FALHA ") + n, flush=True)
    if not c:
        falhas += 1


def admin(caminho, corpo=None):
    r = urllib.request.Request(API + caminho, data=json.dumps(corpo).encode() if corpo is not None else None, method="POST" if corpo is not None else "GET",
                               headers={"X-PIN": "dono-teste", "Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(r).read())


proc = subprocess.Popen(["node", WR, "dev", "--local", "--port", str(PORTA), "--persist-to", tempfile.mkdtemp(prefix="vt_chatui_"), "--var", "VT_PIN_ADMIN:dono-teste",
                         "--var", "ALLOWED_ORIGINS:" + ORIGEM], cwd=WORKER, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(120):
        try:
            urllib.request.urlopen(API + "/api/ping", timeout=2).read()
            break
        except urllib.error.HTTPError:
            break                       # o servidor respondeu (401 sem PIN): esta de pe
        except Exception:
            time.sleep(1)
    c = admin("/api/admin/chat/criar", {"key": KEY, "label": "Portugal Digital Summit", "ate": "2099-10-22",
                                          "membros": [{"id": "1", "name": "Ana Silva", "grupo": "Vídeo"}, {"id": "2", "name": "Rui Costa", "grupo": "Vídeo"}], "donoNome": "Mike (Régie)"})
    tok = {m["id"]: m["token"] for m in c["membros"]}
    html = open(os.path.join(AQUI, "..", "docs", "chat.html"), "rb").read()
    manifest = open(os.path.join(AQUI, "..", "docs", "manifest-chat.json"), "rb").read()

    def rota(page):
        def h(route):
            u = route.request.url
            if u.endswith("manifest-chat.json"):
                route.fulfill(status=200, body=manifest, content_type="application/json")
            elif "/chat.html" in u:
                route.fulfill(status=200, body=html, content_type="text/html; charset=utf-8")
            else:
                route.fulfill(status=404, body="")
        page.route(ORIGEM + "/**", h)

    with sync_playwright() as p:
        nav = p.chromium.launch(channel="msedge", headless=True, args=["--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets,PrivateNetworkAccessSendPreflights,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessForWorkers"])  # so o teste: pagina e Worker sao ambos loopback
        tel = nav.new_context(viewport={"width": 390, "height": 780}, has_touch=True, is_mobile=True, device_scale_factor=2)
        pc = nav.new_context(viewport={"width": 1100, "height": 760})
        ana, regie, rui = tel.new_page(), pc.new_page(), pc.new_page()
        erros = []
        for pg in (ana, regie, rui):
            pg.on("pageerror", lambda e: erros.append(str(e)))
            rota(pg)

        # --- sem link / link falso
        sem = pc.new_page()
        sem.on("console", lambda m: print("   [console]", m.text))
        sem.on("requestfailed", lambda r: print("   [falhou]", r.url, r.failure))
        rota(sem)
        sem.goto(ORIGEM + "/chat.html?api=" + API)
        ok("Falta o teu link" in sem.inner_text("body"), "sem link: diz que falta o link pessoal")
        sem.goto(ORIGEM + "/chat.html?api=" + API + "#" + "a" * 40)
        sem.wait_for_function("document.getElementById('cTit').textContent.includes('já não é válido')", timeout=10000)
        ok(True, "um link falso mostra «Este link já não é válido»")
        sem.close()

        # --- entrar
        ana.goto(ORIGEM + "/chat.html?api=%s&hb=1000#%s" % (API, tok["1"]))
        ana.wait_for_selector("#app:not([hidden])", timeout=15000)
        ok(ana.inner_text("#evento") == "Portugal Digital Summit" and "Chat" in ana.title(), "a Ana entra: titulo com o nome do evento (%s)" % ana.title())
        ok("Escreve a primeira" in ana.inner_text("#lista"), "sala vazia: convida a escrever a primeira mensagem")
        ok("#" not in ana.evaluate("location.href"), "o token sai do endereco depois de entrar")
        regie.goto(ORIGEM + "/chat.html?api=%s#%s" % (API, c["dono"]["token"]))
        regie.wait_for_selector("#app:not([hidden])", timeout=15000)
        rui.goto(ORIGEM + "/chat.html?api=%s#%s" % (API, tok["2"]))
        rui.wait_for_selector("#app:not([hidden])", timeout=15000)
        ok(regie.is_visible("#modoAviso") and not ana.is_visible("#modoAviso"), "so a regie tem o botao «Aviso»")
        ana.wait_for_function("document.getElementById('subTxt').textContent.includes('3 online')", timeout=10000)
        ok(True, "a Ana ve «3 online · 3 pessoas» (%s)" % ana.inner_text("#subTxt"))

        # --- conversa
        ana.fill("#texto", "Chego às 8h, entrada B https://exemplo.pt/mapa")
        ana.click("#enviar")
        ana.wait_for_selector(".linha.eu .bal:not(.pend)", timeout=8000)
        ok(ana.locator(".linha.eu").count() == 1, "a mensagem da Ana aparece do lado dela, confirmada")
        regie.wait_for_selector(".linha:not(.eu) .txt", timeout=8000)
        ok("Chego às 8h" in regie.inner_text("#lista") and "Ana Silva" in regie.inner_text("#lista"), "a regie ve-a em tempo real, com o nome da Ana")
        ok(regie.locator(".txt a[href='https://exemplo.pt/mapa']").count() == 1, "o link na mensagem e clicavel")
        regie.fill("#texto", "<img src=x onerror=alert(1)> ok")
        regie.press("#texto", "Enter")
        rui.wait_for_function("document.getElementById('lista').innerText.includes('onerror')", timeout=8000)
        ok(rui.locator("#lista img").count() == 0, "HTML numa mensagem aparece como texto (nada e executado)")
        ok(regie.locator("#texto").input_value() == "", "Enter envia e limpa a caixa")

        # --- aviso fixo
        regie.click("#modoAviso")
        regie.fill("#texto", "Chegada às 7h, entrada B")
        regie.click("#enviar")
        ana.wait_for_selector("#fixas:not([hidden])", timeout=8000)
        ok("Chegada às 7h" in ana.inner_text("#fixas"), "o aviso da regie fica fixo no topo do chat da Ana")
        ok(regie.get_attribute("#modoAviso", "aria-pressed") == "false", "o botao «Aviso» desliga depois de enviar")

        # --- apagar (regie)
        regie.locator(".linha:not(.eu) .bal").first.click(position={"x": 8, "y": 6})
        regie.once("dialog", lambda d: d.accept())
        regie.click(".acoes button:has-text('Apagar')")
        ana.wait_for_function("!document.getElementById('lista').innerText.includes('Chego às 8h')", timeout=8000)
        ok(True, "a regie apaga a mensagem da Ana e some do telemovel dela")

        # --- pessoas
        ana.click("#btPessoas")
        ok(ana.locator("#pessoas .pessoa").count() == 3 and "tu" in ana.inner_text("#pessoas"), "a lista de pessoas mostra os 3 e quem es tu")
        if SHOT:
            ana.screenshot(path=os.path.join(SHOT, "chat-pessoas-telemovel.png"))
        ana.click("#fechaFolha")
        if SHOT:
            ana.screenshot(path=os.path.join(SHOT, "chat-telemovel.png"))
            regie.screenshot(path=os.path.join(SHOT, "chat-computador.png"))

        # --- sem rede e a voltar
        tel.set_offline(True)
        ana.wait_for_function("!document.getElementById('estado').hidden", timeout=30000)
        ok("Sem ligação" in ana.inner_text("#estado"), "sem rede: o aviso «Sem ligação» aparece")
        tel.set_offline(False)
        regie.fill("#texto", "voltaste?")
        regie.press("#texto", "Enter")
        ana.wait_for_function("document.getElementById('lista').innerText.includes('voltaste?')", timeout=40000)
        ok(True, "a rede volta e a Ana apanha o que perdeu")

        # --- retirada
        admin("/api/admin/chat/remover", {"key": KEY, "id": "1"})
        ana.wait_for_function("document.getElementById('cTit').textContent.includes('já não é válido')", timeout=30000)
        ok(True, "retirada da sala, a Ana fica com «link ja nao e valido»")
        ok(not erros, "sem erros na pagina %s" % erros[:2])
        nav.close()
except Exception as e:
    import traceback
    traceback.print_exc()
    falhas += 1
finally:
    subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print("\nfalhas: %d" % falhas)
sys.exit(1 if falhas else 0)
