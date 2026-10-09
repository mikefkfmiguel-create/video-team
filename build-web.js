// Gera docs/app.js a partir de shared/app.js (a mesma vista das apps PC/Android).
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/shared/app.js', 'utf8').trim();
fs.writeFileSync(__dirname + '/docs/app.js', '// GERADO por build-web.js a partir de shared/app.js — nao editar aqui\nwindow.VideoTeam = ' + src + ';\n');
console.log('docs/app.js gerado');
// editor «Equipa por sala» (so a web por agora): motor + ecra
for (const f of ['salas-motor.js', 'salas.js']) fs.copyFileSync(__dirname + '/shared/' + f, __dirname + '/docs/' + f);
console.log('docs/salas-motor.js e docs/salas.js copiados');
