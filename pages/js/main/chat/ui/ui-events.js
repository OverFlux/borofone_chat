// ==========================================
// EVENT LISTENERS
// ==========================================

messageForm.addEventListener('submit', (e) => {
    e.preventDefault();
    e.stopPropagation();
    sendMessage();
});

// Предотвращаем любой default для кнопки отправки
if (sendBtn) {
    sendBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        sendMessage(); // Вызываем отправку сообщения
    });
}

// Shift+Enter for line break (like Discord)
messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault(); // Prevent form submit
        e.stopPropagation(); // Дополнительная защита
        sendMessage(); // Вызываем напрямую, без dispatchEvent
    }
    // Shift+Enter - let default behavior (newline) happen automatically for textarea
});

// Auto-resize textarea
function autoResizeMessageInput() {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 150) + 'px';
}

messageInput.addEventListener('input', () => {
    autoResizeMessageInput();
    // Update send button state
    sendBtn.disabled = !messageInput.value.trim();
    // Check for text selection (for popup)
    checkTextSelection();
    // Send typing indicator event
    onInputChanged();
});

// Check for text selection to show popup
function checkTextSelection() {
    if (!markdownPopup || !messageInput) return;
    const selectedText = messageInput.value.substring(messageInput.selectionStart, messageInput.selectionEnd);
    if (selectedText.length > 0) {
        // Show popup near cursor/selection
        showMarkdownPopup();
    } else {
        hideMarkdownPopup();
    }
}

// Also check on selection change
messageInput.addEventListener('select', checkTextSelection);
messageInput.addEventListener('click', checkTextSelection);
messageInput.addEventListener('mouseup', checkTextSelection);
messageInput.addEventListener('keyup', (e) => {
    // Delay to allow selection to update
    setTimeout(checkTextSelection, 10);
});

// Keyboard shortcuts for markdown
messageInput.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
            case 'b':
                e.preventDefault();
                applyMarkdownFormat('bold');
                break;
            case 'i':
                e.preventDefault();
                applyMarkdownFormat('italic');
                break;
            case 's':
                e.preventDefault();
                applyMarkdownFormat('strikethrough');
                break;
            case 'e':
                e.preventDefault();
                toggleEmojiPicker();
                break;
        }
    }
    // Escape to close emoji picker
    if (e.key === 'Escape') {
        closeEmojiPicker();
    }
});

function showMarkdownPopup() {
    if (!markdownPopup) return;
    // Position popup near the input
    const inputRect = messageInput.getBoundingClientRect();
    markdownPopup.style.top = (inputRect.bottom + 8) + 'px';
    markdownPopup.style.left = inputRect.left + 'px';
    markdownPopup.classList.remove('hidden');
}

function hideMarkdownPopup() {
    if (!markdownPopup) return;
    markdownPopup.classList.add('hidden');
}

// Apply markdown formatting
function applyMarkdownFormat(formatType) {
    const start = messageInput.selectionStart;
    const end = messageInput.selectionEnd;
    const text = messageInput.value;
    const selectedText = text.substring(start, end);
    
    let newText = '';
    let cursorOffset = 0;
    
    switch (formatType) {
        case 'bold':
            newText = '**' + selectedText + '**';
            cursorOffset = 2;
            break;
        case 'italic':
            newText = '*' + selectedText + '*';
            cursorOffset = 1;
            break;
        case 'strikethrough':
            newText = '~~' + selectedText + '~~';
            cursorOffset = 2;
            break;
        case 'code':
            newText = '`' + selectedText + '`';
            cursorOffset = 1;
            break;
        case 'link':
            newText = '[' + selectedText + '](url)';
            cursorOffset = selectedText.length + 3;
            break;
        default:
            return;
    }
    
    messageInput.value = text.substring(0, start) + newText + text.substring(end);
    
    // Set cursor position after the inserted text
    const newCursorPos = selectedText.length > 0 ? end + cursorOffset : start + cursorOffset;
    messageInput.selectionStart = messageInput.selectionEnd = newCursorPos;
    
    // Update preview and UI
    autoResizeMessageInput();
    updateMarkdownPreview();
    sendBtn.disabled = !messageInput.value.trim();
    messageInput.focus();
}

// Add popup button click handlers
document.querySelectorAll('.md-popup-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        const format = btn.dataset.mdFormat;
        applyMarkdownFormat(format);
    });
});

// Hide popup when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.markdown-popup') && !e.target.closest('#messageInput')) {
        hideMarkdownPopup();
    }
});

messagesList.addEventListener('click', (event) => {
    const plusBtn = event.target.closest('[data-open-reaction-picker]');
    if (plusBtn) {
        const messageId = plusBtn.dataset.openReactionPicker;
        if (activeReactionPickerFor === Number(messageId)) {
            closeReactionPicker();
        } else {
            openReactionPicker(messageId);
        }
        return;
    }

    const addBtn = event.target.closest('[data-add-reaction]');
    if (addBtn) {
        // Close picker immediately - animation will be shown when server confirms
        const messageId = addBtn.dataset.messageId;
        const emoji = addBtn.dataset.addReaction;
        toggleReaction(messageId, emoji);
        closeReactionPicker();
        return;
    }

    const allBtn = event.target.closest('[data-open-all-emoji]');
    if (allBtn) {
        openAllEmojiPrompt(allBtn.dataset.openAllEmoji, allBtn);
        return;
    }

    const reactionBtn = event.target.closest('.reaction-chip');
    if (reactionBtn) {
        const messageEl = reactionBtn.closest('.message');
        if (!messageEl) return;
        if (messageEl.dataset.isDeleted === '1') return;
        
        // Animation will be shown when server confirms
        toggleReaction(messageEl.dataset.messageId, reactionBtn.dataset.emoji);
        return;
    }

    const hoverReplyBtn = event.target.closest('[data-hover-reply]');
    if (hoverReplyBtn) {
        const messageEl = messagesList.querySelector(`[data-message-id="${hoverReplyBtn.dataset.hoverReply}"]`);
        if (!messageEl) return;
        setReplyTarget(messageEl);
        messageInput.focus();
        closeReactionPicker();
        return;
    }

    const jumpBtn = event.target.closest('[data-jump-to-message]');
    if (jumpBtn) {
        jumpToMessage(jumpBtn.dataset.jumpToMessage);
        return;
    }

    if (!event.target.closest('.message-hover-actions')) {
        closeReactionPicker();
    }
});

messagesList.addEventListener('contextmenu', (event) => {
    const messageEl = event.target.closest('.message');
    if (!messageEl) return;
    openMessageContextMenu(event, messageEl);
});

messageContextMenu.addEventListener('click', (event) => {
    const actionBtn = event.target.closest('[data-context-action]');
    const emojiBtn = event.target.closest('[data-context-emoji]');

    const messageId = messageContextMenu.dataset.messageId;
    const messageEl = messagesList.querySelector(`[data-message-id="${messageId}"]`);

    if (emojiBtn) {
        if (messageEl?.dataset.isDeleted === '1') {
            closeMessageContextMenu();
            return;
        }
        toggleReaction(messageId, emojiBtn.dataset.contextEmoji);
        closeMessageContextMenu();
        return;
    }

    if (!actionBtn || !messageEl) return;

    if (actionBtn.dataset.contextAction === 'react') {
        if (messageEl.dataset.isDeleted === '1') {
            closeMessageContextMenu();
            return;
        }
        messageContextEmojiMenu.classList.remove('hidden');
        return;
    }
    if (actionBtn.dataset.contextAction === 'reply') {
        setReplyTarget(messageEl);
        messageInput.focus();
    }
    if (actionBtn.dataset.contextAction === 'edit') {
        closeMessageContextMenu();
        startMessageEdit(messageId, messageEl);
    }
    if (actionBtn.dataset.contextAction === 'delete') {
        deleteMessage(messageId);
    }
    if (actionBtn.dataset.contextAction === 'delete_hard') {
        hardDeleteMessage(messageId);
    }

    closeMessageContextMenu();
});

messageContextEmojiMenu.addEventListener('click', (event) => {
    const emojiBtn = event.target.closest('[data-context-emoji]');
    const actionBtn = event.target.closest('[data-context-action]');
    const messageId = messageContextMenu.dataset.messageId;

    if (emojiBtn) {
        const messageEl = messagesList.querySelector(`[data-message-id="${messageId}"]`);
        if (messageEl?.dataset.isDeleted === '1') {
            closeMessageContextMenu();
            return;
        }
        toggleReaction(messageId, emojiBtn.dataset.contextEmoji);
        closeMessageContextMenu();
        return;
    }

    if (actionBtn && actionBtn.dataset.contextAction === 'emoji-more') {
        openAllEmojiPrompt(messageId, actionBtn);
        closeMessageContextMenu();
    }
});

document.addEventListener('click', (event) => {
    if (!event.target.closest('.message-context-menu') && !event.target.closest('.message-context-emoji-menu')) {
        closeMessageContextMenu();
    }
});

replyPreview.querySelector('.reply-preview-close').addEventListener('click', () => {
    clearReplyTarget();
});


roomsList.addEventListener('contextmenu', async (event) => {
    const item = event.target.closest('.room-item');
    if (!item) return;
    event.preventDefault();
    const roomId = Number(item.dataset.roomId);
    openRoomContextMenu({ x: event.clientX, y: event.clientY, roomId, type: 'text' });
});

voiceRoomsList.addEventListener('contextmenu', async (event) => {
    const item = event.target.closest('[data-voice-room-id]');
    if (!item) return;
    event.preventDefault();
    const roomId = Number(item.dataset.voiceRoomId);
    openRoomContextMenu({ x: event.clientX, y: event.clientY, roomId, type: 'voice' });
});

document.addEventListener('click', (event) => {
    if (!event.target.closest('.room-context-menu')) {
        roomContextMenu.classList.add('hidden');
    }
});


document.addEventListener('click', (event) => {
    if (!event.target.closest('.participant-volume-menu')) {
        participantVolumeMenu.classList.add('hidden');
    }
});

micVolumeSlider?.addEventListener('input', () => {
    micGainValue = Number(micVolumeSlider.value) / 100;
    if (micGainNode) micGainNode.gain.value = micGainValue;
    if (micVolumeValue) micVolumeValue.textContent = `${micVolumeSlider.value}%`;
});

headphoneVolumeSlider?.addEventListener('input', () => {
    headphonesGainValue = Number(headphoneVolumeSlider.value) / 100;
    if (headphoneVolumeValue) headphoneVolumeValue.textContent = `${headphoneVolumeSlider.value}%`;
    applyHeadphonesGain();
});

function openRoomContextMenu({ x, y, roomId, type }) {
    const actionBtn = roomContextMenu.querySelector('#roomContextAction');
    roomContextMenu.style.left = `${x}px`;
    roomContextMenu.style.top = `${y}px`;

    if (currentUser?.role !== 'admin') {
        actionBtn.textContent = 'Не хватает прав';
        actionBtn.disabled = true;
        actionBtn.classList.add('insufficient-rights');
        actionBtn.onclick = null;
    } else {
        actionBtn.textContent = type === 'voice' ? 'Удалить аудиокомнату' : 'Удалить комнату';
        actionBtn.disabled = false;
        actionBtn.classList.remove('insufficient-rights');
        actionBtn.onclick = async () => {
            await deleteRoomByType(roomId, type);
            roomContextMenu.classList.add('hidden');
        };
    }

    roomContextMenu.classList.remove('hidden');
}

async function deleteRoomByType(roomId, type) {
    const endpoint = type === 'voice' ? `${getApiUrl()}/voice-rooms/${roomId}` : `${getApiUrl()}/rooms/${roomId}`;
    const response = await fetchWithAuth(endpoint, { method: 'DELETE' });
    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        alert(error.detail || 'Не удалось удалить комнату');
        return;
    }
    if (type === 'voice') {
        if (currentVoiceRoomId === roomId) leaveVoiceRoom();
        await loadVoiceRooms();
    } else {
        if (currentRoom?.id === roomId) {
            currentRoom = null;
            roomName.textContent = 'Выберите комнату';
            messagesList.innerHTML = '<div class="placeholder-message"><span class="placeholder-icon">💬</span><p>Выберите комнату, чтобы начать общение</p></div>';
            messageInput.disabled = true;
            sendBtn.disabled = true;
        }
        await loadRooms();
    }
}

if (createRoomBtn) createRoomBtn.addEventListener('click', () => openModal('text'));
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

// Settings button - uses sidebar button
if (settingsBtnSidebar) {
    settingsBtnSidebar.addEventListener('click', openSettingsModal);
}

// Clear logs button
const clearLogsBtn = document.getElementById('clearLogsBtn');
if (clearLogsBtn) {
    clearLogsBtn.addEventListener('click', clearLogs);
}

// Update stats periodically for uptime
setInterval(() => {
    if (connectionStatus.classList.contains('connected')) {
        updateConnectionStatsDisplay();
    }
}, 1000);

// Note: settingsBtn (header button) was removed - use settingsBtnSidebar instead

// Activities (Game) Modal
function openActivitiesModal() {
    if (!activitiesModal) return;
    
    activitiesModal.classList.add('active');
    // Reset to placeholder state
    gameFrame.classList.remove('active');
    activitiesPlaceholder.classList.remove('hidden');
}

function closeActivitiesModal() {
    activitiesModal.classList.remove('active');
    // Stop the game by clearing the iframe src
    gameFrame.src = '';
    gameFrame.classList.remove('active');
    activitiesPlaceholder.classList.remove('hidden');
}

function launchGame(gameType = 'blackjack') {
    // Path to your game
    const gamePath = './games/blackjack.html';
    
    gameFrame.src = gamePath;
    gameFrame.classList.add('active');
    activitiesPlaceholder.classList.add('hidden');
    
    // Focus iframe after a short delay to let it load
    setTimeout(() => {
        gameFrame.focus();
    }, 500);
}

// Blackjack is now the only game in the modal

// Click on game area to focus it
document.querySelector('.activities-content').addEventListener('click', () => {
    if (gameFrame.classList.contains('active')) {
        gameFrame.focus();
    }
});

// Event listeners for activities modal
if (activitiesBtn) {
    activitiesBtn.addEventListener('click', openActivitiesModal);
}
if (activitiesCloseBtn) {
    activitiesCloseBtn.addEventListener('click', closeActivitiesModal);
}
if (activitiesOverlay) {
    activitiesOverlay.addEventListener('click', closeActivitiesModal);
}
if (launchGameBtn) {
    launchGameBtn.addEventListener('click', () => launchGame('blackjack'));
}

function loadStylesheetOnce(href) {
    const existingLink = document.querySelector(`link[href="${href}"]`);
    if (existingLink) return Promise.resolve(existingLink);

    return new Promise((resolve, reject) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.onload = () => resolve(link);
        link.onerror = () => reject(new Error(`Failed to load stylesheet: ${href}`));
        document.head.appendChild(link);
    });
}

function loadScriptOnce(src) {
    const existingScript = document.querySelector(`script[src="${src}"]`);
    if (existingScript) {
        if (existingScript.dataset.loaded === 'true') return Promise.resolve(existingScript);
        return new Promise((resolve, reject) => {
            existingScript.addEventListener('load', () => resolve(existingScript), { once: true });
            existingScript.addEventListener('error', () => reject(new Error(`Failed to load script: ${src}`)), { once: true });
        });
    }

    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.defer = true;
        script.onload = () => {
            script.dataset.loaded = 'true';
            resolve(script);
        };
        script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
        document.body.appendChild(script);
    });
}

function ensureWordleAssetsLoaded() {
    if (typeof initWordle === 'function' && typeof openWordleModal === 'function') {
        return Promise.resolve();
    }

    if (!window.__borofoneWordleLoadPromise) {
        window.__borofoneWordleLoadPromise = Promise.all([
            loadStylesheetOnce('/styles/wordle.css'),
            loadScriptOnce('/js/wordle.js'),
        ]).then(() => undefined);
    }

    return window.__borofoneWordleLoadPromise;
}

// Wordle button - opens in its own modal
if (launchWordleBtn) {
    launchWordleBtn.addEventListener('click', async () => {
        closeActivitiesModal();

        try {
            await ensureWordleAssetsLoaded();
            if (typeof initWordle === 'function') {
                initWordle();
            }
            if (typeof openWordleModal === 'function') {
                openWordleModal();
            }
        } catch (error) {
            console.error('[Wordle] Failed to load assets:', error);
            alert('Wordle failed to load');
        }
    });
}


// Open game in new tab - default to blackjack
if (openNewTabBtn) {
    openNewTabBtn.addEventListener('click', () => {
        window.open('./games/blackjack.html', '_blank');
    });
}

// Close modal with Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && activitiesModal.classList.contains('active')) {
        closeActivitiesModal();
    }
});

// Forward keyboard events to game iframe when activities modal is open
// Prevent chat from capturing game keys when activities modal is open
document.addEventListener('keydown', (e) => {
    // Only handle if activities modal is active
    if (!activitiesModal.classList.contains('active')) return;
    if (!gameFrame.classList.contains('active')) return;
    
    // Game keys to pass to game
    const gameKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'];
    
    if (gameKeys.includes(e.code)) {
        // Prevent chat input from capturing these keys
        e.preventDefault();
        e.stopPropagation();
        
        // Focus the iframe so it receives the keyboard input
        gameFrame.focus();
        
        // Forward key to iframe using postMessage for cross-origin
        try {
            gameFrame.contentWindow.postMessage({
                type: 'keydown',
                key: e.key,
                code: e.code
            }, '*');
        } catch(err) {
            // Fallback - iframe should be focused
        }
    }
});

document.addEventListener('keyup', (e) => {
    if (!activitiesModal.classList.contains('active')) return;
    if (!gameFrame.classList.contains('active')) return;
    
    const gameKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'];
    
    if (gameKeys.includes(e.code)) {
        e.preventDefault();
        e.stopPropagation();
        
        try {
            gameFrame.contentWindow.postMessage({
                type: 'keyup',
                key: e.key,
                code: e.code
            }, '*');
        } catch(err) {}
    }
});

// DND (Do Not Disturb) button - now uses avatar
function updateDndButtonState() {
    if (!window.notifications) return;
    
    const isDnd = window.notifications.isDoNotDisturbEnabled();
    
    // Update avatar status indicator instead of old dndBtn
    if (currentUserAvatar) {
        if (isDnd) {
            currentUserAvatar.classList.add('dnd');
        } else {
            currentUserAvatar.classList.remove('dnd');
        }
    }
    
    // Keep old button for backwards compatibility if it exists
    if (dndBtn) {
        if (isDnd) {
            dndBtn.classList.add('active');
            dndBtn.title = 'Режим "Не беспокоить" включён';
        } else {
            dndBtn.classList.remove('active');
            dndBtn.title = 'Включить режим "Не беспокоить"';
        }
    }
}

// DND button - now handled via avatar dropdown, keeping for backwards compatibility
if (dndBtn) {
    dndBtn.addEventListener('click', () => {
        window.notifications.toggleDoNotDisturb();
        updateDndButtonState();
    });

    // Initialize DND button state
    updateDndButtonState();
}
// (Variables already declared at top of file: avatarDropdown, settingsBtnSidebar, activitiesTab)

// Toggle avatar dropdown on click
if (currentUserAvatar) {
    currentUserAvatar.addEventListener('click', (e) => {
        e.stopPropagation();
        avatarDropdown.classList.toggle('active');
        
        // Close other dropdowns
        if (avatarDropdown.classList.contains('active')) {
            // Reposition dropdown based on avatar position
            const rect = currentUserAvatar.getBoundingClientRect();
            avatarDropdown.style.left = '10px';
            avatarDropdown.style.right = '10px';
        }
    });
}

// Status selection from dropdown
if (avatarDropdown) {
    avatarDropdown.querySelectorAll('.dropdown-item').forEach(item => {
        item.addEventListener('click', (e) => {
            const status = e.currentTarget.dataset.status;
            
            if (status === 'dnd') {
                // Enable DND mode
                window.notifications.setDoNotDisturb(true);
                currentUserAvatar.classList.add('dnd');
            } else if (status === 'online') {
                // Disable DND mode
                window.notifications.setDoNotDisturb(false);
                currentUserAvatar.classList.remove('dnd');
            }
            
            updateDndButtonState();
            avatarDropdown.classList.remove('active');
        });
    });
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    if (avatarDropdown && avatarDropdown.classList.contains('active')) {
        if (!avatarDropdown.contains(e.target) && !currentUserAvatar.contains(e.target)) {
            avatarDropdown.classList.remove('active');
        }
    }
});

// Activities tab handler
if (activitiesTab) {
    activitiesTab.addEventListener('click', () => {
        // Open activities/games modal
        openActivitiesModal();
    });
}

// Update avatar status indicator based on DND state
function updateAvatarStatusIndicator() {
    if (currentUserAvatar) {
        const isDnd = window.notifications && window.notifications.isDoNotDisturb;
        if (isDnd) {
            currentUserAvatar.classList.add('dnd');
        } else {
            currentUserAvatar.classList.remove('dnd');
        }
    }
}

// Update avatar indicator when DND changes
const originalToggleDnd = window.notifications?.toggleDoNotDisturb;
if (window.notifications) {
    window.notifications.toggleDoNotDisturb = function(...args) {
        const result = originalToggleDnd?.apply(this, args);
        updateAvatarStatusIndicator();
        updateDndButtonState();
        return result;
    };
}

// Logout with confirmation modal
logoutBtn.addEventListener('click', () => {
    logoutConfirmModal.classList.add('active');
});

cancelLogoutBtn.addEventListener('click', () => {
    logoutConfirmModal.classList.remove('active');
});

confirmLogoutBtn.addEventListener('click', () => {
    logoutConfirmModal.classList.remove('active');
    logout();
});

logoutConfirmModal.addEventListener('click', (e) => {
    if (e.target === logoutConfirmModal) {
        logoutConfirmModal.classList.remove('active');
    }
});

// Settings tab switching
settingsTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const tabId = btn.dataset.tab;
        
        // Update button states
        settingsTabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Update panel visibility
        settingsTabPanels.forEach(panel => {
            panel.classList.remove('active');
            if (panel.id === `tab-${tabId}`) {
                panel.classList.add('active');
            }
        });
    });
});

// Volume settings sync between voice chat and settings
function syncVolumeSettings() {
    if (micVolumeSlider && settingsMicVolume) {
        settingsMicVolume.value = micVolumeSlider.value;
        settingsMicVolumeValue.textContent = `${micVolumeSlider.value}%`;
    }
    if (headphoneVolumeSlider && settingsHeadphoneVolume) {
        settingsHeadphoneVolume.value = headphoneVolumeSlider.value;
        settingsHeadphoneVolumeValue.textContent = `${headphoneVolumeSlider.value}%`;
    }
}

// Initialize volume sync
if (micVolumeSlider) {
    micVolumeSlider.addEventListener('input', () => {
        if (settingsMicVolume) {
            settingsMicVolume.value = micVolumeSlider.value;
            settingsMicVolumeValue.textContent = `${micVolumeSlider.value}%`;
        }
    });
}

if (headphoneVolumeSlider) {
    headphoneVolumeSlider.addEventListener('input', () => {
        if (settingsHeadphoneVolume) {
            settingsHeadphoneVolume.value = headphoneVolumeSlider.value;
            settingsHeadphoneVolumeValue.textContent = `${headphoneVolumeSlider.value}%`;
        }
    });
}

// Settings volume sliders (bidirectional sync)
if (settingsMicVolume) {
    settingsMicVolume.addEventListener('input', () => {
        settingsMicVolumeValue.textContent = `${settingsMicVolume.value}%`;
        if (micVolumeSlider) {
            micVolumeSlider.value = settingsMicVolume.value;
        }
    });
}

if (settingsHeadphoneVolume) {
    settingsHeadphoneVolume.addEventListener('input', () => {
        settingsHeadphoneVolumeValue.textContent = `${settingsHeadphoneVolume.value}%`;
        if (headphoneVolumeSlider) {
            headphoneVolumeSlider.value = settingsHeadphoneVolume.value;
        }
    });
}

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
    revokeAvatarCropperObjectUrl();
    const objectUrl = URL.createObjectURL(file);
    currentAvatarCropperObjectUrl = objectUrl;
    
    // Open cropper with the image
    openAvatarCropper(objectUrl);
});

// Avatar Cropper Functions
let baseScale = 1; // Initial fit scale

let cropperCanvas = null;
let cropperCanvasCtx = null;
let currentAvatarCropperObjectUrl = null;

function revokeAvatarCropperObjectUrl() {
    if (!currentAvatarCropperObjectUrl) return;
    try {
        if (currentAvatarCropperObjectUrl.startsWith('blob:')) {
            URL.revokeObjectURL(currentAvatarCropperObjectUrl);
        }
    } catch (_) {
        // Ignore blob cleanup errors.
    }
    currentAvatarCropperObjectUrl = null;
}

function openAvatarCropper(imageUrl) {
    cropperImageData = imageUrl;
    panX = 0;
    panY = 0;
    
    // Create or reuse canvas for preview
    if (!cropperCanvas) {
        cropperCanvas = document.createElement('canvas');
        cropperCanvas.width = 240;
        cropperCanvas.height = 240;
        cropperCanvasCtx = cropperCanvas.getContext('2d');
        
        // Replace img with canvas in DOM
        const preview = document.getElementById('avatarCropperPreview');
        preview.innerHTML = '';
        preview.appendChild(cropperCanvas);
    }

    // Load source image for cropping
    cropperOriginalImage = new Image();
    cropperOriginalImage.onload = () => {
        fitImageToContainer();
    };
    cropperOriginalImage.src = imageUrl;
    
    // Show cropper container
    avatarCropperContainer.style.display = 'block';
    
    // Initialize drag after a small delay
    setTimeout(initCropperDrag, 100);
}

function fitImageToContainer() {
    if (!cropperOriginalImage?.naturalWidth || !cropperCanvasCtx) return;
    
    const canvasWidth = 240;
    const canvasHeight = 240;
    
    // Calculate scale to COVER the canvas (like object-fit: cover)
    const scaleX = canvasWidth / cropperOriginalImage.naturalWidth;
    const scaleY = canvasHeight / cropperOriginalImage.naturalHeight;
    baseScale = Math.max(scaleX, scaleY);
    
    // Keep zoom range sane to avoid over-zooming the selected thumbnail
    cropperZoomSlider.min = baseScale;
    cropperZoomSlider.max = baseScale * 1.8;
    cropperZoomSlider.step = Math.max(baseScale * 0.02, 0.001);
    cropperZoomSlider.value = baseScale;
    
    cropScale = baseScale;
    panX = 0;
    panY = 0;
    
    renderCropperPreview();
}

function renderCropperPreview() {
    if (!cropperCanvasCtx || !cropperOriginalImage) return;
    
    const canvasWidth = 240;
    const canvasHeight = 240;
    
    // Clear canvas
    cropperCanvasCtx.clearRect(0, 0, canvasWidth, canvasHeight);
    
    // Calculate displayed size
    const displayWidth = cropperOriginalImage.naturalWidth * cropScale;
    const displayHeight = cropperOriginalImage.naturalHeight * cropScale;

    const maxPanX = Math.max(0, (displayWidth - canvasWidth) / 2);
    const maxPanY = Math.max(0, (displayHeight - canvasHeight) / 2);
    panX = Math.min(maxPanX, Math.max(-maxPanX, panX));
    panY = Math.min(maxPanY, Math.max(-maxPanY, panY));
    
    // Calculate offset to center + pan
    const offsetX = (canvasWidth - displayWidth) / 2 + panX;
    const offsetY = (canvasHeight - displayHeight) / 2 + panY;
    
    // Draw image with clipping to circle (using composite operation)
    cropperCanvasCtx.save();
    
    // Create circular clipping path
    cropperCanvasCtx.beginPath();
    cropperCanvasCtx.arc(canvasWidth / 2, canvasHeight / 2, canvasWidth / 2, 0, Math.PI * 2);
    cropperCanvasCtx.clip();
    
    // Draw the image
    cropperCanvasCtx.drawImage(
        cropperOriginalImage,
        offsetX, offsetY, displayWidth, displayHeight
    );
    
    cropperCanvasCtx.restore();
}

// Zoom slider handler
cropperZoomSlider?.addEventListener('input', (e) => {
    cropScale = parseFloat(e.target.value);
    renderCropperPreview();
});

// Close cropper
closeCropperBtn?.addEventListener('click', closeAvatarCropper);
cancelCropBtn?.addEventListener('click', closeAvatarCropper);

function closeAvatarCropper() {
    avatarCropperContainer.style.display = 'none';
    cropperImageData = null;
    if (cropperOriginalImage) {
        cropperOriginalImage.src = '';
    }
    cropperOriginalImage = null;
    revokeAvatarCropperObjectUrl();
    panX = 0;
    panY = 0;
    baseScale = 1;
    cropScale = 1;
    avatarInput.value = '';
    
    // Restore original HTML with img element
    const preview = document.getElementById('avatarCropperPreview');
    if (preview) {
        preview.innerHTML = '<div class="avatar-cropper-preview-inner" id="cropperPreviewInner"><img id="cropperImage" src="" alt="Crop preview"></div>';
    }
    cropperCanvas = null;
    cropperCanvasCtx = null;
}

// Apply crop
applyCropBtn?.addEventListener('click', async () => {
    if (!cropperOriginalImage) return;
    
    // Create final cropped image at outputSize x outputSize
    const canvas = document.createElement('canvas');
    canvas.width = outputSize;
    canvas.height = outputSize;
    const ctx = canvas.getContext('2d');
    
    // Use the same logic as the preview - just scale to output size
    const containerSize = 240;
    const displayScale = cropScale;
    const displayedWidth = cropperOriginalImage.naturalWidth * displayScale;
    const displayedHeight = cropperOriginalImage.naturalHeight * displayScale;
    
    const offsetX = (containerSize - displayedWidth) / 2 + panX;
    const offsetY = (containerSize - displayedHeight) / 2 + panY;
    
    const sourceX = (-offsetX / displayScale);
    const sourceY = (-offsetY / displayScale);
    const sourceWidth = containerSize / displayScale;
    const sourceHeight = containerSize / displayScale;
    
    // Draw cropped image
    ctx.drawImage(
        cropperOriginalImage,
        sourceX, sourceY, sourceWidth, sourceHeight,
        0, 0, outputSize, outputSize
    );
    
    // Update preview with cropped image
    const croppedUrl = canvas.toDataURL('image/png');
    updateSettingsAvatarPreview(croppedUrl);
    
    // Store cropped data for saving
    window.croppedAvatarData = croppedUrl;
    
    closeAvatarCropper();
});

// Drag to pan functionality for cropper
let isDragging = false;
let dragStartX, dragStartY;
let initialPanX, initialPanY;

function initCropperDrag() {
    if (!cropperCanvas) return;
    
    cropperCanvas.style.cursor = 'grab';
    
    // Remove old handler if exists
    cropperCanvas.onmousedown = null;
    
    cropperCanvas.onmousedown = (e) => {
        e.preventDefault();
        isDragging = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        initialPanX = panX;
        initialPanY = panY;
        cropperCanvas.style.cursor = 'grabbing';
    };
    
    // Global mouse handlers
    document.onmousemove = (e) => {
        if (!isDragging) return;
        
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;
        
        // Calculate new pan position
        let newPanX = initialPanX + dx;
        let newPanY = initialPanY + dy;
        
                // Limit pan so image stays within crop bounds
        const displayScale = cropScale;
        const displayedWidth = cropperOriginalImage.naturalWidth * displayScale;
        const displayedHeight = cropperOriginalImage.naturalHeight * displayScale;
        const containerSize = 240;

        const maxPanX = Math.max(0, (displayedWidth - containerSize) / 2);
        const maxPanY = Math.max(0, (displayedHeight - containerSize) / 2);

        panX = Math.min(maxPanX, Math.max(-maxPanX, newPanX));
        panY = Math.min(maxPanY, Math.max(-maxPanY, newPanY));
        
        renderCropperPreview();
    };
    
    document.onmouseup = () => {
        isDragging = false;
        if (cropperCanvas) {
            cropperCanvas.style.cursor = 'grab';
        }
    };
}

// Update user preview when typing
settingsDisplayName?.addEventListener('input', () => {
    const displayNameEl = document.getElementById('settingsUserDisplayName');
    if (displayNameEl) {
        displayNameEl.textContent = settingsDisplayName.value || 'Display Name';
    }
});

settingsUsername?.addEventListener('input', () => {
    const userTagEl = document.getElementById('settingsUserTag');
    if (userTagEl) {
        userTagEl.textContent = '@' + (settingsUsername.value || 'username');
    }
});

// Editable profile fields with edit buttons
const displayNameEl = document.getElementById('settingsUserDisplayName');
const userTagEl = document.getElementById('settingsUserTag');
const displayNameInput = document.getElementById('settingsDisplayNameInput');
const usernameInput = document.getElementById('settingsUsernameInput');

// Find edit buttons
const editBtns = document.querySelectorAll('.profile-edit-btn');

editBtns.forEach((btn, index) => {
    btn.addEventListener('click', () => {
        if (index === 0) {
            // Edit display name
            const currentValue = displayNameEl?.textContent || '';
            if (displayNameInput) {
                displayNameInput.style.display = 'block';
                displayNameInput.value = currentValue;
                displayNameInput.focus();
            }
            if (displayNameEl) displayNameEl.style.display = 'none';
        } else {
            // Edit username
            const currentValue = userTagEl?.textContent?.replace('@', '') || '';
            if (usernameInput) {
                usernameInput.style.display = 'block';
                usernameInput.value = currentValue;
                usernameInput.focus();
            }
            if (userTagEl) userTagEl.style.display = 'none';
        }
    });
});

// Handle display name input
if (displayNameInput) {
    displayNameInput.addEventListener('blur', () => {
        const newValue = displayNameInput.value.trim();
        if (displayNameEl) {
            displayNameEl.textContent = newValue || 'User';
            displayNameEl.style.display = 'inline';
        }
        if (settingsDisplayName) {
            settingsDisplayName.value = newValue;
        }
        displayNameInput.style.display = 'none';
    });
    
    displayNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            displayNameInput.blur();
        }
        if (e.key === 'Escape') {
            displayNameInput.value = settingsDisplayName?.value || '';
            displayNameInput.blur();
        }
    });
}

// Handle username input
if (usernameInput) {
    usernameInput.addEventListener('blur', () => {
        const newValue = usernameInput.value.trim();
        if (userTagEl) {
            userTagEl.textContent = '@' + (newValue || 'username');
            userTagEl.style.display = 'inline';
        }
        if (settingsUsername) {
            settingsUsername.value = newValue;
        }
        usernameInput.style.display = 'none';
    });
    
    usernameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            usernameInput.blur();
        }
        if (e.key === 'Escape') {
            usernameInput.value = settingsUsername?.value || '';
            usernameInput.blur();
        }
    });
}

settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveSettings();
});

document.getElementById('attachBtn').addEventListener('click', () => {
    if (window.attachments) {
        window.attachments.openAttachmentDialog();
    }
});
