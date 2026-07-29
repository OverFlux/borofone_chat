const KEYBOARD_CODES = {
  Space: "Space",
  Tab: "Tab",
  CapsLock: "CapsLock",
  Backquote: "Backquote",
  ShiftLeft: "Shift",
  ShiftRight: "ShiftRight",
  ControlLeft: "Ctrl",
  ControlRight: "CtrlRight",
  AltLeft: "Alt",
  AltRight: "AltRight",
  F1: "F1",
  F2: "F2",
  F3: "F3",
  F4: "F4",
  F5: "F5",
  F6: "F6",
  F7: "F7",
  F8: "F8",
  F9: "F9",
  F10: "F10",
  F11: "F11",
  F12: "F12",
};

for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
  KEYBOARD_CODES[`Key${letter}`] = letter;
}
for (const digit of "0123456789") {
  KEYBOARD_CODES[`Digit${digit}`] = digit;
}
Object.freeze(KEYBOARD_CODES);

function resolveKeyboardKeycode(code, UiohookKey) {
  const keyName = KEYBOARD_CODES[code];
  return keyName ? UiohookKey[keyName] : undefined;
}

function matchesInput(event, input, UiohookKey) {
  if (input?.type === "mouse") {
    if (!["Mouse4", "Mouse5"].includes(input.code)) return false;
    const expectedButton = input.code === "Mouse5" ? 5 : 4;
    return event.button === expectedButton;
  }
  const keycode = resolveKeyboardKeycode(input?.code, UiohookKey);
  return Number.isInteger(keycode) && event.keycode === keycode;
}

class PushToTalkController {
  constructor({ loadHook, onState, onError }) {
    this.loadHook = loadHook;
    this.onState = onState;
    this.onError = onError;
    this.enabled = false;
    this.input = null;
    this.pressed = false;
    this.hook = null;
    this.handlers = null;
  }

  configure(configuration) {
    this.stop();
    this.enabled = Boolean(configuration?.enabled);
    this.input = configuration?.input || null;
    if (!this.enabled) return true;
    try {
      const { uIOhook, UiohookKey } = this.loadHook();
      const validMouseInput = this.input?.type === "mouse"
        && ["Mouse4", "Mouse5"].includes(this.input.code);
      const validKeyboardInput = this.input?.type !== "mouse"
        && Number.isInteger(resolveKeyboardKeycode(this.input?.code, UiohookKey));
      if (!validMouseInput && !validKeyboardInput) {
        throw new Error("Unsupported push-to-talk input.");
      }
      this.hook = uIOhook;
      const down = (event) => {
        if (!matchesInput(event, this.input, UiohookKey) || this.pressed) return;
        this.pressed = true;
        this.onState(true);
      };
      const up = (event) => {
        if (!matchesInput(event, this.input, UiohookKey) || !this.pressed) return;
        this.pressed = false;
        this.onState(false);
      };
      const downEvent = this.input?.type === "mouse" ? "mousedown" : "keydown";
      const upEvent = this.input?.type === "mouse" ? "mouseup" : "keyup";
      this.handlers = { down, up, downEvent, upEvent };
      this.hook.on(downEvent, down);
      this.hook.on(upEvent, up);
      this.hook.start();
      return true;
    } catch (error) {
      this.enabled = false;
      this.onError(error);
      return false;
    }
  }

  stop() {
    if (this.pressed) this.onState(false);
    this.pressed = false;
    if (this.hook && this.handlers) {
      this.hook.off(this.handlers.downEvent, this.handlers.down);
      this.hook.off(this.handlers.upEvent, this.handlers.up);
      try {
        this.hook.stop();
      } catch {
        // The native hook may already be stopped during application shutdown.
      }
    }
    this.hook = null;
    this.handlers = null;
  }
}

module.exports = {
  KEYBOARD_CODES,
  PushToTalkController,
  matchesInput,
  resolveKeyboardKeycode,
};
