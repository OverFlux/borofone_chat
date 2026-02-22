// ==========================================
// API CONFIGURATION
// ==========================================

// API_URL и WS_URL определяются в config.js
// Если config.js не загрузился, используем window.location.origin
function getApiUrl() {
    if (typeof API_URL !== 'undefined') return API_URL;
    return window.location.origin;
}

function getWsUrl() {
    if (typeof WS_URL !== 'undefined') return WS_URL;
    return window.location.origin.replace(/^http/, 'ws');
}

// ==========================================
// STATE
// ==========================================

let currentRoom = null;
let ws = null;
let wsReady = Promise.resolve();  // Promise который резолвится когда WS открыт
let currentUser = null;
let rooms = [];
let shouldRemoveAvatar = false;
let badgesInitialized = false;  // Флаг: badges загружены один раз
// ==========================================
// DOM ELEMENTS
// ==========================================

const roomsList = document.getElementById('roomsList');
const roomName = document.getElementById('roomName');
const messagesList = document.getElementById('messagesList');
const messagesContainer = document.getElementById('messagesContainer');
const messageInput = document.getElementById('messageInput');
const messageForm = document.getElementById('messageForm');
const sendBtn = document.getElementById('sendBtn');
const connectionStatus = document.getElementById('connectionStatus');
const createRoomBtn = document.getElementById('createRoomBtn');
const createRoomModal = document.getElementById('createRoomModal');
const createRoomForm = document.getElementById('createRoomForm');
const roomNameInput = document.getElementById('roomNameInput');
const closeModalBtn = document.getElementById('closeModalBtn');
const cancelModalBtn = document.getElementById('cancelModalBtn');
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const settingsForm = document.getElementById('settingsForm');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const cancelSettingsBtn = document.getElementById('cancelSettingsBtn');
const settingsDisplayName = document.getElementById('settingsDisplayName');
const settingsUsername = document.getElementById('settingsUsername');
const avatarInput = document.getElementById('avatarInput');
const removeAvatarBtn = document.getElementById('removeAvatarBtn');
const settingsAvatarPreview = document.getElementById('settingsAvatarPreview');
const currentUserAvatar = document.getElementById('currentUserAvatar');
const currentUserName = document.getElementById('currentUserName');
const currentUserUsername = document.getElementById('currentUserUsername');

// ==========================================
// AUTH FUNCTIONS
// ==========================================

function redirectToLogin() {
    window.location.href = './login.html';
}

async function fetchWithAuth(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        credentials: 'include',
        headers: {
            ...(options.headers || {}),
        }
    });

    if (response.status === 401) {
        const refreshed = await refreshAccessToken();
        if (!refreshed) {
            redirectToLogin();
            return response;
        }

        return fetch(url, {
            ...options,
            credentials: 'include',
            headers: {
                ...(options.headers || {}),
            }
        });
    }

    return response;
}

async function refreshAccessToken() {
    try {
        const response = await fetch(`${getApiUrl()}/auth/refresh`, {
            method: 'POST',
            credentials: 'include'
        });

        if (response.ok) {
            console.log('Access token refreshed');
            return true;
        }

        return false;
    } catch (err) {
        console.error('Failed to refresh token:', err);
        return false;
    }
}

async function loadCurrentUser() {
    try {
        const response = await fetchWithAuth(`${getApiUrl()}/auth/me`);

        if (!response.ok) {
            redirectToLogin();
            return;
        }

        currentUser = await response.json();
        renderCurrentUser();
        console.log('Logged in as:', currentUser.username);
    } catch (err) {
        console.error('Failed to load user:', err);
        redirectToLogin();
    }
}

// ==========================================
// ROOMS FUNCTIONS
// ==========================================

async function loadRooms() {
    try {
        const response = await fetchWithAuth(`${getApiUrl()}/rooms`);

        if (!response.ok) {
            throw new Error('Failed to load rooms');
        }

        rooms = await response.json();

        roomsList.innerHTML = '';

        if (rooms.length === 0) {
            roomsList.innerHTML = `
                <div class="placeholder-message">
                    <span class="placeholder-icon">#</span>
                    <p>Нет доступных комнат</p>
                </div>
            `;
            return;
        }

        rooms.forEach(room => {
            const roomEl = document.createElement('div');
            roomEl.className = 'room-item';
            roomEl.dataset.roomId = room.id;

            roomEl.innerHTML = `
                <span class="room-icon">#</span>
                <span class="room-title">${escapeHtml(room.title)}</span>
            `;

            roomEl.addEventListener('click', () => selectRoom(room.id));
            roomsList.appendChild(roomEl);
        });
        
        // Обновляем badges ТОЛЬКО при первой загрузке (не при создании новой комнаты)
        if (!badgesInitialized) {
            badgesInitialized = true;
            updateAllRoomBadges();
        }

        // Auto-select first room
        if (rooms.length > 0 && !currentRoom) {
            selectRoom(rooms[0].id);
        }
    } catch (err) {
        console.error('Failed to load rooms:', err);
        roomsList.innerHTML = `
            <div class="placeholder-message">
                <span class="placeholder-icon">⚠</span>
                <p>Не удалось загрузить комнаты</p>
            </div>
        `;
    }
}

async function createRoom() {
    const title = roomNameInput.value.trim();
    if (!title) return;

    try {
        const response = await fetch(`${getApiUrl()}/rooms`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title }),
        });

        if (response.status === 403) {
            alert('Только администраторы могут создавать комнаты');
            closeModal();
            return;
        }

        if (response.status === 401) {
            redirectToLogin();
            return;
        }

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            alert(error.detail || 'Не удалось создать комнату');
            return;
        }

        roomNameInput.value = '';
        closeModal();
        await loadRooms();
    } catch (err) {
        console.error('Failed to create room:', err);
        alert('Ошибка сети');
    }
}

function selectRoom(roomId) {
    currentRoom = rooms.find(r => r.id === roomId);

    if (!currentRoom) return;

    // Update UI
    document.querySelectorAll('.room-item').forEach(el => {
        el.classList.toggle('active', el.dataset.roomId == roomId);
    });

    roomName.textContent = currentRoom.title;

    // Enable input
    messageInput.disabled = false;
    messageInput.placeholder = `Сообщение в #${currentRoom.title}`;
    sendBtn.disabled = false;

    // Load messages (WebSocket уже подключен глобально)
    loadMessages(roomId);
    
    // Start presence tracking для новой комнаты
    stopPresenceTracking();  // останавливаем старую
    startPresenceTracking(); // запускаем новую
}

// ==========================================
// MESSAGES FUNCTIONS
// ==========================================

async function loadMessages(roomId) {
    try {
        const response = await fetchWithAuth(`${getApiUrl()}/rooms/${roomId}/messages`);

        if (!response.ok) {
            throw new Error('Failed to load messages');
        }

        const messages = await response.json();

        messagesList.innerHTML = '';
        resetScroll();

        if (messages.length === 0) {
            messagesList.innerHTML = `
                <div class="placeholder-message">
                    <span class="placeholder-icon">💬</span>
                    <p>Нет сообщений. Напишите первым!</p>
                </div>
            `;
        } else {
            const lastRead = window.notifications ? window.notifications.getLastReadMessageId(roomId) : 0;
            let unreadDividerAdded = false;
            
            messages.forEach(msg => {
                // Добавляем разделитель перед первым непрочитанным сообщением
                if (!unreadDividerAdded && lastRead > 0 && msg.id > lastRead) {
                    const divider = document.createElement('div');
                    divider.className = 'unread-divider';
                    divider.innerHTML = '<span>Новые сообщения</span>';
                    messagesList.appendChild(divider);
                    unreadDividerAdded = true;
                }
                
                addMessage(msg, false);
            });
            
            // Скроллим вниз после загрузки всех сообщений (с ожиданием изображений)
            scrollToBottomInitial();
            
            // Отмечаем комнату как прочитанную
            if (window.notifications) {
                window.notifications.markRoomAsRead(messages, roomId);
                updateRoomBadge(roomId, 0);
            }
        }
    } catch (err) {
        console.error('Failed to load messages:', err);
        messagesList.innerHTML = `
            <div class="placeholder-message">
                <span class="placeholder-icon">⚠</span>
                <p>Не удалось загрузить сообщения</p>
            </div>
        `;
    }
}

function addMessage(msg, animate = false) {
    // ← ВАЖНО: Удаляем плейсхолдер если есть
    const placeholder = messagesList.querySelector('.placeholder-message');
    if (placeholder) {
        placeholder.remove();
    }

    const messageEl = document.createElement('div');
    messageEl.className = 'message' + (animate ? ' message-new' : '');
    messageEl.dataset.messageId = msg.id;
    
    // message-unread больше не нужен — оставляем только divider

    const author = msg.user?.display_name || msg.author || 'Unknown';
    const username = msg.user?.username || 'unknown';
    const authorInitial = author[0].toUpperCase();
    const avatarUrl = normalizeAvatarUrl(msg.user?.avatar_url)

    const time = new Date(msg.created_at).toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit'
    });

    // Рендерим вложения если есть
    const attachmentsHtml = window.attachments 
        ? window.attachments.renderMessageAttachments(msg.attachments) 
        : '';
    
    // Скрываем текст если пустой и есть вложения
    const bodyText = msg.body ? escapeHtml(msg.body) : '';
    const bodyHtml = bodyText ? `<div class="message-text">${bodyText}</div>` : '';

    messageEl.innerHTML = `
        <div class="message-avatar">
            ${avatarUrl
                ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(author)}" class="avatar-media avatar-media--message">`
                : `<span>${authorInitial}</span>`}
        </div>
        <div class="message-content">
            <div class="message-header">
                <span class="message-author">${escapeHtml(author)}</span>
                <span class="message-username">@${escapeHtml(username)}</span>
                <span class="message-time">${time}</span>
            </div>
            ${bodyHtml}
            ${attachmentsHtml}
        </div>
    `;

    const avatarImage = messageEl.querySelector('.avatar-media');
    if (avatarImage) {
        avatarImage.addEventListener('error', () => {
            const avatar = messageEl.querySelector('.message-avatar');
            if (avatar) {
                avatar.innerHTML = `<span>${escapeHtml(authorInitial)}</span>`;
            }
        }, { once: true });
    }

    messagesList.appendChild(messageEl);
    if (animate) scrollToBottomWithImages();
}

function normalizeAvatarUrl(avatarUrl) {
    if (!avatarUrl) return null;

    const rawUrl = String(avatarUrl).trim();
    if (!rawUrl) return null;

    if (/^https?:\/\//i.test(rawUrl)) {
        return rawUrl;
    }

    const unixPath = rawUrl.replaceAll('\\', '/');

    const uploadsIndex = unixPath.toLowerCase().indexOf('/uploads/');
    if (uploadsIndex >= 0) {
        const webPath = unixPath.slice(uploadsIndex);
        try {
            return new URL(webPath, getApiUrl()).toString();
        } catch {
            return null;
        }
    }

    const normalizedPath = unixPath
        .replace(/^\.\//, '')
        .replace(/^uploads\//i, '/uploads/')
        .replace(/^avatars\//i, '/uploads/avatars/');

    try {
        return new URL(normalizedPath, getApiUrl()).toString();
    } catch {
        return null;
    }
}

// ==========================================
// SCROLL
// ==========================================

function scrollToBottom() {
    // Скроллим messagesContainer (именно на нём overflow-y: auto в CSS)
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

/**
 * Скролл вниз с ожиданием загрузки изображений.
 * Используется при добавлении новых сообщений с вложениями.
 */
function scrollToBottomWithImages() {
    // Находим все изображения в контейнере, которые ещё не загрузились
    const images = messagesList.querySelectorAll('img:not([data-loaded])');
    
    if (images.length === 0) {
        scrollToBottom();
        return;
    }
    
    // Помечаем изображения как ожидающие загрузки
    let pendingCount = images.length;
    
    images.forEach(img => {
        // Если изображение уже загружено (из кэша)
        if (img.complete) {
            img.dataset.loaded = 'true';
            pendingCount--;
            if (pendingCount === 0) {
                scrollToBottom();
            }
            return;
        }
        
        // Ждём загрузки
        img.onload = () => {
            img.dataset.loaded = 'true';
            pendingCount--;
            if (pendingCount === 0) {
                scrollToBottom();
            }
        };
        
        img.onerror = () => {
            img.dataset.loaded = 'true';
            pendingCount--;
            if (pendingCount === 0) {
                scrollToBottom();
            }
        };
    });
    
    // Скроллим сразу на случай если изображения не загрузятся
    setTimeout(() => scrollToBottom(), 100);
}

/**
 * Скролл вниз при начальной загрузке сообщений.
 * Ждёт загрузки всех изображений в сообщениях.
 */
function scrollToBottomInitial() {
    const images = messagesList.querySelectorAll('img:not([data-loaded])');
    
    if (images.length === 0) {
        scrollToBottom();
        return;
    }
    
    let pendingCount = images.length;
    let scrolled = false;
    
    const doScroll = () => {
        if (scrolled) return;
        scrolled = true;
        scrollToBottom();
    };
    
    images.forEach(img => {
        if (img.complete) {
            img.dataset.loaded = 'true';
            pendingCount--;
            if (pendingCount === 0) {
                doScroll();
            }
            return;
        }
        
        img.onload = () => {
            img.dataset.loaded = 'true';
            pendingCount--;
            if (pendingCount === 0) {
                doScroll();
            }
        };
        
        img.onerror = () => {
            img.dataset.loaded = 'true';
            pendingCount--;
            if (pendingCount === 0) {
                doScroll();
            }
        };
    });
    
    // Fallback: скроллим через небольшую задержку
    setTimeout(() => doScroll(), 150);
}

function resetScroll() {
    scrollToBottom();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

async function sendMessage() {
    const text = messageInput.value.trim();
    const hasAttachments = window.attachments && window.attachments.getAttachmentsToSend().length > 0;
    
    if (!text && !hasAttachments) return;
    if (!currentRoom) return;

    const nonce = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

    // Очищаем input сразу — UX не должен зависеть от сети
    messageInput.value = '';

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
            }));
            
            // Очищаем вложения после отправки
            if (window.attachments) {
                window.attachments.clearAttachments();
            }
            
            // Своё сообщение — сразу обновляем lastRead (оптимистично)
            // Когда придёт через WS с ID — обновим снова
            markCurrentRoomAsRead();
        } else {
            // WS недоступен — HTTP fallback
            console.warn('[sendMessage] WS not open, using HTTP fallback');
            const response = await fetchWithAuth(`${getApiUrl()}/rooms/${currentRoom.id}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    body: text || '',  // Пустая строка допустима если есть вложения
                    nonce: nonce,
                    attachments: uploadedAttachments 
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
                addMessage(msg, true);
            }
        }
    } catch (err) {
        console.error('[sendMessage] error:', err);
        // Возвращаем текст если не удалось отправить
        messageInput.value = text;
        alert('Не удалось отправить сообщение');
    }
}

// ==========================================
// WEBSOCKET
// ==========================================

// Подключаемся к глобальному WS ОДИН РАЗ при загрузке
function connectWebSocket() {
    if (ws) return; // уже подключены
    
    wsReady = new Promise((resolve) => {
        const wsUrl = `${getWsUrl()}/ws`;
        const socket = new WebSocket(wsUrl);

        socket.onopen = () => {
            console.log('[WS] Connected globally');
            updateConnectionStatus('connected');
            ws = socket;
            resolve();
        };

        socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);

                if (data.type === 'message') {
                    // Если сообщение в ТЕКУЩЕЙ комнате — добавляем в DOM
                    if (currentRoom && data.room_id === currentRoom.id) {
                        if (!messagesList.querySelector(`[data-message-id="${data.id}"]`)) {
                            addMessage(data, true);
                        }
                        
                        // Если это НАШЕ сообщение — обновляем lastRead с правильным ID
                        if (data.user?.id === currentUser?.id && window.notifications) {
                            window.notifications.setLastReadMessageId(currentRoom.id, data.id);
                        }
                    }
                    
                    // Уведомления ТОЛЬКО если сообщение НЕ от меня
                    if (window.notifications && data.user?.id !== currentUser?.id) {
                        // Звук
                        window.notifications.playNotificationSound();
                        
                        // Badge
                        if (data.room_id) {
                            if (currentRoom && data.room_id === currentRoom.id) {
                                updateCurrentRoomBadge();
                            } else {
                                incrementRoomBadge(data.room_id);
                            }
                        }
                    }
                } else if (data.type === 'error') {
                    console.error('[WS] error:', data.detail);
                    if (data.code === 'unauthorized') redirectToLogin();
                } else if (data.type === 'connected') {
                    console.log('[WS] ready');
                }
            } catch (err) {
                console.error('[WS] parse error:', err);
            }
        };

        socket.onerror = (err) => {
            console.error('[WS] error:', err);
            updateConnectionStatus('disconnected');
        };

        socket.onclose = () => {
            console.log('[WS] disconnected');
            updateConnectionStatus('disconnected');
            ws = null;
            
            // Переподключаемся через 3 секунды
            setTimeout(() => connectWebSocket(), 3000);
        };
    });
}

function updateConnectionStatus(status) {
    connectionStatus.classList.remove('connecting', 'connected', 'disconnected');
    connectionStatus.classList.add(status);

    const statusText = {
        connecting: 'Подключение...',
        connected: 'Подключено',
        disconnected: 'Отключено'
    }[status] || 'Неизвестно';

    connectionStatus.querySelector('.status-text').textContent = statusText;
}

// ==========================================
// MODAL
// ==========================================

function openModal() {
    createRoomModal.classList.add('active');
    roomNameInput.focus();
}

function closeModal() {
    createRoomModal.classList.remove('active');
    roomNameInput.value = '';
}

function renderCurrentUser() {
    if (!currentUser) return;

    const displayName = currentUser.display_name || currentUser.username || 'User';
    const username = currentUser.username || 'unknown';
    const avatarUrl = normalizeAvatarUrl(currentUser.avatar_url);

    if (currentUserName) currentUserName.textContent = displayName;
    if (currentUserUsername) currentUserUsername.textContent = `@${username}`;

    const initial = escapeHtml(displayName[0]?.toUpperCase() || 'U');
    const avatarHtml = avatarUrl
        ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(displayName)}" class="avatar-media">`
        : `<span>${initial}</span>`;

    if (currentUserAvatar) currentUserAvatar.innerHTML = avatarHtml;

    // Кнопка создания комнаты — только для admin
    if (createRoomBtn) {
        createRoomBtn.style.display = currentUser.role === 'admin' ? '' : 'none';
    }
}

function openSettingsModal() {
    if (!currentUser) return;

    shouldRemoveAvatar = false;
    settingsDisplayName.value = currentUser.display_name || '';
    settingsUsername.value = currentUser.username || '';
    avatarInput.value = '';
    updateSettingsAvatarPreview(normalizeAvatarUrl(currentUser.avatar_url));

    settingsModal.classList.add('active');
}

function closeSettingsModal() {
    settingsModal.classList.remove('active');
}

function updateSettingsAvatarPreview(avatarUrl) {
    const displayName = currentUser?.display_name || currentUser?.username || 'User';
    const initial = escapeHtml(displayName[0]?.toUpperCase() || 'U');

    settingsAvatarPreview.innerHTML = avatarUrl
        ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(displayName)}" class="avatar-media">`
        : `<span>${initial}</span>`;
}

async function saveSettings() {
    const formData = new FormData();
    formData.append('display_name', settingsDisplayName.value.trim());
    formData.append('username', settingsUsername.value.trim());
    formData.append('remove_avatar', shouldRemoveAvatar ? 'true' : 'false');

    const file = avatarInput.files?.[0];
    if (file) {
        formData.append('avatar', file);
    }

    try {
        const response = await fetchWithAuth(`${getApiUrl()}/auth/profile`, {
            method: 'PUT',
            body: formData,
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Не удалось сохранить настройки');
        }

        currentUser = await response.json();
        renderCurrentUser();
        closeSettingsModal();

        if (currentRoom) {
            await loadMessages(currentRoom.id);
        }
    } catch (err) {
        console.error('Failed to save settings:', err);
        alert(err.message || 'Не удалось сохранить настройки');
    }
}

// ==========================================
// EVENT LISTENERS
// ==========================================

messageForm.addEventListener('submit', (e) => {
    e.preventDefault();
    sendMessage();
});

createRoomBtn.addEventListener('click', openModal);
closeModalBtn.addEventListener('click', closeModal);
cancelModalBtn.addEventListener('click', closeModal);

createRoomForm.addEventListener('submit', (e) => {
    e.preventDefault();
    createRoom();
});

createRoomModal.addEventListener('click', (e) => {
    if (e.target === createRoomModal) {
        closeModal();
    }
});

settingsBtn.addEventListener('click', openSettingsModal);

closeSettingsBtn.addEventListener('click', closeSettingsModal);
cancelSettingsBtn.addEventListener('click', closeSettingsModal);

settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
        closeSettingsModal();
    }
});

removeAvatarBtn.addEventListener('click', () => {
    shouldRemoveAvatar = true;
    avatarInput.value = '';
    updateSettingsAvatarPreview(null);
});

avatarInput.addEventListener('change', () => {
    const file = avatarInput.files?.[0];
    if (!file) return;

    shouldRemoveAvatar = false;
    const objectUrl = URL.createObjectURL(file);
    updateSettingsAvatarPreview(objectUrl);
});

settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveSettings();
});

document.getElementById('attachBtn').addEventListener('click', () => {
    if (window.attachments) {
        window.attachments.openAttachmentDialog();
    }
});

// ==========================================
// PRESENCE (онлайн пользователи)
// ==========================================

let presenceInterval = null;

/**
 * Загрузить список онлайн пользователей в текущей комнате.
 */
async function loadOnlineUsers() {
    if (!currentRoom) {
        document.getElementById('usersCount').textContent = '0';
        document.getElementById('usersList').innerHTML = `
            <div class="placeholder-message">
                <span class="placeholder-icon">👥</span>
                <p>Выберите комнату</p>
            </div>
        `;
        return;
    }
    
    try {
        const response = await fetchWithAuth(`${getApiUrl()}/rooms/${currentRoom.id}/online`);
        
        if (!response.ok) {
            throw new Error('Failed to load online users');
        }
        
        const users = await response.json();
        
        // Обновляем счётчик
        document.getElementById('usersCount').textContent = users.length;
        
        // Отображаем список
        const usersList = document.getElementById('usersList');
        
        if (users.length === 0) {
            usersList.innerHTML = `
                <div class="placeholder-message">
                    <span class="placeholder-icon">👤</span>
                    <p>Никого нет онлайн</p>
                </div>
            `;
            return;
        }
        
        usersList.innerHTML = users.map(user => {
            const displayName = user.display_name || user.username;
            const avatarUrl = normalizeAvatarUrl(user.avatar_url);
            const initial = displayName[0]?.toUpperCase() || 'U';
            
            const avatarHtml = avatarUrl
                ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(displayName)}" class="avatar-media">`
                : `<span>${initial}</span>`;
            
            return `
                <div class="user-item">
                    <div class="user-avatar">${avatarHtml}</div>
                    <div class="user-info">
                        <div class="user-display-name">${escapeHtml(displayName)}</div>
                        <div class="user-username">@${escapeHtml(user.username)}</div>
                    </div>
                    <div class="user-status online"></div>
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error('Failed to load online users:', err);
    }
}

/**
 * Heartbeat — сообщаем серверу что мы ещё здесь.
 */
async function sendPresenceHeartbeat() {
    if (!currentRoom || !ws || ws.readyState !== WebSocket.OPEN) return;
    
    try {
        ws.send(JSON.stringify({
            type: 'heartbeat',
            room_id: currentRoom.id,
        }));
    } catch (err) {
        console.warn('[Presence] Heartbeat failed:', err);
    }
}

/**
 * Начать отслеживание присутствия в комнате.
 */
function startPresenceTracking() {
    if (presenceInterval) return;
    
    // Загружаем онлайн пользователей сразу
    loadOnlineUsers();
    
    // Обновляем каждые 10 секунд
    presenceInterval = setInterval(() => {
        loadOnlineUsers();
        sendPresenceHeartbeat();
    }, 10000);
}

/**
 * Остановить отслеживание присутствия.
 */
function stopPresenceTracking() {
    if (presenceInterval) {
        clearInterval(presenceInterval);
        presenceInterval = null;
    }
}

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

/**
 * Увеличить badge комнаты на 1 (когда пришло новое сообщение в неактивную комнату).
 */
function incrementRoomBadge(roomId) {
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
 */
async function updateAllRoomBadges() {
    if (!window.notifications) return;
    
    for (const room of rooms) {
        try {
            // Загружаем сообщения комнаты (без отображения)
            const response = await fetchWithAuth(`${getApiUrl()}/rooms/${room.id}/messages`);
            if (!response.ok) continue;
            
            const messages = await response.json();
            const unread = window.notifications.countUnreadMessages(messages, room.id);
            updateRoomBadge(room.id, unread);
        } catch (err) {
            console.warn(`Failed to load messages for room ${room.id}:`, err);
        }
    }
}

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
                    
                    // Звук только если сообщение не от нас
                    if (lastMessage.user?.id !== currentUser?.id) {
                        window.notifications.playNotificationSound();
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

// ==========================================
// INITIALIZATION
// ==========================================

async function init() {
    await loadCurrentUser();
    await loadRooms();
    
    // Подключаемся к глобальному WebSocket ОДИН РАЗ
    connectWebSocket();
}

init();
