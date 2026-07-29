const fs = require("node:fs");
const path = require("node:path");
const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  desktopCapturer,
  dialog,
  ipcMain,
  nativeImage,
  protocol,
  session,
} = require("electron");
const isSquirrelStartup = require("electron-squirrel-startup");
const {
  connectionForManualUrl,
  fingerprintsEqual,
  normalizeFingerprint,
  parseInviteDocument,
} = require("./lib/connection-config");
const { PushToTalkController } = require("./lib/push-to-talk");
const { SettingsStore, sanitizeInput } = require("./lib/settings-store");

const APP_SCHEME = "borotalk-app";
const LOCAL_ORIGIN = `${APP_SCHEME}://ui`;
const ICON_PATH = app.isPackaged
  ? path.join(process.resourcesPath, "favicon.ico")
  : path.resolve(__dirname, "..", "..", "favicon.ico");
const UI_ROOT = path.join(__dirname, "ui");
const STATIC_FILES = new Map([
  ["/connect.html", ["connect.html", "text/html; charset=utf-8"]],
  ["/connect.css", ["connect.css", "text/css; charset=utf-8"]],
  ["/connect.js", ["connect.js", "text/javascript; charset=utf-8"]],
]);

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false,
    },
  },
]);

let mainWindow = null;
let tray = null;
let store = null;
let isQuitting = false;
let connectError = "";
let connectScreenPromise = null;
let captureRequest = null;

function activeConnection() {
  return store?.get().connection || null;
}

function activeOrigin() {
  return activeConnection()?.baseUrl || "";
}

function originFromUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === `${APP_SCHEME}:`) {
      return parsed.host === "ui" ? LOCAL_ORIGIN : "";
    }
    return parsed.origin;
  } catch {
    return "";
  }
}

function senderOrigin(event) {
  return originFromUrl(event.senderFrame?.url || event.sender.getURL());
}

function assertSender(event, { local = false, remote = false } = {}) {
  const origin = senderOrigin(event);
  if (local && origin === LOCAL_ORIGIN) return;
  if (remote && origin === activeOrigin()) return;
  throw new Error("Недоверенный источник desktop-команды.");
}

function publicSettings() {
  const settings = store.get();
  return {
    closeToTray: settings.closeToTray,
    autoStart: settings.autoStart,
    notifications: settings.notifications,
    pushToTalk: settings.pushToTalk,
  };
}

function publicConnection() {
  const connection = activeConnection();
  if (!connection) return null;
  return {
    baseUrl: connection.baseUrl,
    inviteCode: connection.inviteCode,
    pinned: Boolean(connection.certificateFingerprint),
  };
}

function applyAutoStart(enabled) {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({
    openAtLogin: Boolean(enabled),
    path: process.execPath,
  });
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function buildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Открыть Borotalk", click: showMainWindow },
    { label: "Сменить хост", click: () => showConnectScreen() },
    { type: "separator" },
    {
      label: "Запускать вместе с Windows",
      type: "checkbox",
      checked: store.get().autoStart,
      click: (item) => updateDesktopSettings({ autoStart: item.checked }),
    },
    { type: "separator" },
    {
      label: "Выйти",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]));
}

function createTray() {
  const icon = nativeImage.createFromPath(ICON_PATH);
  tray = new Tray(icon);
  tray.setToolTip("Borotalk Desktop");
  tray.on("double-click", showMainWindow);
  buildTrayMenu();
}

function writeDesktopLog(message) {
  try {
    const line = `[${new Date().toISOString()}] ${String(message)}\n`;
    fs.appendFileSync(path.join(app.getPath("userData"), "desktop.log"), line, "utf8");
  } catch {
    // Logging must never hide the original error.
  }
}

function registerLocalProtocol(sessionProtocol) {
  sessionProtocol.handle(APP_SCHEME, (request) => {
    const url = new URL(request.url);
    const entry = STATIC_FILES.get(url.pathname);
    if (url.host !== "ui" || !entry) {
      return new Response("Not found", { status: 404 });
    }
    const [filename, contentType] = entry;
    return new Response(fs.readFileSync(path.join(UI_ROOT, filename)), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Security-Policy": [
          "default-src 'none'",
          `script-src ${LOCAL_ORIGIN}`,
          `style-src ${LOCAL_ORIGIN}`,
          "img-src data:",
        ].join("; "),
      },
    });
  });
}

function configureNavigation(window) {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, targetUrl) => {
    const targetOrigin = originFromUrl(targetUrl);
    if (![LOCAL_ORIGIN, activeOrigin()].includes(targetOrigin)) {
      event.preventDefault();
    }
  });
}

function createMainWindow() {
  const window = new BrowserWindow({
    width: 1320,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    show: false,
    icon: ICON_PATH,
    backgroundColor: "#242424",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      partition: "persist:borotalk",
    },
  });
  configureNavigation(window);
  window.once("ready-to-show", () => window.show());
  window.on("close", (event) => {
    if (!isQuitting && store.get().closeToTray) {
      event.preventDefault();
      window.hide();
      return;
    }
    isQuitting = true;
  });
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    if (validatedUrl.startsWith(`${APP_SCHEME}:`)) {
      const message = `Не удалось открыть локальный экран Borotalk Desktop (${errorCode}: ${errorDescription}).`;
      writeDesktopLog(message);
      dialog.showErrorBox("Ошибка Borotalk Desktop", `${message}\n\nЛог: ${path.join(app.getPath("userData"), "desktop.log")}`);
      return;
    }
    writeDesktopLog(`Host navigation failed (${errorCode}: ${errorDescription}) at ${validatedUrl}`);
  });
  mainWindow = window;
  return window;
}

async function showConnectScreen(errorMessage = "") {
  connectError = errorMessage;
  const window = mainWindow;
  if (isQuitting || !window || window.isDestroyed() || window.webContents.isDestroyed()) return false;
  if (originFromUrl(window.webContents.getURL()) !== LOCAL_ORIGIN) {
    if (!connectScreenPromise) {
      connectScreenPromise = window.loadURL(`${LOCAL_ORIGIN}/connect.html`)
        .finally(() => {
          connectScreenPromise = null;
        });
    }
    await connectScreenPromise;
  }
  if (isQuitting || window.isDestroyed() || window.webContents.isDestroyed()) return false;
  window.webContents.send("desktop:connection-error", connectError);
  showMainWindow();
  return true;
}

async function loadRemoteUrl(target, timeoutMs = 12000) {
  const window = mainWindow;
  if (isQuitting || !window || window.isDestroyed() || window.webContents.isDestroyed()) {
    const error = new Error("Окно Borotalk Desktop уже закрыто.");
    error.code = "WINDOW_DESTROYED";
    throw error;
  }
  let timeoutId = null;
  const timeout = new Promise((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error("Хост не ответил за 12 секунд.");
      error.code = "HOST_TIMEOUT";
      reject(error);
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.stop();
    }, timeoutMs);
  });
  try {
    await Promise.race([window.loadURL(target), timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function connectToHost(connection, { persist = true } = {}) {
  if (persist) store.patch({ connection });
  connectError = "";
  const target = `${connection.baseUrl}/main.html`;
  writeDesktopLog(`Connecting to ${target}`);
  try {
    await loadRemoteUrl(target);
    writeDesktopLog(`Connected to ${target}`);
    showMainWindow();
    return true;
  } catch (error) {
    if (isQuitting || error?.code === "WINDOW_DESTROYED" || !mainWindow || mainWindow.isDestroyed()) {
      return false;
    }
    if (
      error?.code === "ERR_ABORTED"
      && originFromUrl(mainWindow.webContents.getURL()) === connection.baseUrl
    ) {
      writeDesktopLog(`Host redirected within the trusted origin to ${mainWindow.webContents.getURL()}`);
      showMainWindow();
      return true;
    }
    const message = connectError || (
      error?.code === "HOST_TIMEOUT"
        ? "Хост не ответил за 12 секунд. Проверьте Radmin VPN и убедитесь, что START_BOROTALK.bat завершил запуск."
        : `Хост недоступен: ${error?.message || "ошибка соединения"}. Проверьте Radmin VPN и запуск Borotalk на хосте.`
    );
    writeDesktopLog(`${message} Target: ${target}`);
    await showConnectScreen(message);
    return false;
  }
}

async function importInviteFile(filePath) {
  const connection = parseInviteDocument(fs.readFileSync(filePath, "utf8"));
  await connectToHost(connection);
  return publicConnection();
}

async function chooseInviteFile() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Открыть подключение Borotalk",
    properties: ["openFile"],
    filters: [
      { name: "Borotalk connection", extensions: ["borotalk"] },
      { name: "JSON", extensions: ["json"] },
    ],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return importInviteFile(result.filePaths[0]);
}

function invitationFromArguments(argv) {
  return argv.find((value) => String(value).toLowerCase().endsWith(".borotalk")) || "";
}

function updateDesktopSettings(patch) {
  const allowed = {};
  if (Object.hasOwn(patch || {}, "closeToTray")) allowed.closeToTray = Boolean(patch.closeToTray);
  if (Object.hasOwn(patch || {}, "autoStart")) allowed.autoStart = Boolean(patch.autoStart);
  if (Object.hasOwn(patch || {}, "notifications")) allowed.notifications = Boolean(patch.notifications);
  if (patch?.pushToTalk && typeof patch.pushToTalk === "object") {
    allowed.pushToTalk = {
      enabled: Boolean(patch.pushToTalk.enabled),
      input: sanitizeInput(patch.pushToTalk.input),
    };
  }
  const settings = store.patch(allowed);
  applyAutoStart(settings.autoStart);
  buildTrayMenu();
  const pttStarted = pushToTalk.configure(settings.pushToTalk);
  if (settings.pushToTalk.enabled && !pttStarted) {
    settings.pushToTalk.enabled = false;
    store.patch({ pushToTalk: settings.pushToTalk });
  }
  return publicSettings();
}

function sendToRemote(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return false;
  try {
    if (new URL(mainWindow.webContents.getURL()).origin !== activeOrigin()) return false;
    mainWindow.webContents.send(channel, payload);
    return true;
  } catch {
    // Navigation may be in progress.
    return false;
  }
}

const pushToTalk = new PushToTalkController({
  loadHook: () => require("uiohook-napi"),
  onState: (pressed) => sendToRemote("desktop:push-to-talk", { pressed }),
  onError: () => sendToRemote("desktop:push-to-talk-error", {
    message: "Не удалось запустить глобальный push-to-talk.",
  }),
});

function configureCertificateTrust() {
  app.on("certificate-error", (event, _webContents, requestUrl, _error, certificate, callback) => {
    let requestOrigin = "";
    try {
      requestOrigin = new URL(requestUrl).origin;
    } catch {
      callback(false);
      return;
    }
    const connection = activeConnection();
    if (!connection || requestOrigin !== connection.baseUrl) {
      writeDesktopLog(`Rejected certificate outside the saved origin: ${requestOrigin}`);
      callback(false);
      return;
    }
    event.preventDefault();
    let fingerprint = "";
    try {
      fingerprint = normalizeFingerprint(certificate.fingerprint);
    } catch {
      callback(false);
      connectError = "Не удалось проверить fingerprint сертификата хоста.";
      return;
    }
    if (connection.certificateFingerprint) {
      if (fingerprintsEqual(connection.certificateFingerprint, fingerprint)) {
        writeDesktopLog(`Accepted pinned certificate for ${requestOrigin}: ${fingerprint}`);
        callback(true);
      } else {
        writeDesktopLog(`Rejected changed certificate for ${requestOrigin}: ${fingerprint}`);
        callback(false);
        connectError = "Сертификат хоста изменился. Соединение заблокировано.";
      }
      return;
    }
    void dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "Доверие к хосту Borotalk",
      message: "Сертификат хоста не установлен в Windows.",
      detail: `Проверьте fingerprint у владельца хоста:\n${fingerprint}`,
      buttons: ["Доверять этому сертификату", "Отмена"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    }).then(({ response }) => {
      if (response !== 0) {
        connectError = "Подключение отменено: сертификат хоста не был подтверждён.";
        callback(false);
        return;
      }
      store.patch({
        connection: {
          ...connection,
          certificateFingerprint: fingerprint,
          trustedManually: true,
        },
      });
      callback(true);
    });
  });
}

function configurePermissions(clientSession) {
  const allowedPermissions = new Set([
    "media",
    "notifications",
    "fullscreen",
    "display-capture",
    "speaker-selection",
  ]);
  clientSession.setPermissionRequestHandler((webContents, permission, callback) => {
    let origin = "";
    try {
      origin = new URL(webContents.getURL()).origin;
    } catch {
      callback(false);
      return;
    }
    callback(origin === activeOrigin() && allowedPermissions.has(permission));
  });
  clientSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => (
    requestingOrigin === activeOrigin() && allowedPermissions.has(permission)
  ));
}

function finishCapture(streams) {
  if (!captureRequest || captureRequest.completed) return;
  captureRequest.completed = true;
  captureRequest.callback(streams);
  captureRequest = null;
  sendToRemote("desktop:capture-finished", {});
}

async function openCapturePicker(request, callback) {
  if (captureRequest) {
    callback({});
    return;
  }
  const requestOrigin = originFromUrl(
    request.securityOrigin || request.frame?.url || mainWindow?.webContents.getURL() || "",
  );
  if (requestOrigin !== activeOrigin()) {
    writeDesktopLog(`Rejected display capture request from ${requestOrigin || "unknown origin"}.`);
    callback({});
    return;
  }
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true,
  });
  captureRequest = { request, callback, sources, completed: false };
  writeDesktopLog(`Opening embedded capture picker with ${sources.length} sources.`);
  const delivered = sendToRemote("desktop:capture-requested", {
    audioRequested: Boolean(request.audioRequested),
    sources: sources.map((source) => ({
      id: source.id,
      name: source.name,
      displayId: source.display_id,
      thumbnail: source.thumbnail.toDataURL(),
      appIcon: source.appIcon?.toDataURL() || "",
      kind: source.id.startsWith("screen:") ? "screen" : "application",
    })),
  });
  if (!delivered) {
    writeDesktopLog("Embedded capture picker could not be delivered to the host renderer.");
    finishCapture({});
    return;
  }
  showMainWindow();
}

function configureDisplayCapture(clientSession) {
  clientSession.setDisplayMediaRequestHandler((request, callback) => {
    void openCapturePicker(request, callback).catch((error) => {
      writeDesktopLog(`Display capture failed: ${error?.stack || error?.message || error}`);
      if (captureRequest && !captureRequest.completed) {
        finishCapture({});
      } else {
        callback({});
      }
    });
  });
}

function registerIpcHandlers() {
  ipcMain.handle("desktop:get-version", (event) => {
    assertSender(event, { local: true, remote: true });
    return app.getVersion();
  });
  ipcMain.handle("desktop:get-settings", (event) => {
    assertSender(event, { local: true, remote: true });
    return publicSettings();
  });
  ipcMain.handle("desktop:update-settings", (event, patch) => {
    assertSender(event, { remote: true });
    return updateDesktopSettings(patch);
  });
  ipcMain.handle("desktop:get-connection", (event) => {
    assertSender(event, { local: true, remote: true });
    return publicConnection();
  });
  ipcMain.handle("desktop:choose-invite", async (event) => {
    assertSender(event, { local: true });
    return chooseInviteFile();
  });
  ipcMain.handle("desktop:import-invite-text", async (event, text) => {
    assertSender(event, { local: true });
    const connection = parseInviteDocument(String(text || "").slice(0, 64 * 1024));
    await connectToHost(connection);
    return publicConnection();
  });
  ipcMain.handle("desktop:connect-manual", async (event, value) => {
    assertSender(event, { local: true });
    const connection = connectionForManualUrl(value);
    await connectToHost(connection);
    return publicConnection();
  });
  ipcMain.handle("desktop:connect-saved", async (event) => {
    assertSender(event, { local: true });
    const connection = activeConnection();
    if (!connection) throw new Error("Сохранённый хост отсутствует.");
    await connectToHost(connection, { persist: false });
    return publicConnection();
  });
  ipcMain.handle("desktop:change-host", async (event) => {
    assertSender(event, { remote: true });
    await showConnectScreen();
    return true;
  });
  ipcMain.handle("desktop:notify", (event, payload) => {
    assertSender(event, { remote: true });
    if (!store.get().notifications || mainWindow.isFocused()) return false;
    const title = String(payload?.title || "Borotalk").slice(0, 80);
    const body = String(payload?.body || "").slice(0, 240);
    const notification = new Notification({ title, body, icon: ICON_PATH });
    notification.on("click", showMainWindow);
    notification.show();
    return true;
  });
  ipcMain.handle("desktop:select-capture-source", (event, selection) => {
    assertSender(event, { remote: true });
    const source = captureRequest?.sources.find((item) => item.id === selection?.sourceId);
    if (!source) throw new Error("Источник экрана больше недоступен.");
    const streams = { video: source };
    if (selection?.withAudio && captureRequest.request.audioRequested) streams.audio = "loopback";
    finishCapture(streams);
    return true;
  });
  ipcMain.handle("desktop:cancel-capture", (event) => {
    assertSender(event, { remote: true });
    finishCapture({});
    return true;
  });
}

async function initialize() {
  store = new SettingsStore(app.getPath("userData"));
  const clientSession = session.fromPartition("persist:borotalk");
  await clientSession.setProxy({ mode: "direct" });
  writeDesktopLog("Desktop network mode: DIRECT (system proxy bypassed for Radmin host).");
  await clientSession.clearStorageData({ storages: ["serviceworkers", "cachestorage"] });
  await clientSession.clearCache();
  writeDesktopLog("Cleared legacy service worker, app-shell, and HTTP cache.");
  registerLocalProtocol(clientSession.protocol);
  registerIpcHandlers();
  configurePermissions(clientSession);
  configureDisplayCapture(clientSession);
  Menu.setApplicationMenu(null);
  createMainWindow();
  createTray();
  applyAutoStart(store.get().autoStart);
  pushToTalk.configure(store.get().pushToTalk);

  const startupInvite = invitationFromArguments(process.argv);
  if (startupInvite && fs.existsSync(startupInvite)) {
    try {
      await importInviteFile(startupInvite);
      return;
    } catch (error) {
      await showConnectScreen(error.message);
      return;
    }
  }
  const connection = activeConnection();
  if (connection) {
    try {
      await connectToHost(connection, { persist: false });
      return;
    } catch (error) {
      await showConnectScreen(error.message);
      return;
    }
  }
  await showConnectScreen();
}

if (isSquirrelStartup) {
  app.quit();
} else {
  const hasSingleInstanceLock = app.requestSingleInstanceLock();
  if (!hasSingleInstanceLock) {
    app.quit();
  } else {
    configureCertificateTrust();
    app.on("second-instance", (_event, argv) => {
      showMainWindow();
      const invitePath = invitationFromArguments(argv);
      if (invitePath && fs.existsSync(invitePath)) {
        void importInviteFile(invitePath).catch((error) => showConnectScreen(error.message));
      }
    });
    app.whenReady().then(initialize).catch((error) => {
      const message = error?.stack || error?.message || String(error);
      writeDesktopLog(message);
      if (isQuitting || !mainWindow || mainWindow.isDestroyed()) return;
      dialog.showErrorBox(
        "Не удалось запустить Borotalk Desktop",
        `${error?.message || "Неизвестная ошибка."}\n\nЛог: ${path.join(app.getPath("userData"), "desktop.log")}`,
      );
      app.quit();
    });
    app.on("activate", showMainWindow);
    app.on("before-quit", () => {
      isQuitting = true;
      if (captureRequest && !captureRequest.completed) finishCapture({});
      pushToTalk.stop();
    });
    app.on("window-all-closed", () => {
      app.quit();
    });
  }
}
