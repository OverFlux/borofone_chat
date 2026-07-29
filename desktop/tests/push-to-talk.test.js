const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
  PushToTalkController,
  matchesInput,
  resolveKeyboardKeycode,
} = require("../src/lib/push-to-talk");

const UiohookKey = {
  V: 47,
  Space: 57,
};

class FakeHook extends EventEmitter {
  constructor() {
    super();
    this.startCalls = 0;
    this.stopCalls = 0;
  }

  start() {
    this.startCalls += 1;
  }

  stop() {
    this.stopCalls += 1;
  }
}

test("maps only supported keyboard and mouse inputs", () => {
  assert.equal(resolveKeyboardKeycode("KeyV", UiohookKey), 47);
  assert.equal(resolveKeyboardKeycode("Escape", UiohookKey), undefined);
  assert.equal(matchesInput({ keycode: 47 }, { type: "keyboard", code: "KeyV" }, UiohookKey), true);
  assert.equal(matchesInput({ keycode: 48 }, { type: "keyboard", code: "KeyV" }, UiohookKey), false);
  assert.equal(matchesInput({ button: 4 }, { type: "mouse", code: "Mouse4" }, UiohookKey), true);
  assert.equal(matchesInput({ button: 5 }, { type: "mouse", code: "Mouse5" }, UiohookKey), true);
  assert.equal(matchesInput({ button: 4 }, { type: "mouse", code: "Mouse8" }, UiohookKey), false);
});

test("emits one down/up state pair and ignores every other key", () => {
  const hook = new FakeHook();
  const states = [];
  const controller = new PushToTalkController({
    loadHook: () => ({ uIOhook: hook, UiohookKey }),
    onState: (pressed) => states.push(pressed),
    onError: assert.fail,
  });

  assert.equal(controller.configure({
    enabled: true,
    input: { type: "keyboard", code: "KeyV", label: "V" },
  }), true);
  hook.emit("keydown", { keycode: 10 });
  hook.emit("keydown", { keycode: 47 });
  hook.emit("keydown", { keycode: 47 });
  hook.emit("keyup", { keycode: 47 });
  hook.emit("keyup", { keycode: 47 });

  assert.deepEqual(states, [true, false]);
  assert.equal(hook.startCalls, 1);
  controller.stop();
  assert.equal(hook.stopCalls, 1);
});

test("forces the released state when a pressed hook is stopped", () => {
  const hook = new FakeHook();
  const states = [];
  const controller = new PushToTalkController({
    loadHook: () => ({ uIOhook: hook, UiohookKey }),
    onState: (pressed) => states.push(pressed),
    onError: assert.fail,
  });
  controller.configure({
    enabled: true,
    input: { type: "keyboard", code: "KeyV", label: "V" },
  });
  hook.emit("keydown", { keycode: 47 });
  controller.stop();
  assert.deepEqual(states, [true, false]);
});

test("fails closed when the native hook or selected input is unavailable", () => {
  const errors = [];
  const failedHook = new PushToTalkController({
    loadHook: () => {
      throw new Error("native hook missing");
    },
    onState: assert.fail,
    onError: (error) => errors.push(error.message),
  });
  assert.equal(failedHook.configure({
    enabled: true,
    input: { type: "keyboard", code: "KeyV", label: "V" },
  }), false);

  const invalidInput = new PushToTalkController({
    loadHook: () => ({ uIOhook: new FakeHook(), UiohookKey }),
    onState: assert.fail,
    onError: (error) => errors.push(error.message),
  });
  assert.equal(invalidInput.configure({
    enabled: true,
    input: { type: "keyboard", code: "Escape", label: "Escape" },
  }), false);
  assert.equal(errors.length, 2);
});
