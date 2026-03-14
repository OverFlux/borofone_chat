// ==========================================
// Emoji Modal (Custom Prompt Replacement)
// ==========================================

class EmojiModal {
    constructor() {
        this.messageId = null;
        this.isOpen = false;
        this.overlay = null;
        this.input = null;
        this.preview = null;
        this.confirmBtn = null;
        this.errorEl = null;
        this._boundKeydown = this._handleKeydown.bind(this);
        this._boundOutsideClick = null;
    }

    open(messageId, triggerElement = null) {
        // If already open, wait for close to finish before reopening
        if (this.isOpen && this.overlay) {
            this.overlay.classList.add('closing');
            const modal = this.overlay.querySelector('.emoji-modal');
            if (modal) modal.classList.add('closing');
            this._detachEvents();
            this.overlay.remove();
            this.overlay = null;
            this.isOpen = false;
        }
        this.messageId = messageId;
        this.isOpen = true;
        this._render(triggerElement);
        this._attachEvents();
        requestAnimationFrame(() => {
            this.input?.focus();
        });
    }

    close() {
        if (!this.isOpen || !this.overlay) return;
        this._detachEvents();
        this.overlay.classList.add('closing');
        const modal = this.overlay.querySelector('.emoji-modal');
        if (modal) modal.classList.add('closing');
        setTimeout(() => {
            this.overlay?.remove();
            this.overlay = null;
            this.isOpen = false;
            this.messageId = null;
        }, 200);
    }

    validate(value) {
        const trimmed = value.trim();
        if (!trimmed) return { valid: false, error: 'Введите emoji или текст' };
        if (trimmed.length > 32) return { valid: false, error: 'Максимум 32 символа' };
        return { valid: true };
    }

    _updatePreview() {
        const value = this.input?.value || '';
        if (this.preview) {
            const emojiMatch = value.match(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu);
            if (emojiMatch) {
                this.preview.textContent = emojiMatch[0];
                this.preview.style.display = 'block';
            } else if (value.trim()) {
                this.preview.textContent = value.trim()[0];
                this.preview.style.display = 'block';
            } else {
                this.preview.style.display = 'none';
            }
        }
        const validation = this.validate(value);
        if (this.errorEl && this.confirmBtn) {
            if (validation.valid) {
                this.errorEl.classList.remove('visible');
                this.confirmBtn.disabled = false;
            } else {
                this.errorEl.textContent = validation.error;
                this.confirmBtn.disabled = true;
            }
        }
    }

    _handleConfirm() {
        const value = this.input?.value?.trim();
        const validation = this.validate(value);
        if (!validation.valid) {
            this.errorEl.textContent = validation.error;
            this.errorEl.classList.add('visible');
            return;
        }
        this.close();
        if (typeof toggleReaction === 'function') {
            toggleReaction(this.messageId, value);
        }
        if (typeof closeReactionPicker === 'function') {
            closeReactionPicker();
        }
    }

    _handleCancel() {
        this.close();
    }

    _handleKeydown(e) {
        if (!this.isOpen) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            this.close();
        } else if (e.key === 'Enter' && !this.confirmBtn?.disabled) {
            e.preventDefault();
            this._handleConfirm();
        }
    }

    _handleBackdropClick(e) {
        if (e.target === this.overlay) {
            this.close();
        }
    }

    _handleOutsideClick(e) {
        if (this.overlay && !this.overlay.contains(e.target) && this.isOpen) {
            this.close();
        }
    }

    _attachEvents() {
        document.addEventListener('keydown', this._boundKeydown);
        // Close on click outside
        setTimeout(() => {
            this._boundOutsideClick = this._handleOutsideClick.bind(this);
            document.addEventListener('click', this._boundOutsideClick);
        }, 0);
    }

    _detachEvents() {
        document.removeEventListener('keydown', this._boundKeydown);
        if (this._boundOutsideClick) {
            document.removeEventListener('click', this._boundOutsideClick);
            this._boundOutsideClick = null;
        }
    }

    _calculatePosition(triggerElement) {
        const modalWidth = 280;
        const modalHeight = 220;
        const padding = 8;

        let left = 0;
        let top = 0;

        if (triggerElement) {
            const rect = triggerElement.getBoundingClientRect();
            // Position below the button (like a dropdown)
            left = rect.left;
            top = rect.bottom + padding;

            // Adjust if goes off right edge
            if (left + modalWidth > window.innerWidth - padding) {
                left = window.innerWidth - modalWidth - padding;
            }
            // Adjust if goes off left edge
            if (left < padding) {
                left = padding;
            }
            // If not enough space below, show above
            if (top + modalHeight > window.innerHeight - padding) {
                top = rect.top - modalHeight - padding;
            }
            // Ensure doesn't go above viewport
            if (top < padding) {
                top = padding;
            }
        } else {
            // Default center position
            left = (window.innerWidth - modalWidth) / 2;
            top = (window.innerHeight - modalHeight) / 2;
        }

        return { left, top };
    }

    _render(triggerElement = null) {
        const html = `
            <div class="emoji-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="emoji-modal-title" aria-describedby="emoji-modal-desc">
                <div class="emoji-modal" role="document">
                    <div class="emoji-modal__header">
                        <h2 class="emoji-modal__title" id="emoji-modal-title">Добавить реакцию</h2>
                        <button class="emoji-modal__close" type="button" aria-label="Закрыть" data-close>
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/>
                            </svg>
                        </button>
                    </div>
                    <div class="emoji-modal__body">
                        <p id="emoji-modal-desc" class="visually-hidden"></p>
                        <div class="emoji-modal__input-wrapper">
                            <input type="text" class="emoji-modal__input" id="emoji-modal-input" placeholder="Введите текст..." autocomplete="off" spellcheck="false" maxlength="32">
                            <span class="emoji-modal__preview" aria-hidden="true"></span>
                        </div>
                        <div class="emoji-modal__error" role="alert"></div>
                    </div>
                    <div class="emoji-modal__actions">
                        <button class="emoji-modal__btn emoji-modal__btn--cancel" type="button" data-cancel>Отмена</button>
                        <button class="emoji-modal__btn emoji-modal__btn--confirm" type="button" data-confirm disabled>Добавить</button>
                    </div>
                </div>
            </div>
        `;
        const container = document.createElement('div');
        container.innerHTML = html;
        document.body.appendChild(container.firstElementChild);
        this.overlay = document.querySelector('.emoji-modal-overlay');
        
        // Calculate position
        const pos = this._calculatePosition(triggerElement);
        this.overlay.style.left = pos.left + 'px';
        this.overlay.style.top = pos.top + 'px';

        this.input = document.getElementById('emoji-modal-input');
        this.preview = this.overlay.querySelector('.emoji-modal__preview');
        this.confirmBtn = this.overlay.querySelector('[data-confirm]');
        this.errorEl = this.overlay.querySelector('.emoji-modal__error');
        this.input?.addEventListener('input', () => this._updatePreview());
        this.overlay.querySelector('[data-close]')?.addEventListener('click', () => this.close());
        this.overlay.querySelector('[data-cancel]')?.addEventListener('click', () => this.close());
        this.confirmBtn?.addEventListener('click', () => this._handleConfirm());
        this.overlay?.addEventListener('click', (e) => this._handleBackdropClick(e));
    }
}

const emojiModal = new EmojiModal();

function openAllEmojiPrompt(messageId, triggerElement = null) {
    emojiModal.open(messageId, triggerElement);
}

function openMessageContextMenu(event, messageEl) {
    event.preventDefault();
    if (!messageEl) return;

    const messageUserId = Number(messageEl.dataset.userId || 0);
    const isDeletedMessage = messageEl.dataset.isDeleted === '1';
    const isOwnMessage = Number(messageUserId) === Number(currentUser?.id);
    const deleteBtn = messageContextMenu.querySelector('[data-context-action="delete"]');
    const hardDeleteBtn = messageContextMenu.querySelector('[data-context-action="delete_hard"]');
    const reactBtn = messageContextMenu.querySelector('[data-context-action="react"]');
    const replyBtn = messageContextMenu.querySelector('[data-context-action="reply"]');
    const editBtn = messageContextMenu.querySelector('[data-context-action="edit"]');
    const quickReactions = messageContextMenu.querySelector('[data-context-quick-reactions]');

    if (deleteBtn) {
        deleteBtn.classList.toggle('hidden', !isOwnMessage);
    }
    if (hardDeleteBtn) {
        hardDeleteBtn.classList.toggle('hidden', currentUser?.role !== 'admin');
    }
    if (editBtn) {
        // Show edit button only for own non-deleted messages
        editBtn.classList.toggle('hidden', !isOwnMessage || isDeletedMessage);
    }
    if (reactBtn) {
        reactBtn.classList.toggle('hidden', isDeletedMessage);
    }
    if (replyBtn) {
        replyBtn.classList.toggle('hidden', isDeletedMessage);
    }
    if (quickReactions) {
        quickReactions.classList.toggle('hidden', isDeletedMessage);
    }

    if (!isDeletedMessage) {
        renderContextQuickReactions();
        renderContextAllEmojiMenu();
    } else {
        messageContextEmojiMenu.classList.add('hidden');
    }

    messageContextMenu.dataset.messageId = messageEl.dataset.messageId;

    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

    messageContextMenu.classList.remove('hidden');
    messageContextMenu.style.left = '0px';
    messageContextMenu.style.top = '0px';

    const menuRect = messageContextMenu.getBoundingClientRect();
    let menuX = event.clientX;
    let menuY = event.clientY;

    if (menuX + menuRect.width > viewportWidth) {
        menuX = Math.max(0, viewportWidth - menuRect.width);
    }
    if (menuY + menuRect.height > viewportHeight) {
        menuY = Math.max(0, viewportHeight - menuRect.height);
    }

    messageContextMenu.style.left = `${menuX}px`;
    messageContextMenu.style.top = `${menuY}px`;

    const emojiOffsetX = 270;
    const wasEmojiHidden = messageContextEmojiMenu.classList.contains('hidden');
    const prevEmojiVisibility = messageContextEmojiMenu.style.visibility;

    messageContextEmojiMenu.style.visibility = 'hidden';
    messageContextEmojiMenu.classList.remove('hidden');
    messageContextEmojiMenu.style.left = '0px';
    messageContextEmojiMenu.style.top = '0px';

    const emojiRect = messageContextEmojiMenu.getBoundingClientRect();
    let emojiX = menuX + emojiOffsetX;
    let emojiY = menuY;

    if (emojiX + emojiRect.width > viewportWidth) {
        emojiX = Math.max(0, menuX - emojiRect.width);
    }
    if (emojiY + emojiRect.height > viewportHeight) {
        emojiY = Math.max(0, viewportHeight - emojiRect.height);
    }

    messageContextEmojiMenu.style.left = `${emojiX}px`;
    messageContextEmojiMenu.style.top = `${emojiY}px`;

    if (wasEmojiHidden) {
        messageContextEmojiMenu.classList.add('hidden');
    }
    messageContextEmojiMenu.style.visibility = prevEmojiVisibility;
}

function closeMessageContextMenu() {
    messageContextMenu.classList.add('hidden');
    messageContextEmojiMenu.classList.add('hidden');
}

async function deleteMessage(messageId) {
    if (!currentRoom || !messageId) return;

    try {
        const response = await fetchWithAuth(`${getApiUrl()}/rooms/${currentRoom.id}/messages/${messageId}`, { method: 'DELETE' });
        if (!response.ok) {
            throw new Error('Failed to delete message');
        }

        const data = await response.json();
        applyDeletedMessage(data.message_id, data.body || 'Сообщение удалено');
    } catch (err) {
        console.error('[delete] failed', err);

        // Fallback to WS if HTTP unavailable
        try {
            await wsReady;
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'message_delete',
                    room_id: currentRoom.id,
                    message_id: Number(messageId),
                }));
            }
        } catch (wsErr) {
            console.error('[delete] ws fallback failed', wsErr);
        }
    }
}

async function hardDeleteMessage(messageId) {
    if (!currentRoom || !messageId) return;
    
    // Double check admin
    if (currentUser?.role !== 'admin') {
        console.error('[hard_delete] admin access required');
        return;
    }

    try {
        const response = await fetchWithAuth(`${getApiUrl()}/rooms/${currentRoom.id}/messages/${messageId}/hard`, { method: 'DELETE' });
        if (!response.ok) {
            throw new Error('Failed to hard delete message');
        }

        const data = await response.json();
        // Remove message from DOM completely
        const messageEl = messagesList.querySelector(`[data-message-id="${messageId}"]`);
        if (messageEl) {
            messageEl.remove();
        }
    } catch (err) {
        console.error('[hard_delete] failed', err);

        // Fallback to WS if HTTP unavailable
        try {
            await wsReady;
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'message_hard_delete',
                    room_id: currentRoom.id,
                    message_id: Number(messageId),
                }));
            }
        } catch (wsErr) {
            console.error('[hard_delete] ws fallback failed', wsErr);
        }
    }
}

function applyDeletedMessage(messageId, body = 'Сообщение удалено') {
    const messageEl = messagesList.querySelector(`[data-message-id="${messageId}"]`);
    if (!messageEl) return;

    const textEl = messageEl.querySelector('.message-text');
    if (textEl) {
        textEl.textContent = body;
        textEl.classList.add('message-text--deleted');
    } else {
        const content = messageEl.querySelector('.message-content');
        if (content) {
            const node = document.createElement('div');
            node.className = 'message-text message-text--deleted';
            node.textContent = body;
            content.appendChild(node);
        }
    }

    messageEl.dataset.isDeleted = '1';

    const hoverActions = messageEl.querySelector('.message-hover-actions');
    if (hoverActions) {
        hoverActions.classList.add('hidden');
    }

    const replyBtn = messageEl.querySelector('.message-reply-btn');
    if (replyBtn) {
        replyBtn.setAttribute('disabled', 'disabled');
    }
}

async function toggleReaction(messageId, emoji) {
    if (!currentRoom || !messageId || !emoji) return;

    try {
        const response = await fetchWithAuth(`${getApiUrl()}/rooms/${currentRoom.id}/messages/${messageId}/reactions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ emoji }),
        });

        if (!response.ok) {
            throw new Error('Failed to toggle reaction');
        }

        const data = await response.json();
        applyReactionUpdate(data.message_id, data.reactions || [], data.actor_user_id, data.action, data.emoji);
    } catch (err) {
        console.error('[reaction] toggle failed', err);

        // Fallback to WS if HTTP unavailable
        try {
            await wsReady;
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'reaction',
                    room_id: currentRoom.id,
                    message_id: Number(messageId),
                    emoji,
                }));
            }
        } catch (wsErr) {
            console.error('[reaction] ws fallback failed', wsErr);
        }
    }
}

function applyReactionUpdate(messageId, reactions, actorUserId = null, action = null, actionEmoji = null) {
    const container = messagesList.querySelector(`[data-reactions-for="${messageId}"]`);
    if (!container) return;

    const previousOrder = Array.from(container.querySelectorAll('.reaction-chip')).map((el) => el.dataset.emoji);
    const previousMyState = Object.create(null);
    for (const chip of container.querySelectorAll('.reaction-chip')) {
        const emoji = chip.dataset.emoji;
        if (!isSafeReactionKey(emoji)) continue;
        previousMyState[emoji] = chip.classList.contains('active');
    }

    const incoming = reactions || [];
    const byEmoji = Object.create(null);
    for (const reaction of incoming) {
        const emoji = reaction?.emoji;
        if (!isSafeReactionKey(emoji)) continue;
        byEmoji[emoji] = { ...reaction };
    }

    for (const reaction of incoming) {
        const emoji = reaction.emoji;
        if (!isSafeReactionKey(emoji) || !byEmoji[emoji]) continue;

        let reactedByMe = previousMyState[emoji] || false;
        if (Number(actorUserId) === Number(currentUser?.id) && emoji === actionEmoji) {
            reactedByMe = action === 'added';
        }

        byEmoji[emoji].reacted_by_me = reactedByMe;
    }

    const ordered = [];
    const seen = new Set();
    for (const emoji of previousOrder) {
        if (isSafeReactionKey(emoji) && byEmoji[emoji]) {
            ordered.push(byEmoji[emoji]);
            seen.add(emoji);
        }
    }
    for (const reaction of incoming) {
        const emoji = reaction.emoji;
        if (!isSafeReactionKey(emoji) || seen.has(emoji) || !byEmoji[emoji]) continue;
        ordered.push(byEmoji[emoji]);
        seen.add(emoji);
    }

    container.innerHTML = renderReactions(ordered);
    
    // Trigger animation if reaction was added by current user
    if (action === 'added' && Number(actorUserId) === Number(currentUser?.id) && actionEmoji) {
        // Small delay to let the DOM update first
        requestAnimationFrame(() => {
            triggerReactionAnimation(messageId, actionEmoji);
        });
    }
}

function isSafeReactionKey(value) {
    return Boolean(value) && value !== '__proto__' && value !== 'constructor' && value !== 'prototype';
}

// ==========================================
// Reaction Animation (Telegram-style)
// ==========================================

// Rate limiting: track last animation time per message
const reactionAnimationCooldowns = new Map();
const REACTION_ANIMATION_COOLDOWN_MS = 2000; // 2 seconds cooldown

function triggerReactionAnimation(messageId, emoji, triggerElement = null) {
    if (!messageId || !emoji) return;
    
    // Check cooldown - prevent animation spam
    const lastAnimationTime = reactionAnimationCooldowns.get(messageId);
    const now = Date.now();
    if (lastAnimationTime && (now - lastAnimationTime) < REACTION_ANIMATION_COOLDOWN_MS) {
        return; // Still in cooldown, skip animation
    }
    
    // Update cooldown
    reactionAnimationCooldowns.set(messageId, now);
    
    // Clean up old entries to prevent memory leak
    if (reactionAnimationCooldowns.size > 100) {
        const entries = Array.from(reactionAnimationCooldowns.entries());
        const cutoffTime = now - REACTION_ANIMATION_COOLDOWN_MS * 2;
        for (const [key, time] of entries) {
            if (time < cutoffTime) {
                reactionAnimationCooldowns.delete(key);
            }
        }
    }
    
    // Find the reaction chip that was just added/updated
    const container = messagesList.querySelector(`[data-reactions-for="${messageId}"]`);
    if (!container) return;
    
    // Find the specific reaction chip for this emoji
    const reactionChip = container.querySelector(`[data-emoji="${CSS.escape(emoji)}"]`);
    
    let startX, startY;
    
    if (reactionChip) {
        // Get position from the reaction chip
        const rect = reactionChip.getBoundingClientRect();
        startX = rect.left + rect.width / 2;
        startY = rect.top + rect.height / 2;
    } else if (triggerElement) {
        // Use the trigger element position
        const rect = triggerElement.getBoundingClientRect();
        startX = rect.left + rect.width / 2;
        startY = rect.top + rect.height / 2;
    } else {
        // Fallback to center of the message
        const messageEl = messagesList.querySelector(`[data-message-id="${messageId}"]`);
        if (!messageEl) return;
        const rect = messageEl.getBoundingClientRect();
        startX = rect.right - 50;
        startY = rect.top + rect.height / 2;
    }
    
    // Create flying emoji - clean and simple
    createFlyingEmoji(emoji, startX, startY);
    
    // Second smaller flying emoji
    setTimeout(() => {
        createFlyingEmoji(emoji, startX - 20, startY + 8, true);
    }, 80);
    
    // Third tiny flying emoji
    setTimeout(() => {
        createFlyingEmoji(emoji, startX + 25, startY - 8, 'tiny');
    }, 160);
    
    // Fourth extra small flying emoji
    setTimeout(() => {
        createFlyingEmoji(emoji, startX - 15, startY + 15, 'tiny');
    }, 240);
    
    // Create burst effect with mini emojis
    createBurstEffect(emoji, startX, startY);
}

function createFlyingEmoji(emoji, x, y, small = false) {
    const el = document.createElement('div');
    el.className = 'reaction-fly-emoji' + (small ? ' reaction-fly-emoji--small' : '');
    el.textContent = emoji;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    
    document.body.appendChild(el);
    
    // Remove after animation completes
    el.addEventListener('animationend', () => {
        el.remove();
    });
}

function createBurstEffect(emoji, x, y) {
    // Create a clean circular burst of mini emojis
    const miniEmojis = [
        // Inner ring - 6 emojis
        { angle: 0, distance: 25, delay: 0, size: 'normal' },
        { angle: 60, distance: 25, delay: 15, size: 'normal' },
        { angle: 120, distance: 25, delay: 30, size: 'normal' },
        { angle: 180, distance: 25, delay: 45, size: 'normal' },
        { angle: 240, distance: 25, delay: 60, size: 'normal' },
        { angle: 300, distance: 25, delay: 75, size: 'normal' },
        // Middle ring - 6 emojis
        { angle: 30, distance: 40, delay: 20, size: 'normal' },
        { angle: 90, distance: 40, delay: 35, size: 'normal' },
        { angle: 150, distance: 40, delay: 50, size: 'normal' },
        { angle: 210, distance: 40, delay: 65, size: 'normal' },
        { angle: 270, distance: 40, delay: 80, size: 'normal' },
        { angle: 330, distance: 40, delay: 95, size: 'normal' },
        // Outer ring - 6 small emojis
        { angle: 0, distance: 55, delay: 40, size: 'small', rotation: 0 },
        { angle: 60, distance: 55, delay: 55, size: 'small', rotation: 15 },
        { angle: 120, distance: 55, delay: 70, size: 'small', rotation: -15 },
        { angle: 180, distance: 55, delay: 85, size: 'small', rotation: 0 },
        { angle: 240, distance: 55, delay: 100, size: 'small', rotation: 10 },
        { angle: 300, distance: 55, delay: 115, size: 'small', rotation: -10 },
    ];
    
    miniEmojis.forEach((config) => {
        setTimeout(() => {
            const el = document.createElement('div');
            el.className = 'reaction-burst-emoji' + (config.size === 'small' ? ' reaction-burst-emoji--small' : '');
            el.textContent = emoji;
            el.style.left = x + 'px';
            el.style.top = y + 'px';
            
            // Calculate burst direction using trigonometry
            const angleRad = config.angle * (Math.PI / 180);
            const burstX = Math.sin(angleRad) * config.distance + 'px';
            const burstY = -Math.cos(angleRad) * config.distance + 'px';
            
            el.style.setProperty('--burst-x', burstX);
            el.style.setProperty('--burst-y', burstY);
            el.style.setProperty('--rotation', (config.rotation || 0) + 'deg');
            
            document.body.appendChild(el);
            
            el.addEventListener('animationend', () => {
                el.remove();
            });
        }, config.delay);
    });
}

function normalizeAvatarUrl(avatarUrl) {
    const sharedNormalizeAvatarUrl = window.BorofoneApp?.utils?.normalizeAvatarUrl;
    if (typeof sharedNormalizeAvatarUrl === 'function') {
        return sharedNormalizeAvatarUrl(avatarUrl);
    }

    if (!avatarUrl) return null;
    if (avatarUrl.startsWith('http://') || avatarUrl.startsWith('https://')) return avatarUrl;
    return avatarUrl.startsWith('/') ? avatarUrl : `/${avatarUrl}`;
}

function withAvatarCacheBuster(avatarUrl, userId = null) {
    const sharedWithAvatarCacheBuster = window.BorofoneApp?.utils?.withAvatarCacheBuster;
    if (typeof sharedWithAvatarCacheBuster === 'function') {
        return sharedWithAvatarCacheBuster(avatarUrl, userId, avatarCacheBuster);
    }

    if (!avatarUrl) return null;
    const baseUrl = normalizeAvatarUrl(avatarUrl);
    if (!baseUrl) return null;

    const cacheKey = userId ? `${userId}-${avatarCacheBuster}` : String(avatarCacheBuster);
    return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}v=${cacheKey}`;
}
