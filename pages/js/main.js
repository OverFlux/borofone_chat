// ==========================================
// API CONFIGURATION
// ==========================================

// PWA Service Worker Registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then((registration) => {
                console.log('[PWA] Service Worker зарегистрирован:', registration.scope);
            })
            .catch((error) => {
                console.error('[PWA] Ошибка регистрации Service Worker:', error);
            });
    });
}

// API_URL и WS_URL определяются в config.js
// Если config.js не загрузился, используем window.location.origin
function getApiUrl() {
    if (typeof API_URL !== 'undefined') return API_URL;
    return window.location.origin;
}

// Simple notification function (fallback if not defined elsewhere)
function showNotification(message, type = 'info') {
    console.log(`[${type}] ${message}`);
    // Try to use existing notification system, otherwise use browser alert
    if (typeof window.createToast === 'function') {
        window.createToast(message, type);
    } else if (typeof window.showToast === 'function') {
        window.showToast(message, type);
    }
}

function getWsUrl() {
    if (typeof WS_URL !== 'undefined') return WS_URL;
    return window.location.origin.replace(/^http/, 'ws');
}

// ==========================================
// LOADING SCREEN
// ==========================================

let loadingTasks = [];
let loadingCompleted = 0;
const loadingOverlay = document.getElementById('loadingOverlay');
const loadingProgressBar = document.getElementById('loadingProgressBar');
const loadingStatus = document.getElementById('loadingStatus');

function updateLoadingProgress(status, progress = null) {
    if (loadingStatus) {
        loadingStatus.textContent = status;
    }
    if (progress !== null && loadingProgressBar) {
        loadingProgressBar.style.width = progress + '%';
    }
}

function addLoadingTask(name) {
    loadingTasks.push(name);
    updateLoadingProgress(name, Math.round((loadingCompleted / (loadingTasks.length + 1)) * 100));
}

function completeLoadingTask(name) {
    loadingCompleted++;
    const progress = Math.round((loadingCompleted / loadingTasks.length) * 100);
    updateLoadingProgress('Загрузка завершена', progress);
}

function hideLoadingScreen() {
    if (loadingOverlay) {
        updateLoadingProgress('Добро пожаловать!', 100);
        // Ждём немного, чтобы пользователь увидел 100% загрузку
        setTimeout(() => {
            loadingOverlay.classList.add('hidden');
            setTimeout(() => {
                if (loadingOverlay.parentNode) {
                    loadingOverlay.parentNode.removeChild(loadingOverlay);
                }
            }, 700);
        }, 600);
    }
}

// Инициализация экрана загрузки
function initLoadingScreen() {
    // Добавляем задачи загрузки
    addLoadingTask('Загрузка стилей');
    addLoadingTask('Загрузка конфигурации');
    addLoadingTask('Загрузка интерфейса');
    addLoadingTask('Подключение к серверу');
    
    // Скрываем экран загрузки при ошибке window.onerror
    window.onerror = function(msg, url, lineNo, columnNo, error) {
        console.error('Ошибка:', msg, 'на строке', lineNo);
        completeLoadingTask('Ошибка загрузки');
        hideLoadingScreen();
        return false;
    };
}

// ==========================================
// STATE
// ==========================================

let currentRoom = null;
let ws = null;
let wsConnecting = false;
const seenIncomingMessageIds = new Set();
const seenIncomingMessageOrder = [];
const processedBadgeIncrements = new Set();
const MAX_SEEN_INCOMING_MESSAGES = 1000;
let wsReady = Promise.resolve();  // Promise который резолвится когда WS открыт

// Connection stats tracking
let connectionStats = {
    connectedAt: null,
    messagesSent: 0,
    messagesReceived: 0,
    reconnects: 0,
    lastPingTime: null,
    pingValue: null,
    logs: []
};

// Add log entry function
function markIncomingMessageSeen(messageId) {
    if (!Number.isFinite(messageId)) return false;
    if (seenIncomingMessageIds.has(messageId)) return true;

    seenIncomingMessageIds.add(messageId);
    seenIncomingMessageOrder.push(messageId);

    if (seenIncomingMessageOrder.length > MAX_SEEN_INCOMING_MESSAGES) {
        const oldestId = seenIncomingMessageOrder.shift();
        seenIncomingMessageIds.delete(oldestId);
    }

    return false;
}

function addLogEntry(type, message) {
    const logEntry = {
        type: type,
        message: message,
        timestamp: Date.now()
    };
    
    connectionStats.logs.unshift(logEntry);
    
    // Keep only last 50 logs
    if (connectionStats.logs.length > 50) {
        connectionStats.logs.pop();
    }
    
    // Update logs display if logs tab is visible
    updateLogsDisplay();
}

// Update logs display in the Logs tab
function updateLogsDisplay() {
    const logsList = document.getElementById('logsList');
    if (!logsList) return;
    
    if (connectionStats.logs.length === 0) {
        logsList.innerHTML = '<div class="logs-empty">Пока нет записей</div>';
        return;
    }
    
    let html = '';
    connectionStats.logs.forEach(log => {
        const time = new Date(log.timestamp);
        const timeStr = time.toLocaleTimeString('ru-RU', { 
            hour: '2-digit', 
            minute: '2-digit', 
            second: '2-digit' 
        });
        
        let iconSvg = '';
        switch(log.type) {
            case 'connect':
                iconSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
                break;
            case 'disconnect':
                iconSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
                break;
            case 'reconnect':
                iconSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>';
                break;
            case 'error':
                iconSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
                break;
            default:
                iconSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle></svg>';
        }
        
        html += `
            <div class="log-entry">
                <div class="log-entry-icon ${log.type}">${iconSvg}</div>
                <div class="log-entry-content">
                    <div class="log-entry-message">${escapeHtml(log.message)}</div>
                    <div class="log-entry-time">${timeStr}</div>
                </div>
            </div>
        `;
    });
    
    logsList.innerHTML = html;
}

// Clear logs function
function clearLogs() {
    connectionStats.logs = [];
    updateLogsDisplay();
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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

// ==========================================
// DISCORD-LIKE TOOLTIPS
// ==========================================

const TOOLTIP_TARGET_SELECTOR = 'button[title], button[data-tooltip], .connection-status[title], .connection-status[data-tooltip]';
let discordTooltip = null;
let activeTooltipTarget = null;
let tooltipHideTimer = null;

function getTooltipText(target) {
    if (!target) return '';
    return (target.getAttribute('data-tooltip') || target.getAttribute('title') || '').trim();
}

function removeNativeTitle(target) {
    if (!target || !target.hasAttribute('title')) return;
    target.dataset.tooltipTitleBackup = target.getAttribute('title') || '';
    target.removeAttribute('title');
}

function restoreNativeTitle(target) {
    if (!target || !target.dataset.tooltipTitleBackup) return;
    if (!target.hasAttribute('title')) {
        target.setAttribute('title', target.dataset.tooltipTitleBackup);
    }
    delete target.dataset.tooltipTitleBackup;
}

function positionDiscordTooltip(target) {
    if (!discordTooltip || !target) return;

    const targetRect = target.getBoundingClientRect();
    const tooltipRect = discordTooltip.getBoundingClientRect();
    const gap = 10;
    const edgePadding = 8;

    let placement = target.dataset.tooltipPlacement;
    if (!placement) {
        const hasTopSpace = targetRect.top >= tooltipRect.height + gap + edgePadding;
        placement = hasTopSpace ? 'top' : 'bottom';
    }

    let top = placement === 'top'
        ? targetRect.top - tooltipRect.height - gap
        : targetRect.bottom + gap;
    let left = targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2);

    left = Math.max(edgePadding, Math.min(left, window.innerWidth - tooltipRect.width - edgePadding));
    top = Math.max(edgePadding, Math.min(top, window.innerHeight - tooltipRect.height - edgePadding));

    const arrowLeft = Math.max(
        12,
        Math.min(tooltipRect.width - 12, (targetRect.left + targetRect.width / 2) - left)
    );

    discordTooltip.dataset.placement = placement;
    discordTooltip.style.left = `${left}px`;
    discordTooltip.style.top = `${top}px`;
    discordTooltip.style.setProperty('--discord-tooltip-arrow-left', `${arrowLeft}px`);
}

function hideDiscordTooltip() {
    if (!discordTooltip || !activeTooltipTarget) return;
    restoreNativeTitle(activeTooltipTarget);
    discordTooltip.classList.remove('visible');
    activeTooltipTarget = null;
}

function queueHideDiscordTooltip() {
    clearTimeout(tooltipHideTimer);
    tooltipHideTimer = setTimeout(hideDiscordTooltip, 80);
}

function showDiscordTooltip(target) {
    const tooltipText = getTooltipText(target);
    if (!tooltipText || !discordTooltip) return;

    if (activeTooltipTarget === target) {
        clearTimeout(tooltipHideTimer);
        positionDiscordTooltip(target);
        return;
    }

    hideDiscordTooltip();
    removeNativeTitle(target);
    activeTooltipTarget = target;
    discordTooltip.textContent = tooltipText;
    discordTooltip.classList.add('visible');
    positionDiscordTooltip(target);
}

function findTooltipTarget(node) {
    if (!(node instanceof Element)) return null;
    return node.closest(TOOLTIP_TARGET_SELECTOR);
}

function initDiscordTooltips() {
    if (discordTooltip) return;

    discordTooltip = document.createElement('div');
    discordTooltip.className = 'discord-tooltip';
    discordTooltip.setAttribute('role', 'tooltip');
    document.body.appendChild(discordTooltip);

    document.addEventListener('mouseover', (event) => {
        const target = findTooltipTarget(event.target);
        if (!target) return;
        clearTimeout(tooltipHideTimer);
        showDiscordTooltip(target);
    }, true);

    document.addEventListener('mouseout', (event) => {
        if (!activeTooltipTarget) return;

        const fromTarget = findTooltipTarget(event.target);
        if (fromTarget !== activeTooltipTarget) return;

        const related = event.relatedTarget;
        if (related instanceof Element && activeTooltipTarget.contains(related)) return;
        queueHideDiscordTooltip();
    }, true);

    document.addEventListener('focusin', (event) => {
        const target = findTooltipTarget(event.target);
        if (!target) return;
        clearTimeout(tooltipHideTimer);
        showDiscordTooltip(target);
    }, true);

    document.addEventListener('focusout', (event) => {
        const target = findTooltipTarget(event.target);
        if (target && target === activeTooltipTarget) {
            queueHideDiscordTooltip();
        }
    }, true);

    document.addEventListener('pointerdown', () => {
        hideDiscordTooltip();
    }, true);

    window.addEventListener('scroll', () => {
        if (activeTooltipTarget) {
            positionDiscordTooltip(activeTooltipTarget);
        }
    }, true);

    window.addEventListener('resize', () => {
        if (activeTooltipTarget) {
            positionDiscordTooltip(activeTooltipTarget);
        }
    });
}

let currentUser = null;
let rooms = [];
let shouldRemoveAvatar = false;
let avatarCacheBuster = null;
let badgesInitialized = false;  // Флаг: badges загружены один раз
const REACTION_EMOJIS = ['👍', '❤️', '😂', '🔥', '🎉'];
const REACTION_TRIGGER_EMOJIS = ['😀', '😎', '✨', '🎯', '🫶', '😺', '🤙', '🌈'];
const ALL_EMOJI_OPTIONS = [
    { key: ':joy:', emoji: '😂' },
    { key: ':grin:', emoji: '😁' },
    { key: ':cow:', emoji: '🐮' },
    { key: ':heart_eyes:', emoji: '😍' },
    { key: ':thinking:', emoji: '🤔' },
    { key: ':thumbsup:', emoji: '👍' },
    { key: ':revolving_hearts:', emoji: '💞' },
    { key: ':fearful:', emoji: '😨' },
    { key: ':astonished:', emoji: '😮' },
    { key: ':rage:', emoji: '😡' },
];
let replyToMessage = null;
let activeReactionPickerFor = null;

// ==========================================
// EMOJI PICKER DATA
// ==========================================

const EMOJI_CATEGORIES = {
    custom: {
        name: 'Кастомные',
        emojis: [],
        isCustom: true,
        path: '/emoji/'
    },
    smileys: {
        name: 'Улыбки и эмоции',
        emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '☺️', '😚', '😙', '🥲', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '🥸', '😎', '🤓', '🧐', '😕', '😟', '🙁', '☹️', '😮', '😯', '😲', '😳', '🥺', '😦', '😧', '😨', '😰', '😥', '😢', '😭', '😱', '😖', '😣', '😞', '😓', '😩', '😫', '🥱', '😤', '😡', '😠', '🤬', '😈', '👿', '💀', '☠️', '💩', '🤡', '👹', '👺', '👻', '👽', '👾', '🤖']
    },
    animals: {
        name: 'Животные и природа',
        emojis: ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🙈', '🙉', '🙊', '🐒', '🐔', '🐧', '🐦', '🐤', '🐣', '🐥', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🦋', '🐌', '🐞', '🐜', '🦟', '🦗', '🕷️', '🦂', '🐢', '🐍', '🦎', '🦖', '🦕', '🐙', '🦑', '🦐', '🦞', '🦀', '🐡', '🐠', '🐟', '🐬', '🐳', '🐋', '🦈', '🐊', '🐅', '🐆', '🦓', '🦍', '🦧', '🦣', '🐘', '🦛', '🦏', '🐪', '🐫', '🦒', '🦘', '🦬', '🐃', '🐂', '🐄', '🐎', '🐖', '🐏', '🐑', '🦙', '🐐', '🦌', '🐕', '🐩', '🦮', '🐕‍🦺', '🐈', '🐈‍⬛', '🪶', '🐓', '🦃', '🦤', '🦚', '🦜', '🦢', '🦩', '🕊️', '🐇', '🦝', '🦨', '🦡', '🦫', '🦦', '🦥', '🐁', '🐀', '🐿️', '🦔']
    },
    food: {
        name: 'Еда и напитки',
        emojis: ['🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🍆', '🥑', '🥦', '🥬', '🥒', '🌶️', '🫑', '🌽', '🥕', '🫒', '🧄', '🧅', '🥔', '🍠', '🥐', '🥯', '🍞', '🥖', '🥨', '🧀', '🥚', '🍳', '🧈', '🥞', '🧇', '🥓', '🥩', '🍗', '🍖', '🌭', '🍔', '🍟', '🍕', '🫓', '🥪', '🥙', '🧆', '🌮', '🌯', '🫔', '🥗', '🥘', '🫕', '🥫', '🍝', '🍜', '🍲', '🍛', '🍣', '🍱', '🥟', '🦪', '🍤', '🍙', '🍚', '🍘', '🍥', '🥠', '🥮', '🍢', '🍡', '🍧', '🍨', '🍦', '🥧', '🧁', '🍰', '🎂', '🍮', '🍭', '🍬', '🍫', '🍿', '🍩', '🍪', '🌰', '🥜', '🍯', '🥛', '🍼', '☕', '🫖', '🍵', '🧃', '🥤', '🧋', '🍶', '🍺', '🍻', '🥂', '🍷', '🥃', '🍸', '🍹', '🧉', '🍾', '🧊']
    },
    activities: {
        name: 'Активность и спорт',
        emojis: ['⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱', '🪀', '🏓', '🏸', '🏒', '🏑', '🥍', '🏏', '🪃', '🥅', '⛳', '🪁', '🏹', '🎣', '🤿', '🥊', '🥋', '🎽', '🛹', '🛼', '🛷', '⛸️', '🥌', '🎿', '⛷️', '🏂', '🪂', '🏋️', '🤼', '🤸', '🤺', '⛹️', '🤾', '🏌️', '🏇', '🧘', '🏄', '🏊', '🤽', '🚣', '🧗', '🚴', '🚵', '🎪', '🎭', '🎨', '🎬', '🎤', '🎧', '🎼', '🎹', '🥁', '🪘', '🎷', '🎺', '🪗', '🎸', '🪕', '🎻', '🪈', '🎲', '♟️', '🎯', '🎳', '🎮', '🎰', '🧩', '🎠', '🎡', '🎢', '💎', '🎪', '🎫', '🎟️', '🎫']
    },
    travel: {
        name: 'Путешествия и места',
        emojis: ['🚗', '🚕', '🚙', '🚌', '🚎', '🏎️', '🚓', '🚑', '🚒', '🚐', '🛻', '🚚', '🚛', '🚜', '🏍️', '🛵', '🚲', '🛴', '🛺', '🚨', '🚔', '🚍', '🚘', '🚖', '🚡', '🚠', '🚟', '🚃', '🚋', '🚞', '🚝', '🚄', '🚅', '🚈', '🚂', '🚆', '🚇', '🚊', '🚉', '✈️', '🛫', '🛬', '🛩️', '💺', '🛰️', '🚀', '🛸', '🚁', '🛶', '⛵', '🚤', '🛥️', '🛳️', '⛴️', '🚢', '⚓', '🪝', '⛽', '🚧', '🚦', '🚥', '🗺️', '🗿', '🗽', '🗼', '🏰', '🏯', '🏟️', '🎡', '🎢', '🎠', '⛲', '⛱️', '🏖️', '🏝️', '🏜️', '🌋', '⛰️', '🏔️', '🗻', '🏕️', '⛺', '🛖', '🏠', '🏡', '🏘️', '🏚️', '🏗️', '🏭', '🏢', '🏬', '🏣', '🏤', '🏥', '🏦', '🏨', '🏪', '🏫', '🏩', '💒', '🏛️', '⛪', '🕌', '🕍', '🛕', '🕋', '⛩️']
    },
    objects: {
        name: 'Предметы',
        emojis: ['⌚', '📱', '📲', '💻', '⌨️', '🖥️', '🖨️', '🖱️', '🖲️', '🕹️', '🗜️', '💽', '💾', '💿', '📀', '📼', '📷', '📸', '📹', '🎥', '📽️', '🎞️', '📞', '☎️', '📟', '📠', '📺', '📻', '🎙️', '🎚️', '🎛️', '🧭', '⏱️', '⏲️', '⏰', '🕰️', '⌛', '⏳', '📡', '🔋', '🔌', '💡', '🔦', '🕯️', '🪔', '🧯', '🛢️', '💸', '💵', '💴', '💶', '💷', '🪙', '💰', '💳', '💎', '⚖️', '🪜', '🧰', '🪛', '🔧', '🔨', '⚒️', '🛠️', '⛏️', '🪚', '🔩', '⚙️', '🪤', '🧱', '⛓️', '🧲', '🔫', '💣', '🧨', '🪓', '🔪', '🗡️', '⚔️', '🛡️', '🚬', '⚰️', '🪦', '⚱️', '🏺', '🔮', '📿', '🧿', '💈', '⚗️', '🔭', '🔬', '🕳️', '🩹', '🩺', '💊', '💉', '🩸', '🧬', '🦠', '🧫', '🧪', '🌡️', '🧹', '🪠', '🧺', '🧻', '🚽', '🚰', '🚿', '🛁', '🛀', '🧼', '🪥', '🪒', '🧽', '🪣', '🧴', '🛎️', '🔑', '🗝️', '🚪', '🪑', '🛋️', '🛏️', '🛌', '🧸', '🪆', '🖼️', '🪞', '🪟', '🛍️', '🛒', '🎁', '🎈', '🎏', '🎀', '🪄', '🪅', '🎊', '🎉', '🎎', '🏮', '🎐', '🧧', '✉️', '📩', '📨', '📧', '💌', '📥', '📤', '📦', '🏷️', '🪧', '📪', '📫', '📬', '📭', '📮', '📯', '📜', '📃', '📄', '📑', '🧾', '📊', '📈', '📉', '🗒️', '🗓️', '📆', '📅', '🗑️', '📇', '🗃️', '🗳️', '🗄️', '📋', '📁', '📂', '🗂️', '🗞️', '📰', '📓', '📔', '📒', '📕', '📗', '📘', '📙', '📚', '📖', '🔖', '🧷', '🔗', '📎', '🖇️', '📐', '📏', '🧮', '📌', '📍', '✂️', '🖊️', '🖋️', '✒️', '🖌️', '🖍️', '📝', '✏️', '🔍', '🔎', '🔏', '🔐', '🔒', '🔓']
    },
    symbols: {
        name: 'Символы',
        emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️', '✝️', '☪️', '🕉️', '☸️', '✡️', '🔯', '🕎', '☯️', '☦️', '🛐', '⛎', '♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓', '🆔', '⚛️', '🉑', '☢️', '☣️', '📴', '📳', '🈶', '🈚', '🈸', '🈺', '🈷️', '✴️', '🆚', '💮', '🉐', '㊙️', '㊗️', '🈴', '🈵', '🈹', '🈲', '🅰️', '🅱️', '🆎', '🆑', '🅾️', '🆘', '❌', '⭕', '🛑', '⛔', '📛', '🚫', '💯', '💢', '♨️', '🚷', '🚯', '🚳', '🚱', '🔞', '📵', '🚭', '❗', '❕', '❓', '❔', '‼️', '⁉️', '🔅', '🔆', '〽️', '⚠️', '🚸', '🔱', '⚜️', '🔰', '♻️', '✅', '🈯', '💹', '❇️', '✳️', '❎', '🌐', '💠', 'Ⓜ️', '🌀', '💤', '🏧', '🚾', '♿', '🅿️', '🛗', '🈳', '🈂️', '🛂', '🛃', '🛄', '🛅', '🚹', '🚺', '🚼', '⚧️', '🚻', '🚮', '🎦', '📶', '🈁', '🔣', 'ℹ️', '🔤', '🔡', '🔠', '🆖', '🆗', '🆙', '🆒', '🆕', '🆓', '0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟', '🔢', '#️⃣', '*️⃣', '⏏️', '▶️', '⏸️', '⏯️', '⏹️', '⏺️', '⏭️', '⏮️', '⏩', '⏪', '⏫', '⏬', '◀️', '🔼', '🔽', '➡️', '⬅️', '⬆️', '⬇️', '↗️', '↘️', '↙️', '↖️', '↕️', '↔️', '↪️', '↩️', '⤴️', '⤵️', '🔀', '🔁', '🔂', '🔄', '🔃', '🎵', '🎶', '➕', '➖', '➗', '✖️', '♾️', '💲', '💱', '™️', '©️', '®️', '〰️', '➰', '➿', '🔚', '🔙', '🔛', '🔝', '🔜', '✔️', '☑️', '🔘', '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪', '🟤', '🔺', '🔻', '🔸', '🔹', '🔶', '🔷', '🔳', '🔲', '▪️', '▫️', '◾', '◽', '◼️', '◻️', '🟥', '🟧', '🟨', '🟩', '🟦', '🟪', '⬛', '⬜', '🟫', '🔈', '🔇', '🔉', '🔊', '🔔', '🔕', '📣', '📢', '💬', '💭', '🗯️', '♠️', '♣️', '♥️', '♦️', '🃏', '🎴', '🀄', '🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚', '🕛', '🕜', '🕝', '🕞', '🕟', '🕠', '🕡', '🕢', '🕣', '🕤', '🕥', '🕦', '🕧']
    },
    flags: {
        name: 'Флаги',
        emojis: ['🏳️', '🏴', '🏴‍☠️', '🏁', '🚩', '🎌', '🏳️‍🌈', '🏳️‍⚧️', '🏴‍☠️', '🇺🇸', '🇬🇧', '🇷🇺', '🇺🇦', '🇧🇾', '🇰🇿', '🇪🇸', '🇫🇷', '🇩🇪', '🇮🇹', '🇯🇵', '🇰🇷', '🇨🇳', '🇮🇳', '🇧🇷', '🇲🇽', '🇨🇦', '🇦🇺', '🇳🇱', '🇵🇱', '🇨🇭', '🇸🇪', '🇳🇴', '🇩🇰', '🇫🇮', '🇵🇹', '🇬🇷', '🇹🇷', '🇿🇦', '🇪🇬', '🇮🇱', '🇸🇦', '🇦🇪', '🇹🇭', '🇻🇳', '🇮🇩', '🇵🇭', '🇲🇾', '🇸🇬', '🇳🇵', '🇱🇰', '🇧🇩', '🇵🇰', '🇮🇷', '🇮🇶', '🇰🇼', '🇶🇦', '🇧🇭', '🇴🇲', '🇾🇪', '🇸🇾', '🇱🇧', '🇸🇩', '🇸🇸', '🇪🇹', '🇪🇷', '🇩🇯', '🇰🇪', '🇹🇿', '🇺🇬', '🇷🇼', '🇧🇮', '🇪🇿', '🇳🇪', '🇸🇳', '🇬🇳', '🇸🇱', '🇱🇷', '🇨🇮', '🇬🇭', '🇳🇬', '🇬🇲', '🇬🇦', '🇸🇿', '🇱🇸', '🇧🇼', '🇳🇦', '🇲🇿', '🇿🇦', '🇱🇽', '🇲🇬', '🇲🇱', '🇨🇲', '🇨🇫', '🇹🇩', '🇨🇬', '🇨🇩', '🇷🇬', '🇦🇴', '🇿🇲', '🇲🇼', '🇲🇦', '🇩🇿', '🇱🇾', '🇹🇳', '🇲🇹', '🇨🇾', '🇭🇷', '🇷🇸', '🇸🇮', '🇲🇪', '🇧🇦', '🇲🇰', '🇦🇱', '🇲🇩', '🇺🇦', '🇪🇪', '🇱🇻', '🇱🇹', '🇱🇺', '🇧🇪', '🇳🇱', '🇱🇺', '🇭🇺', '🇦🇹', '🇨🇿', '🇸🇰', '🇮🇪', '🇬🇮', '🇻🇦', '🇸🇲', '🇦🇩', '🇲🇨', '🇲🇦', '🇯🇪', '🇬🇪', '🇦🇲', '🇦🇿', '🇬🇪', '🇰🇬', '🇹🇯', '🇹🇲', '🇺🇿', '🇦🇫', '🇦🇱', '🇧🇹', '🇧🇳', '🇰🇭', '🇱🇦', '🇲🇲', '🇲🇳', '🇲🇬', '🇵🇬', '🇸🇧', '🇻🇺', '🇼🇸', '🇲🇵', '🇬🇺', '🇵🇫', '🇵🇳', '🇳🇷', '🇳🇫', '🇹🇰', '🇸🇭', '🇲🇶', '🇬🇵', '🇩🇬', '🇦🇬', '🇦🇮', '🇧🇧', '🇨🇼', '🇨🇩', '🇨🇬', '🇩🇲', '🇬🇩', '🇭🇹', '🇯🇲', '🇰🇳', '🇱🇨', '🇲🇫', '🇲🇸', '🇳🇵', '🇰🇷', '🇵🇲', '🇸🇭', '🇸🇨', '🇸🇩', '🇸🇸', '🇸🇹', '🇹🇨', '🇹🇩', '🇹🇬', '🇹🇹', '🇹🇻', '🇻🇬', '🇻🇮']
    }
};

// Emoji picker state
let activeEmojiCategory = 'custom';
let emojiPicker = null;
let emojiBtn = null;
let emojiGrid = null;

function initEmojiPicker() {
    emojiPicker = document.getElementById('emojiPicker');
    emojiBtn = document.getElementById('emojiBtn');
    emojiGrid = document.getElementById('emojiGrid');

    if (!emojiPicker || !emojiBtn || !emojiGrid) {
        console.warn('[emoji] Elements not found');
        return;
    }

    // Toggle emoji picker on button click
    emojiBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleEmojiPicker();
    });

    // Close picker when clicking outside
    document.addEventListener('click', (e) => {
        if (!emojiPicker.contains(e.target) && e.target !== emojiBtn && !emojiBtn.contains(e.target)) {
            closeEmojiPicker();
        }
    });

    // Tab switching (Эмодзи, Стикеры, Гифки)
    const tabBtns = emojiPicker.querySelectorAll('.emoji-tab');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            const tab = btn.dataset.tab;
            
            // Hide all content sections
            const contents = emojiPicker.querySelectorAll('.emoji-content');
            contents.forEach(c => c.classList.add('hidden'));
            
            // Show selected content
            if (tab === 'emoji') {
                document.getElementById('emojiContent').classList.remove('hidden');
            } else if (tab === 'stickers') {
                document.getElementById('stickersContent').classList.remove('hidden');
                // Load stickers if not loaded
                if (stickers.length === 0) {
                    loadStickers();
                }
            } else if (tab === 'gifs') {
                document.getElementById('gifsContent').classList.remove('hidden');
                // Load gifs if not loaded
                if (gifs.length === 0) {
                    loadGifs();
                }
            }
        });
    });

    // Category buttons within emoji tab
    const categoryBtns = emojiPicker.querySelectorAll('.emoji-category-btn');
    categoryBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            categoryBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeEmojiCategory = btn.dataset.category;
            renderEmojis(activeEmojiCategory);
        });
    });

    // Initial render
    renderEmojis('custom');
    
    // Load all media for shortcode support and emoji picker
    loadAllMedia();
}

// Load all media (emoji, stickers, gifs) at once
async function loadAllMedia() {
    try {
        const response = await fetch('/api/media?_=' + Date.now());
        if (response.ok) {
            const data = await response.json();
            
            if (data.emojis && data.emojis.length > 0) {
                customEmojis = data.emojis;
                console.log('[media] Emojis loaded:', customEmojis.length);
                // Render if on custom emoji category
                if (activeEmojiCategory === 'custom') {
                    renderCustomEmojis();
                }
            }
            
            if (data.stickers && data.stickers.length > 0) {
                stickers = data.stickers;
                console.log('[media] Stickers loaded:', stickers.length);
                renderStickers();
            }
            
            if (data.gifs && data.gifs.length > 0) {
                gifs = data.gifs;
                console.log('[media] GIFs loaded:', gifs.length);
                renderGifs();
            }
            
            console.log('[media] All media loaded');
        }
    } catch (err) {
        console.warn('[media] Could not load media:', err);
        // Fallback to individual loads
        loadCustomEmojis();
        loadStickers();
        loadGifs();
    }
}

function toggleEmojiPicker() {
    if (emojiPicker.classList.contains('hidden')) {
        openEmojiPicker();
    } else {
        closeEmojiPicker();
    }
}

function openEmojiPicker() {
    emojiPicker.classList.remove('hidden');
    
    // Reset tab to emoji
    const tabBtns = emojiPicker.querySelectorAll('.emoji-tab');
    tabBtns.forEach(b => b.classList.remove('active'));
    const emojiTab = emojiPicker.querySelector('[data-tab="emoji"]');
    if (emojiTab) emojiTab.classList.add('active');
    
    // Show emoji content, hide others
    const contents = emojiPicker.querySelectorAll('.emoji-content');
    contents.forEach(c => c.classList.add('hidden'));
    document.getElementById('emojiContent').classList.remove('hidden');
    
    // Reset category
    const activeBtn = emojiPicker.querySelector('.emoji-category-btn.active');
    if (activeBtn) {
        activeBtn.classList.remove('active');
    }
    const defaultBtn = emojiPicker.querySelector('[data-category="custom"]');
    if (defaultBtn) defaultBtn.classList.add('active');
    activeEmojiCategory = 'custom';
    renderEmojis('custom');
}

function closeEmojiPicker() {
    emojiPicker.classList.add('hidden');
}

// Custom emoji files cache
let customEmojis = ['Anime.gif']; // Default, will be loaded from server
let stickers = []; // Stickers cache
let gifs = []; // GIFs cache

// Load custom emojis from server
async function loadCustomEmojis() {
    try {
        // Add timestamp to prevent caching
        const response = await fetch('/api/emoji?_=' + Date.now());
        if (response.ok) {
            const data = await response.json();
            if (data.emojis && data.emojis.length > 0) {
                customEmojis = data.emojis;
                console.log('[emoji] Custom emojis loaded:', customEmojis.length);
                // Always re-render when emojis are loaded
                renderCustomEmojis();
            }
        }
    } catch (err) {
        console.warn('[emoji] Could not load custom emojis:', err);
    }
}

// Load stickers from server
async function loadStickers() {
    const stickersGrid = document.getElementById('stickersGrid');
    if (!stickersGrid) {
        console.warn('[stickers] Stickers grid not found in DOM');
        return;
    }
    
    stickersGrid.innerHTML = '<div class="emoji-loading">Загрузка стикеров...</div>';
    
    try {
        const response = await fetch('/api/stickers?_=' + Date.now());
        if (response.ok) {
            const data = await response.json();
            if (data.stickers && data.stickers.length > 0) {
                stickers = data.stickers;
                console.log('[stickers] Stickers loaded:', stickers.length);
                renderStickers();
            } else {
                stickersGrid.innerHTML = '<div class="emoji-empty">Нет доступных стикеров</div>';
            }
        } else {
            stickersGrid.innerHTML = '<div class="emoji-empty">Не удалось загрузить стикеры</div>';
        }
    } catch (err) {
        console.warn('[stickers] Could not load stickers:', err);
        stickersGrid.innerHTML = '<div class="emoji-empty">Ошибка загрузки стикеров</div>';
    }
}

// Render stickers in the grid
function renderStickers() {
    const stickersGrid = document.getElementById('stickersGrid');
    if (!stickersGrid) return;
    
    if (stickers.length === 0) {
        stickersGrid.innerHTML = '<div class="emoji-empty">Нет доступных стикеров</div>';
        return;
    }
    
    stickersGrid.innerHTML = '';
    
    stickers.forEach(stickerFile => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sticker-item';
        btn.title = stickerFile.replace(/\.(png|jpg|gif|webp)$/i, '');
        
        const img = document.createElement('img');
        img.src = '/stickers/' + stickerFile;
        img.alt = stickerFile;
        img.loading = 'lazy';
        
        btn.appendChild(img);
        btn.addEventListener('click', () => insertSticker('/stickers/' + stickerFile, stickerFile, true));
        stickersGrid.appendChild(btn);
    });
}

// Insert sticker into message input
function insertSticker(stickerUrl, stickerName, autoSend = false) {
    const messageInput = document.getElementById('messageInput');
    if (!messageInput) return;
    
    // Insert sticker as markdown image tag
    const name = stickerName.replace(/\.(png|jpg|gif|webp)$/i, '');
    const stickerMarkdown = `![${name}](${stickerUrl})`;
    
    const start = messageInput.selectionStart;
    const end = messageInput.selectionEnd;
    const text = messageInput.value;
    
    messageInput.value = text.substring(0, start) + stickerMarkdown + text.substring(end);
    
    // Move cursor after sticker
    const newPos = start + stickerMarkdown.length;
    messageInput.setSelectionRange(newPos, newPos);
    messageInput.focus();
    
    closeEmojiPicker();
    
    // Auto-send if requested
    if (autoSend) {
        sendMessage();
    }
}

// Load GIFs from server
async function loadGifs() {
    const gifsGrid = document.getElementById('gifsGrid');
    if (!gifsGrid) {
        console.warn('[gifs] GIFs grid not found in DOM');
        return;
    }
    
    gifsGrid.innerHTML = '<div class="emoji-loading">Загрузка гифок...</div>';
    
    try {
        const response = await fetch('/api/gifs?_=' + Date.now());
        if (response.ok) {
            const data = await response.json();
            if (data.gifs && data.gifs.length > 0) {
                gifs = data.gifs;
                console.log('[gifs] GIFs loaded:', gifs.length);
                renderGifs();
            } else {
                gifsGrid.innerHTML = '<div class="emoji-empty">Нет доступных гифок</div>';
            }
        } else {
            gifsGrid.innerHTML = '<div class="emoji-empty">Не удалось загрузить гифки</div>';
        }
    } catch (err) {
        console.warn('[gifs] Could not load gifs:', err);
        gifsGrid.innerHTML = '<div class="emoji-empty">Ошибка загрузки гифок</div>';
    }
}

// Render GIFs in the grid
function renderGifs() {
    const gifsGrid = document.getElementById('gifsGrid');
    if (!gifsGrid) return;
    
    if (gifs.length === 0) {
        gifsGrid.innerHTML = '<div class="emoji-empty">Нет доступных гифок</div>';
        return;
    }
    
    gifsGrid.innerHTML = '';
    
    gifs.forEach(gifFile => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'gif-item';
        btn.title = gifFile.replace(/\.(gif|webp)$/i, '');
        
        const img = document.createElement('img');
        img.src = '/gifs/' + gifFile;
        img.alt = gifFile;
        img.loading = 'lazy';
        
        btn.appendChild(img);
        btn.addEventListener('click', () => insertGif('/gifs/' + gifFile, gifFile, true));
        gifsGrid.appendChild(btn);
    });
}

// Insert GIF into message input
function insertGif(gifUrl, gifName, autoSend = false) {
    const messageInput = document.getElementById('messageInput');
    if (!messageInput) return;
    
    // Insert GIF as markdown image tag
    const name = gifName.replace(/\.(gif|webp)$/i, '');
    const gifMarkdown = `![${name}](${gifUrl})`;
    
    const start = messageInput.selectionStart;
    const end = messageInput.selectionEnd;
    const text = messageInput.value;
    
    messageInput.value = text.substring(0, start) + gifMarkdown + text.substring(end);
    
    // Move cursor after GIF
    const newPos = start + gifMarkdown.length;
    messageInput.setSelectionRange(newPos, newPos);
    messageInput.focus();
    
    closeEmojiPicker();
    
    // Auto-send if requested
    if (autoSend) {
        sendMessage();
    }
}

function renderEmojis(category) {
    if (!emojiGrid || !EMOJI_CATEGORIES[category]) return;

    const cat = EMOJI_CATEGORIES[category];
    
    // Handle custom emoji category (GIFs)
    if (cat.isCustom) {
        renderCustomEmojis();
        return;
    }

    const emojis = cat.emojis;
    emojiGrid.innerHTML = '';

    emojis.forEach(emoji => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'emoji-item';
        btn.textContent = emoji;
        btn.addEventListener('click', () => insertEmoji(emoji));
        emojiGrid.appendChild(btn);
    });
}

function renderCustomEmojis() {
    emojiGrid.innerHTML = '';
    
    if (customEmojis.length === 0) {
        emojiGrid.innerHTML = '<div class="emoji-no-custom">Загрузка кастомных эмодзи...</div>';
        loadCustomEmojis();  // Trigger load if empty
        return;
    }

    customEmojis.forEach(emojiFile => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'emoji-item custom-emoji-item';
        // Remove any image extension from the title
        btn.title = emojiFile.replace(/\.(gif|png|jpg|jpeg|webp)$/i, '');
        
        const img = document.createElement('img');
        img.src = '/emoji/' + emojiFile;
        img.alt = emojiFile;
        img.className = 'custom-emoji-img';
        
        btn.appendChild(img);
        btn.addEventListener('click', () => insertCustomEmoji('/emoji/' + emojiFile));
        emojiGrid.appendChild(btn);
    });
}

function insertCustomEmoji(emojiUrl) {
    const messageInput = document.getElementById('messageInput');
    if (!messageInput) return;

    // Insert custom emoji as markdown image tag (like Discord)
    const emojiName = emojiUrl.split('/').pop().replace('.gif', '');
    const emojiMarkdown = `![${emojiName}](${emojiUrl})`;
    
    // Insert at cursor position
    const start = messageInput.selectionStart;
    const end = messageInput.selectionEnd;
    const text = messageInput.value;

    messageInput.value = text.substring(0, start) + emojiMarkdown + text.substring(end);

    // Move cursor after emoji
    const newPos = start + emojiMarkdown.length;
    messageInput.setSelectionRange(newPos, newPos);
    messageInput.focus();

    // Close picker after selection
    closeEmojiPicker();

    // Trigger input event to update UI
    messageInput.dispatchEvent(new Event('input', { bubbles: true }));
}

function insertEmoji(emoji) {
    const messageInput = document.getElementById('messageInput');
    if (!messageInput) return;

    // Insert emoji at cursor position
    const start = messageInput.selectionStart;
    const end = messageInput.selectionEnd;
    const text = messageInput.value;

    messageInput.value = text.substring(0, start) + emoji + text.substring(end);

    // Move cursor after emoji
    const newPos = start + emoji.length;
    messageInput.setSelectionRange(newPos, newPos);
    messageInput.focus();

    // Close picker after selection
    closeEmojiPicker();

    // Trigger input event to update UI
    messageInput.dispatchEvent(new Event('input', { bubbles: true }));
}

let voiceRooms = [];
let currentVoiceRoomId = null;
let voiceParticipants = [];

// Typing indicator state
const TYPING_TIMEOUT_MS = 3000;  // Time before stopping typing indicator
const TYPING_DEBOUNCE_MS = 500;  // Debounce time between typing events
let typingTimeout = null;
let typingUsers = {};  // { userId: timeout }
let localStream = null;
let isMuted = false;
let isDeafened = false;
const peerConnections = new Map();
const voiceRoomParticipantsByRoom = {};

const voiceJoinSound = new Audio('./sounds/voice_join.wav');
const voiceLeaveSound = new Audio('./sounds/voice_leave.wav');
const streamStartSound = new Audio('./sounds/stream_start.wav');
const streamEndSound = new Audio('./sounds/stream_end.wav');
voiceJoinSound.preload = 'auto';
voiceLeaveSound.preload = 'auto';
streamStartSound.preload = 'auto';
streamEndSound.preload = 'auto';

// Profile message button sound
const profileMessageSound = new Audio('./sounds/net-idi-na.mp3');
profileMessageSound.preload = 'auto';

const participantVolumes = JSON.parse(localStorage.getItem('participantVolumes') || "{}");
let micGainValue = 1;
let headphonesGainValue = 2;
let micAudioContext = null;
let micGainNode = null;
let processedOutboundStream = null;

// Web Audio GainNodes for remote participants (allows gain > 1.0 unlike audio.volume)
const remoteAudioGainNodes = new Map(); // userId -> { audioCtx, gainNode }

let localScreenStream = null;
let pendingScreenStream = null;
let isScreenShareStopping = false;
let activeScreenViewerUserId = null;
const remoteScreenStreams = new Map();
const remoteAudioStreams = new Map();
const localScreenSenders = new Map();
const popoutWindows = new Map();
const peerRenegotiationLocks = new Set();

// ==========================================
// RATE LIMITING (Discord-like)
// ==========================================

const RATE_LIMIT_WINDOW_MS = 2000;    // 5 seconds window to detect rapid messages
const RATE_LIMIT_WARNING_THRESHOLD = 5;  // 3 messages in window triggers warning
const RATE_LIMIT_TIMEOUT_MS = 5000;     // 10 second timeout after exceeding limit

let messageTimestamps = [];  // Array of timestamps for recent messages
let isRateLimited = false;   // Whether user is currently rate limited
let rateLimitTimeout = null; // Timer for auto-clearing rate limit
let rateLimitWarningEl = null;  // Warning message DOM element

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
const markdownPopup = document.getElementById('markdownPopup');
const connectionStatus = document.getElementById('connectionStatus');
const connectionStatsPopup = document.getElementById('connectionStatsPopup');
const createRoomBtn = document.getElementById('createRoomBtn');
const createRoomModal = document.getElementById('createRoomModal');
const createRoomForm = document.getElementById('createRoomForm');
const roomNameInput = document.getElementById('roomNameInput');
const roomTypeInput = document.getElementById('roomTypeInput');
const closeModalBtn = document.getElementById('closeModalBtn');
const cancelModalBtn = document.getElementById('cancelModalBtn');
const settingsBtn = document.getElementById('settingsBtn');
const activitiesBtn = document.getElementById('activitiesBtn');
const activitiesModal = document.getElementById('activitiesModal');
const avatarDropdown = document.getElementById('avatarDropdown');
const settingsBtnSidebar = document.getElementById('settingsBtnSidebar');
const activitiesTab = document.getElementById('activitiesTab');
const activitiesOverlay = document.getElementById('activitiesOverlay');
const activitiesCloseBtn = document.getElementById('activitiesCloseBtn');
const gameFrame = document.getElementById('gameFrame');
const activitiesPlaceholder = document.getElementById('activitiesPlaceholder');
const launchGameBtn = document.getElementById('launchGameBtn');
const launchWordleBtn = document.getElementById('launchWordleBtn');
const openNewTabBtn = document.getElementById('openNewTabBtn');
const dndBtn = document.getElementById('dndBtn');
const settingsModal = document.getElementById('settingsModal');
const settingsForm = document.getElementById('settingsForm');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const cancelSettingsBtn = document.getElementById('cancelSettingsBtn');
const logoutBtn = document.getElementById('logoutBtn');
const settingsDisplayName = document.getElementById('settingsDisplayName');
const settingsUsername = document.getElementById('settingsUsername');
const avatarInput = document.getElementById('avatarInput');
const removeAvatarBtn = document.getElementById('removeAvatarBtn');
const settingsAvatarPreview = document.getElementById('settingsAvatarPreview');

// Prevent browser-native validation from trying to focus hidden controls.
if (settingsForm) {
    settingsForm.noValidate = true;
}

// User profile popup elements
const userProfilePopup = document.getElementById('userProfilePopup');
const userProfileBackdrop = document.getElementById('userProfileBackdrop');
const userProfileCloseBtn = document.getElementById('userProfileCloseBtn');
const userProfileMessageBtn = document.getElementById('userProfileMessageBtn');
const userProfileAvatar = document.getElementById('userProfileAvatar');
const userProfileName = document.getElementById('userProfileName');
const userProfileUsername = document.getElementById('userProfileUsername');
const userProfileMemberSince = document.getElementById('userProfileMemberSince');

// Store current profile user ID
let currentProfileUserId = null;

// Function to fetch user profile from API
async function fetchUserProfile(userId) {
    try {
        const response = await fetchWithAuth(`${getApiUrl()}/auth/users/${userId}`);
        if (!response.ok) {
            if (response.status === 404) {
                showNotification('Пользователь не найден', 'error');
            } else {
                showNotification('Ошибка загрузки профиля', 'error');
            }
            return null;
        }
        return await response.json();
    } catch (err) {
        console.error('Failed to fetch user profile:', err);
        showNotification('Ошибка загрузки профиля', 'error');
        return null;
    }
}

// Function to show user profile popup
function showUserProfile(userId, clickEvent = null) {
    currentProfileUserId = userId;
    userProfilePopup.classList.remove('hidden');
    
    // Show loading state with animation
    userProfileName.textContent = 'Загрузка...';
    userProfileUsername.textContent = '';
    userProfileMemberSince.textContent = '';
    userProfileAvatar.innerHTML = '<div class="user-profile-avatar-placeholder">?</div>';
    userProfileMessageBtn.disabled = true;
    userProfileMessageBtn.innerHTML = '<div class="user-profile-loading-spinner"></div>';
    
    // Position popup near the click or center if no click event
    const card = userProfilePopup.querySelector('.user-profile-card');
    if (card) {
        if (clickEvent && clickEvent.clientX && clickEvent.clientY) {
            // Position near the clicked element (Discord-style)
            let posX = clickEvent.clientX + 20;
            let posY = clickEvent.clientY - 50;
            
            // Adjust if popup would go off screen
            const popupWidth = 260;
            const popupHeight = 320;
            
            // Horizontal adjustment
            if (posX + popupWidth > window.innerWidth - 20) {
                posX = clickEvent.clientX - popupWidth - 20;
            }
            // Vertical adjustment
            if (posY + popupHeight > window.innerHeight - 20) {
                posY = window.innerHeight - popupHeight - 20;
            }
            if (posY < 20) {
                posY = 20;
            }
            
            card.style.left = posX + 'px';
            card.style.top = posY + 'px';
            card.style.transform = 'none';
        } else {
            // Center on screen
            card.style.left = '50%';
            card.style.top = '50%';
            card.style.transform = 'translate(-50%, -50%)';
        }
    }
    
    // Fetch user data
    fetchUserProfile(userId).then(user => {
        if (!user) {
            hideUserProfile();
            return;
        }
        
        // Update profile data
        userProfileName.textContent = user.display_name || user.username;
        userProfileUsername.textContent = '@' + user.username;
        
        // Format member since date
        const createdDate = new Date(user.created_at);
        const formattedDate = createdDate.toLocaleDateString('ru-RU', {
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        });
        userProfileMemberSince.textContent = formattedDate;
        
        // Set avatar (no crown in profile popup)
        if (user.avatar_url) {
            const avatarUrl = withAvatarCacheBuster(
        normalizeAvatarUrl(user.avatar_url),
        user.id
    );
            userProfileAvatar.innerHTML = `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(user.display_name || user.username)}" class="user-profile-avatar-img">`;
        } else {
            const initial = (user.display_name || user.username)[0]?.toUpperCase() || 'U';
            userProfileAvatar.innerHTML = `<div class="user-profile-avatar-placeholder">${initial}</div>`;
        }
        
        // Enable/disable message button based on whether it's the current user
        userProfileMessageBtn.disabled = (userId === currentUser?.id);
        userProfileMessageBtn.innerHTML = userId === currentUser?.id 
            ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg> Это вы'
            : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg> Написать';
    });
}

// Function to hide user profile popup
function hideUserProfile() {
    userProfilePopup.classList.add('hidden');
    currentProfileUserId = null;
}

// Handle profile close button click
if (userProfileCloseBtn) {
    userProfileCloseBtn.addEventListener('click', hideUserProfile);
}

// Handle backdrop click to close
if (userProfileBackdrop) {
    userProfileBackdrop.addEventListener('click', hideUserProfile);
}

// Handle message button click
if (userProfileMessageBtn) {
    userProfileMessageBtn.addEventListener('click', () => {
        if (currentProfileUserId && currentProfileUserId !== currentUser?.id) {
            // Play sound
            try {
                profileMessageSound.currentTime = 0;
                profileMessageSound.play().catch(err => {
                    console.warn('[Profile] Sound playback failed:', err);
                });
            } catch (err) {
                console.warn('[Profile] Sound error:', err);
            }
            // Close profile and start a DM (future feature - for now just close)
            hideUserProfile();
            showNotification('Личные сообщения скоро будут доступны!', 'info');
        }
    });
}

// Handle ESC key to close profile
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && userProfilePopup && !userProfilePopup.classList.contains('hidden')) {
        hideUserProfile();
    }
});

// Function to attach profile click handler to message avatar
function attachProfileClickHandlerToMessage(messageEl, userId) {
    const avatar = messageEl.querySelector('.message-avatar');
    if (avatar) {
        avatar.style.cursor = 'pointer';
        avatar.addEventListener('click', (e) => {
            e.stopPropagation();
            showUserProfile(userId, e);
        });
        
        // Also handle img if present
        const avatarImg = messageEl.querySelector('.avatar-media--message');
        if (avatarImg) {
            avatarImg.style.cursor = 'pointer';
        }
    }
}

// Function to attach profile click handler to user list item
function attachProfileClickHandlerToUserItem(userItemEl, userId) {
    const avatar = userItemEl.querySelector('.user-avatar');
    if (avatar) {
        avatar.style.cursor = 'pointer';
        avatar.addEventListener('click', (e) => {
            e.stopPropagation();
            showUserProfile(userId, e);
        });
        
        // Also make the whole item clickable
        userItemEl.style.cursor = 'pointer';
        userItemEl.addEventListener('click', (e) => {
            showUserProfile(userId, e);
        });
    }
}

// Attach click handlers to all user items in the users list
function attachClickHandlersToUserList() {
    const usersList = document.getElementById('usersList');
    if (!usersList) return;
    
    const userItems = usersList.querySelectorAll('.user-item');
    userItems.forEach(item => {
        const userId = item.dataset.userId;
        if (userId) {
            attachProfileClickHandlerToUserItem(item, parseInt(userId, 10));
        }
    });
}

const avatarCropperContainer = document.getElementById('avatarCropperContainer');
const cropperImage = document.getElementById('cropperImage');
const cropperPreviewInner = document.getElementById('cropperPreviewInner');
const cropperZoomSlider = document.getElementById('cropperZoomSlider');
const closeCropperBtn = document.getElementById('closeCropperBtn');
const cancelCropBtn = document.getElementById('cancelCropBtn');
const applyCropBtn = document.getElementById('applyCropBtn');
const currentUserAvatar = document.getElementById('currentUserAvatar');

// Avatar cropper state
let cropperImageData = null;
let cropperOriginalImage = null; // Original loaded image for cropping
let panX = 0;
let panY = 0;
let cropScale = 1;
const outputSize = 256; // Fixed output size
const currentUserName = document.getElementById('currentUserName');
const currentUserUsername = document.getElementById('currentUserUsername');
const voiceRoomsList = document.getElementById('voiceRoomsList');
const createVoiceRoomBtn = document.getElementById('createVoiceRoomBtn');
const toggleMicBtn = document.getElementById('toggleMicBtn');
const toggleDeafenBtn = document.getElementById('toggleDeafenBtn');
const toggleScreenShareBtn = document.getElementById('toggleScreenShareBtn');
const leaveVoiceBtn = document.getElementById('leaveVoiceBtn');
const voiceRoomState = document.getElementById('voiceRoomState');
const voiceParticipantsGrid = document.getElementById('voiceParticipantsGrid');
const voiceCollapsedParticipants = document.getElementById('voiceCollapsedParticipants');
const collapseVoiceBtn = document.getElementById('collapseVoiceBtn');
const collapseIcon = document.getElementById('collapseIcon');
const voiceOverlay = document.getElementById('voiceOverlay');
const voiceControls = document.getElementById('voiceControls');
const screenShareStage = document.getElementById('screenShareStage');
const screenShareGrid = document.getElementById('screenShareGrid');
const screenShareCount = document.getElementById('screenShareCount');
const localAudioControls = document.getElementById('localAudioControls');
const voiceSettingsPanel = document.getElementById('voiceSettingsPanel');
const toggleVoiceSettingsBtn = document.getElementById('toggleVoiceSettingsBtn');
const micVolumeSlider = document.getElementById('micVolumeSlider');
const headphoneVolumeSlider = document.getElementById('headphoneVolumeSlider');
const micVolumeValue = document.getElementById('micVolumeValue');
const headphoneVolumeValue = document.getElementById('headphoneVolumeValue');

const screenShareModal = document.getElementById('screenShareModal');
const closeScreenShareModalBtn = document.getElementById('closeScreenShareModalBtn');
const cancelScreenShareBtn = document.getElementById('cancelScreenShareBtn');
const startScreenShareBtn = document.getElementById('startScreenShareBtn');
const pickScreenSourceBtn = document.getElementById('pickScreenSourceBtn');
const screenSharePreviewWrap = document.getElementById('screenSharePreviewWrap');
const screenSharePreview = document.getElementById('screenSharePreview');
const screenSharePreviewMeta = document.getElementById('screenSharePreviewMeta');
const screenShareQuality = document.getElementById('screenShareQuality');
const screenShareAudio = document.getElementById('screenShareAudio');

const screenViewerModal = document.getElementById('screenViewerModal');
const closeScreenViewerModalBtn = document.getElementById('closeScreenViewerModalBtn');
const screenViewerVideo = document.getElementById('screenViewerVideo');
const screenViewerTitle = document.getElementById('screenViewerTitle');
const screenViewerPopoutBtn = document.getElementById('screenViewerPopoutBtn');
const screenViewerPipBtn = document.getElementById('screenViewerPipBtn');

// Settings modal tab elements
const logoutConfirmModal = document.getElementById('logoutConfirmModal');
const cancelLogoutBtn = document.getElementById('cancelLogoutBtn');
const confirmLogoutBtn = document.getElementById('confirmLogoutBtn');
const settingsTabBtns = document.querySelectorAll('.settings-tab-btn');
const settingsTabPanels = document.querySelectorAll('.settings-tab-panel');
const settingsMicVolume = document.getElementById('settingsMicVolume');
const settingsHeadphoneVolume = document.getElementById('settingsHeadphoneVolume');
const settingsMicVolumeValue = document.getElementById('settingsMicVolumeValue');
const settingsHeadphoneVolumeValue = document.getElementById('settingsHeadphoneVolumeValue');

const replyPreview = document.createElement('div');

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
replyPreview.className = 'reply-preview hidden';
replyPreview.innerHTML = '<div class="reply-preview-content"></div><button class="reply-preview-close" type="button">✕</button>';
messageForm.parentElement.insertBefore(replyPreview, messageForm);

const messageContextMenu = document.createElement('div');
messageContextMenu.className = 'message-context-menu hidden';
messageContextMenu.innerHTML = `
    <div class="context-quick-reactions" data-context-quick-reactions></div>
    <button type="button" class="context-main-action" data-context-action="react">Добавить реакцию <span>›</span></button>
    <div class="context-divider"></div>
    <button type="button" class="context-main-action" data-context-action="reply">Ответить <span>↩</span></button>
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

// ==========================================
// AUTH FUNCTIONS
// ==========================================

function redirectToLogin() {
    window.location.href = getAppRoutes().login;
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
    messageEl.dataset.messageId = msg.id;
    messageEl.dataset.userId = msg.user?.id || 0;

    // message-unread больше не нужен — оставляем только divider

    const author = msg.user?.display_name || msg.author || 'Unknown';
    const username = msg.user?.username || 'unknown';
    const authorInitial = author[0].toUpperCase();
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


    messageEl.innerHTML = `
        <div class="message-avatar-wrapper">
            ${adminCrownHtml}
            <div class="message-avatar">
                ${avatarUrl
                    ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(author)}" class="avatar-media avatar-media--message">`
                    : `<span>${authorInitial}</span>`}
            </div>
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
            <div class="message-reactions" data-reactions-for="${msg.id}">${reactionsHtml}</div>
            <div class="message-hover-actions">
                <button class="message-plus-btn" data-open-reaction-picker="${msg.id}" type="button">${getRandomReactionTriggerEmoji()}</button>
                <button class="message-all-emoji-btn" data-open-all-emoji="${msg.id}" type="button">＋</button>
                <button class="message-reply-btn" data-hover-reply="${msg.id}" type="button"${isDeleted ? ' disabled' : ''}>↩</button>
                <div class="message-reaction-picker hidden" data-reaction-picker-for="${msg.id}">${renderReactionPicker(msg.id)}</div>
            </div>
        </div>
    `;

    const avatarImage = messageEl.querySelector('.avatar-media');
    if (avatarImage) {
        avatarImage.addEventListener('error', () => {
            const avatarWrapper = messageEl.querySelector('.message-avatar-wrapper');
            if (avatarWrapper) {
                avatarWrapper.innerHTML = `${adminCrownHtml}<div class="message-avatar"><span>${escapeHtml(authorInitial)}</span></div>`;
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
    const popular = REACTION_EMOJIS.map((emoji) => `
        <button class="reaction-add-btn" data-add-reaction="${escapeHtml(emoji)}" data-message-id="${messageId}" type="button">${escapeHtml(emoji)}</button>
    `).join('');
    return `${popular}<button class="reaction-add-btn reaction-add-btn--all" data-open-all-emoji="${messageId}" type="button">＋</button>`;
}

function renderReplyPreview(replyTo) {
    if (!replyTo) return '';
    const user = replyTo.user?.display_name || replyTo.user?.username || 'Unknown';
    const body = (replyTo.body || '').trim();
    const shortBody = body.length > 120 ? `${body.slice(0, 120)}...` : body;
    return `<button class="message-reply" data-jump-to-message="${replyTo.id}" type="button">↩ <strong>${escapeHtml(user)}</strong>: ${parseMarkdownWithEscaping(shortBody || '[вложение]')}</button>`;
}

function jumpToMessage(messageId) {
    const target = messagesList.querySelector(`[data-message-id="${messageId}"]`);
    if (!target) return;

    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('message-jump-highlight');
    setTimeout(() => target.classList.remove('message-jump-highlight'), 1400);
}

function setReplyTarget(messageEl) {
    if (!messageEl) return;
    if (messageEl.dataset.isDeleted === '1') return;
    const author = messageEl.querySelector('.message-author')?.textContent || 'Unknown';
    const text = messageEl.querySelector('.message-text')?.textContent || '[вложение]';
    replyToMessage = { id: Number(messageEl.dataset.messageId), author, body: text };
    const shortText = text.length > 120 ? `${text.slice(0, 120)}...` : text;
    replyPreview.querySelector('.reply-preview-content').textContent = `Ответ ${author}: ${shortText}`;
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
    const deleteBtn = messageContextMenu.querySelector('[data-context-action="delete"]');
    const hardDeleteBtn = messageContextMenu.querySelector('[data-context-action="delete_hard"]');
    const reactBtn = messageContextMenu.querySelector('[data-context-action="react"]');
    const replyBtn = messageContextMenu.querySelector('[data-context-action="reply"]');
    const quickReactions = messageContextMenu.querySelector('[data-context-quick-reactions]');

    if (deleteBtn) {
        deleteBtn.classList.toggle('hidden', Number(messageUserId) !== Number(currentUser?.id));
    }
    if (hardDeleteBtn) {
        hardDeleteBtn.classList.toggle('hidden', currentUser?.role !== 'admin');
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
    const previousMyState = {};
    for (const chip of container.querySelectorAll('.reaction-chip')) {
        previousMyState[chip.dataset.emoji] = chip.classList.contains('active');
    }

    const incoming = reactions || [];
    const byEmoji = Object.fromEntries(incoming.map((r) => [r.emoji, { ...r }]));

    for (const reaction of incoming) {
        const emoji = reaction.emoji;
        let reactedByMe = previousMyState[emoji] || false;

        if (Number(actorUserId) === Number(currentUser?.id) && emoji === actionEmoji) {
            reactedByMe = action === 'added';
        }

        byEmoji[emoji].reacted_by_me = reactedByMe;
    }

    const ordered = [];
    const seen = new Set();
    for (const emoji of previousOrder) {
        if (byEmoji[emoji]) {
            ordered.push(byEmoji[emoji]);
            seen.add(emoji);
        }
    }
    for (const reaction of incoming) {
        if (!seen.has(reaction.emoji)) {
            ordered.push(byEmoji[reaction.emoji]);
            seen.add(reaction.emoji);
        }
    }

    container.innerHTML = renderReactions(ordered);
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

function withAvatarCacheBuster(avatarUrl, userId = null) {
    if (!avatarUrl || !avatarCacheBuster) return avatarUrl;

    if (userId !== null && userId !== undefined && Number(userId) !== Number(currentUser?.id)) {
        return avatarUrl;
    }

    try {
        const url = new URL(avatarUrl);
        url.searchParams.set('v', avatarCacheBuster);
        return url.toString();
    } catch {
        return avatarUrl;
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

/**
 * Parse markdown with escaping - processes markdown syntax BEFORE escaping HTML
 * This allows ![image](url) syntax to work correctly while still preventing XSS
 */
function parseMarkdownWithEscaping(text) {
    if (!text) return '';
    
    // First protect markdown syntax characters from escaping
    // We need to preserve: ![](), [](), **, __, ~~, `, #, >, -, *
    let protected = text;
    
    // Protect markdown image syntax ![alt](url) - temporarily replace
    const imageMatches = [];
    protected = protected.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, url) => {
        const placeholder = `__MD_IMAGE_${imageMatches.length}__`;
        imageMatches.push({ alt, url, original: match });
        return placeholder;
    });
    
    // Protect markdown link syntax [text](url)
    const linkMatches = [];
    protected = protected.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
        const placeholder = `__MD_LINK_${linkMatches.length}__`;
        linkMatches.push({ text, url, original: match });
        return placeholder;
    });
    
    // Escape HTML in the remaining text
    let escaped = escapeHtml(protected);
    
    // Restore markdown images
    imageMatches.forEach((item, index) => {
        const placeholder = `__MD_IMAGE_${index}__`;
        const imgTag = `<img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.alt)}" class="md-image" loading="lazy">`;
        escaped = escaped.replace(placeholder, imgTag);
    });
    
    // Restore markdown links
    linkMatches.forEach((item, index) => {
        const placeholder = `__MD_LINK_${index}__`;
        const linkTag = `<a href="${escapeHtml(item.url)}" class="md-link" target="_blank" rel="noopener noreferrer">${escapeHtml(item.text)}</a>`;
        escaped = escaped.replace(placeholder, linkTag);
    });
    
    // Now process the rest of markdown (bold, italic, etc.) - these are already safe since we escaped HTML first
    let html = escaped;
    
    // Process shortcodes like !troll, !hello, etc. to images
    // Only match shortcodes at start of line/after whitespace, followed by whitespace or end
    html = html.replace(/(^|\s)!([a-zA-Z0-9_-]+)(?=\s|$)/g, (match, prefix, shortcode) => {
        // Check if this shortcode matches any known media
        const exts = ['.gif', '.png', '.jpg', '.jpeg', '.webp'];
        for (const ext of exts) {
            const filename = shortcode + ext;
            // Check in emoji folder
            if (customEmojis.includes(filename)) {
                return prefix + `<img src="/emoji/${escapeHtml(filename)}" alt="${escapeHtml(shortcode)}" class="md-image" loading="lazy">`;
            }
            // Check in stickers folder
            if (stickers.includes(filename)) {
                return prefix + `<img src="/stickers/${escapeHtml(filename)}" alt="${escapeHtml(shortcode)}" class="md-image" loading="lazy">`;
            }
            // Check in gifs folder
            if (gifs.includes(filename)) {
                return prefix + `<img src="/gifs/${escapeHtml(filename)}" alt="${escapeHtml(shortcode)}" class="md-image" loading="lazy">`;
            }
        }
        // If no match, return original text
        return match;
    });
    
    // Code blocks (```code```)
    html = html.replace(/```([\s\S]*?)```/g, '<pre class="md-code-block"><code>$1</code></pre>');
    
    // Inline code (`code`)
    html = html.replace(/`([^`]+)`/g, '<code class="md-inline">$1</code>');
    
    // Strikethrough (~~text~~)
    html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    
    // Bold (**text** or __text__)
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    
    // Italic (*text* or _text_)
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/_([^_]+)_/g, '<em>$1</em>');
    
    // Headers (### H3, ## H2, # H1)
    html = html.replace(/^### (.+)$/gm, '<h4 class="md-h4">$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3 class="md-h3">$1</h3>');
    html = html.replace(/^# (.+)$/gm, '<h2 class="md-h2">$1</h2>');
    
    // Blockquotes (> quote)
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote class="md-blockquote">$1</blockquote>');
    
    // Unordered lists (- item or * item)
    html = html.replace(/^[*-] (.+)$/gm, '<li class="md-li">$1</li>');
    
    // Auto-link URLs (http:// or https://)
    // This regex matches URLs that are not already inside markdown link syntax
    html = html.replace(/(<a[^>]*>[^<]*<\/a>)|(https?:\/\/[^\s<]+)/g, (match, markdownLink, plainUrl) => {
        if (markdownLink) return markdownLink;
        // Add target="_blank" for security
        return `<a href="${plainUrl}" class="md-link" target="_blank" rel="noopener noreferrer">${plainUrl}</a>`;
    });
    
    // Convert line breaks to <br>
    html = html.replace(/\n/g, '<br>');
    
    return html;
}

/**
 * Parse markdown syntax to HTML
 * NOTE: This function should be called AFTER escapeHtml to prevent XSS
 * Supports: bold, italic, strikethrough, inline code, code blocks, links, headers, lists, blockquotes
 */
function parseMarkdown(text) {
    if (!text) return '';
    
    let html = text;
    
    // First, process markdown images ![alt](url) - must be before shortcodes to avoid conflicts
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="md-image" loading="lazy">');
    
    // Then, process shortcodes like !troll, !hello, etc. to images
    // Only match shortcodes at start of line/after whitespace, followed by whitespace or end
    html = html.replace(/(^|\s)!([a-zA-Z0-9_-]+)(?=\s|$)/g, (match, prefix, shortcode) => {
        // Check if this shortcode matches any known media
        const exts = ['.gif', '.png', '.jpg', '.jpeg', '.webp'];
        for (const ext of exts) {
            const filename = shortcode + ext;
            // Check in emoji folder
            if (customEmojis.includes(filename)) {
                return prefix + `<img src="/emoji/${filename}" alt="${shortcode}" class="md-image" loading="lazy">`;
            }
            // Check in stickers folder
            if (stickers.includes(filename)) {
                return prefix + `<img src="/stickers/${filename}" alt="${shortcode}" class="md-image" loading="lazy">`;
            }
            // Check in gifs folder
            if (gifs.includes(filename)) {
                return prefix + `<img src="/gifs/${filename}" alt="${shortcode}" class="md-image" loading="lazy">`;
            }
        }
        // If no match, return original text
        return match;
    });
    
    // Code blocks (```code```) - must be first to avoid conflicts
    html = html.replace(/```([\s\S]*?)```/g, '<pre class="md-code-block"><code>$1</code></pre>');
    
    // Inline code (`code`)
    html = html.replace(/`([^`]+)`/g, '<code class="md-code-inline">$1</code>');
    
    // Strikethrough (~~text~~)
    html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    
    // Bold (**text** or __text__)
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    
    // Italic (*text* or _text_)
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/_([^_]+)_/g, '<em>$1</em>');
    
    // Headers (### H3, ## H2, # H1)
    html = html.replace(/^### (.+)$/gm, '<h4 class="md-h4">$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3 class="md-h3">$1</h3>');
    html = html.replace(/^# (.+)$/gm, '<h2 class="md-h2">$1</h2>');
    
    // Blockquotes (> quote)
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote class="md-blockquote">$1</blockquote>');
    
    // Unordered lists (- item or * item)
    html = html.replace(/^[*-] (.+)$/gm, '<li class="md-li">$1</li>');
    
    // Links [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="md-link" target="_blank" rel="noopener noreferrer">$1</a>');
    
    // Auto-link URLs (http:// or https://)
    // This regex matches URLs that are not already inside markdown link syntax
    html = html.replace(/(<a[^>]*>[^<]*<\/a>)|(https?:\/\/[^\s<]+)/g, (match, markdownLink, plainUrl) => {
        if (markdownLink) return markdownLink;
        // Add target="_blank" for security
        return `<a href="${plainUrl}" class="md-link" target="_blank" rel="noopener noreferrer">${plainUrl}</a>`;
    });
    
    // Convert line breaks to <br>
    html = html.replace(/\n/g, '<br>');
    
    return html;
}

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

            // Очищаем свой индикатор набора текста после отправки сообщения
            if (currentUser) {
                delete typingUsers[currentUser.id];
                updateTypingIndicator();
            }

            // Очищаем вложения после отправки
            if (window.attachments) {
                window.attachments.clearAttachments();
            }

            // Своё сообщение — сразу обновляем lastRead (оптимистично)
            // Когда придёт через WS с ID — обновим снова
            markCurrentRoomAsRead();
            clearReplyTarget();
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
                addMessage(msg, true);
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

// ==========================================
// WEBSOCKET
// ==========================================

// Подключаемся к глобальному WS ОДИН РАЗ при загрузке
function connectWebSocket() {
    if (ws || wsConnecting) return; // уже подключены
    
    // Track reconnect if we already had a connection before
    if (connectionStats.connectedAt !== null) {
        connectionStats.reconnects++;
    }
    
    updateConnectionStatus('connecting');
    wsConnecting = true;

    wsReady = new Promise((resolve) => {
        const wsUrl = `${getWsUrl()}/ws`;
        const socket = new WebSocket(wsUrl);
        
        // Таймаут на подключение - 10 секунд
        let wsResolved = false;
        const resolveConnection = () => {
            if (wsResolved) return;
            wsResolved = true;
            resolve();
        };

        const connectionTimeout = setTimeout(() => {
            console.warn('[WS] Connection timeout, closing socket and allowing reconnect');
            updateConnectionStatus('disconnected');
            wsConnecting = false;
            try {
                socket.close();
            } catch (closeError) {
                console.error('[WS] error while closing socket on timeout:', closeError);
            }
            resolveConnection();
        }, 10000);

        socket.onopen = () => {
            clearTimeout(connectionTimeout);
            console.log('[WS] Connected globally');
            // Reset connection stats on new connection
            connectionStats.connectedAt = Date.now();
            connectionStats.pingValue = null;
            updateConnectionStatus('connected');
            
            // Add log entry for connection
            const isReconnect = connectionStats.reconnects > 0;
            addLogEntry(isReconnect ? 'reconnect' : 'connect', isReconnect ? 'Переподключение к серверу' : 'Подключение к серверу');
            
            ws = socket;
            wsConnecting = false;
            resolveConnection();
        };

        socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);

                if (data.type === 'message') {
                    if (markIncomingMessageSeen(Number(data.id))) {
                        return;
                    }

                    // Track received message for stats
                    connectionStats.messagesReceived++;
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
                        const shouldNotify = window.notifications.claimMessageNotification(data.id, data.room_id);
                        if (shouldNotify) {
                            window.notifications.playNotificationSound();

                            if (data.room_id) {
                                incrementRoomBadge(data.room_id, data.id);
                            }
                        }
                    }
                } else if (data.type === 'reaction') {
                    applyReactionUpdate(data.message_id, data.reactions || [], data.actor_user_id, data.action, data.emoji);
                    closeReactionPicker();
                } else if (data.type === 'message_deleted') {
                    applyDeletedMessage(data.message_id, data.body || 'Сообщение удалено');
                } else if (data.type === 'message_hard_deleted') {
                    const messageEl = messagesList.querySelector(`[data-message-id="${data.message_id}"]`);
                    if (messageEl) {
                        messageEl.remove();
                    }
                } else if (data.type === 'typing') {
                    handleTypingEvent(data);
                } else if (data.type === 'room_joined') {
                    peerConnections.forEach((_, uid) => closePeerConnection(uid));
                    currentVoiceRoomId = data.room_id;
                    voiceParticipants = data.participants || [];
                    voiceRoomParticipantsByRoom[data.room_id] = voiceParticipants;
                    if (voiceOverlay) voiceOverlay.classList.add('in-room');
                    renderVoiceRooms();
                    renderVoiceParticipantsGrid();
                    syncRemoteScreensWithParticipants();
                    renderScreenShareGrid();
                    ensurePeerConnections();
                    if (localScreenStream) {
                        signalScreenShareState(true);
                    }
                    playVoiceEventSound('join');
                } else if (data.type === 'participant_joined') {
                    if (data.room_id === currentVoiceRoomId) {
                        voiceParticipants = upsertVoiceParticipant(data.participant);
                        voiceRoomParticipantsByRoom[data.room_id] = voiceParticipants;
                        renderVoiceParticipantsGrid();
                        syncRemoteScreensWithParticipants();
                        renderScreenShareGrid();
                        ensurePeerConnections();
                        if (data.participant?.user_id !== currentUser?.id) playVoiceEventSound('join');
                    }
                } else if (data.type === 'participant_left') {
                    if (data.room_id === currentVoiceRoomId) {
                        const leftUserId = data.participant?.user_id;
                        voiceParticipants = voiceParticipants.filter(p => p.user_id !== leftUserId);
                        voiceRoomParticipantsByRoom[data.room_id] = voiceParticipants;
                        closePeerConnection(leftUserId);
                        syncRemoteScreensWithParticipants();
                        renderScreenShareGrid();
                        renderVoiceParticipantsGrid();
                        if (leftUserId && leftUserId !== currentUser?.id) playVoiceEventSound('leave');
                    }
                } else if (data.type === 'participant_updated') {
                    if (data.room_id === currentVoiceRoomId) {
                        const previousParticipant = voiceParticipants.find((p) => p.user_id === data.participant?.user_id) || null;
                        voiceParticipants = upsertVoiceParticipant(data.participant);
                        voiceRoomParticipantsByRoom[data.room_id] = voiceParticipants;
                        renderVoiceParticipantsGrid();
                        handleParticipantScreenShareSound(previousParticipant, data.participant);
                        handleParticipantScreenShareState(data.participant);
                    }
                } else if (data.type === 'speaking') {
                    if (data.room_id === currentVoiceRoomId) {
                        const participant = voiceParticipants.find(p => p.user_id === data.user_id);
                        if (participant) participant.speaking = data.speaking;
                        renderVoiceParticipantsGrid();
                    }
                } else if (data.type === 'screen_share_updated') {
                    if (data.room_id === currentVoiceRoomId) {
                        const previousParticipant = voiceParticipants.find((p) => p.user_id === data.participant?.user_id) || null;
                        voiceParticipants = upsertVoiceParticipant(data.participant);
                        voiceRoomParticipantsByRoom[data.room_id] = voiceParticipants;
                        renderVoiceParticipantsGrid();
                        handleParticipantScreenShareSound(previousParticipant, data.participant);
                        handleParticipantScreenShareState(data.participant);
                        renderScreenShareGrid();
                    }
                } else if (data.type === 'rtc_offer') {
                    handleRtcOffer(data);
                } else if (data.type === 'rtc_answer') {
                    handleRtcAnswer(data);
                } else if (data.type === 'rtc_ice') {
                    handleRtcIce(data);
                } else if (data.type === 'voice_room_presence') {
                    voiceRoomParticipantsByRoom[data.room_id] = data.participants || [];
                    if (data.room_id === currentVoiceRoomId) {
                        voiceParticipants = data.participants || [];
                        renderVoiceParticipantsGrid();
                        syncRemoteScreensWithParticipants();
                        renderScreenShareGrid();
                    }
                    renderVoiceRooms();
                } else if (data.type === 'error') {
                    console.error('[WS] error:', data.detail);
                    if (data.code === 'unauthorized') redirectToLogin();
                } else if (data.type === 'connected') {
                    console.log('[WS] ready');
                    if (currentVoiceRoomId) {
                        joinVoiceRoom(currentVoiceRoomId);
                    }
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
            clearTimeout(connectionTimeout);
            console.log('[WS] disconnected');
            
            // Add log entry for disconnection
            addLogEntry('disconnect', 'Отключение от сервера');
            
            updateConnectionStatus('disconnected');
            if (ws === socket) {
                ws = null;
            }
            wsConnecting = false;
            resolveConnection();

            // Переподключаемся через 3 секунды
            setTimeout(() => connectWebSocket(), 3000);
        };
    });
}

function updateConnectionStatus(status) {
    connectionStatus.classList.remove('connecting', 'connected', 'disconnected');
    connectionStatus.classList.add(status);
    // Status now shown via light bulb icon only - no text needed
    
    // Update stats display
    updateConnectionStatsDisplay();
}

// Update the connection stats popup display
function updateConnectionStatsDisplay() {
    const statusEl = document.getElementById('statsStatus');
    const uptimeEl = document.getElementById('statsUptime');
    const sentEl = document.getElementById('statsSent');
    const receivedEl = document.getElementById('statsReceived');
    const pingEl = document.getElementById('statsPing');
    const reconnectsEl = document.getElementById('statsReconnects');
    
    // Logs tab elements
    const logsStatusEl = document.getElementById('logsStatsStatus');
    const logsUptimeEl = document.getElementById('logsStatsUptime');
    const logsSentEl = document.getElementById('logsStatsSent');
    const logsReceivedEl = document.getElementById('logsStatsReceived');
    const logsPingEl = document.getElementById('logsStatsPing');
    const logsReconnectsEl = document.getElementById('logsStatsReconnects');
    
    if (!statusEl) return;
    
    // Status
    const currentStatus = connectionStatus.classList.contains('connected') ? 'connected' : 
                          connectionStatus.classList.contains('connecting') ? 'connecting' : 'disconnected';
    const statusText = currentStatus === 'connected' ? 'Подключено' : 
                       currentStatus === 'connecting' ? 'Подключение...' : 'Нет связи';
    statusEl.textContent = statusText;
    statusEl.className = 'stats-value ' + (currentStatus === 'connected' ? 'good' : 
                            currentStatus === 'connecting' ? 'warning' : 'bad');
    
    // Update logs tab status
    if (logsStatusEl) {
        logsStatusEl.textContent = statusText;
        logsStatusEl.className = 'logs-stat-value ' + (currentStatus === 'connected' ? 'status-good' : 
                                currentStatus === 'connecting' ? 'status-warning' : 'status-bad');
    }
    
    // Uptime
    if (connectionStats.connectedAt) {
        const uptimeMs = Date.now() - connectionStats.connectedAt;
        const seconds = Math.floor(uptimeMs / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        let uptimeStr;
        if (hours > 0) {
            uptimeStr = `${hours}ч ${minutes % 60}м`;
        } else if (minutes > 0) {
            uptimeStr = `${minutes}м ${seconds % 60}с`;
        } else {
            uptimeStr = `${seconds}с`;
        }
        uptimeEl.textContent = uptimeStr;
        if (logsUptimeEl) logsUptimeEl.textContent = uptimeStr;
    } else {
        uptimeEl.textContent = '-';
        if (logsUptimeEl) logsUptimeEl.textContent = '-';
    }
    
    // Messages sent/received
    sentEl.textContent = connectionStats.messagesSent.toString();
    receivedEl.textContent = connectionStats.messagesReceived.toString();
    if (logsSentEl) logsSentEl.textContent = connectionStats.messagesSent.toString();
    if (logsReceivedEl) logsReceivedEl.textContent = connectionStats.messagesReceived.toString();
    
    // Ping
    if (connectionStats.pingValue !== null) {
        const pingText = `${connectionStats.pingValue}мс`;
        pingEl.textContent = pingText;
        pingEl.className = 'stats-value ' + (connectionStats.pingValue < 100 ? 'good' : 
                                connectionStats.pingValue < 300 ? 'warning' : 'bad');
        if (logsPingEl) {
            logsPingEl.textContent = pingText;
            logsPingEl.className = 'logs-stat-value ' + (connectionStats.pingValue < 100 ? 'status-good' : 
                                    connectionStats.pingValue < 300 ? 'status-warning' : 'status-bad');
        }
    } else {
        pingEl.textContent = '-';
        pingEl.className = 'stats-value';
        if (logsPingEl) {
            logsPingEl.textContent = '-';
            logsPingEl.className = 'logs-stat-value';
        }
    }
    
    // Reconnects
    reconnectsEl.textContent = connectionStats.reconnects.toString();
    if (logsReconnectsEl) logsReconnectsEl.textContent = connectionStats.reconnects.toString();
}

// Toggle connection stats popup
function toggleConnectionStatsPopup(e) {
    e.stopPropagation();
    if (connectionStatsPopup.classList.contains('active')) {
        connectionStatsPopup.classList.remove('active');
    } else {
        updateConnectionStatsDisplay();
        connectionStatsPopup.classList.add('active');
    }
}

// Close connection stats popup when clicking outside
document.addEventListener('click', (e) => {
    if (connectionStatsPopup && connectionStatsPopup.classList.contains('active')) {
        if (!connectionStatus.contains(e.target) && !connectionStatsPopup.contains(e.target)) {
            connectionStatsPopup.classList.remove('active');
        }
    }
});

// ==========================================
// MODAL
// ==========================================

function openModal(type = 'text') {
    createRoomModal.classList.add('active');
    if (roomTypeInput) roomTypeInput.value = type;
    roomNameInput.focus();
}

function closeModal() {
    createRoomModal.classList.remove('active');
    roomNameInput.value = '';
    if (roomTypeInput) roomTypeInput.value = 'text';
}

function renderCurrentUser() {
    if (!currentUser) return;

    const displayName = currentUser.display_name || currentUser.username || 'User';
    const username = currentUser.username || 'unknown';
    const avatarUrl = withAvatarCacheBuster(normalizeAvatarUrl(currentUser.avatar_url));

    if (currentUserName) currentUserName.textContent = displayName;
    if (currentUserUsername) currentUserUsername.textContent = `@${username}`;

    const initial = escapeHtml(displayName[0]?.toUpperCase() || 'U');
    const avatarHtml = avatarUrl
        ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(displayName)}" class="avatar-media">`
        : `<span>${initial}</span>`;

    if (currentUserAvatar) currentUserAvatar.innerHTML = avatarHtml;

    // Admin tab in settings — only for admin
    const adminTabBtn = document.querySelector('.admin-tab-btn');
    if (adminTabBtn) {
        adminTabBtn.style.display = currentUser.role === 'admin' ? '' : 'none';
    }

    // Кнопка создать аудио — только для админов
    const createVoiceRoomBtn = document.getElementById('createVoiceRoomBtn');
    if (createVoiceRoomBtn) {
        createVoiceRoomBtn.style.display = currentUser.role === 'admin' ? '' : 'none';
    }
}

function openSettingsModal() {
    if (!currentUser) return;

    // Update logs display when opening settings
    updateLogsDisplay();
    updateConnectionStatsDisplay();

    shouldRemoveAvatar = false;
    settingsDisplayName.value = currentUser.display_name || '';
    settingsUsername.value = currentUser.username || '';
    avatarInput.value = '';
    updateSettingsAvatarPreview(withAvatarCacheBuster(normalizeAvatarUrl(currentUser.avatar_url)));
    
    // Update user preview
    const displayNameEl = document.getElementById('settingsUserDisplayName');
    const userTagEl = document.getElementById('settingsUserTag');
    if (displayNameEl) displayNameEl.textContent = currentUser.display_name || currentUser.username || 'User';
    if (userTagEl) userTagEl.textContent = '@' + (currentUser.username || 'username');
    
    // Обновляем UI темы при открытии
    updateThemeUI(getStoredTheme());

    // Sync volume settings from voice chat
    if (micVolumeSlider && settingsMicVolume) {
        settingsMicVolume.value = micVolumeSlider.value;
        settingsMicVolumeValue.textContent = `${micVolumeSlider.value}%`;
    }
    if (headphoneVolumeSlider && settingsHeadphoneVolume) {
        settingsHeadphoneVolume.value = headphoneVolumeSlider.value;
        settingsHeadphoneVolumeValue.textContent = `${headphoneVolumeSlider.value}%`;
    }

    // Reset to first tab
    const firstTabBtn = document.querySelector('.settings-tab-btn');
    const firstTabPanel = document.querySelector('.settings-tab-panel');
    if (firstTabBtn && firstTabPanel) {
        settingsTabBtns.forEach(b => b.classList.remove('active'));
        settingsTabPanels.forEach(p => p.classList.remove('active'));
        firstTabBtn.classList.add('active');
        firstTabPanel.classList.add('active');
    }

    settingsModal.classList.add('active');
}

function closeSettingsModal() {
    settingsModal.classList.remove('active');
    // Reset avatar cropper state
    closeAvatarCropper();
    window.croppedAvatarData = null;
    shouldRemoveAvatar = false;
    avatarInput.value = '';
}

function updateSettingsAvatarPreview(avatarUrl) {
    const displayName = currentUser?.display_name || currentUser?.username || 'User';
    const initial = escapeHtml(displayName[0]?.toUpperCase() || 'U');

    settingsAvatarPreview.innerHTML = avatarUrl
        ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(displayName)}" class="avatar-media">`
        : `<span>${initial}</span>`;
}

async function saveSettings() {
    const previousAvatarUrl = currentUser?.avatar_url || null;
    const hasAvatarPayload = Boolean(window.croppedAvatarData || avatarInput.files?.[0]);
    const avatarUpdateRequested = shouldRemoveAvatar || hasAvatarPayload;

    const displayNameValue = settingsDisplayName.value.trim();
    const usernameValue = settingsUsername.value.trim();

    if (!displayNameValue) {
        alert('Никнейм не может быть пустым');
        settingsDisplayName.focus();
        return;
    }
    if (displayNameValue.length > 50) {
        alert('Никнейм не должен быть длиннее 50 символов');
        settingsDisplayName.focus();
        return;
    }
    if (usernameValue.length < 3) {
        alert('Тег должен содержать минимум 3 символа');
        settingsUsername.focus();
        return;
    }
    if (usernameValue.length > 32) {
        alert('Тег не должен быть длиннее 32 символов');
        settingsUsername.focus();
        return;
    }

    const formData = new FormData();
    formData.append('display_name', displayNameValue);
    formData.append('username', usernameValue);
    formData.append('remove_avatar', shouldRemoveAvatar ? 'true' : 'false');

    // Check for cropped avatar data first
    if (window.croppedAvatarData) {
        // Convert base64 to blob
        const response = await fetch(window.croppedAvatarData);
        const blob = await response.blob();
        const croppedFile = new File([blob], 'avatar.png', { type: 'image/png' });
        formData.append('avatar', croppedFile);
        window.croppedAvatarData = null; // Clear after use
    } else {
        // Use original file input if no cropped data
        const file = avatarInput.files?.[0];
        if (file) {
            formData.append('avatar', file);
        }
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
        if (avatarUpdateRequested || previousAvatarUrl !== currentUser.avatar_url) {
            avatarCacheBuster = String(Date.now());
        }
        renderCurrentUser();
        closeSettingsModal();

        if (currentRoom) {
            await Promise.all([
                loadMessages(currentRoom.id),
                loadAllUsers(),
            ]);
        }
    } catch (err) {
        console.error('Failed to save settings:', err);
        alert(err.message || 'Не удалось сохранить настройки');
    }
}
async function logout() {
    try {
        const response = await fetch(`${getApiUrl()}/auth/logout`, {
            method: 'POST',
            credentials: 'include',
        });

        if (response.ok) {
            window.location.href = getAppRoutes().login;
        } else {
            alert('Не удалось выйти из аккаунта');
        }
    } catch (err) {
        console.error('Logout failed:', err);
        alert('Ошибка при выходе из аккаунта');
    }
}

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
        toggleReaction(addBtn.dataset.messageId, addBtn.dataset.addReaction);
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

// Wordle button - opens in its own modal
if (launchWordleBtn) {
    launchWordleBtn.addEventListener('click', () => {
        closeActivitiesModal();
        if (typeof initWordle === 'function') {
            initWordle();
        }
        if (typeof openWordleModal === 'function') {
            openWordleModal();
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
    const objectUrl = URL.createObjectURL(file);
    
    // Open cropper with the image
    openAvatarCropper(objectUrl);
});

// Avatar Cropper Functions
let baseScale = 1; // Initial fit scale

let cropperCanvas = null;
let cropperCanvasCtx = null;

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
    cropperOriginalImage = null;
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

// ==========================================
// PRESENCE (онлайн пользователи)
// ==========================================

let presenceInterval = null;
let currentSearch = '';
let currentPage = 1;
const usersPerPage = 30;
let totalUsers = 0;

/**
 * Загрузить список всех пользователей с разделением на онлайн/оффлайн.
 */
async function loadAllUsers() {
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
        const offset = (currentPage - 1) * usersPerPage;
        let url = `${getApiUrl()}/rooms/${currentRoom.id}/users?limit=${usersPerPage}&offset=${offset}&sort_by=last_seen&sort_order=desc`;
        
        // Add search query
        if (currentSearch) {
            url += `&search=${encodeURIComponent(currentSearch)}`;
        }

        const response = await fetchWithAuth(url);

        if (!response.ok) {
            throw new Error('Failed to load users');
        }

        const data = await response.json();
        const users = data.users || [];
        totalUsers = data.total || 0;

        // Обновляем счётчик
        document.getElementById('usersCount').textContent = totalUsers;

        // Обновляем пагинацию
        updatePagination();

        // Отображаем список
        const usersList = document.getElementById('usersList');

        if (users.length === 0) {
            usersList.innerHTML = `
                <div class="placeholder-message">
                    <span class="placeholder-icon">👤</span>
                    <p>${currentSearch ? 'Пользователи не найдены' : 'Никого нет в списке'}</p>
                </div>
            `;
            return;
        }

        // Просто показываем всех пользователей одним списком
        usersList.innerHTML = users.map(user => renderUserItem(user)).join('');
        
        // Обновляем мобильный счётчик пользователей
        if (window.renderMobileUsers) {
            window.renderMobileUsers();
        }
        
        // Attach click handlers to user items
        attachClickHandlersToUserList();
    } catch (err) {
        console.error('Failed to load users:', err);
        // Fallback to old online-only endpoint
        loadOnlineUsers();
    }
}

/**
 * Render a single user item.
 */
function renderUserItem(user) {
    const displayName = user.display_name || user.username;
    const avatarUrl = withAvatarCacheBuster(
        normalizeAvatarUrl(user.avatar_url),
        user.id
    );
    const initial = displayName[0]?.toUpperCase() || 'U';

    const avatarHtml = avatarUrl
        ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(displayName)}" class="avatar-media">`
        : `<span>${initial}</span>`;

    const statusClass = user.is_online ? 'online' : 'offline';
    const itemClass = user.is_online ? 'user-item' : 'user-item offline';
    const lastSeenText = user.is_online ? '' : (user.last_seen_formatted || '');

    return `
        <div class="${itemClass}" data-user-id="${user.id}">
            <div class="user-avatar">${avatarHtml}</div>
            <div class="user-info">
                <div class="user-display-name">${escapeHtml(displayName)}</div>
                <div class="user-username">@${escapeHtml(user.username)}</div>
                ${!user.is_online ? `<div class="user-last-seen offline">${escapeHtml(lastSeenText)}</div>` : ''}
            </div>
            <div class="user-status ${statusClass}"></div>
        </div>
    `;
}

/**
 * Update pagination controls.
 */
function updatePagination() {
    const totalPages = Math.ceil(totalUsers / usersPerPage);
    const prevBtn = document.getElementById('prevPage');
    const nextBtn = document.getElementById('nextPage');
    const pageInfo = document.getElementById('pageInfo');

    if (prevBtn) prevBtn.disabled = currentPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
    if (pageInfo) pageInfo.textContent = `${currentPage} / ${totalPages || 1}`;
}

/**
 * Загрузить список онлайн пользователей в текущей комнате (legacy).
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
            const avatarUrl = withAvatarCacheBuster(
        normalizeAvatarUrl(user.avatar_url),
        user.id
    );
            const initial = displayName[0]?.toUpperCase() || 'U';

            const avatarHtml = avatarUrl
                ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(displayName)}" class="avatar-media">`
                : `<span>${initial}</span>`;

            return `
                <div class="user-item" data-user-id="${user.id}">
                    <div class="user-avatar">${avatarHtml}</div>
                    <div class="user-info">
                        <div class="user-display-name">${escapeHtml(displayName)}</div>
                        <div class="user-username">@${escapeHtml(user.username)}</div>
                    </div>
                    <div class="user-status online"></div>
                </div>
            `;
        }).join('');
        
        // Attach click handlers to user items
        attachClickHandlersToUserList();
    } catch (err) {
        console.error('Failed to load online users:', err);
    }
    
    // Обновляем мобильный счётчик пользователей
    if (window.renderMobileUsers) {
        window.renderMobileUsers();
    }
}

/**
 * Handle search input.
 */
let searchTimeout = null;
function handleSearchInput(event) {
    const input = event.target;
    clearTimeout(searchTimeout);
    
    searchTimeout = setTimeout(() => {
        currentSearch = input.value.trim();
        currentPage = 1;
        loadAllUsers();
    }, 300);
}

/**
 * Handle pagination.
 */
function handlePrevPage() {
    if (currentPage > 1) {
        currentPage--;
        loadAllUsers();
    }
}

function handleNextPage() {
    const totalPages = Math.ceil(totalUsers / usersPerPage);
    if (currentPage < totalPages) {
        currentPage++;
        loadAllUsers();
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

    // Загружаем всех пользователей сразу
    loadAllUsers();

    // Обновляем каждые 10 секунд
    presenceInterval = setInterval(() => {
        loadAllUsers();
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
    // Reset search state when leaving room
    currentSearch = '';
    currentPage = 1;
    
    // Clear search input
    const searchInput = document.getElementById('usersSearch');
    if (searchInput) searchInput.value = '';
}

/**
 * Initialize users sidebar event listeners.
 */
function initUsersSidebar() {
    // Search input
    const searchInput = document.getElementById('usersSearch');
    if (searchInput) {
        searchInput.addEventListener('input', handleSearchInput);
    }
    
    // Pagination buttons
    const prevBtn = document.getElementById('prevPage');
    const nextBtn = document.getElementById('nextPage');
    
    if (prevBtn) prevBtn.addEventListener('click', handlePrevPage);
    if (nextBtn) nextBtn.addEventListener('click', handleNextPage);
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
 * Увеличить badge комнаты на 1 (когда пришло новое сообщение).
 * С дедупликацией по messageId.
 */
function incrementRoomBadge(roomId, messageId) {
    const badgeKey = `${roomId}:${messageId}`;
    if (messageId && processedBadgeIncrements && processedBadgeIncrements.has(badgeKey)) {
        return; // уже обработано
    }
    if (messageId && processedBadgeIncrements) {
        processedBadgeIncrements.add(badgeKey);
    }

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

                    // Play sound only for a newly observed message from another user
                    if (lastMessage.user?.id !== currentUser?.id) {
                        const shouldNotify = window.notifications.claimMessageNotification(lastMessage.id, room.id);
                        if (shouldNotify) {
                            window.notifications.playNotificationSound();
                        }
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
// VOICE CHAT (MVP)
// ==========================================

function upsertVoiceParticipant(participant) {
    const copy = [...voiceParticipants];
    const idx = copy.findIndex(p => p.user_id === participant.user_id);
    if (idx >= 0) {
        copy[idx] = { ...copy[idx], ...participant };
    } else {
        copy.push({ ...participant });
    }
    return copy;
}

async function loadVoiceRooms() {
    const response = await fetchWithAuth(`${getApiUrl()}/voice-rooms`);
    if (!response.ok) return;
    voiceRooms = await response.json();

    await Promise.all(voiceRooms.map(async (room) => {
        try {
            const participantsRes = await fetchWithAuth(`${getApiUrl()}/voice-rooms/${room.id}/participants`);
            if (!participantsRes.ok) return;
            voiceRoomParticipantsByRoom[room.id] = await participantsRes.json();
        } catch (_) {
            voiceRoomParticipantsByRoom[room.id] = [];
        }
    }));

    renderVoiceRooms();
}

function attachVoiceAvatarFallbacks(container) {
    if (!container) return;

    container.querySelectorAll('img[data-avatar-fallback]').forEach(img => {
        if (img.dataset.avatarFallbackBound === '1') return;
        img.dataset.avatarFallbackBound = '1';

        img.addEventListener('error', () => {
            const target = img.closest('[data-avatar-fallback-target]');
            if (!target) return;
            const fallbackInitial = escapeHtml(img.dataset.avatarFallback || 'U');
            target.innerHTML = `<span>${fallbackInitial}</span>`;
        }, { once: true });
    });
}

function renderVoiceRooms() {
    if (!voiceRoomsList) return;
    voiceRoomsList.innerHTML = voiceRooms.map(room => {
        const participants = voiceRoomParticipantsByRoom[room.id] || [];
        const icons = participants.slice(0, 4).map((participant) => {
            const rawName = participant.display_name || participant.username || '?';
            const safeName = escapeHtml(rawName);
            const initial = escapeHtml(rawName[0]?.toUpperCase() || '?');
            const avatarUrl = withAvatarCacheBuster(
                normalizeAvatarUrl(participant.avatar_url),
                participant.user_id
            );
            const avatarMarkup = avatarUrl
                ? `<img src="${escapeHtml(avatarUrl)}" alt="${safeName}" class="voice-room-user-avatar" data-avatar-fallback="${initial}">`
                : `<span class="voice-room-user-initial">${initial}</span>`;

            return `<span class="voice-room-user-icon ${participant.speaking ? 'speaking' : ''}" title="${safeName}"><span class="voice-room-user-media" data-avatar-fallback-target="1">${avatarMarkup}</span></span>`;
        }).join('');
        const more = participants.length > 4 ? `<span class="voice-room-user-more">+${participants.length - 4}</span>` : '';
        return `<div class="voice-room-item ${room.id === currentVoiceRoomId ? 'active' : ''}" data-voice-room-id="${room.id}"><span class="voice-room-item-title">🔊 ${escapeHtml(room.name)}</span><span class="voice-room-users">${icons}${more}</span></div>`;
    }).join('');
    attachVoiceAvatarFallbacks(voiceRoomsList);
    voiceRoomState.textContent = currentVoiceRoomId ? `В комнате: ${escapeHtml((voiceRooms.find(r => r.id === currentVoiceRoomId) || {}).name || '')}` : 'Не в голосовой комнате';
    const controlsVisible = !!currentVoiceRoomId;
    toggleMicBtn.disabled = !controlsVisible;
    toggleDeafenBtn.disabled = !controlsVisible;
    toggleScreenShareBtn.disabled = !controlsVisible;
    leaveVoiceBtn.disabled = !controlsVisible;
    if (voiceControls) voiceControls.style.display = controlsVisible ? 'flex' : 'none';
    if (localAudioControls) localAudioControls.style.display = controlsVisible ? 'grid' : 'none';
    if (voiceSettingsPanel) {
        voiceSettingsPanel.classList.toggle('available', controlsVisible);
        if (!controlsVisible) {
            setVoiceSettingsOpen(false);
        }
    }
    if (screenShareStage) {
        const hasScreenShare = voiceParticipants.some((participant) => participant.screen_sharing) || !!localScreenStream;
        screenShareStage.classList.toggle('visible', controlsVisible && hasScreenShare);
    }
    updateScreenShareButtonState();
    if (controlsVisible) {
        updateMuteButtonIcon();
        updateDeafenButtonIcon();
    }
}

function renderVoiceParticipantsGrid() {
    if (!voiceParticipantsGrid) return;

    voiceParticipantsGrid.innerHTML = voiceParticipants.map(participant => {
        const rawDisplayName = participant.display_name || participant.username || 'User';
        const rawUsername = participant.username || participant.display_name || 'user';
        const displayName = escapeHtml(rawDisplayName);
        const username = escapeHtml(rawUsername);
        const initial = escapeHtml(rawDisplayName[0]?.toUpperCase() || rawUsername[0]?.toUpperCase() || 'U');
        const avatarUrl = withAvatarCacheBuster(
            normalizeAvatarUrl(participant.avatar_url),
            participant.user_id
        );

        let statusClass = 'mic-on';
        let statusIcon = '';
        if (participant.deafened) {
            statusClass = 'deafened';
            statusIcon = '🔇';
        } else if (participant.muted) {
            statusClass = 'mic-off';
            statusIcon = '';
        }

        const cardClasses = [
            'voice-participant-card',
            participant.speaking ? 'speaking' : '',
            participant.muted ? 'muted' : ''
        ].filter(Boolean).join(' ');

        const volumePct = Math.round((participantVolumes[participant.user_id] ?? 1) * 100);
        const screenBadge = participant.screen_sharing ? '<span class="voice-participant-badge active" title="Screen sharing">🖥</span>' : '';
        const avatarMarkup = avatarUrl
            ? `<img src="${escapeHtml(avatarUrl)}" alt="${displayName}" class="voice-participant-avatar-img" data-avatar-fallback="${initial}">`
            : `<span>${initial}</span>`;
        const muteOverlay = participant.muted ? '<img src="/emoji/mute.png" alt="Muted" class="mute-status-icon">' : '';

        return `
            <div class="${cardClasses}" data-user-id="${participant.user_id}" data-username="${username}" title="${displayName}">
                <div class="voice-participant-avatar-wrap">
                    <div class="voice-participant-avatar">
                        <div class="voice-participant-avatar-media" data-avatar-fallback-target="1">${avatarMarkup}${muteOverlay}</div>
                        <div class="voice-participant-status ${statusClass}">${statusIcon}</div>
                    </div>
                    ${screenBadge}
                </div>
                <div class="voice-participant-volume compact">
                    <div class="voice-participant-volume-fill" style="width: ${volumePct}%"></div>
                </div>
                <div class="voice-participant-name">${displayName}</div>
            </div>
        `;
    }).join('');

    attachVoiceAvatarFallbacks(voiceParticipantsGrid);

    voiceParticipantsGrid.querySelectorAll('.voice-participant-card').forEach(card => {
        card.addEventListener('contextmenu', handleParticipantContextMenu);
    });

    // Update collapsed participants if overlay is collapsed
    if (isVoiceOverlayCollapsed) {
        updateCollapsedParticipants();
    }
}
function handleParticipantContextMenu(event) {
    event.preventDefault();
    const card = event.currentTarget;
    const userId = parseInt(card.dataset.userId);
    const username = card.dataset.username;
    if (!userId || userId === currentUser?.id) return;

    const header = participantVolumeMenu.querySelector('.volume-context-header');
    const slider = participantVolumeMenu.querySelector('.volume-context-slider');
    const value = participantVolumeMenu.querySelector('.volume-context-value');

    const currentVolume = participantVolumes[userId] ?? 1;
    header.textContent = `Set ${username} volume`;
    slider.value = String(Math.round(currentVolume * 100));
    value.textContent = `${slider.value}%`;

    participantVolumeMenu.style.left = `${event.clientX}px`;
    participantVolumeMenu.style.top = `${event.clientY}px`;
    participantVolumeMenu.classList.remove('hidden');

    slider.oninput = () => {
        const volPct = Number(slider.value);
        value.textContent = `${volPct}%`;
        setParticipantVolume(userId, volPct / 100);
        renderVoiceParticipantsGrid();
    };
}

function getVoiceParticipantById(userId) {
    return voiceParticipants.find((participant) => participant.user_id === userId) || null;
}

function getVoiceDisplayName(userId) {
    const participant = getVoiceParticipantById(userId);
    if (participant) {
        return participant.display_name || participant.username || `User ${userId}`;
    }
    if (userId === currentUser?.id) {
        return currentUser.display_name || currentUser.username || 'You';
    }
    return `User ${userId}`;
}

function getScreenStreamForUser(userId) {
    if (userId === currentUser?.id) return localScreenStream;
    return remoteScreenStreams.get(userId)?.stream || null;
}

function closeScreenPopout(userId) {
    const key = String(userId);
    const popup = popoutWindows.get(key);
    if (!popup) return;
    try {
        if (!popup.closed) popup.close();
    } catch (_) {
        // ignore
    }
    popoutWindows.delete(key);
}

function updateLocalScreenShareParticipantState(sharing) {
    const meId = currentUser?.id;
    if (!meId) return;
    voiceParticipants = voiceParticipants.map((participant) => {
        if (participant.user_id !== meId) return participant;
        return { ...participant, screen_sharing: sharing };
    });
    if (currentVoiceRoomId) {
        voiceRoomParticipantsByRoom[currentVoiceRoomId] = voiceParticipants;
    }
}

function signalScreenShareState(sharing) {
    updateLocalScreenShareParticipantState(sharing);
    renderVoiceParticipantsGrid();
    if (ws && currentVoiceRoomId && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'set_screen_share',
            room_id: currentVoiceRoomId,
            sharing,
        }));
    }
}

function syncRemoteScreensWithParticipants() {
    const sharingIds = new Set(
        voiceParticipants
            .filter((participant) => participant.screen_sharing && participant.user_id !== currentUser?.id)
            .map((participant) => participant.user_id)
    );

    for (const userId of Array.from(remoteScreenStreams.keys())) {
        if (sharingIds.has(userId)) continue;
        remoteAudioStreams.delete(userId);
    remoteScreenStreams.delete(userId);
        closeScreenPopout(userId);
        if (activeScreenViewerUserId === userId) {
            closeScreenViewer();
        }
    }
}

function handleParticipantScreenShareState(participant) {
    if (!participant || !participant.user_id) return;
    if (!participant.screen_sharing && participant.user_id !== currentUser?.id) {
        remoteScreenStreams.delete(participant.user_id);
        closeScreenPopout(participant.user_id);
        if (activeScreenViewerUserId === participant.user_id) {
            closeScreenViewer();
        }
    }
    renderScreenShareGrid();
    updateScreenShareButtonState();
}

function updateScreenShareButtonState() {
    if (!toggleScreenShareBtn) return;
    const sharing = !!localScreenStream;
    toggleScreenShareBtn.classList.toggle('btn-active', sharing);
    toggleScreenShareBtn.setAttribute('aria-label', sharing ? 'Stop screen sharing' : 'Start screen sharing');
    toggleScreenShareBtn.title = sharing ? 'Остановить демонстрацию экрана' : 'Начать демонстрацию экрана';
    const icon = toggleScreenShareBtn?.querySelector('.voice-control-icon');
    if (icon) {
        // Always show monitor icon
        icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>';
    }
}

function renderScreenShareGrid() {
    if (!screenShareGrid || !screenShareCount) return;

    const sharingParticipants = voiceParticipants.filter((participant) => participant.screen_sharing);
    const hasLocalStream = !!localScreenStream;
    if (hasLocalStream && !sharingParticipants.some((participant) => participant.user_id === currentUser?.id)) {
        sharingParticipants.push({
            user_id: currentUser?.id,
            username: currentUser?.username || 'you',
            display_name: currentUser?.display_name || currentUser?.username || 'You',
            screen_sharing: true,
        });
    }

    screenShareCount.textContent = String(sharingParticipants.length);
    screenShareGrid.innerHTML = '';
    if (screenShareStage) {
        screenShareStage.classList.toggle('visible', !!currentVoiceRoomId && sharingParticipants.length > 0);
    }

    if (!sharingParticipants.length) {
        return;
    }

    for (const participant of sharingParticipants) {
        const userId = participant.user_id;
        const isLocal = userId === currentUser?.id;
        const displayName = getVoiceDisplayName(userId);
        const stream = getScreenStreamForUser(userId);

        const card = document.createElement('div');
        card.className = `screen-share-card${isLocal ? ' local' : ''}`;

        const header = document.createElement('div');
        header.className = 'screen-share-card-header';
        const name = document.createElement('div');
        name.className = 'screen-share-name';
        name.textContent = displayName;
        const status = document.createElement('div');
        status.className = 'screen-share-status';
        status.textContent = isLocal ? 'You' : 'Live';
        header.appendChild(name);
        header.appendChild(status);

        const videoWrap = document.createElement('div');
        videoWrap.className = 'screen-share-video-wrap';

        if (stream) {
            const video = document.createElement('video');
            video.className = 'screen-share-video';
            video.autoplay = true;
            video.playsInline = true;
            video.controls = false;
            video.muted = isLocal;
            video.srcObject = stream;
            videoWrap.appendChild(video);
        } else {
            const waiting = document.createElement('div');
            waiting.className = 'screen-share-waiting';
            waiting.innerHTML = '<div>📡</div><div>Connecting stream...</div>';
            videoWrap.appendChild(waiting);
        }

        const actions = document.createElement('div');
        actions.className = 'screen-share-actions';

        const viewBtn = document.createElement('button');
        viewBtn.type = 'button';
        viewBtn.className = 'screen-share-action';
        viewBtn.textContent = 'View';
        viewBtn.disabled = !stream;
        viewBtn.addEventListener('click', () => openScreenViewer(userId));

        const popoutBtn = document.createElement('button');
        popoutBtn.type = 'button';
        popoutBtn.className = 'screen-share-action';
        popoutBtn.textContent = 'Popout';
        popoutBtn.disabled = !stream;
        popoutBtn.addEventListener('click', () => openScreenPopout(userId));

        const pipBtn = document.createElement('button');
        pipBtn.type = 'button';
        pipBtn.className = 'screen-share-action';
        pipBtn.textContent = 'PiP';
        pipBtn.disabled = !stream;
        pipBtn.addEventListener('click', async () => {
            const video = card.querySelector('video');
            if (!video) return;
            await togglePictureInPicture(video);
        });

        actions.appendChild(viewBtn);
        actions.appendChild(popoutBtn);
        actions.appendChild(pipBtn);

        if (isLocal) {
            const stopBtn = document.createElement('button');
            stopBtn.type = 'button';
            stopBtn.className = 'screen-share-action';
            stopBtn.textContent = 'Stop';
            stopBtn.addEventListener('click', () => {
                stopScreenShare({ notifyServer: true, renegotiate: true }).catch(() => {});
            });
            actions.appendChild(stopBtn);
        }

        card.appendChild(header);
        card.appendChild(videoWrap);
        card.appendChild(actions);
        screenShareGrid.appendChild(card);
    }
}

async function togglePictureInPicture(video) {
    if (!video || !document.pictureInPictureEnabled || typeof video.requestPictureInPicture !== 'function') {
        showNotification('Picture-in-Picture is not supported', 'error');
        return;
    }

    try {
        if (document.pictureInPictureElement === video) {
            await document.exitPictureInPicture();
            return;
        }
        await video.requestPictureInPicture();
    } catch (err) {
        showNotification('Failed to open Picture-in-Picture', 'error');
    }
}

function openScreenPopout(userId) {
    const stream = getScreenStreamForUser(userId);
    if (!stream) {
        showNotification('Stream is not available yet', 'info');
        return;
    }

    const key = String(userId);
    const existing = popoutWindows.get(key);
    if (existing && !existing.closed) {
        existing.focus();
        return;
    }

    const title = getVoiceDisplayName(userId);
    const popup = window.open('', `screen-share-${key}`, 'width=1180,height=760');
    if (!popup) {
        showNotification('Allow popups to open extra window', 'error');
        return;
    }

    popup.document.title = `${title} - Screen Share`;
    popup.document.body.style.margin = '0';
    popup.document.body.style.background = '#060a13';
    popup.document.body.style.color = '#e5e7eb';
    popup.document.body.style.fontFamily = 'Inter, sans-serif';
    popup.document.body.innerHTML = '<div style="padding:12px 14px;border-bottom:1px solid rgba(255,255,255,0.1);font-size:14px;font-weight:600;">' + escapeHtml(title) + '</div>';

    const video = popup.document.createElement('video');
    video.autoplay = true;
    video.controls = true;
    video.playsInline = true;
    video.muted = userId === currentUser?.id;
    video.srcObject = stream;
    video.style.width = '100%';
    video.style.height = 'calc(100vh - 50px)';
    video.style.objectFit = 'contain';
    video.style.background = '#020409';
    popup.document.body.appendChild(video);

    popup.addEventListener('beforeunload', () => {
        popoutWindows.delete(key);
    });

    popoutWindows.set(key, popup);
}

function openScreenViewer(userId) {
    const stream = getScreenStreamForUser(userId);
    if (!stream || !screenViewerModal || !screenViewerVideo) {
        showNotification('Stream is not available yet', 'info');
        return;
    }

    activeScreenViewerUserId = userId;
    if (screenViewerTitle) {
        screenViewerTitle.textContent = `${getVoiceDisplayName(userId)} - Screen Share`;
    }
    screenViewerVideo.srcObject = stream;
    screenViewerVideo.muted = userId === currentUser?.id;
    screenViewerModal.classList.add('active');
}

function closeScreenViewer() {
    if (!screenViewerModal || !screenViewerVideo) return;
    screenViewerModal.classList.remove('active');
    screenViewerVideo.pause();
    screenViewerVideo.srcObject = null;
    activeScreenViewerUserId = null;
}

function resetPendingScreenPreview() {
    if (screenSharePreview) {
        screenSharePreview.pause();
        screenSharePreview.srcObject = null;
    }
    if (screenSharePreviewWrap) {
        screenSharePreviewWrap.classList.remove('ready');
    }
    if (screenSharePreviewMeta) {
        screenSharePreviewMeta.textContent = '';
    }
    if (startScreenShareBtn) {
        startScreenShareBtn.disabled = true;
    }
}

function updatePendingScreenMeta(stream) {
    if (!screenSharePreviewMeta) return;
    const track = stream?.getVideoTracks?.()[0];
    if (!track) {
        screenSharePreviewMeta.textContent = '';
        return;
    }

    const settings = track.getSettings ? track.getSettings() : {};
    const size = settings.width && settings.height ? `${settings.width}x${settings.height}` : 'Auto';
    const fps = settings.frameRate ? `${Math.round(settings.frameRate)}fps` : 'Auto FPS';
    const name = track.label || 'Screen source';
    screenSharePreviewMeta.textContent = `${name} ${size} ${fps}`;
}

function closeScreenShareModal({ keepPending = false } = {}) {
    if (!screenShareModal) return;
    screenShareModal.classList.remove('active');
    if (!keepPending && pendingScreenStream) {
        pendingScreenStream.getTracks().forEach((track) => track.stop());
        pendingScreenStream = null;
    }
    resetPendingScreenPreview();
}

function openScreenShareModal() {
    if (!currentVoiceRoomId) {
        showNotification('Join a voice room first', 'error');
        return;
    }
    if (!screenShareModal) return;
    closeScreenShareModal();
    screenShareModal.classList.add('active');
}

function getScreenShareConstraints() {
    const quality = screenShareQuality?.value || 'balanced';
    const includeAudio = !!screenShareAudio?.checked;

    let width = 1920;
    let height = 1080;
    let frameRate = 30;

    if (quality === 'quality') {
        width = 2560;
        height = 1440;
        frameRate = 60;
    } else if (quality === 'performance') {
        width = 1280;
        height = 720;
        frameRate = 15;
    }

    return {
        video: {
            width: { ideal: width },
            height: { ideal: height },
            frameRate: { ideal: frameRate, max: frameRate },
            cursor: 'always',
        },
        audio: includeAudio,
    };
}

async function pickScreenShareSource() {
    if (!navigator.mediaDevices?.getDisplayMedia) {
        showNotification('Screen sharing is not supported in this browser', 'error');
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getDisplayMedia(getScreenShareConstraints());

        if (pendingScreenStream) {
            pendingScreenStream.getTracks().forEach((track) => track.stop());
        }

        pendingScreenStream = stream;
        if (screenSharePreview) {
            screenSharePreview.srcObject = stream;
            await screenSharePreview.play().catch(() => {});
        }
        if (screenSharePreviewWrap) {
            screenSharePreviewWrap.classList.add('ready');
        }
        updatePendingScreenMeta(stream);
        if (startScreenShareBtn) {
            startScreenShareBtn.disabled = false;
        }
    } catch (err) {
        if (err?.name !== 'NotAllowedError') {
            showNotification('Failed to capture screen', 'error');
        }
    }
}

async function attachLocalScreenTrackToPeer(targetUserId, pc) {
    if (!localScreenStream) return;
    const tracks = localScreenStream.getTracks().filter((track) => track.kind === 'video' || track.kind === 'audio');
    if (!tracks.length) return;

    const existingSenders = localScreenSenders.get(targetUserId) || [];
    const existingKinds = new Set(existingSenders.map((sender) => sender.track?.kind));

    for (const track of tracks) {
        if (existingKinds.has(track.kind)) continue;
        const sender = pc.addTrack(track, localScreenStream);
        existingSenders.push(sender);
        existingKinds.add(track.kind);
    }

    if (existingSenders.length) {
        localScreenSenders.set(targetUserId, existingSenders);
    }
}

async function renegotiatePeerConnection(targetUserId) {
    const pc = peerConnections.get(targetUserId);
    if (!pc || pc.connectionState === 'closed') return;
    if (!ws || ws.readyState !== WebSocket.OPEN || !currentVoiceRoomId) return;
    if (peerRenegotiationLocks.has(targetUserId)) return;

    if (pc.signalingState !== 'stable') {
        setTimeout(() => renegotiatePeerConnection(targetUserId), 180);
        return;
    }

    peerRenegotiationLocks.add(targetUserId);
    try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        ws.send(JSON.stringify({
            type: 'rtc_offer',
            room_id: currentVoiceRoomId,
            target_user_id: targetUserId,
            payload: offer,
        }));
    } catch (err) {
        console.error('Failed to renegotiate peer connection', err);
    } finally {
        peerRenegotiationLocks.delete(targetUserId);
    }
}

async function renegotiateAllPeers() {
    for (const targetUserId of peerConnections.keys()) {
        await renegotiatePeerConnection(targetUserId);
    }
}

async function startScreenShareFromPending() {
    if (!currentVoiceRoomId) {
        closeScreenShareModal();
        return;
    }
    if (!pendingScreenStream) {
        await pickScreenShareSource();
    }
    if (!pendingScreenStream) return;

    if (localScreenStream) {
        await stopScreenShare({ notifyServer: true, renegotiate: true, silent: true });
    }

    localScreenStream = pendingScreenStream;
    pendingScreenStream = null;

    const track = localScreenStream.getVideoTracks()[0];
    if (!track) {
        await stopScreenShare({ notifyServer: false, renegotiate: false, silent: true });
        return;
    }

    track.onended = () => {
        stopScreenShare({ notifyServer: true, renegotiate: true }).catch(() => {});
    };

    closeScreenShareModal({ keepPending: true });

    for (const [targetUserId, pc] of peerConnections.entries()) {
        await attachLocalScreenTrackToPeer(targetUserId, pc);
    }

    signalScreenShareState(true);
    renderScreenShareGrid();
    updateScreenShareButtonState();
    playStreamEventSound('start');

    await renegotiateAllPeers();
    showNotification('Screen sharing started', 'success');
}

async function stopScreenShare(options = {}) {
    const {
        notifyServer = true,
        renegotiate = true,
        silent = false,
    } = options;

    if (isScreenShareStopping) return;
    if (!localScreenStream && !pendingScreenStream) return;

    isScreenShareStopping = true;
    try {
        if (pendingScreenStream) {
            pendingScreenStream.getTracks().forEach((track) => track.stop());
            pendingScreenStream = null;
        }

        const hadLocalScreen = !!localScreenStream;
        if (localScreenStream) {
            localScreenStream.getTracks().forEach((track) => track.stop());
            localScreenStream = null;
        }

        closeScreenPopout(currentUser?.id);

        for (const [targetUserId, senders] of localScreenSenders.entries()) {
            const pc = peerConnections.get(targetUserId);
            if (!pc || pc.connectionState === 'closed') continue;
            for (const sender of senders) {
                try {
                    pc.removeTrack(sender);
                } catch (_) {
                    // ignore
                }
            }
        }
        localScreenSenders.clear();

        if (hadLocalScreen && notifyServer) {
            signalScreenShareState(false);
        } else if (!notifyServer) {
            updateLocalScreenShareParticipantState(false);
            renderVoiceParticipantsGrid();
        }

        if (hadLocalScreen && renegotiate) {
            await renegotiateAllPeers();
        }

        if (activeScreenViewerUserId === currentUser?.id) {
            closeScreenViewer();
        }

        renderScreenShareGrid();
        updateScreenShareButtonState();
        if (hadLocalScreen) {
            playStreamEventSound('end');
        }
        if (!silent && hadLocalScreen) {
            showNotification('Screen sharing stopped', 'info');
        }
    } finally {
        isScreenShareStopping = false;
    }
}

async function ensureLocalStream() {
    if (localStream) return localStream;
    localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
            echoCancellation: false,
            noiseSuppression: true,
            autoGainControl: false,
            channelCount: 1,
            sampleRate: 48000,
            sampleSize: 16,
            latency: 0.01,
        },
        video: false,
    });

    micAudioContext = new AudioContext();
    const source = micAudioContext.createMediaStreamSource(localStream);
    micGainNode = micAudioContext.createGain();
    micGainNode.gain.value = micGainValue;
    const destination = micAudioContext.createMediaStreamDestination();
    source.connect(micGainNode).connect(destination);
    processedOutboundStream = destination.stream;

    return localStream;
}

async function joinVoiceRoom(roomId) {
    await wsReady;
    await ensureLocalStream();
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    if (currentVoiceRoomId && currentVoiceRoomId !== roomId) {
        peerConnections.forEach((_, uid) => closePeerConnection(uid));
        ws.send(JSON.stringify({ type: 'leave_room', room_id: currentVoiceRoomId }));
    }

    ws.send(JSON.stringify({ type: 'join_room', room_id: roomId }));
}

function leaveVoiceRoom() {
    stopScreenShare({ notifyServer: true, renegotiate: false, silent: true }).catch(() => {});
    closeScreenShareModal();
    closeScreenViewer();

    for (const userId of Array.from(popoutWindows.keys())) {
        closeScreenPopout(userId);
    }
    remoteAudioStreams.clear();
    remoteScreenStreams.clear();
    localScreenSenders.clear();

    if (currentVoiceRoomId && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'leave_room', room_id: currentVoiceRoomId }));
    }

    playVoiceEventSound('leave');
    peerConnections.forEach((_, uid) => closePeerConnection(uid));
    const leftRoomId = currentVoiceRoomId;
    currentVoiceRoomId = null;
    voiceParticipants = [];
    if (voiceOverlay) voiceOverlay.classList.remove('in-room');
    if (leftRoomId) voiceRoomParticipantsByRoom[leftRoomId] = [];
    if (speakingInterval) {
        clearInterval(speakingInterval);
        speakingInterval = null;
    }
    renderVoiceRooms();
    renderVoiceParticipantsGrid();
    renderScreenShareGrid();
}

function createPeerConnection(targetUserId) {
    const pc = new RTCPeerConnection({
        bundlePolicy: "max-bundle",
        rtcpMuxPolicy: "require",
        iceCandidatePoolSize: 10,
        iceServers: [{ urls: ["stun:stun.l.google.com:19302"] }],
    });

    (processedOutboundStream || localStream).getTracks().forEach((track) => {
        const sender = pc.addTrack(track, (processedOutboundStream || localStream));
        const params = sender.getParameters();
        if (!params.encodings) params.encodings = [{}];
        params.encodings[0].maxBitrate = 64000;
        params.encodings[0].priority = "high";
        sender.setParameters(params).catch(() => {});
    });

    if (localScreenStream) {
        attachLocalScreenTrackToPeer(targetUserId, pc).catch(() => {});
    }

    pc.onicecandidate = (event) => {
        if (event.candidate && ws && currentVoiceRoomId) {
            ws.send(JSON.stringify({
                type: 'rtc_ice',
                room_id: currentVoiceRoomId,
                target_user_id: targetUserId,
                payload: event.candidate,
            }));
        }
    };

    pc.ontrack = (event) => {
        if (event.track.kind === 'audio') {
            let remoteStream = remoteAudioStreams.get(targetUserId);
            if (!remoteStream) {
                remoteStream = new MediaStream();
                remoteAudioStreams.set(targetUserId, remoteStream);
            }
            remoteStream.addTrack(event.track);

            const audio = document.getElementById(`remote-audio-${targetUserId}`) || document.createElement('audio');
            audio.id = `remote-audio-${targetUserId}`;
            audio.autoplay = true;
            audio.srcObject = remoteStream;
            // Mute the HTML element — actual playback with amplification goes through GainNode below
            audio.muted = true;
            document.body.appendChild(audio);

            // Route audio through Web Audio GainNode (supports gain > 1.0 for real amplification)
            let gainEntry = remoteAudioGainNodes.get(targetUserId);
            if (gainEntry) {
                try { gainEntry.audioCtx.close(); } catch (e) {}
            }
            const audioCtx = new AudioContext();
            const gainNode = audioCtx.createGain();
            gainEntry = { audioCtx, gainNode };
            remoteAudioGainNodes.set(targetUserId, gainEntry);
            const participantVolume = participantVolumes[targetUserId] ?? 1;
            gainNode.gain.value = isDeafened ? 0 : participantVolume * headphonesGainValue;
            audioCtx.createMediaStreamSource(remoteStream).connect(gainNode).connect(audioCtx.destination);

            event.track.onended = () => {
                const stream = remoteAudioStreams.get(targetUserId);
                if (!stream) return;
                stream.removeTrack(event.track);
                if (stream.getAudioTracks().length > 0) return;
                remoteAudioStreams.delete(targetUserId);
                const remoteAudio = document.getElementById(`remote-audio-${targetUserId}`);
                if (remoteAudio) {
                    remoteAudio.remove();
                }
                // Clean up GainNode AudioContext
                const ge = remoteAudioGainNodes.get(targetUserId);
                if (ge) {
                    try { ge.audioCtx.close(); } catch (e) {}
                    remoteAudioGainNodes.delete(targetUserId);
                }
            };
            return;
        }

        if (event.track.kind === 'video') {
            const stream = new MediaStream([event.track]);
            remoteScreenStreams.set(targetUserId, { stream, track: event.track });
            event.track.onended = () => {
                remoteScreenStreams.delete(targetUserId);
                closeScreenPopout(targetUserId);
                if (activeScreenViewerUserId === targetUserId) {
                    closeScreenViewer();
                }
                renderScreenShareGrid();
            };

            if (activeScreenViewerUserId === targetUserId && screenViewerVideo) {
                screenViewerVideo.srcObject = stream;
            }

            renderScreenShareGrid();
        }
    };

    peerConnections.set(targetUserId, pc);
    return pc;
}

function closePeerConnection(userId) {
    const pc = peerConnections.get(userId);
    if (pc) pc.close();

    peerConnections.delete(userId);
    peerRenegotiationLocks.delete(userId);
    localScreenSenders.delete(userId);

    const audio = document.getElementById(`remote-audio-${userId}`);
    if (audio) audio.remove();

    remoteAudioStreams.delete(userId);
    remoteScreenStreams.delete(userId);
    closeScreenPopout(userId);
    if (activeScreenViewerUserId === userId) {
        closeScreenViewer();
    }
    renderScreenShareGrid();
}

async function ensurePeerConnections() {
    if (!currentVoiceRoomId || !localStream) return;
    const others = voiceParticipants.filter((participant) => participant.user_id !== currentUser.id);

    for (const participant of others) {
        if (peerConnections.has(participant.user_id)) {
            if (localScreenStream && !localScreenSenders.has(participant.user_id)) {
                const existingPc = peerConnections.get(participant.user_id);
                if (existingPc) {
                    await attachLocalScreenTrackToPeer(participant.user_id, existingPc);
                    await renegotiatePeerConnection(participant.user_id);
                }
            }
            continue;
        }

        const pc = createPeerConnection(participant.user_id);
        if (currentUser.id < participant.user_id) {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            ws.send(JSON.stringify({
                type: 'rtc_offer',
                room_id: currentVoiceRoomId,
                target_user_id: participant.user_id,
                payload: offer,
            }));
        }
    }
}

async function handleRtcOffer(data) {
    await ensureLocalStream();
    let pc = peerConnections.get(data.from_user_id);
    if (!pc) pc = createPeerConnection(data.from_user_id);
    await pc.setRemoteDescription(new RTCSessionDescription(data.payload));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    ws.send(JSON.stringify({ type: 'rtc_answer', room_id: data.room_id, target_user_id: data.from_user_id, payload: answer }));
}

async function handleRtcAnswer(data) {
    const pc = peerConnections.get(data.from_user_id);
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(data.payload));
}

async function handleRtcIce(data) {
    const pc = peerConnections.get(data.from_user_id);
    if (!pc) return;
    await pc.addIceCandidate(new RTCIceCandidate(data.payload));
}

function setMute(nextMuted) {
    isMuted = nextMuted;
    const me = voiceParticipants.find(p => p.user_id === currentUser?.id);
    if (me) { me.muted = isMuted; me.speaking = false; renderVoiceParticipantsGrid(); renderVoiceRooms(); }
    if (localStream) localStream.getAudioTracks().forEach(t => { t.enabled = !nextMuted; });
    if (ws && currentVoiceRoomId) ws.send(JSON.stringify({ type: 'set_mute', room_id: currentVoiceRoomId, muted: isMuted }));
    updateMuteButtonIcon();
}

function setDeafen(nextDeafened) {
    isDeafened = nextDeafened;
    const me = voiceParticipants.find(p => p.user_id === currentUser?.id);
    if (me) { me.deafened = isDeafened; renderVoiceParticipantsGrid(); renderVoiceRooms(); }
    document.querySelectorAll('[id^="remote-audio-"]').forEach(audio => {
        const uid = Number((audio.id || '').replace('remote-audio-', ''));
        const gainEntry = remoteAudioGainNodes.get(uid);
        if (gainEntry) {
            const participantVolume = participantVolumes[uid] ?? 1;
            gainEntry.gainNode.gain.value = isDeafened ? 0 : participantVolume * headphonesGainValue;
        } else {
            audio.muted = isDeafened;
        }
    });
    if (ws && currentVoiceRoomId) ws.send(JSON.stringify({ type: 'set_deafen', room_id: currentVoiceRoomId, deafened: isDeafened }));
    updateDeafenButtonIcon();
    if (toggleDeafenBtn) {
        toggleDeafenBtn.setAttribute('aria-label', isDeafened ? 'Disable deafen' : 'Enable deafen');
        toggleDeafenBtn.title = isDeafened ? 'Включить звук комнаты' : 'Заглушить комнату';
    }
}

function updateMuteButtonIcon() {
    const icon = toggleMicBtn?.querySelector('.voice-control-icon');
    if (icon) {
        if (isMuted) {
            icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>';
        } else {
            icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>';
        }
    }
    if (toggleMicBtn) {
        toggleMicBtn.setAttribute('aria-label', isMuted ? 'Unmute microphone' : 'Mute microphone');
        toggleMicBtn.title = isMuted ? 'Включить микрофон' : 'Выключить микрофон';
        toggleMicBtn.classList.toggle('active', isMuted);
    }
}

function updateDeafenButtonIcon() {
    const icon = toggleDeafenBtn?.querySelector('.voice-control-icon');
    if (icon) {
        if (isDeafened) {
            icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>';
        } else {
            icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>';
        }
    }
    if (toggleDeafenBtn) {
        toggleDeafenBtn.classList.toggle('active', isDeafened);
    }
}

function applyHeadphonesGain() {
    document.querySelectorAll('[id^="remote-audio-"]').forEach((audioEl) => {
        const userId = Number((audioEl.id || '').replace('remote-audio-', ''));
        const participantVolume = participantVolumes[userId] ?? 1;
        const gainEntry = remoteAudioGainNodes.get(userId);
        if (gainEntry) {
            gainEntry.gainNode.gain.value = isDeafened ? 0 : participantVolume * headphonesGainValue;
        } else {
            audioEl.volume = Math.max(0, Math.min(1, participantVolume * headphonesGainValue));
        }
    });
}

function setParticipantVolume(userId, value) {
    participantVolumes[userId] = value;
    localStorage.setItem('participantVolumes', JSON.stringify(participantVolumes));
    applyHeadphonesGain();
}

let speakingInterval = null;
let lastSpeakingState = false;
function startSpeakingDetector() {
    if (speakingInterval || !localStream) return;
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.85;
    const source = ctx.createMediaStreamSource(localStream);
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    let smoothedLevel = 0;
    let speechHangUntil = 0;
    const startThreshold = 7.5;
    const stopThreshold = 4.5;
    const holdMs = 350;
    speakingInterval = setInterval(() => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += Math.abs(data[i] - 128);
        const averageLevel = sum / data.length;
        smoothedLevel = (smoothedLevel * 0.82) + (averageLevel * 0.18);
        const now = Date.now();
        let speaking = lastSpeakingState;

        if (!isMuted) {
            if (!lastSpeakingState && smoothedLevel >= startThreshold) {
                speaking = true;
                speechHangUntil = now + holdMs;
            } else if (lastSpeakingState) {
                if (smoothedLevel >= stopThreshold) {
                    speechHangUntil = now + holdMs;
                } else if (now > speechHangUntil) {
                    speaking = false;
                }
            }
        } else {
            speaking = false;
        }

        if (speaking === lastSpeakingState) return;
        lastSpeakingState = speaking;
        if (ws && currentVoiceRoomId) ws.send(JSON.stringify({ type: 'speaking', room_id: currentVoiceRoomId, speaking }));
    }, 250);
}


voiceRoomsList.addEventListener('click', async (event) => {
    const item = event.target.closest('[data-voice-room-id]');
    if (!item) return;
    await joinVoiceRoom(Number(item.dataset.voiceRoomId));
    startSpeakingDetector();
});

createVoiceRoomBtn.addEventListener('click', () => openModal('voice'));

toggleMicBtn.addEventListener('click', () => setMute(!isMuted));
toggleDeafenBtn.addEventListener('click', () => setDeafen(!isDeafened));
if (toggleScreenShareBtn) {
    toggleScreenShareBtn.addEventListener('click', () => {
        if (localScreenStream) {
            stopScreenShare({ notifyServer: true, renegotiate: true }).catch(() => {});
            return;
        }
        openScreenShareModal();
    });
}
leaveVoiceBtn.addEventListener('click', () => leaveVoiceRoom());

if (pickScreenSourceBtn) {
    pickScreenSourceBtn.addEventListener('click', () => {
        pickScreenShareSource().catch(() => {});
    });
}

if (startScreenShareBtn) {
    startScreenShareBtn.addEventListener('click', () => {
        startScreenShareFromPending().catch(() => {});
    });
}

if (cancelScreenShareBtn) {
    cancelScreenShareBtn.addEventListener('click', () => closeScreenShareModal());
}
if (closeScreenShareModalBtn) {
    closeScreenShareModalBtn.addEventListener('click', () => closeScreenShareModal());
}
if (screenShareModal) {
    screenShareModal.addEventListener('click', (event) => {
        if (event.target === screenShareModal) {
            closeScreenShareModal();
        }
    });
}

if (closeScreenViewerModalBtn) {
    closeScreenViewerModalBtn.addEventListener('click', () => closeScreenViewer());
}
if (screenViewerModal) {
    screenViewerModal.addEventListener('click', (event) => {
        if (event.target === screenViewerModal) {
            closeScreenViewer();
        }
    });
}
if (screenViewerPopoutBtn) {
    screenViewerPopoutBtn.addEventListener('click', () => {
        if (!activeScreenViewerUserId) return;
        openScreenPopout(activeScreenViewerUserId);
    });
}
if (screenViewerPipBtn) {
    screenViewerPipBtn.addEventListener('click', async () => {
        if (!screenViewerVideo) return;
        await togglePictureInPicture(screenViewerVideo);
    });
}

document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (screenShareModal?.classList.contains('active')) {
        closeScreenShareModal();
    }
    if (screenViewerModal?.classList.contains('active')) {
        closeScreenViewer();
    }
});

// Voice overlay collapse functionality
let isVoiceOverlayCollapsed = false;
let isVoiceSettingsOpen = false;

function setVoiceSettingsOpen(nextOpen) {
    isVoiceSettingsOpen = !!nextOpen;
    if (voiceSettingsPanel) {
        voiceSettingsPanel.classList.toggle('open', isVoiceSettingsOpen);
    }
    if (toggleVoiceSettingsBtn) {
        toggleVoiceSettingsBtn.classList.toggle('active', isVoiceSettingsOpen);
        toggleVoiceSettingsBtn.setAttribute('aria-expanded', isVoiceSettingsOpen ? 'true' : 'false');
    }
}

collapseVoiceBtn.addEventListener('click', () => {
    isVoiceOverlayCollapsed = !isVoiceOverlayCollapsed;
    voiceOverlay.classList.toggle('collapsed', isVoiceOverlayCollapsed);
    collapseIcon.textContent = isVoiceOverlayCollapsed ? '▶' : '▼';
    
    if (isVoiceOverlayCollapsed) {
        // Clear custom height when collapsing
        voiceOverlay.style.height = '';
        voiceOverlay.style.maxHeight = '';
        setVoiceSettingsOpen(false);
    } else {
        // Restore saved height when expanding
        loadVoiceOverlayHeight();
        updateCollapsedParticipants();
    }
    if (!isVoiceOverlayCollapsed) {
        updateCollapsedParticipants();
    }
});

if (toggleVoiceSettingsBtn) {
    toggleVoiceSettingsBtn.addEventListener('click', () => {
        if (!currentVoiceRoomId || isVoiceOverlayCollapsed) return;
        setVoiceSettingsOpen(!isVoiceSettingsOpen);
    });
}

// Voice overlay resize functionality
const voiceResizeHandle = document.getElementById('voiceResizeHandle');
let isResizing = false;
let startY = 0;
let startHeight = 0;
const MIN_VOICE_OVERLAY_HEIGHT = 80;
const MAX_VOICE_OVERLAY_HEIGHT = 500;

function loadVoiceOverlayHeight() {
    const savedHeight = localStorage.getItem('voiceOverlayHeight');
    if (savedHeight && voiceOverlay) {
        const height = parseInt(savedHeight, 10);
        if (height >= MIN_VOICE_OVERLAY_HEIGHT && height <= MAX_VOICE_OVERLAY_HEIGHT) {
            voiceOverlay.style.height = height + 'px';
            voiceOverlay.style.maxHeight = 'none';
        }
    }
}

function saveVoiceOverlayHeight(height) {
    localStorage.setItem('voiceOverlayHeight', height);
}

function handleResizeStart(e) {
    if (isVoiceOverlayCollapsed) return;
    e.preventDefault();
    
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    
    isResizing = true;
    voiceOverlay.classList.add('resizing');
    voiceResizeHandle.classList.add('resizing');
    startY = clientY;
    
    // Get current height or use auto
    const computedStyle = window.getComputedStyle(voiceOverlay);
    if (computedStyle.height && computedStyle.height !== 'auto') {
        startHeight = parseInt(computedStyle.height, 10);
    } else {
        startHeight = voiceOverlay.offsetHeight;
    }
    
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
}

function handleResizeMove(e) {
    if (!isResizing) return;
    
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    
    const deltaY = clientY - startY;
    let newHeight = startHeight + deltaY;
    
    // Clamp height between min and max
    newHeight = Math.max(MIN_VOICE_OVERLAY_HEIGHT, Math.min(MAX_VOICE_OVERLAY_HEIGHT, newHeight));
    
    voiceOverlay.style.height = newHeight + 'px';
    voiceOverlay.style.maxHeight = 'none';
}

function handleResizeEnd() {
    if (!isResizing) return;
    
    isResizing = false;
    voiceOverlay.classList.remove('resizing');
    voiceResizeHandle.classList.remove('resizing');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    
    // Save the new height
    if (voiceOverlay.style.height) {
        saveVoiceOverlayHeight(parseInt(voiceOverlay.style.height, 10));
    }
}

if (voiceResizeHandle && voiceOverlay) {
    // Mouse events
    voiceResizeHandle.addEventListener('mousedown', handleResizeStart);
    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', handleResizeEnd);
    
    // Touch events for mobile
    voiceResizeHandle.addEventListener('touchstart', handleResizeStart, { passive: false });
    document.addEventListener('touchmove', handleResizeMove, { passive: false });
    document.addEventListener('touchend', handleResizeEnd);
    document.addEventListener('touchcancel', handleResizeEnd);
}

// Load saved height on page load
loadVoiceOverlayHeight();

// Voice overlay toggle button functionality
const voiceToggleBtn = document.getElementById('voiceToggleBtn');
let isVoiceOverlayVisible = false;

if (voiceToggleBtn) {
    voiceToggleBtn.addEventListener('click', () => {
        if (!voiceOverlay) return;
        isVoiceOverlayVisible = !isVoiceOverlayVisible;
        voiceOverlay.classList.toggle('visible', isVoiceOverlayVisible);
        voiceToggleBtn.classList.toggle('active', isVoiceOverlayVisible);
        if (!isVoiceOverlayVisible) {
            setVoiceSettingsOpen(false);
        }
    });
}

function updateCollapsedParticipants() {
    if (!voiceCollapsedParticipants) return;

    voiceCollapsedParticipants.innerHTML = voiceParticipants.map((participant) => {
        const rawName = participant.display_name || participant.username || 'User';
        const safeName = escapeHtml(rawName);
        const initial = escapeHtml(rawName.charAt(0).toUpperCase() || 'U');
        const avatarUrl = withAvatarCacheBuster(
            normalizeAvatarUrl(participant.avatar_url),
            participant.user_id
        );
        const avatarMarkup = avatarUrl
            ? `<img src="${escapeHtml(avatarUrl)}" alt="${safeName}" class="voice-collapsed-avatar-img" data-avatar-fallback="${initial}">`
            : `<span>${initial}</span>`;

        return `<div class="voice-collapsed-participant${participant.speaking ? ' speaking' : ''}"><span class="avatar" data-avatar-fallback-target="1">${avatarMarkup}</span><span class="name">${safeName}</span></div>`;
    }).join('');

    attachVoiceAvatarFallbacks(voiceCollapsedParticipants);
}
if (micVolumeSlider) micVolumeSlider.value = String(Math.round(micGainValue * 100));
if (headphoneVolumeSlider) headphoneVolumeSlider.value = String(Math.round(headphonesGainValue * 100));
if (micVolumeValue) micVolumeValue.textContent = `${Math.round(micGainValue * 100)}%`;
if (headphoneVolumeValue) headphoneVolumeValue.textContent = `${Math.round(headphonesGainValue * 100)}%`;
updateScreenShareButtonState();
renderScreenShareGrid();

// ==========================================
// INITIALIZATION
// ==========================================

async function init() {
    // Инициализируем тему
    initTheme();
    initDiscordTooltips();
    completeLoadingTask('Стили');
    
    await loadCurrentUser();
    completeLoadingTask('Конфигурация');
    
    await loadRooms();
    completeLoadingTask('Интерфейс');
    
    await loadVoiceRooms();
    
    // Подключаемся к глобальному WebSocket ОДИН РАЗ
    connectWebSocket();
    completeLoadingTask('Подключение');
    
    // Add click listener for connection stats popup
    if (connectionStatus) {
        connectionStatus.addEventListener('click', toggleConnectionStatsPopup);
    }
    
    // Инициализируем сайдбар пользователей
    initUsersSidebar();
    
    // Инициализируем emoji picker
    initEmojiPicker();
    
    // Инициализируем Twemoji для Discord-подобных эмодзи
    if (typeof twemoji !== 'undefined') {
        twemoji.parse(document.body, {
            base: 'https://cdn.jsdelivr.net/npm/twemoji@14.0.2/assets/',
            folder: 'svg',
            ext: '.svg'
        });
    }
    
    // Глобальный keyboard shortcut для открытия emoji picker
    document.addEventListener('keydown', (e) => {
        // Ctrl+E or Cmd+E anywhere to open emoji picker
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
            // Don't interfere if user is typing in an input
            const target = e.target;
            const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
            
            if (isInput && target.id !== 'emojiSearch') {
                // If in message input, just prevent default and toggle
                e.preventDefault();
            }
            toggleEmojiPicker();
        }
    });
    
    // Ждём подключения WebSocket перед скрытием экрана загрузки
    // Добавляем safety timeout на случай, если WebSocket не подключится
    const loadingTimeout = setTimeout(() => {
        console.warn('[Loading] Timeout waiting for WebSocket, proceeding anyway');
        hideLoadingScreen();
    }, 15000); // Максимум 15 секунд ожидания
    
    wsReady.then(() => {
        clearTimeout(loadingTimeout);
        // Скрываем экран загрузки только после подключения WebSocket
        hideLoadingScreen();
    });
}

// Инициализируем экран загрузки
initLoadingScreen();

// =============================================
// Mobile Menu Functions (PWA)
// =============================================
function initMobileMenu() {
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const roomsSidebar = document.getElementById('roomsSidebar');
    const sidebarOverlay = document.getElementById('roomsSidebarOverlay');
    
    if (!mobileMenuBtn || !roomsSidebar) return;
    
    // Показываем кнопку только на мобильных
    const checkMobile = () => {
        if (window.innerWidth <= 640) {
            mobileMenuBtn.style.display = 'flex';
            // Показываем sidebar
            roomsSidebar.style.display = 'flex';
        } else {
            mobileMenuBtn.style.display = 'none';
            roomsSidebar.classList.remove('active');
            roomsSidebar.style.display = '';
            if (sidebarOverlay) sidebarOverlay.classList.remove('active');
        }
    };
    
    // Проверяем при загрузке и при ресайзе
    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    // Открытие меню
    mobileMenuBtn.addEventListener('click', () => {
        // Добавляем inline стили для гарантии
        roomsSidebar.style.position = 'fixed';
        roomsSidebar.style.left = '0';
        roomsSidebar.style.top = '0';
        roomsSidebar.style.bottom = '0';
        roomsSidebar.style.width = '85%';
        roomsSidebar.style.maxWidth = '300px';
        roomsSidebar.style.zIndex = '1000';
        roomsSidebar.style.transform = 'translateX(0)';
        roomsSidebar.style.transition = 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
        roomsSidebar.style.borderRadius = '0';
        roomsSidebar.style.margin = '8px 0 8px 8px';
        roomsSidebar.style.display = 'flex';
        
        roomsSidebar.classList.add('active');
        if (sidebarOverlay) {
            sidebarOverlay.style.position = 'fixed';
            sidebarOverlay.style.top = '0';
            sidebarOverlay.style.left = '0';
            sidebarOverlay.style.right = '0';
            sidebarOverlay.style.bottom = '0';
            sidebarOverlay.style.background = 'rgba(0, 0, 0, 0.6)';
            sidebarOverlay.style.zIndex = '999';
            sidebarOverlay.classList.add('active');
        }
        document.body.style.overflow = 'hidden';
    });
    
    // Закрытие по оверлею
    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', () => {
            roomsSidebar.classList.remove('active');
            roomsSidebar.style.transform = 'translateX(-100%)';
            sidebarOverlay.classList.remove('active');
            document.body.style.overflow = '';
        });
    }
    
    // Закрытие меню при выборе комнаты (на мобильных)
    const roomsList = document.getElementById('roomsList');
    if (roomsList) {
        roomsList.addEventListener('click', (e) => {
            if (e.target.closest('.room-item') && window.innerWidth <= 640) {
                roomsSidebar.classList.remove('active');
                roomsSidebar.style.transform = 'translateX(-100%)';
                if (sidebarOverlay) sidebarOverlay.classList.remove('active');
                document.body.style.overflow = '';
            }
        });
    }
}

// =============================================
// Mobile Users Sidebar Functions (PWA)
// =============================================
function initMobileUsersSidebar() {
    const mobileUsersBtn = document.getElementById('mobileUsersBtn');
    const usersSidebar = document.getElementById('usersSidebar');
    const usersSidebarOverlay = document.getElementById('usersSidebarOverlay');
    
    if (!mobileUsersBtn || !usersSidebar) return;
    
    // Показываем кнопку только на мобильных
    const checkMobile = () => {
        if (window.innerWidth <= 640) {
            mobileUsersBtn.style.display = 'flex';
        } else {
            mobileUsersBtn.style.display = 'none';
            usersSidebar.classList.remove('active');
            if (usersSidebarOverlay) usersSidebarOverlay.classList.remove('active');
            document.body.style.overflow = '';
        }
    };
    
    // Проверяем при загрузке и при ресайзе
    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    // Открытие users sidebar
    mobileUsersBtn.addEventListener('click', () => {
        // Просто добавляем класс active - CSS сделает всю работу
        usersSidebar.classList.add('active');
        if (usersSidebarOverlay) {
            usersSidebarOverlay.classList.add('active');
        }
        document.body.style.overflow = 'hidden';
    });
    
    // Закрытие по оверлею
    if (usersSidebarOverlay) {
        usersSidebarOverlay.addEventListener('click', () => {
            usersSidebar.classList.remove('active');
            usersSidebarOverlay.classList.remove('active');
            document.body.style.overflow = '';
        });
    }
    
    // Swipe gestures для мобильных
    let touchStartX = 0;
    let touchEndX = 0;
    const minSwipeDistance = 50;
    
    // Swipe на чате - свайп вправо открывает список пользователей
    const chatContainer = document.querySelector('.chat-container') || document.querySelector('.messages-container');
    if (chatContainer) {
        chatContainer.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
        }, { passive: true });
        
        chatContainer.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].screenX;
            handleSwipe();
        }, { passive: true });
    }
    
    // Swipe на сайдбаре - свайп влево закрывает его
    usersSidebar.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });
    
    usersSidebar.addEventListener('touchend', (e) => {
        touchEndX = e.changedTouches[0].screenX;
        handleSidebarSwipe();
    }, { passive: true });
    
    function handleSwipe() {
        const swipeDistance = touchEndX - touchStartX;
        // Свайп вправо - открыть сайдбар
        if (swipeDistance > minSwipeDistance && window.innerWidth <= 640) {
            // Проверяем, что сайдбар еще не открыт
            if (!usersSidebar.classList.contains('active')) {
                usersSidebar.classList.add('active');
                if (usersSidebarOverlay) {
                    usersSidebarOverlay.classList.add('active');
                }
                document.body.style.overflow = 'hidden';
            }
        }
    }
    
    function handleSidebarSwipe() {
        const swipeDistance = touchEndX - touchStartX;
        // Свайп влево - закрыть сайдбар
        if (swipeDistance < -minSwipeDistance && window.innerWidth <= 640) {
            if (usersSidebar.classList.contains('active')) {
                usersSidebar.classList.remove('active');
                if (usersSidebarOverlay) {
                    usersSidebarOverlay.classList.remove('active');
                }
                document.body.style.overflow = '';
            }
        }
    }
}

// Инициализируем мобильное меню
initMobileMenu();

// Инициализируем мобильную панель пользователей
initMobileUsersSidebar();

init();

// =============================================
// Admin Panel Functions
// =============================================

// Admin elements
const createInviteBtn = document.getElementById('createInviteBtn');
const inviteMaxUses = document.getElementById('inviteMaxUses');
const inviteExpiresIn = document.getElementById('inviteExpiresIn');
const invitesListBody = document.getElementById('invitesListBody');

// Load rooms for admin panel
async function loadAdminRooms() {
    if (!currentUser || currentUser.role !== 'admin') return;
    
    try {
        const response = await fetch('/rooms', {
            credentials: 'include'
        });
        
        if (!response.ok) throw new Error('Failed to load rooms');
        
        const rooms = await response.json();
        renderAdminRoomsList(rooms);
        
    } catch (err) {
        console.error('Error loading rooms:', err);
    }
}

// Render rooms list in admin panel
function renderAdminRoomsList(rooms) {
    const adminRoomsListBody = document.getElementById('adminRoomsListBody');
    if (!adminRoomsListBody) return;
    
    if (!rooms || rooms.length === 0) {
        adminRoomsListBody.innerHTML = '<div class="admin-rooms-empty">Нет комнат</div>';
        return;
    }
    
    adminRoomsListBody.innerHTML = rooms.map(room => {
        const createdAt = room.created_at 
            ? new Date(room.created_at).toLocaleString('ru-RU')
            : '—';
        
        return `
            <div class="admin-room-row">
                <span class="admin-room-name">${escapeHtml(room.title)}</span>
                <span class="admin-room-created">${createdAt}</span>
                <span class="admin-room-actions">
                    <button class="admin-room-delete-btn" data-id="${room.id}" title="Удалить">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </span>
            </div>
        `;
    }).join('');
    
    // Add delete event listeners
    adminRoomsListBody.querySelectorAll('.admin-room-delete-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const roomId = btn.dataset.id;
            if (confirm('Вы уверены, что хотите удалить эту комнату?')) {
                await deleteRoom(roomId);
            }
        });
    });
}

// Delete room
async function deleteRoom(roomId) {
    if (!currentUser || currentUser.role !== 'admin') return;
    
    try {
        const response = await fetch(`/rooms/${roomId}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Не удалось удалить комнату');
        }
        
        adminNotify('Комната удалена', 'success');
        
        // Reload rooms and stats
        await loadAdminRooms();
        await loadAdminStats();
        
    } catch (err) {
        console.error('Error deleting room:', err);
        adminNotify(err.message || 'Ошибка при удалении комнаты', 'error');
    }
}

// Create room from admin panel
async function adminCreateRoom() {
    if (!currentUser || currentUser.role !== 'admin') return;
    
    const roomNameInput = document.getElementById('adminRoomName');
    const roomDescInput = document.getElementById('adminRoomDesc');
    
    const title = roomNameInput?.value.trim();
    if (!title) {
        adminNotify('Введите название комнаты', 'error');
        return;
    }
    
    try {
        const response = await fetch('/rooms', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({
                title: title,
                description: roomDescInput?.value.trim() || ''
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Не удалось создать комнату');
        }
        
        const room = await response.json();
        adminNotify('Комната создана!', 'success');
        
        // Clear form
        if (roomNameInput) roomNameInput.value = '';
        if (roomDescInput) roomDescInput.value = '';
        
        // Reload rooms and stats
        await loadAdminRooms();
        await loadAdminStats();
        
    } catch (err) {
        console.error('Error creating room:', err);
        adminNotify(err.message || 'Ошибка при создании комнаты', 'error');
    }
}

// Load invites list
async function loadInvites() {
    if (!currentUser || currentUser.role !== 'admin') return;
    
    try {
        const response = await fetch('/api/admin/invites', {
            credentials: 'include'
        });
        
        if (!response.ok) throw new Error('Failed to load invites');
        
        const invites = await response.json();
        renderInvitesList(invites);
        
    } catch (err) {
        console.error('Error loading invites:', err);
    }
}

// Render invites list
function renderInvitesList(invites) {
    if (!invitesListBody) return;
    
    if (!invites || invites.length === 0) {
        invitesListBody.innerHTML = '<div class="invites-empty">Нет пригласительных кодов</div>';
        return;
    }
    
    invitesListBody.innerHTML = invites.map(invite => {
        const expiresText = invite.expires_at 
            ? new Date(invite.expires_at).toLocaleString('ru-RU')
            : 'Бессрочно';
        
        const usesText = invite.max_uses 
            ? `${invite.current_uses}/${invite.max_uses}`
            : '∞';
        
        const isExpired = invite.expires_at && new Date(invite.expires_at) < new Date();
        const isRevoked = invite.revoked;
        const canRevoke = !isRevoked && !isExpired;
        
        return `
            <div class="invite-row ${isRevoked ? 'revoked' : ''} ${isExpired ? 'expired' : ''}">
                <span class="invite-code">${escapeHtml(invite.code)}</span>
                <span class="invite-uses">${usesText}</span>
                <span class="invite-expires">${expiresText}</span>
                <span class="invite-actions">
                    <button class="invite-copy-btn" data-code="${escapeHtml(invite.code)}" title="Копировать">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                    </button>
                    ${canRevoke ? `
                        <button class="invite-revoke-btn" data-id="${invite.id}" title="Отозвать">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10"></circle>
                                <line x1="15" y1="9" x2="9" y2="15"></line>
                                <line x1="9" y1="9" x2="15" y2="15"></line>
                            </svg>
                        </button>
                    ` : ''}
                    ${isRevoked ? '<span class="invite-status-revoked">Отозван</span>' : ''}
                    ${isExpired && !isRevoked ? '<span class="invite-status-expired">Истёк</span>' : ''}
                </span>
            </div>
        `;
    }).join('');
    
    // Add event listeners
    invitesListBody.querySelectorAll('.invite-copy-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const code = btn.dataset.code;
            navigator.clipboard.writeText(code).then(() => {
                adminNotify('Код скопирован!', 'success');
            });
        });
    });
    
    invitesListBody.querySelectorAll('.invite-revoke-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const inviteId = btn.dataset.id;
            await revokeInvite(inviteId);
        });
    });
}

// Create new invite
async function createInvite() {
    if (!currentUser || currentUser.role !== 'admin') return;
    
    const maxUses = parseInt(inviteMaxUses?.value || '1');
    const expiresIn = parseInt(inviteExpiresIn?.value || '24');
    
    try {
        const response = await fetch('/api/admin/invites', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({
                max_uses: maxUses,
                expires_in_hours: expiresIn
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Не удалось создать пригласительный код');
        }
        
        const invite = await response.json();
        adminNotify('Пригласительный код создан!', 'success');
        
        // Copy to clipboard
        navigator.clipboard.writeText(invite.code);
        adminNotify('Код скопирован в буфер обмена!', 'success');
        
        // Reload invites list and stats
        await loadInvites();
        await loadAdminStats();
        
    } catch (err) {
        console.error('Error creating invite:', err);
        adminNotify(err.message || 'Ошибка при создании кода', 'error');
    }
}

// Revoke invite
async function revokeInvite(inviteId) {
    if (!currentUser || currentUser.role !== 'admin') return;
    
    try {
        const response = await fetch(`/api/admin/invites/${inviteId}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Не удалось отозвать пригласительный код');
        }
        
        adminNotify('Пригласительный код отозван', 'success');
        
        // Reload invites list and stats
        await loadInvites();
        await loadAdminStats();
        
    } catch (err) {
        console.error('Error revoking invite:', err);
        adminNotify(err.message || 'Ошибка при отзыве кода', 'error');
    }
}

// Load admin data when admin tab is opened
function handleAdminTabOpen() {
    if (currentUser && currentUser.role === 'admin') {
        loadAdminRooms();
        loadInvites();
    }
}

// Simple notification function
function adminNotify(message, type = 'info') {
    // Create toast notification
    const existing = document.querySelector('.admin-toast');
    if (existing) existing.remove();
    
    const toast = document.createElement('div');
    toast.className = `admin-toast admin-toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}

// Admin room form elements
const adminCreateRoomBtn = document.getElementById('adminCreateRoomBtn');

// Add event listeners for admin panel
if (createInviteBtn) {
    createInviteBtn.addEventListener('click', createInvite);
}

if (adminCreateRoomBtn) {
    adminCreateRoomBtn.addEventListener('click', adminCreateRoom);
}

// Listen for tab changes to load admin data
document.addEventListener('click', (e) => {
    const tabBtn = e.target.closest('.settings-tab-btn');
    if (tabBtn && tabBtn.dataset.tab === 'admin') {
        handleAdminTabOpen();
    }
});
