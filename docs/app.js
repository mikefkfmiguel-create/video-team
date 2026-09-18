// GERADO por build-web.js a partir de shared/app.js — nao editar aqui
window.VideoTeam = // Video Team — vista propria da escala do 7Eventos.
// Corre dentro da sessao do 7Eventos (mesma origem), substitui a pagina e so LE dados.
// Recebe cfg = {search, api?, pin?, head?, onAuthFail?}. search = grupo por defeito (ex: "video").
// Com cfg.api (versao web) os dados vem ja arrumados do Worker; sem ele le o 7Eventos direto.
(function (cfg) {
  if (window.__vt) return 'already';
  window.__vt = true;

  var START = '/7Eventos/EscalasTecnicos/GetPeriodoJS';
  var VISTA = '/7Eventos/EscalasTecnicos/VistaSemanal';
  var DOW = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  var MON = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  var INC = { FER: 'Férias', FLG: 'Folga', ND: 'Não disponível', RES: 'Reservado', RHT: 'Redução horário' };

  function norm(s) { return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function keyOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function fromKey(k) { var p = k.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function hue(s) { var n = parseInt(s, 10); if (isNaN(n)) { n = 0; for (var i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) >>> 0; } return Math.round((n * 137.508) % 360); }
  function initials(n) { return n.split(' ').filter(Boolean).map(function (w) { return w[0]; }).slice(0, 2).join('').toUpperCase(); }
  function sig(e) { return e.kind + ':' + e.code + ':' + (e.event || ''); }
  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function recall(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  var TODAY = keyOf(new Date());
  var state = {
    anchor: new Date(),
    data: null,
    group: recall('vt.group'),
    view: recall('vt.view') || (innerWidth < 760 ? 'dia' : 'grelha'),
    day: TODAY,
    q: '',
    onlyBooked: recall('vt.only') !== '0',
    loading: false,
    error: null,
    fetchedAt: null
  };

  // ---------- dados ----------
  function parseEntry(e) {
    var title = (e.getAttribute('title') || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    var horLine = title.filter(function (l) { return /^Hor/i.test(l); })[0] || '';
    var hor = horLine.replace(/^Hor[áa]rio das\s*/i, '').replace(/\s*[àa]s\s*/i, '–');
    var b = e.querySelector('b');
    var a = e.querySelector('a');
    var bText = b ? b.textContent : e.textContent;
    if (/^Incid/i.test(title[0] || '')) {
      var code = bText.trim();
      return { kind: 'inc', code: code, label: title[0].replace(/^Incid[êe]ncia:\s*/i, '') || INC[code] || code, hor: hor };
    }
    var ev, os;
    if (a) { ev = a.textContent.trim(); os = bText.replace(a.textContent, '').trim(); }
    else { var parts = bText.trim().split(/\s+/); os = parts.shift() || ''; ev = parts.join(' '); }
    return {
      kind: 'os', code: os, osFull: title[0] || os, event: ev,
      client: title[1] && !/^Hor/i.test(title[1]) ? title[1] : '', hor: hor
    };
  }

  function parse(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var tbody = doc.querySelector('#maintable > tbody');
    if (!tbody) throw new Error('Não encontrei a tabela da escala.');
    var days = {}, special = {}, people = [];
    Array.prototype.forEach.call(tbody.children, function (tr) {
      var tds = Array.prototype.slice.call(tr.children);
      if (tds.length < 3) return;
      var img = tds[0].querySelector('img');
      var link = tds[1].querySelector('a');
      var h3 = tds[1].querySelector('h3');
      var idm = link && (link.getAttribute('href') || '').match(/(\d+)\s*$/);
      var stats = Array.prototype.filter.call(tds[1].childNodes, function (n) { return n.nodeType === 3; })
        .map(function (n) { return n.textContent.trim(); }).join(' ').trim();
      var name = (h3 || tds[1]).textContent.replace(/\s+/g, ' ').trim();
      var cells = {};
      tds.slice(2).forEach(function (td) {
        var m = (td.id || '').match(/_(\d{2})\/(\d{2})\/(\d{4})$/);
        if (!m) return;
        var k = m[3] + '-' + m[2] + '-' + m[1];
        days[k] = 1;
        if (/ffffb3/i.test(td.getAttribute('style') || '')) special[k] = 1;
        var list = Array.prototype.map.call(td.querySelectorAll('td[id]'), parseEntry);
        if (list.length) cells[k] = list;
      });
      people.push({
        id: idm ? idm[1] : name,
        name: name,
        grupo: tds[0].textContent.replace(/\s+/g, ' ').trim(),
        foto: img ? img.getAttribute('src') : null,
        empresa: tds[1].getAttribute('title') || '',
        stats: stats,
        cells: cells
      });
    });
    return { days: Object.keys(days).sort(), special: special, people: people };
  }

  function fetchData(dmy, fresh) {
    if (cfg.api) {
      return fetch(cfg.api + '/api/escala?d=' + dmy + (fresh ? '&fresh=1' : ''), { headers: { 'X-PIN': cfg.pin } }).then(function (r) {
        if (r.status === 401) { if (cfg.onAuthFail) cfg.onAuthFail(); throw new Error('Código inválido'); }
        return r.json().then(function (j) {
          if (!r.ok) throw new Error(j.error || 'Erro ' + r.status);
          return j;
        });
      });
    }
    return fetch(VISTA, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'txt_Periodo=' + dmy
    }).then(function (r) {
      if (/Account\/Login/i.test(r.url)) { location.href = START; throw new Error('Sessão expirou, a entrar de novo…'); }
      if (!r.ok) throw new Error('Erro ' + r.status + ' do servidor');
      return r.text();
    }).then(parse);
  }

  function load(fresh) {
    var d = state.anchor;
    state.loading = true; state.error = null; paintStatus();
    return fetchData(pad(d.getDate()) + '-' + pad(d.getMonth() + 1) + '-' + d.getFullYear(), fresh).then(function (data) {
      state.data = data;
      state.fetchedAt = new Date(data.at || Date.now());
      if (keyOf(state.anchor) === TODAY) store('vt.cache', JSON.stringify({ at: +state.fetchedAt, data: state.data }));
      if (state.data.days.indexOf(state.day) < 0) state.day = state.data.days.indexOf(TODAY) >= 0 ? TODAY : state.data.days[0];
    }).catch(function (e) {
      state.error = e.message || String(e);
    }).then(function () {
      state.loading = false;
      paint(true);
    });
  }

  // ---------- filtros ----------
  function groups() {
    if (!state.data) return [];
    var seen = {};
    state.data.people.forEach(function (p) { seen[p.grupo] = (seen[p.grupo] || 0) + 1; });
    return Object.keys(seen).sort(function (a, b) { return a.localeCompare(b, 'pt'); }).map(function (g) { return { g: g, n: seen[g] }; });
  }

  function currentGroup() {
    var gs = groups().map(function (x) { return x.g; });
    if (state.group === '*' || gs.indexOf(state.group) >= 0) return state.group;
    var want = norm(cfg.search || 'video');
    return gs.filter(function (g) { return norm(g).indexOf(want) >= 0; })[0] || '*';
  }

  function visiblePeople() {
    if (!state.data) return [];
    var g = currentGroup();
    var q = norm(state.q);
    return state.data.people.filter(function (p) {
      if (g !== '*' && p.grupo !== g) return false;
      if (state.onlyBooked && !state.data.days.some(function (k) { return p.cells[k]; })) return false;
      if (!q) return true;
      if (norm(p.name).indexOf(q) >= 0) return true;
      return Object.keys(p.cells).some(function (k) {
        return p.cells[k].some(function (e) { return norm(e.event + ' ' + e.code + ' ' + e.client + ' ' + (e.label || '')).indexOf(q) >= 0; });
      });
    }).sort(function (a, b) { return a.name.localeCompare(b.name, 'pt'); });
  }

  // ---------- pecas ----------
  function fotoUrl(p) {
    return cfg.api ? cfg.api + '/foto/' + encodeURIComponent(p.foto) + '?k=' + encodeURIComponent(cfg.pin) : p.foto;
  }

  function avatar(p, size) {
    var s = size || 36;
    var ini = '<span class="ini" style="--h:' + hue(p.name) + '">' + esc(initials(p.name)) + '</span>';
    return '<span class="av" style="width:' + s + 'px;height:' + s + 'px">' + ini +
      (p.foto ? '<img loading="lazy" src="' + esc(fotoUrl(p)) + '" alt="" onerror="this.remove()">' : '') + '</span>';
  }

  function dayCls(k) {
    var d = fromKey(k), c = [];
    if (d.getDay() === 0 || d.getDay() === 6) c.push('we');
    if (state.data.special[k]) c.push('sp');
    if (k === TODAY) c.push('today');
    return c.join(' ');
  }

  function chip(e, attrs, extra) {
    if (e.kind === 'inc') {
      return '<button class="chip inc inc-' + esc(e.code) + ' ' + (extra || '') + '" ' + attrs + ' title="' + esc(e.label) + '"><b>' + esc(e.code) + '</b></button>';
    }
    return '<button class="chip os ' + (extra || '') + '" style="--h:' + hue(e.code) + '" ' + attrs +
      ' title="' + esc(e.event + ' · OS ' + e.osFull + (e.client ? ' · ' + e.client : '') + (e.hor ? ' · ' + e.hor : '')) + '">' +
      '<b>' + esc(e.event || e.code) + '</b><small>' + esc(e.code) + '</small></button>';
  }

  function fmtDay(k, long) {
    var d = fromKey(k);
    return long ? DOW[d.getDay()] + ', ' + d.getDate() + ' ' + MON[d.getMonth()] : d.getDate() + ' ' + MON[d.getMonth()];
  }

  // ---------- vistas ----------
  function renderGrid(ps) {
    var days = state.data.days;
    var h = '<div class="grid" style="--n:' + days.length + '">';
    h += '<div class="gh corner"><span>' + ps.length + ' técnicos</span></div>';
    days.forEach(function (k) {
      var d = fromKey(k);
      h += '<div class="gh day ' + dayCls(k) + '" data-day="' + k + '"><span>' + DOW[d.getDay()] + '</span><b>' + d.getDate() + '</b><span>' + MON[d.getMonth()] + '</span></div>';
    });
    ps.forEach(function (p, r) {
      h += '<button class="who ' + (r % 2 ? 'odd' : '') + '" data-person="' + esc(p.id) + '">' + avatar(p, 34) +
        '<span class="wn"><b>' + esc(p.name) + '</b><small>' + esc(p.stats) + '</small></span></button>';
      days.forEach(function (k, i) {
        var list = p.cells[k] || [];
        var prev = i > 0 ? (p.cells[days[i - 1]] || []).map(sig) : [];
        var next = i < days.length - 1 ? (p.cells[days[i + 1]] || []).map(sig) : [];
        h += '<div class="cell ' + dayCls(k) + (r % 2 ? ' odd' : '') + '">';
        list.forEach(function (e, j) {
          var s = sig(e), cl = prev.indexOf(s) >= 0, cr = next.indexOf(s) >= 0;
          var extra = (cl ? 'cl ' : '') + (cr ? 'cr ' : '') + (cl && fromKey(k).getDay() !== 1 ? 'quiet' : '');
          h += chip(e, 'data-person="' + esc(p.id) + '" data-day="' + k + '" data-i="' + j + '"', extra);
        });
        h += '</div>';
      });
    });
    return h + '</div>';
  }

  function renderDay(ps) {
    var days = state.data.days, k = state.day;
    var h = '<div class="strip">';
    days.forEach(function (d) {
      var dd = fromKey(d);
      var busy = ps.filter(function (p) { return (p.cells[d] || []).some(function (e) { return e.kind === 'os'; }); }).length;
      h += '<button class="sd ' + dayCls(d) + (d === k ? ' on' : '') + '" data-pick="' + d + '"><span>' + DOW[dd.getDay()] + '</span><b>' + dd.getDate() + '</b><i>' + (busy || '') + '</i></button>';
    });
    h += '</div><div class="dayv"><h2>' + esc(fmtDay(k, true)) + (k === TODAY ? ' <em>hoje</em>' : '') + '</h2>';

    var events = {}, order = [], absent = {}, free = [];
    ps.forEach(function (p) {
      var list = p.cells[k] || [];
      if (!list.length) { free.push(p); return; }
      list.forEach(function (e, j) {
        if (e.kind === 'inc') { (absent[e.code] = absent[e.code] || { e: e, ps: [] }).ps.push(p); return; }
        var s = sig(e);
        if (!events[s]) { events[s] = { e: e, ps: [] }; order.push(s); }
        events[s].ps.push({ p: p, j: j });
      });
    });
    order.sort(function (a, b) { return events[b].ps.length - events[a].ps.length; });

    if (!order.length && !Object.keys(absent).length) h += '<p class="empty">Ninguém marcado neste dia.</p>';
    order.forEach(function (s) {
      var ev = events[s], e = ev.e;
      h += '<article class="card" style="--h:' + hue(e.code) + '"><header><div><h3>' + esc(e.event || 'OS ' + e.code) + '</h3>' +
        '<p>OS ' + esc(e.osFull) + (e.client ? ' · ' + esc(e.client) : '') + '</p></div>' +
        (e.hor ? '<span class="hor">' + esc(e.hor) + '</span>' : '') + '</header><div class="crew">';
      ev.ps.forEach(function (x) {
        h += '<button class="mate" data-person="' + esc(x.p.id) + '">' + avatar(x.p, 28) + '<span>' + esc(x.p.name) + '</span></button>';
      });
      h += '</div></article>';
    });

    var absKeys = Object.keys(absent);
    if (absKeys.length) {
      h += '<section class="minor"><h4>Ausências</h4>';
      absKeys.forEach(function (c) {
        h += '<div class="row"><span class="chip inc inc-' + esc(c) + '"><b>' + esc(c) + '</b></span><span class="lbl">' + esc(absent[c].e.label) + '</span><span class="names">' +
          absent[c].ps.map(function (p) { return '<button class="mate sm" data-person="' + esc(p.id) + '">' + avatar(p, 22) + '<span>' + esc(p.name) + '</span></button>'; }).join('') + '</span></div>';
      });
      h += '</section>';
    }
    if (free.length) {
      h += '<section class="minor"><h4>Sem marcação</h4><div class="names">' +
        free.map(function (p) { return '<button class="mate sm" data-person="' + esc(p.id) + '">' + avatar(p, 22) + '<span>' + esc(p.name) + '</span></button>'; }).join('') + '</div></section>';
    }
    return h + '</div>';
  }

  // ---------- detalhe ----------
  function findPerson(id) { return state.data.people.filter(function (p) { return p.id === id; })[0]; }

  function openSheet(html) {
    var sh = document.getElementById('sheet');
    sh.querySelector('.sb').innerHTML = html;
    sh.classList.add('open');
    sh.querySelector('.sb').scrollTop = 0;
  }

  function entrySheet(p, k, i) {
    var e = (p.cells[k] || [])[i];
    if (!e) return;
    if (e.kind === 'inc') return personSheet(p);
    var s = sig(e), crew = {};
    state.data.people.forEach(function (q) {
      state.data.days.forEach(function (d) {
        if ((q.cells[d] || []).some(function (x) { return sig(x) === s; })) (crew[q.id] = crew[q.id] || { p: q, days: [] }).days.push(d);
      });
    });
    var list = Object.keys(crew).map(function (id) { return crew[id]; }).sort(function (a, b) { return a.days[0] < b.days[0] ? -1 : 1; });
    var h = '<div class="sh-h" style="--h:' + hue(e.code) + '"><h3>' + esc(e.event || 'OS ' + e.code) + '</h3><p>OS ' + esc(e.osFull) + '</p></div><dl>' +
      (e.client ? '<dt>Cliente / local</dt><dd>' + esc(e.client) + '</dd>' : '') +
      (e.hor ? '<dt>Horário</dt><dd>' + esc(e.hor) + '</dd>' : '') +
      '<dt>Equipa neste período</dt></dl><ul class="crewlist">';
    list.forEach(function (c) {
      h += '<li>' + avatar(c.p, 30) + '<div><b>' + esc(c.p.name) + '</b><small>' + esc(c.p.grupo) + ' · ' + esc(ranges(c.days)) + '</small></div></li>';
    });
    openSheet(h + '</ul>');
  }

  function ranges(days) {
    var out = [], start = days[0], prev = days[0];
    for (var i = 1; i <= days.length; i++) {
      var d = days[i];
      if (d && keyOf(addDays(fromKey(prev), 1)) === d) { prev = d; continue; }
      out.push(start === prev ? fmtDay(start) : fmtDay(start) + '–' + fmtDay(prev));
      start = prev = d;
    }
    return out.join(', ');
  }

  function personSheet(p) {
    var h = '<div class="sh-p">' + avatar(p, 56) + '<div><h3>' + esc(p.name) + '</h3><p>' + esc(p.grupo) + (p.empresa ? ' · ' + esc(p.empresa) : '') + '</p><p class="mut">' + esc(p.stats) + '</p></div></div><ul class="agenda">';
    state.data.days.forEach(function (k) {
      var list = p.cells[k] || [];
      h += '<li class="' + dayCls(k) + '"><span class="ad">' + esc(fmtDay(k, true)) + '</span><span class="ae">' +
        (list.length ? list.map(function (e) {
          return e.kind === 'inc' ? '<span class="chip inc inc-' + esc(e.code) + '"><b>' + esc(e.code) + '</b></span> <span class="mut">' + esc(e.label) + '</span>'
            : '<span class="dot" style="--h:' + hue(e.code) + '"></span><b>' + esc(e.event || e.code) + '</b> <span class="mut">' + esc(e.code) + (e.hor ? ' · ' + esc(e.hor) : '') + '</span>';
        }).join('<br>') : '<span class="mut">—</span>') + '</span></li>';
    });
    openSheet(h + '</ul>');
  }

  // ---------- pintura ----------
  function paintStatus() {
    var st = document.getElementById('status');
    if (!st) return;
    if (state.loading) st.innerHTML = '<span class="spin"></span> a atualizar…';
    else if (state.error) st.innerHTML = '<span class="err">' + esc(state.error) + '</span>';
    else if (state.fetchedAt) st.textContent = 'atualizado ' + pad(state.fetchedAt.getHours()) + ':' + pad(state.fetchedAt.getMinutes());
    else st.textContent = '';
    document.getElementById('reload').disabled = state.loading;
  }

  function paint(scrollToday) {
    paintStatus();
    var main = document.getElementById('main');
    document.querySelectorAll('.seg button').forEach(function (b) { b.classList.toggle('on', b.dataset.view === state.view); });
    if (!state.data) {
      main.innerHTML = state.loading ? '<div class="loading"><span class="spin big"></span><p>A carregar a escala…</p></div>' : '<p class="empty">' + esc(state.error || 'Sem dados.') + '</p>';
      return;
    }
    var sel = document.getElementById('group');
    var cg = currentGroup();
    sel.innerHTML = '<option value="*">Todos os grupos</option>' + groups().map(function (x) {
      return '<option value="' + esc(x.g) + '"' + (x.g === cg ? ' selected' : '') + '>' + esc(x.g) + ' (' + x.n + ')</option>';
    }).join('');
    if (cg === '*') sel.value = '*';
    sel.style.display = groups().length > 1 ? '' : 'none';
    var days = state.data.days;
    document.getElementById('range').textContent = days.length ? fmtDay(days[0]) + ' – ' + fmtDay(days[days.length - 1]) : '';
    var ps = visiblePeople();
    var keepX = main.scrollLeft, keepY = main.scrollTop;
    main.className = 'main v-' + state.view;
    main.innerHTML = !ps.length ? '<p class="empty">Nenhum técnico corresponde ao filtro.</p>' : state.view === 'grelha' ? renderGrid(ps) : renderDay(ps);
    if (state.view === 'grelha') {
      if (scrollToday) {
        var t = main.querySelector('.gh.day.today'), c0 = main.querySelector('.gh.corner');
        main.scrollLeft = 0;
        if (t && c0) main.scrollLeft = t.getBoundingClientRect().left - main.getBoundingClientRect().left - c0.offsetWidth - t.offsetWidth / 2;
      }
      else { main.scrollLeft = keepX; main.scrollTop = keepY; }
    } else {
      var on = main.querySelector('.sd.on');
      if (on) on.scrollIntoView({ inline: 'center', block: 'nearest' });
    }
  }

  // ---------- montar ----------
  var CSS = [
    ':root{color-scheme:light dark;--bg:#f4f6fb;--panel:#fff;--ink:#0C1020;--mut:#5b6478;--line:#e1e6f0;--soft:#eef1f8;--we:#f7f8fb;--sp:#f1f3f8;--acc:#2E7BFF;--acc2:#22D3EE;--today:#e6f0ff;--chipL:92%;--chipT:26%;--shadow:0 1px 2px rgba(0,0,0,.06),0 4px 16px rgba(0,0,0,.06)}',
    '@media (prefers-color-scheme:dark){:root{--bg:#0C1020;--panel:#131a2c;--ink:#e8ecf5;--mut:#8f9ab0;--line:#232c42;--soft:#182036;--we:#0f1426;--sp:#11172b;--acc:#3B8CFF;--acc2:#22D3EE;--today:#15254a;--chipL:20%;--chipT:84%;--chipS:35%;--shadow:0 1px 2px rgba(0,0,0,.4)}}',
    '*{box-sizing:border-box}html,body{margin:0;height:100%}body{background:var(--bg);color:var(--ink);font:14px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;display:flex;flex-direction:column;overflow:hidden}',
    'button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;padding:0}',
    '.top{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding:10px 16px;background:var(--panel);border-bottom:1px solid var(--line);position:relative;z-index:5}',
    '.brand{display:flex;align-items:baseline;gap:8px;margin-right:auto}.mark{display:flex;align-items:center;gap:6px;opacity:.55;color:var(--ink);text-decoration:none;font-size:11px;letter-spacing:.06em;user-select:none}.mark:hover{opacity:.9}.mark .sym{width:18px;height:18px;flex:none}.mark b{font-weight:700}.brand h1{margin:0;font-size:17px;letter-spacing:.04em;font-weight:700}.brand h1 span{font-weight:300;opacity:.72}#range{color:var(--mut);font-size:12px;margin-left:4px}',
    '.ctl{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
    '.btn{height:32px;min-width:32px;padding:0 10px;border:1px solid var(--line);border-radius:8px;background:var(--panel);display:inline-flex;align-items:center;justify-content:center;gap:6px}.btn:hover{background:var(--soft)}.btn:disabled{opacity:.5}',
    '.seg{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden}.seg button{height:30px;padding:0 12px}.seg button.on{background:var(--acc);color:#fff}',
    'select,input[type=search]{height:32px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--ink);padding:0 10px;font:inherit;max-width:220px}input[type=search]{width:170px}',
    '.tog{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--mut);cursor:pointer;user-select:none}.tog input{accent-color:var(--acc)}',
    '#status{font-size:12px;color:var(--mut);display:inline-flex;align-items:center;gap:6px}.err{color:#ff5d73}',
    '.main{flex:1;overflow:auto;position:relative}',
    '.grid{display:grid;grid-template-columns:230px repeat(var(--n),108px);width:max-content;min-width:100%}',
    '.gh{position:sticky;top:0;z-index:3;background:var(--panel);border-bottom:1px solid var(--line);height:52px}',
    '.gh.corner{left:0;z-index:4;display:flex;align-items:flex-end;padding:0 14px 8px;color:var(--mut);font-size:12px;border-right:1px solid var(--line)}',
    '.gh.day{display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.1;color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:.04em}.gh.day b{font-size:17px;color:var(--ink);letter-spacing:0}',
    '.gh.day.we,.gh.day.sp{background:linear-gradient(var(--sp),var(--sp)),var(--panel)}.gh.day.today b{background:linear-gradient(135deg,#1246E6,var(--acc));color:#fff;border-radius:999px;width:28px;height:28px;display:grid;place-items:center}',
    '.who{position:sticky;left:0;z-index:2;display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--panel);border-right:1px solid var(--line);border-bottom:1px solid var(--line);text-align:left;min-height:58px}.who.odd{background:linear-gradient(var(--soft),var(--soft)),var(--panel)}.who:hover b{text-decoration:underline}',
    '.wn{display:flex;flex-direction:column;min-width:0}.wn b{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wn small{color:var(--mut);font-size:11px}',
    '.cell{border-bottom:1px solid var(--line);padding:6px 0;display:flex;flex-direction:column;gap:3px;justify-content:center;background:var(--bg)}.cell.odd{background:linear-gradient(var(--soft),var(--soft)),var(--bg)}',
    '.cell.we,.cell.sp{background:var(--we)}.cell.sp{background:var(--sp)}.cell.today{background:var(--today)}',
    '.chip{display:flex;flex-direction:column;align-items:flex-start;margin:0 5px;padding:4px 8px;border-radius:7px;text-align:left;min-height:34px;justify-content:center;overflow:hidden}',
    '.chip.os{background:hsl(var(--h) var(--chipS,65%) var(--chipL));color:hsl(var(--h) 55% var(--chipT));box-shadow:inset 3px 0 0 hsl(var(--h) 60% 50%)}',
    '.chip b{font-size:12px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}.chip small{font-size:10px;opacity:.75}',
    '.chip.cl{margin-left:0;border-top-left-radius:0;border-bottom-left-radius:0;box-shadow:none}.chip.cr{margin-right:0;border-top-right-radius:0;border-bottom-right-radius:0}.chip.quiet b,.chip.quiet small{visibility:hidden}',
    '.chip.inc{align-items:center;min-height:26px;background:var(--soft);color:var(--mut);box-shadow:none}.chip.inc b{font-size:11px;letter-spacing:.06em}',
    '.inc-FER{background:hsl(160 50% var(--chipL))!important;color:hsl(160 50% var(--chipT))!important}.inc-ND{background:hsl(350 70% var(--chipL))!important;color:hsl(350 55% var(--chipT))!important}.inc-RES{background:hsl(40 85% var(--chipL))!important;color:hsl(35 60% var(--chipT))!important}',
    'span.chip{display:inline-flex;margin:0;min-height:22px;padding:2px 8px}',
    '.av{position:relative;flex:none;border-radius:50%;overflow:hidden;display:inline-block}.av img,.av .ini{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.av .ini{display:grid;place-items:center;font-size:11px;font-weight:700;background:hsl(var(--h) 45% 88%);color:hsl(var(--h) 45% 30%)}',
    '.strip{position:sticky;top:0;z-index:3;display:flex;gap:4px;overflow-x:auto;padding:10px 16px;background:var(--panel);border-bottom:1px solid var(--line);scrollbar-width:thin}',
    '.sd{flex:none;width:48px;padding:6px 0;border-radius:10px;display:flex;flex-direction:column;align-items:center;line-height:1.1;color:var(--mut);font-size:11px}.sd b{font-size:17px;color:var(--ink)}.sd i{font-style:normal;font-size:10px;min-height:12px;color:var(--acc2)}',
    '.sd.we,.sd.sp{background:var(--sp)}.sd.today b{color:var(--acc)}.sd.on{background:linear-gradient(135deg,#1246E6,var(--acc));color:#fff}.sd.on b,.sd.on i{color:#fff}',
    '.dayv{max-width:880px;margin:0 auto;padding:16px}.dayv h2{margin:4px 0 14px;font-size:20px;text-transform:capitalize}.dayv h2 em{font-style:normal;font-size:12px;background:linear-gradient(135deg,#1246E6,var(--acc));color:#fff;border-radius:999px;padding:2px 8px;vertical-align:middle;text-transform:none}',
    '.card{background:var(--panel);border-radius:12px;box-shadow:var(--shadow);margin-bottom:10px;overflow:hidden;border-left:4px solid hsl(var(--h) 60% 50%)}',
    '.card header{display:flex;justify-content:space-between;gap:10px;padding:12px 14px 6px}.card h3{margin:0;font-size:16px}.card p{margin:2px 0 0;color:var(--mut);font-size:12px}',
    '.hor{flex:none;font-size:12px;font-variant-numeric:tabular-nums;background:var(--soft);border-radius:6px;padding:3px 8px;height:fit-content}',
    '.crew{display:flex;flex-wrap:wrap;gap:6px;padding:6px 14px 14px}.mate{display:inline-flex;align-items:center;gap:7px;padding:3px 10px 3px 3px;border-radius:999px;background:var(--soft)}.mate:hover{background:var(--line)}.mate.sm{font-size:12px;padding-right:8px}',
    '.minor{margin-top:18px}.minor h4{margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut)}.minor .row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:8px}.lbl{color:var(--mut);font-size:12px;min-width:90px}.names{display:flex;flex-wrap:wrap;gap:6px}',
    '.empty{color:var(--mut);text-align:center;padding:40px 16px}.loading{display:grid;place-items:center;padding:80px 0;color:var(--mut)}',
    '.spin{width:12px;height:12px;border:2px solid var(--line);border-top-color:var(--acc);border-radius:50%;display:inline-block;animation:sp .8s linear infinite}.spin.big{width:28px;height:28px;border-width:3px}@keyframes sp{to{transform:rotate(360deg)}}',
    '#sheet{position:fixed;inset:0;z-index:20;display:none}#sheet.open{display:block}#sheet .bd{position:absolute;inset:0;background:rgba(0,0,0,.35)}',
    '#sheet .pane{position:absolute;right:0;top:0;bottom:0;width:min(440px,100%);background:var(--panel);box-shadow:-8px 0 30px rgba(0,0,0,.2);display:flex;flex-direction:column}',
    '#sheet .x{position:absolute;top:10px;right:10px;z-index:1;width:32px;height:32px;border-radius:50%;background:var(--soft);font-size:18px}#sheet .sb{flex:1;min-height:0;overflow:auto;padding:20px}',
    '.sh-h{border-left:4px solid hsl(var(--h) 60% 50%);padding-left:12px;margin-right:40px}.sh-h h3,.sh-p h3{margin:0;font-size:19px}.sh-h p,.sh-p p{margin:3px 0 0;color:var(--mut)}',
    'dl{margin:16px 0 0}dt{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);margin-top:12px}dd{margin:3px 0 0}',
    '.crewlist{list-style:none;padding:0;margin:8px 0 0}.crewlist li{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line)}.crewlist div{display:flex;flex-direction:column}.crewlist small{color:var(--mut);font-size:12px}',
    '.sh-p{display:flex;gap:14px;align-items:center;margin-right:40px}.mut{color:var(--mut)}',
    '.agenda{list-style:none;padding:0;margin:16px 0 0}.agenda li{display:flex;gap:12px;padding:8px 6px;border-bottom:1px solid var(--line);font-size:13px}.agenda li.we,.agenda li.sp{background:var(--sp)}.agenda li.today{box-shadow:inset 3px 0 0 var(--acc)}',
    '.ad{width:92px;flex:none;color:var(--mut);text-transform:capitalize}.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:hsl(var(--h) 60% 50%);margin-right:6px}',
    '@media (max-width:760px){.top{padding:8px 12px}#range{display:none}.mark{position:absolute;top:12px;left:122px}.mark span{display:none}.mark .sym{width:16px;height:16px}input[type=search]{width:120px}select{max-width:150px}.grid{grid-template-columns:150px repeat(var(--n),96px)}.who .av{display:none}.who small{display:none}.dayv{padding:12px}}'
  ].join('\n');

  document.open();
  document.write('<!doctype html><html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Video Team</title>' + (cfg.head || '') + '<style>' + CSS + '</style></head><body>' +
    '<div class="top"><div class="brand"><h1>VIDEO<span> TEAM</span></h1><span id="range"></span></div>' +
    '<div class="ctl"><button class="btn" id="prev" title="Semana anterior">‹</button><button class="btn" id="today">Hoje</button><button class="btn" id="next" title="Semana seguinte">›</button></div>' +
    '<div class="ctl"><div class="seg"><button data-view="grelha">Grelha</button><button data-view="dia">Dia</button></div>' +
    '<label class="tog"><input type="checkbox" id="only"> só com marcação</label><select id="group"></select><input type="search" id="q" placeholder="Procurar…">' +
    '<button class="btn" id="reload" title="Atualizar">⟳</button><span id="status"></span>' +
    (cfg.onLogout ? '<button class="btn" id="logout" title="Sair / mudar código">Sair</button>' : '') + '</div>' +
    '<a class="mark" title="MIKE APPS"><svg class="sym" viewBox="72 72 368 368" aria-hidden="true"><defs><linearGradient id="vtF" x1=".1" y1="0" x2=".9" y2="1"><stop offset="0" stop-color="#1246E6"/><stop offset="1" stop-color="#2E7BFF"/></linearGradient><linearGradient id="vtC" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22D3EE"/><stop offset="1" stop-color="#5FE9FF"/></linearGradient><linearGradient id="vtP" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2E7BFF"/><stop offset="1" stop-color="#22D3EE"/></linearGradient></defs><rect x="72" y="72" width="168" height="168" rx="30" fill="url(#vtF)"/><rect x="272" y="72" width="168" height="168" rx="64" fill="url(#vtC)"/><circle cx="156" cy="356" r="84" fill="#3B8CFF"/><path d="M306 296L306 416L410 356Z" fill="url(#vtP)" stroke="url(#vtP)" stroke-width="30" stroke-linejoin="round"/></svg><span><b>MIKE</b> APPS</span></a></div>' +
    '<div class="main" id="main"></div>' +
    '<div id="sheet"><div class="bd"></div><div class="pane"><button class="x" aria-label="Fechar">×</button><div class="sb"></div></div></div>' +
    '</body></html>');
  document.close();

  // ---------- eventos ----------
  function shift(n) { state.anchor = n === 0 ? new Date() : addDays(state.anchor, n); load(); }
  document.getElementById('prev').onclick = function () { shift(-7); };
  document.getElementById('next').onclick = function () { shift(7); };
  document.getElementById('today').onclick = function () { state.day = TODAY; shift(0); };
  var only = document.getElementById('only');
  only.checked = state.onlyBooked;
  only.onchange = function () { state.onlyBooked = only.checked; store('vt.only', only.checked ? '1' : '0'); paint(false); };
  if (cfg.onLogout) document.getElementById('logout').onclick = function () { cfg.onLogout(); };
  document.getElementById('reload').onclick = function () { load(true); };
  document.getElementById('group').onchange = function (e) { state.group = e.target.value; store('vt.group', state.group); paint(true); };
  var qt;
  document.getElementById('q').oninput = function (e) { clearTimeout(qt); qt = setTimeout(function () { state.q = e.target.value; paint(false); }, 150); };
  document.querySelectorAll('.seg button').forEach(function (b) {
    b.onclick = function () { state.view = b.dataset.view; store('vt.view', state.view); paint(true); };
  });
  document.getElementById('main').addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-pick],[data-i],[data-person]');
    if (!t) return;
    if (t.dataset.pick) { state.day = t.dataset.pick; paint(false); return; }
    var p = findPerson(t.dataset.person);
    if (!p) return;
    if (t.dataset.i != null) entrySheet(p, t.dataset.day, +t.dataset.i); else personSheet(p);
  });
  var sheet = document.getElementById('sheet');
  sheet.querySelector('.bd').onclick = sheet.querySelector('.x').onclick = function () { sheet.classList.remove('open'); };
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') sheet.classList.remove('open'); });

  // cache para abrir logo, depois atualiza
  try {
    var c = JSON.parse(recall('vt.cache') || 'null');
    if (c && c.data && Date.now() - c.at < 7 * 864e5) { state.data = c.data; state.fetchedAt = new Date(c.at); }
  } catch (e) {}
  paint(true);
  load();
  setInterval(function () { if (!document.hidden && !state.loading && keyOf(state.anchor) === TODAY) load(); }, 10 * 60 * 1000);
  return 'app-ok';
});
