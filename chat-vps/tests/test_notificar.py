# -*- coding: utf-8 -*-
"""Relatorio por email de cada sala criada e apagada (notificar.py): composicao, estado e envio simulado. Sem rede: python tests/test_notificar.py"""
import os
import sys
import tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(AQUI, '..'))
import notificar as N  # noqa: E402

falhas = 0


def ok(c, n):
    global falhas
    print(('OK    ' if c else 'FALHA ') + n, flush=True)
    if not c:
        falhas += 1


T0 = 1792352358145            # 18/10/2026 ~20:00 Lisboa
foto = {'criada': T0, 'expira': T0 + 5 * 86400e3, 'membros': 29, 'externos': 1, 'gestores': 2, 'entraram': 24, 'mensagens': 312, 'texto_bytes': 18400, 'pico_ws': 17, 'pushes': 640,
        'push_subscricoes': 21, 'espaco_estimado_bytes': 18400 + 312 * 160 + 29 * 220, 'db_bytes': 2_500_000, 'rss_bytes': 61_000_000, 'disco_livre': 19_300_000_000, 'salas_ativas': 3, 'ws_ativos': 4}

a, t = N.compor({'id': 1, 'ts': T0, 'tipo': 'criada', 'evento': 'Dig. Summit', 'dados': foto})
ok(a == 'Chat · sala criada: Dig. Summit' and 'Pessoas na sala: 29 (de fora: 1 · gestores: 2)' in t and 'Dura até:' in t and 'Memória do chat: 58.2 MB' in t, 'sala criada: assunto e corpo com pessoas, validade e peso do servidor')
a, t = N.compor({'id': 2, 'ts': T0 + 5 * 86400e3 + 3 * 3600e3, 'tipo': 'expirada', 'evento': 'Dig. Summit', 'dados': foto})
ok(a == 'Chat · sala apagada (fim do evento): Dig. Summit' and 'Durou: 5 dias e 3 h' in t and 'Mensagens: 312 (18.0 KB de texto)' in t and 'Pico de pessoas ligadas ao mesmo tempo: 17' in t and 'Espaço libertado (estimado):' in t and 'entraram 24' in t, 'sala apagada no fim do evento: duracao, mensagens, pico, notificacoes e espaco libertado')
a, t = N.compor({'id': 3, 'ts': T0 + 3600e3, 'tipo': 'fechada', 'evento': 'FPF', 'dados': dict(foto, criada=T0)})
ok(a == 'Chat · sala fechada: FPF' and 'Durou: 1 h 0 min' in t and 'antes de apagar' in t, 'sala fechada pelo dono: assunto e duracao')
a, t = N.compor({'id': 4, 'ts': T0, 'tipo': 'criada', 'evento': 'X', 'dados': {}})
ok('?' in t and a.startswith('Chat'), 'um evento sem dados nao rebenta o email')

# ciclo: primeira vez so marca o ponto de partida; depois avisa so o que e novo, e so avanca depois de enviado
estado = os.path.join(tempfile.mkdtemp(prefix='vtrel_'), 'ultimo')
fila = [{'id': 5, 'ts': T0, 'tipo': 'criada', 'evento': 'A', 'dados': foto}, {'id': 6, 'ts': T0 + 1000, 'tipo': 'expirada', 'evento': 'B', 'dados': foto}]
enviados = []


def buscar(url, segredo):
    depois = int(url.split('depois=')[1])
    assert segredo == 's'
    return {'eventos': [e for e in fila if e['id'] > depois], 'ultimo': max(e['id'] for e in fila) if fila else 0}


def enviar(para, assunto, texto):
    enviados.append((para, assunto))


n, err = N.ciclo('eu@exemplo.pt', 's', enviar, buscar, estado)
ok(n == 0 and err is None and N.ler_estado(estado) == 6 and enviados == [], 'a primeira vez so marca o ponto de partida: nao reenvia o passado')
fila.append({'id': 7, 'ts': T0 + 2000, 'tipo': 'criada', 'evento': 'C', 'dados': foto})
fila.append({'id': 8, 'ts': T0 + 3000, 'tipo': 'fechada', 'evento': 'D', 'dados': foto})
n, err = N.ciclo('eu@exemplo.pt', 's', enviar, buscar, estado)
ok(n == 2 and err is None and [a for _p, a in enviados] == ['Chat · sala criada: C', 'Chat · sala fechada: D'] and N.ler_estado(estado) == 8 and enviados[0][0] == 'eu@exemplo.pt', 'avisa so os eventos novos, por ordem, para o email certo')
n, err = N.ciclo('eu@exemplo.pt', 's', enviar, buscar, estado)
ok(n == 0 and len(enviados) == 2, 'e nao repete o que ja avisou')

# falha no envio: nao avanca (tenta no ciclo seguinte), sem repetir os que ja foram
fila.append({'id': 9, 'ts': T0 + 4000, 'tipo': 'criada', 'evento': 'E', 'dados': foto})
fila.append({'id': 10, 'ts': T0 + 5000, 'tipo': 'criada', 'evento': 'F', 'dados': foto})
chamadas = {'n': 0}


def enviar_avaria(para, assunto, texto):
    chamadas['n'] += 1
    if chamadas['n'] == 2:
        raise RuntimeError('SMTP em baixo')
    enviados.append((para, assunto))


n, err = N.ciclo('eu@exemplo.pt', 's', enviar_avaria, buscar, estado)
ok(n == 1 and err == 'SMTP em baixo' and N.ler_estado(estado) == 9, 'se o email falhar a meio, guarda o que ja foi e para: o seguinte fica para o proximo ciclo')
n, err = N.ciclo('eu@exemplo.pt', 's', enviar, buscar, estado)
ok(n == 1 and err is None and enviados[-1][1] == 'Chat · sala criada: F' and N.ler_estado(estado) == 10, 'no ciclo seguinte envia o que faltava, sem repetir o anterior')

# contas de envio: a ENVIO_* tem prioridade; senao SMTP_*; sem nenhuma, erro claro sem segredos
c = N.conta_smtp({'ENVIO_SMTP_HOST': 'smtp.x.pt', 'ENVIO_SMTP_USER': 'u', 'ENVIO_SMTP_PASSWORD': 'p', 'ENVIO_FROM': 'avisos@x.pt', 'ENVIO_SMTP_PORT': '465', 'SMTP_HOST': 'outro', 'SMTP_USER': 'o', 'SMTP_PASSWORD': 'q'})
ok(c[0] == 'smtp.x.pt' and c[1] == 465 and c[4] == 'avisos@x.pt', 'usa a conta ENVIO_* quando esta completa')
c = N.conta_smtp({'SMTP_HOST': 'h', 'SMTP_USER': 'u@x.pt', 'SMTP_PASSWORD': 'p'})
ok(c[0] == 'h' and c[1] == 587 and c[4] == 'u@x.pt', 'senao usa SMTP_*')
try:
    N.conta_smtp({})
    erro = ''
except RuntimeError as e:
    erro = str(e)
ok('sem conta' in erro, 'sem conta de email: erro claro')

print('\nfalhas: %d' % falhas)
sys.exit(1 if falhas else 0)
