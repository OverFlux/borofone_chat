// ==========================================
// SERVERS
// ==========================================

const novaServerList = document.getElementById('novaServerList');
const novaServerName = document.getElementById('novaServerName');
const novaServerOnline = document.getElementById('novaServerOnline');
const novaDiscoverBtn = document.getElementById('novaDiscoverBtn');
const novaDiscoveryModal = document.getElementById('novaDiscoveryModal');
const novaDiscoveryClose = document.getElementById('novaDiscoveryClose');
const novaDiscoveryId = document.getElementById('novaDiscoveryId');
const novaFindServerBtn = document.getElementById('novaFindServerBtn');
const novaFindUserBtn = document.getElementById('novaFindUserBtn');
const novaDiscoveryResult = document.getElementById('novaDiscoveryResult');
const activeServerStorageKey = 'borotalk-active-server';

function renderServers() {
    if (!novaServerList) return;

    novaServerList.innerHTML = servers.map((server) => {
        const initial = escapeHtml((server.name || 'B').trim().charAt(0).toUpperCase() || 'B');
        const active = currentServer?.id === server.id;
        return `
            <button
                class="nova-server-chip${active ? ' active' : ''}"
                type="button"
                data-server-id="${server.id}"
                aria-label="Сервер ${escapeHtml(server.name)}"
                aria-pressed="${active}"
                title="${escapeHtml(server.name)} · ID ${server.id}"
            >${initial}</button>
        `;
    }).join('');

    novaServerName.textContent = currentServer?.name || 'Нет серверов';
}

async function updateCurrentServerMemberCount() {
    if (!novaServerOnline || !currentServer) return;
    try {
        const response = await fetchWithAuth(`${getApiUrl()}/servers/${currentServer.id}/members`);
        if (!response.ok) return;
        const members = await response.json();
        const online = members.filter((member) => member.is_online).length;
        novaServerOnline.innerHTML = `<i></i> ${online || members.length}`;
    } catch (error) {
        console.warn('[Servers] Failed to load members:', error);
    }
}

async function selectServer(serverId, { initial = false } = {}) {
    const nextServer = servers.find((server) => server.id === Number(serverId));
    if (!nextServer || nextServer.id === currentServer?.id && !initial) return;

    const previousServerId = currentServer?.id;
    currentServer = nextServer;
    currentRoom = null;
    currentConversation = null;
    localStorage.setItem(activeServerStorageKey, String(nextServer.id));
    renderServers();

    roomName.textContent = 'Выберите комнату';
    messageInput.disabled = true;
    messageInput.placeholder = 'Выберите комнату...';
    sendBtn.disabled = true;
    if (typeof renderDirectConversations === 'function') {
        renderDirectConversations();
    }

    await Promise.all([loadRooms(), loadVoiceRooms(), updateCurrentServerMemberCount()]);

    if (!initial && previousServerId !== nextServer.id) {
        reconnectWebSocketForServer();
    }
}

async function loadServers() {
    const response = await fetchWithAuth(`${getApiUrl()}/servers`);
    if (!response.ok) {
        throw new Error('Failed to load servers');
    }

    servers = await response.json();
    if (servers.length === 0) {
        currentServer = null;
        renderServers();
        roomsList.innerHTML = '<div class="placeholder-message"><p>Найдите сервер по ID</p></div>';
        voiceRoomsList.innerHTML = '';
        return;
    }

    const storedServerId = Number(localStorage.getItem(activeServerStorageKey));
    const initialServer = servers.find((server) => server.id === storedServerId) || servers[0];
    await selectServer(initialServer.id, { initial: true });
}

function openDiscoveryModal() {
    novaDiscoveryResult.innerHTML = '';
    novaDiscoveryId.value = '';
    novaDiscoveryModal.classList.add('active');
    requestAnimationFrame(() => novaDiscoveryId.focus());
}

function closeDiscoveryModal() {
    novaDiscoveryModal.classList.remove('active');
}

function discoveryError(message) {
    novaDiscoveryResult.innerHTML = `<div class="nova-discovery-error">${escapeHtml(message)}</div>`;
}

function discoveryCard({ initial, title, subtitle, action, actionLabel }) {
    return `
        <div class="nova-discovery-card">
            <span class="nova-discovery-card-avatar">${escapeHtml(initial)}</span>
            <span class="nova-discovery-card-copy">
                <strong>${escapeHtml(title)}</strong>
                <span>${escapeHtml(subtitle)}</span>
            </span>
            <button class="btn-primary" type="button" data-discovery-action="${action}">${escapeHtml(actionLabel)}</button>
        </div>
    `;
}

function getDiscoveryId() {
    const id = Number(novaDiscoveryId.value);
    if (!Number.isInteger(id) || id < 1) {
        discoveryError('Введите корректный числовой ID');
        return null;
    }
    return id;
}

async function findServerById() {
    const id = getDiscoveryId();
    if (!id) return;
    const response = await fetchWithAuth(`${getApiUrl()}/servers/${id}`);
    if (response.status === 404) {
        discoveryError('Сервер не найден');
        return;
    }
    if (!response.ok) {
        discoveryError('Не удалось найти сервер');
        return;
    }
    const server = await response.json();
    novaDiscoveryResult.innerHTML = discoveryCard({
        initial: server.name.charAt(0).toUpperCase(),
        title: server.name,
        subtitle: `Сервер · ID ${server.id}`,
        action: server.is_member ? `open-server:${server.id}` : `join-server:${server.id}`,
        actionLabel: server.is_member ? 'Открыть' : 'Войти',
    });
}

async function findUserById() {
    const id = getDiscoveryId();
    if (!id) return;
    const response = await fetchWithAuth(`${getApiUrl()}/users/${id}`);
    if (response.status === 404) {
        discoveryError('Пользователь не найден');
        return;
    }
    if (!response.ok) {
        discoveryError('Не удалось найти пользователя');
        return;
    }
    const user = await response.json();
    novaDiscoveryResult.innerHTML = discoveryCard({
        initial: user.display_name.charAt(0).toUpperCase(),
        title: user.display_name,
        subtitle: `@${user.username} · ID ${user.id}`,
        action: `message-user:${user.id}`,
        actionLabel: 'Написать',
    });
}

novaDiscoveryResult?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-discovery-action]');
    if (!button) return;
    const [action, rawId] = button.dataset.discoveryAction.split(':');
    const id = Number(rawId);

    if (action === 'join-server') {
        const response = await fetchWithAuth(`${getApiUrl()}/servers/${id}/join`, { method: 'POST' });
        if (!response.ok) {
            discoveryError('Не удалось войти на сервер');
            return;
        }
        await loadServers();
        await selectServer(id);
        closeDiscoveryModal();
        return;
    }

    if (action === 'open-server') {
        if (!servers.some((server) => server.id === id)) {
            await loadServers();
        }
        await selectServer(id);
        closeDiscoveryModal();
        return;
    }

    if (action === 'message-user') {
        const response = await fetchWithAuth(`${getApiUrl()}/direct-conversations/with/${id}`, {
            method: 'POST',
        });
        if (!response.ok) {
            discoveryError('Не удалось открыть диалог');
            return;
        }
        const conversation = await response.json();
        await loadDirectConversations();
        await selectDirectConversation(conversation.id);
        closeDiscoveryModal();
    }
});

novaDiscoverBtn?.addEventListener('click', openDiscoveryModal);
novaDiscoveryClose?.addEventListener('click', closeDiscoveryModal);
novaDiscoveryModal?.addEventListener('click', (event) => {
    if (event.target === novaDiscoveryModal) closeDiscoveryModal();
});
novaFindServerBtn?.addEventListener('click', findServerById);
novaFindUserBtn?.addEventListener('click', findUserById);
novaDiscoveryId?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') findServerById();
});

novaServerList?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-server-id]');
    if (!button) return;
    selectServer(Number(button.dataset.serverId)).catch((error) => {
        console.error('[Servers] Failed to switch server:', error);
    });
});
