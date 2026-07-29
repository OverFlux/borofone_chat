const runtime = window.__BOROFONE_RUNTIME_CONFIG__ || {};
const API_URL = (runtime.apiUrl || window.location.origin).replace(/\/$/, "");
const WS_URL = (runtime.wsUrl || window.location.origin.replace(/^http/, "ws")).replace(/\/$/, "");
const LOGIN_URL = runtime.routes?.login || "/login.html";
const desktop = window.BorotalkDesktopBridge;
const MESSAGE_MAX_LENGTH = 2000;
const AVATAR_PRESETS = {
    "mint-star": "✦",
    "violet-orbit": "◖",
    "peach-wave": "≈",
    "mint-dot": "●",
    "violet-arrow": "↟",
    "peach-b": "B",
};

const state = {
    user: null,
    servers: [],
    server: null,
    rooms: [],
    voiceRooms: [],
    conversations: [],
    members: [],
    chat: null,
    selectedVoice: null,
    messages: [],
    ws: null,
    reconnectTimer: null,
    reconnectGeneration: 0,
    reconnectAttempts: 0,
    heartbeatTimer: null,
    lastPongAt: 0,
    participants: new Map(),
    voicePresence: new Map(),
    currentVoiceRoomId: null,
    localStream: null,
    screenStream: null,
    focusedShareUser: null,
    shareZoom: 1,
    shareFit: "contain",
    sharePanX: 0,
    sharePanY: 0,
    shareViewerDismissed: false,
    peers: new Map(),
    peerRecovery: new Map(),
    pendingIce: new Map(),
    remoteMedia: new Map(),
    participantVolumes: new Map(),
    participantVolumeUserId: null,
    shareVolumes: new Map(),
    shareMutedUsers: new Set(),
    socketRecovering: false,
    voiceRecovering: false,
    muted: false,
    deafened: false,
    sounds: localStorage.getItem("borotalk-sounds") !== "off",
    audioInputId: localStorage.getItem("borotalk-audio-input") || "",
    audioOutputId: localStorage.getItem("borotalk-audio-output") || "",
    customEmojis: [],
    selectedAvatarPreset: null,
    typingTimer: null,
    typingSentAt: 0,
    messageCooldownTimer: null,
    messageCooldownUntil: 0,
    desktopSettings: null,
    desktopCaptureSources: [],
    desktopCaptureTab: "screen",
    desktopCaptureSourceId: "",
};

const els = Object.fromEntries(
    [
        "loadingScreen", "loadingText", "app", "serverList", "discoverButton", "createServerButton",
        "profileButton",
        "channelPanel", "serverName", "onlineCount", "voiceRoomList", "textRoomList", "directList",
        "serverSettingsButton", "createVoiceButton", "createTextButton", "newDirectButton",
        "selfAvatar", "selfName",
        "selfUsername", "settingsButton", "voiceTitle", "connectionDot", "memberCount", "membersButton",
        "stageIntro", "stagePresence", "joinSelectedButton", "participantGrid", "shareStage", "shareViewport",
        "shareVideos", "shareSwitcher", "shareTitle", "shareZoomOutButton", "shareZoomLabel",
        "shareZoomInButton", "shareFitButton", "sharePipButton", "shareFullscreenButton",
        "shareAudioControls", "shareAudioMuteButton", "shareAudioHint", "shareVolumeSlider", "shareVolumeLabel",
        "closeShareFocusButton", "openShareFocusButton", "voiceStatusDot", "voiceStatus", "micButton", "micButtonLabel",
        "deafenButton", "deafenButtonLabel", "shareButton", "shareButtonLabel", "leaveButton",
        "chatPanel", "chatKicker", "chatTitle", "messageList",
        "typingLine", "messageForm", "messageInput", "messageLimit", "sendButton", "emojiButton", "emojiPopover",
        "openChannelsButton", "openChatButton", "closeChatButton", "scrim", "discoverDialog",
        "discoveryId", "findServerButton", "findUserButton", "discoveryResult", "createChannelDialog",
        "createChannelForm", "createChannelTitle", "closeCreateDialog", "channelNameInput",
        "serverDialog", "serverDialogTitle", "serverIdValue", "serverOwnerSettings",
        "serverManageName", "serverJoinableToggle", "saveServerButton", "transferOwnerSection",
        "transferOwnerSelect", "transferOwnerButton", "leaveServerButton", "deleteServerButton",
        "settingsDialog", "profileDisplayName", "profileUsername", "avatarPresetGrid", "saveProfileButton",
        "audioInputSelect", "audioOutputSelect", "audioDeviceHint", "soundToggle",
        "desktopSettingsSection", "desktopVersion", "desktopAutoStartToggle",
        "desktopCloseToTrayToggle", "desktopNotificationsToggle", "desktopPttToggle",
        "desktopPttBinding", "desktopPttBindingButton", "desktopPttStatus", "desktopChangeHostButton",
        "desktopCaptureDialog", "desktopCaptureCloseButton", "desktopCaptureScreenTab",
        "desktopCaptureApplicationTab", "desktopCaptureGrid", "desktopCaptureEmpty",
        "desktopCaptureAudioToggle", "desktopCaptureCancelButton", "desktopCaptureConfirmButton",
        "logoutButton", "membersDialog", "memberList",
        "toastRegion", "participantVolumePopover", "participantVolumeName",
        "participantVolumeSlider", "participantVolumeLabel", "remoteAudio",
    ].map((id) => [id, document.getElementById(id)]),
);

let channelTypeToCreate = "voice";

function loadVolumeMap(storageKey) {
    try {
        const stored = JSON.parse(localStorage.getItem(storageKey) || "{}");
        return new Map(
            Object.entries(stored)
                .filter(([, value]) => Number.isFinite(Number(value)))
                .map(([key, value]) => [String(key), Math.min(1, Math.max(0, Number(value)))]),
        );
    } catch {
        return new Map();
    }
}

function saveVolumeMap(storageKey, volumeMap) {
    localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(volumeMap)));
}

function hydrateIcons(root = document) {
    root.querySelectorAll("span.ui-icon").forEach((placeholder) => {
        const iconClass = [...placeholder.classList].find((name) => name.startsWith("icon-"));
        if (!iconClass) return;
        const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        icon.setAttribute("class", placeholder.className);
        icon.setAttribute("viewBox", "0 0 24 24");
        icon.setAttribute("aria-hidden", "true");
        icon.setAttribute("focusable", "false");
        const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
        use.setAttribute("href", `#ui-${iconClass.slice(5)}`);
        icon.appendChild(use);
        placeholder.replaceWith(icon);
    });
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function safeAvatarUrl(url) {
    return typeof url === "string" && url.startsWith("/uploads/") ? url : null;
}

function avatarPreset(user) {
    const value = user?.avatar_url;
    if (typeof value !== "string" || !value.startsWith("preset:")) return null;
    const preset = value.slice("preset:".length);
    return AVATAR_PRESETS[preset] ? preset : null;
}

function initialFor(value) {
    return String(value || "?").trim().charAt(0).toUpperCase() || "?";
}

function avatarMarkup(user, tone = "") {
    const url = safeAvatarUrl(user?.avatar_url);
    const preset = avatarPreset(user);
    const name = user?.display_name || user?.username || "Пользователь";
    return `<span class="avatar ${tone} ${preset ? `preset-${preset}` : ""}">${
        preset
            ? AVATAR_PRESETS[preset]
            : url
            ? `<img src="${escapeHtml(url)}" alt="">`
            : escapeHtml(initialFor(name))
    }</span>`;
}

function participantTone(userId) {
    const tones = ["avatar-mint", "avatar-purple", "avatar-peach", "avatar-blue"];
    return tones[Math.abs(Number(userId) || 0) % tones.length];
}

function formatTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? ""
        : date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function formatMessageBody(body) {
    const source = String(body || "");
    const pattern = /!\[([^\]]*)\]\(\/emoji\/([A-Za-z0-9_.-]+)\)/g;
    let html = "";
    let cursor = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) {
        html += escapeHtml(source.slice(cursor, match.index));
        const filename = match[2];
        html += `<img class="custom-emoji" src="/emoji/${encodeURIComponent(filename)}" alt="${escapeHtml(match[1] || filename)}" loading="lazy">`;
        cursor = match.index + match[0].length;
    }
    return html + escapeHtml(source.slice(cursor));
}

function toast(message, type = "info", key = message) {
    const toastKey = String(key || message);
    const existing = [...els.toastRegion.children].find((item) => item.dataset.toastKey === toastKey);
    if (existing) {
        existing.textContent = message;
        existing.className = `toast ${type}`;
        clearTimeout(existing.dismissTimer);
        existing.dismissTimer = window.setTimeout(() => existing.remove(), 3600);
        return existing;
    }
    const item = document.createElement("div");
    item.className = `toast ${type}`;
    item.textContent = message;
    item.dataset.toastKey = toastKey;
    els.toastRegion.appendChild(item);
    item.dismissTimer = window.setTimeout(() => item.remove(), 3600);
    return item;
}

function desktopMessageTitle(data, direct = false) {
    const directPeer = direct
        ? state.conversations.find((item) => item.id === data.conversation_id)
        : null;
    const sender = direct
        ? (directPeer?.peer_display_name || directPeer?.peer_username)
        : (data.user?.display_name || data.user?.username);
    return sender ? `${sender} · ${direct ? "личное сообщение" : state.chat?.name || "Borotalk"}` : "Borotalk";
}

function notifyDesktopMessage(data, direct = false) {
    if (!desktop?.isDesktop) return;
    const senderId = direct ? data.sender_id : data.user?.id;
    if (senderId === state.user?.id) return;
    void desktop.notifyMessage({
        title: desktopMessageTitle(data, direct),
        body: data.content || data.body || "Новое сообщение",
    }).catch(() => {});
}

function syncDesktopSettingsUi() {
    const settings = state.desktopSettings;
    if (!settings || !els.desktopSettingsSection) return;
    els.desktopAutoStartToggle.checked = settings.autoStart;
    els.desktopCloseToTrayToggle.checked = settings.closeToTray;
    els.desktopNotificationsToggle.checked = settings.notifications;
    els.desktopPttToggle.checked = settings.pushToTalk.enabled;
    els.desktopPttBinding.hidden = !settings.pushToTalk.enabled;
    els.desktopPttBindingButton.textContent = settings.pushToTalk.input.label;
    els.desktopPttStatus.textContent = settings.pushToTalk.enabled
        ? "Микрофон включён только пока клавиша зажата."
        : "Push-to-talk выключен.";
}

async function patchDesktopSettings(patch) {
    if (!desktop?.isDesktop) return;
    const wasPushToTalkEnabled = Boolean(state.desktopSettings?.pushToTalk.enabled);
    try {
        state.desktopSettings = await desktop.updateSettings(patch);
        syncDesktopSettingsUi();
        if (state.desktopSettings.pushToTalk.enabled) setMuteState(true);
        else if (wasPushToTalkEnabled && patch.pushToTalk?.enabled === false) setMuteState(false);
    } catch (error) {
        toast(error.message || "Не удалось сохранить настройку Desktop", "error");
        syncDesktopSettingsUi();
    }
}

function capturePushToTalkBinding() {
    const allowedKey = /^(Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-2])|Space|Tab|CapsLock|Backquote|Shift(?:Left|Right)|Control(?:Left|Right)|Alt(?:Left|Right))$/;
    els.desktopPttBindingButton.textContent = "Нажмите…";
    els.desktopPttStatus.textContent = "Нажмите одну клавишу или боковую кнопку мыши.";

    const cleanup = () => {
        window.removeEventListener("keydown", onKeyDown, true);
        window.removeEventListener("mousedown", onMouseDown, true);
    };
    const save = (input) => {
        cleanup();
        void patchDesktopSettings({
            pushToTalk: {
                enabled: true,
                input,
            },
        });
    };
    const onKeyDown = (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.code === "Escape") {
            cleanup();
            syncDesktopSettingsUi();
            return;
        }
        if (!allowedKey.test(event.code)) {
            els.desktopPttStatus.textContent = "Эта клавиша не поддерживается. Выберите букву, цифру, F-клавишу или модификатор.";
            return;
        }
        const label = event.code === "Space" ? "Пробел" : (event.key.length === 1 ? event.key.toUpperCase() : event.key);
        save({ type: "keyboard", code: event.code, label });
    };
    const onMouseDown = (event) => {
        if (![3, 4].includes(event.button)) return;
        event.preventDefault();
        event.stopPropagation();
        const number = event.button === 3 ? 4 : 5;
        save({ type: "mouse", code: `Mouse${number}`, label: `Mouse ${number}` });
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("mousedown", onMouseDown, true);
}

function syncDesktopCaptureTabs() {
    for (const button of [els.desktopCaptureScreenTab, els.desktopCaptureApplicationTab]) {
        const active = button.dataset.captureTab === state.desktopCaptureTab;
        button.classList.toggle("active", active);
        button.setAttribute("aria-selected", String(active));
        button.tabIndex = active ? 0 : -1;
    }
}

function renderDesktopCaptureSources() {
    const sources = state.desktopCaptureSources.filter((source) => source.kind === state.desktopCaptureTab);
    els.desktopCaptureGrid.replaceChildren();
    els.desktopCaptureEmpty.hidden = sources.length > 0;
    for (const source of sources) {
        const card = document.createElement("button");
        card.className = "desktop-capture-source";
        card.type = "button";
        card.dataset.captureSourceId = source.id;
        card.setAttribute("aria-pressed", String(source.id === state.desktopCaptureSourceId));
        card.classList.toggle("active", source.id === state.desktopCaptureSourceId);

        const preview = document.createElement("img");
        preview.className = "desktop-capture-preview";
        preview.src = source.thumbnail;
        preview.alt = "";

        const title = document.createElement("span");
        title.className = "desktop-capture-source-name";
        if (source.appIcon) {
            const appIcon = document.createElement("img");
            appIcon.src = source.appIcon;
            appIcon.alt = "";
            title.append(appIcon);
        }
        const name = document.createElement("span");
        name.textContent = source.name;
        name.title = source.name;
        title.append(name);
        card.append(preview, title);
        card.addEventListener("click", () => {
            state.desktopCaptureSourceId = source.id;
            renderDesktopCaptureSources();
            els.desktopCaptureConfirmButton.disabled = false;
        });
        els.desktopCaptureGrid.append(card);
    }
}

function setDesktopCaptureTab(tab) {
    if (!["screen", "application"].includes(tab)) return;
    state.desktopCaptureTab = tab;
    state.desktopCaptureSourceId = "";
    els.desktopCaptureConfirmButton.disabled = true;
    syncDesktopCaptureTabs();
    renderDesktopCaptureSources();
}

function openDesktopCapturePicker(payload) {
    state.desktopCaptureSources = Array.isArray(payload?.sources) ? payload.sources : [];
    state.desktopCaptureSourceId = "";
    state.desktopCaptureTab = state.desktopCaptureSources.some((source) => source.kind === "screen")
        ? "screen"
        : "application";
    els.desktopCaptureAudioToggle.disabled = !payload?.audioRequested;
    els.desktopCaptureAudioToggle.checked = Boolean(payload?.audioRequested);
    els.desktopCaptureConfirmButton.disabled = true;
    syncDesktopCaptureTabs();
    renderDesktopCaptureSources();
    if (!els.desktopCaptureDialog.open) els.desktopCaptureDialog.showModal();
}

async function cancelDesktopCapture() {
    if (!desktop?.isDesktop) return;
    try {
        await desktop.cancelCapture();
    } catch {
        // The capture request may already have ended.
    }
    if (els.desktopCaptureDialog.open) els.desktopCaptureDialog.close();
}

async function confirmDesktopCapture() {
    if (!desktop?.isDesktop || !state.desktopCaptureSourceId) return;
    els.desktopCaptureConfirmButton.disabled = true;
    try {
        await desktop.selectCaptureSource({
            sourceId: state.desktopCaptureSourceId,
            withAudio: els.desktopCaptureAudioToggle.checked,
        });
        if (els.desktopCaptureDialog.open) els.desktopCaptureDialog.close();
    } catch (error) {
        els.desktopCaptureConfirmButton.disabled = false;
        toast(error.message || "Источник больше недоступен. Откройте выбор экрана заново.", "error");
    }
}

async function initDesktopIntegration() {
    if (!desktop?.isDesktop || !els.desktopSettingsSection) return;
    els.desktopSettingsSection.hidden = false;
    try {
        const [settings, version] = await Promise.all([
            desktop.getSettings(),
            desktop.getVersion(),
        ]);
        state.desktopSettings = settings;
        els.desktopVersion.textContent = version;
        syncDesktopSettingsUi();
    } catch (error) {
        toast(error.message || "Desktop-интеграция недоступна", "error");
        return;
    }

    els.desktopAutoStartToggle.addEventListener("change", () => {
        void patchDesktopSettings({ autoStart: els.desktopAutoStartToggle.checked });
    });
    els.desktopCloseToTrayToggle.addEventListener("change", () => {
        void patchDesktopSettings({ closeToTray: els.desktopCloseToTrayToggle.checked });
    });
    els.desktopNotificationsToggle.addEventListener("change", () => {
        void patchDesktopSettings({ notifications: els.desktopNotificationsToggle.checked });
    });
    els.desktopPttToggle.addEventListener("change", () => {
        void patchDesktopSettings({
            pushToTalk: {
                ...state.desktopSettings.pushToTalk,
                enabled: els.desktopPttToggle.checked,
            },
        });
    });
    els.desktopPttBindingButton.addEventListener("click", capturePushToTalkBinding);
    els.desktopChangeHostButton.addEventListener("click", () => {
        void desktop.changeHost();
    });
    desktop.onPushToTalk(({ pressed }) => {
        if (!state.desktopSettings?.pushToTalk.enabled) return;
        setMuteState(!pressed);
    });
    desktop.onPushToTalkError(({ message }) => {
        setMuteState(true);
        toast(message || "Глобальный push-to-talk остановлен", "error", "desktop-ptt-error");
    });
    desktop.onCaptureRequest(openDesktopCapturePicker);
    desktop.onCaptureFinished(() => {
        if (els.desktopCaptureDialog.open) els.desktopCaptureDialog.close();
    });
    for (const tab of [els.desktopCaptureScreenTab, els.desktopCaptureApplicationTab]) {
        tab.addEventListener("click", () => setDesktopCaptureTab(tab.dataset.captureTab));
    }
    els.desktopCaptureCloseButton.addEventListener("click", () => void cancelDesktopCapture());
    els.desktopCaptureCancelButton.addEventListener("click", () => void cancelDesktopCapture());
    els.desktopCaptureConfirmButton.addEventListener("click", () => void confirmDesktopCapture());
    els.desktopCaptureDialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        void cancelDesktopCapture();
    });
}

function errorDetail(payload, fallback) {
    if (typeof payload?.detail === "string") return payload.detail;
    if (Array.isArray(payload?.detail)) return payload.detail[0]?.msg || fallback;
    return fallback;
}

async function request(path, options = {}, retry = true) {
    const response = await fetch(`${API_URL}${path}`, {
        ...options,
        credentials: "include",
        headers: {
            ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
            ...(options.headers || {}),
        },
    });
    if (response.status === 401 && retry && path !== "/auth/refresh") {
        const refresh = await fetch(`${API_URL}/auth/refresh`, {
            method: "POST",
            credentials: "include",
        });
        if (refresh.ok) return request(path, options, false);
        window.location.href = LOGIN_URL;
        throw new Error("Требуется вход");
    }
    return response;
}

async function jsonRequest(path, options = {}) {
    const response = await request(path, options);
    const payload = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
        const error = new Error(errorDetail(payload, `Ошибка ${response.status}`));
        error.status = response.status;
        error.retryAfter = Number(response.headers.get("Retry-After")) || 0;
        throw error;
    }
    return payload;
}

function applyTheme(theme) {
    const normalized = theme === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = normalized;
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
        "content",
        normalized === "light" ? "#eceee9" : "#242424",
    );
    localStorage.setItem("borotalk-theme", normalized);
    document.querySelectorAll("[data-theme-choice]").forEach((button) => {
        button.classList.toggle("active", button.dataset.themeChoice === normalized);
    });
}

function initTheme() {
    const stored = localStorage.getItem("borotalk-theme");
    const system = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    applyTheme(stored || system);
}

function playTone(kind = "join") {
    if (!state.sounds) return;
    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        const context = new AudioContextClass();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.frequency.value = kind === "leave" ? 330 : kind === "message" ? 520 : 440;
        gain.gain.setValueAtTime(0.05, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.12);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.12);
        oscillator.addEventListener("ended", () => context.close());
    } catch {
        // Audio feedback is optional.
    }
}

function microphoneConstraints(deviceId = state.audioInputId) {
    return {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    };
}

function renderDeviceOptions(select, devices, selectedId, defaultLabel, fallbackLabel) {
    const selectionExists = devices.some((device) => device.deviceId === selectedId);
    const normalizedSelection = selectionExists ? selectedId : "";
    select.innerHTML = [
        `<option value="">${defaultLabel}</option>`,
        ...devices.map((device, index) => (
            `<option value="${escapeHtml(device.deviceId)}">${escapeHtml(device.label || `${fallbackLabel} ${index + 1}`)}</option>`
        )),
    ].join("");
    select.value = normalizedSelection;
    return normalizedSelection;
}

async function refreshAudioDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) {
        els.audioInputSelect.disabled = true;
        els.audioOutputSelect.disabled = true;
        els.audioDeviceHint.textContent = "Этот браузер не предоставляет выбор аудиоустройств.";
        return;
    }
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const inputs = devices.filter((device) => device.kind === "audioinput");
        const outputs = devices.filter((device) => device.kind === "audiooutput");
        state.audioInputId = renderDeviceOptions(
            els.audioInputSelect,
            inputs,
            state.audioInputId,
            "Системный микрофон",
            "Микрофон",
        );
        state.audioOutputId = renderDeviceOptions(
            els.audioOutputSelect,
            outputs,
            state.audioOutputId,
            "Системное устройство",
            "Устройство",
        );
        localStorage.setItem("borotalk-audio-input", state.audioInputId);
        localStorage.setItem("borotalk-audio-output", state.audioOutputId);
        const canChooseOutput = "setSinkId" in HTMLMediaElement.prototype;
        els.audioOutputSelect.disabled = !canChooseOutput;
        els.audioDeviceHint.textContent = canChooseOutput
            ? "Выбор хранится только на этом устройстве."
            : "Выбор микрофона доступен; выводом управляет операционная система.";
    } catch {
        els.audioDeviceHint.textContent = "Не удалось получить список аудиоустройств.";
    }
}

async function applyAudioOutput(audio) {
    if (!audio || typeof audio.setSinkId !== "function") return true;
    try {
        await audio.setSinkId(state.audioOutputId);
        return true;
    } catch {
        return false;
    }
}

function remoteAudioElements() {
    return [...state.remoteMedia.values()]
        .flatMap((media) => [media.audio, media.screenAudio])
        .filter(Boolean);
}

function syncRemoteAudioMute() {
    for (const [userId, media] of state.remoteMedia) {
        if (media.audio) media.audio.muted = state.deafened;
        if (media.screenAudio) {
            media.screenAudio.muted = state.deafened || state.shareMutedUsers.has(String(userId));
        }
    }
}

async function changeAudioInput() {
    const previousId = state.audioInputId;
    state.audioInputId = els.audioInputSelect.value;
    localStorage.setItem("borotalk-audio-input", state.audioInputId);
    if (!state.localStream || !state.currentVoiceRoomId) return;
    try {
        const replacement = await navigator.mediaDevices.getUserMedia({
            audio: microphoneConstraints(),
            video: false,
        });
        const nextTrack = replacement.getAudioTracks()[0];
        if (!nextTrack) throw new Error("Audio track is unavailable");
        nextTrack.enabled = !state.muted;
        const previousTrack = state.localStream.getAudioTracks()[0];
        const audioSenders = [...state.peers.values()]
            .flatMap((peer) => peer.getSenders())
            .filter((sender) => sender.track?.id === previousTrack?.id);
        try {
            await Promise.all(audioSenders.map((sender) => sender.replaceTrack(nextTrack)));
        } catch (error) {
            await Promise.allSettled(audioSenders.map((sender) => sender.replaceTrack(previousTrack)));
            replacement.getTracks().forEach((track) => track.stop());
            throw error;
        }
        if (previousTrack) {
            state.localStream.removeTrack(previousTrack);
            previousTrack.stop();
        }
        state.localStream.addTrack(nextTrack);
        await refreshAudioDevices();
        toast("Микрофон переключён");
    } catch {
        state.audioInputId = previousId;
        els.audioInputSelect.value = previousId;
        localStorage.setItem("borotalk-audio-input", previousId);
        toast("Не удалось переключить микрофон", "error");
    }
}

async function changeAudioOutput() {
    const previousId = state.audioOutputId;
    state.audioOutputId = els.audioOutputSelect.value;
    try {
        const results = await Promise.all(remoteAudioElements().map(applyAudioOutput));
        if (results.some((applied) => !applied)) throw new Error("Audio output switch failed");
        localStorage.setItem("borotalk-audio-output", state.audioOutputId);
        toast("Устройство вывода переключено");
    } catch {
        state.audioOutputId = previousId;
        els.audioOutputSelect.value = previousId;
        await Promise.all(remoteAudioElements().map(applyAudioOutput));
        toast("Не удалось переключить устройство вывода", "error");
    }
}

function setAvatarElement(element, user) {
    const url = safeAvatarUrl(user?.avatar_url);
    const preset = avatarPreset(user);
    Object.keys(AVATAR_PRESETS).forEach((name) => element.classList.remove(`preset-${name}`));
    element.replaceChildren();
    if (preset) {
        element.classList.add(`preset-${preset}`);
        element.textContent = AVATAR_PRESETS[preset];
    } else if (url) {
        const image = document.createElement("img");
        image.src = url;
        image.alt = "";
        element.appendChild(image);
    } else {
        element.textContent = initialFor(user?.display_name || user?.username);
    }
}

function renderCurrentUser() {
    els.selfName.textContent = state.user.display_name;
    els.selfUsername.textContent = `@${state.user.username}`;
    setAvatarElement(els.selfAvatar, state.user);
    setAvatarElement(els.profileButton, state.user);
    els.profileButton.title = `${state.user.display_name} · ID ${state.user.id}`;
}

function renderServers() {
    els.serverList.innerHTML = state.servers.map((server) => `
        <button
            class="server-chip"
            type="button"
            data-server-id="${server.id}"
            aria-current="${state.server?.id === server.id}"
            title="${escapeHtml(server.name)} · ID ${server.id}"
        >${escapeHtml(initialFor(server.name))}</button>
    `).join("");
}

function renderVoiceRooms() {
    if (!state.voiceRooms.length) {
        els.voiceRoomList.innerHTML = '<div class="channel-empty">Пока нет каналов</div>';
        return;
    }
    els.voiceRoomList.innerHTML = state.voiceRooms.map((room) => {
        const participants = state.voicePresence.get(room.id) || [];
        const active = state.selectedVoice?.id === room.id;
        return `
            <button class="channel-item ${active ? "active" : ""}" type="button" data-voice-room-id="${room.id}">
                <span class="channel-icon" aria-hidden="true"><span class="ui-icon icon-volume"></span></span>
                <span class="channel-copy">
                    <strong>${escapeHtml(room.name)}</strong>
                    <small>${participants.length ? `${participants.length} в разговоре` : "свободно"}</small>
                </span>
                ${state.currentVoiceRoomId === room.id ? "<span>●</span>" : ""}
            </button>
        `;
    }).join("");
    hydrateIcons(els.voiceRoomList);
}

function renderTextRooms() {
    if (!state.rooms.length) {
        els.textRoomList.innerHTML = '<div class="channel-empty">Пока нет каналов</div>';
        return;
    }
    els.textRoomList.innerHTML = state.rooms.map((room) => `
        <button class="channel-item ${state.chat?.type === "room" && state.chat.id === room.id ? "active" : ""}" type="button" data-text-room-id="${room.id}">
            <span class="channel-icon">#</span>
            <span class="channel-copy"><strong>${escapeHtml(room.title)}</strong><small>текстовый канал</small></span>
        </button>
    `).join("");
}

function renderDirects() {
    if (!state.conversations.length) {
        els.directList.innerHTML = '<div class="channel-empty">Найдите человека по ID</div>';
        return;
    }
    els.directList.innerHTML = state.conversations.map((item) => `
        <button class="channel-item ${state.chat?.type === "direct" && state.chat.id === item.id ? "active" : ""}" type="button" data-direct-id="${item.id}">
            ${avatarMarkup({
                display_name: item.peer_display_name,
                username: item.peer_username,
                avatar_url: item.peer_avatar_url,
            })}
            <span class="channel-copy">
                <strong>${escapeHtml(item.peer_display_name)}</strong>
                <small>@${escapeHtml(item.peer_username)}</small>
            </span>
        </button>
    `).join("");
}

function renderMembers() {
    els.memberCount.textContent = state.members.length;
    els.memberList.innerHTML = state.members.map((member) => `
        <div class="member-row">
            ${avatarMarkup(member, member.role === "owner" ? "avatar-mint" : "")}
            <span><strong>${escapeHtml(member.display_name)}</strong><small>@${escapeHtml(member.username)} · ID ${member.user_id}</small></span>
            <i class="member-status ${member.is_online ? "" : "offline"}" title="${member.is_online ? "В сети" : "Не в сети"}"></i>
        </div>
    `).join("") || '<div class="channel-empty">Нет участников</div>';
}

function updateCreatePermissions() {
    const ownMembership = state.members.find((member) => member.user_id === state.user.id);
    const canManage = state.server?.owner_id === state.user.id
        || ["owner", "admin", "moderator"].includes(ownMembership?.role);
    els.createVoiceButton.hidden = !canManage;
    els.createTextButton.hidden = !canManage;
}

async function loadServers(preferredId = null) {
    state.servers = await jsonRequest("/servers");
    if (!state.servers.length) {
        if (state.currentVoiceRoomId) await leaveVoiceRoom();
        clearTimeout(state.reconnectTimer);
        state.reconnectGeneration += 1;
        if (state.ws) {
            state.ws.onclose = null;
            state.ws.close(1000, "no servers");
            state.ws = null;
        }
        state.server = null;
        state.rooms = [];
        state.voiceRooms = [];
        state.members = [];
        state.selectedVoice = null;
        renderServers();
        renderVoiceRooms();
        renderTextRooms();
        renderMembers();
        els.serverName.textContent = "Нет серверов";
        els.serverSettingsButton.hidden = true;
        updateSelectedVoice();
        setChatEmpty();
        openDiscovery();
        return;
    }
    const storedId = Number(localStorage.getItem("borotalk-active-server"));
    const next = state.servers.find((item) => item.id === Number(preferredId))
        || state.servers.find((item) => item.id === storedId)
        || state.servers[0];
    await selectServer(next.id);
}

async function selectServer(serverId) {
    const next = state.servers.find((server) => server.id === Number(serverId));
    if (!next || state.server === next && state.rooms.length) return;
    if (state.currentVoiceRoomId) await leaveVoiceRoom();

    state.server = next;
    state.chat = null;
    state.messages = [];
    state.selectedVoice = null;
    state.voicePresence.clear();
    localStorage.setItem("borotalk-active-server", String(next.id));
    els.serverName.textContent = next.name;
    els.serverSettingsButton.hidden = false;
    renderServers();
    setChatEmpty();

    const [rooms, voiceRooms, members] = await Promise.all([
        jsonRequest(`/rooms?server_id=${next.id}`),
        jsonRequest(`/voice-rooms?server_id=${next.id}`),
        jsonRequest(`/servers/${next.id}/members`),
    ]);
    state.rooms = rooms;
    state.voiceRooms = voiceRooms;
    state.members = members;
    els.onlineCount.textContent = members.filter((member) => member.is_online).length;
    renderMembers();
    updateCreatePermissions();

    state.selectedVoice = voiceRooms[0] || null;
    updateSelectedVoice();
    renderVoiceRooms();
    renderTextRooms();
    renderDirects();
    connectWebSocket();

    if (rooms[0]) await selectTextRoom(rooms[0].id);
    closeDrawers();
}

function updateSelectedVoice() {
    els.voiceTitle.textContent = state.selectedVoice?.name || "Выберите канал";
    els.joinSelectedButton.disabled = !state.selectedVoice;
    els.joinSelectedButton.textContent = state.currentVoiceRoomId === state.selectedVoice?.id
        ? "Вы уже в канале"
        : "Войти в канал";
    renderStagePresence();
}

function setChatEmpty() {
    els.chatKicker.textContent = "чат";
    els.chatTitle.textContent = "Выберите канал";
    els.messageInput.value = "";
    updateMessageLimit();
    els.messageInput.disabled = true;
    els.sendButton.disabled = true;
    els.messageInput.placeholder = "Выберите чат";
    els.messageList.innerHTML = `
        <div class="empty-state"><span>#</span><strong>Чат рядом с голосом</strong><p>Короткие сообщения без лишнего.</p></div>
    `;
}

async function loadConversations() {
    state.conversations = await jsonRequest("/direct-conversations");
    renderDirects();
}

async function selectTextRoom(roomId) {
    const room = state.rooms.find((item) => item.id === Number(roomId));
    if (!room) return;
    state.chat = { type: "room", id: room.id, title: room.title, room };
    els.chatKicker.textContent = "текстовый канал";
    els.chatTitle.textContent = `# ${room.title}`;
    els.messageInput.disabled = false;
    syncSendButton();
    els.messageInput.placeholder = `Сообщение в #${room.title}`;
    renderTextRooms();
    renderDirects();
    await loadMessages();
    closeDrawers();
}

async function selectDirect(conversationId) {
    const conversation = state.conversations.find((item) => item.id === Number(conversationId));
    if (!conversation) return;
    state.chat = { type: "direct", id: conversation.id, title: conversation.peer_display_name, conversation };
    els.chatKicker.textContent = "личный диалог";
    els.chatTitle.textContent = `@${conversation.peer_username}`;
    els.messageInput.disabled = false;
    syncSendButton();
    els.messageInput.placeholder = `Сообщение для @${conversation.peer_username}`;
    renderTextRooms();
    renderDirects();
    await loadMessages();
    closeDrawers();
}

async function loadMessages() {
    if (!state.chat) return;
    els.messageList.innerHTML = '<div class="empty-state"><strong>Загрузка…</strong></div>';
    const path = state.chat.type === "room"
        ? `/rooms/${state.chat.id}/messages`
        : `/direct-conversations/${state.chat.id}/messages`;
    state.messages = await jsonRequest(path);
    renderMessages();
}

function userForMessage(message) {
    if (state.chat?.type === "room") return message.user || {};
    if (message.sender_id === state.user.id) return state.user;
    const peer = state.chat?.conversation || {};
    return {
        id: peer.peer_id,
        username: peer.peer_username,
        display_name: peer.peer_display_name,
        avatar_url: peer.peer_avatar_url,
    };
}

function renderMessage(message) {
    const user = userForMessage(message);
    const tone = user.id === state.user.id ? "avatar-mint" : "";
    return `
        <article class="message" data-message-id="${message.id}">
            ${avatarMarkup(user, tone)}
            <div class="message-main">
                <div class="message-meta">
                    <strong>${escapeHtml(user.display_name || user.username || "Пользователь")}</strong>
                    <time datetime="${escapeHtml(message.created_at)}">${escapeHtml(formatTime(message.created_at))}</time>
                </div>
                <div class="message-body">${formatMessageBody(message.body)}</div>
            </div>
        </article>
    `;
}

function renderMessages() {
    if (!state.messages.length) {
        const label = state.chat?.type === "direct" ? "Начните личный разговор" : "Здесь пока тихо";
        els.messageList.innerHTML = `<div class="empty-state"><span>${state.chat?.type === "direct" ? "@" : "#"}</span><strong>${label}</strong><p>Первое сообщение может быть коротким.</p></div>`;
        return;
    }
    els.messageList.innerHTML = state.messages.map(renderMessage).join("");
    scrollMessagesToBottom();
}

function appendMessage(message) {
    if (state.messages.some((item) => item.id === message.id)) return;
    state.messages.push(message);
    const empty = els.messageList.querySelector(".empty-state");
    if (empty) empty.remove();
    els.messageList.insertAdjacentHTML("beforeend", renderMessage(message));
    scrollMessagesToBottom();
}

function scrollMessagesToBottom() {
    const apply = () => {
        els.messageList.scrollTop = els.messageList.scrollHeight;
    };
    apply();
    requestAnimationFrame(() => {
        apply();
        requestAnimationFrame(apply);
    });
    els.messageList.querySelectorAll("img").forEach((image) => {
        if (!image.complete) image.addEventListener("load", apply, { once: true });
    });
}

async function sendMessage(event) {
    event.preventDefault();
    if (!state.chat) return;
    if (Date.now() < state.messageCooldownUntil) return;
    const body = els.messageInput.value.trim();
    if (!body) return;
    els.messageInput.value = "";
    resizeComposer();
    updateMessageLimit();
    els.sendButton.disabled = true;
    const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.slice(0, 25);
    try {
        const path = state.chat.type === "room"
            ? `/rooms/${state.chat.id}/messages`
            : `/direct-conversations/${state.chat.id}/messages`;
        const payload = state.chat.type === "room"
            ? { body, nonce, enforce_nonce: true }
            : { body, nonce };
        const message = await jsonRequest(path, { method: "POST", body: JSON.stringify(payload) });
        appendMessage(message);
    } catch (error) {
        els.messageInput.value = body;
        resizeComposer();
        updateMessageLimit();
        const rateLimited = error.status === 429;
        if (rateLimited) startMessageCooldown(error.retryAfter || 3);
        toast(error.message, "error", rateLimited ? "rate-limit" : error.message);
    } finally {
        syncSendButton();
        els.messageInput.focus();
    }
}

function syncSendButton() {
    els.sendButton.disabled = !state.chat || Date.now() < state.messageCooldownUntil;
}

function startMessageCooldown(seconds) {
    clearTimeout(state.messageCooldownTimer);
    const delay = Math.max(1, Number(seconds) || 1) * 1000;
    state.messageCooldownUntil = Date.now() + delay;
    syncSendButton();
    state.messageCooldownTimer = window.setTimeout(() => {
        state.messageCooldownUntil = 0;
        state.messageCooldownTimer = null;
        syncSendButton();
    }, delay);
}

function updateMessageLimit() {
    const length = els.messageInput.value.length;
    const reached = length >= MESSAGE_MAX_LENGTH;
    els.messageLimit.textContent = reached
        ? `Достигнут лимит: ${length} из ${MESSAGE_MAX_LENGTH}`
        : length >= MESSAGE_MAX_LENGTH * 0.9
            ? `${length} из ${MESSAGE_MAX_LENGTH}`
            : "";
    els.messageLimit.classList.toggle("reached", reached);
}

function resizeComposer() {
    els.messageInput.style.height = "auto";
    els.messageInput.style.height = `${Math.min(els.messageInput.scrollHeight, 132)}px`;
}

function sendTyping() {
    if (state.chat?.type !== "room" || !state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    if (now - state.typingSentAt < 1800) return;
    state.typingSentAt = now;
    state.ws.send(JSON.stringify({ type: "typing", room_id: state.chat.id }));
}

async function loadEmojis() {
    const standard = ["🙂", "😂", "❤️", "👍", "🔥", "🎉", "👀", "🤝"];
    let custom = [];
    try {
        const payload = await fetch("/api/emoji", { credentials: "include" }).then((response) => response.json());
        custom = payload.emojis || [];
    } catch {
        custom = [];
    }
    state.customEmojis = custom;
    els.emojiPopover.innerHTML = [
        ...custom.map((filename) => `
            <button class="emoji-option" type="button" data-custom-emoji="${escapeHtml(filename)}" title="${escapeHtml(filename.replace(/\.[^.]+$/, ""))}">
                <img src="/emoji/${encodeURIComponent(filename)}" alt="">
            </button>
        `),
        ...standard.map((emoji) => `<button class="emoji-option" type="button" data-emoji="${emoji}">${emoji}</button>`),
    ].join("");
}

function insertAtCursor(value) {
    const input = els.messageInput;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const available = MESSAGE_MAX_LENGTH - (input.value.length - (end - start));
    const insertion = value.slice(0, Math.max(0, available));
    input.value = `${input.value.slice(0, start)}${insertion}${input.value.slice(end)}`;
    input.setSelectionRange(start + insertion.length, start + insertion.length);
    input.focus();
    resizeComposer();
    updateMessageLimit();
}

function syncVoiceRecoveryState() {
    state.voiceRecovering = Boolean(
        state.currentVoiceRoomId
        && (state.socketRecovering || state.peerRecovery.size > 0),
    );
    updateVoiceUi();
}

function setSocketRecovery(recovering) {
    state.socketRecovering = recovering;
    syncVoiceRecoveryState();
}

function stopHeartbeat() {
    clearInterval(state.heartbeatTimer);
    state.heartbeatTimer = null;
}

function startHeartbeat(socket, generation) {
    stopHeartbeat();
    state.lastPongAt = Date.now();
    state.heartbeatTimer = window.setInterval(() => {
        if (
            generation !== state.reconnectGeneration
            || socket.readyState !== WebSocket.OPEN
        ) {
            stopHeartbeat();
            return;
        }
        if (Date.now() - state.lastPongAt > 45000) {
            socket.close(4001, "heartbeat timeout");
            return;
        }
        socket.send(JSON.stringify({ type: "ping" }));
    }, 15000);
}

function resetPeerConnections() {
    for (const userId of [...state.peers.keys()]) closePeer(userId);
    state.pendingIce.clear();
}

function scheduleSocketReconnect() {
    clearTimeout(state.reconnectTimer);
    if (!state.server || !navigator.onLine) return;
    const delay = Math.min(1000 * (2 ** state.reconnectAttempts), 10000);
    state.reconnectAttempts += 1;
    state.reconnectTimer = window.setTimeout(connectWebSocket, delay);
}

function connectWebSocket() {
    clearTimeout(state.reconnectTimer);
    if (!navigator.onLine) {
        els.connectionDot.dataset.state = "offline";
        els.connectionDot.title = "Нет сети";
        setSocketRecovery(Boolean(state.currentVoiceRoomId));
        return;
    }
    state.reconnectGeneration += 1;
    const generation = state.reconnectGeneration;
    if (state.ws) {
        state.ws.onclose = null;
        state.ws.close(1000, "server changed");
    }
    if (!state.server) return;

    els.connectionDot.dataset.state = "connecting";
    els.connectionDot.title = "Подключение";
    const socket = new WebSocket(`${WS_URL}/ws?server_id=${encodeURIComponent(state.server.id)}`);
    state.ws = socket;

    socket.onopen = () => {
        if (generation !== state.reconnectGeneration) return;
        state.reconnectAttempts = 0;
        els.connectionDot.dataset.state = "online";
        els.connectionDot.title = "Связь установлена";
        startHeartbeat(socket, generation);
    };
    socket.onmessage = (event) => {
        if (generation !== state.reconnectGeneration) return;
        try {
            void handleSocketEvent(JSON.parse(event.data)).catch((error) => {
                console.warn("[Nova] WebSocket event failed", error);
            });
        } catch (error) {
            console.warn("[Nova] Invalid WebSocket event", error);
        }
    };
    socket.onerror = () => {
        els.connectionDot.dataset.state = "offline";
        els.connectionDot.title = "Нет связи";
    };
    socket.onclose = () => {
        if (generation !== state.reconnectGeneration) return;
        stopHeartbeat();
        if (state.ws === socket) state.ws = null;
        resetPeerConnections();
        els.connectionDot.dataset.state = "offline";
        els.connectionDot.title = "Переподключение";
        setSocketRecovery(Boolean(state.currentVoiceRoomId));
        scheduleSocketReconnect();
    };
}

async function handleSocketEvent(data) {
    switch (data.type) {
        case "connected":
            if (state.currentVoiceRoomId) {
                setSocketRecovery(true);
                socketSend({ type: "join_room", room_id: state.currentVoiceRoomId });
            } else {
                setSocketRecovery(false);
            }
            break;
        case "pong":
            state.lastPongAt = Date.now();
            break;
        case "message":
            notifyDesktopMessage(data);
            if (state.chat?.type === "room" && data.room_id === state.chat.id) appendMessage(data);
            else if (data.user?.id !== state.user.id) playTone("message");
            break;
        case "direct_message":
            notifyDesktopMessage(data, true);
            await loadConversations();
            if (state.chat?.type === "direct" && data.conversation_id === state.chat.id) appendMessage(data);
            else if (data.sender_id !== state.user.id) playTone("message");
            break;
        case "typing":
            if (data.user_id !== state.user.id && state.chat?.type === "room" && data.room_id === state.chat.id) {
                els.typingLine.textContent = `${data.username} печатает…`;
                clearTimeout(state.typingTimer);
                state.typingTimer = window.setTimeout(() => {
                    els.typingLine.textContent = "";
                }, 2200);
            }
            break;
        case "room_joined":
            state.currentVoiceRoomId = data.room_id;
            setSocketRecovery(false);
            replaceParticipants(data.participants || []);
            await ensurePeerConnections();
            if (state.desktopSettings?.pushToTalk.enabled) setMuteState(true);
            updateVoiceUi();
            playTone("join");
            break;
        case "participant_joined":
            if (data.room_id === state.currentVoiceRoomId) {
                const joinedParticipantId = data.participant.user_id;
                state.participants.set(joinedParticipantId, data.participant);
                if (joinedParticipantId !== state.user.id) {
                    await ensurePeer(joinedParticipantId, true);
                }
                renderParticipants();
                playTone("join");
            }
            updatePresence(data.room_id, data.participant, true);
            break;
        case "participant_left":
            if (data.room_id === state.currentVoiceRoomId) {
                state.participants.delete(data.participant.user_id);
                closePeer(data.participant.user_id);
                renderParticipants();
                playTone("leave");
            }
            updatePresence(data.room_id, data.participant, false);
            break;
        case "participant_updated":
        case "screen_share_updated":
            if (data.room_id === state.currentVoiceRoomId) {
                state.participants.set(data.participant.user_id, data.participant);
                renderParticipants();
            }
            updatePresence(data.room_id, data.participant, true);
            break;
        case "speaking": {
            const participant = state.participants.get(data.user_id);
            if (participant) {
                participant.speaking = data.speaking;
                renderParticipants();
            }
            break;
        }
        case "voice_room_presence":
            state.voicePresence.set(data.room_id, data.participants || []);
            if (data.room_id === state.currentVoiceRoomId) replaceParticipants(data.participants || []);
            renderVoiceRooms();
            renderStagePresence();
            break;
        case "rtc_offer":
            await handleOffer(data);
            break;
        case "rtc_answer":
            await handleAnswer(data);
            break;
        case "rtc_ice":
            await handleIce(data);
            break;
        case "online_count":
            els.onlineCount.textContent = data.total;
            break;
        case "error":
            if (data.code === "rate_limited") startMessageCooldown(data.retry_after || 3);
            toast(
                data.detail || data.code || "Ошибка соединения",
                "error",
                data.code === "rate_limited" ? "rate-limit" : data.code,
            );
            break;
        default:
            break;
    }
}

function socketSend(payload) {
    if (state.ws?.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify(payload));
        return true;
    }
    toast("Связь ещё устанавливается", "error");
    return false;
}

function updatePresence(roomId, participant, add) {
    const current = [...(state.voicePresence.get(roomId) || [])];
    const index = current.findIndex((item) => item.user_id === participant.user_id);
    if (add && index >= 0) current[index] = participant;
    if (add && index < 0) current.push(participant);
    if (!add && index >= 0) current.splice(index, 1);
    state.voicePresence.set(roomId, current);
    renderVoiceRooms();
    renderStagePresence();
}

function replaceParticipants(participants) {
    state.participants = new Map(participants.map((participant) => [participant.user_id, participant]));
    state.voicePresence.set(state.currentVoiceRoomId, participants);
    renderParticipants();
    renderVoiceRooms();
    renderStagePresence();
}

function participantStatusMarkup(participant) {
    if (participant.deafened) {
        return '<span class="participant-state deafened" aria-label="Звук выключен"><span class="ui-icon icon-headphones"></span></span>';
    }
    if (participant.muted) {
        return '<span class="participant-state muted" aria-label="Микрофон выключен"><span class="ui-icon icon-mic-off"></span></span>';
    }
    if (participant.speaking) {
        return '<span class="sound-wave" aria-label="Говорит"><i></i><i></i><i></i></span>';
    }
    if (participant.screen_sharing) {
        return '<span class="participant-state" aria-label="Показывает экран"><span class="ui-icon icon-screen"></span></span>';
    }
    return '<span class="participant-state" aria-label="В голосовом канале">●</span>';
}

function participantStatusText(participant) {
    if (participant.deafened) return "Звук выключен";
    if (participant.muted) return "Микрофон выключен";
    if (participant.screen_sharing) return "Показывает экран";
    return "В голосовом канале";
}

function renderStagePresence() {
    if (!els.stagePresence) return;
    const participants = state.selectedVoice
        ? state.voicePresence.get(state.selectedVoice.id) || []
        : [];
    if (state.currentVoiceRoomId !== null || !participants.length) {
        els.stagePresence.hidden = true;
        els.stagePresence.innerHTML = "";
        return;
    }
    const visible = participants.slice(0, 4);
    els.stagePresence.innerHTML = `
        <span class="stage-presence-label">Уже в канале: ${participants.length}</span>
        <div class="stage-presence-people">
            ${visible.map((participant) => `
                <div class="stage-presence-person" title="${escapeHtml(participantStatusText(participant))}">
                    ${avatarMarkup(participant, participantTone(participant.user_id))}
                    <span><strong>${escapeHtml(participant.display_name || participant.username)}</strong><small>${escapeHtml(participantStatusText(participant))}</small></span>
                    ${participant.deafened
                        ? '<span class="preview-state danger"><span class="ui-icon icon-headphones"></span></span>'
                        : participant.muted
                            ? '<span class="preview-state danger"><span class="ui-icon icon-mic-off"></span></span>'
                            : ""}
                </div>
            `).join("")}
            ${participants.length > visible.length ? `<span class="stage-presence-more">+${participants.length - visible.length}</span>` : ""}
        </div>
    `;
    els.stagePresence.hidden = false;
    hydrateIcons(els.stagePresence);
}

function renderParticipants() {
    const participants = [...state.participants.values()];
    els.stageIntro.hidden = participants.length > 0 || state.currentVoiceRoomId !== null;
    els.participantGrid.classList.toggle("single", participants.length === 1);
    els.participantGrid.innerHTML = participants.map((participant) => {
        const canAdjustVolume = participant.user_id !== state.user.id;
        return `
            <article
                class="participant-card ${participant.speaking ? "speaking" : ""} ${participant.muted ? "muted" : ""} ${participant.deafened ? "deafened" : ""}"
                ${canAdjustVolume ? `data-participant-id="${participant.user_id}" title="ПКМ — настроить громкость"` : ""}
            >
                ${avatarMarkup(participant, participantTone(participant.user_id))}
                ${participantStatusMarkup(participant)}
                <strong>${escapeHtml(participant.display_name || participant.username)}</strong>
            </article>
        `;
    }).join("");
    hydrateIcons(els.participantGrid);
}

function participantVolume(userId) {
    return state.participantVolumes.get(String(userId)) ?? 1;
}

function setParticipantVolume(userId, volume) {
    const normalized = Math.min(1, Math.max(0, Number(volume)));
    const key = String(userId);
    state.participantVolumes.set(key, normalized);
    saveVolumeMap("borotalk-participant-volumes", state.participantVolumes);
    const media = state.remoteMedia.get(Number(userId));
    if (media?.audio) media.audio.volume = normalized;
}

function closeParticipantVolumePopover() {
    els.participantVolumePopover.hidden = true;
    state.participantVolumeUserId = null;
}

function openParticipantVolumePopover(userId, clientX, clientY) {
    const participant = state.participants.get(Number(userId));
    if (!participant || participant.user_id === state.user.id) return;
    state.participantVolumeUserId = Number(userId);
    const percent = Math.round(participantVolume(userId) * 100);
    els.participantVolumeName.textContent = participant.display_name || participant.username || `Участник ${userId}`;
    els.participantVolumeSlider.value = String(percent);
    els.participantVolumeLabel.value = `${percent}%`;
    els.participantVolumeLabel.textContent = `${percent}%`;
    els.participantVolumePopover.hidden = false;
    requestAnimationFrame(() => {
        const rect = els.participantVolumePopover.getBoundingClientRect();
        const left = Math.max(12, Math.min(clientX, window.innerWidth - rect.width - 12));
        const top = Math.max(12, Math.min(clientY, window.innerHeight - rect.height - 12));
        els.participantVolumePopover.style.left = `${left}px`;
        els.participantVolumePopover.style.top = `${top}px`;
        els.participantVolumeSlider.focus();
    });
}

function updateVoiceUi() {
    const connected = Boolean(state.currentVoiceRoomId);
    const room = state.voiceRooms.find((item) => item.id === state.currentVoiceRoomId);
    els.voiceStatus.textContent = state.voiceRecovering
        ? "Восстанавливаем связь…"
        : room?.name || "Не подключены";
    els.voiceStatusDot.classList.toggle("active", connected);
    els.voiceStatusDot.classList.toggle("reconnecting", state.voiceRecovering);
    for (const button of [els.micButton, els.deafenButton, els.shareButton, els.leaveButton]) {
        button.disabled = !connected;
    }
    els.micButton.classList.toggle("muted", state.muted);
    els.deafenButton.classList.toggle("muted", state.deafened);
    els.shareButton.classList.toggle("active", Boolean(state.screenStream));
    els.micButtonLabel.textContent = state.muted ? "Включить" : "Микрофон";
    els.deafenButtonLabel.textContent = state.deafened ? "Включить звук" : "Звук";
    els.shareButtonLabel.textContent = state.screenStream ? "Остановить" : "Экран";
    els.micButton.setAttribute("aria-label", state.muted ? "Включить микрофон" : "Выключить микрофон");
    els.deafenButton.setAttribute("aria-label", state.deafened ? "Включить звук" : "Заглушить звук");
    els.shareButton.setAttribute("aria-label", state.screenStream ? "Остановить демонстрацию экрана" : "Начать демонстрацию экрана");
    els.joinSelectedButton.disabled = !state.selectedVoice || connected && state.selectedVoice.id === state.currentVoiceRoomId;
    els.joinSelectedButton.textContent = connected && state.selectedVoice?.id === state.currentVoiceRoomId
        ? "Вы уже в канале"
        : "Войти в канал";
    renderVoiceRooms();
}

async function chooseVoiceRoom(roomId) {
    const room = state.voiceRooms.find((item) => item.id === Number(roomId));
    if (!room) return;
    state.selectedVoice = room;
    updateSelectedVoice();
    renderVoiceRooms();
    closeDrawers();
    if (state.currentVoiceRoomId !== room.id) await joinVoiceRoom(room.id);
}

async function joinVoiceRoom(roomId = state.selectedVoice?.id) {
    if (!roomId) return;
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
        toast("Подождите подключения к серверу", "error");
        return;
    }
    try {
        if (state.currentVoiceRoomId && state.currentVoiceRoomId !== roomId) {
            await leaveVoiceRoom();
        }
        if (!state.localStream) {
            state.localStream = await navigator.mediaDevices.getUserMedia({
                audio: microphoneConstraints(),
                video: false,
            });
            await refreshAudioDevices();
        }
        state.currentVoiceRoomId = roomId;
        state.muted = Boolean(state.desktopSettings?.pushToTalk.enabled);
        state.localStream.getAudioTracks().forEach((track) => {
            track.enabled = !state.muted;
        });
        socketSend({ type: "join_room", room_id: roomId });
        updateVoiceUi();
    } catch (error) {
        state.currentVoiceRoomId = null;
        toast(error.name === "NotAllowedError" ? "Доступ к микрофону не разрешён" : "Не удалось включить микрофон", "error");
        updateVoiceUi();
    }
}

async function leaveVoiceRoom(notify = true) {
    const roomId = state.currentVoiceRoomId;
    if (roomId && notify) socketSend({ type: "leave_room", room_id: roomId });
    await stopScreenShare(false);
    state.localStream?.getTracks().forEach((track) => track.stop());
    state.localStream = null;
    for (const userId of [...state.peers.keys()]) closePeer(userId);
    state.participants.clear();
    state.shareMutedUsers.clear();
    closeParticipantVolumePopover();
    state.currentVoiceRoomId = null;
    state.socketRecovering = false;
    state.peerRecovery.clear();
    state.pendingIce.clear();
    state.voiceRecovering = false;
    state.muted = false;
    state.deafened = false;
    els.participantGrid.innerHTML = "";
    els.stageIntro.hidden = false;
    renderStagePresence();
    updateVoiceUi();
}

function setMuteState(nextMuted) {
    if (!state.localStream || !state.currentVoiceRoomId) return;
    state.muted = Boolean(nextMuted);
    state.localStream.getAudioTracks().forEach((track) => {
        track.enabled = !state.muted;
    });
    socketSend({ type: "set_mute", room_id: state.currentVoiceRoomId, muted: state.muted });
    updateVoiceUi();
}

function toggleMute() {
    if (state.desktopSettings?.pushToTalk.enabled) {
        setMuteState(true);
        toast("Микрофон управляется push-to-talk. Изменить режим можно в настройках.", "info", "desktop-ptt-active");
        return;
    }
    setMuteState(!state.muted);
}

function toggleDeafen() {
    if (!state.currentVoiceRoomId) return;
    state.deafened = !state.deafened;
    syncRemoteAudioMute();
    syncShareAudioControls();
    socketSend({ type: "set_deafen", room_id: state.currentVoiceRoomId, deafened: state.deafened });
    updateVoiceUi();
}

async function toggleScreenShare() {
    if (state.screenStream) {
        await stopScreenShare();
        return;
    }
    if (!state.currentVoiceRoomId || !navigator.mediaDevices?.getDisplayMedia) return;
    try {
        state.screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: { ideal: 30, max: 60 } },
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                suppressLocalAudioPlayback: false,
            },
            systemAudio: "include",
        });
        state.shareViewerDismissed = false;
        const videoTrack = state.screenStream.getVideoTracks()[0];
        if (!videoTrack) throw new Error("Screen video track is unavailable");
        videoTrack.addEventListener("ended", () => stopScreenShare());
        if (!state.screenStream.getAudioTracks().length) {
            toast(
                "Экран открыт без звука. При выборе источника включите «Поделиться системным звуком».",
                "info",
                "screen-share-no-audio",
            );
        }
        renderLocalShare();
        socketSend({ type: "set_screen_share", room_id: state.currentVoiceRoomId, sharing: true });
        for (const [userId, pc] of state.peers) {
            state.screenStream.getTracks().forEach((track) => pc.addTrack(track, state.screenStream));
            await createOffer(userId);
        }
        updateVoiceUi();
    } catch (error) {
        if (error.name !== "NotAllowedError") toast("Не удалось начать демонстрацию", "error");
    }
}

async function stopScreenShare(signal = true) {
    if (!state.screenStream) return;
    const tracks = state.screenStream.getTracks();
    const trackIds = new Set(tracks.map((track) => track.id));
    tracks.forEach((track) => track.stop());
    state.screenStream = null;
    for (const [userId, pc] of state.peers) {
        pc.getSenders().forEach((sender) => {
            if (sender.track && trackIds.has(sender.track.id)) pc.removeTrack(sender);
        });
        if (state.currentVoiceRoomId) await createOffer(userId);
    }
    els.shareVideos.querySelector('[data-share-user="self"]')?.remove();
    if (signal && state.currentVoiceRoomId) {
        socketSend({ type: "set_screen_share", room_id: state.currentVoiceRoomId, sharing: false });
    }
    syncShareStage();
    updateVoiceUi();
}

function renderLocalShare() {
    let video = els.shareVideos.querySelector('[data-share-user="self"]');
    if (!video) {
        video = document.createElement("video");
        video.className = "share-video";
        video.dataset.shareUser = "self";
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;
        els.shareVideos.appendChild(video);
    }
    video.dataset.shareLabel = "Ваш экран";
    video.srcObject = state.screenStream;
    state.focusedShareUser = "self";
    syncShareStage();
}

function participantForShare(userId) {
    if (userId === "self") return state.user;
    return state.participants.get(Number(userId));
}

function shareLabel(video) {
    return video.dataset.shareLabel
        || participantForShare(video.dataset.shareUser)?.display_name
        || participantForShare(video.dataset.shareUser)?.username
        || "Трансляция";
}

function focusedShareMedia() {
    if (!state.focusedShareUser || state.focusedShareUser === "self") return null;
    return state.remoteMedia.get(Number(state.focusedShareUser)) || null;
}

function shareVolume(userId) {
    return state.shareVolumes.get(String(userId)) ?? 1;
}

function syncShareAudioControls() {
    const userId = state.focusedShareUser;
    const isOwnShare = userId === "self";
    const media = focusedShareMedia();
    const audio = media?.screenAudio || null;
    const hasOwnAudio = Boolean(state.screenStream?.getAudioTracks().length);
    const muted = !isOwnShare && Boolean(userId) && state.shareMutedUsers.has(String(userId));
    const volume = isOwnShare ? 1 : shareVolume(userId);
    const enabled = Boolean(userId && !isOwnShare && audio);

    els.shareAudioControls.classList.toggle("unavailable", !enabled);
    els.shareAudioMuteButton.disabled = !enabled;
    els.shareVolumeSlider.disabled = !enabled;
    els.shareAudioMuteButton.classList.toggle("muted", muted);
    els.shareAudioMuteButton.setAttribute("aria-pressed", String(muted));
    els.shareAudioMuteButton.setAttribute(
        "aria-label",
        muted ? "Включить звук трансляции" : "Выключить звук трансляции",
    );
    const use = els.shareAudioMuteButton.querySelector("use");
    if (use) use.setAttribute("href", muted ? "#ui-volume-off" : "#ui-volume");
    els.shareVolumeSlider.value = String(Math.round(volume * 100));
    els.shareVolumeLabel.value = `${Math.round(volume * 100)}%`;
    els.shareVolumeLabel.textContent = `${Math.round(volume * 100)}%`;
    els.shareAudioHint.textContent = isOwnShare
        ? hasOwnAudio ? "Звук передаётся участникам" : "Источник выбран без системного звука"
        : audio ? "Звук трансляции" : "В трансляции нет звука";
}

function resetShareView() {
    state.shareZoom = 1;
    state.sharePanX = 0;
    state.sharePanY = 0;
}

function updateShareTransform() {
    const focused = els.shareVideos.querySelector(".share-video.focused");
    if (!focused) return;
    focused.style.objectFit = state.shareFit;
    focused.style.transform = `translate(${state.sharePanX}px, ${state.sharePanY}px) scale(${state.shareZoom})`;
    els.shareZoomLabel.value = `${Math.round(state.shareZoom * 100)}%`;
    els.shareZoomLabel.textContent = `${Math.round(state.shareZoom * 100)}%`;
    els.shareZoomOutButton.disabled = state.shareZoom <= 0.5;
    els.shareZoomInButton.disabled = state.shareZoom >= 2.5;
    els.shareViewport.classList.toggle("can-pan", state.shareZoom > 1);
    els.shareFitButton.classList.toggle("active", state.shareFit === "cover");
    els.shareFitButton.setAttribute(
        "aria-label",
        state.shareFit === "contain" ? "Заполнить окно" : "Показать целиком",
    );
}

function focusShare(userId) {
    const next = els.shareVideos.querySelector(`[data-share-user="${CSS.escape(String(userId))}"]`);
    if (!next) return;
    if (state.focusedShareUser !== String(userId)) resetShareView();
    state.focusedShareUser = String(userId);
    state.shareViewerDismissed = false;
    syncShareStage();
}

function syncShareStage() {
    const videos = [...els.shareVideos.querySelectorAll("video")];
    if (!videos.length) {
        els.shareStage.hidden = true;
        els.openShareFocusButton.hidden = true;
        state.focusedShareUser = null;
        resetShareView();
        syncShareAudioControls();
        return;
    }

    const focusedExists = videos.some((video) => video.dataset.shareUser === state.focusedShareUser);
    if (!focusedExists) {
        state.focusedShareUser = videos[0].dataset.shareUser;
        resetShareView();
    }
    for (const video of videos) {
        const focused = video.dataset.shareUser === state.focusedShareUser;
        video.classList.toggle("focused", focused);
        video.hidden = !focused;
    }

    const focused = videos.find((video) => video.dataset.shareUser === state.focusedShareUser);
    els.shareTitle.textContent = shareLabel(focused);
    els.shareSwitcher.hidden = videos.length < 2;
    els.shareSwitcher.innerHTML = videos.map((video) => `
        <button
            class="share-choice ${video === focused ? "active" : ""}"
            type="button"
            data-focus-share="${escapeHtml(video.dataset.shareUser)}"
            aria-pressed="${video === focused}"
        >
            <span class="ui-icon icon-screen" aria-hidden="true"></span>
            <span>${escapeHtml(shareLabel(video))}</span>
        </button>
    `).join("");
    hydrateIcons(els.shareSwitcher);
    els.shareStage.hidden = state.shareViewerDismissed;
    els.openShareFocusButton.hidden = !state.shareViewerDismissed;
    els.sharePipButton.disabled = !document.pictureInPictureEnabled || typeof focused?.requestPictureInPicture !== "function";
    syncShareAudioControls();
    updateShareTransform();
}

function changeShareZoom(delta) {
    state.shareZoom = Math.min(2.5, Math.max(0.5, state.shareZoom + delta));
    if (state.shareZoom <= 1) {
        state.sharePanX = 0;
        state.sharePanY = 0;
    }
    updateShareTransform();
}

async function toggleSharePictureInPicture() {
    const focused = els.shareVideos.querySelector(".share-video.focused");
    if (!focused || !document.pictureInPictureEnabled || !focused.requestPictureInPicture) return;
    try {
        if (document.pictureInPictureElement) await document.exitPictureInPicture();
        else await focused.requestPictureInPicture();
    } catch {
        toast("Режим «картинка в картинке» недоступен", "error");
    }
}

async function toggleShareFullscreen() {
    try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await els.shareStage.requestFullscreen();
    } catch {
        toast("Полноэкранный режим недоступен", "error");
    }
}

function makePeer(userId) {
    let pc = state.peers.get(userId);
    if (pc) return pc;
    pc = new RTCPeerConnection({
        iceServers: [{ urls: ["stun:stun.l.google.com:19302"] }],
    });
    state.peers.set(userId, pc);
    state.localStream?.getTracks().forEach((track) => pc.addTrack(track, state.localStream));
    state.screenStream?.getTracks().forEach((track) => pc.addTrack(track, state.screenStream));
    pc.onicecandidate = (event) => {
        if (!event.candidate || !state.currentVoiceRoomId) return;
        socketSend({
            type: "rtc_ice",
            room_id: state.currentVoiceRoomId,
            target_user_id: userId,
            payload: event.candidate.toJSON(),
        });
    };
    pc.ontrack = (event) => attachRemoteMedia(userId, event);
    pc.oniceconnectionstatechange = () => {
        if (["connected", "completed"].includes(pc.iceConnectionState)) {
            clearPeerRecovery(userId);
        } else if (pc.iceConnectionState === "disconnected") {
            schedulePeerRecovery(userId, 2500);
        } else if (pc.iceConnectionState === "failed") {
            schedulePeerRecovery(userId, 400);
        } else if (pc.iceConnectionState === "closed") {
            clearPeerRecovery(userId);
        }
    };
    pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") clearPeerRecovery(userId);
        if (pc.connectionState === "failed") schedulePeerRecovery(userId, 400);
        if (pc.connectionState === "closed") clearPeerRecovery(userId);
    };
    return pc;
}

function clearPeerRecovery(userId) {
    const recovery = state.peerRecovery.get(userId);
    if (recovery?.timer) clearTimeout(recovery.timer);
    state.peerRecovery.delete(userId);
    syncVoiceRecoveryState();
}

function schedulePeerRecovery(userId, delay = 800) {
    if (
        !state.currentVoiceRoomId
        || userId === state.user.id
        || state.user.id > userId
    ) return;
    const recovery = state.peerRecovery.get(userId) || { attempts: 0, timer: null };
    if (recovery.timer || recovery.attempts >= 3) return;
    recovery.timer = window.setTimeout(() => attemptPeerRecovery(userId), delay);
    state.peerRecovery.set(userId, recovery);
    syncVoiceRecoveryState();
}

async function attemptPeerRecovery(userId) {
    const recovery = state.peerRecovery.get(userId);
    if (!recovery) return;
    recovery.timer = null;
    if (
        !state.currentVoiceRoomId
        || state.ws?.readyState !== WebSocket.OPEN
        || !state.participants.has(userId)
    ) {
        clearPeerRecovery(userId);
        return;
    }
    const current = state.peers.get(userId);
    if (current && ["connected", "completed"].includes(current.iceConnectionState)) {
        clearPeerRecovery(userId);
        return;
    }
    recovery.attempts += 1;
    let peer = current;
    if (!peer || recovery.attempts === 3) {
        closePeer(userId, false);
        peer = makePeer(userId);
    }
    if (typeof peer.restartIce === "function") peer.restartIce();
    await createOffer(userId, true);
    if (!state.peerRecovery.has(userId)) return;
    if (recovery.attempts >= 3) {
        window.setTimeout(() => {
            const latest = state.peers.get(userId);
            if (latest && !["connected", "completed"].includes(latest.iceConnectionState)) {
                const participant = state.participants.get(userId);
                clearPeerRecovery(userId);
                toast(`Не удалось восстановить связь с ${participant?.display_name || "участником"}`, "error");
            }
        }, 7000);
        return;
    }
    recovery.timer = window.setTimeout(() => attemptPeerRecovery(userId), 3500 * recovery.attempts);
}

async function ensurePeer(userId, shouldOffer = false) {
    if (userId === state.user.id || !state.currentVoiceRoomId) return;
    makePeer(userId);
    if (shouldOffer) await createOffer(userId);
}

async function ensurePeerConnections() {
    await Promise.all([...state.participants.keys()].map((userId) => ensurePeer(userId)));
}

async function createOffer(userId, iceRestart = false) {
    const pc = makePeer(userId);
    if (pc.signalingState !== "stable") return false;
    try {
        const offer = await pc.createOffer(iceRestart ? { iceRestart: true } : undefined);
        await pc.setLocalDescription(offer);
        return socketSend({
            type: "rtc_offer",
            room_id: state.currentVoiceRoomId,
            target_user_id: userId,
            payload: pc.localDescription.toJSON(),
        });
    } catch (error) {
        console.warn("[Nova] Offer failed", error);
        return false;
    }
}

async function flushPendingIce(userId, pc) {
    const candidates = state.pendingIce.get(userId) || [];
    state.pendingIce.delete(userId);
    for (const candidate of candidates) {
        try {
            await pc.addIceCandidate(candidate);
        } catch (error) {
            console.warn("[Nova] Queued ICE candidate failed", error);
        }
    }
}

async function handleOffer(data) {
    if (data.room_id !== state.currentVoiceRoomId) return;
    const pc = makePeer(data.from_user_id);
    try {
        await pc.setRemoteDescription(data.payload);
        await flushPendingIce(data.from_user_id, pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socketSend({
            type: "rtc_answer",
            room_id: data.room_id,
            target_user_id: data.from_user_id,
            payload: pc.localDescription.toJSON(),
        });
    } catch (error) {
        console.warn("[Nova] Answer failed", error);
    }
}

async function handleAnswer(data) {
    const pc = state.peers.get(data.from_user_id);
    if (!pc || data.room_id !== state.currentVoiceRoomId) return;
    try {
        await pc.setRemoteDescription(data.payload);
        await flushPendingIce(data.from_user_id, pc);
    } catch (error) {
        console.warn("[Nova] Remote answer failed", error);
    }
}

async function handleIce(data) {
    if (!data.payload || data.room_id !== state.currentVoiceRoomId) return;
    const pc = state.peers.get(data.from_user_id) || makePeer(data.from_user_id);
    if (!pc.remoteDescription) {
        const candidates = state.pendingIce.get(data.from_user_id) || [];
        candidates.push(data.payload);
        state.pendingIce.set(data.from_user_id, candidates);
        return;
    }
    try {
        await pc.addIceCandidate(data.payload);
    } catch (error) {
        console.warn("[Nova] ICE candidate failed", error);
    }
}

function attachScreenAudio(media, userId, stream, streamId = stream.id) {
    const track = stream.getAudioTracks()[0];
    if (!track) return;
    const currentTrack = media.screenAudio?.srcObject?.getAudioTracks()[0];
    if (media.screenAudioStreamId === streamId && currentTrack?.id === track.id) {
        syncShareAudioControls();
        return;
    }
    if (!media.screenAudio) {
        media.screenAudio = document.createElement("audio");
        media.screenAudio.autoplay = true;
        media.screenAudio.dataset.remoteScreenUser = String(userId);
        els.remoteAudio.appendChild(media.screenAudio);
        void applyAudioOutput(media.screenAudio);
    }
    media.screenAudioStreamId = streamId;
    media.screenAudio.srcObject = new MediaStream([track]);
    media.screenAudio.volume = shareVolume(userId);
    syncRemoteAudioMute();
    void media.screenAudio.play().catch(() => {});
    syncShareAudioControls();
}

function reconcileRemoteAudio(media, userId) {
    let voiceSource = null;
    let screenSource = null;
    for (const [streamId, stream] of media.audioStreams) {
        const track = stream.getAudioTracks().find((item) => item.readyState !== "ended");
        if (!track) continue;
        const isScreenAudio = streamId === media.screenStreamId || stream.getVideoTracks().length > 0;
        if (isScreenAudio && !screenSource) screenSource = { streamId, stream, track };
        else if (!isScreenAudio && !voiceSource) voiceSource = { streamId, track };
    }

    if (voiceSource) {
        const currentTrack = media.audio.srcObject?.getAudioTracks()[0];
        if (media.audioStreamId !== voiceSource.streamId || currentTrack?.id !== voiceSource.track.id) {
            media.audioStreamId = voiceSource.streamId;
            media.audio.srcObject = new MediaStream([voiceSource.track]);
        }
        media.audio.volume = participantVolume(userId);
        media.audio.muted = state.deafened;
        void media.audio.play().catch(() => {});
    } else {
        media.audio.srcObject = null;
        media.audioStreamId = null;
    }

    if (screenSource) {
        attachScreenAudio(media, userId, screenSource.stream, screenSource.streamId);
    } else {
        media.screenAudio?.remove();
        media.screenAudio = null;
        media.screenAudioStreamId = null;
        syncShareAudioControls();
    }
}

function attachRemoteMedia(userId, event) {
    const stream = event.streams[0] || new MediaStream([event.track]);
    let media = state.remoteMedia.get(userId);
    if (!media) {
        const audio = document.createElement("audio");
        audio.autoplay = true;
        audio.muted = state.deafened;
        audio.volume = participantVolume(userId);
        audio.dataset.remoteUser = String(userId);
        els.remoteAudio.appendChild(audio);
        void applyAudioOutput(audio);
        media = {
            audio,
            audioStreamId: null,
            screenAudio: null,
            screenAudioStreamId: null,
            video: null,
            screenStreamId: null,
            audioStreams: new Map(),
        };
        state.remoteMedia.set(userId, media);
    }
    if (event.track.kind === "audio") {
        media.audioStreams.set(stream.id, stream);
        event.track.addEventListener("ended", () => {
            const storedTrack = media.audioStreams.get(stream.id)?.getAudioTracks()[0];
            if (!storedTrack || storedTrack.id === event.track.id) {
                media.audioStreams.delete(stream.id);
            }
            reconcileRemoteAudio(media, userId);
        }, { once: true });
        reconcileRemoteAudio(media, userId);
    } else if (event.track.kind === "video") {
        let video = media.video;
        if (!video) {
            video = document.createElement("video");
            video.className = "share-video";
            video.dataset.shareUser = String(userId);
            video.autoplay = true;
            video.muted = true;
            video.playsInline = true;
            els.shareVideos.appendChild(video);
            media.video = video;
        }
        media.screenStreamId = stream.id;
        if (stream.getAudioTracks().length) {
            media.audioStreams.set(stream.id, stream);
        }
        reconcileRemoteAudio(media, userId);
        video.dataset.shareLabel = participantForShare(String(userId))?.display_name
            || participantForShare(String(userId))?.username
            || `Участник ${userId}`;
        video.srcObject = stream;
        state.shareViewerDismissed = false;
        if (!state.focusedShareUser || state.focusedShareUser === "self") {
            state.focusedShareUser = String(userId);
        }
        event.track.addEventListener("ended", () => {
            video.remove();
            media.video = null;
            media.screenStreamId = null;
            media.audioStreams.delete(stream.id);
            reconcileRemoteAudio(media, userId);
            syncShareStage();
        }, { once: true });
        syncShareStage();
    }
}

function closePeer(userId, clearRecovery = true) {
    const pc = state.peers.get(userId);
    if (pc) {
        pc.ontrack = null;
        pc.onicecandidate = null;
        pc.oniceconnectionstatechange = null;
        pc.onconnectionstatechange = null;
        pc.close();
        state.peers.delete(userId);
    }
    state.pendingIce.delete(userId);
    if (clearRecovery) clearPeerRecovery(userId);
    const media = state.remoteMedia.get(userId);
    media?.audio?.remove();
    media?.screenAudio?.remove();
    media?.video?.remove();
    state.remoteMedia.delete(userId);
    syncShareStage();
}

function openDiscovery(mode = "server") {
    els.discoveryResult.innerHTML = "";
    els.discoveryId.value = "";
    els.discoverDialog.showModal();
    window.setTimeout(() => els.discoveryId.focus(), 0);
    if (mode === "user") els.findUserButton.dataset.preferred = "true";
}

async function findServer() {
    const id = Number(els.discoveryId.value);
    if (!id) return;
    els.discoveryResult.textContent = "Ищем сервер…";
    try {
        const server = await jsonRequest(`/servers/${id}`);
        els.discoveryResult.innerHTML = `
            <div class="result-card">
                <span class="avatar avatar-mint">${escapeHtml(initialFor(server.name))}</span>
                <span><strong>${escapeHtml(server.name)}</strong><small>Сервер · ID ${server.id}</small></span>
                <button class="primary-button" type="button" data-join-server="${server.id}">${server.is_member ? "Открыть" : "Войти"}</button>
            </div>
        `;
    } catch (error) {
        els.discoveryResult.innerHTML = `<p class="result-error">${escapeHtml(error.message)}</p>`;
    }
}

async function findUser() {
    const id = Number(els.discoveryId.value);
    if (!id) return;
    els.discoveryResult.textContent = "Ищем человека…";
    try {
        const user = await jsonRequest(`/users/${id}`);
        const isSelf = user.id === state.user.id;
        els.discoveryResult.innerHTML = `
            <div class="result-card">
                ${avatarMarkup(user, "avatar-peach")}
                <span><strong>${escapeHtml(user.display_name)}</strong><small>@${escapeHtml(user.username)} · ID ${user.id}</small></span>
                <button class="primary-button" type="button" data-start-direct="${user.id}" ${isSelf ? "disabled" : ""}>${isSelf ? "Это вы" : "Написать"}</button>
            </div>
        `;
    } catch (error) {
        els.discoveryResult.innerHTML = `<p class="result-error">${escapeHtml(error.message)}</p>`;
    }
}

async function joinFoundServer(serverId) {
    try {
        await jsonRequest(`/servers/${serverId}/join`, { method: "POST" });
        els.discoverDialog.close();
        await loadServers(serverId);
        toast("Сервер добавлен");
    } catch (error) {
        toast(error.message, "error");
    }
}

async function startDirect(userId) {
    try {
        const conversation = await jsonRequest(`/direct-conversations/with/${userId}`, { method: "POST" });
        els.discoverDialog.close();
        await loadConversations();
        await selectDirect(conversation.id);
        openDrawer("chat");
    } catch (error) {
        toast(error.message, "error");
    }
}

function isCurrentServerOwner() {
    return Boolean(
        state.server
        && (state.server.owner_id === state.user.id || state.user.role === "admin"),
    );
}

function openServerDialog() {
    if (!state.server) return;
    const canManage = isCurrentServerOwner();
    const eligibleMembers = state.members.filter((member) => member.user_id !== state.user.id);
    els.serverDialogTitle.textContent = state.server.name;
    els.serverIdValue.textContent = state.server.id;
    els.serverManageName.value = state.server.name;
    els.serverJoinableToggle.checked = state.server.is_joinable;
    els.serverOwnerSettings.hidden = !canManage;
    els.deleteServerButton.hidden = !canManage;
    els.leaveServerButton.hidden = canManage;
    els.transferOwnerSection.hidden = !canManage || eligibleMembers.length === 0;
    els.transferOwnerSelect.innerHTML = eligibleMembers.map((member) => `
        <option value="${member.user_id}">${escapeHtml(member.display_name)} · @${escapeHtml(member.username)}</option>
    `).join("");
    els.serverDialog.showModal();
}

async function saveServer() {
    if (!state.server || !isCurrentServerOwner()) return;
    const name = els.serverManageName.value.trim();
    if (!name) {
        toast("Введите название сервера", "error");
        return;
    }
    try {
        const updated = await jsonRequest(`/servers/${state.server.id}`, {
            method: "PATCH",
            body: JSON.stringify({
                name,
                is_joinable: els.serverJoinableToggle.checked,
            }),
        });
        els.serverDialog.close();
        await loadServers(updated.id);
        toast("Сервер сохранён");
    } catch (error) {
        toast(error.message, "error");
    }
}

async function transferServerOwner() {
    if (!state.server || !isCurrentServerOwner()) return;
    const newOwnerId = Number(els.transferOwnerSelect.value);
    const member = state.members.find((item) => item.user_id === newOwnerId);
    if (!member || !window.confirm(`Передать сервер пользователю ${member.display_name}?`)) return;
    try {
        await jsonRequest(`/servers/${state.server.id}/transfer`, {
            method: "POST",
            body: JSON.stringify({ new_owner_id: newOwnerId }),
        });
        els.serverDialog.close();
        await loadServers(state.server.id);
        toast("Владелец сервера изменён");
    } catch (error) {
        toast(error.message, "error");
    }
}

async function leaveCurrentServer() {
    if (!state.server || isCurrentServerOwner()) return;
    if (!window.confirm(`Покинуть сервер «${state.server.name}»?`)) return;
    try {
        await jsonRequest(`/servers/${state.server.id}/leave`, { method: "POST" });
        els.serverDialog.close();
        await loadServers();
        toast("Вы покинули сервер");
    } catch (error) {
        toast(error.message, "error");
    }
}

async function deleteCurrentServer() {
    if (!state.server || !isCurrentServerOwner()) return;
    if (!window.confirm(`Удалить сервер «${state.server.name}» и все его каналы?`)) return;
    try {
        await jsonRequest(`/servers/${state.server.id}`, { method: "DELETE" });
        els.serverDialog.close();
        await loadServers();
        toast("Сервер удалён");
    } catch (error) {
        toast(error.message, "error");
    }
}

function openCreateChannel(type) {
    channelTypeToCreate = type;
    els.createChannelTitle.textContent = type === "server"
        ? "Новый сервер"
        : type === "voice"
            ? "Голосовой канал"
            : "Текстовый канал";
    els.channelNameInput.value = "";
    els.channelNameInput.placeholder = type === "server" ? "Например, Своя компания" : "Например, Кухня";
    els.createChannelDialog.showModal();
    window.setTimeout(() => els.channelNameInput.focus(), 0);
}

async function createChannel(event) {
    event.preventDefault();
    const name = els.channelNameInput.value.trim();
    if (!name || channelTypeToCreate !== "server" && !state.server) return;
    try {
        if (channelTypeToCreate === "server") {
            const server = await jsonRequest("/servers", {
                method: "POST",
                body: JSON.stringify({ name, is_joinable: true }),
            });
            els.createChannelDialog.close();
            await loadServers(server.id);
            toast("Сервер создан");
            return;
        }
        if (channelTypeToCreate === "voice") {
            const room = await jsonRequest("/voice-rooms", {
                method: "POST",
                body: JSON.stringify({ server_id: state.server.id, name }),
            });
            state.voiceRooms.push(room);
            state.selectedVoice = room;
            renderVoiceRooms();
            updateSelectedVoice();
            connectWebSocket();
        } else {
            const room = await jsonRequest("/rooms", {
                method: "POST",
                body: JSON.stringify({ server_id: state.server.id, title: name }),
            });
            state.rooms.push(room);
            renderTextRooms();
            connectWebSocket();
            await selectTextRoom(room.id);
        }
        els.createChannelDialog.close();
    } catch (error) {
        toast(error.message, "error");
    }
}

function openDrawer(which) {
    if (which === "channels") els.channelPanel.classList.add("open");
    if (which === "chat") els.chatPanel.classList.add("open");
    els.scrim.hidden = false;
}

function closeDrawers(except = "") {
    if (except !== "channels") els.channelPanel.classList.remove("open");
    if (except !== "chat") els.chatPanel.classList.remove("open");
    if (!els.channelPanel.classList.contains("open") && !els.chatPanel.classList.contains("open")) {
        els.scrim.hidden = true;
    }
}

function bindEvents() {
    els.serverList.addEventListener("click", (event) => {
        const button = event.target.closest("[data-server-id]");
        if (button) selectServer(Number(button.dataset.serverId)).catch((error) => toast(error.message, "error"));
    });
    els.voiceRoomList.addEventListener("click", (event) => {
        const button = event.target.closest("[data-voice-room-id]");
        if (button) chooseVoiceRoom(Number(button.dataset.voiceRoomId));
    });
    els.textRoomList.addEventListener("click", (event) => {
        const button = event.target.closest("[data-text-room-id]");
        if (button) selectTextRoom(Number(button.dataset.textRoomId));
    });
    els.directList.addEventListener("click", (event) => {
        const button = event.target.closest("[data-direct-id]");
        if (button) selectDirect(Number(button.dataset.directId));
    });
    els.messageForm.addEventListener("submit", sendMessage);
    els.messageInput.addEventListener("input", () => {
        resizeComposer();
        updateMessageLimit();
        sendTyping();
    });
    els.messageInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            els.messageForm.requestSubmit();
        }
    });
    els.emojiButton.addEventListener("click", () => {
        els.emojiPopover.hidden = !els.emojiPopover.hidden;
    });
    els.emojiPopover.addEventListener("click", (event) => {
        const button = event.target.closest(".emoji-option");
        if (!button) return;
        if (button.dataset.customEmoji) {
            const filename = button.dataset.customEmoji;
            insertAtCursor(`![${filename.replace(/\.[^.]+$/, "")}](/emoji/${filename})`);
        } else if (button.dataset.emoji) {
            insertAtCursor(button.dataset.emoji);
        }
        els.emojiPopover.hidden = true;
    });
    document.addEventListener("click", (event) => {
        if (!els.emojiPopover.hidden && !els.emojiPopover.contains(event.target) && !els.emojiButton.contains(event.target)) {
            els.emojiPopover.hidden = true;
        }
        if (
            !els.participantVolumePopover.hidden
            && !els.participantVolumePopover.contains(event.target)
        ) {
            closeParticipantVolumePopover();
        }
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeParticipantVolumePopover();
    });

    els.joinSelectedButton.addEventListener("click", () => joinVoiceRoom());
    els.participantGrid.addEventListener("contextmenu", (event) => {
        const card = event.target.closest("[data-participant-id]");
        if (!card) return;
        event.preventDefault();
        openParticipantVolumePopover(card.dataset.participantId, event.clientX, event.clientY);
    });
    els.participantVolumeSlider.addEventListener("input", () => {
        if (state.participantVolumeUserId === null) return;
        const percent = Number(els.participantVolumeSlider.value);
        setParticipantVolume(state.participantVolumeUserId, percent / 100);
        els.participantVolumeLabel.value = `${percent}%`;
        els.participantVolumeLabel.textContent = `${percent}%`;
    });
    els.micButton.addEventListener("click", toggleMute);
    els.deafenButton.addEventListener("click", toggleDeafen);
    els.shareButton.addEventListener("click", toggleScreenShare);
    els.leaveButton.addEventListener("click", () => leaveVoiceRoom());
    els.closeShareFocusButton.addEventListener("click", () => {
        state.shareViewerDismissed = true;
        syncShareStage();
    });
    els.openShareFocusButton.addEventListener("click", () => {
        state.shareViewerDismissed = false;
        syncShareStage();
    });
    els.shareZoomOutButton.addEventListener("click", () => changeShareZoom(-0.25));
    els.shareZoomInButton.addEventListener("click", () => changeShareZoom(0.25));
    els.shareFitButton.addEventListener("click", () => {
        state.shareFit = state.shareFit === "contain" ? "cover" : "contain";
        resetShareView();
        updateShareTransform();
    });
    els.sharePipButton.addEventListener("click", toggleSharePictureInPicture);
    els.shareFullscreenButton.addEventListener("click", toggleShareFullscreen);
    els.shareSwitcher.addEventListener("click", (event) => {
        const button = event.target.closest("[data-focus-share]");
        if (button) focusShare(button.dataset.focusShare);
    });
    els.shareVolumeSlider.addEventListener("input", () => {
        const userId = state.focusedShareUser;
        if (!userId || userId === "self") return;
        const volume = Number(els.shareVolumeSlider.value) / 100;
        state.shareVolumes.set(String(userId), volume);
        saveVolumeMap("borotalk-share-volumes", state.shareVolumes);
        const audio = focusedShareMedia()?.screenAudio;
        if (audio) audio.volume = volume;
        syncShareAudioControls();
    });
    els.shareAudioMuteButton.addEventListener("click", () => {
        const userId = state.focusedShareUser;
        if (!userId || userId === "self" || !focusedShareMedia()?.screenAudio) return;
        const key = String(userId);
        if (state.shareMutedUsers.has(key)) state.shareMutedUsers.delete(key);
        else state.shareMutedUsers.add(key);
        syncRemoteAudioMute();
        syncShareAudioControls();
    });

    let shareDrag = null;
    els.shareViewport.addEventListener("pointerdown", (event) => {
        if (state.shareZoom <= 1 || event.button !== 0) return;
        shareDrag = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            panX: state.sharePanX,
            panY: state.sharePanY,
        };
        els.shareViewport.setPointerCapture(event.pointerId);
        els.shareViewport.classList.add("dragging");
    });
    els.shareViewport.addEventListener("pointermove", (event) => {
        if (!shareDrag || event.pointerId !== shareDrag.pointerId) return;
        state.sharePanX = shareDrag.panX + event.clientX - shareDrag.startX;
        state.sharePanY = shareDrag.panY + event.clientY - shareDrag.startY;
        updateShareTransform();
    });
    const stopShareDrag = (event) => {
        if (!shareDrag || event.pointerId !== shareDrag.pointerId) return;
        shareDrag = null;
        els.shareViewport.classList.remove("dragging");
    };
    els.shareViewport.addEventListener("pointerup", stopShareDrag);
    els.shareViewport.addEventListener("pointercancel", stopShareDrag);
    els.shareViewport.addEventListener("wheel", (event) => {
        if (!event.ctrlKey) return;
        event.preventDefault();
        changeShareZoom(event.deltaY < 0 ? 0.25 : -0.25);
    }, { passive: false });

    els.discoverButton.addEventListener("click", () => openDiscovery("server"));
    els.createServerButton.addEventListener("click", () => openCreateChannel("server"));
    els.newDirectButton.addEventListener("click", () => openDiscovery("user"));
    els.findServerButton.addEventListener("click", findServer);
    els.findUserButton.addEventListener("click", findUser);
    els.discoveryResult.addEventListener("click", (event) => {
        const join = event.target.closest("[data-join-server]");
        const direct = event.target.closest("[data-start-direct]");
        if (join) joinFoundServer(Number(join.dataset.joinServer));
        if (direct) startDirect(Number(direct.dataset.startDirect));
    });
    els.discoveryId.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            if (els.findUserButton.dataset.preferred === "true") findUser();
            else findServer();
        }
    });
    els.discoverDialog.addEventListener("close", () => {
        delete els.findUserButton.dataset.preferred;
    });

    els.createVoiceButton.addEventListener("click", () => openCreateChannel("voice"));
    els.createTextButton.addEventListener("click", () => openCreateChannel("text"));
    els.createChannelForm.addEventListener("submit", createChannel);
    els.closeCreateDialog.addEventListener("click", () => els.createChannelDialog.close());
    els.serverSettingsButton.addEventListener("click", openServerDialog);
    els.saveServerButton.addEventListener("click", saveServer);
    els.transferOwnerButton.addEventListener("click", transferServerOwner);
    els.leaveServerButton.addEventListener("click", leaveCurrentServer);
    els.deleteServerButton.addEventListener("click", deleteCurrentServer);

    const openSettings = async () => {
        els.profileDisplayName.value = state.user.display_name;
        els.profileUsername.value = state.user.username;
        state.selectedAvatarPreset = avatarPreset(state.user);
        els.avatarPresetGrid.querySelectorAll("[data-avatar-preset]").forEach((button) => {
            button.classList.toggle("active", button.dataset.avatarPreset === state.selectedAvatarPreset);
        });
        await refreshAudioDevices();
        els.settingsDialog.showModal();
    };
    els.settingsButton.addEventListener("click", openSettings);
    els.profileButton.addEventListener("click", openSettings);
    document.querySelectorAll("[data-theme-choice]").forEach((button) => {
        button.addEventListener("click", () => applyTheme(button.dataset.themeChoice));
    });
    els.soundToggle.checked = state.sounds;
    els.soundToggle.addEventListener("change", () => {
        state.sounds = els.soundToggle.checked;
        localStorage.setItem("borotalk-sounds", state.sounds ? "on" : "off");
    });
    els.audioInputSelect.addEventListener("change", changeAudioInput);
    els.audioOutputSelect.addEventListener("change", changeAudioOutput);
    navigator.mediaDevices?.addEventListener?.("devicechange", refreshAudioDevices);
    els.avatarPresetGrid.addEventListener("click", (event) => {
        const button = event.target.closest("[data-avatar-preset]");
        if (!button) return;
        state.selectedAvatarPreset = button.dataset.avatarPreset;
        els.avatarPresetGrid.querySelectorAll("[data-avatar-preset]").forEach((item) => {
            item.classList.toggle("active", item === button);
        });
    });
    els.saveProfileButton.addEventListener("click", async () => {
        const displayName = els.profileDisplayName.value.trim();
        const username = els.profileUsername.value.trim();
        if (!displayName || !/^[A-Za-z0-9_]{3,32}$/.test(username)) {
            toast("Никнейм: 3–32 английских символа, цифры или _", "error");
            return;
        }
        const form = new FormData();
        form.append("display_name", displayName);
        form.append("username", username);
        form.append("remove_avatar", "false");
        if (state.selectedAvatarPreset) form.append("avatar_preset", state.selectedAvatarPreset);
        try {
            state.user = await jsonRequest("/auth/profile", { method: "PUT", body: form });
            renderCurrentUser();
            toast("Профиль сохранён");
        } catch (error) {
            toast(error.message, "error");
        }
    });
    els.logoutButton.addEventListener("click", async () => {
        await request("/auth/logout", { method: "POST" });
        window.location.href = LOGIN_URL;
    });
    els.membersButton.addEventListener("click", () => els.membersDialog.showModal());

    els.openChannelsButton.addEventListener("click", () => openDrawer("channels"));
    els.openChatButton.addEventListener("click", () => openDrawer("chat"));
    els.closeChatButton.addEventListener("click", closeDrawers);
    els.scrim.addEventListener("click", closeDrawers);
    window.addEventListener("resize", () => {
        if (window.innerWidth > 980) closeDrawers();
        closeParticipantVolumePopover();
    });
    window.addEventListener("offline", () => {
        clearTimeout(state.reconnectTimer);
        stopHeartbeat();
        resetPeerConnections();
        if (state.ws) {
            state.reconnectGeneration += 1;
            state.ws.onclose = null;
            state.ws.close(4000, "network offline");
            state.ws = null;
        }
        els.connectionDot.dataset.state = "offline";
        els.connectionDot.title = "Нет сети";
        setSocketRecovery(Boolean(state.currentVoiceRoomId));
    });
    window.addEventListener("online", () => {
        if (!state.server) return;
        els.connectionDot.dataset.state = "connecting";
        els.connectionDot.title = "Восстанавливаем связь";
        state.reconnectAttempts = 0;
        setSocketRecovery(Boolean(state.currentVoiceRoomId));
        connectWebSocket();
    });
    window.addEventListener("beforeunload", () => {
        stopHeartbeat();
        state.localStream?.getTracks().forEach((track) => track.stop());
        state.screenStream?.getTracks().forEach((track) => track.stop());
    });
}

async function init() {
    initTheme();
    state.participantVolumes = loadVolumeMap("borotalk-participant-volumes");
    state.shareVolumes = loadVolumeMap("borotalk-share-volumes");
    hydrateIcons();
    bindEvents();
    await initDesktopIntegration();
    try {
        state.user = await jsonRequest("/auth/me");
        renderCurrentUser();
        await Promise.all([loadConversations(), loadEmojis()]);
        await loadServers();
        els.app.hidden = false;
        els.loadingScreen.hidden = true;
        scrollMessagesToBottom();
        if (!desktop?.isDesktop && "serviceWorker" in navigator) {
            navigator.serviceWorker.register("/sw.js").catch(() => {});
        }
    } catch (error) {
        els.loadingText.textContent = "Не удалось открыть Borotalk";
        toast(error.message, "error");
    }
}

init();
