// ==========================================
// VERSION DISPLAY
// ==========================================

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Get version info for display in settings
 */
function getVersionInfo() {
    const runtimeConfig = window.__BOROFONE_RUNTIME_CONFIG__ || {};
    return runtimeConfig.appVersion || 'unknown';
}

/**
 * Create or update the version display in settings modal
 */
function updateVersionDisplayInSettings() {
    const versionInfoEl = document.getElementById('settingsVersionInfo');
    if (!versionInfoEl) return;

    const runtimeConfig = window.__BOROFONE_RUNTIME_CONFIG__ || {};
    const appVersion = runtimeConfig.appVersion || 'unknown';
    versionInfoEl.textContent = `v${appVersion}`;
}

/**
 * Update version indicator state (called by version-checker)
 * Note: Indicator is now in settings, not header
 */
function updateVersionIndicatorState(isOutdated) {
    // Version indicator is now in settings modal
    // Update version info display in settings if needed
    updateVersionDisplayInSettings();
}

function updateLogsDisplay() {
    const logsList = document.getElementById('logsList');
    const logsVersionEl = document.getElementById('logsVersion');
    if (!logsList) return;
    
    // Get app version from runtime config
    const runtimeConfig = window.__BOROFONE_RUNTIME_CONFIG__ || {};
    const appVersion = runtimeConfig.appVersion || 'unknown';
    
    // Update version badge in header
    if (logsVersionEl) {
        logsVersionEl.textContent = `v${appVersion}`;
    }
    
    let versionHtml = `<div class="logs-version">Версия приложения: <strong>${appVersion}</strong></div>`;
    
    if (connectionStats.logs.length === 0) {
        logsList.innerHTML = versionHtml + '<div class="logs-empty">Пока нет записей</div>';
        return;
    }
    
    let html = versionHtml;
    connectionStats.logs.forEach(log => {
        const time = new Date(log.timestamp);
        const timeStr = time.toLocaleTimeString('ru-RU', { 
            hour: '2-digit', 
            minute: '2-digit', 
            second: '2-digit' 
        });
        
        let iconSvg = '';
        if (log.type === 'connect') {
            iconSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4CAF50" stroke-width="2"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>';
        } else if (log.type === 'disconnect') {
            iconSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f44336" stroke-width="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>';
        } else if (log.type === 'error') {
            iconSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ff9800" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
        } else if (log.type === 'info') {
            iconSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2196F3" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
        }
        
        html += `
            <div class="log-entry">
                <span class="log-icon">${iconSvg}</span>
                <span class="log-time">${timeStr}</span>
                <span class="log-message">${escapeHtml(log.message)}</span>
            </div>
        `;
    });
    
    logsList.innerHTML = html;
}

// Initialize version display when page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        updateLogsDisplay();
        updateVersionDisplayInSettings();
    });
} else {
    updateLogsDisplay();
    updateVersionDisplayInSettings();
}

// Expose functions for version checker to call
window.updateVersionIndicatorState = updateVersionIndicatorState;
window.updateVersionDisplayInSettings = updateVersionDisplayInSettings;
