// ==========================================
// MODAL
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
        ? `<img src="${escapeHtmlAttr(avatarUrl)}" alt="${escapeHtml(displayName)}" class="avatar-media">`
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
    updateVersionDisplayInSettings();

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
        ? `<img src="${escapeHtmlAttr(avatarUrl)}" alt="${escapeHtml(displayName)}" class="avatar-media">`
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
