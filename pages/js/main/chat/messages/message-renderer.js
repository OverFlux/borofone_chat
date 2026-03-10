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
            
            // Initialize audio players for loaded messages
            if (window.initAudioPlayers) {
                window.initAudioPlayers();
            }

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
    const safeMessageId = sanitizeMessageId(msg.id);
    const safeUserId = sanitizeNumericDataValue(msg.user?.id);
    messageEl.dataset.messageId = safeMessageId;
    messageEl.dataset.userId = safeUserId;

    // message-unread больше не нужен — оставляем только divider

    const author = msg.user?.display_name || msg.author || 'Unknown';
    const username = msg.user?.username || 'unknown';
    const authorInitial = author[0].toUpperCase();
    const avatarUrl = withAvatarCacheBuster(
        normalizeAvatarUrl(msg.user?.avatar_url),
        msg.user?.id
    )

    const time = new Date(msg.created_at).toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit'
    });

    // Рендерим вложения если есть
    const attachmentsHtml = window.attachments
        ? window.attachments.renderMessageAttachments(msg.attachments)
        : '';

    // Скрываем текст если пустой и есть вложения
    const isDeleted = Boolean(msg.is_deleted);
    messageEl.dataset.isDeleted = isDeleted ? '1' : '0';
    const bodyText = msg.body ? parseMarkdownWithEscaping(msg.body) : '';
    const bodyHtml = bodyText ? `<div class="message-text${isDeleted ? ' message-text--deleted' : ''}">${bodyText}</div>` : '';

    const reactionsHtml = renderReactions(msg.reactions || []);
    const reactionPickerHtml = safeMessageId ? renderReactionPicker(safeMessageId) : '';


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
            ${renderReplyPreview(msg.reply_to)}
            ${bodyHtml}
            ${attachmentsHtml}
            <div class="message-reactions" data-reactions-for="${safeMessageId}">${reactionsHtml}</div>
            <div class="message-hover-actions">
                <button class="message-plus-btn" data-open-reaction-picker="${safeMessageId}" type="button">${getRandomReactionTriggerEmoji()}</button>
                <button class="message-all-emoji-btn" data-open-all-emoji="${safeMessageId}" type="button">＋</button>
                <button class="message-reply-btn" data-hover-reply="${safeMessageId}" type="button"${isDeleted ? ' disabled' : ''}>↩</button>
                <div class="message-reaction-picker hidden" data-reaction-picker-for="${safeMessageId}">${reactionPickerHtml}</div>
            </div>
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
    
    // Initialize audio players for new message
    if (window.initAudioPlayers) {
        window.initAudioPlayers();
    }
    
    // Attach profile click handler to message avatar
    const userId = msg.user?.id || messageEl.dataset.userId;
    if (userId) {
        attachProfileClickHandlerToMessage(messageEl, parseInt(userId, 10));
    }
}



function renderContextQuickReactions() {
    const wrap = messageContextMenu.querySelector('[data-context-quick-reactions]');
    if (!wrap) return;
    wrap.innerHTML = REACTION_EMOJIS.map((emoji) => `
        <button type="button" class="context-emoji-btn" data-context-emoji="${escapeHtml(emoji)}">${escapeHtml(emoji)}</button>
    `).join('');
}

function renderContextAllEmojiMenu() {
    messageContextEmojiMenu.innerHTML = `
        <div class="context-emoji-list">
            ${ALL_EMOJI_OPTIONS.map((item) => `
                <button type="button" class="context-emoji-list-item" data-context-emoji="${escapeHtml(item.emoji)}">
                    <span>${escapeHtml(item.key)}</span><span>${escapeHtml(item.emoji)}</span>
                </button>
            `).join('')}
        </div>
        <button type="button" class="context-emoji-more" data-context-action="emoji-more">Показать больше</button>
    `;
}

function getRandomReactionTriggerEmoji() {
    const index = Math.floor(Math.random() * REACTION_TRIGGER_EMOJIS.length);
    return REACTION_TRIGGER_EMOJIS[index];
}

function renderReactions(reactions) {
    if (!reactions || reactions.length === 0) return '';
    return reactions.map((reaction) => `
        <button class="reaction-chip ${reaction.reacted_by_me ? 'active' : ''}" data-emoji="${escapeHtml(reaction.emoji)}" type="button">
            <span>${escapeHtml(reaction.emoji)}</span>
            <span>${escapeHtml(String(reaction.count))}</span>
        </button>
    `).join('');
}

function renderReactionPicker(messageId) {
    const safeMessageId = sanitizeMessageId(messageId);
    if (!safeMessageId) return '';

    const popular = REACTION_EMOJIS.map((emoji) => `
        <button class="reaction-add-btn" data-add-reaction="${escapeHtml(emoji)}" data-message-id="${safeMessageId}" type="button">${escapeHtml(emoji)}</button>
    `).join('');
    return `${popular}<button class="reaction-add-btn reaction-add-btn--all" data-open-all-emoji="${safeMessageId}" type="button">+</button>`;
}

function renderReplyPreview(replyTo) {
    if (!replyTo) return '';

    const safeReplyId = sanitizeMessageId(replyTo.id);
    if (!safeReplyId) return '';

    const user = replyTo.user?.display_name || replyTo.user?.username || 'Unknown';
    const body = (replyTo.body || '').trim();
    const shortBody = body.length > 120 ? `${body.slice(0, 120)}...` : body;
    return `<button class="message-reply" data-jump-to-message="${safeReplyId}" type="button">&#8617; <strong>${escapeHtml(user)}</strong>: ${parseMarkdownWithEscaping(shortBody || '[attachment]')}</button>`;
}

function jumpToMessage(messageId) {
    const safeMessageId = sanitizeMessageId(messageId);
    if (!safeMessageId) return;

    const target = messagesList.querySelector(`[data-message-id="${safeMessageId}"]`);
    if (!target) return;

    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('message-jump-highlight');
    setTimeout(() => target.classList.remove('message-jump-highlight'), 1400);
}

function setReplyTarget(messageEl) {
    if (!messageEl) return;
    if (messageEl.dataset.isDeleted === '1') return;

    const safeMessageId = sanitizeMessageId(messageEl.dataset.messageId);
    if (!safeMessageId) return;

    const author = messageEl.querySelector('.message-author')?.textContent || 'Unknown';
    const text = messageEl.querySelector('.message-text')?.textContent || '[attachment]';
    replyToMessage = { id: Number(safeMessageId), author, body: text };
    const shortText = text.length > 120 ? `${text.slice(0, 120)}...` : text;
    replyPreview.querySelector('.reply-preview-content').textContent = `Reply ${author}: ${shortText}`;
    replyPreview.classList.remove('hidden');
}

function clearReplyTarget() {
    replyToMessage = null;
    replyPreview.classList.add('hidden');
}

function openReactionPicker(messageId) {
    closeReactionPicker();
    const picker = messagesList.querySelector(`[data-reaction-picker-for="${messageId}"]`);
    if (!picker) return;
    picker.classList.remove('hidden');
    activeReactionPickerFor = Number(messageId);
}

function closeReactionPicker() {
    if (!activeReactionPickerFor) return;
    const picker = messagesList.querySelector(`[data-reaction-picker-for="${activeReactionPickerFor}"]`);
    if (picker) picker.classList.add('hidden');
    activeReactionPickerFor = null;
}

function sanitizeMessageId(value) {
    const numericId = Number(value);
    if (!Number.isSafeInteger(numericId) || numericId <= 0) return '';
    return String(numericId);
}

function sanitizeNumericDataValue(value) {
    const numericValue = Number(value);
    if (!Number.isSafeInteger(numericValue) || numericValue < 0) return '0';
    return String(numericValue);
}
