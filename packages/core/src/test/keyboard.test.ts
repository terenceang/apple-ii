import { describe, expect, it } from "vitest";
import { Memory } from "../memory/memory.js";
import { Keyboard } from "../io/keyboard.js";

describe("Keyboard", () => {
  it("latches the last key pressed with the strobe bit at $C000", () => {
    const memory = new Memory();
    const kb = new Keyboard();
    kb.attach(memory);

    kb.setKey(0x41, true);
    expect(memory.read(0xc000)).toBe(0xc1); // bit7 (strobe) | 'A'
    kb.setKey(0x42, true);
    expect(memory.read(0xc000)).toBe(0xc2); // latest key wins
  });

  it("reading $C010 clears the strobe and reports any-key-down in bit7", () => {
    const memory = new Memory();
    const kb = new Keyboard();
    kb.attach(memory);

    kb.setKey(0x42, true);
    const afterClear = memory.read(0xc010);
    expect(afterClear).toBe(0xc2); // key still held: bit7 set, latch value preserved
    expect(memory.read(0xc000)).toBe(0x42); // strobe cleared: bit7 gone

    kb.setKey(0x42, false);
    expect(memory.read(0xc010)).toBe(0x42); // released: bit7 clear
  });

  it("writing $C010 also clears the strobe", () => {
    const memory = new Memory();
    const kb = new Keyboard();
    kb.attach(memory);

    kb.setKey(0x43, true);
    memory.write(0xc010, 0x00);
    expect(memory.read(0xc000)).toBe(0x43);
  });

  it("key-up events do not clobber the latch while another key is down", () => {
    const memory = new Memory();
    const kb = new Keyboard();
    kb.attach(memory);

    kb.setKey(0x41, true);
    kb.setKey(0x42, true);
    kb.setKey(0x41, false); // releasing the older key must not relatch it
    expect(memory.read(0xc000)).toBe(0xc2);
  });

  it("triggerNmi invokes the onBreak hook", () => {
    const kb = new Keyboard();
    let nmiCount = 0;
    kb.onBreak = () => nmiCount++;
    kb.triggerNmi();
    kb.triggerNmi();
    expect(nmiCount).toBe(2);
  });
});
