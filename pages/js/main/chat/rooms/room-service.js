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
    const roomType = roomTypeInput?.value || 'text';
    if (!title) return;

    try {
        if (roomType === 'voice') {
            const response = await fetchWithAuth(`${getApiUrl()}/voice-rooms`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: title }),
            });
            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                alert(error.detail || 'Не удалось создать аудиокомнату');
                return;
            }
            const room = await response.json();
            roomNameInput.value = '';
            closeModal();
            await loadVoiceRooms();
            await joinVoiceRoom(room.id);
            startSpeakingDetector();
            return;
        }

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

    // Clear typing indicator when changing rooms
    typingUsers = {};
    updateTypingIndicator();

    // Сбрасываем состояние скролла перед загрузкой новых сообщений
    if (window.ScrollManager) {
        window.ScrollManager.reset();
    }

    // Load messages (WebSocket уже подключен глобально)
    loadMessages(roomId);

    // Start presence tracking для новой комнаты
    stopPresenceTracking();  // останавливаем старую
    startPresenceTracking(); // запускаем новую
}
