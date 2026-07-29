const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  DEFAULT_SETTINGS,
  SettingsStore,
  sanitizeInput,
  sanitizeSettings,
} = require("../src/lib/settings-store");

function withTemporaryDirectory(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "borotalk-desktop-"));
  try {
    callback(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("starts with conservative desktop defaults", () => {
  withTemporaryDirectory((directory) => {
    const store = new SettingsStore(directory);
    assert.deepEqual(store.get(), DEFAULT_SETTINGS);
    assert.equal(store.get().pushToTalk.enabled, false);
    assert.equal(store.get().autoStart, false);
  });
});

test("persists and reloads supported settings", () => {
  withTemporaryDirectory((directory) => {
    const first = new SettingsStore(directory);
    first.patch({
      closeToTray: false,
      notifications: false,
      pushToTalk: {
        enabled: true,
        input: { type: "mouse", code: "Mouse5", label: "Mouse 5" },
      },
    });
    const second = new SettingsStore(directory);
    assert.equal(second.get().closeToTray, false);
    assert.equal(second.get().notifications, false);
    assert.deepEqual(second.get().pushToTalk, {
      enabled: true,
      input: { type: "mouse", code: "Mouse5", label: "Mouse 5" },
    });
  });
});

test("falls back safely when the settings file is corrupted", () => {
  withTemporaryDirectory((directory) => {
    fs.writeFileSync(path.join(directory, "desktop-settings.json"), "{broken", "utf8");
    assert.deepEqual(new SettingsStore(directory).get(), DEFAULT_SETTINGS);
  });
});

test("sanitizes arbitrary settings and input labels", () => {
  assert.deepEqual(sanitizeInput({ type: "other", code: "KeyQ", label: "Q" }), {
    type: "keyboard",
    code: "KeyQ",
    label: "Q",
  });
  const settings = sanitizeSettings({
    closeToTray: false,
    autoStart: "yes",
    notifications: 0,
    pushToTalk: { enabled: 1, input: { type: "mouse", code: "Mouse4", label: "x".repeat(100) } },
  });
  assert.equal(settings.closeToTray, false);
  assert.equal(settings.autoStart, true);
  assert.equal(settings.notifications, true);
  assert.equal(settings.pushToTalk.input.label.length, 32);
});
