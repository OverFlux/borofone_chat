// ==========================================
// THEME MANAGEMENT
// ==========================================

function getStoredTheme() {
    return localStorage.getItem('chatTheme') || 'standard';
}

function applyTheme(theme) {
    if (theme === 'standard') {
        document.documentElement.removeAttribute('data-theme');
    } else {
        document.documentElement.setAttribute('data-theme', theme);
    }
}

function updateThemeUI(activeTheme) {
    // Handle old theme options
    const themeOptions = document.querySelectorAll('.theme-option');
    themeOptions.forEach(option => {
        if (option.dataset.theme === activeTheme) {
            option.classList.add('active');
        } else {
            option.classList.remove('active');
        }
    });
    // Handle new theme option cards
    const themeOptionCards = document.querySelectorAll('.theme-option-card');
    themeOptionCards.forEach(card => {
        if (card.dataset.theme === activeTheme) {
            card.classList.add('active');
        } else {
            card.classList.remove('active');
        }
    });
}

function initTheme() {
    const savedTheme = getStoredTheme();
    applyTheme(savedTheme);
    updateThemeUI(savedTheme);
}

// Theme option click handlers (old style)
document.querySelectorAll('.theme-option').forEach(option => {
    option.addEventListener('click', () => {
        const theme = option.dataset.theme;
        localStorage.setItem('chatTheme', theme);
        applyTheme(theme);
        updateThemeUI(theme);
    });
});

// Theme option card click handlers (new style)
document.querySelectorAll('.theme-option-card').forEach(card => {
    card.addEventListener('click', () => {
        const theme = card.dataset.theme;
        localStorage.setItem('chatTheme', theme);
        applyTheme(theme);
        updateThemeUI(theme);
    });
});
if (replyPreview && messageForm && messageForm.parentElement) {
    replyPreview.className = 'reply-preview hidden';
    replyPreview.innerHTML = '<div class="reply-preview-content"></div><button class="reply-preview-close" type="button">x</button>';
    messageForm.parentElement.insertBefore(replyPreview, messageForm);
}

const messageContextMenu = document.createElement('div');
messageContextMenu.className = 'message-context-menu hidden';
messageContextMenu.innerHTML = `
    <div class="context-quick-reactions" data-context-quick-reactions></div>
    <button type="button" class="context-main-action" data-context-action="react">Добавить реакцию <span>›</span></button>
    <div class="context-divider"></div>
    <button type="button" class="context-main-action" data-context-action="reply">Ответить <span>↩</span></button>
    <button type="button" class="context-main-action" data-context-action="edit">Изменить <span>✏️</span></button>
    <button type="button" class="context-main-action hidden" data-context-action="delete">Удалить сообщение <span>🗑</span></button>
    <button type="button" class="context-main-action context-action-admin hidden" data-context-action="delete_hard">Удалить полностью <span>💣</span></button>
`;
document.body.appendChild(messageContextMenu);

const messageContextEmojiMenu = document.createElement('div');
messageContextEmojiMenu.className = 'message-context-emoji-menu hidden';
document.body.appendChild(messageContextEmojiMenu);

const roomContextMenu = document.createElement('div');
roomContextMenu.className = 'room-context-menu hidden';
roomContextMenu.innerHTML = '<button type="button" id="roomContextAction"></button>';
document.body.appendChild(roomContextMenu);

const participantVolumeMenu = document.createElement('div');
participantVolumeMenu.className = 'participant-volume-menu hidden';
participantVolumeMenu.innerHTML = '<div class="volume-context-header">Set volume</div><input type="range" class="volume-context-slider" id="participantVolumeSlider" min="0" max="100" step="1" value="100"><div class="volume-context-value" id="participantVolumeValue">100%</div>';

document.body.appendChild(participantVolumeMenu);
