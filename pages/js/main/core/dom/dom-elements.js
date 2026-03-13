// ==========================================
// DOM ELEMENTS
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

const roomsList = document.getElementById('roomsList');
const roomName = document.getElementById('roomName');
const messagesList = document.getElementById('messagesList');
const messagesContainer = document.getElementById('messagesContainer');
const scrollToBottomBtn = document.getElementById('scrollToBottom');
const scrollToBottomText = document.getElementById('scrollToBottomText');
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
            userProfileAvatar.innerHTML = `<img src="${escapeHtmlAttr(avatarUrl)}" alt="${escapeHtml(user.display_name || user.username)}" class="user-profile-avatar-img">`;
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
        if (avatar.dataset.profileUserId !== String(userId)) {
            avatar.dataset.profileUserId = String(userId);
            avatar.onclick = (e) => {
                e.stopPropagation();
                showUserProfile(userId, e);
            };
        }
        
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
        if (avatar.dataset.profileUserId !== String(userId)) {
            avatar.dataset.profileUserId = String(userId);
            avatar.onclick = (e) => {
                e.stopPropagation();
                showUserProfile(userId, e);
            };
        }
        
        // Also make the whole item clickable
        userItemEl.style.cursor = 'pointer';
        if (userItemEl.dataset.profileUserId !== String(userId)) {
            userItemEl.dataset.profileUserId = String(userId);
            userItemEl.onclick = (e) => {
                showUserProfile(userId, e);
            };
        }
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
