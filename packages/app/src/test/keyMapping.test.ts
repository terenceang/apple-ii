import { describe, expect, it } from "vitest";
import { keyEventToAscii } from "../input/keyMapping.js";

type FakeEvent = { code: string; key: string; ctrlKey?: boolean };
const ev = (e: FakeEvent) => keyEventToAscii(e as KeyboardEvent);

describe("keyEventToAscii", () => {
  it("passes single printable characters through as their ASCII code", () => {
    expect(ev({ code: "KeyA", key: "a" })).toBe(0x61);
    expect(ev({ code: "Digit1", key: "1" })).toBe(0x31);
    expect(ev({ code: "Space", key: " " })).toBe(0x20); // key length 1 beats special-code map
  });

  it("maps control+letter to the matching control code (0x01-0x1a)", () => {
    expect(ev({ code: "KeyA", key: "a", ctrlKey: true })).toBe(0x01);
    expect(ev({ code: "KeyC", key: "c", ctrlKey: true })).toBe(0x03);
    expect(ev({ code: "KeyZ", key: "z", ctrlKey: true })).toBe(0x1a);
    expect(ev({ code: "KeyC", key: "C", ctrlKey: true })).toBe(0x03); // case-insensitive
  });

  it("maps special keys to Apple II control codes", () => {
    expect(ev({ code: "Enter", key: "Enter" })).toBe(0x0d);
    expect(ev({ code: "Escape", key: "Escape" })).toBe(0x1b);
    expect(ev({ code: "Tab", key: "Tab" })).toBe(0x09);
    expect(ev({ code: "Backspace", key: "Backspace" })).toBe(0x7f);
    expect(ev({ code: "Delete", key: "Delete" })).toBe(0x7f);
    expect(ev({ code: "ArrowLeft", key: "ArrowLeft" })).toBe(0x08);
    expect(ev({ code: "ArrowRight", key: "ArrowRight" })).toBe(0x15);
    expect(ev({ code: "ArrowUp", key: "ArrowUp" })).toBe(0x0b);
    expect(ev({ code: "ArrowDown", key: "ArrowDown" })).toBe(0x0a);
  });

  it("returns null for multi-character keys with no mapping (shift, dead keys, etc.)", () => {
    expect(ev({ code: "ShiftLeft", key: "Shift" })).toBeNull();
    expect(ev({ code: "ControlLeft", key: "Control" })).toBeNull();
    expect(ev({ code: "Backquote", key: "Dead" })).toBeNull();
  });
});
