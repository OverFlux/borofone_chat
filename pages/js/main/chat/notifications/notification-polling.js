// ==========================================
// POLLING (для уведомлений из других комнат)
// ==========================================

let pollingInterval = null;

// Храним предыдущие counts чтобы определять НОВЫЕ сообщения
const previousUnreadCounts = {};

/**
 * Периодическая проверка новых сообщений во всех комнатах.
 *
 * Запускается после загрузки комнат и работает в фоне.
 * Проверяет каждые 10 секунд: есть ли новые сообщения.
 */
async function startPolling() {
    if (pollingInterval) return;

    pollingInterval = setInterval(async () => {
        if (!window.notifications || !rooms.length) return;

        for (const room of rooms) {
            // Пропускаем текущую комнату — там WebSocket работает
            if (currentRoom && room.id === currentRoom.id) continue;

            try {
                const response = await fetch(`${getApiUrl()}/rooms/${room.id}/messages`, {
                    credentials: 'include',
                });

                if (!response.ok) continue;

                const messages = await response.json();
                if (messages.length === 0) continue;

                const lastRead = window.notifications.getLastReadMessageId(room.id);
                const unreadCount = messages.filter(m => m.id > lastRead).length;

                const prevCount = previousUnreadCounts[room.id] || 0;

                // Обновляем badge
                if (unreadCount > 0) {
                    updateRoomBadge(room.id, unreadCount);
                }

                // Звук только если count УВЕЛИЧИЛСЯ (новое сообщение пришло)
                if (unreadCount > prevCount) {
                    const lastMessage = messages[messages.length - 1];

                    // Play sound only for a newly observed message from another user
                    if (lastMessage.user?.id !== currentUser?.id) {
                        const shouldNotify = window.notifications.claimMessageNotification(lastMessage.id, room.id);
                        if (shouldNotify) {
                            window.notifications.playNotificationSound();
                        }
                    }
                }

                previousUnreadCounts[room.id] = unreadCount;
            } catch (err) {
                // Тихо игнорируем ошибки polling
            }
        }
    }, 10000); // каждые 10 секунд
}

function stopPolling() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }
}
