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
                } else if (data.type === 'message_edited') {
                    console.log('[WS] Received message_edited event:', data);
                    // Only update if message is in current room or we can't determine the room
                    if (!data.room_id || !currentRoom || data.room_id === currentRoom.id) {
                        if (typeof updateMessageContent === 'function') {
                            try {
                                updateMessageContent(data.message_id, data.body, data.edited_at);
                            } catch (err) {
                                console.error('[WS] Error updating message content:', err);
                            }
                        } else {
                            console.warn('[WS] updateMessageContent function not found');
                        }
                    } else {
                        console.log('[WS] Ignoring message_edited for different room:', data.room_id, 'current:', currentRoom?.id);
                    }
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
                } else if (data.type === 'online_count') {
                    if (window.setGlobalOnlineCount) {
                        window.setGlobalOnlineCount(data.total);
                    }
                } else if (data.type === 'error') {
                    console.error('[WS] error:', data.detail);
                    if (data.code === 'unauthorized') redirectToLogin();
                } else if (data.type === 'connected') {
                    console.log('[WS] ready');
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'online_count_request' }));
                    }
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
