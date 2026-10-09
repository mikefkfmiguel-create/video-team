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

  if (typeof module !== 'undefined' && module.exports) module.exports = E;
  else root.__vtSalasMotor = E;
})(typeof window !== 'undefined' ? window : this);
