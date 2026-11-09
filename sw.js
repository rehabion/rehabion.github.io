/* REHABION Founder alerts — wakes the founder's phone when a visitor asks for him.
   Our own server sends an empty push; we ask it who's calling and ring. */
const DEFAULT_API = 'https://rehabion-ai.rehabion.workers.dev';

function idb(op, key, val) {
  return new Promise((res, rej) => {
    const open = indexedDB.open('rehabion-founder', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('kv');
    open.onerror = () => rej(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('kv', op === 'get' ? 'readonly' : 'readwrite');
      const st = tx.objectStore('kv');
      const r = op === 'get' ? st.get(key) : st.put(val, key);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    };
  });
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => e.waitUntil((async () => {
  let req = null;
  try {
    const device = await idb('get', 'device'), api = (await idb('get', 'api')) || DEFAULT_API;
    const d = await (await fetch(`${api}/push/pending?d=${device}`, { cache: 'no-store' })).json();
    req = (d.requests || [])[0] || null;
  } catch (err) {}
  const title = req ? `📞 ${req.name} wants to talk to you` : '📞 Someone wants to talk to you';
  await self.registration.showNotification(title, {
    body: req ? (req.reason || 'Tap to answer') + (req.contact ? `\n${req.contact}` : '') : 'Tap to answer',
    tag: 'rehabion-call', renotify: true, requireInteraction: true,
    vibrate: [500, 250, 500, 250, 500, 250, 900],
    icon: '/icon-192.png', badge: '/icon-192.png',
    data: { link: (req && req.link) || '/founder.html' },
    actions: [{ action: 'answer', title: 'Answer' }]
  });
})()));

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const link = new URL(e.notification.data && e.notification.data.link || '/founder.html', self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) if (w.url.split('#')[0].endsWith('/founder.html') && 'navigate' in w) { await w.focus(); return w.navigate(link); }
    return self.clients.openWindow(link);
  })());
});
