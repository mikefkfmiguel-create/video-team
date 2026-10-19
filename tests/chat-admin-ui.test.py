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
PORTA, PAG, PORTA_CHAT = 8789, 5702, 8794
API = "http://127.0.0.1:%d" % PORTA
CHAT = "http://127.0.0.1:%d" % PORTA_CHAT
SEGREDO = "segredo-so-de-teste"
PY = os.path.join(AQUI, "..", "chat-vps", ".venv", "Scripts", "python.exe")
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
GSI_FALSO = """
window.google = { accounts: { oauth2: {
  initTokenClient: function (o) { return { requestAccessToken: function () {
    window.__gsi = (window.__gsi || []).concat([{ cid: o.client_id, scope: o.scope }]);
    setTimeout(function () { if (window.__gsiNegar) o.error_callback({ type: 'popup_closed' }); else o.callback({ access_token: 'tok-falso' }); }, 10);
  } }; },
  revoke: function (t, cb) { window.__revogado = t; if (cb) cb(); }
} } };
"""
PEOPLE_P1 = {"connections": [
    {"names": [{"displayName": "Ana Silva"}], "phoneNumbers": [{"value": "911 111 111", "canonicalForm": "+351911111111"}], "emailAddresses": [{"value": "ana@google.pt"}]},
    {"names": [{"displayName": "Sem Telefone"}]}], "nextPageToken": "pg2"}
PEOPLE_P2 = {"connections": [
    {"names": [{"displayName": "Marta Lopes"}], "phoneNumbers": [{"value": "+351 922 222 222"}]},
    {"names": [{"displayName": "Rui Costa"}], "phoneNumbers": [{"value": "933 333 333"}]}]}
PAGINA = """<!doctype html><html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>:root{--bg:#f4f6fb;--panel:#fff;--ink:#0C1020;--mut:#5b6478;--line:#e1e6f0;--acc:#2E7BFF;--soft:#eef1f8}body{margin:0;background:var(--bg);color:var(--ink);font:14px system-ui}</style>
</head><body><button id="abre">abrir</button><script src="chat.js"></script>
<script>
var CREW = [
  {id:'1', name:'Ana Silva*_10H', grupo:'Técnicos de Vídeo', days:['2026-10-21','2026-10-22'], filtrado:true},
  {id:'2', name:'Rui Costa', grupo:'Técnicos de Vídeo', days:['2026-10-21','2026-10-22'], filtrado:true},
  {id:'3', name:'Marta Lopes', grupo:'Técnicos de Vídeo', days:['2026-10-22'], filtrado:true},
  {id:'4', name:'Hugo Dias_12H', grupo:'Técnicos de Luz', days:['2026-10-21'], filtrado:false}
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
    base = CHAT if caminho.startswith("/chat/") else API          # membros: servidor do chat; dono: Worker
    try:
        r = urllib.request.urlopen(urllib.request.Request(base + caminho, headers=h))
        return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, None


srv = subprocess.Popen([PY, os.path.join(AQUI, "..", "chat-vps", "server.py")], env=dict(os.environ, VTCHAT_DATA=tempfile.mkdtemp(prefix="vt_chatadm_d_"), VTCHAT_SECRET=SEGREDO, VTCHAT_PORT=str(PORTA_CHAT)),
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
proc = subprocess.Popen(["node", WR, "dev", "--local", "--port", str(PORTA), "--persist-to", tempfile.mkdtemp(prefix="vt_chatadm_"), "--var", "VT_PIN_ADMIN:dono-teste",
                         "--var", "CHAT_URL:" + CHAT, "--var", "CHAT_SECRET:" + SEGREDO, "--var", "ALLOWED_ORIGINS:" + ORIGEM], cwd=WORKER, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(120):
        try:
            urllib.request.urlopen(API + "/api/ping", timeout=2).read()
            break
        except urllib.error.HTTPError:
            break
        except Exception:
            time.sleep(1)
    for _ in range(60):
        try:
            urllib.request.urlopen(CHAT + "/chat/", timeout=2).read()
            break
        except Exception:
            time.sleep(0.5)
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
        pedidos_google = []

        def people(route):
            pedidos_google.append((route.request.url, route.request.headers.get("authorization")))
            route.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"},
                          body=json.dumps(PEOPLE_P2 if "pageToken=pg2" in route.request.url else PEOPLE_P1))
        pag.route("https://accounts.google.com/gsi/client", lambda rt: rt.fulfill(status=200, content_type="text/javascript", body=GSI_FALSO))
        pag.route("https://people.googleapis.com/**", people)
        pag.route(ORIGEM + "/**", lambda r: r.fulfill(status=200, body=chat_js if r.request.url.endswith("chat.js") else PAGINA.encode("utf-8"),
                                                       content_type="application/javascript" if r.request.url.endswith("chat.js") else "text/html; charset=utf-8"))
        pag.goto(ORIGEM + "/")
        pag.click("#abre")
        pag.wait_for_selector("#vtch .linha", timeout=15000)
        ok(pag.locator("#vtch .linha").count() == 3 and "Novo chat" in pag.inner_text("#vtch .top"), "novo chat: so as 3 pessoas do filtro do Video Team, todas marcadas")
        ok("Só as 3 pessoas do filtro" in pag.inner_text("#vtch") and "Técnicos de Vídeo" in pag.inner_text("#vtch") and "Hugo" not in pag.inner_text("#vtch"), "diz que e so o filtro e o Hugo (fora do filtro) nao aparece")
        ok(pag.locator("#vtch .tag.aviso").count() == 3, "ainda sem contactos: «sem contacto» em todas")
        ok("_10H" not in pag.inner_text("#vtch") and "*" not in pag.inner_text("#vtch .nm"), "os sufixos do 7Eventos (_10H, *) nao aparecem nos nomes")
        pag.click("[data-acao=marcaNenhuma]")
        ok(pag.locator("#vtch input[type=checkbox]:checked").count() == 0 and "0 pessoa" in pag.inner_text(".rodape"), "«Desmarcar todas»")
        pag.click("[data-acao=marcaTodas]")
        ok(pag.locator("#vtch input[type=checkbox]:checked").count() == 3, "«Marcar todas» (so as visiveis do filtro)")
        pag.click("[data-acao=todos]")
        ok(pag.locator("#vtch .linha").count() == 4 and not pag.locator("#vtch-s4").is_checked(), "«Mostrar toda a equipa»: o Hugo aparece mas desmarcado")
        pag.click("[data-acao=todos]")
        ok(pag.locator("#vtch .linha").count() == 3, "e volta a esconder-se")

        # ---- importar do Google Contactos (qualquer aparelho): ID de cliente (uma vez) + autorizacao do Google
        pag.click("[data-acao=google]")
        ok("ID de cliente" in pag.inner_text("#vtch") and pag.locator("#vtch-cid").count() == 1, "sem ID de cliente: explica os passos e pede para o colar (uma vez)")
        pag.fill("#vtch-cid", "isto nao e um id")
        pag.click("[data-acao=gravaCid]")
        ok("não parece válido" in pag.inner_text("#vtch"), "um ID de cliente invalido e recusado")
        pag.evaluate("window.__gsiNegar = true")
        pag.fill("#vtch-cid", "123456789-abc_def.apps.googleusercontent.com")
        pag.click("[data-acao=gravaCid]")
        pag.wait_for_function("document.getElementById('vtch').innerText.includes('Fechaste a janela do Google')", timeout=5000)
        ok(True, "se a pessoa fecha a janela do Google: mensagem clara, nada importado")
        pag.evaluate("window.__gsiNegar = false")
        pag.click("[data-acao=google]")
        pag.wait_for_function("document.getElementById('vtch').innerText.includes('3 contactos importados do Google')", timeout=8000)
        gsi = pag.evaluate("window.__gsi")
        ok(gsi[-1]["scope"] == "https://www.googleapis.com/auth/contacts.readonly" and gsi[-1]["cid"].endswith(".apps.googleusercontent.com"), "pede so leitura dos contactos (contacts.readonly)")
        ok(len(pedidos_google) == 2 and all(a == "Bearer tok-falso" for _u, a in pedidos_google) and "phoneNumbers" in pedidos_google[0][0] and "pageToken=pg2" in pedidos_google[1][0], "le as duas paginas do Google, com o token, so nome/telefone/email")
        ok(pag.evaluate("window.__revogado") == "tok-falso", "revoga o acesso logo a seguir (o token nao fica)")
        t = pag.inner_text("#vtch")
        ok("+351 911 111 111" in t and "+351 922 222 222" in t and "+351 933 333 333" in t, "a Ana, a Marta e o Rui ficam com o telemovel do Google (casados pelo nome)")
        ok(pag.evaluate("JSON.parse(localStorage.getItem('vt.google.cid'))") == "123456789-abc_def.apps.googleusercontent.com" and "ID de cliente" not in pag.inner_text("#vtch"), "o ID de cliente fica guardado e a ajuda some")
        ok(not pag.evaluate("(localStorage.getItem('vt.google.cid')||'') + JSON.stringify(Object.keys(localStorage)) ").count("tok-falso"), "o token do Google nunca e guardado")

        # ---- importar contactos do Google (ficheiro)
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
        ok(pag.locator("[data-acao=tipoSel]").count() == 0 and pag.locator("[data-acao=remover]").count() == 0, "por omissao a lista fica limpa: sem seletores de tipo nem «retirar»")
        pag.click("[data-acao=gerirTog]")
        ok(pag.locator("[data-acao=tipoSel]").count() == 3 and pag.locator("[data-acao=remover]").count() == 3, "«Gerir pessoas» mostra o tipo, «libertar» e «retirar» de cada uma")

        # ---- links
        wa = pag.locator("#vtch .linha", has_text="Ana Silva").locator("a.wa")
        href = wa.get_attribute("href")
        m = re.match(r"https://wa\.me/351912345678\?text=(.+)$", href or "")
        corpo = urllib.parse.unquote(m.group(1)) if m else ""
        ok(bool(m) and "Olá Ana!" in corpo and "Portugal Digital Summit" in corpo, "WhatsApp da Ana: wa.me com o numero certo e a mensagem escrita (%s)" % corpo[:40].replace("\n", " "))
        mt = re.search(r"https://things-on\.mike-app\.com/chat/#([a-f0-9]{40})", corpo)
        ok(bool(mt), "a mensagem leva o link pessoal (things-on.mike-app.com/chat/#token)")
        s, j = chamar("/chat/api/sala", k=mt.group(1)) if mt else (0, None)
        ok(s == 200 and j["eu"]["nome"] == "Ana Silva" and j["evento"] == "Portugal Digital Summit", "esse link abre mesmo o chat como a Ana")
        ok("Olá Hugo!" in urllib.parse.unquote(pag.locator("#vtch .linha", has_text="Hugo Dias").locator("a.wa").get_attribute("href")), "cada pessoa leva o seu nome")
        ok(pag.locator("#vtch .linha", has_text="Hugo Dias").locator("a", has_text="SMS").get_attribute("href").startswith("sms:+351937776655?"), "SMS do Hugo")
        ok(pag.locator("#vtch .linha", has_text="Ana Silva").locator("a", has_text="Email").get_attribute("href").startswith("mailto:ana@x.pt?"), "email da Ana (tem email, o Rui nao)")
        ok(pag.locator("#vtch .linha", has_text="Hugo Dias").locator("a", has_text="Email").count() == 0, "sem email: nao mostra o botao (o Hugo)")
        ok(pag.locator("#vtch .linha", has_text="Rui Costa").locator("a", has_text="Email").get_attribute("href").startswith("mailto:rui@x.pt?"), "o email vindo do telemovel (Rui) tambem funciona")
        dono_href = pag.locator("a", has_text="Abrir o chat").get_attribute("href")
        st, jd = chamar("/chat/api/sala", k=dono_href.split("#")[1])
        ok(st == 200 and jd["eu"]["papel"] == "dono" and jd["eu"]["nome"] == "Mike", "o link da regie entra como dono, com o nome escolhido")

        # ---- marcar enviado (o link abre noutro separador: fecha-se)
        ctx.on("page", lambda np: np.close())
        wa.click()
        pag.wait_for_function("document.querySelector('#vtch').innerText.includes('enviado')", timeout=5000)
        ok("enviado" in pag.locator("#vtch .linha", has_text="Ana Silva").inner_text(), "carregar no WhatsApp marca a Ana como «enviado»")

        # ---- «WhatsApp: proxima pessoa»: percorre a lista sem andar a procurar cada uma
        antes = pag.locator("#vtch .tag.ok", has_text="enviado").count()
        ok(pag.locator("[data-acao=todosEnviados]").count() == 1, "ha o botao «Já enviei a todos» para quem recebeu o link e o painel nao sabia")
        pag.click("[data-acao=todosEnviados]")
        ok("Toca outra vez" in pag.inner_text(".rodape"), "pede confirmacao antes de marcar todos como enviados")
        ok("por enviar · próxima:" in pag.inner_text(".rodape") and "Hugo Dias" in pag.inner_text(".rodape"), "o rodape diz quantas faltam e quem e a proxima (a Ana ja foi)")
        pag.click("[data-acao=proxima]")
        pag.wait_for_function("document.querySelectorAll('#vtch .tag.ok').length > %d" % antes, timeout=5000)
        ok("A abrir o WhatsApp de" in pag.inner_text(".rodape"), "carregar abre o WhatsApp da proxima pessoa com a mensagem pronta")
        pag.click("[data-acao=proxima]")
        time.sleep(0.3)
        ok("Todas as que têm telemóvel já foram abertas" in pag.inner_text(".rodape") or "por enviar" in pag.inner_text(".rodape") or "A abrir" in pag.inner_text(".rodape"), "e continua pela lista")
        # aparelho novo / app reinstalada: sem as marcas locais (so o servidor sabe). Desmarca tudo no servidor, recarrega e testa «Já enviei a todos»
        _ids = [m["id"] for m in chamar("/api/admin/chat/?key=" + urllib.parse.quote(SIG), pin="dono-teste")[1]["membros"]]
        _rq = urllib.request.Request(API + "/api/admin/chat/enviado", data=json.dumps({"key": SIG, "ids": _ids, "canal": "wa", "valor": False}).encode(), method="POST", headers={"X-PIN": "dono-teste", "Content-Type": "application/json"})
        urllib.request.urlopen(_rq).read()
        pag.evaluate("localStorage.removeItem('vt.chat.enviados')")
        pag.reload()
        pag.click("#abre")
        pag.wait_for_selector("#vtch [data-acao=todosEnviados]", timeout=15000)
        ok(True, "sem marcas no servidor nem no aparelho, voltam a aparecer pendentes")
        pag.click("[data-acao=todosEnviados]")
        pag.click("[data-acao=todosEnviados]")
        pag.wait_for_function("!document.querySelector('#vtch [data-acao=todosEnviados]')", timeout=8000)
        ok(True, "«Já enviei a todos» (duas vezes): a lista «por enviar» fica vazia")
        pag.evaluate("localStorage.removeItem('vt.chat.enviados')")
        pag.reload()
        pag.click("#abre")
        pag.wait_for_selector("#vtch .linha", timeout=15000)
        ok(not pag.locator("#vtch [data-acao=todosEnviados]").count() and pag.locator("#vtch .tag.ok", has_text="enviado").count() >= 1, "num aparelho sem marcas locais o painel ja sabe quem recebeu o link (vem do servidor)")

        # ---- link geral
        ok("Criar o link geral" in pag.inner_text("#vtch"), "no ecra de gerir: caixa «Link geral» a oferecer criar o link")
        pag.click("[data-acao=convCria]")
        pag.wait_for_selector("[data-acao=convAtiva]", timeout=8000)
        t_cv = pag.inner_text("#vtch")
        m_cv = re.search(r"https://things-on\.mike-app\.com/chat/#c=([a-f0-9]{40})", t_cv)
        ok(bool(m_cv) and "1 de 3 já entraram" in t_cv, "criado: mostra o link geral e «1 de 3 ja entraram» (a Ana ja tinha aberto o link pessoal)")
        ok(pag.locator("a:has-text('Enviar para um grupo no WhatsApp')").get_attribute("href").startswith("https://wa.me/?text="), "botao para enviar o link a um grupo de WhatsApp (abre o WhatsApp para escolheres o grupo)")
        s_c, lst_c = chamar("/chat/api/convite?c=" + m_cv.group(1))
        ok(s_c == 200 and len(lst_c["membros"]) == 3, "o link geral funciona no servidor do chat")
        r_e = urllib.request.Request(CHAT + "/chat/api/convite/entrar", data=json.dumps({"c": m_cv.group(1), "pid": "2"}).encode(), method="POST", headers={"Content-Type": "application/json"})
        urllib.request.urlopen(r_e).read()
        pag.click("[data-acao=convAtiva]")
        pag.wait_for_function("document.getElementById('vtch').innerText.includes('ninguém entra')", timeout=8000)
        ok("2 de 3 já entraram" in pag.inner_text("#vtch") and "ninguém entra" in pag.inner_text("#vtch"), "o Rui escolheu o nome pelo link geral: o dono ve «2 de 3» e pode desativar o link")
        pag.click("[data-acao=convAtiva]")
        pag.wait_for_function("document.getElementById('vtch').innerText.includes('O link está ativo')", timeout=8000)
        if not pag.locator("[data-acao=liberta]").count():
            pag.click("[data-acao=gerirTog]")      # o recarregamento acima fechou o modo «Gerir pessoas»
        pag.wait_for_selector("[data-acao=liberta]", timeout=8000)
        pag.locator("#vtch .linha", has_text="Ana Silva").locator("[data-acao=liberta]").click()
        ok("Toca outra vez" in pag.locator("#vtch .linha", has_text="Ana Silva").inner_text(), "libertar um lugar pede confirmacao")
        pag.locator("#vtch .linha", has_text="Ana Silva").locator("[data-acao=liberta]").click()
        pag.wait_for_function("document.getElementById('vtch').innerText.includes('1 de 3 já entraram')", timeout=8000)
        ok("1 de 3 já entraram" in pag.inner_text("#vtch"), "libertado: o lugar da Ana volta a ficar livre")

        # ---- copiar
        pag.locator("#vtch .linha", has_text="Rui Costa").locator("button", has_text="Copiar").click()
        pag.wait_for_function("document.querySelector('#vtch').innerText.includes('Copiado')", timeout=5000)
        copiado = pag.evaluate("navigator.clipboard.readText()")
        ok("Olá Rui!" in copiado and "/chat/#" in copiado, "copiar: mensagem do Rui com o link na area de transferencia")
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

        # ---- pessoas de fora e tipos (o dono, no Video Team)
        if pag.locator("[data-acao=tipoSel]").count() == 0:
            pag.click("[data-acao=gerirTog]")          # a pagina foi reaberta: «Gerir pessoas» volta a estar desligado
        ok("pessoas de fora da escala" in pag.inner_text("#vtch").lower() and pag.locator("#vtch-exttipo option").count() == 3, "caixa «Pessoas de fora da escala» com os tres tipos")
        pag.fill("#vtch-extnome", "Cliente Externo")
        pag.select_option("#vtch-exttipo", "leitura")
        pag.fill("#vtch-exttel", "96 111 22 33")
        pag.click("[data-acao=extAdd]")
        pag.wait_for_function("document.getElementById('vtch').innerText.includes('Cliente Externo')", timeout=8000)
        lin_ext = pag.locator("#vtch .linha", has_text="Cliente Externo")
        ok("de fora" in lin_ext.inner_text() and "só leitura" in lin_ext.inner_text() and "+351 961 112 233" in lin_ext.inner_text(), "a pessoa de fora aparece com «de fora», «so leitura» e o telemovel que escrevi (so neste aparelho)")
        ok(lin_ext.locator("a.wa").get_attribute("href").startswith("https://wa.me/351961112233?text="), "e tem o botao WhatsApp com o link dela")
        m_ext = [m for m in chamar("/api/admin/chat?key=" + urllib.parse.quote(SIG), pin="dono-teste")[1]["membros"] if m["name"] == "Cliente Externo"][0]
        ok(m_ext["externo"] and m_ext["tipo"] == "leitura" and "961112233" not in json.dumps(chamar("/api/admin/chat?key=" + urllib.parse.quote(SIG), pin="dono-teste")[1]), "no servidor: externa, so leitura, e sem o telemovel")
        lin_ext.locator("select[data-acao=tipoSel]").select_option("gestor")
        pag.wait_for_function("document.querySelector('#vtch').innerText.includes('gestor')", timeout=8000)
        s_x, sx = chamar("/chat/api/sala", k=m_ext["token"])
        ok(s_x == 200 and sx["eu"]["tipo"] == "gestor" and sx["eu"]["gere"], "o dono muda-lhe o tipo para gestor e passa a valer logo")
        pag.fill("#vtch-extnome", "A")
        pag.click("[data-acao=extAdd]")
        ok("Escreve o nome" in pag.inner_text("#vtch"), "nome demasiado curto: avisa")

        # ---- retirar e fechar
        pag.locator("#vtch .linha", has_text="Hugo Dias").locator("[data-acao=remover]").click()
        ok("Toca outra vez" in pag.inner_text("#vtch"), "retirar pede confirmacao no proprio botao (sem janelas do navegador, que a app Android nao tem)")
        pag.locator("#vtch .linha", has_text="Hugo Dias").locator("[data-acao=remover]").click()
        pag.wait_for_function("!document.querySelector('#vtch').innerText.includes('Hugo Dias')", timeout=8000)
        tok_hugo = [m for m in antes["membros"] if m["id"] == "4"][0]["token"]
        ok(chamar("/chat/api/sala", k=tok_hugo)[0] == 401, "retirar o Hugo: o link dele deixa de funcionar")
        pag.click("[data-acao=fechar]")
        ok("Tens a certeza" in pag.inner_text("#vtch"), "fechar o chat pede confirmacao")
        pag.click("[data-acao=fechar]")
        pag.wait_for_function("document.querySelector('#vtch').innerText.includes('Criar chat')", timeout=8000)
        ok(chamar("/chat/api/sala", k=tok_ana)[0] == 401 and chamar("/chat/api/sala", k=dono_href.split("#")[1])[0] == 401, "fechar o chat: todos os links deixam de funcionar")
        ok(chamar("/api/admin/chat?key=" + urllib.parse.quote(SIG), pin="dono-teste")[1]["existe"] is False, "e a sala deixa de existir")

        # ---- abreviaturas: «Rafa» na agenda para «Rafael Anchieta_12H» no Video Team (sugere, quem confirma e o dono)
        pag.evaluate("document.getElementById('vtch').remove()")
        pag.evaluate("localStorage.removeItem('vt.gcontatos'); localStorage.removeItem('vt.contactos')")
        pag.evaluate("window.__vtChat.abrir({ api: '%s', pin: 'dono-teste', sig: 'os:7:Outro', titulo: 'Outro', crew: [{id:'9', name:'Rafael Anchieta_12H', grupo:'Técnico de Video', days:['2026-10-21'], filtrado:true}] })" % API)
        pag.wait_for_selector("#vtch .linha", timeout=15000)
        pag.evaluate("window.__pick = [{name: ['Rafa'], tel: ['961 000 001'], email: []}]")
        pag.click("[data-acao=pickVarios]")
        pag.wait_for_selector("#vtch select[data-acao=cand]", timeout=5000)
        ok("Será um destes" in pag.inner_text("#vtch select[data-acao=cand]") and "sem contacto" not in pag.inner_text("#vtch .nm"), "«Rafa» na agenda: sugere-o para «Rafael Anchieta» e pede confirmacao (nao preenche sozinho)")
        pag.select_option("#vtch select[data-acao=cand]", index=1)
        ok("+351 961 000 001" in pag.inner_text("#vtch .nm"), "confirmado: o Rafael fica com o numero do «Rafa»")

        # ---- app Android: permissao de contactos pedida ao sistema (ponte VTNativo simulada) e sincronizacao automatica
        pag.evaluate("document.getElementById('vtch').remove()")
        pag.evaluate("localStorage.removeItem('vt.gcontatos'); localStorage.removeItem('vt.contactos')")
        ctx2 = nav.new_context(viewport={'width': 430, 'height': 900})
        pag2 = ctx2.new_page()
        pag2.add_init_script("""
          window.__perm = false; window.__pedidos = 0; window.__consultas = [];
          window.__agenda = [
            {n: 'Rafael Anchieta Tecnico', t: ['961 000 001'], e: ''},
            {n: 'Bruno Costa', t: ['+351 962 000 002'], e: 'b@x.pt'}
          ];
          window.VTNativo = {
            temPermissao: function () { return window.__perm; },
            pedirPermissao: function () { window.__pedidos++; setTimeout(function () { window.__perm = window.__aceitar !== false; if (window.__vtPerm) window.__vtPerm(window.__perm); }, 50); },
            lerContactos: function (q) { window.__consultas.push(JSON.parse(q)); return JSON.stringify(window.__agenda); }
          };
        """)
        pag2.route("https://accounts.google.com/gsi/client", lambda rt: rt.fulfill(status=200, content_type="text/javascript", body=""))
        pag2.route(ORIGEM + "/**", lambda rt: rt.fulfill(status=200, body=chat_js if rt.request.url.endswith("chat.js") else PAGINA.encode("utf-8"),
                                                          content_type="application/javascript" if rt.request.url.endswith("chat.js") else "text/html; charset=utf-8"))
        pag2.goto(ORIGEM + "/")
        pag2.evaluate("window.__vtChat.abrir({ api: '%s', pin: 'dono-teste', sig: 'os:8:Nativo', titulo: 'Nativo', crew: [{id:'1', name:'Rafael Anchieta_12H', grupo:'T', days:['2026-10-21'], filtrado:true}, {id:'2', name:'Bruno Costa*_10H', grupo:'T', days:['2026-10-21'], filtrado:true}] })" % API)
        pag2.wait_for_selector("#vtch .linha", timeout=15000)
        ok(pag2.locator("[data-acao=sincNativo]").count() == 1 and pag2.locator("[data-acao=pickVarios]").count() == 0, "na app Android: botao «Sincronizar com os contactos do telemóvel» (como no WhatsApp)")
        ok(pag2.evaluate("window.__pedidos") == 0 and pag2.evaluate("window.__consultas.length") == 0, "ao abrir sem permissao NAO pede nem le nada sozinho")
        pag2.click("[data-acao=sincNativo]")
        pag2.wait_for_function("document.getElementById('vtch').innerText.includes('contactos sincronizados')", timeout=5000)
        ok(pag2.evaluate("window.__pedidos") == 1, "carregar pede a permissao ao Android (uma vez)")
        ok(pag2.evaluate("window.__consultas[0]").__contains__("raf") and pag2.evaluate("window.__consultas[0]").__contains__("bru") and pag2.evaluate("window.__consultas[0]").__contains__("anc"), "so pede ao telefone os contactos com nome parecido com a equipa (3 letras por nome)")
        t = pag2.inner_text("#vtch")
        pag2.set_viewport_size({'width': 360, 'height': 800})
        fora = pag2.evaluate("""(() => { const out = []; document.querySelectorAll('#vtch .b').forEach(b => { const c = b.closest('.caixa, .corpo'); if (!c) return; const r = b.getBoundingClientRect(), cr = c.getBoundingClientRect(); if (r.width > 0 && r.right > cr.right + 1) out.push((b.textContent || '').trim().slice(0, 40) + ' ' + Math.round(r.right - cr.right)); }); return out; })()""")
        ok(not fora, "nenhum botao do painel sai do cartao num telemovel estreito (360 px) %s" % fora)
        ok(pag2.evaluate("(() => { const r = document.querySelector('#vtch .rodape'); if (!r) return false; return Math.abs(r.getBoundingClientRect().bottom - innerHeight) <= 2; })()"), "a barra «por enviar» fica colada ao fundo do ecra (nao a flutuar com conteudo por baixo)")
        ok(pag2.evaluate("(() => { const r = document.querySelector('#vtch .rodape'); if (!r) return true; const c = getComputedStyle(r).backgroundColor; return !/rgba\(.*, 0\)|transparent/.test(c); })()"), "a barra de baixo («por enviar») tem fundo solido: nao deixa ver nem tapa o texto por baixo")
        ok("+351 961 000 001" in t and "+351 962 000 002" in t, "Rafael (contacto «Rafael Anchieta Tecnico») e Bruno ficam com o telemovel, sem sufixos _12H")
        pag2.evaluate("document.getElementById('vtch').remove()")
        pag2.evaluate("window.__agenda = [{n: 'Rafael Anchieta', t: ['969 999 999'], e: ''}]")
        pag2.evaluate("window.__vtChat.abrir({ api: '%s', pin: 'dono-teste', sig: 'os:8:Nativo', titulo: 'Nativo', crew: [{id:'1', name:'Rafael Anchieta_12H', grupo:'T', days:['2026-10-21'], filtrado:true}] })" % API)
        pag2.wait_for_function("document.getElementById('vtch').innerText.includes('+351 969 999 999')", timeout=5000)
        ok(pag2.evaluate("window.__pedidos") == 1, "da segunda vez ja tem permissao: sincroniza sozinho ao abrir (sem voltar a pedir) e apanha o numero novo")
        pag2.evaluate("document.getElementById('vtch').remove(); window.__perm = false; window.__aceitar = false")
        pag2.evaluate("window.__vtChat.abrir({ api: '%s', pin: 'dono-teste', sig: 'os:8:Nativo', titulo: 'Nativo', crew: [{id:'1', name:'Rafael Anchieta', grupo:'T', days:['2026-10-21'], filtrado:true}] })" % API)
        pag2.wait_for_selector("[data-acao=sincNativo]", timeout=5000)
        pag2.click("[data-acao=sincNativo]")
        pag2.wait_for_function("document.getElementById('vtch').innerText.includes('Sem permissão aos contactos')", timeout=5000)
        ok(True, "se a pessoa recusa a permissao: mensagem a explicar onde a dar nas definicoes do Android")
        # procura por texto nos contactos do telemovel (para quem nao casou sozinho)
        pag2.evaluate("window.__perm = true; window.__aceitar = true; window.__agenda = [{n: 'Rafa Anchieta', t: ['961 000 001'], e: ''}, {n: 'Rafaela Costa', t: ['962 000 002'], e: ''}, {n: 'Outro Nome', t: ['963 000 003'], e: ''}]")
        pag2.evaluate("window.VTNativo.procurar = function (q) { q = q.toLowerCase(); return JSON.stringify(window.__agenda.filter(function (c) { return c.n.toLowerCase().indexOf(q) >= 0; })); }; 1")
        pag2.evaluate("var x = document.getElementById('vtch'); if (x) x.remove()")
        pag2.evaluate("window.__vtChat.abrir({ api: '%s', pin: 'dono-teste', sig: 'os:8:Nativo2', titulo: 'Nativo2', crew: [{id:'7', name:'Rodrigo Santos_12H', grupo:'T', days:['2026-10-21'], filtrado:true}] })" % API)
        pag2.wait_for_selector("#vtch .linha", timeout=10000)
        pag2.evaluate("window.__agenda = [{n: 'Rafa Anchieta', t: ['961 000 001'], e: ''}, {n: 'Rafaela Costa', t: ['962 000 002'], e: ''}, {n: 'Rodri S', t: ['964 000 004'], e: ''}]")
        pag2.click("#vtch .linha [data-acao=pick]")
        pag2.wait_for_selector("#vtch-busca", timeout=3000)
        ok(pag2.input_value("#vtch-busca") == "rodr" and "Rodri S" in pag2.inner_text("#vtch-busca-res"), "📇 na app Android abre a procura, ja com o inicio do nome («rodr»), e lista contactos do telemovel".replace("📇", "icone"))
        pag2.fill("#vtch-busca", "rafa")
        ok("Rafa Anchieta" in pag2.inner_text("#vtch-busca-res") and "Rafaela Costa" in pag2.inner_text("#vtch-busca-res") and "Outro" not in pag2.inner_text("#vtch-busca-res"), "escrever filtra os contactos pelo texto")
        pag2.fill("#vtch-busca", "rodri")
        pag2.click("#vtch-busca-res [data-acao=escolheBusca]")
        ok("+351 964 000 004" in pag2.inner_text("#vtch .nm") and pag2.locator("#vtch-busca").count() == 0, "escolher um resultado liga o numero a essa pessoa (mesmo com nome diferente na agenda)")
        pag2.close()

        # ---- entrar como dono com o autenticador: ativar no ecra e usar o codigo
        import base64, hashlib, hmac, struct

        def totp(segredo, passo):
            chave = base64.b32decode(segredo.replace(" ", "").upper() + "=" * (-len(segredo.replace(" ", "")) % 8))
            h = hmac.new(chave, struct.pack(">Q", passo), hashlib.sha1).digest()
            o = h[19] & 15
            return "%06d" % ((struct.unpack(">I", h[o:o + 4])[0] & 0x7fffffff) % 1000000)
        pag.evaluate("var x = document.getElementById('vtch'); if (x) x.remove()")
        pag.evaluate("window.__vtChat.abrir({ api: '%s', pin: 'dono-teste', sig: 'os:9:Seguranca', titulo: 'Seguranca', crew: [{id:'1', name:'Ana Silva', grupo:'T', days:['2026-10-21'], filtrado:true}] })" % API)
        pag.wait_for_selector("[data-acao=autPreparar]", timeout=10000)
        ok("Ativar o autenticador" in pag.inner_text("#vtch"), "caixa «Segurança»: oferece ativar o autenticador")
        pag.click("[data-acao=autPreparar]")
        pag.wait_for_selector("#vtch-aut", timeout=8000)
        href = pag.get_attribute("a:has-text('Abrir na app de autenticador')", "href")
        segredo = href.split("secret=")[1].split("&")[0]
        ok(href.startswith("otpauth://totp/Video%20Team:dono") and len(segredo) == 32, "mostra o botao «Abrir na app de autenticador» (otpauth://) com a chave")
        pag.fill("#vtch-aut", "000000")
        pag.click("[data-acao=autConfirma]")
        pag.wait_for_function("document.getElementById('vtch').innerText.includes('não bate certo')", timeout=8000)
        ok(True, "um codigo errado e recusado")
        passo = int(time.time()) // 30
        pag.fill("#vtch-aut", totp(segredo, passo))
        pag.click("[data-acao=autConfirma]")
        pag.wait_for_function("document.getElementById('vtch').innerText.includes('8 códigos de recuperação')", timeout=8000)
        ok(len(re.findall(r"[A-Z2-7]{5}-[A-Z2-7]{5}", pag.inner_text("#vtch"))) == 8, "certo: ativa e mostra os 8 codigos de recuperacao")
        pag.click("[data-acao=autFecha]")
        ok("O autenticador está ativo" in pag.inner_text("#vtch"), "depois, a caixa diz que o autenticador esta ativo")
        r_ent = urllib.request.Request(API + "/api/dono/entrar", data=json.dumps({"codigo": totp(segredo, passo + 1)}).encode(), method="POST", headers={"Content-Type": "application/json"})
        sess = json.loads(urllib.request.urlopen(r_ent).read())["token"]
        st, jp = chamar("/api/ping", pin=sess)
        ok(st == 200 and jp["role"] == "owner", "o codigo do autenticador da uma sessao de dono (as rotas do dono aceitam-na)")

        # ---- chave errada
        pag.evaluate("var x = document.getElementById('vtch'); if (x) x.remove()")
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
    for pr in (proc, srv):
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(pr.pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print("\nfalhas: %d" % falhas)
sys.exit(1 if falhas else 0)
