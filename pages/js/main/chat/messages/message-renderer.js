// ==========================================
// MESSAGES FUNCTIONS
// ==========================================

/**
 * Escape HTML attribute value (for use in src, href, etc.)
 * This prevents XSS in URL attributes by validating the URL scheme
 * @param {string} url - The URL to escape
 * @returns {string} Safely escaped URL or empty string
 */
function escapeHtmlAttr(url) {
    if (!url || typeof url !== 'string') return '';
    const trimmedUrl = url.trim();
    const lowerUrl = trimmedUrl.toLowerCase();
    
    // Block dangerous protocols
    if (lowerUrl.startsWith('javascript:') ||
        lowerUrl.startsWith('vbscript:') ||
        lowerUrl.startsWith('data:text/html') ||
        lowerUrl.startsWith('data:text/javascript') ||
        lowerUrl.startsWith('data:application/')) {
        return '';
    }
    
    // For data: URLs, only allow images
    if (lowerUrl.startsWith('data:') && !lowerUrl.match(/^data:image\//)) {
        return '';
    }
    
    // Only allow http, https, data:image, or relative URLs
    if (!lowerUrl.startsWith('http://') && 
        !lowerUrl.startsWith('https://') && 
        !lowerUrl.startsWith('data:image/') &&
        !trimmedUrl.startsWith('/') &&
        !trimmedUrl.startsWith('./') &&
        !trimmedUrl.startsWith('../') &&
        !trimmedUrl.startsWith('#')) {
        return escapeHtml(trimmedUrl);
    }
    
    return escapeHtml(trimmedUrl);
}

/**
 * Generate admin crown HTML for user avatars
 * @param {string} role - User role ('admin', 'moderator', etc.)
 * @returns {string} HTML string for crown or empty string
 */
function getAdminCrownHtml(role) {
    if (role !== 'admin') return '';
    
    // Crown SVG with gold gradient
    const crownSvg = `
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-label="Администратор" role="img">
            <defs>
                <linearGradient id="goldGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" style="stop-color:#FFD700"/>
                    <stop offset="50%" style="stop-color:#FFC107"/>
                    <stop offset="100%" style="stop-color:#B8860B"/>
                </linearGradient>
            </defs>
            <path d="M2 19L4 7L7 10L12 4L17 10L20 7L22 19H2Z" fill="url(#goldGradient)" stroke="#B8860B" stroke-width="1.5" stroke-linejoin="round"/>
            <circle cx="4" cy="7" r="1.5" fill="#FFD700" stroke="#B8860B" stroke-width="0.5"/>
            <circle cx="12" cy="4" r="1.5" fill="#FFD700" stroke="#B8860B" stroke-width="0.5"/>
            <circle cx="20" cy="7" r="1.5" fill="#FFD700" stroke="#B8860B" stroke-width="0.5"/>
        </svg>`;
    
    return `<span class="admin-crown" aria-label="Администратор" role="img">${crownSvg}</span>`;
}

async function loadMessages(roomId) {
    try {
        const response = await fetchWithAuth(`${getApiUrl()}/rooms/${roomId}/messages`);

        if (!response.ok) {
            throw new Error('Failed to load messages');
        }

        const messages = await response.json();

        messagesList.innerHTML = '';
        
        // Сбрасываем состояние скролл менеджера
        if (window.ScrollManager) {
            window.ScrollManager.reset();
        }

        if (messages.length === 0) {
            messagesList.innerHTML = `
                <div class="placeholder-message">
                    <span class="placeholder-icon">💬</span>
                    <p>Нет сообщений. Напишите первым!</p>
                </div>
            `;
            // Скроллим к низу если нет сообщений
            if (window.ScrollManager) {
                window.ScrollManager.scrollOnRoomChange();
            }
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
            if (window.ScrollManager) {
                window.ScrollManager.scrollOnPageLoad();
            } else {
                scrollToBottomInitial();
            }
            
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

function addMessage(msg, animate = false, isOwnMessage = false) {
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
    // Безопасно вычисляем и экранируем инициал автора
    let rawInitial = '';
    if (typeof author === 'string' && author.length > 0) {
        rawInitial = author[0].toUpperCase();
    }
    const authorInitial = escapeHtml(rawInitial || 'U');
    const avatarUrl = withAvatarCacheBuster(
        normalizeAvatarUrl(msg.user?.avatar_url),
        msg.user?.id
    );
    const userRole = msg.user?.role || null;
    const adminCrownHtml = getAdminCrownHtml(userRole);

    const time = new Date(msg.created_at).toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit'
    });

    // Edited label
    const editedLabel = msg.edited_at ? '<span class="message-edited-label">edited</span>' : '';

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
        <div class="message-avatar-wrapper">
            ${adminCrownHtml}
            <div class="message-avatar">
                ${avatarUrl
                    ? `<img src="${escapeHtmlAttr(avatarUrl)}" alt="${escapeHtml(author)}" class="avatar-media avatar-media--message">`
                    : `<span>${authorInitial}</span>`}
            </div>
        </div>
        <div class="message-content">
            <div class="message-header">
                <span class="message-author">${escapeHtml(author)}</span>
                <span class="message-username">@${escapeHtml(username)}</span>
                <span class="message-time">${time}</span>
                ${editedLabel}
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
            const avatarWrapper = messageEl.querySelector('.message-avatar-wrapper');
            if (avatarWrapper) {
                avatarWrapper.innerHTML = `${adminCrownHtml}<div class="message-avatar"><span>${authorInitial}</span></div>`;
            }
        }, { once: true });
    }

    messagesList.appendChild(messageEl);
    
    // Используем ScrollManager для управления скроллом
    if (animate && window.ScrollManager) {
        const hasAttachments = msg.attachments && msg.attachments.length > 0;
        if (hasAttachments) {
            window.ScrollManager.scrollOnNewAttachment(msg, isOwnMessage);
        } else {
            window.ScrollManager.scrollOnNewMessage(msg, isOwnMessage);
        }
    }
    
    // Fallback на старый метод если ScrollManager недоступен
    if (animate && !window.ScrollManager) {
        scrollToBottomWithImages();
    }
    
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

// ==========================================
// MESSAGE EDITING FUNCTIONS
// ==========================================

let editingMessageId = null;

function startMessageEdit(messageId, messageEl) {
    if (editingMessageId !== null) {
        // Cancel any current edit
        cancelMessageEdit();
    }

    const messageText = messageEl.querySelector('.message-text');
    if (!messageText) return;

    const currentText = messageText.textContent || '';
    editingMessageId = messageId;

    // Create edit input container
    const editContainer = document.createElement('div');
    editContainer.className = 'message-edit-container';
    editContainer.innerHTML = `
        <textarea class="message-edit-textarea" rows="2">${escapeHtml(currentText)}</textarea>
        <div class="message-edit-actions">
            <button type="button" class="message-edit-save">Сохранить</button>
            <button type="button" class="message-edit-cancel">Отмена</button>
        </div>
    `;

    // Replace message text with edit container
    messageText.style.display = 'none';
    messageText.parentNode.insertBefore(editContainer, messageText);

    const textarea = editContainer.querySelector('.message-edit-textarea');
    const saveBtn = editContainer.querySelector('.message-edit-save');
    const cancelBtn = editContainer.querySelector('.message-edit-cancel');

    // Focus and select all text
    textarea.focus();
    textarea.setSelectionRange(0, textarea.value.length);

    // Auto-resize textarea
    const autoResize = () => {
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
    };
    autoResize();
    textarea.addEventListener('input', autoResize);

    // Save handler
    saveBtn.addEventListener('click', async () => {
        const newText = textarea.value.trim();
        if (newText !== currentText) {
            await saveMessageEdit(messageId, newText, messageEl, editContainer, messageText);
        } else {
            cancelMessageEdit(editContainer, messageText);
        }
    });

    // Cancel handler
    cancelBtn.addEventListener('click', () => {
        cancelMessageEdit(editContainer, messageText);
    });

    // Keyboard shortcuts
    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            saveBtn.click();
        }
        if (e.key === 'Escape') {
            cancelBtn.click();
        }
    });

    // Store original elements for cancel
    editContainer._originalText = messageText;
    messageEl._editContainer = editContainer;
}

function cancelMessageEdit(editContainer, messageText) {
    if (!editContainer || !messageText) {
        // Find from editing message
        const messageEl = messagesList.querySelector(`[data-message-id="${editingMessageId}"]`);
        if (messageEl) {
            editContainer = messageEl._editContainer;
            messageText = messageEl.querySelector('.message-text');
        }
    }

    if (editContainer && messageText) {
        messageText.style.display = '';
        editContainer.remove();
    }

    editingMessageId = null;
}

async function saveMessageEdit(messageId, newText, messageEl, editContainer, messageText) {
    if (!currentRoom || !messageId) return;

    try {
        const response = await fetchWithAuth(
            `${getApiUrl()}/rooms/${currentRoom.id}/messages/${messageId}`,
            {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ body: newText })
            }
        );

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to edit message');
        }

        const updatedMessage = await response.json();

        // Update message in UI
        messageText.style.display = '';
        messageText.innerHTML = parseMarkdownWithEscaping(newText);
        editContainer.remove();

        // Add or update edited label
        updateEditedLabel(messageEl, updatedMessage.edited_at);

    } catch (err) {
        console.error('Failed to edit message:', err);
        alert('Не удалось изменить сообщение: ' + err.message);
        // Restore original text display
        messageText.style.display = '';
        editContainer.remove();
    }

    editingMessageId = null;
}

function updateEditedLabel(messageEl, editedAt) {
    if (!messageEl) return;

    const header = messageEl.querySelector('.message-header');
    if (!header) return;

    let editedLabel = header.querySelector('.message-edited-label');

    if (editedAt) {
        if (!editedLabel) {
            editedLabel = document.createElement('span');
            editedLabel.className = 'message-edited-label';
            editedLabel.textContent = 'edited';
            header.appendChild(editedLabel);
        }
    } else if (editedLabel) {
        editedLabel.remove();
    }
}

function updateMessageContent(messageId, newBody, editedAt) {
    console.log('[MessageRenderer] Updating message content:', messageId, newBody, editedAt);
    // Convert messageId to string for DOM attribute matching
    const messageIdStr = String(messageId);
    const messageEl = messagesList.querySelector(`[data-message-id="${messageIdStr}"]`);
    if (!messageEl) {
        console.log('[MessageRenderer] Message element not found for id:', messageId);
        return;
    }

    const messageText = messageEl.querySelector('.message-text');
    if (messageText) {
        messageText.innerHTML = parseMarkdownWithEscaping(newBody);
    } else {
        console.warn('[MessageRenderer] Message text element not found');
    }

    updateEditedLabel(messageEl, editedAt);
}
