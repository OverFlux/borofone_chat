// ==========================================
// PRESENCE (онлайн пользователи)
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

let presenceInterval = null;
let currentSearch = '';
let currentPage = 1;
const usersPerPage = 30;
let totalUsers = 0;
let globalOnlineCount = 0;

function setGlobalOnlineCount(count) {
    const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    globalOnlineCount = safeCount;

    const usersCountEl = document.getElementById('usersCount');
    if (usersCountEl) {
        usersCountEl.textContent = String(globalOnlineCount);
    }

    const mobileCountEl = document.getElementById('mobileUsersCount');
    if (mobileCountEl) {
        mobileCountEl.textContent = String(globalOnlineCount);
        mobileCountEl.style.display = globalOnlineCount > 0 ? 'inline-flex' : 'none';
    }
}

window.setGlobalOnlineCount = setGlobalOnlineCount;

/**
 * Загрузить список всех пользователей с разделением на онлайн/оффлайн.
 */
async function loadAllUsers() {
    if (!currentRoom) {
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
    const userRole = user.role || null;
    const adminCrownHtml = getAdminCrownHtml(userRole);

    const avatarHtml = avatarUrl
        ? `<img src="${escapeHtmlAttr(avatarUrl)}" alt="${escapeHtml(displayName)}" class="avatar-media">`
        : `<span>${initial}</span>`;

    const statusClass = user.is_online ? 'online' : 'offline';
    const itemClass = user.is_online ? 'user-item' : 'user-item offline';
    const lastSeenText = user.is_online ? '' : (user.last_seen_formatted || '');

    return `
        <div class="${itemClass}" data-user-id="${user.id}">
            <div class="user-avatar-wrapper">${adminCrownHtml}<div class="user-avatar">${avatarHtml}</div></div>
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
                ? `<img src="${escapeHtmlAttr(avatarUrl)}" alt="${escapeHtml(displayName)}" class="avatar-media">`
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
