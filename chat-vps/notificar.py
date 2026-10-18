# -*- coding: utf-8 -*-
"""Relatorio por email de cada sala do chat criada e apagada (fechada pelo dono ou expirada no fim do evento).

Corre no VPS (como root, de minuto a minuto, por um temporizador do systemd — ver deploy/vt-chat-relatorios.*): pergunta ao chat, em local, os eventos
novos (GET /chat/api/admin/eventos) e envia um email por cada um para VTCHAT_RELATORIO_PARA, com o peso da sala e do servidor nesse momento.
O email sai pela conta de envio que a Things On ja tem (as ENVIO_* / SMTP_* de /etc/things-on-admin.mail.env): este script so as le para enviar,
nunca as escreve nem as mostra. O estado (ultimo evento avisado) fica em /var/lib/vt-chat-relatorios/ultimo; so se avisa depois de enviado com sucesso.
Uso: python notificar.py            (um ciclo: avisa o que e novo)
     python notificar.py --teste    (envia um email de teste a dizer que a vigia esta viva)
"""
import json
import os
import re
import smtplib
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid

ESTADO = os.environ.get('VTCHAT_RELATORIO_ESTADO', '/var/lib/vt-chat-relatorios/ultimo')
URL = os.environ.get('VTCHAT_URL', 'http://127.0.0.1:8782')
RE_FROM = re.compile(r'[A-Za-z0-9._%+\-]{1,64}@[A-Za-z0-9.\-]{1,190}\.[A-Za-z]{2,24}')
TIPOS = {
    'criada': ('Sala criada', 'Chat · sala criada: %s'),
    'fechada': ('Sala fechada pelo dono', 'Chat · sala fechada: %s'),
    'expirada': ('Sala apagada no fim do evento', 'Chat · sala apagada (fim do evento): %s'),
}


def mb(b):
    b = int(b or 0)
    for u, f in (('GB', 1 << 30), ('MB', 1 << 20), ('KB', 1 << 10)):
        if b >= f:
            return '%.1f %s' % (b / f, u)
    return '%d B' % b


def quando(ms):
    try:
        from zoneinfo import ZoneInfo
        return datetime.fromtimestamp(ms / 1000, ZoneInfo('Europe/Lisbon')).strftime('%d/%m/%Y %H:%M')
    except Exception:
        return datetime.fromtimestamp(ms / 1000, timezone(timedelta(hours=1))).strftime('%d/%m/%Y %H:%M')


def duracao(a, b):
    s = max(0, int((b - a) / 1000))
    d, h = s // 86400, (s % 86400) // 3600
    return ('%d dia%s e %d h' % (d, '' if d == 1 else 's', h)) if d else ('%d h %d min' % (h, (s % 3600) // 60))


def compor(e):
    """(assunto, texto) do email de um evento."""
    d = e.get('dados') or {}
    titulo, modelo = TIPOS.get(e['tipo'], ('Evento do chat', 'Chat · %s'))
    L = ['%s · %s' % (titulo, e['evento']), 'Quando: %s (hora de Lisboa)' % quando(e['ts']), '']
    if e['tipo'] == 'criada':
        L += ['Pessoas na sala: %s (de fora: %s · gestores: %s)' % (d.get('membros', '?'), d.get('externos', 0), d.get('gestores', 0)),
              'Dura até: %s — depois apaga-se tudo sozinho.' % (quando(d['expira']) if d.get('expira') else '?')]
    else:
        L += ['Durou: %s (de %s a %s)' % (duracao(d.get('criada', e['ts']), e['ts']), quando(d['criada']) if d.get('criada') else '?', quando(e['ts'])),
              '',
              'O que a sala teve',
              '- Pessoas: %s (entraram %s · de fora %s · gestores %s)' % (d.get('membros', '?'), d.get('entraram', '?'), d.get('externos', 0), d.get('gestores', 0)),
              '- Mensagens: %s (%s de texto)' % (d.get('mensagens', '?'), mb(d.get('texto_bytes'))),
              '- Fotos: %s (%s)' % (d.get('fotos', 0), mb(d.get('fotos_bytes'))),
              '- Pico de pessoas ligadas ao mesmo tempo: %s' % d.get('pico_ws', '?'),
              '- Notificações enviadas: %s (aparelhos com notificações: %s)' % (d.get('pushes', '?'), d.get('push_subscricoes', '?')),
              '- Espaço libertado (estimado): %s' % mb(d.get('espaco_estimado_bytes'))]
    L += ['',
          'O servidor do chat nesse momento',
          '- Memória do chat: %s' % mb(d.get('rss_bytes')),
          '- Base de dados: %s' % mb(d.get('db_bytes')),
          '- Disco livre do VPS: %s' % mb(d.get('disco_livre')),
          '- Salas ativas%s: %s · ligações ao vivo: %s' % (' (contando esta)' if e['tipo'] == 'criada' else ' (antes de apagar)', d.get('salas_ativas', '?'), d.get('ws_ativos', '?')),
          '',
          'Relatório completo (VPS, GitHub e Cloudflare): abre «Vigia Video Team» no teu PC.',
          '— Vigia do Video Team']
    return modelo % e['evento'], '\n'.join(L) + '\n'


def conta_smtp(env=os.environ):
    """(host, porta, user, senha, de, nome): a conta ENVIO_* da Things On ou, em falta, SMTP_*."""
    host, user, senha = (env.get('ENVIO_SMTP_' + k, '').strip() for k in ('HOST', 'USER', 'PASSWORD'))
    de = env.get('ENVIO_FROM', '').strip()
    if host and user and senha and RE_FROM.fullmatch(de) and '..' not in de:
        try:
            porta = int((env.get('ENVIO_SMTP_PORT', '587') or '587').strip())
        except ValueError:
            porta = 587
        return host, porta, user, senha, de, (env.get('ENVIO_FROM_NOME', '') or 'Mike Apps').strip()[:60]
    host, user, senha = env.get('SMTP_HOST', '').strip(), env.get('SMTP_USER', '').strip(), env.get('SMTP_PASSWORD', '').strip()
    if not (host and user and senha):
        raise RuntimeError('sem conta de email configurada')
    try:
        porta = int(env.get('SMTP_PORT', '587') or 587)
    except ValueError:
        porta = 587
    return host, porta, user, senha, user, (env.get('ADMIN_EMAIL_NOME', '') or 'Mike Apps')


def enviar_email(para, assunto, texto):
    host, porta, user, senha, de, nome = conta_smtp()
    m = EmailMessage()
    m['From'] = formataddr((nome + ' · Vigia', de))
    m['To'] = para
    m['Subject'] = assunto
    m['Date'] = formatdate(localtime=True)
    m['Message-ID'] = make_msgid(domain=de.split('@', 1)[1] if '@' in de else None)
    m.set_content(texto)
    try:
        if porta == 465:
            with smtplib.SMTP_SSL(host, porta, timeout=25) as s:
                s.login(user, senha)
                s.send_message(m)
        else:
            with smtplib.SMTP(host, porta, timeout=25) as s:
                s.starttls()
                s.login(user, senha)
                s.send_message(m)
    except Exception as ex:                       # nunca deixar a palavra-passe sair num erro
        raise RuntimeError(('%s: %s' % (type(ex).__name__, ex)).replace(senha, '***')[:300])


def ler_json(url, segredo):
    rq = urllib.request.Request(url, headers={'X-Chat-Admin': segredo})
    return json.loads(urllib.request.urlopen(rq, timeout=15).read())


def ler_estado(caminho=None):
    try:
        return int(open(caminho or ESTADO).read().strip() or 0)
    except (OSError, ValueError):
        return None


def gravar_estado(n, caminho=None):
    c = caminho or ESTADO
    os.makedirs(os.path.dirname(c), exist_ok=True)
    tmp = c + '.tmp'
    open(tmp, 'w').write(str(int(n)))
    os.replace(tmp, c)


def ciclo(para, segredo, enviar=enviar_email, buscar=ler_json, estado=None, max_por_ciclo=10):
    """Avisa os eventos novos. Devolve (enviados, erro). A 1.a vez so marca o ponto de partida (nao reenvia o passado)."""
    ultimo = ler_estado(estado)
    if ultimo is None:
        atual = buscar(URL + '/chat/api/admin/eventos?depois=0', segredo)
        gravar_estado(atual['ultimo'], estado)
        return 0, None
    r = buscar(URL + '/chat/api/admin/eventos?depois=%d' % ultimo, segredo)
    enviados = 0
    for e in r['eventos'][:max_por_ciclo]:
        assunto, texto = compor(e)
        try:
            enviar(para, assunto, texto)
        except Exception as ex:
            return enviados, str(ex)             # tenta outra vez no proximo ciclo; nada se perde nem se repete
        gravar_estado(e['id'], estado)
        enviados += 1
    return enviados, None


def main():
    para = os.environ.get('VTCHAT_RELATORIO_PARA', '').strip()
    segredo = os.environ.get('VTCHAT_SECRET', '').strip()
    if not (RE_FROM.fullmatch(para) and segredo):
        print('falta VTCHAT_RELATORIO_PARA (um email) ou VTCHAT_SECRET', file=sys.stderr)
        return 2
    if '--teste' in sys.argv:
        enviar_email(para, 'Chat · a vigia está viva', 'Este é um email de teste da vigia do chat do Video Team.\nDe agora em diante recebes um relatório por cada sala criada e por cada sala apagada.\n\nEnviado em %s.\n' % time.strftime('%d/%m/%Y %H:%M:%S'))
        print('email de teste enviado')
        return 0
    n, erro = ciclo(para, segredo)
    if n:
        print('relatorios enviados: %d' % n)
    if erro:
        print('falhou o envio (tenta de novo no proximo ciclo): %s' % erro, file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
