# -*- coding: utf-8 -*-
"""shared/chat.js (o ecra do dono para criar o chat e enviar os links) contra o Worker REAL em `wrangler dev --local` (porta 8789).
Pagina minima com so o modulo; nada de producao e o 7Eventos nunca e contactado. Uso: python tests/chat-admin-ui.test.py [pasta para capturas]"""
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

from playwright.sync_api import sync_playwright

AQUI = os.path.dirname(os.path.abspath(__file__))
WORKER = os.path.join(AQUI, "..", "worker")
WR = next(p for p in (os.path.join(WORKER, "node_modules", "wrangler", "bin", "wrangler.js"),
                       os.path.join(AQUI, "..", "..", "FOTOWALL", "worker", "node_modules", "wrangler", "bin", "wrangler.js")) if os.path.exists(p))
PORTA, PAG = 8789, 5702
API = "http://127.0.0.1:%d" % PORTA
ORIGEM = "http://127.0.0.1:%d" % PAG
SHOT = sys.argv[1] if len(sys.argv) > 1 else None
SIG = "os:900:Portugal Digital Summit"
falhas = 0

CSV = "\r\n".join([
    "First Name,Middle Name,Last Name,E-mail 1 - Value,Phone 1 - Label,Phone 1 - Value",
    "Ana,,Silva,ana@x.pt,Mobile,+351 912 345 678",
    "Rui,,Costa,,Mobile,967 000 111",
    "Rui,,Costa,,Mobile,968 222 333",
    "Marta,Isabel,Lopes,,Mobile,925 111 222",
    "Amigo,,Qualquer,,Mobile,910 000 000",
])
PAGINA = """<!doctype html><html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>:root{--bg:#f4f6fb;--panel:#fff;--ink:#0C1020;--mut:#5b6478;--line:#e1e6f0;--acc:#2E7BFF;--soft:#eef1f8}body{margin:0;background:var(--bg);color:var(--ink);font:14px system-ui}</style>
</head><body><button id="abre">abrir</button><script src="chat.js"></script>
<script>
var CREW = [
  {id:'1', name:'Ana Silva', grupo:'Técnicos de Vídeo', days:['2026-10-21','2026-10-22'], filtrado:true},
  {id:'2', name:'Rui Costa', grupo:'Técnicos de Vídeo', days:['2026-10-21','2026-10-22'], filtrado:true},
  {id:'3', name:'Marta Lopes', grupo:'Técnicos de Vídeo', days:['2026-10-22'], filtrado:true},
  {id:'4', name:'Hugo Dias', grupo:'Técnicos de Luz', days:['2026-10-21'], filtrado:false}
];
document.getElementById('abre').onclick = function () {
  window.__vtChat.abrir({ api: '%API%', pin: 'dono-teste', sig: '%SIG%', titulo: 'Portugal Digital Summit', filtroTxt: 'Técnicos de Vídeo', crew: CREW });
};
</script></body></html>""".replace("%API%", API).replace("%SIG%", SIG)


def ok(c, n):
    global falhas
    print(("OK    " if c else "FALHA ") + n, flush=True)
    if not c:
        falhas += 1


def chamar(caminho, k=None, pin=None):
    h = {}
    if k:
        h["X-Chat"] = k
    if pin:
        h["X-PIN"] = pin
    try:
        r = urllib.request.urlopen(urllib.request.Request(API + caminho, headers=h))
        return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, None


proc = subprocess.Popen(["node", WR, "dev", "--local", "--port", str(PORTA), "--persist-to", tempfile.mkdtemp(prefix="vt_chatadm_"), "--var", "VT_PIN_ADMIN:dono-teste",
                         "--var", "ALLOWED_ORIGINS:" + ORIGEM], cwd=WORKER, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(120):
        try:
            urllib.request.urlopen(API + "/api/ping", timeout=2).read()
            break
        except urllib.error.HTTPError:
            break
        except Exception:
            time.sleep(1)
    chat_js = open(os.path.join(AQUI, "..", "shared", "chat.js"), "rb").read()
    csv_path = os.path.join(tempfile.mkdtemp(prefix="vt_csv_"), "contacts.csv")
    open(csv_path, "w", encoding="utf-8").write(CSV)

    with sync_playwright() as p:
        nav = p.chromium.launch(channel="msedge", headless=True, args=["--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,BlockInsecurePrivateNetworkRequests"])
        ctx = nav.new_context(viewport={"width": 430, "height": 900}, permissions=["clipboard-read", "clipboard-write"])
        pag = ctx.new_page()
        pag.add_init_script("window.__pick = []; window.__picks = []; navigator.contacts = { select: function (props, opts) { window.__picks.push({props: props, multiple: !!(opts && opts.multiple)}); return Promise.resolve(window.__pick); } };")
        erros = []
        pag.on("pageerror", lambda e: erros.append(str(e)))
        pag.route(ORIGEM + "/**", lambda r: r.fulfill(status=200, body=chat_js if r.request.url.endswith("chat.js") else PAGINA.encode("utf-8"),
                                                       content_type="application/javascript" if r.request.url.endswith("chat.js") else "text/html; charset=utf-8"))
        pag.goto(ORIGEM + "/")
        pag.click("#abre")
        pag.wait_for_selector("#vtch .linha", timeout=15000)
        ok(pag.locator("#vtch .linha").count() == 3 and "Novo chat" in pag.inner_text("#vtch .top"), "novo chat: so as 3 pessoas do filtro do Video Team, todas marcadas")
        ok("Só as 3 pessoas do filtro" in pag.inner_text("#vtch") and "Técnicos de Vídeo" in pag.inner_text("#vtch") and "Hugo" not in pag.inner_text("#vtch"), "diz que e so o filtro e o Hugo (fora do filtro) nao aparece")
        ok(pag.locator("#vtch .tag.aviso").count() == 3, "ainda sem contactos: «sem contacto» em todas")
        pag.click("[data-acao=todos]")
        ok(pag.locator("#vtch .linha").count() == 4 and not pag.locator("#vtch-s4").is_checked(), "«Mostrar toda a equipa»: o Hugo aparece mas desmarcado")
        pag.click("[data-acao=todos]")
        ok(pag.locator("#vtch .linha").count() == 3, "e volta a esconder-se")

        # ---- importar contactos do Google
        pag.set_input_files("#vtch-fich", csv_path)
        pag.wait_for_function("document.getElementById('vtch').innerText.includes('5 contactos importados')", timeout=5000)
        ok(True, "importa o CSV do Google (5 contactos)")
        txt = pag.inner_text("#vtch")
        ok("+351 912 345 678" in txt and "+351 925 111 222" in txt, "a Ana e a Marta ficam com o telemovel certo, casados pelo nome")
        ok(pag.locator("#vtch select[data-acao=cand]").count() == 1, "o Rui tem dois contactos iguais: pede para escolher (nao adivinha)")
        pag.select_option("#vtch select[data-acao=cand]", index=2)
        ok("+351 968 222 333" in pag.inner_text("#vtch"), "escolhida a segunda opcao, o Rui fica com esse numero")
        # contactos do TELEMOVEL (Android): escolher varios de uma vez, ou um por pessoa
        ok(pag.locator("[data-acao=pickVarios]").count() == 1 and pag.locator("#vtch .linha [data-acao=pick]").count() == 3, "no Android aparecem «Escolher contactos no telemóvel» e o icone de contacto por pessoa")
        pag.click("[data-acao=todos]")
        pag.evaluate("window.__pick = [{name: ['Hugo Dias'], tel: ['93 777 66 55'], email: []}, {name: ['Gente Qualquer'], tel: [], email: []}]")
        pag.click("[data-acao=pickVarios]")
        pag.wait_for_function("document.getElementById('vtch').innerText.includes('+351 937 776 655')", timeout=5000)
        picks = pag.evaluate("window.__picks")
        ok(picks[0]["multiple"] is True and set(picks[0]["props"]) == {"name", "tel", "email"}, "pede ao telemovel so nome, telefone e email, varios de uma vez")
        ok("+351 937 776 655" in pag.locator("#vtch .linha", has_text="Hugo Dias").inner_text(), "o Hugo escolhido no telemovel fica com o numero (casado pelo nome)")
        pag.evaluate("window.__pick = [{name: ['Rui C.'], tel: ['+351 969 999 888', '213 000 000'], email: ['rui@x.pt']}]")
        pag.locator("#vtch .linha", has_text="Rui Costa").locator("[data-acao=pick]").click()
        pag.wait_for_function("document.getElementById('vtch').innerText.includes('+351 969 999 888')", timeout=5000)
        ok(pag.evaluate("window.__picks")[1]["multiple"] is False, "o icone de contacto de uma pessoa escolhe um so contacto (mesmo com outro nome na agenda)")
        pag.locator("#vtch .linha", has_text="Hugo Dias").locator("[data-acao=edita]").click()
        pag.fill("#vtch-tel", "12")
        pag.click("[data-acao=gravaContacto]")
        ok("não parece válido" in pag.inner_text("#vtch"), "um telemovel invalido escrito a mao e recusado")
        pag.click("[data-acao=cancelaEdita]")
        pag.check("#vtch-s4")         # o Hugo (fora do filtro) entra porque o dono o marcou
        if SHOT:
            pag.screenshot(path=os.path.join(SHOT, "admin-escolher.png"), full_page=True)

        # ---- desmarcar uma pessoa e criar
        pag.uncheck("#vtch-s3")
        ok("3 pessoas" in pag.inner_text(".rodape"), "desmarcar a Marta: 3 pessoas")
        pag.fill("#vtch-nome", "Mike")
        pag.click("[data-acao=criar]")
        pag.wait_for_selector("#vtch [data-acao=fechar]", timeout=15000)
        ok("Chat criado · 3 pessoas" in pag.inner_text("#vtch .top"), "chat criado com 3 pessoas")
        ok(pag.locator("#vtch .linha").count() == 4, "gerir: a regie + 3 pessoas")

        # ---- links
        wa = pag.locator("#vtch .linha", has_text="Ana Silva").locator("a.wa")
        href = wa.get_attribute("href")
        m = re.match(r"https://wa\.me/351912345678\?text=(.+)$", href or "")
        corpo = urllib.parse.unquote(m.group(1)) if m else ""
        ok(bool(m) and "Olá Ana!" in corpo and "Portugal Digital Summit" in corpo, "WhatsApp da Ana: wa.me com o numero certo e a mensagem escrita (%s)" % corpo[:40].replace("\n", " "))
        mt = re.search(r"/chat\.html#([a-f0-9]{40})", corpo)
        ok(bool(mt), "a mensagem leva o link pessoal (chat.html#token)")
        s, j = chamar("/api/chat/sala", k=mt.group(1)) if mt else (0, None)
        ok(s == 200 and j["eu"]["nome"] == "Ana Silva" and j["evento"] == "Portugal Digital Summit", "esse link abre mesmo o chat como a Ana")
        ok("Olá Hugo!" in urllib.parse.unquote(pag.locator("#vtch .linha", has_text="Hugo Dias").locator("a.wa").get_attribute("href")), "cada pessoa leva o seu nome")
        ok(pag.locator("#vtch .linha", has_text="Hugo Dias").locator("a", has_text="SMS").get_attribute("href").startswith("sms:+351937776655?"), "SMS do Hugo")
        ok(pag.locator("#vtch .linha", has_text="Ana Silva").locator("a", has_text="Email").get_attribute("href").startswith("mailto:ana@x.pt?"), "email da Ana (tem email, o Rui nao)")
        ok(pag.locator("#vtch .linha", has_text="Hugo Dias").locator("a", has_text="Email").count() == 0, "sem email: nao mostra o botao (o Hugo)")
        ok(pag.locator("#vtch .linha", has_text="Rui Costa").locator("a", has_text="Email").get_attribute("href").startswith("mailto:rui@x.pt?"), "o email vindo do telemovel (Rui) tambem funciona")
        dono_href = pag.locator("a", has_text="Abrir o chat").get_attribute("href")
        st, jd = chamar("/api/chat/sala", k=dono_href.split("#")[1])
        ok(st == 200 and jd["eu"]["papel"] == "dono" and jd["eu"]["nome"] == "Mike", "o link da regie entra como dono, com o nome escolhido")

        # ---- marcar enviado (o link abre noutro separador: fecha-se)
        ctx.on("page", lambda np: np.close())
        wa.click()
        pag.wait_for_function("document.querySelector('#vtch').innerText.includes('enviado')", timeout=5000)
        ok("enviado" in pag.locator("#vtch .linha", has_text="Ana Silva").inner_text(), "carregar no WhatsApp marca a Ana como «enviado»")

        # ---- copiar
        pag.locator("#vtch .linha", has_text="Rui Costa").locator("button", has_text="Copiar").click()
        pag.wait_for_function("document.querySelector('#vtch').innerText.includes('Copiado')", timeout=5000)
        copiado = pag.evaluate("navigator.clipboard.readText()")
        ok("Olá Rui!" in copiado and "chat.html#" in copiado, "copiar: mensagem do Rui com o link na area de transferencia")
        if SHOT:
            pag.screenshot(path=os.path.join(SHOT, "admin-gerir.png"), full_page=True)

        # ---- persistencia dos contactos neste aparelho
        pag.reload()
        pag.click("#abre")
        pag.wait_for_selector("#vtch [data-acao=fechar]", timeout=15000)
        ok("+351 912 345 678" in pag.inner_text("#vtch") and "enviado" in pag.inner_text("#vtch"), "ao reabrir: a sala ja existe e os contactos e os «enviado» ficaram guardados")
        ok(pag.evaluate("(localStorage.getItem('vt.gcontatos')||'').includes('912345678')"), "os contactos so estao no localStorage deste aparelho")
        sj = json.dumps(chamar("/api/admin/chat?key=" + urllib.parse.quote(SIG), pin="dono-teste")[1])
        ok("912345678" not in sj and "967000111" not in sj and "969999888" not in sj and "937776655" not in sj and "ana@x.pt" not in sj, "o servidor nunca recebe telefones nem emails")

        # ---- acrescentar pessoa (a Marta) mantendo os links
        antes = chamar("/api/admin/chat?key=" + urllib.parse.quote(SIG), pin="dono-teste")[1]
        tok_ana = [m for m in antes["membros"] if m["id"] == "1"][0]["token"]
        pag.click("[data-acao=maisPessoas]")
        ok(pag.locator("#vtch input[type=checkbox]:checked").count() == 1, "«Acrescentar pessoas»: so a que falta vem marcada")
        pag.click("[data-acao=criar]")
        pag.wait_for_selector("#vtch [data-acao=fechar]", timeout=15000)
        depois = chamar("/api/admin/chat?key=" + urllib.parse.quote(SIG), pin="dono-teste")[1]
        ok(len(depois["membros"]) == 4 and [m for m in depois["membros"] if m["id"] == "1"][0]["token"] == tok_ana, "a Marta entra e o link da Ana (ja enviado) nao muda")

        # ---- retirar e fechar
        pag.once("dialog", lambda d: d.accept())
        pag.locator("#vtch .linha", has_text="Hugo Dias").locator("[data-acao=remover]").click()
        pag.wait_for_function("!document.querySelector('#vtch').innerText.includes('Hugo Dias')", timeout=8000)
        tok_hugo = [m for m in antes["membros"] if m["id"] == "4"][0]["token"]
        ok(chamar("/api/chat/sala", k=tok_hugo)[0] == 401, "retirar o Hugo: o link dele deixa de funcionar")
        pag.once("dialog", lambda d: d.accept())
        pag.click("[data-acao=fechar]")
        pag.wait_for_function("document.querySelector('#vtch').innerText.includes('Criar chat')", timeout=8000)
        ok(chamar("/api/chat/sala", k=tok_ana)[0] == 401 and chamar("/api/chat/sala", k=dono_href.split("#")[1])[0] == 401, "fechar o chat: todos os links deixam de funcionar")
        ok(chamar("/api/admin/chat?key=" + urllib.parse.quote(SIG), pin="dono-teste")[1]["existe"] is False, "e a sala deixa de existir")

        # ---- chave errada
        pag.evaluate("document.getElementById('vtch').remove()")
        pag.evaluate("window.__vtChat.abrir({ api: '%s', pin: 'errada', sig: 'x', titulo: 'x', crew: CREW })" % API)
        pag.wait_for_function("document.getElementById('vtch').innerText.includes('chave')", timeout=8000)
        ok(True, "com a chave errada: avisa que a chave do dono ja nao serve")
        ok(not erros, "sem erros na pagina %s" % erros[:2])
        nav.close()
except Exception:
    import traceback
    traceback.print_exc()
    falhas += 1
finally:
    subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print("\nfalhas: %d" % falhas)
sys.exit(1 if falhas else 0)
