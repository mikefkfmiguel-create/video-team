// Video Team — editor «Equipa por sala» (so o dono). Precisa de salas-motor.js carregado antes.
// window.__vtSalas.abrir({api, pin, sig, titulo, evento, code, anchor}) abre o editor em ecra inteiro.
// Fala com o Worker (/api/admin/sala). Nunca mostra nem guarda contactos.
(function (root) {
  var M = root.__vtSalasMotor;
  var DOW = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  var MON = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  var TIPOS = {
    semDestino: 'Sem destino', duasSalas: 'Em duas salas', foraEscala: 'Fora da escala oficial',
    salaSemMix: 'Sala sem MIX', salaSemCam: 'Sala sem câmara'
  };
  var REGRA_TXT = {
    semDestino: 'Avisar quem está na escala e ainda não tem destino', duasSalas: 'Avisar pessoa em duas salas no mesmo dia',
    foraEscala: 'Avisar destino de quem já não está na escala', salaSemMix: 'Avisar sala sem MIX', salaSemCam: 'Avisar sala sem câmara'
  };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function fromKey(k) { var p = k.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function fmt(k) { var d = fromKey(k); return DOW[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()]; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  var CSS = [
    '#vtsl{position:fixed;inset:0;z-index:40;background:var(--bg);color:var(--ink);display:flex;flex-direction:column;font:14px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
    '#vtsl button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;padding:0}',
    '#vtsl .sl-top{display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--panel);border-bottom:1px solid var(--line)}',
    '#vtsl .sl-top b{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:16px}',
    '#vtsl .sl-st{font-size:12px;color:var(--mut);white-space:nowrap}#vtsl .sl-st.err{color:#ff5d73;text-decoration:underline;cursor:pointer}',
    '#vtsl .b{height:32px;padding:0 12px;border:1px solid var(--line);border-radius:8px;background:var(--panel);white-space:nowrap}#vtsl .b:hover{background:var(--soft)}#vtsl .b:disabled{opacity:.45}',
    '#vtsl .b.pri{background:linear-gradient(135deg,#1246E6,var(--acc));color:#fff;border:0}#vtsl .b.on{background:var(--acc);color:#fff;border-color:var(--acc)}',
    '#vtsl .sl-tabs{display:flex;gap:4px;padding:8px 14px 0;background:var(--panel);border-bottom:1px solid var(--line)}',
    '#vtsl .sl-tabs button{padding:8px 14px;border-radius:8px 8px 0 0;color:var(--mut);font-weight:600}#vtsl .sl-tabs button.on{color:var(--acc);box-shadow:inset 0 -3px 0 var(--acc)}',
    '#vtsl .badge{display:inline-block;min-width:18px;padding:0 5px;margin-left:5px;border-radius:9px;background:#ff5d73;color:#fff;font-size:11px;text-align:center}',
    '#vtsl .sl-body{flex:1;overflow:auto;padding:14px;max-width:980px;width:100%;margin:0 auto}',
    '#vtsl .strip{display:flex;gap:4px;overflow-x:auto;padding-bottom:10px}',
    '#vtsl .sd{flex:none;width:54px;padding:6px 0;border-radius:10px;display:flex;flex-direction:column;align-items:center;color:var(--mut);font-size:11px;background:var(--panel);border:1px solid var(--line)}#vtsl .sd b{font-size:17px;color:var(--ink)}#vtsl .sd i{font-style:normal;font-size:10px;min-height:12px;color:#ff5d73}',
    '#vtsl .sd.on{background:linear-gradient(135deg,#1246E6,var(--acc));color:#fff;border:0}#vtsl .sd.on b,#vtsl .sd.on i{color:#fff}',
    '#vtsl .bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:4px 0 12px}#vtsl .bar .grow{flex:1}',
    '#vtsl .sel{position:sticky;top:-14px;z-index:2;display:flex;gap:8px;align-items:center;padding:8px 10px;margin:0 0 10px;border-radius:10px;background:var(--acc);color:#fff}#vtsl .sel .b{background:#fff;color:#0C1020;border:0}',
    '#vtsl .box{background:var(--panel);border:1px solid var(--line);border-radius:12px;margin-bottom:10px;overflow:hidden}',
    '#vtsl .box>h3{margin:0;padding:9px 12px;font-size:13px;display:flex;gap:8px;align-items:center;border-bottom:1px solid var(--line);background:var(--soft)}',
    '#vtsl .box>h3 small{color:var(--mut);font-weight:400}#vtsl .box>h3 .w{margin-left:auto;color:#d98200;font-size:12px;font-weight:600}',
    '#vtsl .box.warn{border-color:#d98200}#vtsl .rows{padding:6px}',
    '#vtsl .pp{display:inline-flex;align-items:center;gap:6px;margin:3px;padding:6px 10px;border-radius:999px;background:var(--soft);border:1px solid var(--line)}#vtsl .pp.sel1{background:var(--acc);color:#fff;border-color:var(--acc)}#vtsl .pp small{color:var(--mut)}#vtsl .pp.sel1 small{color:#fff;opacity:.85}',
    '#vtsl .rw{display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:7px 8px;border-radius:8px}#vtsl .rw:hover{background:var(--soft)}#vtsl .rw.sel1{background:var(--acc);color:#fff}#vtsl .rw span.f{margin-left:auto;color:var(--mut);font-size:12px}#vtsl .rw.sel1 span.f{color:#fff}',
    '#vtsl .empty{color:var(--mut);padding:10px 12px;font-size:13px}',
    '#vtsl .cfg h4{margin:18px 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut)}#vtsl .cfg .ln{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:6px}',
    '#vtsl input[type=text],#vtsl input[type=date],#vtsl select{height:32px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--ink);padding:0 8px;font:inherit}#vtsl input[type=text]{min-width:150px}',
    '#vtsl label.ck{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border:1px solid var(--line);border-radius:8px;background:var(--panel)}#vtsl label.ck input{accent-color:var(--acc)}',
    '#vtsl .it{display:flex;gap:10px;align-items:center;width:100%;text-align:left;padding:9px 12px;border-radius:10px;background:var(--panel);border:1px solid var(--line);margin-bottom:6px}#vtsl .it.ign{opacity:.5}#vtsl .it .t{font-size:11px;color:var(--mut);text-transform:uppercase;letter-spacing:.04em;min-width:130px}#vtsl .it .x{margin-left:auto}',
    '#vtsl .note{color:var(--mut);font-size:12px;margin:4px 0}',
    '#vtsl-md{position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.4);display:flex;align-items:flex-end;justify-content:center}',
    '#vtsl-md .mp{width:min(560px,100%);max-height:92vh;overflow:auto;background:var(--panel);color:var(--ink);border-radius:16px 16px 0 0;padding:18px;font:14px/1.35 system-ui,sans-serif}',
    '@media (min-width:700px){#vtsl-md{align-items:center}#vtsl-md .mp{border-radius:16px}}',
    '#vtsl-md h3{margin:0 0 4px;font-size:17px}#vtsl-md h5{margin:14px 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut)}',
    '#vtsl-md .ch{display:flex;flex-wrap:wrap;gap:6px}#vtsl-md .ch button{padding:8px 13px;border-radius:999px;border:1px solid var(--line);background:var(--soft);color:var(--ink);font:inherit;cursor:pointer}#vtsl-md .ch button.on{background:var(--acc);color:#fff;border-color:var(--acc)}',
    '#vtsl-md .ac{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}#vtsl-md .ac button{height:38px;padding:0 16px;border-radius:10px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font:inherit;cursor:pointer}#vtsl-md .ac button.pri{background:linear-gradient(135deg,#1246E6,var(--acc));color:#fff;border:0;font-weight:600}',
    '#vtsl-md .mut{color:var(--mut);font-size:12px}'
  ].join('\n');

  function abrir(ctx) {
    if (!M) { alert('Falta o motor das salas (salas-motor.js).'); return; }
    if (document.getElementById('vtsl')) return;
    var st = document.createElement('style'); st.id = 'vtsl-css'; st.textContent = CSS; document.head.appendChild(st);
    var el = document.createElement('div'); el.id = 'vtsl'; document.body.appendChild(el);
    var md = document.createElement('div'); md.id = 'vtsl-md'; md.style.display = 'none'; document.body.appendChild(md);

    var S = { doc: null, crew: [], rev: 0, day: null, tab: 'dist', sel: {}, selMode: false, status: 'a carregar…', statusErr: false, undo: [], pk: null, loadErr: null, saving: false, pending: false };
    var timer = null;

    function H(path, opt) {
      opt = opt || {};
      return fetch(ctx.api + path, {
        method: opt.body ? 'POST' : 'GET',
        headers: { 'X-PIN': ctx.pin, 'Content-Type': 'application/json' },
        body: opt.body ? JSON.stringify(opt.body) : undefined
      });
    }

    function equipa() { return M.equipa(S.doc, S.crew); }
    function person(id) { return S.crew.filter(function (p) { return p.id === id; })[0]; }
    function nome(id) { var p = person(id); return p ? p.name : id; }
    function salaNome(id) { var s = S.doc.salas.filter(function (x) { return x.id === id; })[0]; return s ? s.nome : ''; }
    function funcNome(ids) { return ids.map(function (i) { var f = S.doc.funcoes.filter(function (x) { return x.id === i; })[0]; return f ? f.nome : ''; }).filter(Boolean).join(' + '); }
    function avisos() { return M.validar(S.doc, S.crew); }

    // ---------- carregar / gravar ----------
    function carregar(fresh) {
      S.status = 'a carregar…'; S.statusErr = false; S.loadErr = null; paint();
      return H('/api/admin/sala?key=' + encodeURIComponent(ctx.sig) + '&d=' + encodeURIComponent(ctx.anchor || '') + (fresh ? '&fresh=1' : '')).then(function (r) {
        return r.json().then(function (j) {
          if (r.status === 401 && ctx.onAuthFail) ctx.onAuthFail();
          if (!r.ok) throw new Error(r.status === 403 ? 'Só o dono pode editar.' : r.status === 401 ? 'Chave errada ou expirada — fecha e volta a abrir.' : (j.error || 'Erro ' + r.status));
          return j;
        });
      }).then(function (j) {
        S.crew = (j.crew && j.crew.crew) || [];
        if (j.doc) { S.doc = j.doc; S.rev = j.doc.rev || 0; }
        else {
          S.doc = M.novoDoc({ sig: ctx.sig, code: ctx.code || (j.crew && j.crew.code), evento: ctx.evento || (j.crew && j.crew.event), ancora: j.anchor, crew: S.crew });
          S.rev = 0;
        }
        if (!S.crew.length && !j.doc) S.loadErr = 'Este evento já não tem marcações na escala.';
        if (!S.day || S.doc.dias.indexOf(S.day) < 0) {
          var hoje = new Date(), tk = hoje.getFullYear() + '-' + pad(hoje.getMonth() + 1) + '-' + pad(hoje.getDate());
          S.day = S.doc.dias.indexOf(tk) >= 0 ? tk : S.doc.dias[0];
        }
        S.status = j.doc ? 'guardado' : 'novo — ainda sem destinos'; S.statusErr = false;
      }).catch(function (e) { S.loadErr = e.message || 'Sem ligação ao servidor.'; S.status = ''; }).then(paint);
    }

    function mudou(label) {
      if (S.snap) { S.undo.push(S.snap); if (S.undo.length > 30) S.undo.shift(); }
      S.snap = null;
      S.status = 'a guardar…'; S.statusErr = false;
      clearTimeout(timer); timer = setTimeout(gravar, 800);
      paint();
    }
    function antes() { S.snap = JSON.stringify(S.doc); }

    function gravar() {
      if (S.saving) { S.pending = true; return; }
      S.saving = true;
      var body = { key: ctx.sig, doc: S.doc, rev: S.rev };
      H('/api/admin/sala/guardar', { body: body }).then(function (r) {
        return r.json().then(function (j) { return { r: r, j: j }; });
      }).then(function (x) {
        if (x.r.status === 409) {
          S.doc = x.j.doc || S.doc; S.rev = (x.j.doc && x.j.doc.rev) || 0; S.undo = [];
          S.status = 'alterado noutro aparelho — recarreguei'; S.statusErr = true;
          return;
        }
        if (!x.r.ok) throw new Error(x.j.error || 'Erro ' + x.r.status);
        S.rev = x.j.rev; S.doc.rev = x.j.rev;
        var d = new Date(x.j.atualizadoEm);
        S.status = 'guardado ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); S.statusErr = false;
      }).catch(function (e) {
        S.status = 'não guardou (' + (e.message || 'sem ligação') + ') — tocar para repetir'; S.statusErr = true;
      }).then(function () {
        S.saving = false;
        if (S.pending) { S.pending = false; gravar(); } else paint();
      });
    }

    function anular() {
      if (!S.undo.length) return;
      S.doc = JSON.parse(S.undo.pop()); S.snap = null;
      S.status = 'a guardar…'; clearTimeout(timer); timer = setTimeout(gravar, 800); paint();
    }

    // ---------- pintura ----------
    function paint() {
      var avs = S.doc ? avisos().filter(function (a) { return !a.ignorado; }) : [];
      var h = '<div class="sl-top"><button class="b" data-a="fechar">‹ Voltar</button><b>' + esc(ctx.titulo || 'Equipa por sala') + '</b>' +
        '<span class="sl-st' + (S.statusErr ? ' err' : '') + '" data-a="' + (S.statusErr ? 'retry' : '') + '">' + esc(S.status) + '</span>' +
        '<button class="b" data-a="undo"' + (S.undo.length ? '' : ' disabled') + '>Anular</button></div>';
      if (S.loadErr || !S.doc) {
        el.innerHTML = h + '<div class="sl-body"><p class="empty">' + esc(S.loadErr || 'A carregar…') + '</p>' + (S.loadErr ? '<button class="b" data-a="reload">Tentar de novo</button>' : '') + '</div>';
        return;
      }
      h += '<div class="sl-tabs"><button data-t="dist" class="' + (S.tab === 'dist' ? 'on' : '') + '">Distribuir</button>' +
        '<button data-t="cfg" class="' + (S.tab === 'cfg' ? 'on' : '') + '">Configurar</button>' +
        '<button data-t="avisos" class="' + (S.tab === 'avisos' ? 'on' : '') + '">Avisos' + (avs.length ? '<span class="badge">' + avs.length + '</span>' : '') + '</button></div>';
      var keep = el.querySelector('.sl-body'), top = keep ? keep.scrollTop : 0;
      h += '<div class="sl-body">' + (S.tab === 'dist' ? viewDist(avs) : S.tab === 'cfg' ? viewCfg() : viewAvisos()) + '</div>';
      el.innerHTML = h;
      var nb = el.querySelector('.sl-body'); if (nb) nb.scrollTop = top;
      paintModal();
    }

    function selIds() { return Object.keys(S.sel).filter(function (k) { return S.sel[k]; }); }

    function viewDist(avs) {
      var d = S.doc, day = S.day, eq = equipa();
      var strip = '<div class="strip">' + d.dias.map(function (k) {
        var n = avs.filter(function (a) { return a.dia === k && a.tipo === 'semDestino'; }).length, dd = fromKey(k);
        return '<button class="sd' + (k === day ? ' on' : '') + '" data-day="' + k + '"><span>' + DOW[dd.getDay()] + '</span><b>' + dd.getDate() + '</b><i>' + (n || '') + '</i></button>';
      }).join('') + '</div>';
      if (!d.dias.length) return '<p class="empty">Este evento ainda não tem dias. Vai a «Configurar» e escolhe os dias.</p>';
      var ids = selIds();
      var bar = '<div class="bar"><button class="b' + (S.selMode ? ' on' : '') + '" data-a="selmode">Selecionar</button>' +
        '<button class="b" data-a="copiar">Copiar do dia anterior</button><button class="b" data-a="todos">Preencher todos os dias</button><span class="grow"></span>' +
        '<span class="note">' + esc(fmt(day)) + '</span></div>';
      if (S.selMode) {
        bar += '<div class="sel"><b>' + ids.length + ' selecionado(s)</b><span class="grow" style="flex:1"></span>' +
          '<button class="b" data-a="selsemdest">Todos sem destino</button>' +
          '<button class="b" data-a="mandar"' + (ids.length ? '' : ' disabled') + '>Mandar para sala/função…</button>' +
          '<button class="b" data-a="selnada">Limpar</button></div>';
      }
      var work = eq.filter(function (p) { return M.trabalha(p, day); });
      var sem = work.filter(function (p) { return !M.temDestino(d, p.id, day); });
      var bySala = {}, semSala = [];
      work.forEach(function (p) {
        M.get(d, p.id, day).forEach(function (x) {
          if (x.sala) (bySala[x.sala] = bySala[x.sala] || []).push({ p: p, x: x });
          else semSala.push({ p: p, x: x });
        });
      });
      var fora = Object.keys(d.aloc).filter(function (id) {
        var p = eq.filter(function (q) { return q.id === id; })[0];
        return d.aloc[id][day] && (!p || !M.trabalha(p, day));
      });

      function pp(p) {
        var on = S.sel[p.id];
        return '<button class="pp' + (on ? ' sel1' : '') + '" data-p="' + esc(p.id) + '">' + esc(p.name) + '</button>';
      }
      function row(o) {
        var on = S.sel[o.p.id];
        return '<button class="rw' + (on ? ' sel1' : '') + '" data-p="' + esc(o.p.id) + '"><b>' + esc(o.p.name) + '</b><span class="f">' + esc(funcNome(o.x.f) || '—') + '</span></button>';
      }
      var h = strip + bar;
      h += '<div class="box' + (sem.length ? ' warn' : '') + '"><h3>Sem destino <small>(' + sem.length + ')</small></h3><div class="rows">' +
        (sem.length ? sem.map(pp).join('') : '<p class="empty">Todos têm destino neste dia.</p>') + '</div></div>';
      var bad = {};
      avs.forEach(function (a) { if (a.dia === day && a.sala) (bad[a.sala] = bad[a.sala] || []).push(a.tipo); });
      d.salas.forEach(function (s) {
        var l = bySala[s.id] || [];
        h += '<div class="box' + (bad[s.id] ? ' warn' : '') + '"><h3>' + esc(s.nome) + ' <small>(' + l.length + ')</small>' +
          (bad[s.id] ? '<span class="w">⚠ ' + bad[s.id].map(function (t) { return TIPOS[t].toLowerCase(); }).join(', ') + '</span>' : '') +
          '</h3><div class="rows">' + (l.length ? l.map(row).join('') : '<p class="empty">Ninguém.</p>') + '</div></div>';
      });
      if (!d.salas.length) h += '<div class="box"><div class="rows"><p class="empty">Ainda não há salas. Vai a «Configurar» e cria as salas deste evento.</p></div></div>';
      if (semSala.length) h += '<div class="box"><h3>Só função, sem sala <small>(' + semSala.length + ')</small></h3><div class="rows">' + semSala.map(row).join('') + '</div></div>';
      if (fora.length) {
        h += '<div class="box warn"><h3>Fora da escala oficial neste dia <small>(' + fora.length + ')</small></h3><div class="rows">' + fora.map(function (id) {
          var l = d.aloc[id][day];
          return '<div class="rw"><b>' + esc(nome(id)) + '</b><span class="f">' + esc(l.map(function (x) { return (salaNome(x.sala) || 'sem sala') + ' · ' + (funcNome(x.f) || '—'); }).join(' + ')) + '</span>' +
            '<button class="b" data-a="rm" data-id="' + esc(id) + '">Remover</button></div>';
        }).join('') + '</div></div>';
      }
      return h;
    }

    function viewAvisos() {
      var l = avisos();
      if (!l.length) return '<p class="empty">Sem avisos. ✓</p>';
      var h = '<p class="note">Os avisos nunca impedem de guardar, exportar ou partilhar.</p>';
      l.sort(function (a, b) { return a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : 0; });
      l.forEach(function (a) {
        var txt = a.id ? esc(nome(a.id)) : esc(salaNome(a.sala));
        if (a.tipo === 'duasSalas') txt += ' — ' + a.salas.map(salaNome).map(esc).join(' e ');
        h += '<div class="it' + (a.ignorado ? ' ign' : '') + '"><span class="t">' + esc(TIPOS[a.tipo]) + '</span><button data-go="' + a.dia + '" style="text-align:left;flex:1"><b>' + esc(fmt(a.dia)) + '</b> · ' + txt + '</button>' +
          '<button class="b x" data-a="ign" data-k="' + esc(a.key) + '">' + (a.ignorado ? 'Repor' : 'Ignorar') + '</button></div>';
      });
      return h;
    }

    function viewCfg() {
      var d = S.doc, all = {};
      S.crew.forEach(function (p) { (p.days || []).forEach(function (k) { all[k] = 1; }); });
      d.dias.forEach(function (k) { all[k] = 1; });
      var grupos = {}; S.crew.forEach(function (p) { grupos[p.grupo] = (grupos[p.grupo] || 0) + 1; });
      var h = '<div class="cfg">';
      h += '<h4>Dias do evento</h4><div class="ln">' + Object.keys(all).sort().map(function (k) {
        return '<label class="ck"><input type="checkbox" data-dia="' + k + '"' + (d.dias.indexOf(k) >= 0 ? ' checked' : '') + '> ' + esc(fmt(k)) + '</label>';
      }).join('') + '</div><div class="ln"><input type="date" id="slNovoDia"><button class="b" data-a="addDia">Adicionar dia</button></div>';
      h += '<h4>Quem aparece (grupos da escala oficial)</h4><div class="ln">' + Object.keys(grupos).sort().map(function (g) {
        return '<label class="ck"><input type="checkbox" data-grupo="' + esc(g) + '"' + (d.grupos.indexOf(g) >= 0 ? ' checked' : '') + '> ' + esc(g) + ' (' + grupos[g] + ')</label>';
      }).join('') + '</div><p class="note">Os nomes vêm sempre da escala oficial; não se escrevem à mão.</p>';
      h += '<h4>Salas</h4>' + d.salas.map(function (s) {
        return '<div class="ln"><input type="text" data-sala="' + s.id + '" value="' + esc(s.nome) + '">' +
          '<label class="ck"><input type="checkbox" data-salareg="' + s.id + '"' + (s.regras === 'off' ? '' : ' checked') + '> exige MIX/câmara</label>' +
          '<button class="b" data-a="delSala" data-id="' + s.id + '">✕</button></div>';
      }).join('') + '<div class="ln"><input type="text" id="slNovaSala" placeholder="Nova sala, ex. Auditório 1"><button class="b" data-a="addSala">Adicionar sala</button></div>';
      h += '<h4>Funções</h4>' + d.funcoes.map(function (f) {
        return '<div class="ln"><input type="text" data-func="' + f.id + '" value="' + esc(f.nome) + '">' +
          '<select data-funcconta="' + f.id + '"><option value="">conta como: nada</option><option value="mix"' + (f.conta === 'mix' ? ' selected' : '') + '>conta como MIX</option><option value="cam"' + (f.conta === 'cam' ? ' selected' : '') + '>conta como câmara</option></select>' +
          '<button class="b" data-a="delFunc" data-id="' + f.id + '">✕</button></div>';
      }).join('') + '<div class="ln"><input type="text" id="slNovaFunc" placeholder="Nova função, ex. Runner"><button class="b" data-a="addFunc">Adicionar função</button></div>';
      h += '<h4>Avisos ativos</h4><div class="ln">' + Object.keys(REGRA_TXT).map(function (r) {
        return '<label class="ck"><input type="checkbox" data-regra="' + r + '"' + (d.regras[r] === 'off' ? '' : ' checked') + '> ' + esc(REGRA_TXT[r]) + '</label>';
      }).join('') + '</div>';
      h += '<h4>Link «Escala do Evento»</h4><div class="ln"><label class="ck"><input type="checkbox" data-publicar' + (d.link.publicado ? ' checked' : '') + '> Mostrar sala e função no link (só consulta)</label></div>' +
        '<p class="note">Desligado por defeito. Os técnicos só veem sala e função, nunca os avisos nem a configuração. O link cria-se em «Partilhar só este projeto» no painel do evento.</p>';
      h += '<h4>Exportar</h4><div class="ln"><button class="b" data-a="csv">Descarregar CSV (formato da folha)</button><button class="b" data-a="csv2">CSV para Excel (;)</button></div>';
      return h + '</div>';
    }

    // ---------- seletor sala/funcao ----------
    function abrirPicker(ids) {
      var first = ids.length === 1 ? M.get(S.doc, ids[0], S.day)[0] : null;
      var f = {}; (first ? first.f : []).forEach(function (x) { f[x] = 1; });
      S.pk = { ids: ids, sala: first ? first.sala : null, f: f, scope: 'dia' };
      paintModal();
    }
    function paintModal() {
      var pk = S.pk;
      if (!pk) { md.style.display = 'none'; md.innerHTML = ''; return; }
      var d = S.doc;
      var nomes = pk.ids.slice(0, 3).map(nome).join(', ') + (pk.ids.length > 3 ? ' +' + (pk.ids.length - 3) : '');
      md.innerHTML = '<div class="mp"><h3>' + esc(nomes) + '</h3><div class="mut">' + esc(fmt(S.day)) + '</div>' +
        '<h5>Sala</h5><div class="ch">' + d.salas.map(function (s) { return '<button data-ps="' + s.id + '" class="' + (pk.sala === s.id ? 'on' : '') + '">' + esc(s.nome) + '</button>'; }).join('') +
        '<button data-ps="" class="' + (!pk.sala ? 'on' : '') + '">— sem sala —</button></div>' +
        '<h5>Função</h5><div class="ch">' + d.funcoes.map(function (f) { return '<button data-pf="' + f.id + '" class="' + (pk.f[f.id] ? 'on' : '') + '">' + esc(f.nome) + '</button>'; }).join('') + '</div>' +
        '<h5>Aplicar a</h5><div class="ch"><button data-pc="dia" class="' + (pk.scope === 'dia' ? 'on' : '') + '">Só ' + esc(fmt(S.day)) + '</button><button data-pc="todos" class="' + (pk.scope === 'todos' ? 'on' : '') + '">Todos os dias em que trabalha</button></div>' +
        '<div class="ac"><button class="pri" data-pa="ok">Aplicar</button><button data-pa="limpar">Tirar destino</button><button data-pa="x">Cancelar</button></div></div>';
      md.style.display = 'flex';
    }
    function fecharPicker() { S.pk = null; paintModal(); }

    function perguntar(texto, botoes, cb) {
      S.ask = cb;
      md.innerHTML = '<div class="mp"><h3>' + esc(texto) + '</h3><div class="ac">' + botoes.map(function (b, i) { return '<button class="' + (b.pri ? 'pri' : '') + '" data-ask="' + i + '">' + esc(b.t) + '</button>'; }).join('') + '</div></div>';
      md.style.display = 'flex';
    }

    md.addEventListener('click', function (ev) {
      var t = ev.target;
      if (t === md) { S.pk = null; S.ask = null; paintModal(); return; }
      t = t.closest('button'); if (!t || !S.pk && !S.ask) return;
      if (S.ask && t.dataset.ask != null) { var cb = S.ask; S.ask = null; md.style.display = 'none'; cb(+t.dataset.ask); return; }
      var pk = S.pk; if (!pk) return;
      if (t.dataset.ps != null) { pk.sala = t.dataset.ps || null; paintModal(); }
      else if (t.dataset.pf) { if (pk.f[t.dataset.pf]) delete pk.f[t.dataset.pf]; else pk.f[t.dataset.pf] = 1; paintModal(); }
      else if (t.dataset.pc) { pk.scope = t.dataset.pc; paintModal(); }
      else if (t.dataset.pa === 'x') fecharPicker();
      else if (t.dataset.pa === 'ok' || t.dataset.pa === 'limpar') {
        antes();
        if (t.dataset.pa === 'limpar') {
          pk.ids.forEach(function (id) {
            var p = person(id), dias = pk.scope === 'todos' && p ? M.diasDe(S.doc, p) : [S.day];
            dias.forEach(function (dd) { M.limpar(S.doc, [id], dd); });
          });
        } else M.atribuir(S.doc, S.crew, pk.ids, S.day, pk.scope, pk.sala, Object.keys(pk.f));
        S.sel = {}; S.pk = null; mudou();
      }
    });

    // ---------- eventos ----------
    function download(txt, name) {
      var url = URL.createObjectURL(new Blob(['﻿' + txt], { type: 'text/csv;charset=utf-8' }));
      var a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
    }
    function slug(s) { return M.norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'evento'; }

    el.addEventListener('click', function (ev) {
      var t = ev.target.closest('button'); if (!t) return;
      var d = S.doc;
      if (t.dataset.t) { S.tab = t.dataset.t; paint(); return; }
      if (t.dataset.day) { S.day = t.dataset.day; paint(); return; }
      if (t.dataset.go) { S.day = t.dataset.go; S.tab = 'dist'; paint(); return; }
      if (t.dataset.p) {
        if (S.selMode) { S.sel[t.dataset.p] = !S.sel[t.dataset.p]; paint(); } else abrirPicker([t.dataset.p]);
        return;
      }
      var a = t.dataset.a; if (!a || !d && a !== 'fechar' && a !== 'reload') { if (a === 'fechar') close(); if (a === 'reload') carregar(true); return; }
      if (a === 'fechar') { if (S.status === 'a guardar…') { clearTimeout(timer); gravar(); } close(); }
      else if (a === 'reload') carregar(true);
      else if (a === 'retry') { clearTimeout(timer); gravar(); }
      else if (a === 'undo') anular();
      else if (a === 'selmode') { S.selMode = !S.selMode; if (!S.selMode) S.sel = {}; paint(); }
      else if (a === 'selnada') { S.sel = {}; paint(); }
      else if (a === 'selsemdest') {
        equipa().forEach(function (p) { if (M.trabalha(p, S.day) && !M.temDestino(d, p.id, S.day)) S.sel[p.id] = true; }); paint();
      }
      else if (a === 'mandar') abrirPicker(selIds());
      else if (a === 'copiar') {
        antes(); var n = M.copiarAnterior(d, S.crew, S.day);
        if (!n) { S.snap = null; S.status = 'nada para copiar (sem destino no dia anterior, ou já preenchido)'; paint(); } else { S.status = n + ' copiado(s)'; mudou(); }
      }
      else if (a === 'todos') {
        var quem = selIds();
        perguntar('Repetir o destino de ' + fmt(S.day) + ' pelos outros dias' + (quem.length ? ' (' + quem.length + ' selecionado(s))' : '') + '?',
          [{ t: 'Só onde está vazio', pri: true }, { t: 'Substituir tudo' }, { t: 'Cancelar' }], function (i) {
            if (i > 1) return;
            antes(); var n = M.preencherTodos(d, S.crew, S.day, quem, i === 1);
            if (!n) { S.snap = null; S.status = 'nada para preencher'; paint(); } else { S.status = n + ' dia(s) preenchido(s)'; mudou(); }
          });
      }
      else if (a === 'rm') { antes(); M.limpar(d, [t.dataset.id], S.day); mudou(); }
      else if (a === 'ign') {
        antes(); var k = t.dataset.k, i = d.ignorar.indexOf(k);
        if (i >= 0) d.ignorar.splice(i, 1); else d.ignorar.push(k);
        mudou();
      }
      else if (a === 'addSala') {
        var v = document.getElementById('slNovaSala').value.trim(); if (!v) return;
        antes(); d.salas.push({ id: M.novoId(d.salas, 's'), nome: v, curto: v.toUpperCase(), alias: [], regras: 'herdar' }); mudou();
      }
      else if (a === 'addFunc') {
        var f = document.getElementById('slNovaFunc').value.trim(); if (!f) return;
        antes(); d.funcoes.push({ id: M.novoId(d.funcoes, 'f'), nome: f, curto: f.toUpperCase(), conta: null, alias: [] }); mudou();
      }
      else if (a === 'delSala') {
        if (!confirm('Apagar esta sala? As pessoas nela ficam sem sala.')) return;
        antes(); M.removerSala(d, t.dataset.id); mudou();
      }
      else if (a === 'delFunc') {
        if (!confirm('Apagar esta função? Sai das atribuições.')) return;
        antes(); M.removerFuncao(d, t.dataset.id); mudou();
      }
      else if (a === 'addDia') {
        var dv = document.getElementById('slNovoDia').value; if (!dv) return;
        if (d.dias.indexOf(dv) < 0) { antes(); d.dias.push(dv); d.dias.sort(); mudou(); }
      }
      else if (a === 'csv' || a === 'csv2') {
        download(M.paraCsv(d, S.crew, a === 'csv2' ? ';' : ','), 'equipa-' + slug(d.evento || ctx.titulo) + '.csv');
      }
    });

    // campos de configuracao: gravam ao sair do campo (nao a cada tecla, para nao perder o foco)
    el.addEventListener('change', function (ev) {
      var t = ev.target, d = S.doc; if (!d) return;
      antes();
      if (t.dataset.dia) {
        var on = t.checked, k = t.dataset.dia;
        if (!on) {
          var tem = Object.keys(d.aloc).some(function (id) { return d.aloc[id][k]; });
          if (tem && !confirm('Este dia já tem destinos atribuídos. Remover o dia apaga-os. Continuar?')) { t.checked = true; S.snap = null; return; }
          d.dias = d.dias.filter(function (x) { return x !== k; }); M.podarDias(d);
        } else if (d.dias.indexOf(k) < 0) { d.dias.push(k); d.dias.sort(); }
      }
      else if (t.dataset.grupo) {
        var g = t.dataset.grupo, i = d.grupos.indexOf(g);
        if (t.checked && i < 0) d.grupos.push(g); else if (!t.checked && i >= 0) d.grupos.splice(i, 1);
      }
      else if (t.dataset.sala) { var s = d.salas.filter(function (x) { return x.id === t.dataset.sala; })[0]; if (s && t.value.trim()) { s.nome = t.value.trim(); s.curto = s.nome.toUpperCase(); } }
      else if (t.dataset.salareg) { var s2 = d.salas.filter(function (x) { return x.id === t.dataset.salareg; })[0]; if (s2) s2.regras = t.checked ? 'herdar' : 'off'; }
      else if (t.dataset.func) { var f = d.funcoes.filter(function (x) { return x.id === t.dataset.func; })[0]; if (f && t.value.trim()) { f.nome = t.value.trim(); f.curto = f.nome.toUpperCase(); } }
      else if (t.dataset.funcconta) { var f2 = d.funcoes.filter(function (x) { return x.id === t.dataset.funcconta; })[0]; if (f2) f2.conta = t.value || null; }
      else if (t.dataset.regra) d.regras[t.dataset.regra] = t.checked ? 'aviso' : 'off';
      else if (t.hasAttribute('data-publicar')) d.link.publicado = t.checked;
      else { S.snap = null; return; }
      mudou();
    });

    function close() {
      clearTimeout(timer);
      el.remove(); md.remove(); var c = document.getElementById('vtsl-css'); if (c) c.remove();
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') { if (S.pk || S.ask) { S.pk = null; S.ask = null; paintModal(); } } }
    document.addEventListener('keydown', onKey);

    paint();
    carregar(false);
  }

  root.__vtSalas = { abrir: abrir };
})(window);
