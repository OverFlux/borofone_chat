// ==========================================
// API CONFIGURATION
// ==========================================

function resolveApiBase() {
    const url = new URL(window.location.href);

    if (url.protocol === 'file:') {
        return 'http://localhost:8000';
    }

    if (url.port && url.port !== '8000') {
        return `${url.protocol}//${url.hostname}:8000`;
    }

    return url.origin;
}

function resolveWsBase(apiBase) {
    const apiUrl = new URL(apiBase);
    const wsProtocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProtocol}//${apiUrl.host}`;
}

const API_URL = resolveApiBase();
const WS_URL = resolveWsBase(API_URL);

// ==========================================
// STATE
// ==========================================

let currentRoom = null;
let ws = null;
let wsReady = Promise.resolve();  // Promise который резолвится когда WS открыт
let currentUser = null;
let rooms = [];
let shouldRemoveAvatar = false;
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
        const response = await fetch(`${API_URL}/auth/refresh`, {
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
        const response = await fetchWithAuth(`${API_URL}/auth/me`);

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
        const response = await fetchWithAuth(`${API_URL}/rooms`);

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
        const response = await fetchWithAuth(`${API_URL}/rooms`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title })
        });

        if (!response.ok) {
            const error = await response.json();
            alert(error.detail || 'Failed to create room');
            return;
        }

        roomNameInput.value = '';
        closeModal();
        await loadRooms();
    } catch (err) {
        console.error('Failed to create room:', err);
        alert('Network error');
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

    // Load messages and connect WebSocket
    loadMessages(roomId);
    connectWebSocket(roomId);
}

// ==========================================
// MESSAGES FUNCTIONS
// ==========================================

async function loadMessages(roomId) {
    try {
        const response = await fetchWithAuth(`${API_URL}/rooms/${roomId}/messages`);

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
            messages.forEach(msg => addMessage(msg, false));
            scrollToBottom();
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

    const author = msg.user?.display_name || msg.author || 'Unknown';
    const username = msg.user?.username || 'unknown';
    const authorInitial = author[0].toUpperCase();
    const avatarUrl = normalizeAvatarUrl(msg.user?.avatar_url)

    const time = new Date(msg.created_at).toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit'
    });

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
            <div class="message-text">${escapeHtml(msg.body)}</div>
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
    if (animate) scrollToBottom();
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
            return new URL(webPath, API_URL).toString();
        } catch {
            return null;
        }
    }

    const normalizedPath = unixPath
        .replace(/^\.\//, '')
        .replace(/^uploads\//i, '/uploads/')
        .replace(/^avatars\//i, '/uploads/avatars/');

    try {
        return new URL(normalizedPath, API_URL).toString();
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
    if (!text || !currentRoom) return;

    const nonce = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

    // Очищаем input сразу — UX не должен зависеть от сети
    messageInput.value = '';

    try {
        // Ждём открытия WS (актуально при смене комнаты)
        await wsReady;

        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'message',
                body: text,
                nonce: nonce,
            }));
        } else {
            // WS недоступен — HTTP fallback
            console.warn('[sendMessage] WS not open, using HTTP fallback');
            const response = await fetchWithAuth(`${API_URL}/rooms/${currentRoom.id}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ body: text, nonce: nonce }),
            });

            if (!response.ok) throw new Error('Failed to send message');

            const msg = await response.json();
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

function connectWebSocket(roomId) {
    // Закрываем старый WS и ждём его закрытия перед открытием нового.
    // Без этого при быстрой смене комнат старый WS ещё не закрыт,
    // новый ещё не открыт — sendMessage теряет сообщения.
    const oldWs = ws;
    ws = null;
    wsReady = new Promise((resolve) => {
        const open = () => {
            const wsUrl = `${WS_URL}/ws/rooms/${roomId}`;
            const socket = new WebSocket(wsUrl);

            socket.onopen = () => {
                console.log(`[WS] Connected to room ${roomId}`);
                updateConnectionStatus('connected');
                ws = socket;
                resolve();
            };

            socket.onmessage = (event) => {
                // Игнорируем сообщения если этот сокет уже не текущий
                if (socket !== ws) return;

                try {
                    const data = JSON.parse(event.data);

                    if (data.type === 'message') {
                        // Не дублируем: сообщение могло уже прийти через HTTP fallback
                        if (!messagesList.querySelector(`[data-message-id="${data.id}"]`)) {
                            addMessage(data, true);
                        }
                    } else if (data.type === 'error') {
                        console.error('[WS] error:', data.detail);
                        if (data.code === 'unauthorized') redirectToLogin();
                    } else if (data.type === 'connected') {
                        console.log('[WS] ready, room:', data.room_id);
                    }
                } catch (err) {
                    console.error('[WS] parse error:', err, event.data);
                }
            };

            socket.onerror = (err) => {
                console.error('[WS] error:', err);
                updateConnectionStatus('disconnected');
            };

            socket.onclose = () => {
                if (socket === ws) {
                    console.log('[WS] disconnected');
                    updateConnectionStatus('disconnected');
                }
            };
        };

        if (oldWs && oldWs.readyState !== WebSocket.CLOSED) {
            // Ждём закрытия старого, потом открываем новый
            oldWs.onclose = () => open();
            oldWs.close();
        } else {
            open();
        }
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
        const response = await fetchWithAuth(`${API_URL}/auth/profile`, {
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

// ==========================================
// INITIALIZATION
// ==========================================

async function init() {
    await loadCurrentUser();
    await loadRooms();
}

init();
