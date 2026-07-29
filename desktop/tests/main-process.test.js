const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mainSource = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");
const preloadSource = fs.readFileSync(path.join(__dirname, "..", "src", "preload.js"), "utf8");
const bridgeSource = fs.readFileSync(
  path.join(__dirname, "..", "..", "pages", "js", "desktop-bridge.js"),
  "utf8",
);

test("registers the local onboarding protocol in the persistent renderer session", () => {
  assert.match(mainSource, /registerLocalProtocol\(clientSession\.protocol\)/);
  assert.doesNotMatch(mainSource, /registerLocalProtocol\(\);\s*registerIpcHandlers/);
});

test("normalizes the custom onboarding scheme before checking IPC senders", () => {
  assert.match(mainSource, /parsed\.protocol === `\$\{APP_SCHEME\}:`/);
  assert.match(mainSource, /parsed\.host === "ui" \? LOCAL_ORIGIN/);
  assert.match(mainSource, /return originFromUrl\(event\.senderFrame/);
});

test("opens only web chat links in the system browser", () => {
  assert.match(mainSource, /shell\.openExternal\(externalWebUrl\(value\)\)/);
  assert.match(mainSource, /\["http:", "https:"\]\.includes\(target\.protocol\)/);
  assert.match(mainSource, /ipcMain\.handle\("desktop:open-external"/);
  assert.match(mainSource, /assertSender\(event, \{ remote: true \}\)/);
  assert.match(mainSource, /return \{ action: "deny" \}/);
  assert.match(preloadSource, /ipcRenderer\.invoke\("desktop:open-external", url\)/);
  assert.match(bridgeSource, /openExternal: \(url\) => nativeBridge\.openExternal/);
});

test("reports startup failures instead of leaving a silent black window", () => {
  assert.match(mainSource, /desktop\.log/);
  assert.match(mainSource, /showErrorBox/);
  assert.match(mainSource, /Menu\.setApplicationMenu\(null\)/);
});

test("uses one connection fallback path with an explicit host timeout", () => {
  assert.match(mainSource, /let connectScreenPromise = null/);
  assert.match(mainSource, /Promise\.race\(\[window\.loadURL\(target\), timeout\]\)/);
  assert.match(mainSource, /Хост не ответил за 12 секунд/);
  assert.match(mainSource, /FIX_RADMIN_ROUTE\.bat/);
  assert.match(mainSource, /26\.0\.0\.0\/8/);
  assert.match(mainSource, /KillSwitch/);
  assert.match(mainSource, /writeDesktopLog\(`Host navigation failed/);
});

test("bypasses the Windows system proxy for direct Radmin connectivity", () => {
  assert.match(mainSource, /await clientSession\.setProxy\(\{ mode: "direct" \}\)/);
});

test("accepts the host login redirect without falling back to onboarding", () => {
  assert.match(mainSource, /error\?\.code === "ERR_ABORTED"/);
  assert.match(mainSource, /originFromUrl\(mainWindow\.webContents\.getURL\(\)\) === connection\.baseUrl/);
});

test("renders screen capture inside the trusted host window instead of a child window", () => {
  assert.match(mainSource, /sendToRemote\("desktop:capture-requested"/);
  assert.doesNotMatch(mainSource, /captureWindow = new BrowserWindow/);
  assert.doesNotMatch(mainSource, /source-picker\.html/);
});

test("releases the capture slot before Electron reports a cancelled request", () => {
  const start = mainSource.indexOf("function finishCapture(streams)");
  const end = mainSource.indexOf("\nasync function openCapturePicker", start);
  const finishCaptureSource = mainSource.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.ok(
    finishCaptureSource.indexOf("captureRequest = null")
      < finishCaptureSource.indexOf("pending.callback(streams)"),
  );
  assert.match(finishCaptureSource, /catch \(error\)/);
  assert.match(finishCaptureSource, /if \(callbackError && streams\?\.video\) throw callbackError/);
});

test("excludes Borotalk playback from captured Windows system audio", () => {
  assert.match(mainSource, /id: "loopbackWithoutChrome"/);
  assert.doesNotMatch(
    mainSource,
    /selection\?\.withAudio[\s\S]{0,120}streams\.audio = "loopback"/,
  );
});

test("clears legacy service worker state before loading the host interface", () => {
  assert.match(
    mainSource,
    /clearStorageData\(\{ storages: \["serviceworkers", "cachestorage"\] \}\)/,
  );
  assert.match(mainSource, /await clientSession\.clearCache\(\)/);
});

test("does not initialize the application during Squirrel lifecycle events", () => {
  assert.match(mainSource, /if \(isSquirrelStartup\) \{\s+app\.quit\(\);\s+\} else \{/);
  assert.match(mainSource, /if \(isQuitting \|\| !mainWindow \|\| mainWindow\.isDestroyed\(\)\) return;/);
});
