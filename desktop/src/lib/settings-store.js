const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_SETTINGS = Object.freeze({
  connection: null,
  closeToTray: true,
  autoStart: false,
  notifications: true,
  pushToTalk: {
    enabled: false,
    input: { type: "keyboard", code: "KeyV", label: "V" },
  },
});

function cloneDefaults() {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

function sanitizeInput(value) {
  const type = value?.type === "mouse" ? "mouse" : "keyboard";
  const code = String(value?.code || (type === "mouse" ? "Mouse4" : "KeyV")).slice(0, 32);
  const label = String(value?.label || code).slice(0, 32);
  return { type, code, label };
}

function sanitizeSettings(value) {
  const defaults = cloneDefaults();
  if (!value || typeof value !== "object") return defaults;
  return {
    connection: value.connection && typeof value.connection === "object"
      ? {
          schemaVersion: 1,
          baseUrl: String(value.connection.baseUrl || ""),
          inviteCode: String(value.connection.inviteCode || ""),
          certificateFingerprint: String(value.connection.certificateFingerprint || ""),
          trustedManually: Boolean(value.connection.trustedManually),
        }
      : null,
    closeToTray: value.closeToTray !== false,
    autoStart: Boolean(value.autoStart),
    notifications: value.notifications !== false,
    pushToTalk: {
      enabled: Boolean(value.pushToTalk?.enabled),
      input: sanitizeInput(value.pushToTalk?.input),
    },
  };
}

class SettingsStore {
  constructor(userDataDirectory) {
    this.filePath = path.join(userDataDirectory, "desktop-settings.json");
    this.value = this.read();
  }

  read() {
    try {
      return sanitizeSettings(JSON.parse(fs.readFileSync(this.filePath, "utf8")));
    } catch {
      return cloneDefaults();
    }
  }

  get() {
    return JSON.parse(JSON.stringify(this.value));
  }

  replace(nextValue) {
    this.value = sanitizeSettings(nextValue);
    this.persist();
    return this.get();
  }

  patch(patch) {
    const next = {
      ...this.value,
      ...patch,
      pushToTalk: {
        ...this.value.pushToTalk,
        ...(patch.pushToTalk || {}),
      },
    };
    return this.replace(next);
  }

  persist() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(this.value, null, 2)}\n`, "utf8");
    fs.renameSync(temporaryPath, this.filePath);
  }
}

module.exports = {
  DEFAULT_SETTINGS,
  SettingsStore,
  sanitizeInput,
  sanitizeSettings,
};
