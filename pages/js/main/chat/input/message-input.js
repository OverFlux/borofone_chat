// ==========================================
// RATE LIMITING FUNCTIONS
// ==========================================

function createRateLimitWarning() {
    if (rateLimitWarningEl) return rateLimitWarningEl;
    
    rateLimitWarningEl = document.createElement('div');
    rateLimitWarningEl.id = 'rateLimitWarning';
    rateLimitWarningEl.className = 'rate-limit-warning';
    rateLimitWarningEl.style.cssText = `
        position: fixed;
        bottom: 80px;
        left: 50%;
        transform: translateX(-50%);
        background: linear-gradient(135deg, #da373c 0%, #c42d31 100%);
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
        font-size: 14px;
        font-weight: 600;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        z-index: 10000;
        display: none;
        text-align: center;
        animation: slideUp 0.3s ease-out;
    `;
    
    // Add animation keyframes
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideUp {
            from { opacity: 0; transform: translateX(-50%) translateY(20px); }
            to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
    `;
    document.head.appendChild(style);
    
    document.body.appendChild(rateLimitWarningEl);
    return rateLimitWarningEl;
}

function showRateLimitWarning(message, isTimeout = false) {
    const warning = createRateLimitWarning();
    warning.textContent = message;
    warning.style.display = 'block';
    
    if (isTimeout) {
        warning.style.background = 'linear-gradient(135deg, #4f545c 0%, #36393f 100%)';
    }
}

function hideRateLimitWarning() {
    if (rateLimitWarningEl) {
        rateLimitWarningEl.style.display = 'none';
    }
}

function checkRateLimit() {
    const now = Date.now();
    
    // If already rate limited, check if timeout has passed
    if (isRateLimited) {
        const remainingTime = Math.ceil((messageTimestamps[0] + RATE_LIMIT_TIMEOUT_MS - now) / 1000);
        if (remainingTime > 0) {
            showRateLimitWarning(`Слишком много сообщений! Попробуйте через ${remainingTime} сек.`, true);
            return false;
        } else {
            // Timeout expired, reset rate limit
            isRateLimited = false;
            messageTimestamps = [];
            hideRateLimitWarning();
        }
    }
    
    // Clean old timestamps outside the window
    messageTimestamps = messageTimestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);
    
    // Add current timestamp
    messageTimestamps.push(now);
    
    // Check if we've exceeded the warning threshold
    if (messageTimestamps.length > RATE_LIMIT_WARNING_THRESHOLD) {
        // Trigger rate limit - 10 second timeout
        isRateLimited = true;
        messageTimestamps = [now]; // Keep only current timestamp for timeout calculation
        
        showRateLimitWarning('Слишком много сообщений! Подождите 10 секунд.', true);
        
        // Auto-clear after timeout
        if (rateLimitTimeout) clearTimeout(rateLimitTimeout);
        rateLimitTimeout = setTimeout(() => {
            isRateLimited = false;
            messageTimestamps = [];
            hideRateLimitWarning();
        }, RATE_LIMIT_TIMEOUT_MS);
        
        return false;
    } else if (messageTimestamps.length >= RATE_LIMIT_WARNING_THRESHOLD) {
        // Show warning when approaching limit
        const remaining = RATE_LIMIT_WARNING_THRESHOLD - messageTimestamps.length + 1;
        showRateLimitWarning(`Не торопитесь! Отправьте чуть помедленнее. (${remaining} из ${RATE_LIMIT_WARNING_THRESHOLD})`);
        
        // Hide warning after 2 seconds
        setTimeout(() => {
            if (!isRateLimited) hideRateLimitWarning();
        }, 2000);
    }
    
    return true;
}

// Typing indicator functions
// ================================

function updateTypingIndicator() {
    const indicator = document.getElementById('typingIndicator');
    const typingUsersEl = document.getElementById('typingUsers');
    const typingTextEl = document.getElementById('typingText');
    
    if (!indicator || !typingUsersEl || !typingTextEl) return;
    
    const userIds = Object.keys(typingUsers).filter(uid => typingUsers[uid] && typingUsers[uid].username);
    
    if (userIds.length === 0) {
        indicator.classList.add('hidden');
        return;
    }
    
    indicator.classList.remove('hidden');
    
    // Build display text
    const usernames = userIds.map(uid => typingUsers[uid].username);
    
    if (usernames.length === 1) {
        typingUsersEl.textContent = usernames[0];
        typingTextEl.textContent = 'печатает...';
    } else if (usernames.length === 2) {
        typingUsersEl.textContent = `${usernames[0]} и ${usernames[1]}`;
        typingTextEl.textContent = 'печатают...';
    } else if (usernames.length === 3) {
        typingUsersEl.textContent = `${usernames[0]}, ${usernames[1]} и ${usernames[2]}`;
        typingTextEl.textContent = 'печатают...';
    } else {
        typingUsersEl.textContent = `${usernames.length} пользователей`;
        typingTextEl.textContent = 'печатают...';
    }
}

function handleTypingEvent(data) {
    if (!currentRoom || data.room_id !== currentRoom.id) return;
    
    const userId = data.user_id;
    const username = data.username;
    
    // Don't show typing for self
    if (currentUser && userId === currentUser.id) return;
    
    // Add or update user typing
    if (typingUsers[userId]) {
        clearTimeout(typingUsers[userId].timeout);
    }
    
    typingUsers[userId] = {
        username: username,
        timeout: setTimeout(() => {
            delete typingUsers[userId];
            updateTypingIndicator();
        }, TYPING_TIMEOUT_MS)
    };
    
    updateTypingIndicator();
}

function sendTypingEvent() {
    if (!ws || ws.readyState !== WebSocket.OPEN || !currentRoom) return;
    
    ws.send(JSON.stringify({
        type: 'typing',
        room_id: currentRoom.id
    }));
}

let typingDebounceTimeout = null;

function onInputChanged() {
    // Clear existing debounce
    if (typingDebounceTimeout) {
        clearTimeout(typingDebounceTimeout);
    }
    
    // Send typing event after debounce
    typingDebounceTimeout = setTimeout(() => {
        sendTypingEvent();
    }, TYPING_DEBOUNCE_MS);
}

async function sendMessage() {
    // Check rate limit before sending
    if (!checkRateLimit()) {
        return;
    }
    
    const text = messageInput.value.trim();
    const hasAttachments = window.attachments && window.attachments.getAttachmentsToSend().length > 0;

    if (!text && !hasAttachments) return;
    if (!currentRoom) return;

    const nonce = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

    // Очищаем input сразу — UX не должен зависеть от сети
    messageInput.value = '';
    autoResizeMessageInput();

    try {
        // Загружаем вложения если есть
        let uploadedAttachments = [];
        if (hasAttachments) {
            try {
                uploadedAttachments = await window.attachments.uploadAttachments();
            } catch (err) {
                console.error('[sendMessage] Failed to upload attachments:', err);
                alert('Не удалось загрузить вложения');
                messageInput.value = text;
                return;
            }
        }

        // Ждём открытия WS (актуально при смене комнаты)
        await wsReady;

        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'message',
                room_id: currentRoom.id,
                body: text || '',  // Пустая строка допустима если есть вложения
                nonce: nonce,
                attachments: uploadedAttachments,
                reply_to_id: replyToMessage?.id ?? null,
            }));
            
            // Track sent message for stats
            connectionStats.messagesSent++;

            // Очищаем вложения после отправки
            if (window.attachments) {
                window.attachments.clearAttachments();
            }

            // Своё сообщение — сразу обновляем lastRead (оптимистично)
            // Когда придёт через WS с ID — обновим снова
            markCurrentRoomAsRead();
            clearReplyTarget();
            
            // Clear own typing indicator after sending
            if (currentUser) {
                delete typingUsers[currentUser.id];
                updateTypingIndicator();
            }
        } else {
            // WS недоступен — HTTP fallback
            console.warn('[sendMessage] WS not open, using HTTP fallback');
            const response = await fetchWithAuth(`${getApiUrl()}/rooms/${currentRoom.id}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    body: text || '',  // Пустая строка допустима если есть вложения
                    nonce: nonce,
                    attachments: uploadedAttachments,
                    reply_to_id: replyToMessage?.id ?? null
                }),
            });

            if (!response.ok) throw new Error('Failed to send message');

            const msg = await response.json();

            // Очищаем вложения после отправки
            if (window.attachments) {
                window.attachments.clearAttachments();
            }

            // HTTP fallback — добавляем сразу сами, WS не пришлёт
            if (!messagesList.querySelector(`[data-message-id="${msg.id}"]`)) {
                addMessage(msg, true, true); // true = animate, true = isOwnMessage
            }
            clearReplyTarget();
        }
    } catch (err) {
        console.error('[sendMessage] error:', err);
        // Возвращаем текст если не удалось отправить
        messageInput.value = text;
        alert('Не удалось отправить сообщение');
    }
}

function playVoiceEventSound(kind) {
    const sound = kind === 'join' ? voiceJoinSound : voiceLeaveSound;
    try {
        sound.currentTime = 0;
        const p = sound.play();
        if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (_) {
        // autoplay policy / decode errors are non-fatal
    }
}

function playStreamEventSound(kind) {
    const sound = kind === 'start' ? streamStartSound : streamEndSound;
    try {
        sound.currentTime = 0;
        const p = sound.play();
        if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (_) {
        // autoplay policy / decode errors are non-fatal
    }
}

function handleParticipantScreenShareSound(previousParticipant, nextParticipant) {
    const userId = nextParticipant?.user_id;
    if (!userId || userId === currentUser?.id) return;

    const wasSharing = !!previousParticipant?.screen_sharing;
    const isSharing = !!nextParticipant?.screen_sharing;

    if (wasSharing === isSharing) return;
    playStreamEventSound(isSharing ? 'start' : 'end');
}
