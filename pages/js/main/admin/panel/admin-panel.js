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
        const response = await fetchWithAuth(`${getApiUrl()}/rooms`);
        
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
        const response = await fetchWithAuth(`${getApiUrl()}/rooms/${roomId}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to delete room');
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
        const response = await fetchWithAuth(`${getApiUrl()}/rooms`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                title: title,
                description: roomDescInput?.value.trim() || ''
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to create room');
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
        const response = await fetchWithAuth(`${getApiUrl()}/api/admin/invites`);
        
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
        const response = await fetchWithAuth(`${getApiUrl()}/api/admin/invites`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                max_uses: maxUses,
                expires_in_hours: expiresIn
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to create invite');
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
        const response = await fetchWithAuth(`${getApiUrl()}/api/admin/invites/${inviteId}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to revoke invite');
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
