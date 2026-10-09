// Video Team — equipa por sala/funcao: motor puro (sem DOM, sem rede).
// Corre no browser (window.__vtSalasMotor) e em node (module.exports) para testes.
// Modelo: ver docs/DESENHO-SALAS.md. aloc[idTecnico][dia] = [{sala: id|null, f: [idFuncao]}]
(function (root) {
  var E = {};

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function has(a, x) { return a.indexOf(x) >= 0; }

  var REGRAS = ['semDestino', 'duasSalas', 'foraEscala', 'salaSemMix', 'salaSemCam'];

  E.funcoesPorDefeito = function () {
    return [
      { id: 'f1', nome: 'MIX', curto: 'MIX', conta: 'mix', alias: [] },
      { id: 'f2', nome: 'CAM', curto: 'CAM', conta: 'cam', alias: [] },
      { id: 'f3', nome: 'AV/VMIX', curto: 'AV/VMIX', conta: 'mix', alias: [] },
      { id: 'f4', nome: 'Runner', curto: 'RUNNER', conta: null, alias: [] }
    ];
  };

  // grupos por defeito: os que tiverem "video" no nome (sem acentos); se nao houver, todos
  function norm(s) { return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }
  E.norm = norm;

  E.novoDoc = function (info) {
    var crew = info.crew || [], dias = {}, grupos = {};
    crew.forEach(function (p) { (p.days || []).forEach(function (d) { dias[d] = 1; }); grupos[p.grupo] = 1; });
    var video = Object.keys(grupos).filter(function (g) { return norm(g).indexOf('video') >= 0; });
    var regras = {};
    REGRAS.forEach(function (r) { regras[r] = 'aviso'; });
    return {
      v: 1, rev: 0, sig: info.sig, code: info.code || '', evento: info.evento || '', ancora: info.ancora || '',
      dias: Object.keys(dias).sort(),
      grupos: video.length ? video : Object.keys(grupos).sort(),
      salas: [], funcoes: E.funcoesPorDefeito(), regras: regras,
      aloc: {}, nomes: {}, ignorar: [],
      link: { publicado: false, mostra: 'equipa' }
    };
  };

  // equipa oficial filtrada pelos grupos escolhidos (lista vazia = todos)
  E.equipa = function (doc, crew) {
    return crew.filter(function (p) { return !doc.grupos.length || has(doc.grupos, p.grupo); });
  };
  E.trabalha = function (p, dia) { return has(p.days || [], dia); };
  E.get = function (doc, id, dia) { return (doc.aloc[id] && doc.aloc[id][dia]) || []; };
  E.temDestino = function (doc, id, dia) { return E.get(doc, id, dia).length > 0; };

  function put(doc, id, dia, entries) {
    if (!entries || !entries.length) {
      if (doc.aloc[id]) { delete doc.aloc[id][dia]; if (!Object.keys(doc.aloc[id]).length) delete doc.aloc[id]; }
      return;
    }
    (doc.aloc[id] = doc.aloc[id] || {})[dia] = entries;
  }

  // dias em que a pessoa trabalha e que fazem parte do evento
  E.diasDe = function (doc, p) { return doc.dias.filter(function (d) { return E.trabalha(p, d); }); };

  // atribui sala+funcoes a varias pessoas. scope 'dia' = so `dia`; 'todos' = todos os dias em que cada uma trabalha
  E.atribuir = function (doc, crew, ids, dia, scope, sala, funcs) {
    var entry = (sala || (funcs && funcs.length)) ? [{ sala: sala || null, f: (funcs || []).slice() }] : [];
    var n = 0;
    ids.forEach(function (id) {
      var p = crew.filter(function (c) { return c.id === id; })[0];
      var dias = scope === 'todos' && p ? E.diasDe(doc, p) : [dia];
      if (!dias.length) dias = [dia];
      dias.forEach(function (d) { put(doc, id, d, clone(entry)); n++; });
    });
    return n;
  };

  E.limpar = function (doc, ids, dia) { ids.forEach(function (id) { put(doc, id, dia, null); }); };

  // para quem trabalha em `dia` e ainda nao tem destino: copia o ultimo destino que tenha tido num dia anterior
  E.copiarAnterior = function (doc, crew, dia) {
    var i = doc.dias.indexOf(dia), n = 0;
    if (i <= 0) return 0;
    E.equipa(doc, crew).forEach(function (p) {
      if (!E.trabalha(p, dia) || E.temDestino(doc, p.id, dia)) return;
      for (var j = i - 1; j >= 0; j--) {
        var prev = E.get(doc, p.id, doc.dias[j]);
        if (prev.length) { put(doc, p.id, dia, clone(prev)); n++; break; }
      }
    });
    return n;
  };

  // repete a atribuicao de `dia` pelos outros dias em que a pessoa trabalha.
  // ids = quem (por defeito todos os que tem destino em `dia`); substituir = tambem sobrepoe o que ja existe
  E.preencherTodos = function (doc, crew, dia, ids, substituir) {
    var n = 0;
    E.equipa(doc, crew).forEach(function (p) {
      if (ids && ids.length && !has(ids, p.id)) return;
      var src = E.get(doc, p.id, dia);
      if (!src.length) return;
      doc.dias.forEach(function (d) {
        if (d === dia || !E.trabalha(p, d)) return;
        if (E.temDestino(doc, p.id, d) && !substituir) return;
        put(doc, p.id, d, clone(src)); n++;
      });
    });
    return n;
  };

  // remove atribuicoes de dias que deixaram de fazer parte do evento
  E.podarDias = function (doc) {
    Object.keys(doc.aloc).forEach(function (id) {
      Object.keys(doc.aloc[id]).forEach(function (d) { if (!has(doc.dias, d)) delete doc.aloc[id][d]; });
      if (!Object.keys(doc.aloc[id]).length) delete doc.aloc[id];
    });
  };

  // apagar uma sala/funcao tira-a das atribuicoes
  E.removerSala = function (doc, sid) {
    doc.salas = doc.salas.filter(function (s) { return s.id !== sid; });
    Object.keys(doc.aloc).forEach(function (id) {
      Object.keys(doc.aloc[id]).forEach(function (d) {
        var l = doc.aloc[id][d].map(function (x) { return { sala: x.sala === sid ? null : x.sala, f: x.f }; })
          .filter(function (x) { return x.sala || x.f.length; });
        put(doc, id, d, l);
      });
    });
  };
  E.removerFuncao = function (doc, fid) {
    doc.funcoes = doc.funcoes.filter(function (f) { return f.id !== fid; });
    Object.keys(doc.aloc).forEach(function (id) {
      Object.keys(doc.aloc[id]).forEach(function (d) {
        var l = doc.aloc[id][d].map(function (x) { return { sala: x.sala, f: x.f.filter(function (f) { return f !== fid; }) }; })
          .filter(function (x) { return x.sala || x.f.length; });
        put(doc, id, d, l);
      });
    });
  };

  E.novoId = function (lista, prefixo) {
    var max = 0;
    lista.forEach(function (x) { var n = parseInt(String(x.id).slice(prefixo.length), 10); if (n > max) max = n; });
    return prefixo + (max + 1);
  };

  // ---------- avisos ----------
  // devolve [{tipo, key, dia, id?, sala?, ignorado}] — nada bloqueia, so informa
  E.validar = function (doc, crew) {
    var out = [], equipa = E.equipa(doc, crew), byId = {};
    equipa.forEach(function (p) { byId[p.id] = p; });
    function on(r) { return doc.regras[r] !== 'off'; }
    function add(tipo, key, dia, extra) {
      var it = { tipo: tipo, key: tipo + ':' + key + ':' + dia, dia: dia };
      for (var k in extra) it[k] = extra[k];
      it.ignorado = has(doc.ignorar, it.key);
      out.push(it);
    }
    var temMix = doc.funcoes.some(function (f) { return f.conta === 'mix'; });
    var temCam = doc.funcoes.some(function (f) { return f.conta === 'cam'; });
    var conta = {}; doc.funcoes.forEach(function (f) { conta[f.id] = f.conta; });

    doc.dias.forEach(function (dia) {
      var porSala = {};
      equipa.forEach(function (p) {
        var l = E.get(doc, p.id, dia);
        if (E.trabalha(p, dia) && !l.length && on('semDestino')) add('semDestino', p.id, dia, { id: p.id });
        var salas = [];
        l.forEach(function (x) { if (x.sala && !has(salas, x.sala)) salas.push(x.sala); });
        if (salas.length > 1 && on('duasSalas')) add('duasSalas', p.id, dia, { id: p.id, salas: salas });
        l.forEach(function (x) { if (x.sala) (porSala[x.sala] = porSala[x.sala] || []).push(x); });
      });
      // atribuicoes a quem nao esta (ou ja nao esta) na escala oficial nesse dia
      Object.keys(doc.aloc).forEach(function (id) {
        if (!doc.aloc[id][dia] || !on('foraEscala')) return;
        var p = byId[id];
        if (!p || !E.trabalha(p, dia)) add('foraEscala', id, dia, { id: id });
      });
      doc.salas.forEach(function (s) {
        var l = porSala[s.id];
        if (!l || s.regras === 'off') return;
        var fs = [];
        l.forEach(function (x) { x.f.forEach(function (f) { fs.push(conta[f]); }); });
        if (temMix && on('salaSemMix') && !has(fs, 'mix')) add('salaSemMix', s.id, dia, { sala: s.id });
        if (temCam && on('salaSemCam') && !has(fs, 'cam')) add('salaSemCam', s.id, dia, { sala: s.id });
      });
    });
    return out;
  };

  // ---------- exportar (formato da folha: TECNICO, dia 13, 14, ...) ----------
  function csvCell(v) { v = String(v == null ? '' : v); return /[",;\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }

  // texto de uma celula: EVENTO, SALA, FUNCAO (varias entradas separadas por " + ")
  E.textoCelula = function (doc, entries) {
    var salas = {}, funs = {};
    doc.salas.forEach(function (s) { salas[s.id] = s.curto || s.nome; });
    doc.funcoes.forEach(function (f) { funs[f.id] = f.curto || f.nome; });
    var parts = [doc.evento ? doc.evento.toUpperCase() : ''];
    entries.forEach(function (x) {
      if (x.sala) parts.push(salas[x.sala] || '');
      x.f.forEach(function (f) { parts.push(funs[f] || ''); });
    });
    return parts.filter(Boolean).join(', ');
  };

  E.nomeNaFolha = function (doc, p) { return (doc.nomes[p.id] && doc.nomes[p.id].folha) || p.name.toUpperCase(); };

  // sep: ',' (folha do Google) ou ';' (Excel em PT). So tecnicos com pelo menos um dia no evento. Sem contactos.
  E.paraCsv = function (doc, crew, sep) {
    sep = sep || ',';
    var head = ['TECNICO'].concat(doc.dias.map(function (d) { return String(parseInt(d.slice(8), 10)); }));
    var rows = [head];
    E.equipa(doc, crew).slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'pt'); }).forEach(function (p) {
      if (!E.diasDe(doc, p).length && !Object.keys(doc.aloc[p.id] || {}).length) return;
      rows.push([E.nomeNaFolha(doc, p)].concat(doc.dias.map(function (d) {
        var l = E.get(doc, p.id, d);
        return l.length ? E.textoCelula(doc, l) : '';
      })));
    });
    return rows.map(function (r) { return r.map(csvCell).join(sep); }).join('\r\n') + '\r\n';
  };

  // ---------- importar da folha atual (uma vez) ----------
  // folha = {header:['9','10',...], rows:[{nome, cells:['EVENTO, SALA, FUNCAO', ...]}]} (ja sem contactos)
  function trim(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // chave de comparacao: sem acentos nem maiusculas; AUD/AUDI/AUDITORIO e PAV/PAVILHAO contam como o mesmo
  function chave(t) {
    return norm(t).replace(/\s+/g, ' ').replace(/^(auditorio|audi|aud)\b\.?\s*/, 'aud ').replace(/^(pavilhao|pav)\b\.?\s*/, 'pav ').replace(/\s+/g, ' ').trim();
  }
  E.chave = chave;
  function acha(lista, k) {
    return lista.filter(function (x) {
      return chave(x.nome) === k || chave(x.curto || '') === k || (x.alias || []).some(function (a) { return chave(a) === k; });
    })[0] || null;
  }
  var PARECE_SALA = /^(aud|pav|sala|terrace|terraco|feira|palco|foyer|hall|plenario|exterior)\b/;

  E.celula = function (texto) {
    var p = String(texto || '').split(',').map(trim).filter(Boolean);
    return { evento: p[0] || '', tokens: p.slice(1) };
  };

  function diaDe(label, mes) {
    var n = parseInt(label, 10);
    return n >= 1 && n <= 31 && /^\d{4}-\d{2}$/.test(mes || '') ? mes + '-' + pad2(n) : null;
  }

  // nome da folha -> tecnico oficial: correspondencia guardada, nome igual, ou prefixos por ordem (ex. «J. SILVA»).
  // So casa sozinho se houver UM candidato; com varios fica para o Mike escolher.
  function casarNome(nome, eq, guardado, over) {
    var key = norm(nome).replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
    var r = { nome: nome, key: key, id: null, candidatos: [], origem: '' };
    if (over && over[key] !== undefined) { r.id = over[key] || null; r.ignorar = over[key] === ''; r.origem = 'manual'; return r; }
    var g = guardado[key];
    if (g && eq.some(function (p) { return p.id === g; })) { r.id = g; r.origem = 'guardado'; return r; }
    var exatos = eq.filter(function (p) { return norm(p.name).replace(/\s+/g, ' ') === key; });
    if (exatos.length === 1) { r.id = exatos[0].id; r.origem = 'exato'; return r; }
    var ft = key.split(' ').filter(Boolean);
    var cands = eq.filter(function (p) {
      var ot = norm(p.name).split(' ').filter(Boolean), pos = 0;
      return ft.every(function (t) {
        for (; pos < ot.length; pos++) if (ot[pos].indexOf(t) === 0) { pos++; return true; }
        return false;
      });
    });
    r.candidatos = cands.map(function (p) { return p.id; });
    if (cands.length === 1) { r.id = cands[0].id; r.origem = 'aproximado'; }
    return r;
  }

  // o que ha para decidir antes de importar: eventos da folha, siglas por classificar, nomes por casar
  // o = {evento: nome do evento na folha, mes: 'AAAA-MM', tokens: {chave: 's'|'f'|'x'|'s:ID'|'f:ID'}, nomes: {chave: idTecnico|''}}
  E.analisarImport = function (doc, crew, folha, o) {
    o = o || {};
    var eventos = {}, ev = o.evento ? norm(o.evento) : null, toks = {}, nomes = [], stats = { celulas: 0, foraDias: 0 };
    var eq = E.equipa(doc, crew), guardado = {};
    Object.keys(doc.nomes || {}).forEach(function (id) { if (doc.nomes[id].folha) guardado[norm(doc.nomes[id].folha).replace(/\./g, ' ').replace(/\s+/g, ' ').trim()] = id; });
    folha.rows.forEach(function (r) {
      var rel = false;
      r.cells.forEach(function (c, i) {
        if (!c) return;
        var cel = E.celula(c);
        if (!cel.evento) return;
        var ek = norm(cel.evento);
        var e = eventos[ek] = eventos[ek] || { nome: cel.evento, key: ek, n: 0 };
        e.n++;
        if (!ev || ek !== ev) return;
        var dia = diaDe(folha.header[i], o.mes);
        if (!dia || doc.dias.indexOf(dia) < 0) { stats.foraDias++; return; }
        stats.celulas++; rel = true;
        cel.tokens.forEach(function (t) {
          var k = chave(t);
          if (acha(doc.salas, k) || acha(doc.funcoes, k)) return;
          var x = toks[k] = toks[k] || { key: k, texto: t, n: 0, sug: PARECE_SALA.test(k) ? 's' : 'f' };
          x.n++;
        });
      });
      if (rel) nomes.push(casarNome(r.nome, eq, guardado, o.nomes));
    });
    return {
      eventos: Object.keys(eventos).map(function (k) { return eventos[k]; }).sort(function (a, b) { return b.n - a.n; }),
      tokens: Object.keys(toks).map(function (k) { return toks[k]; }),
      nomes: nomes, stats: stats
    };
  };

  // aplica: cria as salas/funcoes novas, grava as siglas conhecidas como alias e atribui. Substitui o destino
  // de cada pessoa/dia que a folha preenche; o resto fica como esta.
  E.aplicarImport = function (doc, crew, folha, o) {
    var an = E.analisarImport(doc, crew, folha, o), idDe = {}, res = { atribuicoes: 0, semNome: 0, pessoas: 0 };
    an.nomes.forEach(function (n) { if (n.id) idDe[n.key] = n; else if (!n.ignorar) res.semNome++; });
    an.tokens.forEach(function (t) {
      var esc = (o.tokens && o.tokens[t.key]) || t.sug;
      if (esc === 'x') return;
      if (esc.indexOf(':') > 0) {
        var lista = esc.charAt(0) === 's' ? doc.salas : doc.funcoes;
        var it = lista.filter(function (x) { return x.id === esc.slice(2); })[0];
        if (it) { (it.alias = it.alias || []).push(t.texto); return; }
      }
      if (esc.charAt(0) === 's') doc.salas.push({ id: E.novoId(doc.salas, 's'), nome: t.texto, curto: t.texto.toUpperCase(), alias: [], regras: 'herdar' });
      else doc.funcoes.push({ id: E.novoId(doc.funcoes, 'f'), nome: t.texto, curto: t.texto.toUpperCase(), conta: null, alias: [] });
    });
    var ev = norm(o.evento), vistos = {};
    folha.rows.forEach(function (r) {
      var key = norm(r.nome).replace(/\./g, ' ').replace(/\s+/g, ' ').trim(), n = idDe[key];
      if (!n) return;
      r.cells.forEach(function (c, i) {
        if (!c) return;
        var cel = E.celula(c), dia = diaDe(folha.header[i], o.mes);
        if (norm(cel.evento) !== ev || !dia || doc.dias.indexOf(dia) < 0) return;
        var salas = [], fs = [];
        cel.tokens.forEach(function (t) {
          var k = chave(t), s = acha(doc.salas, k), f = s ? null : acha(doc.funcoes, k);
          if (s && !has(salas, s.id)) salas.push(s.id);
          if (f && !has(fs, f.id)) fs.push(f.id);
        });
        if (!salas.length && !fs.length) return;
        var entradas = salas.length ? salas.map(function (s) { return { sala: s, f: fs.slice() }; }) : [{ sala: null, f: fs }];
        put(doc, n.id, dia, entradas);
        res.atribuicoes++;
        if (!vistos[n.id]) { vistos[n.id] = 1; res.pessoas++; (doc.nomes[n.id] = doc.nomes[n.id] || {}).folha = r.nome; }
      });
    });
    return res;
  };

  // ---------- imprimir / PDF ----------
  function h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var DOWL = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

  // uma pagina por dia: sala -> pessoa e funcao; no fim, quem nao tem destino. Sem contactos.
  E.paraHtml = function (doc, crew) {
    var eq = E.equipa(doc, crew).slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'pt'); });
    var salas = {}, funs = {};
    doc.salas.forEach(function (s) { salas[s.id] = s.nome; });
    doc.funcoes.forEach(function (f) { funs[f.id] = f.nome; });
    var out = '<!doctype html><html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + h(doc.evento || 'Equipa por sala') + '</title>' +
      '<style>body{font:14px/1.4 system-ui,Segoe UI,Arial,sans-serif;color:#111;margin:24px}h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:0 0 8px;text-transform:capitalize}' +
      '.dia{page-break-after:always;margin-bottom:28px}.dia:last-child{page-break-after:auto}table{border-collapse:collapse;width:100%;margin-bottom:10px}' +
      'th,td{border:1px solid #bbb;padding:5px 8px;text-align:left;vertical-align:top}th{background:#eee;width:30%}.mut{color:#666;font-size:12px}' +
      '.np{margin:0 0 16px;padding:8px 14px;font:inherit;cursor:pointer}@media print{.np{display:none}body{margin:12mm}}</style></head><body>' +
      '<button class="np" onclick="window.print()">Imprimir / Guardar em PDF</button><h1>' + h(doc.evento || 'Equipa por sala') + '</h1>';
    doc.dias.forEach(function (dia) {
      var d = new Date(+dia.slice(0, 4), +dia.slice(5, 7) - 1, +dia.slice(8));
      var porSala = {}, semSala = [], sem = [];
      eq.forEach(function (p) {
        if (!E.trabalha(p, dia)) return;
        var l = E.get(doc, p.id, dia);
        if (!l.length) { sem.push(p.name); return; }
        l.forEach(function (x) {
          var f = x.f.map(function (i) { return funs[i]; }).filter(Boolean).join(' + ');
          (x.sala ? (porSala[x.sala] = porSala[x.sala] || []) : semSala).push({ nome: p.name, f: f });
        });
      });
      out += '<section class="dia"><h2>' + DOWL[d.getDay()] + ', ' + d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear() + '</h2>';
      var linhas = '';
      doc.salas.forEach(function (s) {
        (porSala[s.id] || []).forEach(function (o, i, a) {
          linhas += '<tr>' + (i === 0 ? '<th rowspan="' + a.length + '">' + h(s.nome) + '</th>' : '') + '<td>' + h(o.nome) + '</td><td>' + h(o.f) + '</td></tr>';
        });
      });
      semSala.forEach(function (o, i, a) { linhas += '<tr>' + (i === 0 ? '<th rowspan="' + a.length + '">Sem sala</th>' : '') + '<td>' + h(o.nome) + '</td><td>' + h(o.f) + '</td></tr>'; });
      out += linhas ? '<table>' + linhas + '</table>' : '<p class="mut">Sem destinos atribuídos.</p>';
      if (sem.length) out += '<p class="mut">Sem destino: ' + sem.map(h).join(', ') + '</p>';
      out += '</section>';
    });
    return out + '</body></html>';
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = E;
  else root.__vtSalasMotor = E;
})(typeof window !== 'undefined' ? window : this);
