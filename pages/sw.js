// Borofone Chat - Service Worker
const CACHE_NAME = 'borofone-chat-v2';
const STATIC_CACHE = 'borofone-static-v2';
const DYNAMIC_CACHE = 'borofone-dynamic-v2';

// Статические ресурсы для кэширования
const STATIC_ASSETS = [
    '/',
    '/main.html',
    '/manifest.json',
    '/styles/main.css',
    '/styles/notifications.css',
    '/styles/presence.css',
    '/styles/attachments.css',
    '/styles/wordle.css',
    '/js/config.js',
    '/js/auth.js',
    '/js/notifications.js',
    '/js/attachments.js',
    '/js/wordle.js',
    '/js/app/bootstrap.js',
    '/js/app/manifest.js',
    '/js/app/runtime.js',
    '/js/app/loaders/sequential.js',
    '/js/app/utils/api.js',
    '/js/app/utils/text.js',
    '/js/app/utils/avatar.js',
    '/js/main/core/config/api-config.js',
    '/js/main/core/ui/loading-screen.js',
    '/js/main/core/state/app-state.js',
    '/js/main/core/ui/tooltips.js',
    '/js/main/chat/emoji/emoji-picker.js',
    '/js/main/chat/input/rate-limit-state.js',
    '/js/main/core/dom/dom-elements.js',
    '/js/main/core/theme/theme-manager.js',
    '/js/main/chat/auth/auth-session.js',
    '/js/main/chat/rooms/room-service.js',
    '/js/main/chat/messages/message-renderer.js',
    '/js/main/chat/messages/message-reactions.js',
    '/js/main/chat/messages/message-scroll.js',
    '/js/main/chat/input/message-input.js',
    '/js/main/chat/transport/websocket-client.js',
    '/js/main/chat/ui/settings-modal.js',
    '/js/main/chat/ui/ui-events.js',
    '/js/main/chat/presence/presence-sidebar.js',
    '/js/main/chat/notifications/room-badges.js',
    '/js/main/chat/notifications/notification-polling.js',
    '/js/main/voice/rooms/voice-room-manager.js',
    '/js/main/core/init/app-init.js',
    '/js/main/mobile/navigation/mobile-menu.js',
    '/js/main/mobile/users/mobile-users-sidebar.js',
    '/js/main/admin/panel/admin-panel.js',
    '/js/tips.js',
    '/login.html',
    '/register.html',
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
    'https://cdn.jsdelivr.net/npm/twemoji@14.0.2/dist/twemoji.min.js'
];

// Установка Service Worker
self.addEventListener('install', (event) => {
    console.log('[SW] Installing Service Worker...');
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then((cache) => {
                console.log('[SW] Caching static assets');
                return cache.addAll(STATIC_ASSETS);
            })
            .then(() => self.skipWaiting())
            .catch((err) => console.error('[SW] Cache failed:', err))
    );
});

// Активация Service Worker
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating Service Worker...');
    event.waitUntil(
        caches.keys()
            .then((keys) => {
                return Promise.all(
                    keys.filter((key) => key !== STATIC_CACHE && key !== DYNAMIC_CACHE)
                        .map((key) => {
                            console.log('[SW] Removing old cache:', key);
                            return caches.delete(key);
                        })
                );
            })
            .then(() => self.clients.claim())
    );
});

// Обработка fetch запросов
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Пропускаем WebSocket, API запросы и загруженные файлы
    if (url.protocol === 'ws:' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws') || url.pathname.startsWith('/uploads/')) {
        return;
    }

    // Для GET запросов используем стратегию stale-while-revalidate
    if (request.method === 'GET') {
        event.respondWith(staleWhileRevalidate(request));
    }
});

// Стратегия Stale-While-Revalidate
async function staleWhileRevalidate(request) {
    const cache = await caches.open(DYNAMIC_CACHE);
    const cachedResponse = await cache.match(request);

    const fetchPromise = fetch(request)
        .then((response) => {
            // Кэшируем только успешные ответы
            if (response.ok) {
                cache.put(request, response.clone());
            }
            return response;
        })
        .catch(() => {
            // Если сеть недоступна и есть кэш - используем его
            if (cachedResponse) {
                return cachedResponse;
            }
            // Иначе возвращаем оффлайн страницу
            return new Response('Оффлайн', {
                status: 503,
                statusText: 'Service Unavailable'
            });
        });

    return cachedResponse || fetchPromise;
}

// Стратегия Cache-First (для статики)
async function cacheFirst(request) {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
        return cachedResponse;
    }
    return fetch(request);
}

// Обработка push-уведомлений
self.addEventListener('push', (event) => {
    if (!event.data) return;

    const data = event.data.json();
    const options = {
        body: data.body || 'Новое уведомление',
        icon: '/data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23DB734F" rx="20" width="100" height="100"/><text x="50" y="65" font-size="50" text-anchor="middle" fill="white">B</text></svg>',
        badge: '/data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23DB734F" rx="20" width="100" height="100"/></svg>',
        vibrate: [100, 50, 100],
        data: {
            url: data.url || '/main.html',
            dateOfArrival: Date.now()
        },
        actions: [
            { action: 'open', title: 'Открыть' },
            { action: 'close', title: 'Закрыть' }
        ]
    };

    event.waitUntil(
        self.registration.showNotification(data.title || 'Borofone Chat', options)
    );
});

// Обработка клика по уведомлению
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    if (event.action === 'open' || !event.action) {
        event.waitUntil(
            clients.openWindow(event.notification.data.url || '/main.html')
        );
    }
});

// Обработка сообщений от клиента
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }

    // Команда для очистки кэша
    if (event.data && event.data.type === 'CLEAR_CACHE') {
        caches.keys().then((keys) => {
            keys.forEach((key) => caches.delete(key));
        });
    }
});

// Фоновый sync для сообщений (если поддерживается)
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-messages') {
        console.log('[SW] Syncing messages...');
        // Здесь можно добавить логику синхронизации
    }
});
