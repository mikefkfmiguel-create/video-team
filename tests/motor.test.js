// node tests/motor.test.js
const assert = require('assert');
const E = require('../shared/salas-motor.js');

const dias = ['2026-10-13', '2026-10-14', '2026-10-15'];
const crew = [
  { id: '1', name: 'Ana Silva', grupo: 'Técnicos de Vídeo', days: dias },
  { id: '2', name: 'Rui Costa', grupo: 'Técnicos de Vídeo', days: [dias[0], dias[1]] },
  { id: '3', name: 'Luz Um', grupo: 'Luz', days: dias },
];
const doc = E.novoDoc({ sig: 'os:1:Teste', evento: 'Ciência', crew });
assert.deepStrictEqual(doc.dias, dias);
assert.deepStrictEqual(doc.grupos, ['Técnicos de Vídeo']); // só vídeo por defeito
assert.equal(E.equipa(doc, crew).length, 2);
assert.deepStrictEqual(doc.aloc, {}); // evento novo: ninguém tem destino

doc.salas.push({ id: 's1', nome: 'Auditório 1', curto: 'AUDI 1', regras: 'herdar', alias: [] }, { id: 's2', nome: 'Auditório 2', curto: 'AUD 2', regras: 'herdar', alias: [] });
const mix = 'f1', cam = 'f2';

// avisos iniciais: 2 pessoas sem destino no dia 13, 2 no 14, 1 no 15
let v = E.validar(doc, crew);
assert.equal(v.filter((x) => x.tipo === 'semDestino').length, 5);

// atribuir só um dia / todos os dias
E.atribuir(doc, crew, ['1'], dias[0], 'dia', 's1', [cam]);
assert.equal(E.get(doc, '1', dias[0])[0].sala, 's1');
assert.equal(E.temDestino(doc, '1', dias[1]), false);
E.atribuir(doc, crew, ['2'], dias[0], 'todos', 's1', [mix]);
assert.equal(E.temDestino(doc, '2', dias[1]), true);
assert.equal(E.temDestino(doc, '2', dias[2]), false); // não trabalha no 15

// copiar do dia anterior só preenche vazios
assert.equal(E.copiarAnterior(doc, crew, dias[1]), 1); // Ana (Rui já tem)
assert.equal(E.get(doc, '1', dias[1])[0].f[0], cam);
assert.equal(E.copiarAnterior(doc, crew, dias[1]), 0);

// preencher todos os dias: não sobrepõe, depois sobrepõe
E.atribuir(doc, crew, ['1'], dias[1], 'dia', 's2', [cam]);
E.preencherTodos(doc, crew, dias[0], ['1'], false);
assert.equal(E.get(doc, '1', dias[1])[0].sala, 's2'); // mantido
assert.equal(E.get(doc, '1', dias[2])[0].sala, 's1'); // preenchido
E.preencherTodos(doc, crew, dias[0], ['1'], true);
assert.equal(E.get(doc, '1', dias[1])[0].sala, 's1'); // substituído

// avisos: sala sem MIX, duas salas, fora da escala
v = E.validar(doc, crew);
assert.ok(v.some((x) => x.tipo === 'salaSemMix' && x.sala === 's1' && x.dia === dias[2])); // só Ana (cam) no 15
assert.ok(!v.some((x) => x.tipo === 'salaSemMix' && x.dia === dias[0])); // Rui é MIX
assert.ok(!v.some((x) => x.tipo === 'salaSemCam' && x.dia === dias[0]));
doc.aloc['1'][dias[0]].push({ sala: 's2', f: [] });
assert.ok(E.validar(doc, crew).some((x) => x.tipo === 'duasSalas' && x.id === '1'));
E.atribuir(doc, crew, ['2'], dias[2], 'dia', 's2', [mix]); // Rui não trabalha no 15
assert.ok(E.validar(doc, crew).some((x) => x.tipo === 'foraEscala' && x.id === '2' && x.dia === dias[2]));

// ignorar e regras configuráveis
const dup = E.validar(doc, crew).find((x) => x.tipo === 'duasSalas');
doc.ignorar.push(dup.key);
assert.ok(E.validar(doc, crew).find((x) => x.key === dup.key).ignorado);
doc.regras.salaSemMix = 'off';
assert.ok(!E.validar(doc, crew).some((x) => x.tipo === 'salaSemMix'));
doc.salas[1].regras = 'off';
doc.regras.salaSemCam = 'aviso';
assert.ok(!E.validar(doc, crew).some((x) => x.tipo === 'salaSemCam' && x.sala === 's2'));

// apagar sala/função limpa referências; dias fora do evento
E.removerFuncao(doc, cam);
assert.ok(!JSON.stringify(doc.aloc).includes('"f2"'));
E.removerSala(doc, 's2');
assert.ok(!JSON.stringify(doc.aloc).includes('"s2"'));
doc.dias = doc.dias.slice(0, 2); E.podarDias(doc);
assert.ok(!Object.values(doc.aloc).some((o) => o[dias[2]]));
assert.equal(E.novoId(doc.salas, 's'), 's2');

// exportação no formato da folha, sem telefones
const d2 = E.novoDoc({ sig: 's', evento: 'Ciência', crew });
d2.salas.push({ id: 's1', nome: 'Auditório 1', curto: 'AUDI 1', regras: 'herdar', alias: [] });
E.atribuir(d2, crew, ['1'], dias[0], 'dia', 's1', ['f2']);
E.atribuir(d2, crew, ['2'], dias[0], 'dia', null, ['f4']);
d2.nomes['2'] = { folha: 'RUI C.' };
const csv = E.paraCsv(d2, crew);
assert.equal(csv, 'TECNICO,13,14,15\r\nANA SILVA,"CIÊNCIA, AUDI 1, CAM",,\r\nRUI C.,"CIÊNCIA, RUNNER",,\r\n');
assert.ok(E.paraCsv(d2, crew, ';').startsWith('TECNICO;13;14;15'));
console.log('motor salas: ok');
