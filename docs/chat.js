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
  var LS_CID = 'vt.google.cid';    // ID de cliente OAuth (nao e segredo): permite «Importar do Google Contactos» em qualquer aparelho
  var GOOGLE_CLIENT_ID = '';       // preenchido quando o Mike criar o ID (ver README do chat); ate la cola-se no ecra e fica neste aparelho
  var CHAT_BASE = 'https://things-on.mike-app.com/chat/';   // onde o chat vive (PWA no VPS)
  var GOOGLE_SCOPE = 'https://www.googleapis.com/auth/contacts.readonly';
  var MSG_PADRAO = 'Olá {nome}! Vamos falar neste chat durante o evento «{evento}»: {link}\n\nÉ o teu link pessoal, não o partilhes. Abre-se no telemóvel, sem instalar nada.';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ls(k, def) { try { var v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function ini(n) { var p = String(n).replace(/\([^)]*\)/g, ' ').split(/\s+/).filter(Boolean); return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase(); }
  function hue(s) { var h = 0; s = String(s); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 360; }

  // ---------------------------------------------------------------- contactos: ler, normalizar, casar com a equipa
  function limpaNome(n) { return String(n || '').replace(/\s*[_*].*$/, '').replace(/\s+/g, ' ').trim() || String(n || '').trim(); }
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

  function candidatosAprox(nome, lista) {
    var ts = chave(nome).split(' ');
    if (!ts[0]) return [];
    return lista.filter(function (c) {
      var a = c.k.split(' '), j = 0;
      if (!a[0]) return false;
      for (var i = 0; i < a.length; i++) {
        var t = a[i], achou = -1;
        if (t.length < 3 && (i === 0 || t.length < 1)) return false;      // inicial do apelido («Rodrigo S») vale; o 1.o nome precisa de 3 letras
        for (var k = j; k < ts.length; k++) { if (ts[k].indexOf(t) === 0) { achou = k; break; } }
        if (achou < 0) return false;
        j = achou + 1;
      }
      return true;
    });
  }
  function unicos(c) {
    var vistos = {}, out = [];
    c.forEach(function (x) { var id = (x.t[0] || '') + '|' + x.e; if (!vistos[id]) { vistos[id] = 1; out.push(x); } });
    return out;
  }

  // o que se sabe de uma pessoa: acerto a mao > contacto importado (se so ha um) > varios candidatos > nada
  function contactoDe(p, lista, manual) {
    var m = manual[p.id];
    if (m && (m.t || m.e)) return { t: m.t || '', e: m.e || '', de: 'manual' };
    var c = candidatos(p.name, lista), tels = {}, uniq = [];
    c.forEach(function (x) { var id = (x.t[0] || '') + '|' + x.e; if (!tels[id]) { tels[id] = 1; uniq.push(x); } });
    if (uniq.length === 1) return { t: uniq[0].t[0] || '', e: uniq[0].e || '', de: 'google', quem: uniq[0].n };
    if (uniq.length > 1) return { ambiguo: uniq };
    var ap = unicos(candidatosAprox(p.name, lista));      // «Rafa» para «Rafael Anchieta»: so se sugere, quem confirma es tu
    if (ap.length) return { ambiguo: ap, aproximado: true };
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
    '#vtch .b{display:inline-flex;align-items:center;justify-content:center;gap:5px;min-height:34px;padding:6px 12px;box-sizing:border-box;max-width:100%;text-align:center;border:1px solid var(--line);border-radius:9px;background:var(--panel);text-decoration:none;white-space:normal}',
    '#vtch .b:hover{background:var(--soft)}#vtch .b:disabled{opacity:.45;cursor:default}',
    '#vtch .pri{background:linear-gradient(135deg,#1246E6,var(--acc));color:#fff;border:0}#vtch .pri:hover{background:linear-gradient(135deg,#1246E6,var(--acc))}',
    '#vtch .wa{background:#1fa855;color:#fff;border:0}#vtch .wa:hover{background:#198f48}',
    '#vtch a.pri,#vtch a.wa,#vtch button.pri,#vtch button.wa{color:#fff}',
    '#vtch .perigo{color:#d6334b;border-color:#d6334b55}',
    '#vtch .nota{color:var(--mut);font-size:12px;margin:4px 0 10px}',
    '#vtch .caixa{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px;margin-bottom:12px}',
    '#vtch .caixa h4{margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut)}',
    '#vtch .linha{display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid var(--line);flex-wrap:wrap}#vtch .linha:first-of-type{border-top:0}',
    '#vtch .linha.compacta{flex-wrap:nowrap;gap:8px}#vtch .linha.compacta .nm{min-width:0}#vtch .linha.compacta .nm label{display:block;overflow:hidden;text-overflow:ellipsis}#vtch .linha.compacta .bt{display:flex;gap:6px;flex:none}#vtch .linha.compacta .b{padding:0 9px}#vtch .linha.compacta input[type=checkbox]{width:20px;height:20px;flex:none}#vtch .linha.compacta select{max-width:100%}',
    '#vtch .av{flex:none;width:34px;height:34px;border-radius:50%;display:grid;place-items:center;color:#fff;font-size:12px;font-weight:700}',
    '#vtch .nm{flex:1;min-width:140px}#vtch .nm small{display:block;color:var(--mut);font-size:12px}',
    '#vtch .ac{display:flex;gap:6px;flex-wrap:wrap;margin-left:auto}',
    '@media (max-width:560px){#vtch .ac{width:100%;margin-left:44px;width:calc(100% - 44px)}#vtch .edita{margin-left:0}}',
    '#vtch .tag{font-size:11px;padding:2px 8px;border-radius:999px;background:var(--soft);color:var(--mut);white-space:nowrap}#vtch .tag.ok{background:#1fa85526;color:#1c8a4a}#vtch .tag.aviso{background:#f5b80030;color:#8a6500}',
    '#vtch input[type=text],#vtch input[type=tel],#vtch input[type=email],#vtch textarea,#vtch select{border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);padding:7px 10px;font:inherit;max-width:100%}',
    '#vtch textarea{width:100%;min-height:96px;resize:vertical}',
    '#vtch .edita{display:flex;gap:6px;width:100%;margin:2px 0 4px 44px;flex-wrap:wrap}',
    '#vtch .rodape{position:sticky;bottom:0;display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin:0 -14px;padding:10px 14px max(10px,env(safe-area-inset-bottom));background:var(--bg);border-top:1px solid var(--line)}',
    '#vtch .erro{color:#d6334b;font-size:13px;margin:6px 0}',
    '#vtch .spin{width:26px;height:26px;border:3px solid var(--line);border-top-color:var(--acc);border-radius:50%;margin:50px auto;animation:vtchsp .8s linear infinite}@keyframes vtchsp{to{transform:rotate(360deg)}}'
  ].join('\n');

  // Android (Chrome): o telemovel deixa a pagina escolher contactos (so os que tu marcares, com o teu OK). iPhone nao tem isto: serve o ficheiro.
  var PICKER = !!(typeof navigator !== 'undefined' && navigator.contacts && navigator.contacts.select && typeof window !== 'undefined' && window.isSecureContext);
  // App Android do Video Team: a app pede a permissao de contactos ao sistema (uma vez) e entrega SO os contactos cujo nome se parece com o da equipa
  var NAT = (typeof window !== 'undefined' && window.VTNativo && typeof window.VTNativo.lerContactos === 'function') ? window.VTNativo : null;
  function copiarTexto(tx, feito) {
    function viaExec() {
      var ta = document.createElement('textarea'); ta.value = tx; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(ta); ta.select(); try { ta.setSelectionRange(0, tx.length); } catch (e) {}
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
      ta.remove();
      if (ok) feito(); else window.prompt('Copia:', tx);
    }
    try { if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(tx).then(feito, viaExec); return; } } catch (e) {}
    viaExec();
  }
  function dePicker(c) {   // {name:[], tel:[], email:[]} -> {n, k, t:[digitos], e}
    var n = (c.name && c.name[0]) || '', t = [], e = (c.email && c.email[0]) || '';
    (c.tel || []).forEach(function (x) { var f = fone(x); if (f && t.indexOf(f) < 0) t.push(f); });
    return { n: n, k: chave(n), t: t, e: e };
  }

  // Google Contactos: o navegador mostra o ecra de autorizacao do Google (so leitura de contactos). O token vive so na memoria e e revogado no fim.
  function clientId() { return String(ls(LS_CID, '') || GOOGLE_CLIENT_ID || '').trim(); }
  function carregarGsi() {
    if (typeof window === 'undefined' || (window.google && window.google.accounts && window.google.accounts.oauth2)) return Promise.resolve();
    if (window.__vtGsi) return window.__vtGsi;
    window.__vtGsi = new Promise(function (res, rej) {
      var sc = document.createElement('script'); sc.src = 'https://accounts.google.com/gsi/client'; sc.async = true;
      sc.onload = function () { res(); }; sc.onerror = function () { window.__vtGsi = null; rej(new Error('Não consegui falar com o Google (sem ligação?).')); };
      document.head.appendChild(sc);
    });
    return window.__vtGsi;
  }
  function daPessoaGoogle(c) {
    var n = (c.names && c.names[0] && c.names[0].displayName) || '', t = [], e = (c.emailAddresses && c.emailAddresses[0] && c.emailAddresses[0].value) || '';
    (c.phoneNumbers || []).forEach(function (x) { var f = fone(x.canonicalForm || x.value); if (f && t.indexOf(f) < 0) t.push(f); });
    return { n: n, k: chave(n), t: t, e: e };
  }
  function buscarGoogle(token) {
    var out = [];
    function pagina(pt, n) {
      var url = 'https://people.googleapis.com/v1/people/me/connections?personFields=names,phoneNumbers,emailAddresses&pageSize=1000&sortOrder=FIRST_NAME_ASCENDING' + (pt ? '&pageToken=' + encodeURIComponent(pt) : '');
      return fetch(url, { headers: { Authorization: 'Bearer ' + token } }).then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) throw new Error(r.status === 403 ? 'O Google recusou: ativa a «People API» no projeto (ver passo 2).' : (j && j.error && j.error.message) || 'Erro do Google ' + r.status);
          (j.connections || []).forEach(function (c) { var x = daPessoaGoogle(c); if (x.n && (x.t.length || x.e)) out.push(x); });
          return j.nextPageToken && n < 25 ? pagina(j.nextPageToken, n + 1) : out;
        });
      });
    }
    return pagina('', 0);
  }

  // ---------------------------------------------------------------- o ecra
  function abrir(ctx) {
    if (document.getElementById('vtch')) return;
    var st = document.createElement('style'); st.id = 'vtch-css'; st.textContent = CSS; document.head.appendChild(st);
    var el = document.createElement('div'); el.id = 'vtch'; document.body.appendChild(el);

    var crew = (ctx.crew || []).map(function (c) { return { id: c.id, name: limpaNome(c.name), grupo: c.grupo, days: c.days, filtrado: c.filtrado }; }).sort(function (a, b) { return a.name.localeCompare(b.name, 'pt'); });
    var ultimoDia = '';
    crew.forEach(function (c) { (c.days || []).forEach(function (d) { if (d > ultimoDia) ultimoDia = d; }); });
    var temFiltro = crew.some(function (c) { return c.filtrado; }) && crew.some(function (c) { return !c.filtrado; });
    var S = {
      autAtivo: null, aut: null, msgEnvio: '', busca: null, gerirPessoas: false,
      todos: !temFiltro, doc: null, vista: 'carregar', sel: {}, erro: '', ocupado: false, edita: null, nome: ls(LS_NOME, 'Mike'), msg: ls(LS_MSG, MSG_PADRAO),
      lista: ls(LS_G, []), manual: ls(LS_M, {}), enviados: ls(LS_ENV, {}), online: [], ass: '', copiado: null, importou: ''
    };
    crew.forEach(function (c) { S.sel[c.id] = temFiltro ? !!c.filtrado : true; });
    function pessoasVisiveis() { return crew.filter(function (c) { return S.todos || !temFiltro || c.filtrado; }); }
    var base = ctx.chatBase || CHAT_BASE;

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
    // «enviado» vem do servidor (so a marca por pessoa, igual em todos os aparelhos e sobrevive a reinstalar) e tambem do que ficou neste aparelho
    function jaEnviado(m, canal) { return !!(S.enviados[enviadoKey(m.id, canal)] || (m.enviado && m.enviado.indexOf(canal) >= 0)); }
    function marcarEnviado(id, canal) {
      S.enviados[enviadoKey(id, canal)] = 1; lsSet(LS_ENV, S.enviados);
      if (S.doc) S.doc.membros.forEach(function (m) { if (m.id === id) { m.enviado = (m.enviado || []).filter(function (x) { return x !== canal; }).concat(canal); } });
      H('/enviado', { key: ctx.sig, id: id, canal: canal }).then(function (j) { if (j && j.membros && S.doc && j.sala === S.doc.sala) { S.doc = j; if (j.online) S.online = j.online; desenhar(); } }).catch(function () {});
    }

    function avatar(nome, id) { return '<div class="av" style="background:hsl(' + hue(id) + ' 55% 45%)">' + esc(ini(nome)) + '</div>'; }

    function chipContacto(p, c) {
      if (c.ambiguo) {
        return '<select data-acao="cand" data-id="' + esc(p.id) + '"><option value="">' + (c.aproximado ? 'Será um destes? Escolhe para confirmar…' : 'Vários contactos — escolhe…') + '</option>' + c.ambiguo.map(function (x, i) { return '<option value="' + i + '">' + esc(x.n + (x.t[0] ? ' · +' + x.t[0] : '')) + '</option>'; }).join('') + '</select>';
      }
      if (c.t) return '<span class="tag ok" title="' + esc(c.quem || '') + '">' + esc(foneBonito(c.t)) + '</span>';
      if (c.e) return '<span class="tag">só email</span>';
      return '<span class="tag aviso">sem contacto</span>';
    }

    // app Android: procura por texto nos contactos do telemovel, para quem nao casou sozinho («Rafa», «Rodrigo S.»…)
    var BUSCA = !!(NAT && typeof NAT.procurar === 'function');
    function resultadosBusca(q) {
      var lista = [];
      try { lista = JSON.parse(NAT.procurar(q) || '[]'); } catch (e) { lista = []; }
      return lista.map(function (c) { var t = []; (c.t || []).forEach(function (x) { var f = fone(x); if (f && t.indexOf(f) < 0) t.push(f); }); return { n: String(c.n || ''), t: t, e: c.e || '' }; }).filter(function (c) { return c.t.length || c.e; });
    }
    function htmlResultados(b) {
      if (!b.res.length) return '<div class="nota" style="margin:6px 0">' + (b.q.length < 2 ? 'Escreve pelo menos 2 letras.' : 'Nenhum contacto com «' + esc(b.q) + '». Tenta só o primeiro nome ou parte dele.') + '</div>';
      return b.res.map(function (c, i) { return '<button class="b" style="width:100%;justify-content:space-between;margin-top:5px" data-acao="escolheBusca" data-i="' + i + '"><span>' + esc(c.n) + '</span><span class="tag ok">' + esc(c.t[0] ? foneBonito(c.t[0]) : c.e) + '</span></button>'; }).join('');
    }
    function linhaBusca(p) {
      var b = S.busca;
      return '<div class="edita" style="display:block;margin-left:0"><div style="display:flex;gap:6px"><input type="text" id="vtch-busca" value="' + esc(b.q) + '" placeholder="Procurar nos contactos do telemóvel" autocomplete="off" style="flex:1;min-width:0">' +
        '<button class="b" data-acao="fechaBusca">Fechar</button></div><div id="vtch-busca-res">' + htmlResultados(b) + '</div></div>';
    }

    function botaoContacto(p) {
      return (PICKER || BUSCA ? '<button class="b" data-acao="pick" data-id="' + esc(p.id) + '" title="Escolher o contacto no telemóvel">📇</button>' : '') +
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
      var h = caixaContactos() + '<div class="caixa"><h4>Quem entra no chat</h4><div class="nota">' + (temFiltro && !S.todos ? 'Só as ' + vis.length + ' pessoas do filtro do Video Team' + (ctx.filtroTxt ? ' (' + esc(ctx.filtroTxt) + ')' : '') + '. ' : '') +
        'Cada uma recebe o seu link pessoal e fica a ver e a escrever neste chat do evento.</div>';
      var grupos = {}; vis.forEach(function (p) { grupos[p.grupo || ''] = 1; });
      var variasCategorias = Object.keys(grupos).length > 1;
      vis.forEach(function (p) {
        var c = eu(p); if (S.sel[p.id] && c.t) comTel++;
        h += '<div class="linha compacta"><input type="checkbox" data-acao="sel" data-id="' + esc(p.id) + '" id="vtch-s' + esc(p.id) + '"' + (S.sel[p.id] ? ' checked' : '') + ' aria-label="' + esc(p.name) + '">' + avatar(p.name, p.id) +
          '<div class="nm"><label for="vtch-s' + esc(p.id) + '">' + esc(p.name) + '</label>' + (variasCategorias ? '<small>' + esc(p.grupo || '') + '</small>' : '') + '<div style="margin-top:3px">' + chipContacto(p, c) + '</div></div>' +
          '<div class="bt">' + botaoContacto(p) + '</div></div>' + (S.edita === p.id ? linhaEditar(p) : '') + (S.busca && S.busca.id === p.id ? linhaBusca(p) : '');
      });
      h += '<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap"><button class="b" data-acao="marcaTodas">Marcar todas</button><button class="b" data-acao="marcaNenhuma">Desmarcar todas</button></div>';
      if (temFiltro) h += '<div style="margin-top:8px"><button class="b" data-acao="todos">' + (S.todos ? 'Mostrar só o filtro' : 'Mostrar toda a equipa do evento (+' + (crew.length - crew.filter(function (c) { return c.filtrado; }).length) + ')') + '</button></div>';
      h += '</div>';
      h += caixaSeguranca();
      h += '<div class="caixa"><h4>O teu nome no chat</h4><input type="text" id="vtch-nome" maxlength="40" value="' + esc(S.nome) + '"><div class="nota">Aparece como «régie» ao lado do nome.</div></div>';
      h += '<div class="rodape"><span class="nota">' + n + ' pessoa' + (n === 1 ? '' : 's') + ' · ' + comTel + ' com telemóvel</span><span>' +
        (S.doc ? '<button class="b" data-acao="voltaGerir">Voltar</button> ' : '') + '<button class="b pri" data-acao="criar"' + (n && !S.ocupado ? '' : ' disabled') + '>' + (S.doc ? 'Acrescentar à sala' : 'Criar chat e preparar links') + '</button></span></div>';
      return h;
    }

    function caixaContactos() {
      var alvo = S.doc && S.vista === 'gerir' ? S.doc.membros.map(function (m) { return { id: m.id, name: m.name }; }) : pessoasVisiveis();
      var com = alvo.filter(function (p) { return eu(p).t; }).length;
      return '<div class="caixa"><h4>Contactos · ' + com + ' de ' + alvo.length + ' com telemóvel</h4><div class="nota">Os números ficam só neste aparelho. ' + (NAT ? '<b>Como no WhatsApp: o Android pede-te a permissão de contactos uma vez e depois sincroniza sozinho de cada vez que abres isto. Só são lidos os contactos com nome parecido com o da equipa.</b> ' : PICKER ? '<b>O Video Team não vê a tua agenda sozinho: carrega em «Escolher contactos no telemóvel» e, no seletor que abre, usa «Selecionar tudo» (ou marca só a equipa) e confirma. Fica guardado neste aparelho e casa com os nomes da equipa. Para um só, usa o 📇 da pessoa. </b>' : 'No iPhone ou no computador não há acesso direto aos contactos: ') + 'Em contacts.google.com: <b>Exportar → Google CSV</b>, e importa o ficheiro aqui (também serve um .vcf).</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' + (NAT ? '<button class="b pri" data-acao="sincNativo">Sincronizar com os contactos do telemóvel</button>' : '') + (PICKER && !NAT ? '<button class="b pri" data-acao="pickVarios">Escolher contactos no telemóvel</button>' : '') + '<button class="b' + (PICKER || NAT ? '' : ' pri') + '" data-acao="google">Importar do Google Contactos</button>' + '<button class="b" data-acao="importar">Importar ficheiro (.csv / .vcf)</button><input type="file" id="vtch-fich" accept=".csv,.vcf,text/csv,text/vcard,text/x-vcard" hidden>' +
        '<span class="nota" style="margin:0" role="status">' + (S.importou || (S.lista.length ? S.lista.length + ' contactos importados' : 'Ainda sem contactos importados')) + '</span>' +
        (S.lista.length ? '<button class="b perigo" data-acao="limpaContactos">Apagar importados</button>' : '') + '</div>' + (S.pedeCid || S.googleErro ? ajudaGoogle() : '') + '</div>';
    }

    // ---- seguranca: entrar como dono com o autenticador (em vez de decorar uma chave)
    function caixaSeguranca() {
      var a = S.aut, h = '<div class="caixa"><h4>Segurança · entrada do dono</h4>';
      if (a && a.fase === 'codigos') {
        h += '<div class="nota"><b>Autenticador ativo.</b> Guarda já estes 8 códigos de recuperação (cada um serve uma vez, para o caso de perderes o telemóvel). Não voltam a aparecer.</div>' +
          '<div style="font-family:ui-monospace,Menlo,monospace;font-size:15px;line-height:1.7;margin:6px 0">' + a.lista.map(esc).join('<br>') + '</div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="b" data-acao="copiar" data-t="' + esc(a.lista.join('\n')) + '" data-k="rec">' + (S.copiado === 'rec' ? 'Copiado ✓' : 'Copiar os códigos') + '</button><button class="b pri" data-acao="autFecha">Já guardei</button></div>';
      } else if (a && a.fase === 'preparar') {
        h += '<div class="nota">1. Toca em «Abrir na app de autenticador» (Google Authenticator, Aegis, Microsoft Authenticator…) e aceita adicionar. <br>2. Se não abrir, copia a chave e escolhe «introduzir chave» na app.<br>3. Escreve aqui o código de 6 dígitos que a app mostra.</div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0"><a class="b pri" href="' + esc(a.otpauth) + '">Abrir na app de autenticador</a>' +
          '<button class="b" data-acao="copiar" data-t="' + esc(a.segredo) + '" data-k="seg">' + (S.copiado === 'seg' ? 'Copiado ✓' : 'Copiar a chave') + '</button></div>' +
          '<div class="nota" style="font-family:ui-monospace,Menlo,monospace;word-break:break-all">' + esc(a.segredo.replace(/(.{4})/g, '$1 ').trim()) + '</div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap"><input type="text" id="vtch-aut" inputmode="numeric" maxlength="7" placeholder="123 456" autocomplete="one-time-code" style="width:130px"><button class="b pri" data-acao="autConfirma">Confirmar</button><button class="b" data-acao="autFecha">Cancelar</button></div>' +
          (a.erro ? '<div class="erro">' + esc(a.erro) + '</div>' : '');
      } else if (S.autAtivo) {
        h += '<div class="nota"><b>O autenticador está ativo.</b> Para entrares como dono, escreve o código de 6 dígitos da app (a chave fixa continua a servir de recuperação).</div><button class="b" data-acao="autPreparar">Mudar de telemóvel ou refazer</button>';
      } else if (S.autAtivo === false) {
        h += '<div class="nota">Em vez de decorar uma chave, entras como dono com o código de 6 dígitos da tua app de autenticador (como no Fotowall e no Conductor).</div><button class="b pri" data-acao="autPreparar">Ativar o autenticador</button>';
      } else { h += '<div class="nota">A ver…</div>'; }
      return h + '</div>';
    }
    function pedidoDono(caminho, corpo) {
      return fetch(ctx.api + caminho, { method: corpo ? 'POST' : 'GET', headers: { 'X-PIN': ctx.pin, 'Content-Type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined })
        .then(function (r) { return r.json().then(function (j) { return { r: r, j: j }; }); });
    }

    function ajudaGoogle() {
      return '<div class="nota" style="margin-top:10px">' + (S.googleErro ? '<div class="erro">' + esc(S.googleErro) + '</div>' : '') +
        (S.pedeCid ? '<b>Ligar ao Google (uma vez, 5 minutos).</b> O Google pede-te autorização em qualquer aparelho, mas primeiro é preciso um «ID de cliente»:<ol style="margin:6px 0 8px 18px;padding:0">' +
        '<li>Em <b>console.cloud.google.com</b> cria um projeto («Video Team»).</li>' +
        '<li><b>APIs e serviços → Biblioteca</b>: ativa a <b>People API</b>.</li>' +
        '<li><b>Ecrã de consentimento OAuth</b> (Google Auth Platform): tipo Externo, nome «Video Team»; em Público-alvo deixa «Em teste» e junta o teu Gmail como utilizador de teste; em Acesso a dados junta o âmbito <b>contacts.readonly</b>.</li>' +
        '<li><b>Credenciais → Criar credenciais → ID de cliente OAuth → Aplicação Web</b>; em «Origens JavaScript autorizadas» põe <b>' + esc(location.origin) + '</b>.</li>' +
        '<li>Copia o ID de cliente (acaba em .apps.googleusercontent.com) e cola aqui:</li></ol>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap"><input type="text" id="vtch-cid" placeholder="123456-abc.apps.googleusercontent.com" value="' + esc(clientId()) + '" autocomplete="off" spellcheck="false" style="flex:1;min-width:200px">' +
        '<button class="b pri" data-acao="gravaCid">Guardar e importar</button></div>' : '') + '</div>';
    }

    // ---- 2) gerir: links por pessoa
    function caixaConvite() {
      var d = S.doc, cv = d.convite, entraram = d.membros.filter(function (m) { return m.entrou; }).length;
      var h = '<div class="caixa"><h4>Link geral · para o teu grupo de WhatsApp</h4>';
      if (!cv) {
        return h + '<div class="nota">Um só link para colares no teu grupo: cada pessoa abre-o, <b>escolhe o seu nome</b> e entra. Mais rápido do que um link por pessoa. Cada nome só entra uma vez (e podes libertar o lugar se alguém se enganar), mas quem tiver o link pode escolher um nome que não é o seu — por isso usa-o em grupos de confiança.</div>' +
          '<button class="b pri" data-acao="convCria">Criar o link geral</button></div>';
      }
      var url = CHAT_BASE + '#c=' + cv.token;
      var msg = 'Chat do evento «' + (ctx.titulo || 'evento') + '»: abre este link, toca no teu nome e já estás dentro: ' + url;
      h += '<div class="nota"><b>' + entraram + ' de ' + d.membros.length + ' já entraram.</b> ' + (cv.ativo ? 'O link está ativo.' : 'O link está desativado: ninguém entra por ele.') + '</div>' +
        '<div class="nota" style="word-break:break-all;font-family:ui-monospace,Menlo,monospace">' + esc(url) + '</div><div style="display:flex;gap:8px;flex-wrap:wrap">' +
        (cv.ativo ? '<a class="b wa" href="https://wa.me/?text=' + encodeURIComponent(msg) + '" target="_blank" rel="noopener">Enviar para um grupo no WhatsApp</a>' : '') +
        '<button class="b" data-acao="copiar" data-t="' + esc(msg) + '" data-k="conv">' + (S.copiado === 'conv' ? 'Copiado ✓' : 'Copiar mensagem') + '</button>' +
        '<button class="b" data-acao="convAtiva">' + (cv.ativo ? 'Desativar' : 'Ativar') + '</button>' +
        '<button class="b" data-acao="convNovo">' + (S.conf === 'convNovo' ? 'Tens a certeza? (o antigo deixa de servir)' : 'Novo link') + '</button></div></div>';
      return h;
    }

    function caixaExternos() {
      return '<div class="caixa"><h4>Pessoas de fora da escala</h4><div class="nota">Clientes, fornecedores… O link dela envia-se como o das outras. Os <b>gestores</b> também podem acrescentar pessoas de fora, a partir do próprio chat; <b>só leitura</b> lê mas não escreve.</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap"><input type="text" id="vtch-extnome" placeholder="Nome" maxlength="80" autocomplete="off" style="flex:1;min-width:140px">' +
        '<select id="vtch-exttipo" aria-label="Tipo"><option value="participante">Participante</option><option value="leitura">Só leitura</option><option value="gestor">Gestor</option></select>' +
        '<input type="tel" id="vtch-exttel" placeholder="Telemóvel (opcional)" inputmode="tel" autocomplete="off" style="flex:1;min-width:140px"></div>' +
        '<div style="margin-top:8px"><button class="b pri" data-acao="extAdd">Adicionar</button></div></div>';
    }

    function porEnviar() {
      return S.doc.membros.filter(function (m) { return eu({ id: m.id, name: m.name }).t && !m.entrou && !jaEnviado(m, 'wa'); });      // quem ja entrou no chat nao precisa do link
    }

    function gerir() {
      var d = S.doc, h = '';
      h += '<div class="caixa"><h4>Mensagem a enviar</h4><textarea id="vtch-msg" aria-label="Mensagem">' + esc(S.msg) + '</textarea>' +
        '<div class="nota">{nome} {evento} e {link} são trocados por pessoa. <button class="b" data-acao="msgPadrao" style="height:26px">Repor</button></div></div>';
      var semTel = d.membros.filter(function (m) { return !eu({ id: m.id, name: m.name }).t; }).length;
      if (semTel) h = caixaContactos() + h;
      h += '<div class="caixa"><h4>Tu (régie)</h4><div class="linha">' + avatar(d.dono.nome, 'dono') + '<div class="nm">' + esc(d.dono.nome) + '<small>fixas mensagens no topo para todos</small></div><div class="ac">' +
        '<a class="b pri" href="' + esc(link(d.dono.token)) + '" target="_blank" rel="noopener">Abrir o chat</a><button class="b" data-acao="copiar" data-t="' + esc(link(d.dono.token)) + '" data-k="dono">' + (S.copiado === 'dono' ? 'Copiado ✓' : 'Copiar link') + '</button></div></div></div>';
      h += caixaConvite();
      h += caixaExternos();
      h += '<div class="caixa"><h4 style="display:flex;justify-content:space-between;align-items:center;gap:8px">Pessoas (' + d.membros.length + ')<button class="b' + (S.gerirPessoas ? ' on' : '') + '" data-acao="gerirTog" style="height:30px;text-transform:none;letter-spacing:0">' + (S.gerirPessoas ? 'Concluir' : 'Gerir pessoas') + '</button></h4>' + (S.gerirPessoas ? '<div class="nota">Aqui mudas o tipo de cada pessoa (participante, só leitura ou gestor), libertas um lugar ou retiras alguém.</div>' : '');
      var gruposG = {}; d.membros.forEach(function (m) { gruposG[m.grupo || ''] = 1; });
      var variasG = Object.keys(gruposG).length > 1;
      d.membros.forEach(function (m) {
        var p = { id: m.id, name: m.name, grupo: m.grupo }, c = eu(p), msg = texto(m.name, m.token), acoes = '';
        function marca(canal) { return jaEnviado(m, canal) ? ' ✓' : ''; }
        if (c.t) {
          acoes += '<a class="b wa" data-acao="enviado" data-id="' + esc(m.id) + '" data-canal="wa" href="https://wa.me/' + c.t + '?text=' + encodeURIComponent(msg) + '" target="_blank" rel="noopener">WhatsApp' + marca('wa') + '</a>';
          acoes += '<a class="b" data-acao="enviado" data-id="' + esc(m.id) + '" data-canal="sms" href="sms:+' + c.t + '?&body=' + encodeURIComponent(msg) + '">SMS' + marca('sms') + '</a>';
        }
        if (c.e) acoes += '<a class="b" data-acao="enviado" data-id="' + esc(m.id) + '" data-canal="mail" href="mailto:' + esc(c.e) + '?subject=' + encodeURIComponent('Chat do evento ' + (ctx.titulo || '')) + '&body=' + encodeURIComponent(msg) + '">Email' + marca('mail') + '</a>';
        acoes += '<button class="b" data-acao="copiar" data-t="' + esc(msg) + '" data-k="' + esc(m.id) + '">' + (S.copiado === m.id ? 'Copiado ✓' : 'Copiar') + '</button>';
        if (S.gerirPessoas) acoes += '<select data-acao="tipoSel" data-id="' + esc(m.id) + '" aria-label="Tipo de ' + esc(m.name) + '"><option value="participante"' + (m.tipo === 'participante' || !m.tipo ? ' selected' : '') + '>Participante</option><option value="leitura"' + (m.tipo === 'leitura' ? ' selected' : '') + '>Só leitura</option><option value="gestor"' + (m.tipo === 'gestor' ? ' selected' : '') + '>Gestor</option></select>';
        if (S.gerirPessoas && m.entrou) acoes += '<button class="b" data-acao="liberta" data-id="' + esc(m.id) + '" title="Se alguém escolheu este nome por engano: o aparelho dele perde o acesso e o lugar fica livre">' + (S.conf === 'lib:' + m.id ? 'Libertar? Toca outra vez' : 'Libertar lugar') + '</button>';
        if (S.gerirPessoas) acoes += '<button class="b perigo" data-acao="remover" data-id="' + esc(m.id) + '" title="Retirar do chat (o link dela deixa de funcionar)">' + (S.conf === 'rem:' + m.id ? 'Retirar? Toca outra vez' : '✕') + '</button>';
        var enviado = jaEnviado(m, 'wa') || jaEnviado(m, 'sms') || jaEnviado(m, 'mail');
        h += '<div class="linha">' + avatar(m.name, m.id) + '<div class="nm">' + esc(m.name) + (variasG ? '<small>' + esc(m.grupo || '') + '</small>' : '') +
          '<div style="margin-top:3px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">' + chipContacto(p, c) + (enviado ? '<span class="tag ok">enviado</span>' : '') + (m.entrou ? '<span class="tag ok">entrou</span>' : '') + (S.online.indexOf(m.id) >= 0 ? '<span class="tag ok" style="background:#1fa855;color:#fff">● ligado</span>' : '') + (m.externo ? '<span class="tag">de fora</span>' : '') +
          (m.tipo === 'gestor' ? '<span class="tag aviso">gestor</span>' : m.tipo === 'leitura' ? '<span class="tag">só leitura</span>' : '') + '</div></div>' +
          '<div style="display:flex;gap:6px;flex:none">' + botaoContacto(p) + '</div><div class="ac">' + acoes + '</div></div>' + (S.edita === m.id ? linhaEditar(p) : '') + (S.busca && S.busca.id === m.id ? linhaBusca(p) : '');
      });
      h += '</div>';
      h += caixaSeguranca();
      h += '<div class="caixa"><h4>Gerir o chat</h4><div class="nota"><b>Dura o tempo do evento:</b> até ' + new Date(d.expira).toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' }) + ', às ' +
        new Date(d.expira).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }) + '. Depois, o chat e todas as mensagens apagam-se sozinhos.</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="b" data-acao="prolonga">Prolongar 1 dia</button><button class="b" data-acao="maisPessoas">Acrescentar pessoas</button><button class="b perigo" data-acao="fechar">' + (S.conf === 'fechar' ? 'Tens a certeza? Toca outra vez (apaga tudo)' : 'Fechar o chat') + '</button></div></div>';
      var pe = porEnviar();
      if (pe.length || S.msgEnvio) h += '<div class="rodape"><span class="nota">' + (S.msgEnvio ? esc(S.msgEnvio) : pe.length + ' por enviar · próxima: ' + esc(pe[0].name)) + '</span>' +
        '<button class="b wa" data-acao="proxima"' + (pe.length ? '' : ' disabled') + '>WhatsApp: próxima pessoa</button></div>';
      return h;
    }

    function desenhar() {
      var corpo;
      if (S.vista === 'carregar') corpo = '<div class="spin" aria-label="A carregar"></div>';
      else corpo = (S.vista === 'gerir' && S.doc ? gerir() : escolher());
      var lig = S.doc ? S.doc.membros.filter(function (m) { return S.online.indexOf(m.id) >= 0; }).length : 0;
      var sub = S.doc ? 'Chat criado · ' + S.doc.membros.length + ' pessoas' + (lig ? ' · ' + lig + ' ligadas' : '') : 'Novo chat';
      el.innerHTML = '<div class="top"><b>Chat do evento<small>' + esc(ctx.titulo || '') + ' · ' + esc(sub) + '</small></b><button class="x" data-acao="sair" aria-label="Fechar">✕</button></div>' +
        '<div class="corpo">' + (S.erro ? '<div class="erro" role="alert">' + esc(S.erro) + '</div>' : '') + corpo + '</div>';
    }

    // guarda o que esta nas caixas antes de redesenhar
    function lerCaixas() {
      var n = document.getElementById('vtch-nome'); if (n) { S.nome = n.value.trim() || 'Mike'; lsSet(LS_NOME, S.nome); }
      var m = document.getElementById('vtch-msg'); if (m) { S.msg = m.value || MSG_PADRAO; lsSet(LS_MSG, S.msg); }
    }

    // tem de arrancar logo no clique (senao o navegador bloqueia a janela do Google): o script do Google e carregado ao abrir este ecra
    function consultasNativas() {          // os 3 primeiros caracteres de cada nome da equipa: o telemovel so devolve contactos que lhes correspondam
      var q = {};
      crew.forEach(function (c) { chave(c.name).split(' ').forEach(function (t) { if (t.length >= 3) q[t.slice(0, 3)] = 1; }); });
      return Object.keys(q);
    }
    function sincronizarNativo(pedir) {
      if (!NAT) return;
      var ir = function () {
        var txt = '', lista = [];
        try { txt = NAT.lerContactos(JSON.stringify(consultasNativas())); } catch (e) { txt = ''; }
        try {
          lista = JSON.parse(txt || '[]').map(function (c) {
            var t = []; (c.t || []).forEach(function (x) { var f = fone(x); if (f && t.indexOf(f) < 0) t.push(f); });
            return { n: String(c.n || ''), k: chave(c.n), t: t, e: c.e || '', tel: 1 };
          }).filter(function (c) { return c.n && (c.t.length || c.e); });
        } catch (e) { lista = []; }
        S.lista = S.lista.filter(function (x) { return !x.tel; }).concat(lista);     // os do telemovel sao substituidos pelos de agora; os de ficheiro/Google ficam
        lsSet(LS_G, S.lista);
        S.googleErro = '';
        S.importou = lista.length + ' contactos sincronizados do telemóvel (' + new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }) + ')';
        desenhar();
      };
      var tem = false; try { tem = !!NAT.temPermissao(); } catch (e) {}
      if (tem) { ir(); return; }
      if (!pedir) return;
      S.importou = 'À espera da tua permissão…'; desenhar();
      window.__vtPerm = function (ok) {
        window.__vtPerm = null;
        if (ok) ir();
        else { S.importou = ''; S.googleErro = 'Sem permissão aos contactos. Podes dá-la em Definições do Android → Apps → Video Team → Permissões → Contactos.'; desenhar(); }
      };
      try { NAT.pedirPermissao(); } catch (e) { window.__vtPerm = null; S.importou = ''; S.googleErro = 'Não consegui pedir a permissão ao Android.'; desenhar(); }
    }

    function importarGoogle(cid) {
      S.googleErro = ''; S.importou = 'A pedir autorização ao Google…'; desenhar();
      var g = window.google && window.google.accounts && window.google.accounts.oauth2;
      if (!g) { S.importou = ''; S.googleErro = 'O Google ainda está a carregar. Tenta outra vez daqui a um segundo.'; carregarGsi().catch(function (e) { S.googleErro = e.message; desenhar(); }); desenhar(); return; }
      var token = null;
      new Promise(function (res, rej) {
        var tc = g.initTokenClient({
          client_id: cid, scope: GOOGLE_SCOPE,
          callback: function (resp) { if (resp && resp.access_token) res(resp.access_token); else rej(new Error((resp && (resp.error_description || resp.error)) || 'O Google não deu autorização.')); },
          error_callback: function (e) { rej(new Error(e && e.type === 'popup_closed' ? 'Fechaste a janela do Google antes de autorizar.' : e && e.type === 'popup_failed_to_open' ? 'O navegador bloqueou a janela do Google. Permite pop-ups para este site.' : (e && (e.message || e.type)) || 'Falhou a autorização.')); }
        });
        tc.requestAccessToken({ prompt: '' });
      }).then(function (t) { token = t; S.importou = 'A ler os contactos…'; desenhar(); return buscarGoogle(t); }).then(function (lista) {
        if (!lista.length) { S.importou = ''; S.googleErro = 'Não encontrei contactos com nome e telefone na tua conta Google.'; return; }
        S.lista = lista;
        S.importou = lista.length + ' contactos importados do Google' + (lsSet(LS_G, lista) ? '' : ' (não cabem na memória deste aparelho: servem só até fechares isto)');
      }).catch(function (e) { S.importou = ''; S.googleErro = e && e.message === 'Failed to fetch' ? 'Sem ligação ao Google.' : (e && e.message) || 'Erro.'; })
        .then(function () { try { if (token && g.revoke) g.revoke(token, function () {}); } catch (x) { /* o token expira sozinho */ } desenhar(); });
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

    el.addEventListener('input', function (ev) {
      if (ev.target && ev.target.id === 'vtch-busca' && S.busca) {
        S.busca.q = ev.target.value.trim();
        S.busca.res = S.busca.q.length >= 2 ? resultadosBusca(S.busca.q) : [];
        var cx = document.getElementById('vtch-busca-res'); if (cx) cx.innerHTML = htmlResultados(S.busca);
      }
    });

    el.addEventListener('change', function (ev) {
      var t = ev.target, a = t.getAttribute && t.getAttribute('data-acao');
      if (t.id === 'vtch-fich' && t.files && t.files[0]) { importar(t.files[0]); return; }
      if (a === 'tipoSel') { tratar(H('/tipo', { key: ctx.sig, id: t.getAttribute('data-id'), tipo: t.value }), function (j) { S.doc = j; }); }
      else if (a === 'sel') { S.sel[t.getAttribute('data-id')] = t.checked; lerCaixas(); desenhar(); }
      else if (a === 'cand' && t.value !== '') {
        var id = t.getAttribute('data-id'), p = crew.filter(function (c) { return c.id === id; })[0] || (S.doc && S.doc.membros.filter(function (m) { return m.id === id; })[0]);
        var c = candidatos(p.name, S.lista);
        if (!c.length) c = candidatosAprox(p.name, S.lista);
        var x = unicos(c)[+t.value];
        if (x) { S.manual[id] = { t: x.t[0] || '', e: x.e || '' }; lsSet(LS_M, S.manual); lerCaixas(); desenhar(); }
      }
    });

    el.addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('[data-acao]') : null;
      if (!b || b.tagName === 'SELECT' || b.tagName === 'INPUT') return;
      var a = b.getAttribute('data-acao'), id = b.getAttribute('data-id');
      var conf = S.conf; S.conf = null;                    // qualquer outro toque cancela uma confirmacao pendente
      function pedeConfirmar(chv) { S.conf = chv; desenhar(); setTimeout(function () { if (S.conf === chv) { S.conf = null; desenhar(); } }, 5000); }
      if (a === 'sair') { el.remove(); var s = document.getElementById('vtch-css'); if (s) s.remove(); return; }
      lerCaixas();
      if (a === 'autPreparar') {
        pedidoDono('/api/admin/autenticador/preparar', {}).then(function (x) {
          if (x.r.ok && x.j.segredo) S.aut = { fase: 'preparar', segredo: x.j.segredo, otpauth: x.j.otpauth, erro: '' };
          else S.erro = (x.j && x.j.error) || 'Não consegui preparar o autenticador.';
          desenhar();
        }).catch(function () { S.erro = 'Sem ligação ao servidor.'; desenhar(); });
        return;
      }
      if (a === 'autFecha') { S.aut = null; desenhar(); return; }
      if (a === 'autConfirma') {
        var cod = ((document.getElementById('vtch-aut') || {}).value || '').replace(/\s+/g, '');
        if (!/^\d{6}$/.test(cod)) { S.aut.erro = 'Escreve os 6 dígitos que a app mostra.'; desenhar(); return; }
        pedidoDono('/api/admin/autenticador/confirmar', { codigo: cod }).then(function (x) {
          if (x.r.ok && x.j.recuperacao) { S.autAtivo = true; S.aut = { fase: 'codigos', lista: x.j.recuperacao }; }
          else S.aut.erro = (x.j && x.j.error) || 'Esse código não bate certo.';
          desenhar();
        }).catch(function () { S.aut.erro = 'Sem ligação ao servidor.'; desenhar(); });
        return;
      }
      if (a === 'gerirTog') { S.gerirPessoas = !S.gerirPessoas; desenhar(); return; }
      if (a === 'extAdd') {
        var nomeX = ((document.getElementById('vtch-extnome') || {}).value || '').trim(), tipoX = (document.getElementById('vtch-exttipo') || {}).value || 'participante';
        var telX = fone((document.getElementById('vtch-exttel') || {}).value), telBruto = ((document.getElementById('vtch-exttel') || {}).value || '').trim();
        if (nomeX.length < 2) { S.erro = 'Escreve o nome da pessoa.'; desenhar(); return; }
        if (telBruto && !telX) { S.erro = 'Esse telemóvel não parece válido.'; desenhar(); return; }
        var antesIds = {}; S.doc.membros.forEach(function (m) { antesIds[m.id] = 1; });
        tratar(H('/adicionar', { key: ctx.sig, nome: nomeX, tipo: tipoX }), function (j) {
          S.doc = j;
          var novo = j.membros.filter(function (m) { return !antesIds[m.id]; })[0];
          if (novo && telX) { S.manual[novo.id] = { t: telX, e: '' }; lsSet(LS_M, S.manual); }   // o numero fica so neste aparelho
        });
        return;
      }
      if (a === 'prolonga') { tratar(H('/prolongar', { key: ctx.sig, dias: 1 }), function (j) { S.doc = j; }); return; }
      if (a === 'convCria' || a === 'convAtiva' || a === 'convNovo') {
        if (a === 'convNovo' && conf !== 'convNovo') { pedeConfirmar('convNovo'); return; }
        var corpoC = { key: ctx.sig };
        if (a === 'convNovo') corpoC.renovar = true;
        if (a === 'convAtiva') corpoC.ativo = !(S.doc.convite && S.doc.convite.ativo);
        tratar(H('/convite', corpoC), function (j) { S.doc = j; });
        return;
      }
      if (a === 'liberta') {
        if (conf !== 'lib:' + id) { pedeConfirmar('lib:' + id); return; }
        tratar(H('/libertar', { key: ctx.sig, id: id }), function (j) { S.doc = j; });
        return;
      }
      if (a === 'proxima') {
        var fila = porEnviar();
        if (!fila.length) { S.msgEnvio = ''; desenhar(); return; }
        var m1 = fila[0], c1 = eu({ id: m1.id, name: m1.name });
        marcarEnviado(m1.id, 'wa');
        S.msgEnvio = 'A abrir o WhatsApp de ' + m1.name + '… envia a mensagem e volta aqui para a próxima.';
        var al = document.createElement('a'); al.href = 'https://wa.me/' + c1.t + '?text=' + encodeURIComponent(texto(m1.name, m1.token)); al.target = '_blank'; al.rel = 'noopener';
        document.body.appendChild(al); al.click(); al.remove();
        desenhar();
        setTimeout(function () { S.msgEnvio = ''; desenhar(); }, 6000);
        return;
      }
      if (a === 'sincNativo') { sincronizarNativo(true); return; }
      if (a === 'google') {
        var cid = clientId();
        if (!cid) { S.pedeCid = true; S.googleErro = ''; desenhar(); return; }
        importarGoogle(cid);
        return;
      }
      if (a === 'gravaCid') {
        var v = ((document.getElementById('vtch-cid') || {}).value || '').trim();
        if (!/^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(v)) { S.googleErro = 'Esse ID de cliente não parece válido (termina em .apps.googleusercontent.com).'; desenhar(); return; }
        lsSet(LS_CID, v); S.pedeCid = false; S.googleErro = ''; importarGoogle(v);
        return;
      }
      if (a === 'marcaTodas' || a === 'marcaNenhuma') { pessoasVisiveis().forEach(function (c) { S.sel[c.id] = a === 'marcaTodas'; }); desenhar(); return; }
      if (a === 'todos') { S.todos = !S.todos; desenhar(); return; }
      if (a === 'pick' && BUSCA) {
        var pe = crew.filter(function (c) { return c.id === id; })[0] || (S.doc && S.doc.membros.filter(function (m) { return m.id === id; })[0]);
        var q0 = chave(pe ? pe.name : '').split(' ')[0].slice(0, 4);
        S.busca = S.busca && S.busca.id === id ? null : { id: id, q: q0, res: resultadosBusca(q0) };
        desenhar();
        return;
      }
      if (a === 'fechaBusca') { S.busca = null; desenhar(); return; }
      if (a === 'escolheBusca' && S.busca) {
        var esc_ = S.busca.res[+b.getAttribute('data-i')];
        if (esc_) { S.manual[S.busca.id] = { t: esc_.t[0] || '', e: esc_.e || '' }; lsSet(LS_M, S.manual); }
        S.busca = null; desenhar();
        return;
      }
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
        copiarTexto(tx, function () { S.copiado = k; desenhar(); setTimeout(function () { if (S.copiado === k) { S.copiado = null; desenhar(); } }, 1800); });
        return;
      }
      if (a === 'enviado') { marcarEnviado(id, b.getAttribute('data-canal')); setTimeout(desenhar, 300); return; }   // o link abre sozinho
      if (a === 'voltaGerir') { S.vista = 'gerir'; desenhar(); return; }
      if (a === 'maisPessoas') { S.todos = true; crew.forEach(function (c) { S.sel[c.id] = !S.doc.membros.some(function (m) { return m.id === c.id; }) && (!temFiltro || !!c.filtrado); }); S.vista = 'escolher'; desenhar(); return; }
      if (a === 'criar') {
        var membros = crew.filter(function (c) { return S.sel[c.id]; }).map(function (c) { return { id: c.id, name: c.name, grupo: c.grupo || '' }; });
        tratar(H('/criar', { key: ctx.sig, label: ctx.titulo, ate: ultimoDia, membros: membros, donoNome: S.nome }), function (j) { S.doc = j; S.vista = 'gerir'; });
        return;
      }
      if (a === 'remover') {
        if (conf !== 'rem:' + id) { pedeConfirmar('rem:' + id); return; }
        tratar(H('/remover', { key: ctx.sig, id: id }), function (j) { S.doc = j; });
        return;
      }
      if (a === 'fechar') {
        if (conf !== 'fechar') { pedeConfirmar('fechar'); return; }
        tratar(H('/fechar', { key: ctx.sig }), function () { S.doc = null; S.vista = 'escolher'; });
      }
    });

    desenhar();
    fetch(ctx.api + '/api/dono/estado').then(function (r) { return r.json(); }).then(function (j) { S.autAtivo = !!j.autenticador; desenhar(); }).catch(function () { S.autAtivo = null; });
    if (NAT) sincronizarNativo(false);
    if (typeof document !== 'undefined' && !NAT) carregarGsi().catch(function () { /* sem Google: continua a haver ficheiro e telemovel */ });
    H('?key=' + encodeURIComponent(ctx.sig)).then(function (j) {
      if (j.existe) { S.doc = j; S.online = j.online || []; S.ass = JSON.stringify([j.membros, j.online, j.convite]); S.vista = 'gerir'; } else S.vista = 'escolher';
      desenhar();
    }).catch(function (e) { S.vista = 'escolher'; S.erro = (e && e.message) || 'Sem ligação ao servidor.'; desenhar(); });
    // enquanto o painel esta aberto, vai buscar o estado real ao servidor (quem entrou, quem esta ligado, o que ja foi enviado)
    var tm = setInterval(function () {
      if (!document.body.contains(el)) { clearInterval(tm); return; }
      var a = document.activeElement;
      if (S.vista !== 'gerir' || S.ocupado || document.hidden || (a && el.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
      H('?key=' + encodeURIComponent(ctx.sig)).then(function (j) {
        if (!j || !j.existe || S.vista !== 'gerir' || S.ocupado) return;
        var ass = JSON.stringify([j.membros, j.online, j.convite]);
        if (ass === S.ass) return;
        S.ass = ass; S.doc = j; S.online = j.online || [];
        var c0 = el.querySelector('.corpo'), y0 = c0 ? c0.scrollTop : 0, e0 = el.scrollTop;
        desenhar();
        var c1 = el.querySelector('.corpo'); if (c1) c1.scrollTop = y0; el.scrollTop = e0;
      }).catch(function () {});
    }, 15000);
  }

  root.__vtChat = { abrir: abrir, _t: { chave: chave, fone: fone, lerCsv: lerCsv, lerVcf: lerVcf, candidatos: candidatos, candidatosAprox: candidatosAprox, contactoDe: contactoDe } };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.__vtChat;
})(typeof window !== 'undefined' ? window : globalThis);
