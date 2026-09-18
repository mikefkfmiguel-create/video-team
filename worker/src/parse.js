// Le o HTML do VistaSemanal (tabela #maintable) sem DOM, por tokens em ordem.
// Devolve { days: ['2026-09-12', ...], special: {dia: 1}, people: [...] }

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decode(s) {
  return s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENT[e.toLowerCase()] ?? m;
  });
}

const text = (s) => decode(s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t\r]+/g, ' ').trim();

const INC = { FER: 'Férias', FLG: 'Folga', ND: 'Não disponível', RES: 'Reservado', RHT: 'Redução horário' };

function entry(title, inner) {
  const lines = decode(title).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const horLine = lines.find((l) => /^Hor/i.test(l)) || '';
  const hor = horLine.replace(/^Hor[áa]rio das\s*/i, '').replace(/\s*[àa]s\s*/i, '–');
  const a = inner.match(/<a[^>]*>([\s\S]*?)<\/a>/i);
  if (/^Incid/i.test(lines[0] || '')) {
    const code = text(inner);
    return { kind: 'inc', code, label: lines[0].replace(/^Incid[êe]ncia:\s*/i, '') || INC[code] || code, hor };
  }
  let code, event;
  if (a) {
    event = text(a[1]);
    code = text(inner.replace(a[0], ''));
  } else {
    const parts = text(inner).split(/\s+/);
    code = parts.shift() || '';
    event = parts.join(' ');
  }
  const pm = a && a[0].match(/value=(\d+)/);
  return {
    kind: 'os',
    prop: pm ? pm[1] : null,
    code,
    osFull: lines[0] || code,
    event,
    client: lines[1] && !/^Hor/i.test(lines[1]) ? lines[1] : '',
    hor,
  };
}

export function parseEscala(html) {
  const start = html.indexOf('id="maintable"');
  if (start < 0) throw new Error('Nao encontrei a tabela da escala');
  const body = html.slice(html.indexOf('<tbody', start));

  const TOKEN = new RegExp(
    [
      // 1: celula do grupo (com foto)
      `<td align="left" style="font-size:xx-small;[^"]*">([\\s\\S]*?)</td>`,
      // 2,3,4,5: celula do nome
      `<td align="left" nowrap style="[^"]*" title="([^"]*)">\\s*<a href="[^"]*?(\\d+)"\\s*>\\s*<h3>([\\s\\S]*?)</h3>\\s*</a>([\\s\\S]*?)</td>`,
      // 6,7,8,9,10: celula de um dia
      `<td[^>]*\\bid='(\\d+)_[^']*_(\\d{2})/(\\d{2})/(\\d{4})'[^>]*style='([^']*)'`,
      // 11,12,13: marcacao dentro do dia
      `<td align="center" id="(\\d+)"[^>]*title="([^"]*)"[^>]*>\\s*<b>([\\s\\S]*?)</b>`,
    ].join('|'),
    'g'
  );

  const days = {}, special = {}, people = [];
  let person = null, day = null, m;
  while ((m = TOKEN.exec(body))) {
    if (m[1] !== undefined) {
      const img = m[1].match(/<img[^>]*src="([^"]+)"/i);
      const fm = img && img[1].match(/FotosTecnicos\/(\d+)\.\w+/i);
      person = { id: null, name: '', grupo: text(m[1]), foto: fm ? fm[1] : null, empresa: '', stats: '', cells: {} };
      people.push(person);
    } else if (m[2] !== undefined) {
      if (!person) continue;
      person.empresa = decode(m[2]);
      person.id = m[3];
      person.name = text(m[4]);
      person.stats = text(m[5]);
    } else if (m[6] !== undefined) {
      day = `${m[9]}-${m[8]}-${m[7]}`;
      days[day] = 1;
      if (/ffffb3/i.test(m[10])) special[day] = 1;
    } else if (m[11] !== undefined) {
      if (!person || !day) continue;
      (person.cells[day] = person.cells[day] || []).push(entry(m[12], m[13]));
    }
  }
  for (const p of people) if (!p.id) p.id = p.name;
  return { days: Object.keys(days).sort(), special, people };
}
