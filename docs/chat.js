// Video Team — «Chat do evento» (so o dono). window.__vtChat.abrir({api, pin, sig, titulo, crew:[{id,name,grupo,days}], onAuthFail}) abre o ecra
// para criar o chat de um evento com as pessoas escolhidas, e enviar a cada uma o seu link pessoal (WhatsApp, SMS, email ou copiar).
// Os contactos (telemoveis/emails) ficam SO neste aparelho (localStorage), importados do Google Contactos (.csv) ou de um .vcf, e nunca vao para o servidor.
// O servidor so guarda nomes, ids do 7Eventos e os links (tokens). Fala com /api/admin/chat do Worker.
(function (root) {
  var LS_G = 'vt.gcontatos';       // contactos importados: [{n, k, t, e}]
  var LS_M = 'vt.contactos';       // acertos a mao por pessoa (id 7Eventos): {id: {t, e}}
  var LS_ENV = 'vt.chat.enviados'; // {sala|id|canal: 1}
  var LS_MSG = 'vt.chat.msg';      // modelo da mensagem
  var LS_NOME = 'vt.chat.nome';    // como a regie aparece no chat
  var MSG_PADRAO = 'Olá {nome}! Vamos falar neste chat durante o evento «{evento}»: {link}\n\nÉ o teu link pessoal, não o partilhes. Abre-se no telemóvel, sem instalar nada.';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ls(k, def) { try { var v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function ini(n) { var p = String(n).replace(/\([^)]*\)/g, ' ').split(/\s+/).filter(Boolean); return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase(); }
  function hue(s) { var h = 0; s = String(s); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 360; }

  // ---------------------------------------------------------------- contactos: ler, normalizar, casar com a equipa
  function chave(n) { return String(n || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }

  // +351…, 00351…, 9xxxxxxxx (Portugal por omissao) -> so digitos com indicativo, para o wa.me
  function fone(t) {
    var s = String(t || '').split(':::')[0].trim();
    var mais = s.charAt(0) === '+';
    var d = s.replace(/\D/g, '');
    if (!d) return '';
    if (d.indexOf('00') === 0) d = d.slice(2);
    else if (!mais && d.length === 9 && /^[2-9]/.test(d)) d = '351' + d;
    return d.length >= 9 && d.length <= 15 ? d : '';
  }
  function foneBonito(d) { return d ? '+' + d.replace(/^(351)(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3 $4') : ''; }

  function csv(texto) {   // CSV com aspas, virgulas e quebras de linha dentro de campos
    var linhas = [], l = [], c = '', q = false, i, ch;
    texto = String(texto).replace(/^﻿/, '');
    for (i = 0; i < texto.length; i++) {
      ch = texto.charAt(i);
      if (q) { if (ch === '"') { if (texto.charAt(i + 1) === '"') { c += '"'; i++; } else q = false; } else c += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { l.push(c); c = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && texto.charAt(i + 1) === '\n') i++; l.push(c); c = ''; if (l.length > 1 || l[0] !== '') linhas.push(l); l = []; }
      else c += ch;
    }
    if (c !== '' || l.length) { l.push(c); linhas.push(l); }
    return linhas;
  }

  function lerCsv(texto) {
    var linhas = csv(texto), cab = linhas.shift() || [], out = [];
    function col(re) { var r = []; cab.forEach(function (h, i) { if (re.test(h)) r.push(i); }); return r; }
    var cNome = col(/^(name|given name|first name)$/i), cApel = col(/^(family name|last name)$/i), cMeio = col(/^(additional name|middle name)$/i);
    var cFone = col(/^phone \d+ - value$/i), cMail = col(/^e-?mail \d+ - value$/i);
    var cFull = col(/^name$/i);
    linhas.forEach(function (r) {
      var nome = '';
      if (cFull.length && r[cFull[0]]) nome = r[cFull[0]];
      else nome = [cNome[0] != null ? r[cNome[0]] : '', cMeio[0] != null ? r[cMeio[0]] : '', cApel[0] != null ? r[cApel[0]] : ''].filter(Boolean).join(' ');
      nome = nome.trim();
      var tels = [], mail = '';
      cFone.forEach(function (i) { String(r[i] || '').split(':::').forEach(function (x) { var f = fone(x); if (f && tels.indexOf(f) < 0) tels.push(f); }); });
      cMail.forEach(function (i) { if (!mail) mail = String(r[i] || '').split(':::')[0].trim(); });
      if (nome && (tels.length || mail)) out.push({ n: nome, k: chave(nome), t: tels, e: mail });
    });
    return out;
  }

  function lerVcf(texto) {
    var out = [], cartoes = String(texto).replace(/\r\n[ \t]/g, '').split(/BEGIN:VCARD/i).slice(1);
    cartoes.forEach(function (c) {
      var fn = (c.match(/^FN[^:]*:(.*)$/mi) || [])[1], tels = [], mail = '';
      String(c).split(/\r?\n/).forEach(function (ln) {
        if (/^TEL/i.test(ln)) { var f = fone(ln.slice(ln.indexOf(':') + 1)); if (f && tels.indexOf(f) < 0) tels.push(f); }
        else if (/^EMAIL/i.test(ln) && !mail) mail = ln.slice(ln.indexOf(':') + 1).trim();
      });
      fn = (fn || '').trim();
      if (fn && (tels.length || mail)) out.push({ n: fn, k: chave(fn), t: tels, e: mail });
    });
    return out;
  }

  function candidatos(nome, lista) {
    var k = chave(nome), ts = k.split(' ');
    if (!k) return [];
    var exatos = lista.filter(function (c) { return c.k === k; });
    if (exatos.length) return exatos;
    var cand = lista.filter(function (c) {   // todos os nomes do mais curto dentro do mais longo («Ana Silva» / «Ana Maria Silva»)
      var a = c.k.split(' '), curto = a.length <= ts.length ? a : ts, longo = a.length <= ts.length ? ts : a;
      return curto.length >= 2 && curto.every(function (t) { return longo.indexOf(t) >= 0; });
    });
    if (cand.length) return cand;
    if (ts.length >= 2) cand = lista.filter(function (c) { var a = c.k.split(' '); return a.length >= 2 && a[0] === ts[0] && a[a.length - 1] === ts[ts.length - 1]; });
    return cand;
  }

  // o que se sabe de uma pessoa: acerto a mao > contacto importado (se so ha um) > varios candidatos > nada
  function contactoDe(p, lista, manual) {
    var m = manual[p.id];
    if (m && (m.t || m.e)) return { t: m.t || '', e: m.e || '', de: 'manual' };
    var c = candidatos(p.name, lista), tels = {}, uniq = [];
    c.forEach(function (x) { var id = (x.t[0] || '') + '|' + x.e; if (!tels[id]) { tels[id] = 1; uniq.push(x); } });
    if (uniq.length === 1) return { t: uniq[0].t[0] || '', e: uniq[0].e || '', de: 'google', quem: uniq[0].n };
    if (uniq.length > 1) return { ambiguo: uniq };
    return {};
  }

  // ---------------------------------------------------------------- estilo
  var CSS = [
    '#vtch,#vtch *{box-sizing:border-box}',
    '#vtch{position:fixed;inset:0;z-index:45;background:var(--bg);color:var(--ink);display:flex;flex-direction:column;font:14px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
    '#vtch button,#vtch a.b{font:inherit;color:inherit;cursor:pointer}',
    '#vtch .top{display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--panel);border-bottom:1px solid var(--line)}',
    '#vtch .top b{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:16px}',
    '#vtch .top small{display:block;font-weight:400;color:var(--mut);font-size:12px}',
    '#vtch .x{width:34px;height:34px;border:0;border-radius:9px;background:var(--soft);font-size:16px}',
    '#vtch .corpo{flex:1;overflow:auto;padding:12px 14px 90px;max-width:760px;width:100%;margin:0 auto}',
    '#vtch .b{display:inline-flex;align-items:center;justify-content:center;gap:5px;height:34px;padding:0 12px;border:1px solid var(--line);border-radius:9px;background:var(--panel);text-decoration:none;white-space:nowrap}',
    '#vtch .b:hover{background:var(--soft)}#vtch .b:disabled{opacity:.45;cursor:default}',
    '#vtch .pri{background:linear-gradient(135deg,#1246E6,var(--acc));color:#fff;border:0}#vtch .pri:hover{background:linear-gradient(135deg,#1246E6,var(--acc))}',
    '#vtch .wa{background:#1fa855;color:#fff;border:0}#vtch .wa:hover{background:#198f48}',
    '#vtch a.pri,#vtch a.wa,#vtch button.pri,#vtch button.wa{color:#fff}',
    '#vtch .perigo{color:#d6334b;border-color:#d6334b55}',
    '#vtch .nota{color:var(--mut);font-size:12px;margin:4px 0 10px}',
    '#vtch .caixa{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px;margin-bottom:12px}',
    '#vtch .caixa h4{margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut)}',
    '#vtch .linha{display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid var(--line);flex-wrap:wrap}#vtch .linha:first-of-type{border-top:0}',
    '#vtch .av{flex:none;width:34px;height:34px;border-radius:50%;display:grid;place-items:center;color:#fff;font-size:12px;font-weight:700}',
    '#vtch .nm{flex:1;min-width:140px}#vtch .nm small{display:block;color:var(--mut);font-size:12px}',
    '#vtch .ac{display:flex;gap:6px;flex-wrap:wrap;margin-left:auto}',
    '@media (max-width:560px){#vtch .ac{width:100%;margin-left:44px;width:calc(100% - 44px)}#vtch .edita{margin-left:0}}',
    '#vtch .tag{font-size:11px;padding:2px 8px;border-radius:999px;background:var(--soft);color:var(--mut);white-space:nowrap}#vtch .tag.ok{background:#1fa85526;color:#1c8a4a}#vtch .tag.aviso{background:#f5b80030;color:#8a6500}',
    '#vtch input[type=text],#vtch input[type=tel],#vtch input[type=email],#vtch textarea,#vtch select{border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);padding:7px 10px;font:inherit;max-width:100%}',
    '#vtch textarea{width:100%;min-height:96px;resize:vertical}',
    '#vtch .edita{display:flex;gap:6px;width:100%;margin:2px 0 4px 44px;flex-wrap:wrap}',
    '#vtch .rodape{position:sticky;bottom:0;display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:10px 0 0;background:linear-gradient(transparent,var(--bg) 30%)}',
    '#vtch .erro{color:#d6334b;font-size:13px;margin:6px 0}',
    '#vtch .spin{width:26px;height:26px;border:3px solid var(--line);border-top-color:var(--acc);border-radius:50%;margin:50px auto;animation:vtchsp .8s linear infinite}@keyframes vtchsp{to{transform:rotate(360deg)}}'
  ].join('\n');

  // Android (Chrome): o telemovel deixa a pagina escolher contactos (so os que tu marcares, com o teu OK). iPhone nao tem isto: serve o ficheiro.
  var PICKER = !!(typeof navigator !== 'undefined' && navigator.contacts && navigator.contacts.select && typeof window !== 'undefined' && window.isSecureContext);
  function dePicker(c) {   // {name:[], tel:[], email:[]} -> {n, k, t:[digitos], e}
    var n = (c.name && c.name[0]) || '', t = [], e = (c.email && c.email[0]) || '';
    (c.tel || []).forEach(function (x) { var f = fone(x); if (f && t.indexOf(f) < 0) t.push(f); });
    return { n: n, k: chave(n), t: t, e: e };
  }

  // ---------------------------------------------------------------- o ecra
  function abrir(ctx) {
    if (document.getElementById('vtch')) return;
    var st = document.createElement('style'); st.id = 'vtch-css'; st.textContent = CSS; document.head.appendChild(st);
    var el = document.createElement('div'); el.id = 'vtch'; document.body.appendChild(el);

    var crew = (ctx.crew || []).slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'pt'); });
    var ultimoDia = '';
    crew.forEach(function (c) { (c.days || []).forEach(function (d) { if (d > ultimoDia) ultimoDia = d; }); });
    var temFiltro = crew.some(function (c) { return c.filtrado; }) && crew.some(function (c) { return !c.filtrado; });
    var S = {
      todos: !temFiltro, doc: null, vista: 'carregar', sel: {}, erro: '', ocupado: false, edita: null, nome: ls(LS_NOME, 'Mike'), msg: ls(LS_MSG, MSG_PADRAO),
      lista: ls(LS_G, []), manual: ls(LS_M, {}), enviados: ls(LS_ENV, {}), copiado: null, importou: ''
    };
    crew.forEach(function (c) { S.sel[c.id] = temFiltro ? !!c.filtrado : true; });
    function pessoasVisiveis() { return crew.filter(function (c) { return S.todos || !temFiltro || c.filtrado; }); }
    var base = ctx.chatBase || (function () { try { var u = new URL('chat.html', location.href); u.search = ''; u.hash = ''; return u.href; } catch (e) { return 'chat.html'; } })();

    function H(caminho, corpo) {
      return fetch(ctx.api + '/api/admin/chat' + caminho, {
        method: corpo ? 'POST' : 'GET', headers: { 'X-PIN': ctx.pin, 'Content-Type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined
      }).then(function (r) {
        if (r.status === 401 || r.status === 403) { if (ctx.onAuthFail) ctx.onAuthFail(); throw new Error('A chave do dono já não serve.'); }
        return r.json().then(function (j) { if (!r.ok) throw new Error(j && j.error ? j.error : 'Erro ' + r.status); return j; });
      });
    }
    function tratar(p, depois) { S.ocupado = true; S.erro = ''; desenhar(); return p.then(function (j) { S.ocupado = false; if (depois) depois(j); desenhar(); }).catch(function (e) { S.ocupado = false; S.erro = e && e.message === 'Failed to fetch' ? 'Sem ligação ao servidor.' : (e && e.message) || 'Erro.'; desenhar(); }); }

    function link(token) { return base + '#' + token; }
    function primeiroNome(n) { return String(n).split(/\s+/)[0] || n; }
    function texto(nome, token) { return String(S.msg).replace(/\{nome\}/g, primeiroNome(nome)).replace(/\{evento\}/g, ctx.titulo || 'evento').replace(/\{link\}/g, link(token)); }
    function eu(p) { return contactoDe(p, S.lista, S.manual); }
    function enviadoKey(id, canal) { return (S.doc ? S.doc.sala : '') + '|' + id + '|' + canal; }

    function avatar(nome, id) { return '<div class="av" style="background:hsl(' + hue(id) + ' 55% 45%)">' + esc(ini(nome)) + '</div>'; }

    function chipContacto(p, c) {
      if (c.ambiguo) {
        return '<select data-acao="cand" data-id="' + esc(p.id) + '"><option value="">Vários contactos — escolhe…</option>' + c.ambiguo.map(function (x, i) { return '<option value="' + i + '">' + esc(x.n + (x.t[0] ? ' · +' + x.t[0] : '')) + '</option>'; }).join('') + '</select>';
      }
      if (c.t) return '<span class="tag ok" title="' + esc(c.quem || '') + '">' + esc(foneBonito(c.t)) + '</span>';
      if (c.e) return '<span class="tag">só email</span>';
      return '<span class="tag aviso">sem contacto</span>';
    }

    function botaoContacto(p) {
      return (PICKER ? '<button class="b" data-acao="pick" data-id="' + esc(p.id) + '" title="Escolher o contacto no telemóvel">📇</button>' : '') +
        '<button class="b" data-acao="edita" data-id="' + esc(p.id) + '" title="Escrever ou corrigir o contacto">✎</button>';
    }

    function linhaEditar(p) {
      var m = S.manual[p.id] || {};
      return '<div class="edita"><input type="tel" id="vtch-tel" placeholder="Telemóvel (ex. 912 345 678)" value="' + esc(m.t ? '+' + m.t : '') + '" inputmode="tel" autocomplete="off">' +
        '<input type="email" id="vtch-mail" placeholder="Email (opcional)" value="' + esc(m.e || '') + '" autocomplete="off">' +
        '<button class="b pri" data-acao="gravaContacto" data-id="' + esc(p.id) + '">Guardar</button><button class="b" data-acao="cancelaEdita">Cancelar</button></div>';
    }

    // ---- 1) escolher pessoas e criar
    function escolher() {
      var n = crew.filter(function (c) { return S.sel[c.id]; }).length, comTel = 0, vis = pessoasVisiveis();
      var h = '<div class="caixa"><h4>Quem entra no chat</h4><div class="nota">' + (temFiltro && !S.todos ? 'Só as ' + vis.length + ' pessoas do filtro do Video Team' + (ctx.filtroTxt ? ' (' + esc(ctx.filtroTxt) + ')' : '') + '. ' : '') +
        'Cada uma recebe o seu link pessoal e fica a ver e a escrever neste chat do evento.</div>';
      vis.forEach(function (p) {
        var c = eu(p); if (S.sel[p.id] && c.t) comTel++;
        h += '<div class="linha"><input type="checkbox" data-acao="sel" data-id="' + esc(p.id) + '" id="vtch-s' + esc(p.id) + '"' + (S.sel[p.id] ? ' checked' : '') + ' aria-label="' + esc(p.name) + '">' + avatar(p.name, p.id) +
          '<label class="nm" for="vtch-s' + esc(p.id) + '">' + esc(p.name) + '<small>' + esc(p.grupo || '') + '</small></label>' + chipContacto(p, c) +
          botaoContacto(p) + '</div>' + (S.edita === p.id ? linhaEditar(p) : '');
      });
      if (temFiltro) h += '<div style="margin-top:8px"><button class="b" data-acao="todos">' + (S.todos ? 'Mostrar só o filtro' : 'Mostrar toda a equipa do evento (+' + (crew.length - crew.filter(function (c) { return c.filtrado; }).length) + ')') + '</button></div>';
      h += '</div>' + caixaContactos();
      h += '<div class="caixa"><h4>O teu nome no chat</h4><input type="text" id="vtch-nome" maxlength="40" value="' + esc(S.nome) + '"><div class="nota">Aparece como «régie» ao lado do nome.</div></div>';
      h += '<div class="rodape"><span class="nota">' + n + ' pessoa' + (n === 1 ? '' : 's') + ' · ' + comTel + ' com telemóvel</span><span>' +
        (S.doc ? '<button class="b" data-acao="voltaGerir">Voltar</button> ' : '') + '<button class="b pri" data-acao="criar"' + (n && !S.ocupado ? '' : ' disabled') + '>' + (S.doc ? 'Acrescentar à sala' : 'Criar chat e preparar links') + '</button></span></div>';
      return h;
    }

    function caixaContactos() {
      return '<div class="caixa"><h4>Contactos</h4><div class="nota">Os números ficam só neste aparelho. ' + (PICKER ? 'No telemóvel, escolhe só os contactos da equipa (ou usa o 📇 em cada pessoa). ' : 'No iPhone ou no computador não há acesso direto aos contactos: ') + 'Em contacts.google.com: <b>Exportar → Google CSV</b>, e importa o ficheiro aqui (também serve um .vcf).</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' + (PICKER ? '<button class="b pri" data-acao="pickVarios">Escolher contactos no telemóvel</button>' : '') + '<button class="b" data-acao="importar">Importar ficheiro (.csv / .vcf)</button><input type="file" id="vtch-fich" accept=".csv,.vcf,text/csv,text/vcard,text/x-vcard" hidden>' +
        '<span class="nota" style="margin:0">' + (S.importou || (S.lista.length ? S.lista.length + ' contactos importados' : 'Ainda sem contactos importados')) + '</span>' +
        (S.lista.length ? '<button class="b perigo" data-acao="limpaContactos">Apagar importados</button>' : '') + '</div></div>';
    }

    // ---- 2) gerir: links por pessoa
    function gerir() {
      var d = S.doc, h = '';
      h += '<div class="caixa"><h4>Mensagem a enviar</h4><textarea id="vtch-msg" aria-label="Mensagem">' + esc(S.msg) + '</textarea>' +
        '<div class="nota">{nome} {evento} e {link} são trocados por pessoa. <button class="b" data-acao="msgPadrao" style="height:26px">Repor</button></div></div>';
      h += '<div class="caixa"><h4>Tu (régie)</h4><div class="linha">' + avatar(d.dono.nome, 'dono') + '<div class="nm">' + esc(d.dono.nome) + '<small>escreves avisos fixos para todos</small></div><div class="ac">' +
        '<a class="b pri" href="' + esc(link(d.dono.token)) + '" target="_blank" rel="noopener">Abrir o chat</a><button class="b" data-acao="copiar" data-t="' + esc(link(d.dono.token)) + '" data-k="dono">' + (S.copiado === 'dono' ? 'Copiado ✓' : 'Copiar link') + '</button></div></div></div>';
      h += '<div class="caixa"><h4>Pessoas (' + d.membros.length + ')</h4>';
      d.membros.forEach(function (m) {
        var p = { id: m.id, name: m.name, grupo: m.grupo }, c = eu(p), msg = texto(m.name, m.token), acoes = '';
        function marca(canal) { return S.enviados[enviadoKey(m.id, canal)] ? ' ✓' : ''; }
        if (c.t) {
          acoes += '<a class="b wa" data-acao="enviado" data-id="' + esc(m.id) + '" data-canal="wa" href="https://wa.me/' + c.t + '?text=' + encodeURIComponent(msg) + '" target="_blank" rel="noopener">WhatsApp' + marca('wa') + '</a>';
          acoes += '<a class="b" data-acao="enviado" data-id="' + esc(m.id) + '" data-canal="sms" href="sms:+' + c.t + '?&body=' + encodeURIComponent(msg) + '">SMS' + marca('sms') + '</a>';
        }
        if (c.e) acoes += '<a class="b" data-acao="enviado" data-id="' + esc(m.id) + '" data-canal="mail" href="mailto:' + esc(c.e) + '?subject=' + encodeURIComponent('Chat do evento ' + (ctx.titulo || '')) + '&body=' + encodeURIComponent(msg) + '">Email' + marca('mail') + '</a>';
        acoes += '<button class="b" data-acao="copiar" data-t="' + esc(msg) + '" data-k="' + esc(m.id) + '">' + (S.copiado === m.id ? 'Copiado ✓' : 'Copiar') + '</button>';
        acoes += '<button class="b perigo" data-acao="remover" data-id="' + esc(m.id) + '" title="Retirar do chat (o link deixa de funcionar)">✕</button>';
        var enviado = S.enviados[enviadoKey(m.id, 'wa')] || S.enviados[enviadoKey(m.id, 'sms')] || S.enviados[enviadoKey(m.id, 'mail')];
        h += '<div class="linha">' + avatar(m.name, m.id) + '<div class="nm">' + esc(m.name) + '<small>' + esc(m.grupo || '') + '</small></div>' + chipContacto(p, c) +
          (enviado ? '<span class="tag ok">enviado</span>' : '') + botaoContacto(p) + '<div class="ac">' + acoes + '</div></div>' + (S.edita === m.id ? linhaEditar(p) : '');
      });
      h += '</div>' + caixaContactos();
      h += '<div class="rodape"><span class="nota">Válido até ' + new Date(d.expira).toLocaleDateString('pt-PT', { day: 'numeric', month: 'long' }) + ' · as mensagens apagam-se depois</span><span>' +
        '<button class="b" data-acao="maisPessoas">Acrescentar pessoas</button> <button class="b perigo" data-acao="fechar">Fechar o chat</button></span></div>';
      return h;
    }

    function desenhar() {
      var corpo;
      if (S.vista === 'carregar') corpo = '<div class="spin" aria-label="A carregar"></div>';
      else corpo = (S.vista === 'gerir' && S.doc ? gerir() : escolher());
      var sub = S.doc ? 'Chat criado · ' + S.doc.membros.length + ' pessoas' : 'Novo chat';
      el.innerHTML = '<div class="top"><b>Chat do evento<small>' + esc(ctx.titulo || '') + ' · ' + esc(sub) + '</small></b><button class="x" data-acao="sair" aria-label="Fechar">✕</button></div>' +
        '<div class="corpo">' + (S.erro ? '<div class="erro" role="alert">' + esc(S.erro) + '</div>' : '') + corpo + '</div>';
    }

    // guarda o que esta nas caixas antes de redesenhar
    function lerCaixas() {
      var n = document.getElementById('vtch-nome'); if (n) { S.nome = n.value.trim() || 'Mike'; lsSet(LS_NOME, S.nome); }
      var m = document.getElementById('vtch-msg'); if (m) { S.msg = m.value || MSG_PADRAO; lsSet(LS_MSG, S.msg); }
    }

    function importar(f) {
      var rd = new FileReader();
      rd.onload = function () {
        var t = String(rd.result || ''), lista;
        try { lista = /BEGIN:VCARD/i.test(t) ? lerVcf(t) : lerCsv(t); } catch (e) { lista = []; }
        if (!lista.length) { S.importou = 'Não encontrei contactos com nome e telemóvel neste ficheiro.'; desenhar(); return; }
        S.lista = lista;
        if (!lsSet(LS_G, lista)) S.importou = lista.length + ' contactos lidos, mas não cabem na memória deste aparelho (usam-se só até fechares isto).';
        else S.importou = lista.length + ' contactos importados';
        desenhar();
      };
      rd.readAsText(f);
    }

    el.addEventListener('change', function (ev) {
      var t = ev.target, a = t.getAttribute && t.getAttribute('data-acao');
      if (t.id === 'vtch-fich' && t.files && t.files[0]) { importar(t.files[0]); return; }
      if (a === 'sel') { S.sel[t.getAttribute('data-id')] = t.checked; lerCaixas(); desenhar(); }
      else if (a === 'cand' && t.value !== '') {
        var id = t.getAttribute('data-id'), p = crew.filter(function (c) { return c.id === id; })[0] || (S.doc && S.doc.membros.filter(function (m) { return m.id === id; })[0]);
        var c = candidatos(p.name, S.lista), uniq = [], vistos = {};
        c.forEach(function (x) { var k = (x.t[0] || '') + '|' + x.e; if (!vistos[k]) { vistos[k] = 1; uniq.push(x); } });
        var x = uniq[+t.value];
        if (x) { S.manual[id] = { t: x.t[0] || '', e: x.e || '' }; lsSet(LS_M, S.manual); lerCaixas(); desenhar(); }
      }
    });

    el.addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('[data-acao]') : null;
      if (!b || b.tagName === 'SELECT' || b.tagName === 'INPUT') return;
      var a = b.getAttribute('data-acao'), id = b.getAttribute('data-id');
      if (a === 'sair') { el.remove(); var s = document.getElementById('vtch-css'); if (s) s.remove(); return; }
      lerCaixas();
      if (a === 'todos') { S.todos = !S.todos; desenhar(); return; }
      if (a === 'pick' || a === 'pickVarios') {
        if (!PICKER) return;
        var multi = a === 'pickVarios';
        navigator.contacts.select(['name', 'tel', 'email'], { multiple: multi }).then(function (res) {
          var novos = (res || []).map(dePicker).filter(function (c) { return c.t.length || c.e; });
          if (!novos.length) return;
          if (multi) {
            novos.forEach(function (c) { if (!S.lista.some(function (x) { return x.k === c.k && x.t[0] === c.t[0]; })) S.lista.push(c); });
            lsSet(LS_G, S.lista); S.importou = novos.length + ' escolhidos no telemóvel · ' + S.lista.length + ' contactos';
          } else {
            S.manual[id] = { t: novos[0].t[0] || '', e: novos[0].e || '' }; lsSet(LS_M, S.manual);
          }
          desenhar();
        }).catch(function () { /* cancelou */ });
        return;
      }
      if (a === 'importar') { document.getElementById('vtch-fich').click(); return; }
      if (a === 'limpaContactos') { S.lista = []; lsSet(LS_G, []); S.importou = ''; desenhar(); return; }
      if (a === 'edita') { S.edita = S.edita === id ? null : id; desenhar(); var i = document.getElementById('vtch-tel'); if (i) i.focus(); return; }
      if (a === 'cancelaEdita') { S.edita = null; desenhar(); return; }
      if (a === 'gravaContacto') {
        var tel = fone((document.getElementById('vtch-tel') || {}).value), mail = ((document.getElementById('vtch-mail') || {}).value || '').trim();
        var bruto = ((document.getElementById('vtch-tel') || {}).value || '').trim();
        if (bruto && !tel) { S.erro = 'Esse telemóvel não parece válido.'; desenhar(); return; }
        if (tel || mail) S.manual[id] = { t: tel, e: mail }; else delete S.manual[id];
        lsSet(LS_M, S.manual); S.edita = null; S.erro = ''; desenhar(); return;
      }
      if (a === 'msgPadrao') { S.msg = MSG_PADRAO; lsSet(LS_MSG, S.msg); desenhar(); return; }
      if (a === 'copiar') {
        var tx = b.getAttribute('data-t'), k = b.getAttribute('data-k');
        var feito = function () { S.copiado = k; desenhar(); setTimeout(function () { if (S.copiado === k) { S.copiado = null; desenhar(); } }, 1800); };
        try { navigator.clipboard.writeText(tx).then(feito, function () { window.prompt('Copia:', tx); }); } catch (e) { window.prompt('Copia:', tx); }
        return;
      }
      if (a === 'enviado') { S.enviados[enviadoKey(id, b.getAttribute('data-canal'))] = 1; lsSet(LS_ENV, S.enviados); setTimeout(desenhar, 300); return; }   // o link abre sozinho
      if (a === 'voltaGerir') { S.vista = 'gerir'; desenhar(); return; }
      if (a === 'maisPessoas') { S.todos = true; crew.forEach(function (c) { S.sel[c.id] = !S.doc.membros.some(function (m) { return m.id === c.id; }) && (!temFiltro || !!c.filtrado); }); S.vista = 'escolher'; desenhar(); return; }
      if (a === 'criar') {
        var membros = crew.filter(function (c) { return S.sel[c.id]; }).map(function (c) { return { id: c.id, name: c.name, grupo: c.grupo || '' }; });
        tratar(H('/criar', { key: ctx.sig, label: ctx.titulo, ate: ultimoDia, membros: membros, donoNome: S.nome }), function (j) { S.doc = j; S.vista = 'gerir'; });
        return;
      }
      if (a === 'remover') {
        var m = S.doc.membros.filter(function (x) { return x.id === id; })[0];
        if (!confirm('Retirar ' + (m ? m.name : 'esta pessoa') + ' do chat? O link dela deixa de funcionar.')) return;
        tratar(H('/remover', { key: ctx.sig, id: id }), function (j) { S.doc = j; });
        return;
      }
      if (a === 'fechar') {
        if (!confirm('Fechar o chat deste evento? Todos os links deixam de funcionar e as mensagens apagam-se. Isto não se desfaz.')) return;
        tratar(H('/fechar', { key: ctx.sig }), function () { S.doc = null; S.vista = 'escolher'; });
      }
    });

    desenhar();
    H('?key=' + encodeURIComponent(ctx.sig)).then(function (j) {
      if (j.existe) { S.doc = j; S.vista = 'gerir'; } else S.vista = 'escolher';
      desenhar();
    }).catch(function (e) { S.vista = 'escolher'; S.erro = (e && e.message) || 'Sem ligação ao servidor.'; desenhar(); });
  }

  root.__vtChat = { abrir: abrir, _t: { chave: chave, fone: fone, lerCsv: lerCsv, lerVcf: lerVcf, candidatos: candidatos, contactoDe: contactoDe } };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.__vtChat;
})(typeof window !== 'undefined' ? window : globalThis);
