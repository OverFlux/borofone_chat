// ==========================================
// BADGES & NOTIFICATIONS
// ==========================================

/**
 * Обновить badge для конкретной комнаты.
 */
function updateRoomBadge(roomId, count) {
    const roomEl = roomsList.querySelector(`[data-room-id="${roomId}"]`);
    if (window.notifications) {
        window.notifications.updateRoomBadge(roomEl, count);
    }
}

// Хранилище для дедупликации incrementRoomBadge
const processedBadgeIncrements = new Set();

/**
 * Увеличить badge комнаты на 1 (когда пришло новое сообщение).
 * С дедупликацией по messageId.
 */
function incrementRoomBadge(roomId, messageId) {
    const badgeKey = `${roomId}:${messageId}`;
    if (messageId && processedBadgeIncrements.has(badgeKey)) {
        return; // уже обработано
    }
    if (messageId) {
        processedBadgeIncrements.add(badgeKey);
        // Очистка старых записей
        if (processedBadgeIncrements.size > 500) {
            const entries = Array.from(processedBadgeIncrements);
            processedBadgeIncrements.clear();
            entries.slice(-250).forEach(e => processedBadgeIncrements.add(e));
        }
    }

    const roomEl = roomsList.querySelector(`[data-room-id="${roomId}"]`);
    if (!roomEl) return;

    const badge = roomEl.querySelector('.unread-badge');
    const current = badge ? parseInt(badge.textContent) || 0 : 0;

    if (window.notifications) {
        window.notifications.updateRoomBadge(roomEl, current + 1);
    }
}

/**
 * Отметить текущую комнату как прочитанную (вызывается при отправке сообщения).
 */
function markCurrentRoomAsRead() {
    if (!currentRoom || !window.notifications) return;

    // Берём все сообщения из DOM
    const messages = Array.from(messagesList.querySelectorAll('[data-message-id]'))
        .map(el => ({ id: parseInt(el.dataset.messageId) }));

    if (messages.length > 0) {
        window.notifications.markRoomAsRead(messages, currentRoom.id);
        updateRoomBadge(currentRoom.id, 0);
    }
}

/**
 * Обновить badge текущей открытой комнаты.
 */
function updateCurrentRoomBadge() {
    if (!currentRoom) return;

    // Получаем все сообщения из DOM
    const messages = Array.from(messagesList.querySelectorAll('[data-message-id]'))
        .map(el => ({ id: parseInt(el.dataset.messageId) }));

    if (window.notifications) {
        const unread = window.notifications.countUnreadMessages(messages, currentRoom.id);
        updateRoomBadge(currentRoom.id, unread);
    }
}

/**
 * Обновить badges для всех комнат (вызывается после loadRooms).
 * Теперь только обновляет badge для текущей комнаты, чтобы избежать
 * загрузки всех сообщений со всех комнат.
 */
async function updateAllRoomBadges() {
    if (!window.notifications) return;

    // Только обновляем badge для текущей открытой комнаты
    // Это критически важно - не грузим сообщения со всех комнат!
    if (currentRoom) {
        try {
            // Ограничиваем до 10 сообщений только для подсчёта непрочитанных
            const response = await fetchWithAuth(`${getApiUrl()}/rooms/${currentRoom.id}/messages?limit=10`);
            if (!response.ok) return;

            const messages = await response.json();
            const unread = window.notifications.countUnreadMessages(messages, currentRoom.id);
            updateRoomBadge(currentRoom.id, unread);
        } catch (err) {
            console.warn(`Failed to load messages for current room ${currentRoom.id}:`, err);
        }
    }
    
    // Сбрасываем badge для всех остальных комнат (они не открыты)
    for (const room of rooms) {
        if (!currentRoom || room.id !== currentRoom.id) {
            updateRoomBadge(room.id, 0);
        }
    }
}
