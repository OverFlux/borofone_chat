// ==========================================
// VOICE CHAT (MVP)
// ==========================================

// Mute button sound effect
let silenceEmpSound = null;
let silenceEmpSoundError = false;

/**
 * Initialize the mute button sound effect
 * Preloads the audio file for low-latency playback
 */
function initMuteSound() {
    try {
        silenceEmpSound = new Audio('./sounds/silence_emp.mp3');
        silenceEmpSound.preload = 'auto';
        silenceEmpSound.addEventListener('error', (e) => {
            console.warn('[MuteSound] Failed to load audio file:', e);
            silenceEmpSoundError = true;
        });
        // Force load to check for errors early
        silenceEmpSound.load();
    } catch (err) {
        console.warn('[MuteSound] Error initializing audio:', err);
        silenceEmpSoundError = true;
    }
}

/**
 * Play the mute button sound effect
 * Handles errors gracefully and ensures sound plays without delays
 */
function playMuteSound() {
    if (silenceEmpSoundError || !silenceEmpSound) {
        return;
    }
    try {
        silenceEmpSound.currentTime = 0;
        silenceEmpSound.volume = 0.15;
        const playPromise = silenceEmpSound.play();
        if (playPromise !== undefined) {
            playPromise.catch(err => {
                console.warn('[MuteSound] Playback failed:', err);
            });
        }
    } catch (err) {
        console.warn('[MuteSound] Error playing sound:', err);
    }
}

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
                ? `<img src="${escapeHtmlAttr(avatarUrl)}" alt="${safeName}" class="voice-room-user-avatar" data-avatar-fallback="${initial}">`
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
            ? `<img src="${escapeHtmlAttr(avatarUrl)}" alt="${displayName}" class="voice-participant-avatar-img" data-avatar-fallback="${initial}">`
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

function cleanupRemoteAudioResources(userId) {
    const gainEntry = remoteAudioGainNodes.get(userId);
    if (gainEntry) {
        try {
            gainEntry.gainNode.disconnect();
        } catch (_) {
            // ignore
        }
        try {
            gainEntry.audioCtx.close();
        } catch (_) {
            // ignore
        }
        remoteAudioGainNodes.delete(userId);
    }

    const stream = remoteAudioStreams.get(userId);
    if (stream) {
        stream.getTracks().forEach((track) => {
            try {
                track.stop();
            } catch (_) {
                // ignore
            }
        });
        remoteAudioStreams.delete(userId);
    }

    const audio = document.getElementById(`remote-audio-${userId}`);
    if (audio) {
        audio.pause();
        audio.srcObject = null;
        audio.remove();
    }
}

function cleanupRemoteScreenResources(userId) {
    const entry = remoteScreenStreams.get(userId);
    if (entry) {
        entry.stream?.getTracks?.().forEach((track) => {
            try {
                track.stop();
            } catch (_) {
                // ignore
            }
        });
        remoteScreenStreams.delete(userId);
    }

    closeScreenPopout(userId);
    if (activeScreenViewerUserId === userId) {
        closeScreenViewer();
    }
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
        cleanupRemoteScreenResources(userId);
    }
}

function handleParticipantScreenShareState(participant) {
    if (!participant || !participant.user_id) return;
    if (!participant.screen_sharing && participant.user_id !== currentUser?.id) {
        cleanupRemoteScreenResources(participant.user_id);
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

    if (currentVoiceRoomId && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'leave_room', room_id: currentVoiceRoomId }));
    }

    playVoiceEventSound('leave');
    peerConnections.forEach((_, uid) => closePeerConnection(uid));
    remoteAudioStreams.clear();
    remoteScreenStreams.clear();
    localScreenSenders.clear();
    releaseLocalVoiceResources();
    const leftRoomId = currentVoiceRoomId;
    currentVoiceRoomId = null;
    voiceParticipants = [];
    if (voiceOverlay) voiceOverlay.classList.remove('in-room');
    if (leftRoomId) voiceRoomParticipantsByRoom[leftRoomId] = [];
    stopSpeakingDetector();
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
                cleanupRemoteAudioResources(targetUserId);
            };
            return;
        }

        if (event.track.kind === 'video') {
            const stream = new MediaStream([event.track]);
            remoteScreenStreams.set(targetUserId, { stream, track: event.track });
            event.track.onended = () => {
                cleanupRemoteScreenResources(targetUserId);
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

    cleanupRemoteAudioResources(userId);
    cleanupRemoteScreenResources(userId);
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
let speakingAudioContext = null;
let speakingAnalyser = null;
let speakingSourceNode = null;
let lastSpeakingState = false;

function stopSpeakingDetector() {
    if (speakingInterval) {
        clearInterval(speakingInterval);
        speakingInterval = null;
    }
    try {
        speakingSourceNode?.disconnect();
    } catch (_) {
        // ignore
    }
    try {
        speakingAnalyser?.disconnect();
    } catch (_) {
        // ignore
    }
    if (speakingAudioContext) {
        speakingAudioContext.close().catch(() => {});
    }
    speakingAudioContext = null;
    speakingAnalyser = null;
    speakingSourceNode = null;
    lastSpeakingState = false;
}

function releaseLocalVoiceResources() {
    stopSpeakingDetector();

    if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
        localStream = null;
    }

    if (processedOutboundStream) {
        processedOutboundStream.getTracks().forEach((track) => track.stop());
        processedOutboundStream = null;
    }

    if (micGainNode) {
        try {
            micGainNode.disconnect();
        } catch (_) {
            // ignore
        }
        micGainNode = null;
    }

    if (micAudioContext) {
        micAudioContext.close().catch(() => {});
        micAudioContext = null;
    }
}

function startSpeakingDetector() {
    if (speakingInterval || !localStream) return;
    speakingAudioContext = new AudioContext();
    speakingAnalyser = speakingAudioContext.createAnalyser();
    speakingAnalyser.fftSize = 2048;
    speakingAnalyser.smoothingTimeConstant = 0.85;
    speakingSourceNode = speakingAudioContext.createMediaStreamSource(localStream);
    speakingSourceNode.connect(speakingAnalyser);
    const data = new Uint8Array(speakingAnalyser.fftSize);
    let smoothedLevel = 0;
    let speechHangUntil = 0;
    const startThreshold = 7.5;
    const stopThreshold = 4.5;
    const holdMs = 350;
    speakingInterval = setInterval(() => {
        speakingAnalyser.getByteTimeDomainData(data);
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

toggleMicBtn.addEventListener('click', () => {
    playMuteSound();
    setMute(!isMuted);
});
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
            ? `<img src="${escapeHtmlAttr(avatarUrl)}" alt="${safeName}" class="voice-collapsed-avatar-img" data-avatar-fallback="${initial}">`
            : `<span>${initial}</span>`;

        const collapsedClasses = [
            'voice-collapsed-participant',
            participant.speaking ? 'speaking' : '',
            participant.muted ? 'muted' : ''
        ].filter(Boolean).join(' ');
        return `<div class="${collapsedClasses}"><span class="avatar" data-avatar-fallback-target="1">${avatarMarkup}</span><span class="name">${safeName}</span></div>`;
    }).join('');

    attachVoiceAvatarFallbacks(voiceCollapsedParticipants);
}
if (micVolumeSlider) micVolumeSlider.value = String(Math.round(micGainValue * 100));
if (headphoneVolumeSlider) headphoneVolumeSlider.value = String(Math.round(headphonesGainValue * 100));
if (micVolumeValue) micVolumeValue.textContent = `${Math.round(micGainValue * 100)}%`;
if (headphoneVolumeValue) headphoneVolumeValue.textContent = `${Math.round(headphonesGainValue * 100)}%`;
updateScreenShareButtonState();
renderScreenShareGrid();

// Initialize mute button sound effect
initMuteSound();

// ==========================================
// HOTKEYS SETTINGS
// ==========================================

// Default hotkey: Ctrl+M (or Cmd+M on Mac)
const DEFAULT_MUTE_HOTKEY = {
    key: 'm',
    ctrl: true,
    shift: false,
    alt: false,
    meta: false
};

// Hotkey storage key
const MUTE_HOTKEY_STORAGE_KEY = 'voiceMuteHotkey';

// Current hotkey configuration
let muteHotkey = null;

// Recording state
let isRecordingHotkey = false;

/**
 * Load hotkey from localStorage or use default
 */
function loadHotkey() {
    try {
        const stored = localStorage.getItem(MUTE_HOTKEY_STORAGE_KEY);
        if (stored) {
            muteHotkey = JSON.parse(stored);
        } else {
            muteHotkey = { ...DEFAULT_MUTE_HOTKEY };
        }
    } catch (e) {
        muteHotkey = { ...DEFAULT_MUTE_HOTKEY };
    }
    updateHotkeyDisplay();
}

/**
 * Save hotkey to localStorage
 */
function saveHotkey() {
    try {
        localStorage.setItem(MUTE_HOTKEY_STORAGE_KEY, JSON.stringify(muteHotkey));
    } catch (e) {
        console.warn('[Hotkey] Failed to save:', e);
    }
}

/**
 * Format hotkey for display
 */
function formatHotkeyDisplay(hotkey) {
    if (!hotkey) return 'Не назначено';
    
    const parts = [];
    if (hotkey.ctrl) parts.push('Ctrl');
    if (hotkey.shift) parts.push('Shift');
    if (hotkey.alt) parts.push('Alt');
    if (hotkey.meta) parts.push('Meta');
    
    // Format key name
    let keyName = hotkey.key;
    if (keyName === ' ') keyName = 'Space';
    else if (keyName.length === 1) keyName = keyName.toUpperCase();
    else keyName = keyName.charAt(0).toUpperCase() + keyName.slice(1);
    
    parts.push(keyName);
    return parts.join(' + ');
}

/**
 * Update hotkey display in settings
 */
function updateHotkeyDisplay() {
    const displayEl = document.getElementById('hotkeyMuteDisplay');
    if (displayEl) {
        displayEl.textContent = formatHotkeyDisplay(muteHotkey);
    }
}

/**
 * Reset hotkey to default
 */
function resetMuteHotkey() {
    muteHotkey = { ...DEFAULT_MUTE_HOTKEY };
    saveHotkey();
    updateHotkeyDisplay();
    showNotification('Горячая клавиша сброшена на значение по умолчанию (Ctrl+M)', 'success');
}

/**
 * Start recording hotkey
 */
function startHotkeyRecording() {
    isRecordingHotkey = true;
    const btn = document.getElementById('hotkeyMuteBtn');
    if (btn) {
        btn.classList.add('recording');
        btn.querySelector('.hotkey-current-key').textContent = 'Нажмите клавишу...';
    }
    // Add temporary keydown listener
    document.addEventListener('keydown', handleHotkeyRecord, { once: true });
}

/**
 * Handle key recording
 */
function handleHotkeyRecord(e) {
    e.preventDefault();
    e.stopPropagation();
    
    // Ignore certain keys
    if (e.key === 'Escape') {
        cancelHotkeyRecording();
        return;
    }
    
    // Build hotkey object
    const newHotkey = {
        key: e.key.toLowerCase(),
        ctrl: e.ctrlKey || e.metaKey,
        shift: e.shiftKey,
        alt: e.altKey,
        meta: e.metaKey
    };
    
    // Must have at least one modifier or a non-modifier key
    if (!newHotkey.key || newHotkey.key === 'control' || newHotkey.key === 'shift' || newHotkey.key === 'alt' || newHotkey.key === 'meta') {
        cancelHotkeyRecording();
        return;
    }
    
    muteHotkey = newHotkey;
    saveHotkey();
    
    isRecordingHotkey = false;
    const btn = document.getElementById('hotkeyMuteBtn');
    if (btn) {
        btn.classList.remove('recording');
    }
    
    updateHotkeyDisplay();
    showNotification(`Горячая клавиша установлена: ${formatHotkeyDisplay(muteHotkey)}`, 'success');
}

/**
 * Cancel hotkey recording
 */
function cancelHotkeyRecording() {
    isRecordingHotkey = false;
    const btn = document.getElementById('hotkeyMuteBtn');
    if (btn) {
        btn.classList.remove('recording');
    }
    updateHotkeyDisplay();
}

/**
 * Check if event matches current hotkey
 */
function isHotkeyMatch(e) {
    if (!muteHotkey) return false;
    
    const keyMatch = e.key.toLowerCase() === muteHotkey.key;
    const ctrlMatch = (e.ctrlKey || e.metaKey) === muteHotkey.ctrl;
    const shiftMatch = e.shiftKey === muteHotkey.shift;
    const altMatch = e.altKey === muteHotkey.alt;
    
    return keyMatch && ctrlMatch && shiftMatch && altMatch;
}

/**
 * Global keyboard handler for hotkeys
 */
function handleGlobalKeydown(e) {
    // Don't trigger if recording
    if (isRecordingHotkey) return;
    
    // Don't trigger in input fields
    const tagName = e.target.tagName;
    if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
        // Allow if it's our settings hotkey button focused
        if (document.activeElement === document.getElementById('hotkeyMuteBtn')) {
            // Let the recording handler deal with it
        } else {
            return;
        }
    }
    
    // Check mute hotkey
    if (isHotkeyMatch(e)) {
        e.preventDefault();
        e.stopPropagation();
        
        // Only work if in a voice room
        if (currentVoiceRoomId) {
            // Play the same sound as button click
            playMuteSound();
            // Toggle mute
            setMute(!isMuted);
        }
    }
}

// Initialize hotkey system
loadHotkey();

// Add event listeners for hotkey settings UI
const hotkeyMuteBtn = document.getElementById('hotkeyMuteBtn');
const hotkeyMuteReset = document.getElementById('hotkeyMuteReset');

if (hotkeyMuteBtn) {
    hotkeyMuteBtn.addEventListener('click', () => {
        if (!isRecordingHotkey) {
            startHotkeyRecording();
        }
    });
}

if (hotkeyMuteReset) {
    hotkeyMuteReset.addEventListener('click', (e) => {
        e.stopPropagation();
        resetMuteHotkey();
    });
}

// Add global keyboard listener
document.addEventListener('keydown', handleGlobalKeydown, true); // Use capture phase for background handling
