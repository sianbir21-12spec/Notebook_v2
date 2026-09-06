/**
 * CampusConnect Service Worker
 * Handles background push notifications, service worker lifecycle, and notification click navigation.
 */

const SW_VERSION = 'campusconnect-sw-v1';

// Lifecycle: Install & Activate immediately
self.addEventListener('install', (event) => {
  console.log(`👷 [Service Worker] Installed version ${SW_VERSION}`);
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log(`👷 [Service Worker] Activated version ${SW_VERSION}`);
  event.waitUntil(self.clients.claim());
});

// Handle incoming Web Push notifications from server
self.addEventListener('push', (event) => {
  console.log('📬 [Service Worker] Push event received');

  let payload = {
    title: 'School Friend Group Chat',
    body: 'New message received',
    icon: 'https://ui-avatars.com/api/?name=CC&background=6366f1&color=fff',
    badge: 'https://ui-avatars.com/api/?name=CC&background=6366f1&color=fff',
    roomId: 'general',
    tag: 'campusconnect-chat-notification',
    timestamp: Date.now()
  };

  if (event.data) {
    try {
      payload = Object.assign(payload, event.data.json());
    } catch (e) {
      payload.body = event.data.text();
    }
  }

  const notificationTitle = payload.title || 'CampusConnect Message';
  const notificationOptions = {
    body: payload.body || 'You have received a new message.',
    icon: payload.icon || 'https://ui-avatars.com/api/?name=CC&background=6366f1&color=fff',
    badge: payload.badge || 'https://ui-avatars.com/api/?name=CC&background=6366f1&color=fff',
    tag: payload.tag || `campus-${payload.roomId || 'general'}`,
    renotify: true,
    requireInteraction: false,
    data: {
      url: payload.url || '/',
      roomId: payload.roomId || 'general',
      isDM: Boolean(payload.isDM),
      targetUid: payload.targetUid || null,
      sender: payload.sender || null,
      timestamp: payload.timestamp || Date.now()
    },
    actions: [
      { action: 'open', title: '💬 View Message' },
      { action: 'dismiss', title: 'Dismiss' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(notificationTitle, notificationOptions)
  );
});

// Handle notification click: focus app window and navigate to room
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') {
    return;
  }

  const notificationData = event.notification.data || {};
  const targetRoom = notificationData.roomId || 'general';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If a chat window is already open, focus it and tell it to switch to the room
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus().then((focusedClient) => {
            if (focusedClient) {
              focusedClient.postMessage({
                type: 'NAVIGATE_TO_ROOM',
                roomId: targetRoom,
                isDM: notificationData.isDM,
                targetUid: notificationData.targetUid
              });
            }
            return focusedClient;
          });
        }
      }

      // If no window is open, open a new window pointing to the chat
      if (self.clients.openWindow) {
        const destinationUrl = notificationData.url || `/?room=${encodeURIComponent(targetRoom)}`;
        return self.clients.openWindow(destinationUrl);
      }
    })
  );
});

// Handle direct message from client app to display local service worker notification
self.addEventListener('message', (event) => {
  if (!event.data) return;

  if (event.data.type === 'SHOW_NOTIFICATION') {
    const { title, options } = event.data;
    event.waitUntil(
      self.registration.showNotification(title, options)
    );
  } else if (event.data.type === 'CHECK_STATUS') {
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({
        status: 'active',
        version: SW_VERSION
      });
    }
  }
});
