# Desenho — Equipa por sala e função (Video Team)

Estado: **só desenho, nada implementado nem publicado** · 09/10/2026
Âmbito: distribuir a equipa por sala/função em cada evento, substituindo a folha do Google como fonte.

> Aviso: `docs\` é a pasta que o GitHub Pages publica. Este ficheiro não tem segredos, mas **não o incluas num commit/push** sem quereres que fique público (ou muda-o para outra pasta, ex. `notas\`).

---

## Estado da implementação (09/10/2026, branch `feature/equipa-por-sala`, **nada publicado**)

Feito e testado localmente (dados falsos, sem tocar no 7Eventos nem no Cloudflare): passos 1 a 10 — Worker, motor, editor (Distribuir/Configurar/Avisos), importar a folha com correspondência de nomes, exportar CSV, imprimir/PDF (ficheiro temporário `dl:`), link de consulta com «Sou eu» e carregamento no exe/apk.
Por fazer: **construir e experimentar o exe e o apk em aparelho real** (o pedido da chave do dono) e **publicar** (Worker → web → exe/apk). Importar a folha a sério (rede) só se confirma depois do deploy do Worker.
Testes: `node tests/motor.test.js`, `node tests/worker-salas.test.mjs`; ver o editor: `node tests/dev-server.mjs` e abrir `http://localhost:5599` (chave do dono: `dono`, só neste servidor de teste).

---

## 0. Fluxo pretendido (confirmado pelo Mike a 09/10/2026)

1. **Abrir o evento** → a app preenche **só os dias do evento e as pessoas** (vêm da escala oficial: quem trabalha em cada dia). **Sala e função ficam vazias** («Sem destino» para todos).
2. **O Mike atribui** sala e função a cada pessoa (tocar, selecionar vários, copiar dia anterior, preencher todos os dias).
3. **Só depois** liga «Publicar no link»: o link «Escala do Evento» passa a mostrar sala e função, **apenas para consulta** dos técnicos (não editam nada, nem veem avisos, configuração ou nomes da folha).

Consequências no desenho: o estado inicial de um evento novo é «`aloc` vazio»; o botão «Preencher todos os dias» refere-se a repetir a atribuição já feita pelo Mike, não a inventar destinos; a importação da folha passa a ser **opcional** (ponto de partida, não obrigatória); `link.publicado` arranca sempre em `false`.

---

## 1. Como o Video Team funciona hoje (o que importa para isto)

| Tema | Como é |
|---|---|
| **Código** | `shared/app.js` (~710 linhas, ES5, UI em strings/`document.write`) é a única fonte. `build-web.js` copia-o para `docs/app.js` (web); `desktop/` copia-o por `npm run sync` (Electron, portable `VideoTeam.exe`); `android/` usa `../../shared` como *assets* (WebView, `VideoTeam.apk`). |
| **Exe e apk não falam com o Worker** | Correm *dentro* da página do 7Eventos (mesma origem), injetam o `app.js` e leem o 7Eventos diretamente (`cfg.api` vazio). Só a **web** usa o Worker (`cfg.api`, `cfg.pin`, `cfg.role`). |
| **Técnicos e eventos** | O Worker (`worker/src/index.js`) faz login no 7Eventos, lê `VistaSemanal` (janela de ~1 mês), `parse.js` devolve `people[{id,name,grupo,foto,cells{dia:[{kind,code,event,client,hor,prop}]}}]`. Um **evento** identifica-se por `sig = kind:code:event` (`os:<OS>:<nome>`), igual no browser e no Worker. |
| **Link «Escala do Evento»** | Botão «Partilhar» (só `role` ≠ equipa, só web) → `POST /api/admin/share` grava `req:<token>` no KV `{role:'project', project:<sig>, anchor, 30 dias}`. `?p=<token>` abre a vista de projeto: `GET /api/projeto` → `projectView()` varre janelas de 25 dias a partir do `anchor` e devolve `{event, code, hor, prop, days, crew[{id,name,foto,grupo,days}]}`. **Não tem identidade por pessoa**: quem tem o link vê o mesmo. |
| **Onde o Worker guarda dados** | **Um só KV**, binding `FOTOS` (mal nomeado, tem tudo): `escala:<dd-mm-aaaa>` (cópia, TTL 2 dias), `req:<token>` (pedidos/links), `byemail:`, `t:<idFoto>`. Sem D1, sem Durable Objects. |
| **Login / PIN** | Não há contas. O «PIN» é um token enviado em `X-PIN` (ou `?k=`). `roleOf()`: `VT_PIN_ADMIN` = **owner** (o Mike, nunca expira); senão `req:<token>` aprovado → `video`/`admin`/`fulladmin`/`project`. Hierarquia `RANK`. Na web, o PIN fica em `localStorage['vt.pin']`. Escritas só passam em `/api/admin/*` (o resto é GET); CORS só permite `GET, POST, OPTIONS`. |
| **Publicar** | **Worker**: `cd worker; npx wrangler deploy`. **Web**: `node build-web.js` → commit de `docs/` → push (GitHub Pages `mikefkfmiguel-create.github.io/video-team`); subir `CACHE` em `docs/sw.js` (hoje `videoteam-v18`). **Exe**: `cd desktop; npm run dist` → `dist\VideoTeam.exe` (copiar para a raiz). **Apk**: `android\gradlew assembleRelease` (assinado com chave *debug*; `versionCode` está a 1 → subir para atualizar). Distribuição fora do repo (Things On) é decisão do Mike. |

Consequências para o desenho:
1. O estado novo **tem de viver no Worker** (KV) — é o único sítio partilhado entre PC, telemóvel e web.
2. Exe/apk precisam de uma ligação ao Worker **sem** mudar de onde leem a escala: usar chaves novas (`cfg.salasApi`, `cfg.salasPin`), **não** `cfg.api` (senão passariam a ler tudo pelo Worker).
3. O Worker tem de aceitar a origem `http://7eventos.avk.pt` no CORS (hoje só GitHub Pages e localhost).

---

## 2. A folha atual (lida de `export?format=csv`, sem nomes nem telefones neste documento)

- Colunas: `(vazia/contacto)`, `TECNICO`, `9, 10, … 16` — **só o número do dia**, sem mês nem ano.
- ~125 linhas, uma por técnico. A **1.ª coluna** tem, em poucas linhas, nome + telefone → **nunca é lida**; o Worker corta tudo antes da coluna `TECNICO`.
- A mesma folha mistura **vários eventos** (ex. `ESICM` nos dias 9–12, `CIENCIA` nos 13–16): o nome do evento está em cada célula.
- Células `EVENTO[, SALA…][, FUNÇÃO…]`, separadas por vírgula. Padrões reais:
  `ESICM, AUDI 1` · `CIENCIA, AUDI 1, CAM` · `ESICM, AUD 3, AUD 4` (**duas salas**) · `CIENCIA, AUD 8, SWITCH, AV/VMIX` (**sala + duas funções**) · `CIENCIA, RUNNER` (**só função**) · `CIENCIA, SWITCH, 5 C` · `ESICM, FEIRA` / `PAV 3` / `TERRACE` (locais) · `ESICM` (**sem destino**).
- Nem tudo o que está entre vírgulas é sala ou função com nome fixo (`AUDI 1` vs `AUD 2`, `5 C`, `WO`): a importação classifica por **dicionário**, não por posição.

---

## 3. Modelo de dados

**Onde:** KV `FOTOS`, uma chave por evento: `sala:<sha256(sig) 16 hex>`; sem TTL curto (renova 400 dias a cada gravação). Cada documento tem ~10 KB. Um só escritor (o Mike) → KV chega; `rev` evita que dois aparelhos se atropelem. *(D1 só compensa se um dia houver vários editores ou histórico.)* Segurança extra: ao gravar, guarda-se a versão anterior em `salabak:<id>` (TTL 30 dias).

```jsonc
{
  "v": 1, "rev": 7, "atualizadoEm": 1760000000000,
  "sig": "os:12345:Ciência Viva", "code": "12345", "evento": "Ciência Viva", "ancora": "13-10-2026",
  "dias": ["2026-10-13","2026-10-14","2026-10-15","2026-10-16","2026-10-17"],
  "grupos": ["Técnicos de Vídeo"],                       // quem aparece no editor (da escala oficial)
  "salas": [ { "id":"s1","nome":"Auditório 1","curto":"AUDI 1","alias":["AUD 1","AUDITORIO 1"],"regras":"herdar" },
             { "id":"s9","nome":"Feira","curto":"FEIRA","alias":[],"regras":"off" } ],      // regras: herdar | off
  "funcoes": [ { "id":"f1","nome":"MIX","curto":"MIX","conta":"mix","alias":["VMIX","AV/VMIX","SWITCH","CONTROL"] },
               { "id":"f2","nome":"Câmara","curto":"CAM","conta":"cam","alias":["5 C"] },
               { "id":"f3","nome":"Runner","curto":"RUNNER","conta":null,"alias":[] } ],
  "regras": { "semDestino":"aviso","duasSalas":"aviso","foraEscala":"aviso","salaSemMix":"aviso","salaSemCam":"aviso" }, // aviso | off
  "aloc": { "<idTecnico>": { "2026-10-13": [ { "sala":"s1", "f":["f2"] } ] } },  // lista: permite 2 salas (e avisa); sala pode ser null (só função)
  "nomes": { "<idTecnico>": { "folha":"NOME COMO NA FOLHA" } },                  // tabela de correspondência (só texto, sem telefone)
  "ignorar": ["duasSalas:<idTecnico>:2026-10-13"],                              // avisos que o Mike marcou como «ok»
  "link": { "publicado": false, "mostra": "equipa" }                             // equipa | (fase 2) so-eu
}
```

- Os **técnicos não são guardados**: só o `id` do 7Eventos (`p.id`). Nome, grupo e dias vêm sempre da escala oficial (`projectView`), por isso nunca se escrevem nomes à mão e uma mudança no 7Eventos aparece como aviso («fora da escala» / «sem destino»).
- **Não há campos de telefone** em lado nenhum; `empresa`/`stats` do `parse.js` também não são devolvidos pelos endpoints novos.
- `salas`/`funcoes` com `curto`+`alias` servem a importação e a exportação (ex. a folha usa `AUDI 1` e `AUD 2` para a mesma coisa).

### API nova do Worker (todas as de escrita exigem `role === 'owner'`; em `/api/admin/` por causa da regra «só POST aí»)

| Pedido | Faz |
|---|---|
| `GET /api/admin/sala?key=<sig>&d=<dd-mm-aaaa>` | devolve `{doc\|null, crew[{id,name,grupo,days}], at}`; `crew` vem de `projectView` (cache KV 10 min, botão «atualizar») |
| `POST /api/admin/sala/guardar {key, doc, rev}` | valida (esquema, ids existentes, tamanho) e grava; `409` com o doc atual se `rev` não bater |
| `POST /api/admin/sala/folha {gid?}` | o Worker vai buscar o CSV **fixo** da folha (lista de permitidos: só `docs.google.com/spreadsheets/d/<id>/export`), **corta a coluna dos contactos** e devolve só `TECNICO` + dias |
| `POST /api/admin/sala/ficheiro {nome, tipo, conteudo}` → `{url}` | guarda CSV/HTML (≤100 KB) em `dl:<token>` 10 min; `GET /dl/<token>` serve-o. Evita o PIN em URLs e funciona no apk (onde não há *download* de blobs nem `window.print`) |
| `GET /api/projeto` (já existe) | passa a incluir `salas` **só** se `doc.link.publicado`: salas, funções e `aloc` dos técnicos do `crew` (sem `nomes.folha`, sem `ignorar`) |

Só o **owner** (`VT_PIN_ADMIN`) edita; admin/full admin (aprovados por email) ficam de fora. Falha de PIN já tem atraso de 800 ms.

---

## 4. O que muda em cada parte

| Parte | Mudança |
|---|---|
| `worker/src/index.js` (+ `salas.js`) | endpoints acima; validação; CORS com `http://7eventos.avk.pt`; `projectView` junta `salas`. Cron e `getEscala` não mudam. |
| `shared/salas.js` (novo) | **motor puro** (sem DOM, testável com `node`): `atribuir`, `moverVarios`, `copiarDiaAnterior`, `preencherTodosOsDias`, `validar()` (avisos), `parseCelula`, `casarNomes`, `paraCsv`, `paraHtmlImpressao`. Mais a UI do editor. Ficheiro separado porque o `app.js` já é grande. |
| `shared/app.js` | botão «Equipa por sala» no painel do evento (ao lado de «Partilhar», só owner); vista de projeto mostra sala/função + «Sou eu». Lê `cfg.salasApi`/`cfg.salasPin`. |
| Web `docs/` | `index.html` carrega `salas.js`; `build-web.js` copia-o; `sw.js` inclui-o e sobe `CACHE`. A web já tem `role` e `vt.pin`. |
| Exe `desktop/` | `package.json` (`sync`, `files`) e `main.js` carregam/injetam `salas.js` antes de `app.js`; passa `salasApi`. PIN pedido uma vez e guardado no `localStorage` da sessão `persist:7eventos`. |
| Apk `android/` | `MainActivity.kt` injeta `salas.js` (já vai nos *assets* via `../../shared`); passa `salasApi`; subir `versionCode`. |
| Exportar/imprimir | gerado no cliente → `POST …/ficheiro` → abre o URL no browser do sistema (Windows e Android; o Electron já abre links externos no browser). |

---

## 5. Ecrãs (esboço)

**A. Painel do evento** (já existe) → novo botão `[ Equipa por sala ]` (só owner).

**B. Editor** — ecrã inteiro, 4 separadores: `Distribuir · Configurar · Avisos · Exportar`.

```
┌ Ciência Viva · OS 12345            ● guardado 14:02 ┐
│ [13] [14] [15] [16] [17]     ‹ Copiar do dia anterior   Preencher todos os dias │
│ [Selecionar]   Procurar…                                            │
├ SEM DESTINO (3) ──────────────────────────────────────────────────┤
│ ( Ana )  ( Rui )  ( Tiago )          ← tocar numa pessoa abre o seletor│
├ AUDITÓRIO 1 (3) ⚠ sem MIX ────────────────────────────────────────┤
│ Joana — CAM      Pedro — CAM      Luís — Runner                    │
├ AUDITÓRIO 2 (2) ✓ ────────────────────────────────────────────────┤
│ Marta — MIX      Hugo — CAM                                        │
└ Fora da escala oficial neste dia (1) ⚠  [Rita – AUDI 2, CAM] ───────┘

Seletor (folha de baixo ao tocar numa pessoa):
  Sala:   ( Aud 1 ) ( Aud 2 ) ( Aud 8 ) ( Ciência ) ( — sem sala — )
  Função: ( MIX ) ( CAM ) ( Runner ) ( AV/VMIX )        [ Aplicar ]  [ Só este dia | Todos os dias ]
Modo «Selecionar»: caixas nas pessoas → barra «3 selecionados → Sala/Função…».
```

- **Configurar**: dias do evento (por defeito os dias com equipa na escala; editáveis), salas e funções (nome, abreviatura para a folha, apelidos, etiqueta `conta como MIX/CAM`), grupos visíveis, regras de avisos (ligar/desligar; por sala «não exigir MIX/CAM»), `Publicar no link` (sim/não).
- **Avisos**: lista clicável («Joana — 14: Aud 1 e Aud 2» → salta para o dia); `ignorar`.
- **Exportar**: `Descarregar CSV` (formato da folha), `Imprimir / PDF` (mapa por dia: sala → pessoas/função), `Importar da folha atual`.
- **Importar**: passo 1 escolher a coluna→data (a folha só tem «13», perguntar mês/ano, sugerir o do evento) e que «evento da folha» corresponde a este (`CIENCIA` ↔ «Ciência Viva…»); passo 2 **tabela de correspondência de nomes** (os não casados com lista de sugestões; guarda-se em `nomes`); passo 3 pré-visualização com contagens (X células, Y por resolver) antes de gravar.

**C. Link «Escala do Evento»** (só se publicado): a vista Dia ganha, por sala, a lista «Pessoa — Função»; no topo `Sou: [escolher nome ▾]` (guardado no aparelho) mostra «O meu dia: Aud 1 · CAM» em destaque. Sem horas extra, sem contactos.

---

## 6. Regras de conflito/avisos (todas calculadas no cliente por `validar(doc, crew)`)

| Regra | Condição | Por defeito |
|---|---|---|
| Sem destino | pessoa na escala oficial nesse dia sem `aloc` | aviso |
| Duas salas | ≥2 entradas com `sala` diferente no mesmo dia | aviso, **ignorável** (a folha tem casos reais, ex. `AUD 3, AUD 4`) |
| Sala sem MIX / sem câmara | sala com pessoas e nenhuma entrada com função `conta:'mix'` / `'cam'`; salas com `regras:"off"` (Feira, Runner…) isentas | aviso, configurável por evento e por sala |
| Fora da escala | alocação para quem já não está na escala oficial nesse dia (mudou no 7Eventos) | aviso |
| Referência partida | sala/função apagada, dia fora de `dias` | aviso (na gravação o Worker rejeita ids inexistentes) |
| Edição simultânea | `rev` diferente na gravação | recarrega o doc, mostra «alterado noutro aparelho», não perde o que escreveste (junta por pessoa/dia) |

Avisos **nunca bloqueiam** a gravação nem a exportação.

---

## 7. Decisão pendente: o técnico vê só o dele ou a equipa toda?

O link é partilhado e **não identifica quem abre**. Por isso:
- **Proposta (mais simples, fase 1)**: o link mostra a equipa toda por sala/função, com «Sou eu» a destacar o dia da pessoa. Configurável por evento: *publicado sim/não*. Zero identidade, zero risco novo.
- **«Só o meu dia» a sério** exige **um link por técnico** (token por pessoa) — fase 2. O campo `link.mostra` já fica previsto no modelo.

---

## 8. Riscos

1. **Chave do evento = `sig` (inclui o nome)**. Se o 7Eventos corrigir o nome, a ligação perde-se (o mesmo risco já existe no link de projeto). Mitigação: aviso «evento sem equipa» + (fase 2) «associar a outro evento»; guardar `code` para sugerir.
2. **Casar nomes** da folha com os oficiais (acentos, maiúsculas, abreviaturas, homónimos): só casar automático se houver **um único** candidato; o resto vai para a tabela de correspondência; nunca atribuir em silêncio.
3. **KV é eventualmente consistente** (leituras noutro ponto de presença podem demorar até ~1 min); com um só editor + `rev` é aceitável. Gravar com atraso de 1 s (limite de 1 escrita/s por chave).
4. **PIN do owner nos aparelhos**: no exe/apk fica no `localStorage` da origem do 7Eventos (legível pelas páginas do 7Eventos). Risco baixo; alternativa na fase 2: Electron `safeStorage` / Android Keystore. O PIN **não vai em URLs** (daí o mecanismo `dl:`).
5. **Varrimento de janelas** (`projectView` pode chamar o 7Eventos até ~9 vezes se a cópia expirou): cache de 10 min e carregar o `crew` só ao abrir o editor.
6. **Telefones**: cortados no Worker antes de chegarem à app; nenhum campo de contacto no modelo; testes automáticos com uma folha de exemplo com «telefones» falsos garantem que não aparecem em nenhuma saída.
7. **Tamanho do `app.js`**: por isso o motor/UI vão para `salas.js` (os carregadores do exe/apk/web precisam de uma linha cada).
8. **Perda de dados** (apagar um evento por engano): backup `salabak:` 30 dias + exportação CSV a qualquer momento.
9. **Android/WebView**: sem `window.print` nem *download* de blobs → exportar/imprimir só via URL `dl:` aberto no browser.
10. **Dois exe/apk antigos** em uso: continuam a funcionar (só não têm o botão novo); o Worker é retrocompatível.

---

## 9. O que NÃO fazer na fase 1

- Edição por mais ninguém além do owner; contas, perfis ou links por técnico (**«só o meu dia» a sério**).
- Arrastar e largar (só tocar/escolher e seleção múltipla), horários/turnos por sala (manhã/tarde), vários eventos no mesmo mapa/exportação.
- Escrever de volta no Google Sheets, sincronização contínua com a folha (a importação é **uma vez**).
- Avisos entre eventos diferentes (o 7Eventos já manda nisso), sugestões automáticas de equipa, notificações push.
- Histórico/versões navegáveis, D1, Durable Objects, edição offline.
- Mexer na leitura da escala oficial, no cron, nos níveis de acesso existentes ou no `cfg.api` do exe/apk.
- Telefones, emails ou qualquer contacto.

---

## 10. Estimativa em passos pequenos

Cada passo é um commit testável; **S** ≈ meia hora a 1 h, **M** ≈ 1–3 h.

| # | Passo | Tam. |
|---|---|---|
| 1 | Worker: modelo + validação + `GET/guardar` (KV, `rev`, backup, só owner); testar com `wrangler dev` local | M |
| 2 | Worker: `crew` do evento (reusar `projectView`, cache 10 min) | S |
| 3 | `shared/salas.js` motor puro + testes `node` (atribuir, mover vários, copiar dia, preencher todos, `validar`) | M |
| 4 | Editor web: botão no painel, separador **Configurar** (dias, salas, funções, regras) | M |
| 5 | Editor: **Distribuir** (seletor, seleção múltipla, copiar dia, preencher todos os dias, anular) com gravação automática | M |
| 6 | Editor: **Avisos** (lista, ignorar, marcas nas salas) | S |
| 7 | Importar: `…/folha` no Worker + `parseCelula` + correspondência de nomes + ecrã de resolução + pré-visualização | M |
| 8 | Exportar CSV (formato da folha) + imprimir/PDF via `dl:` | M |
| 9 | Link do evento: `/api/projeto` com `salas` + «Sou eu» + interruptor «Publicar» | S |
| 10 | Exe e apk: carregar `salas.js`, `salasApi` + pedido de PIN, CORS `http://7eventos.avk.pt`, testar nos dois | M |
| 11 | Publicar por esta ordem: Worker → web (`build-web`, `sw.js`) → exe/apk **só quando o Mike mandar** | S |

Total grosso: **~8–11 passos, 1–2 dias de trabalho**, com o passo 7 (importação e nomes) como o mais incerto. Ordem sugerida para o Mike ver valor cedo: 1→3→4→5→6 (já substitui a folha), depois 7→8→9→10.

---

## 11. Perguntas para o Mike (com a proposta por defeito)

1. **Quem aparece no editor**: só o grupo vídeo, ou todos os que estão no evento? *(por defeito: só vídeo, com «mostrar todos»)*
2. **No link, o técnico vê só o dele ou a equipa toda?** *(equipa toda + «Sou eu»; «só o meu» = 1 link por técnico, fase 2)*
3. **Pessoa em duas salas no mesmo dia**: só avisar? *(sim, com «ok, é assim»)*
4. **«Preencher todos os dias»** (repetir a atribuição já feita para os outros dias): só onde ainda não há destino e só nos dias em que a pessoa está na escala? *(sim; com opção «substituir»)*
5. **Que funções contam como MIX e como câmara** (`AV/VMIX`, `SWITCH`, `CONTROL`, `CAM`, `5 C`…) e **que salas estão isentas** (Runner, Feira, Terrace, Pavilhões)?
6. O que significam `WO` e `5 C` na folha? E existem outras abreviaturas?
7. **Importar**: a folha tem ESICM (9–12) e Ciência (13–16). Importo só o evento que estiver aberto? *(sim)* Em que **mês/ano** estão estes dias?
8. **Exportar**: um ficheiro por evento, ou juntar todos os eventos da semana como hoje?
9. **Telemóvel**: precisa de editar desde o início, ou basta editar no PC/web e ver no telemóvel? *(o código é o mesmo; só afeta testes e o pedido de PIN)*
10. ~~Publicar no link manual por evento~~ → **confirmado**: só se partilha depois de atribuído, e apenas para consulta (secção 0).
11. Confirmas que **só o PIN do dono** edita (admins aprovados por email não)?
