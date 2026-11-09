/* Daily exercise reminder for one patient. The server sends an empty push at the hour they
   chose; we show the reminder and open their coach page (link saved by coach.js). */
function idb(op, key, val) {
  return new Promise((res, rej) => {
    const open = indexedDB.open('rehabion-coach', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('kv');
    open.onerror = () => rej(open.error);
    open.onsuccess = () => {
      const st = open.result.transaction('kv', op === 'get' ? 'readonly' : 'readwrite').objectStore('kv');
      const r = op === 'get' ? st.get(key) : st.put(val, key);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    };
  });
}
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('push', e => e.waitUntil((async () => {
  const name = await idb('get', 'name').catch(() => '');
  await self.registration.showNotification(`${name ? name + ', ' : ''}time for your exercises 💪`, {
    body: 'Danisa is ready to do today’s session with you. / آج کی ورزش کا وقت ہو گیا ہے',
    tag: 'rehabion-coach', renotify: true, icon: '../icon-192.png', badge: '../icon-192.png', vibrate: [200, 100, 200]
  });
})()));
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const link = (await idb('get', 'link').catch(() => '')) || './';
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) if (w.url.includes('/coach/') && 'focus' in w) return w.focus();
    return self.clients.openWindow(link);
  })());
});
