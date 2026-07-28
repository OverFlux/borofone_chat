// ==========================================
// DIRECT MESSAGES
// ==========================================

const novaDirectList = document.getElementById('novaDirectList');

function renderDirectConversations() {
    if (!novaDirectList) return;
    if (directConversations.length === 0) {
        novaDirectList.innerHTML = '<div class="nova-direct-empty">Диалогов пока нет</div>';
        return;
    }

    novaDirectList.innerHTML = directConversations.map((conversation) => {
        const initial = escapeHtml(
            (conversation.peer_display_name || conversation.peer_username || '?')
                .charAt(0)
                .toUpperCase(),
        );
        const active = currentConversation?.id === conversation.id;
        return `
            <button
                class="nova-direct-item${active ? ' active' : ''}"
                type="button"
                data-conversation-id="${conversation.id}"
                aria-pressed="${active}"
            >
                <span class="nova-direct-avatar">${initial}</span>
                <span class="nova-direct-copy">
                    <strong>${escapeHtml(conversation.peer_display_name)}</strong>
                    <span>@${escapeHtml(conversation.peer_username)}</span>
                </span>
            </button>
        `;
    }).join('');
}

async function loadDirectConversations() {
    try {
        const response = await fetchWithAuth(`${getApiUrl()}/direct-conversations`);
        if (!response.ok) throw new Error('Failed to load direct conversations');
        directConversations = await response.json();
        renderDirectConversations();
    } catch (error) {
        console.warn('[Direct] Failed to load conversations:', error);
        if (novaDirectList) {
            novaDirectList.innerHTML = '<div class="nova-direct-empty">Не удалось загрузить</div>';
        }
    }
}

function directMessageMarkup(message) {
    const isOwn = message.sender_id === currentUser?.id;
    const author = isOwn
        ? currentUser
        : {
            id: currentConversation.peer_id,
            username: currentConversation.peer_username,
            display_name: currentConversation.peer_display_name,
            avatar_url: currentConversation.peer_avatar_url,
        };
    const displayName = author?.display_name || author?.username || 'User';
    const initial = escapeHtml(displayName.charAt(0).toUpperCase() || '?');
    const time = new Date(message.created_at).toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
    });

    return `
        <div class="message nova-direct-message" data-direct-message-id="${message.id}">
            <div class="message-avatar-wrapper">
                <div class="message-avatar"><span>${initial}</span></div>
            </div>
            <div class="message-content">
                <div class="message-header">
                    <span class="message-author">${escapeHtml(displayName)}</span>
                    <span class="message-username">@${escapeHtml(author?.username || 'user')}</span>
                    <span class="message-time">${escapeHtml(time)}</span>
                </div>
                <div class="message-text">${escapeHtml(message.body)}</div>
            </div>
        </div>
    `;
}

async function loadDirectMessages() {
    if (!currentConversation) return;
    messagesList.innerHTML = '<div class="placeholder-message"><p>Загрузка диалога...</p></div>';

    const response = await fetchWithAuth(
        `${getApiUrl()}/direct-conversations/${currentConversation.id}/messages`,
    );
    if (!response.ok) {
        messagesList.innerHTML = '<div class="placeholder-message"><p>Не удалось загрузить диалог</p></div>';
        return;
    }

    const messages = await response.json();
    if (messages.length === 0) {
        messagesList.innerHTML = `
            <div class="placeholder-message nova-direct-welcome">
                <span class="nova-direct-avatar">${escapeHtml(currentConversation.peer_display_name.charAt(0).toUpperCase())}</span>
                <strong>${escapeHtml(currentConversation.peer_display_name)}</strong>
                <p>Начните личный разговор</p>
            </div>
        `;
        return;
    }

    messagesList.innerHTML = messages.map(directMessageMarkup).join('');
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

async function selectDirectConversation(conversationId) {
    const conversation = directConversations.find(
        (item) => item.id === Number(conversationId),
    );
    if (!conversation) return;

    currentConversation = conversation;
    currentRoom = null;
    document.querySelectorAll('.room-item').forEach((item) => item.classList.remove('active'));
    renderDirectConversations();

    roomName.textContent = `@${conversation.peer_username}`;
    messageInput.disabled = false;
    messageInput.placeholder = `Сообщение для @${conversation.peer_username}`;
    sendBtn.disabled = false;
    await loadDirectMessages();
}

async function sendDirectMessage() {
    if (!currentConversation) return;
    const body = messageInput.value.trim();
    if (!body) return;

    const nonce = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    messageInput.value = '';
    autoResizeMessageInput();

    try {
        const response = await fetchWithAuth(
            `${getApiUrl()}/direct-conversations/${currentConversation.id}/messages`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ body, nonce }),
            },
        );
        if (!response.ok) throw new Error('Failed to send direct message');
        const message = await response.json();
        const placeholder = messagesList.querySelector('.placeholder-message');
        if (placeholder) placeholder.remove();
        if (!messagesList.querySelector(`[data-direct-message-id="${message.id}"]`)) {
            messagesList.insertAdjacentHTML('beforeend', directMessageMarkup(message));
        }
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    } catch (error) {
        console.error('[Direct] Failed to send message:', error);
        messageInput.value = body;
        alert('Не удалось отправить личное сообщение');
    }
}

async function handleIncomingDirectMessage(message) {
    await loadDirectConversations();
    if (!currentConversation || message.conversation_id !== currentConversation.id) return;
    if (messagesList.querySelector(`[data-direct-message-id="${message.id}"]`)) return;

    const placeholder = messagesList.querySelector('.placeholder-message');
    if (placeholder) placeholder.remove();
    messagesList.insertAdjacentHTML('beforeend', directMessageMarkup(message));
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

novaDirectList?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-conversation-id]');
    if (!button) return;
    selectDirectConversation(Number(button.dataset.conversationId));
});
