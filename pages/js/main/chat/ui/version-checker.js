// ==========================================
// VERSION CHECKER DAEMON
// Tracks version mismatch between server and client
// ==========================================

(function () {
    'use strict';

    // Configuration
    const CONFIG = {
        CHECK_INTERVAL: 900000,  // 15 minutes between automatic checks
        INITIAL_DELAY: 5000,      // 5 seconds delay before first check
        MAX_RETRIES: 3,          // Max consecutive failures before showing error
        RETRY_DELAY: 5000,       // Delay between retries
        MANUAL_CHECK_DELAY: 60000, // 1 minute between manual checks
        ACCENT_COLOR: '#DB734F', // Key color (brownish-orange)
        ACCENT_HOVER: '#C05E3B', // Hover color (darker variant)
    };

    // State
    let state = {
        isRunning: false,
        intervalId: null,
        retryCount: 0,
        currentClientVersion: null,
        currentServerVersion: null,
        isNotificationVisible: false,
        hasShownMismatch: false,
        lastManualCheck: 0,        // Timestamp of last manual check
        isManualCheck: false,       // Flag for manual check mode
        isCheckInProgress: false,   // Flag to prevent concurrent checks
    };

    // DOM Elements cache
    let dom = {};

    /**
     * Inject custom accent color as CSS variables
     */
    function injectAccentColor() {
        const styleId = 'version-checker-accent-color';
        if (document.getElementById(styleId)) return;

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            .version-notification-container {
                --vg-accent-color: ${CONFIG.ACCENT_COLOR} !important;
                --vg-accent-hover: ${CONFIG.ACCENT_HOVER} !important;
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * Initialize the version checker
     */
    function init() {
        if (state.isRunning) return;

        // Apply custom accent color from config
        injectAccentColor();

        // Get initial client version from runtime config
        const runtimeConfig = window.__BOROFONE_RUNTIME_CONFIG__ || {};
        state.currentClientVersion = runtimeConfig.appVersion || null;

        if (!state.currentClientVersion) {
            console.warn('[VersionChecker] Client version not defined in runtime config');
            return;
        }

        console.log('[VersionChecker] Initialized with client version:', state.currentClientVersion);
        state.isRunning = true;

        // Schedule first check
        setTimeout(() => {
            checkVersion();
        }, CONFIG.INITIAL_DELAY);

        // Schedule periodic checks
        state.intervalId = setInterval(checkVersion, CONFIG.CHECK_INTERVAL);
    }

    /**
     * Check version from server
     */
    async function checkVersion() {
        if (state.isNotificationVisible) {
            console.log('[VersionChecker] Notification visible, skipping check');
            return;
        }

        console.log('[VersionChecker] Starting version check...');
        state.isCheckInProgress = true;

        try {
            const serverVersion = await fetchServerVersion();

            if (!serverVersion) {
                handleVersionError('Server version not available');
                return;
            }

            state.currentServerVersion = serverVersion;
            state.retryCount = 0;

            compareVersions(serverVersion);

        } catch (error) {
            handleVersionError(error.message || 'Unknown error');
        } finally {
            state.isCheckInProgress = false;
        }
    }

    /**
     * Fetch server version from /app-config.js
     */
    async function fetchServerVersion() {
        const apiUrl = window.getApiUrl ? window.getApiUrl() : (window.API_URL || '');
        const url = `${apiUrl}/app-config.js`;

        const response = await fetch(url, {
            method: 'GET',
            cache: 'no-cache',  // Force revalidation with server
            headers: {
                'Accept': 'application/javascript',
                'Pragma': 'no-cache',
                'Cache-Control': 'no-cache',
            },
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const text = await response.text();

        // Extract version from the JS response
        const match = text.match(/appVersion["\s:]+["']([^"']+)["']/);
        if (match && match[1]) {
            return match[1];
        }

        // Try alternative pattern
        const altMatch = text.match(/window\.__BOROFONE_RUNTIME_CONFIG__\s*=\s*\{[^}]*appVersion:\s*["']([^"']+)["']/);
        if (altMatch && altMatch[1]) {
            return altMatch[1];
        }

        throw new Error('Could not parse version from response');
    }

    /**
     * Compare server and client versions
     */
    function compareVersions(serverVersion) {
        if (!state.currentClientVersion || !serverVersion) {
            console.warn('[VersionChecker] Cannot compare: missing version info');
            return;
        }

        const isDifferent = normalizeVersion(serverVersion) !== normalizeVersion(state.currentClientVersion);

        if (isDifferent) {
            console.log('[VersionChecker] Version mismatch detected:', {
                client: state.currentClientVersion,
                server: serverVersion,
            });
            showMismatchNotification(serverVersion);
        } else {
            console.log('[VersionChecker] Versions match:', serverVersion);
        }
    }

    /**
     * Normalize version string for comparison
     */
    function normalizeVersion(version) {
        if (!version) return '';
        // Remove 'v' prefix, trim whitespace
        return version.replace(/^v/i, '').trim().toLowerCase();
    }

    /**
     * Handle version check errors
     */
    function handleVersionError(message) {
        state.retryCount++;
        console.warn('[VersionChecker] Error:', message, 'Retry:', state.retryCount);

        if (state.retryCount >= CONFIG.MAX_RETRIES && !state.isNotificationVisible) {
            showErrorNotification(message);
        }
    }

    /**
     * Create DOM elements for the notification
     */
    function createNotificationDOM() {
        if (dom.container) return dom;

        // Create overlay
        dom.overlay = document.createElement('div');
        dom.overlay.className = 'version-notification-overlay';
        dom.overlay.id = 'versionNotificationOverlay';

        // Create container
        dom.container = document.createElement('div');
        dom.container.className = 'version-notification-container';
        dom.container.setAttribute('role', 'alertdialog');
        dom.container.setAttribute('aria-labelledby', 'versionNotificationTitle');
        dom.container.setAttribute('aria-describedby', 'versionNotificationDesc');

        // Create inner wrapper
        dom.inner = document.createElement('div');
        dom.inner.className = 'version-notification-inner';

        // Build header
        dom.header = document.createElement('div');
        dom.header.className = 'version-notification-header';

        dom.icon = document.createElement('div');
        dom.icon.className = 'version-notification-icon';
        dom.icon.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
        `;

        dom.titleGroup = document.createElement('div');
        dom.titleGroup.className = 'version-notification-title-group';

        dom.title = document.createElement('h3');
        dom.title.className = 'version-notification-title';
        dom.title.id = 'versionNotificationTitle';
        dom.title.textContent = 'Доступна новая версия';

        dom.subtitle = document.createElement('p');
        dom.subtitle.className = 'version-notification-subtitle';
        dom.subtitle.textContent = 'Сайт был обновлен на сервере';

        dom.titleGroup.appendChild(dom.title);
        dom.titleGroup.appendChild(dom.subtitle);
        dom.header.appendChild(dom.icon);
        dom.header.appendChild(dom.titleGroup);

        // Build version info
        dom.info = document.createElement('div');
        dom.info.className = 'version-notification-info';

        dom.infoIcon = document.createElement('div');
        dom.infoIcon.className = 'version-notification-info-icon';
        dom.infoIcon.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="16" x2="12" y2="12"/>
                <line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
        `;

        dom.infoText = document.createElement('div');
        dom.infoText.className = 'version-notification-info-text';
        dom.infoText.id = 'versionNotificationDesc';
        dom.infoText.innerHTML = 'Обнаружено расхождение версий между сервером и вашим браузером';

        dom.versionBadge = document.createElement('span');
        dom.versionBadge.className = 'version-notification-version-badge';

        dom.info.appendChild(dom.infoIcon);
        dom.info.appendChild(dom.infoText);
        dom.info.appendChild(dom.versionBadge);

        // Build description
        dom.description = document.createElement('p');
        dom.description.className = 'version-notification-description';
        dom.description.textContent = 'Чтобы получить последние обновления и исправления, пожалуйста, перезагрузите страницу с очисткой кэша.';

        // Build keyboard shortcut hint
        dom.shortcut = document.createElement('div');
        dom.shortcut.className = 'version-notification-shortcut';
        dom.shortcut.innerHTML = `
            <kbd>Ctrl</kbd>
            <span class="version-notification-shortcut-plus">+</span>
            <kbd>F5</kbd>
            <span class="version-notification-shortcut-text">(Windows/Linux)</span>
        `;

        // Build actions
        dom.actions = document.createElement('div');
        dom.actions.className = 'version-notification-actions';

        dom.reloadBtn = document.createElement('button');
        dom.reloadBtn.className = 'version-notification-btn version-notification-btn-primary';
        dom.reloadBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="23 4 23 10 17 10"/>
                <polyline points="1 20 1 14 7 14"/>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
            Перезагрузить
        `;
        dom.reloadBtn.addEventListener('click', handleReload);

        dom.dismissBtn = document.createElement('button');
        dom.dismissBtn.className = 'version-notification-btn version-notification-btn-secondary';
        dom.dismissBtn.textContent = 'Позже';
        dom.dismissBtn.addEventListener('click', handleDismiss);

        dom.actions.appendChild(dom.reloadBtn);
        dom.actions.appendChild(dom.dismissBtn);

        // Append all elements
        dom.inner.appendChild(dom.header);
        dom.inner.appendChild(dom.info);
        dom.inner.appendChild(dom.description);
        dom.inner.appendChild(dom.shortcut);
        dom.inner.appendChild(dom.actions);
        dom.container.appendChild(dom.inner);
        dom.overlay.appendChild(dom.container);

        return dom;
    }

    /**
     * Show version mismatch notification
     */
    function showMismatchNotification(serverVersion) {
        if (state.isNotificationVisible) return;

        createNotificationDOM();

        // Update version badges
        dom.versionBadge.textContent = `v${serverVersion}`;
        dom.infoText.innerHTML = `Версия на сервере: <strong>${serverVersion}</strong>, у вас: <strong>${state.currentClientVersion}</strong>`;

        // Show notification
        document.body.appendChild(dom.overlay);

        // Trigger animation
        requestAnimationFrame(() => {
            dom.overlay.classList.add('visible');
        });

        state.isNotificationVisible = true;
        state.hasShownMismatch = true;

        // Update indicator if exists
        if (typeof window.updateVersionIndicatorState === 'function') {
            window.updateVersionIndicatorState(true);
        }
    }

    /**
     * Show error notification
     */
    function showErrorNotification(errorMessage) {
        if (state.isNotificationVisible) return;

        createNotificationDOM();

        // Replace content for error state
        dom.inner.innerHTML = `
            <div class="version-notification-error">
                <div class="version-notification-error-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="12" y1="8" x2="12" y2="12"/>
                        <line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                </div>
                <p class="version-notification-error-text">
                    Не удалось проверить версию: ${escapeHtml(errorMessage)}.
                    <br>Пожалуйста, проверьте подключение к интернету.
                </p>
                <button class="version-notification-btn version-notification-btn-secondary" onclick="this.closest('.version-notification-overlay').remove(); window.versionChecker.dismissNotification();">
                    Понятно
                </button>
            </div>
        `;

        // Show notification
        document.body.appendChild(dom.overlay);

        requestAnimationFrame(() => {
            dom.overlay.classList.add('visible');
        });

        state.isNotificationVisible = true;
    }

    /**
     * Handle reload button click
     */
    function handleReload() {
        // Clear all caches
        if ('caches' in window) {
            caches.keys().then((keys) => {
                keys.forEach((key) => caches.delete(key));
            });
        }

        // Clear localStorage except essential data
        const essentialKeys = ['chatTheme', 'authToken'];
        const storage = {};
        essentialKeys.forEach(key => {
            const value = localStorage.getItem(key);
            if (value) storage[key] = value;
        });
        localStorage.clear();
        essentialKeys.forEach(key => {
            if (storage[key]) localStorage.setItem(key, storage[key]);
        });

        // Force reload bypassing cache (Ctrl+F5 equivalent)
        window.location.reload({ forceGet: true });
    }

    /**
     * Handle dismiss button click
     */
    function handleDismiss() {
        hideNotification();
    }

    /**
     * Hide notification
     */
    function hideNotification() {
        if (!dom.overlay) return;

        dom.overlay.classList.remove('visible');

        setTimeout(() => {
            if (dom.overlay && dom.overlay.parentNode) {
                dom.overlay.parentNode.removeChild(dom.overlay);
            }
            state.isNotificationVisible = false;
        }, 400);
    }

    /**
     * Dismiss notification (public method)
     */
    function dismissNotification() {
        state.isNotificationVisible = false;
        state.retryCount = 0;

        // Resume checking after dismiss
        if (state.isRunning && !state.intervalId) {
            state.intervalId = setInterval(checkVersion, CONFIG.CHECK_INTERVAL);
        }
    }

    /**
     * Update version indicator in the UI
     */
    function updateVersionIndicator(isOutdated) {
        if (typeof window.updateVersionIndicatorState === 'function') {
            window.updateVersionIndicatorState(isOutdated);
        }
    }

    /**
     * Escape HTML to prevent XSS
     */
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Stop the version checker
     */
    function stop() {
        if (state.intervalId) {
            clearInterval(state.intervalId);
            state.intervalId = null;
        }
        state.isRunning = false;
    }

    /**
     * Get current state
     */
    function getState() {
        const now = Date.now();
        const timeSinceLastCheck = now - state.lastManualCheck;
        const canManualCheck = timeSinceLastCheck >= CONFIG.MANUAL_CHECK_DELAY;
        const cooldownRemaining = canManualCheck ? 0 : Math.ceil((CONFIG.MANUAL_CHECK_DELAY - timeSinceLastCheck) / 1000);

        return {
            isRunning: state.isRunning,
            clientVersion: state.currentClientVersion,
            serverVersion: state.currentServerVersion,
            hasShownMismatch: state.hasShownMismatch,
            isNotificationVisible: state.isNotificationVisible,
            canManualCheck: canManualCheck,
            cooldownRemaining: cooldownRemaining,
        };
    }

    /**
     * Manually trigger version check (with rate limiting)
     */
    function triggerCheck() {
        if (!state.isRunning) return;

        const now = Date.now();
        const timeSinceLastCheck = now - state.lastManualCheck;

        if (timeSinceLastCheck < CONFIG.MANUAL_CHECK_DELAY) {
            const remainingSeconds = Math.ceil((CONFIG.MANUAL_CHECK_DELAY - timeSinceLastCheck) / 1000);
            console.log(`[VersionChecker] Manual check rate limited. Please wait ${remainingSeconds} seconds.`);
            return { success: false, message: `Подождите ${remainingSeconds} секунд перед следующей проверкой` };
        }

        state.lastManualCheck = now;
        state.isManualCheck = true;

        checkVersion().then(() => {
            state.isManualCheck = false;
        }).catch(() => {
            state.isManualCheck = false;
        });

        return { success: true, message: 'Проверка версии...' };
    }

    /**
     * Check version without rate limiting (for WebSocket events)
     */
    function checkVersionNow() {
        if (!state.isRunning) return;
        checkVersion();
    }

    // Expose public API
    window.versionChecker = {
        init,
        stop,
        getState,
        triggerCheck,
        checkVersionNow,
        dismissNotification,
    };

    // Auto-initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        // Small delay to ensure other scripts have loaded
        setTimeout(init, 100);
    }

    // Initialize button event listener when DOM is ready
    function initButtonListener() {
        const checkBtn = document.getElementById('checkVersionBtn');
        if (checkBtn) {
            checkBtn.addEventListener('click', handleCheckButtonClick);
        }
    }

    function handleCheckButtonClick() {
        const checkBtn = document.getElementById('checkVersionBtn');
        if (!checkBtn) return;

        const state = getState();

        if (!state.canManualCheck) {
            // Show cooldown message
            checkBtn.textContent = `Подождите ${state.cooldownRemaining}с...`;
            checkBtn.disabled = true;

            // Re-enable after cooldown
            setTimeout(() => {
                if (checkBtn) {
                    checkBtn.innerHTML = `
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                        Проверить обновления
                    `;
                    checkBtn.disabled = false;
                }
            }, state.cooldownRemaining * 1000);
            return;
        }

        // Show checking state
        checkBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spinning">
                <line x1="12" y1="2" x2="12" y2="6"></line>
                <line x1="12" y1="18" x2="12" y2="22"></line>
                <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
                <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
                <line x1="2" y1="12" x2="6" y2="12"></line>
                <line x1="18" y1="12" x2="22" y2="12"></line>
                <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
                <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
            </svg>
            Проверка...
        `;
        checkBtn.disabled = true;

        const result = triggerCheck();

        // Reset button after a delay
        setTimeout(() => {
            if (checkBtn) {
                checkBtn.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="7 10 12 15 17 10"/>
                        <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    Проверить обновления
                `;
                checkBtn.disabled = false;
            }
        }, 3000);
    }

    // Set up button listener
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initButtonListener);
    } else {
        initButtonListener();
    }

})();
