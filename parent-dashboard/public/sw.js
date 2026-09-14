/* Access Control — parent dashboard service worker.
 * Receives Web Push messages (RFC 8291) encrypted by the Worker and shows
 * them as OS notifications on the parent's phone/desktop — even when the
 * dashboard tab is closed. Clicking focuses/opens the dashboard. */

const APP_URL = '/dashboard';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Access Control', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Access Control';
  const critical = data.data && data.data.severity === 'critical';
  const options = {
    body: data.body || '',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    tag: data.tag || 'access-control',
    renotify: Boolean(data.tag && data.tag !== 'access-control'),
    requireInteraction: Boolean(critical), // SOS / zone exits stay on screen
    vibrate: critical ? [200, 100, 200, 100, 200] : [80],
    data: { url: APP_URL },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || APP_URL;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
