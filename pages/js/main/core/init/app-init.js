// ==========================================
// INITIALIZATION
// ==========================================

function loadTwemojiScript() {
    if (typeof window.twemoji !== 'undefined') {
        return Promise.resolve(window.twemoji);
    }

    if (window.__borofoneTwemojiPromise) {
        return window.__borofoneTwemojiPromise;
    }

    window.__borofoneTwemojiPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/twemoji@14.0.2/dist/twemoji.min.js';
        script.async = true;
        script.onload = () => resolve(window.twemoji);
        script.onerror = () => reject(new Error('Failed to load Twemoji'));
        document.head.appendChild(script);
    });

    return window.__borofoneTwemojiPromise;
}

function scheduleTwemojiParsing() {
    const parseTwemoji = () => {
        loadTwemojiScript()
            .then((twemojiLib) => {
                if (!twemojiLib) return;
                twemojiLib.parse(document.body, {
                    base: 'https://cdn.jsdelivr.net/npm/twemoji@14.0.2/assets/',
                    folder: 'svg',
                    ext: '.svg'
                });
            })
            .catch((error) => {
                console.warn('[Twemoji] Failed to initialize:', error);
            });
    };

    if ('requestIdleCallback' in window) {
        window.requestIdleCallback(parseTwemoji, { timeout: 2000 });
        return;
    }

    window.setTimeout(parseTwemoji, 1200);
}

async function init() {
    // Инициализируем тему
    initTheme();
    initDiscordTooltips();
    completeLoadingTask('Стили');

    await loadCurrentUser();
    completeLoadingTask('Конфигурация');

    await loadRooms();
    completeLoadingTask('Интерфейс');

    // Инициализируем ScrollManager после загрузки комнат
    if (window.ScrollManager) {
        window.ScrollManager.init('messagesContainer', 'messagesList', null);
        console.log('[AppInit] ScrollManager initialized');
    }

    loadVoiceRooms().catch((error) => {
        console.warn('[Voice] Failed to load voice rooms during init:', error);
    });

    // WebSocket и voice rooms больше не блокируют первый экран.
    connectWebSocket();
    completeLoadingTask('Подключение');

    // Add click listener for connection stats popup
    if (connectionStatus) {
        connectionStatus.addEventListener('click', toggleConnectionStatsPopup);
    }

    // Инициализируем сайдбар пользователей
    initUsersSidebar();

    // Инициализируем emoji picker
    initEmojiPicker();

    // Глобальный keyboard shortcut для открытия emoji picker
    document.addEventListener('keydown', (e) => {
        // Ctrl+E or Cmd+E anywhere to open emoji picker
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
            // Don't interfere if user is typing in an input
            const target = e.target;
            const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

            if (isInput && target.id !== 'emojiSearch') {
                // If in message input, just prevent default and toggle
                e.preventDefault();
            }
            toggleEmojiPicker();
        }
    });

    requestAnimationFrame(() => {
        hideLoadingScreen();
        scheduleTwemojiParsing();
    });
}

// Инициализируем экран загрузки
initLoadingScreen();
