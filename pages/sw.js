const CACHE = "borotalk-nova-v31";
const APP_SHELL = [
    "/",
    "/index.html",
    "/main.html",
    "/login.html",
    "/register.html",
    "/manifest.json",
    "/styles/landing.css?v=6",
    "/styles/nova-app.css?v=28",
    "/styles/nova-auth.css?v=7",
    "/js/landing.js?v=4",
    "/js/demo-login.js?v=2",
    "/js/desktop-bridge.js?v=3",
    "/js/nova-main.js?v=31",
    "/js/message-format.mjs",
    "/js/nova-auth.js?v=7",
    "/favicon.ico?v=3",
    "/icons/borotalk-64.png?v=2",
    "/icons/borotalk-192.png?v=2",
    "/icons/borotalk-512.png?v=2",
    "/images/avatars/ducks/duck-ioi.png",
    "/images/avatars/ducks/duck-neon.png",
    "/images/avatars/ducks/duck-sunset.png",
    "/images/avatars/ducks/duck-chainsaw.png",
    "/images/avatars/ducks/duck-proximity.png",
    "/images/avatars/ducks/duck-pale.png",
    "/images/avatars/ducks/duck-purple.png",
    "/images/avatars/ducks/duck-dragon.png",
    "/images/avatars/ducks/duck-concussion-collector.png",
    "/images/avatars/ducks/duck-classic.png",
    "/images/avatars/ducks/duck-remote.png",
    "/images/avatars/ducks/duck-british.png",
    "/images/avatars/ducks/duck-concussion.png",
    "/images/avatars/ducks/duck-devil.png",
    "/images/avatars/ducks/duck-remote-mk2.png",
    "/images/avatars/ducks/duck-proximity-mk2.png",
];

self.addEventListener("install", (event) => {
    event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)));
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keys) => Promise.all(
            keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
        )),
    );
    self.clients.claim();
});

self.addEventListener("fetch", (event) => {
    const { request } = event;
    const url = new URL(request.url);
    if (
        request.method !== "GET"
        || url.origin !== self.location.origin
        || url.pathname.startsWith("/api/")
        || url.pathname.startsWith("/auth/")
        || url.pathname.startsWith("/servers")
        || url.pathname.startsWith("/rooms")
        || url.pathname.startsWith("/voice-rooms")
        || url.pathname.startsWith("/direct-conversations")
        || url.pathname.startsWith("/uploads/")
        || url.pathname === "/app-config.js"
    ) {
        return;
    }

    if (request.mode === "navigate") {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    if (response.ok) {
                        caches.open(CACHE).then((cache) => cache.put(request, response.clone()));
                    }
                    return response;
                })
                .catch(async () => (await caches.match(request)) || caches.match("/main.html")),
        );
        return;
    }

    event.respondWith(
        caches.match(request).then((cached) => {
            const fresh = fetch(request).then((response) => {
                if (response.ok) {
                    caches.open(CACHE).then((cache) => cache.put(request, response.clone()));
                }
                return response;
            });
            return cached || fresh;
        }),
    );
});
