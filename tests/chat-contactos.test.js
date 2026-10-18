// node tests/chat-contactos.test.js — importar contactos do Google (CSV/vCard) e casar com a equipa. Sem rede.
const assert = require('node:assert/strict');
const C = require('../shared/chat.js')._t;
let n = 0;
const t = (nome, f) => { f(); n++; console.log('OK    ' + nome); };

t('telefones: portugueses, com indicativo, 00 e lixo', () => {
  assert.equal(C.fone('912 345 678'), '351912345678');
  assert.equal(C.fone('+351 912-345-678'), '351912345678');
  assert.equal(C.fone('00351912345678'), '351912345678');
  assert.equal(C.fone('(+44) 7700 900123'), '447700900123');
  assert.equal(C.fone('+34 612 345 678'), '34612345678');
  assert.equal(C.fone('123'), '');
  assert.equal(C.fone(''), '');
  assert.equal(C.fone('912345678 ::: 213456789'), '351912345678', 'varios numeros no mesmo campo: o primeiro');
});

t('nomes: sem acentos, maiusculas nem pontuacao', () => {
  assert.equal(C.chave('  João   Sílva-Ç. '), 'joao silva c');
});

const GOOGLE = [
  'First Name,Middle Name,Last Name,Phonetic First Name,Nickname,E-mail 1 - Label,E-mail 1 - Value,Phone 1 - Label,Phone 1 - Value,Phone 2 - Label,Phone 2 - Value',
  'Ana,Maria,Silva,,,,ana@x.pt,Mobile,+351 912 345 678,Work,213 000 111',
  'Rui,,Costa,,,,,Mobile,967000111,,',
  '"João ""Jó""",,Pereira,,,,,Mobile,+351 91 000 0000 ::: +351 93 111 2222,,',
  'Ana,,Silva,,,,,Mobile,+351 934 000 999,,',
  'Rui,,Costa,,,,,Mobile,968 222 333,,',
  'Marta,,Lopes,,,Home,marta@x.pt,,,,',
  'Sem,,Numero,,,,,,,,',
  '"Hugo","",Dias,,,,,Mobile,"+351 925 111 222",,',
].join('\r\n');

t('CSV do Google: nomes, telefones, emails, aspas; ignora contactos sem telefone nem email', () => {
  const l = C.lerCsv(GOOGLE);
  assert.equal(l.length, 7);
  assert.deepEqual(l[0].t, ['351912345678', '351213000111']);
  assert.equal(l[0].e, 'ana@x.pt');
  assert.equal(l[0].n, 'Ana Maria Silva');
  assert.equal(l[2].n, 'João "Jó" Pereira');
  assert.deepEqual(l[2].t, ['351910000000', '351931112222']);
  assert.equal(l[5].e, 'marta@x.pt');
  assert.deepEqual(l[5].t, []);
});

t('CSV novo do Google (coluna «Name») e quebras de linha dentro de campos', () => {
  const l = C.lerCsv('Name,Given Name,Family Name,Notes,Phone 1 - Value\n"Pedro Gomes",Pedro,Gomes,"linha 1\nlinha 2",+351 913 222 111\n');
  assert.equal(l.length, 1);
  assert.equal(l[0].n, 'Pedro Gomes');
  assert.equal(l[0].t[0], '351913222111');
});

t('vCard (.vcf): FN, TEL e EMAIL', () => {
  const l = C.lerVcf('BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Joana Reis\r\nTEL;TYPE=CELL:+351 966 777 888\r\nEMAIL:j@x.pt\r\nEND:VCARD\r\nBEGIN:VCARD\r\nFN:Sem Tel\r\nEND:VCARD\r\n');
  assert.equal(l.length, 1);
  assert.deepEqual([l[0].n, l[0].t[0], l[0].e], ['Joana Reis', '351966777888', 'j@x.pt']);
});

const lista = C.lerCsv(GOOGLE);
const eq = (p) => C.contactoDe({ id: '9', name: p }, lista, {});

t('casar: nome igual (sem acentos/maiusculas)', () => {
  assert.equal(eq('HUGO DIAS').t, '351925111222');
  assert.equal(eq('Joao Pereira').t, '351910000000');
  assert.equal(eq('Ana Silva').t, '351934000999', 'o nome exato ganha ao parecido («Ana Maria Silva»)');
});
t('casar: nome do 7Eventos mais curto ou mais comprido que o do Google', () => {
  assert.equal(eq('Hugo Miguel Dias').t, '351925111222', 'o 7Eventos tem mais nomes');
  assert.equal(eq('Marta Lopes').e, 'marta@x.pt');
});
t('casar: duas pessoas parecidas -> pede escolha, nunca adivinha', () => {
  const r = eq('Rui Costa');
  assert.ok(r.ambiguo && r.ambiguo.length === 2, JSON.stringify(r));
});
t('casar: ninguem com esse nome -> vazio; nao confunde so o primeiro nome', () => {
  assert.deepEqual(eq('Carlos Nunes'), {});
  assert.deepEqual(eq('Rui'), {}, 'um so nome nao casa com ninguem');
  assert.equal(eq('Ana Maria Silva').t, '351912345678');
});
t('o acerto a mao ganha sempre', () => {
  const r = C.contactoDe({ id: '5', name: 'Rui Costa' }, lista, { 5: { t: '351900000001', e: '' } });
  assert.equal(r.t, '351900000001');
  assert.equal(r.de, 'manual');
});

t('inicial do apelido: «Rodrigo S» sugere «Rodrigo Santos» (e «Rodrigo Batista» tambem: confirma o dono)', () => {
  const L = C.lerCsv('First Name,Last Name,Phone 1 - Value\nRodrigo,S,961 000 001\nZe,Silva,962 000 002');
  const a = C.contactoDe({ id: '1', name: 'Rodrigo Santos' }, L, {});
  assert.ok(a.ambiguo && a.aproximado && a.ambiguo[0].t[0] === '351961000001', JSON.stringify(a));
  assert.deepEqual(C.contactoDe({ id: '2', name: 'Rodrigo Batista' }, L, {}), {}, '«Rodrigo S» nao serve para «Rodrigo Batista» (a inicial nao bate)');
  assert.deepEqual(C.contactoDe({ id: '3', name: 'Zeca Silva' }, L, {}), {}, '«Ze» como 1.o nome continua curto demais');
});

t('abreviaturas: «Rafa» para «Rafael Anchieta» e sugerido, nunca automatico', () => {
  const L = C.lerCsv('First Name,Last Name,Phone 1 - Value\nRafa,,961 000 001\nTiago,,962 000 002\nTi,,963 000 003\nZe,,964 000 004\nTiago,Mota,965 000 005');
  const r = C.contactoDe({ id: '1', name: 'Rafael Anchieta' }, L, {});
  assert.ok(r.ambiguo && r.aproximado && r.ambiguo.length === 1 && r.ambiguo[0].t[0] === '351961000001', JSON.stringify(r));
  assert.equal(C.contactoDe({ id: '1', name: 'Rafael Anchieta' }, L, {}).t, undefined, 'nao preenche sozinho');
  const g = C.contactoDe({ id: '2', name: 'Tiago Mota Gonçalves' }, L, {});
  assert.equal(g.t, '351965000005', 'Tiago Mota esta contido em Tiago Mota Goncalves: esse sim casa sozinho');
  assert.deepEqual(C.contactoDe({ id: '3', name: 'Zeca Silva' }, L, {}), {}, '«Ze» tem 2 letras: demasiado curto para sugerir');
  assert.deepEqual(C.contactoDe({ id: '4', name: 'Carlos Lopes' }, L, {}), {}, 'nada parecido: vazio');
});

console.log('\n' + n + ' testes ok');
