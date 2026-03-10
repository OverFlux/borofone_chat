// ==========================================
// NOTIFICATIONS & SOUNDS
// ==========================================

/**
 * Модуль уведомлений и звуков для чата.
 *
 * Функции:
 * - playNotificationSound() - воспроизведение звука при новом сообщении
 * - Хранение последнего прочитанного сообщения в localStorage
 * - Подсчёт и отображение непрочитанных сообщений (badge)
 * - Переключение режима "Не беспокоить" (DND)
 */

// ── Do Not Disturb (DND) Mode ─────────────────────────────────────────
function getStorageNamespace() {
    const rawNamespace = window.BOROFONE_CONFIG?.storageNamespace
        || window.BOROFONE_CONFIG?.apiUrl
        || window.API_URL
        || window.location.origin;
    return String(rawNamespace).replace(/[^a-zA-Z0-9_.-]+/g, '_');
}

const STORAGE_NAMESPACE = getStorageNamespace();
const DND_STORAGE_KEY = `doNotDisturb:${STORAGE_NAMESPACE}`;
const RECENT_MESSAGE_NOTIFICATION_TTL_MS = 15000;
const recentMessageNotifications = window.__BOROFONE_RECENT_MESSAGE_NOTIFICATIONS__ || new Map();
window.__BOROFONE_RECENT_MESSAGE_NOTIFICATIONS__ = recentMessageNotifications;

/**
 * Получить состояние режима "Не беспокоить".
 * @returns {boolean} true если режим DND включён
 */
function isDoNotDisturbEnabled() {
    try {
        return localStorage.getItem(DND_STORAGE_KEY) === 'true';
    } catch {
        return false;
    }
}

/**
 * Установить состояние режима "Не беспокоить".
 * @param {boolean} enabled - включить или выключить режим
 */
function setDoNotDisturb(enabled) {
    try {
        localStorage.setItem(DND_STORAGE_KEY, enabled ? 'true' : 'false');
    } catch (err) {
        console.warn('[Notifications] Failed to save DND state:', err);
    }
}

/**
 * Переключить режим "Не беспокоить".
 * @returns {boolean} новое состояние режима
 */
function toggleDoNotDisturb() {
    const newState = !isDoNotDisturbEnabled();
    setDoNotDisturb(newState);
    return newState;
}

// ── Audio Context ─────────────────────────────────────────────────
let notificationAudio = null;

function getNotificationAudio() {
    if (!notificationAudio) {
        notificationAudio = new Audio('/sounds/notification.mp3');
        notificationAudio.preload = 'none';
        notificationAudio.volume = 0.3; // 30% громкости
    }
    return notificationAudio;
}

// ── Notification Sound ────────────────────────────────────────────
/**
 * Воспроизводит звук уведомления.
 *
 * Использует mp3 файл из /sounds/notification.mp3
 */
function playNotificationSound() {
    // Не воспроизводить звук если включён режим "Не беспокоить"
    if (isDoNotDisturbEnabled()) {
        return;
    }
    
    try {
        const audio = getNotificationAudio();
        audio.currentTime = 0; // сброс на начало если уже играет
        audio.play().catch(err => {
            console.warn('[Notifications] Sound playback failed:', err);
        });
    } catch (err) {
        console.warn('[Notifications] Sound playback failed:', err);
    }
}

// ── Unread Messages Tracking ──────────────────────────────────────
/**
 * Хранит ID последнего прочитанного сообщения для каждой комнаты.
 *
 * Формат в localStorage:
 * {
 *   "lastReadMessage": {
 *     "1": 42,   // room_id: message_id
 *     "2": 13,
 *   }
 * }
 */

function claimMessageNotification(messageId, roomId) {
    const normalizedMessageId = Number(messageId);
    if (!Number.isFinite(normalizedMessageId)) {
        return true;
    }

    const normalizedRoomId = Number(roomId);
    const notificationKey = Number.isFinite(normalizedRoomId)
        ? `${normalizedRoomId}:${normalizedMessageId}`
        : `unknown:${normalizedMessageId}`;
    const now = Date.now();

    for (const [key, expiresAt] of recentMessageNotifications.entries()) {
        if (expiresAt <= now) {
            recentMessageNotifications.delete(key);
        }
    }

    if (recentMessageNotifications.has(notificationKey)) {
        return false;
    }

    recentMessageNotifications.set(notificationKey, now + RECENT_MESSAGE_NOTIFICATION_TTL_MS);
    return true;
}

const STORAGE_KEY = `lastReadMessage:${STORAGE_NAMESPACE}`;

/**
 * Получить ID последнего прочитанного сообщения в комнате.
 */
function getLastReadMessageId(roomId) {
    try {
        const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        return data[roomId] || 0;
    } catch {
        return 0;
    }
}

/**
 * Сохранить ID последнего прочитанного сообщения в комнате.
 */
function setLastReadMessageId(roomId, messageId) {
    try {
        const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        data[roomId] = messageId;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (err) {
        console.warn('[Notifications] Failed to save last read message:', err);
    }
}

/**
 * Подсчитать количество непрочитанных сообщений в комнате.
 *
 * @param {Array} messages - массив сообщений комнаты (с полем id)
 * @param {number} roomId - ID комнаты
 * @returns {number} количество непрочитанных
 */
function countUnreadMessages(messages, roomId) {
    const lastRead = getLastReadMessageId(roomId);
    if (!lastRead) return 0;

    // Считаем сообщения с id > lastRead
    return messages.filter(msg => msg.id > lastRead).length;
}

/**
 * Отметить комнату как прочитанную (когда пользователь открыл её).
 *
 * @param {Array} messages - массив сообщений комнаты
 * @param {number} roomId - ID комнаты
 */
function markRoomAsRead(messages, roomId) {
    if (messages.length === 0) return;

    // Берём ID последнего сообщения
    const lastMessage = messages[messages.length - 1];
    setLastReadMessageId(roomId, lastMessage.id);
}

/**
 * Обновить badge (счётчик непрочитанных) на элементе комнаты.
 *
 * @param {HTMLElement} roomElement - элемент .room-item
 * @param {number} count - количество непрочитанных
 */
function updateRoomBadge(roomElement, count) {
    if (!roomElement) return;

    let badge = roomElement.querySelector('.unread-badge');

    if (count > 0) {
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'unread-badge';
            roomElement.appendChild(badge);
        }
        badge.textContent = count > 99 ? '99+' : count;
    } else {
        if (badge) badge.remove();
    }
}

// ── Export ────────────────────────────────────────────────────────
window.notifications = {
    playNotificationSound,
    getLastReadMessageId,
    setLastReadMessageId,
    countUnreadMessages,
    markRoomAsRead,
    updateRoomBadge,
    isDoNotDisturbEnabled,
    setDoNotDisturb,
    toggleDoNotDisturb,
    claimMessageNotification,
};
