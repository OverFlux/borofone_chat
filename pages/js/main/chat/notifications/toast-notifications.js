// ==========================================
// MESSAGE TOAST NOTIFICATIONS
// Discord-like pop-up notifications
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
 * Toast notification system for new messages
 * Shows pop-up notifications at bottom-right of screen
 */

const TOAST_CONFIG = {
    maxToasts: 3,
    displayDuration: 4000,
    dismissDelay: 150,
    position: 'bottom-right'
};

// Store active toast timers
const toastTimers = new Map();

/**
 * Create toast container if not exists
 */
function getToastContainer() {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }
    return container;
}

/**
 * Get avatar URL with fallback
 */
function getAvatarUrl(user) {
    if (!user) return '/images/default-avatar.png';
    // Try different avatar fields
    return user.avatar_url || user.avatar || `/api/avatars/${user.id}` || '/images/default-avatar.png';
}

/**
 * Check if message contains mention of current user
 */
function checkForMention(message, currentUser) {
    if (!message.body || !currentUser) return false;
    
    const username = currentUser.username?.toLowerCase();
    const mentionPattern = new RegExp(`@${username}`, 'i');
    const directMention = mentionPattern.test(message.body);
    
    // Also check for role mentions if available
    // For now, just check direct username mention
    return directMention;
}

/**
 * Format message preview text
 */
function formatPreviewText(body, maxLength = 80) {
    if (!body) return '';
    
    // Strip HTML tags - use a fixed iteration limit to prevent infinite loops
    let text = body;
    let iterations = 0;
    const maxIterations = 10; // Safety limit
    
    while (iterations < maxIterations) {
        const newText = text.replace(/<[^>]*>/g, '');
        if (newText === text) break; // No more changes
        text = newText;
        iterations++;
    }
    
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength).trim() + '...';
}

/**
 * Create a single toast element
 */
function createToastElement(message, roomName, isMention = false) {
    const toast = document.createElement('div');
    toast.className = 'message-toast';
    if (isMention) {
        toast.classList.add('is-mention');
    }
    
    // Store data for click handler
    toast.dataset.roomId = message.room_id;
    toast.dataset.messageId = message.id;
    
    const avatarUrl = getAvatarUrl(message.user);
    const previewText = formatPreviewText(message.body);
    
    toast.innerHTML = `
        <img src="${escapeHtmlAttr(avatarUrl)}" alt="" class="toast-avatar" onerror="this.src='/images/default-avatar.png'">
        <div class="toast-content">
            <div class="toast-header">
                <span class="toast-author">${escapeHtml(message.user?.display_name || message.author || message.user?.username || 'Unknown')}</span>
                ${isMention ? '<span class="toast-mention-badge">mentioned</span>' : ''}
                <span class="toast-room">${escapeHtml(roomName || 'unknown')}</span>
            </div>
            <div class="toast-preview ${isMention ? 'is-mention' : ''}">${escapeHtml(previewText)}</div>
        </div>
        <button class="toast-close" title="Dismiss">×</button>
    `;
    
    // Click handler for navigation
    toast.addEventListener('click', (e) => {
        if (e.target.classList.contains('toast-close')) {
            e.stopPropagation();
            removeToast(toast);
            return;
        }
        
        const roomId = message.room_id;
        // Try different function names for room switching
        const switchFn = typeof selectRoom === 'function' ? selectRoom : 
                         typeof switchToRoom === 'function' ? switchToRoom :
                         typeof openRoom === 'function' ? openRoom : null;
        
        if (roomId && switchFn) {
            switchFn(roomId);
            // Scroll to message if function exists
            if (typeof scrollToMessage === 'function') {
                scrollToMessage(message.id);
            }
        } else {
            console.warn('[Toast] Room switch function not found');
        }
        removeToast(toast);
    });
    
    return toast;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Remove a toast with animation
 */
function removeToast(toast) {
    if (!toast || toast.classList.contains('removing')) return;
    
    // Clear any timer for this toast
    const timerId = toastTimers.get(toast);
    if (timerId) {
        clearTimeout(timerId);
        toastTimers.delete(toast);
    }
    
    // Animate out
    toast.classList.add('removing');
    toast.classList.remove('visible');
    
    setTimeout(() => {
        if (toast.parentNode) {
            toast.parentNode.removeChild(toast);
        }
    }, TOAST_CONFIG.dismissDelay);
}

/**
 * Show a toast notification for a new message
 * @param {Object} message - The message object
 * @param {string} roomName - Name of the room
 * @param {boolean} isMention - Whether this is a mention
 */
function showToast(message, roomName = null, isMention = false) {
    // Don't show toast if DND is enabled
    if (typeof window.notifications?.isDoNotDisturbEnabled === 'function' && 
        window.notifications.isDoNotDisturbEnabled()) {
        return;
    }
    
    // Don't show toast if in current room (like Discord)
    // BUT always show if it's a mention (mentions should notify even in current room)
    if (message.room_id === window.currentRoom?.id && !isMention) {
        return;
    }
    
    const container = getToastContainer();
    const toast = createToastElement(message, roomName, isMention);
    
    // Add to container
    container.appendChild(toast);
    
    // Force reflow for animation
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            toast.classList.add('visible');
        });
    });
    
    // Remove old toasts if exceeding max
    const existingToasts = container.querySelectorAll('.message-toast:not(.removing)');
    if (existingToasts.length > TOAST_CONFIG.maxToasts) {
        const oldest = existingToasts[0];
        removeToast(oldest);
    }
    
    // Auto-dismiss timer
    const timerId = setTimeout(() => {
        removeToast(toast);
    }, TOAST_CONFIG.displayDuration);
    
    toastTimers.set(toast, timerId);
    
    return toast;
}

/**
 * Clear all toast notifications
 */
function clearAllToasts() {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toasts = container.querySelectorAll('.message-toast');
    toasts.forEach(toast => removeToast(toast));
}

/**
 * Get room name from message or cache
 */
function getRoomNameFromMessage(message) {
    // First try to get from message.room (sent from server)
    if (message.room?.title) {
        return message.room.title;
    }
    
    // Try to get from room list in sidebar
    const roomElement = document.querySelector(`[data-room-id="${message.room_id}"]`);
    if (roomElement) {
        const nameElement = roomElement.querySelector('.room-name, .room-item-name, .name');
        if (nameElement) {
            return nameElement.textContent.trim();
        }
        // Try getting name from title attribute
        const title = roomElement.getAttribute('title');
        if (title) {
            return title;
        }
    }
    
    // Try from room data if available
    if (window.roomsData && window.roomsData[message.room_id]) {
        return window.roomsData[message.room_id].name;
    }
    
    // Try from global rooms array
    if (window.rooms && Array.isArray(window.rooms)) {
        const room = window.rooms.find(r => r.id === message.room_id);
        if (room) {
            return room.title || room.name;
        }
    }
    
    return null;
}

/**
 * Handle incoming message for toast notification
 * Called from websocket message handler
 */
function handleMessageForToast(message) {
    const currentUser = window.currentUser;
    
    // Skip if message is from self
    if (message.user?.id === currentUser?.id) {
        return;
    }
    
    // Check for mention
    const isMention = checkForMention(message, currentUser);
    
    // Get room name - first try from message data, then fallback to lookup
    const roomName = getRoomNameFromMessage(message);
    
    // Show toast
    showToast(message, roomName, isMention);
}

// Export functions
window.toastNotifications = {
    show: showToast,
    clearAll: clearAllToasts,
    handleMessage: handleMessageForToast,
    config: TOAST_CONFIG
};
