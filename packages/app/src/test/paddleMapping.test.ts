import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PADDLE_KEY_BINDINGS,
  loadPaddleKeyBindings,
  loadPaddleType,
  savePaddleKeyBindings,
  savePaddleType,
} from "../input/paddleMapping.js";

function installLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
}

beforeEach(installLocalStorage);
afterEach(() => {
  delete (globalThis as Record<string, unknown>).localStorage;
});

describe("paddle type persistence", () => {
  it("defaults to 'none' and round-trips valid types", () => {
    expect(loadPaddleType()).toBe("none");
    savePaddleType("gamepad");
    expect(loadPaddleType()).toBe("gamepad");
    savePaddleType("keys");
    expect(loadPaddleType()).toBe("keys");
  });

  it("rejects unknown stored values", () => {
    localStorage.setItem("apple2_paddle_type", "joystick");
    expect(loadPaddleType()).toBe("none");
  });
});

describe("paddle key binding persistence", () => {
  it("returns the defaults when nothing is stored", () => {
    expect(loadPaddleKeyBindings()).toEqual(DEFAULT_PADDLE_KEY_BINDINGS);
  });

  it("round-trips custom bindings", () => {
    const custom = { ...DEFAULT_PADDLE_KEY_BINDINGS, fire: "KeyX" };
    savePaddleKeyBindings(custom);
    expect(loadPaddleKeyBindings()).toEqual(custom);
  });

  it("falls back to defaults on corrupt JSON or incomplete bindings", () => {
    localStorage.setItem("apple2_paddle_bindings", "{not json");
    expect(loadPaddleKeyBindings()).toEqual(DEFAULT_PADDLE_KEY_BINDINGS);

    localStorage.setItem("apple2_paddle_bindings", JSON.stringify({ left: "KeyA" }));
    expect(loadPaddleKeyBindings()).toEqual(DEFAULT_PADDLE_KEY_BINDINGS);
  });
});
