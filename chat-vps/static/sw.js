// Video Team · Chat — service worker (PWA): abre mesmo sem rede (a casca da pagina) e mostra as notificacoes push.
// Rede primeiro, cache so quando nao ha rede, para uma correcao aparecer logo. As chamadas a /chat/api/ nunca passam pela cache.
const CACHE = 'vtchat-v4';
const CASCA = ['/chat/', '/chat/icons/chat-192.png', '/chat/icons/chat-512.png', '/chat/icons/chat-favicon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(CASCA.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => {})))));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith('/chat/')) return;
  if (url.pathname.startsWith('/chat/api/') || url.pathname.endsWith('manifest.webmanifest') || url.pathname.endsWith('/sw')) return;
  e.respondWith(
    fetch(new Request(e.request, { cache: 'no-store' })).then((r) => {
      if (r && r.ok) { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); }
      return r;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('/chat/')))
  );
});

// o servidor so envia push a quem nao tem o chat aberto
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { t: 'Chat', b: e.data ? e.data.text() : '' }; }
  const vib = Array.isArray(d.v) ? d.v : [300, 150, 300, 150, 500];
  e.waitUntil(self.registration.showNotification(d.t || 'Chat do evento', {
    body: d.b || 'Mensagem nova',
    // as mensagens da mesma sala substituem-se umas as outras; um AVISO fixo tem a sua propria notificacao, que nao se perde debaixo das outras
    tag: d.a ? 'aviso-' + (d.g || '') + '-' + (d.n || '') : (d.g || 'vt-chat'),
    renotify: true,
    silent: false,
    vibrate: vib,
    requireInteraction: !!d.r,                // avisos ficam no ecra ate serem fechados (onde o sistema o permite)
    timestamp: Date.now(),
    actions: [{ action: 'abrir', title: 'Abrir' }],
    icon: '/chat/icons/chat-192.png',
    badge: '/chat/icons/badge-96.png',      // icone pequeno da barra de estado: so branco sobre transparente (o Android pinta-o); com o icone a cores aparecia um quadrado cinzento
    data: { u: d.u || '/chat/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const alvo = (e.notification.data && e.notification.data.u) || '/chat/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    for (const c of cs) { if (c.url.includes('/chat/') && 'focus' in c) return c.focus(); }
    return self.clients.openWindow(alvo);
  }));
});
