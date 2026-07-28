// ==========================================
// STATE
// ==========================================

let currentRoom = null;
let servers = [];
let currentServer = null;
let directConversations = [];
let currentConversation = null;
let ws = null;
let wsConnecting = false;
let wsReconnectTimer = null;
const seenIncomingMessageIds = new Set();
const seenIncomingMessageOrder = [];
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
    const sharedEscapeHtml = window.BorofoneApp?.utils?.escapeHtml;
    if (typeof sharedEscapeHtml === 'function') {
        return sharedEscapeHtml(text);
    }

    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
