const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  if (typeof callback !== "function") return () => {};
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld("borotalkDesktop", Object.freeze({
  isDesktop: true,
  getVersion: () => ipcRenderer.invoke("desktop:get-version"),
  getSettings: () => ipcRenderer.invoke("desktop:get-settings"),
  updateSettings: (patch) => ipcRenderer.invoke("desktop:update-settings", patch),
  getConnection: () => ipcRenderer.invoke("desktop:get-connection"),
  chooseInvite: () => ipcRenderer.invoke("desktop:choose-invite"),
  importInviteText: (text) => ipcRenderer.invoke("desktop:import-invite-text", text),
  connectManual: (url) => ipcRenderer.invoke("desktop:connect-manual", url),
  connectSaved: () => ipcRenderer.invoke("desktop:connect-saved"),
  changeHost: () => ipcRenderer.invoke("desktop:change-host"),
  notify: (payload) => ipcRenderer.invoke("desktop:notify", payload),
  selectCaptureSource: (selection) => ipcRenderer.invoke("desktop:select-capture-source", selection),
  cancelCapture: () => ipcRenderer.invoke("desktop:cancel-capture"),
  onCaptureRequest: (callback) => subscribe("desktop:capture-requested", callback),
  onCaptureFinished: (callback) => subscribe("desktop:capture-finished", callback),
  onPushToTalk: (callback) => subscribe("desktop:push-to-talk", callback),
  onPushToTalkError: (callback) => subscribe("desktop:push-to-talk-error", callback),
  onConnectionError: (callback) => subscribe("desktop:connection-error", callback),
}));
