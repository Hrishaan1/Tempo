const CACHE = 'tempo-static-v5';
const ASSETS = ['./', './index.html', './styles.css', './extras.css', './wordmark.css', './app.js', './fixes.js', './firebase.js', './notifications.js', './manifest.webmanifest', './favicon.svg', './apple-touch-icon.png'];

self.addEventListener('install', (e) => e.waitUntil(
  caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
));
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim())
    .then(() => rearmFromCache())
));
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const fresh = await fetch(e.request);
      if (fresh && fresh.ok) cache.put(e.request, fresh.clone()).catch(() => {});
      return fresh;
    } catch (err) {
      const cached = await cache.match(e.request);
      if (cached) return cached;
      return e.request.mode === 'navigate' ? cache.match('./index.html') : Response.error();
    }
  })());
});

/* ---- scheduled offline reminders (Notification Triggers API) ---- */

const triggerCache = 'tempo-trigger-cache';

function supportsTriggers() {
  return typeof self.TimestampTrigger !== 'undefined' && 'showTrigger' in Notification.prototype;
}

self.addEventListener('message', (e) => {
  if (!e.data || e.data.type !== 'TEMPO_TRIGGERS') return;
  e.waitUntil(handleTriggerMessage(e.data));
});

async function handleTriggerMessage(data) {
  try {
    const cache = await caches.open(triggerCache);
    await cache.put('data', new Response(JSON.stringify({ enabled: !!data.enabled, triggers: data.triggers || [] })));
    await armTriggers();
  } catch (err) { console.warn('Tempo: trigger message failed', err); }
}

async function rearmFromCache() {
  try {
    const c = await caches.open(triggerCache);
    const r = await c.match('data');
    if (!r) return;
    const data = await r.json();
    if (!Array.isArray(data.triggers)) return;
    await armTriggers();
  } catch (err) {}
}

async function armTriggers() {
  if (!supportsTriggers()) return;
  try {
    const cache = await caches.open(triggerCache);
    const r = await cache.match('data');
    const stored = r ? await r.json() : null;
    const list = (stored && stored.enabled && Array.isArray(stored.triggers)) ? stored.triggers : [];

    const pending = await self.registration.getNotifications({ includeTriggered: false });
    const ours = pending.filter((n) => n.tag && n.tag.indexOf('tempo-') === 0);
    await Promise.all(ours.map((n) => n.close()));

    const now = Date.now();
    for (const t of list) {
      if (!isFinite(t.time) || t.time <= now) continue;
      await self.registration.showNotification(t.title || 'Tempo', {
        body: t.body || '',
        icon: t.icon || './favicon.svg',
        badge: t.icon || './favicon.svg',
        tag: t.tag || '',
        data: { url: t.url || './', id: t.id || '' },
        showTrigger: new TimestampTrigger(t.time)
      });
    }
  } catch (err) { console.warn('Tempo: armed triggers failed', err); }
}

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(
    clients.matchAll({ type: 'window' }).then((wins) => {
      if (wins[0]) { wins[0].focus(); return; }
      return clients.openWindow(url);
    })
  );
});