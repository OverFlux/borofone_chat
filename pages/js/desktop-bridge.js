(function attachBorotalkDesktopBridge() {
    const nativeBridge = window.borotalkDesktop;
    if (!nativeBridge?.isDesktop) {
        window.BorotalkDesktopBridge = null;
        return;
    }

    window.BorotalkDesktopBridge = Object.freeze({
        isDesktop: true,
        getVersion: () => nativeBridge.getVersion(),
        getSettings: () => nativeBridge.getSettings(),
        getConnection: () => nativeBridge.getConnection(),
        updateSettings: (patch) => nativeBridge.updateSettings(patch),
        changeHost: () => nativeBridge.changeHost(),
        openExternal: (url) => nativeBridge.openExternal(String(url || "").slice(0, 4096)),
        selectCaptureSource: (selection) => nativeBridge.selectCaptureSource(selection),
        cancelCapture: () => nativeBridge.cancelCapture(),
        notifyMessage: ({ title, body }) => nativeBridge.notify({
            title: String(title || "Borotalk").slice(0, 80),
            body: String(body || "").slice(0, 240),
        }),
        onPushToTalk: (callback) => nativeBridge.onPushToTalk(callback),
        onPushToTalkError: (callback) => nativeBridge.onPushToTalkError(callback),
        onCaptureRequest: (callback) => nativeBridge.onCaptureRequest(callback),
        onCaptureFinished: (callback) => nativeBridge.onCaptureFinished(callback),
    });
})();
