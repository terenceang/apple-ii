import { describe, expect, it } from "vitest";
import { Memory } from "../memory/memory.js";
import { ROM_SIZE, ROM_SIZE_BASIC_MONITOR, ROM_SIZE_COMBINED_32K } from "../memory/constants.js";

function makeRom(fillByte: number): Uint8Array {
  return new Uint8Array(ROM_SIZE).fill(fillByte);
}

describe("Memory (Apple //e MMU)", () => {
  it("accepts a 32KB combined dump, using only its second 16KB half", () => {
    const mem = new Memory();
    const combined = new Uint8Array(ROM_SIZE_COMBINED_32K);
    combined.fill(0x11, 0, ROM_SIZE); // first half: should be ignored
    combined.fill(0x22, ROM_SIZE); // second half: the real ROM
    mem.loadRom(combined);
    expect(mem.read(0xd000)).toBe(0x22);
    expect(mem.read(0xffff)).toBe(0x22);
  });

  it("also accepts a 12KB $D000-$FFFF-only ROM, zero-filling $C100-$CFFF", () => {
    const mem = new Memory();
    mem.loadRom(new Uint8Array(ROM_SIZE_BASIC_MONITOR).fill(0x99));
    expect(mem.read(0xc100)).toBe(0x00);
    expect(mem.read(0xd000)).toBe(0x99);
    expect(mem.read(0xffff)).toBe(0x99);
  });

  it("rejects a ROM image that's neither 16KB nor 12KB", () => {
    const mem = new Memory();
    expect(() => mem.loadRom(new Uint8Array(100))).toThrow();
  });

  it("reads the $C100-$CFFF slot ROM window as open bus by default, straight ROM once INTCXROM is on", () => {
    const mem = new Memory();
    mem.attach();
    const rom = makeRom(0x00);
    rom[0x100] = 0x11; // $C100
    rom[0xfff] = 0x22; // $CFFF
    mem.loadRom(rom);
    // No card in any slot, and INTCXROM off (the reset default): open bus.
    expect(mem.read(0xc100)).toBe(0x00);
    expect(mem.read(0xcfff)).toBe(0x00);
    // INTCXROM on ($C007): motherboard ROM shadows the whole window.
    mem.write(0xc007, 0);
    expect(mem.read(0xc100)).toBe(0x11);
    expect(mem.read(0xcfff)).toBe(0x22);
  });

  it("$C300-$C3FF always reads straight ROM — no slot 3 card is ever emulated", () => {
    const mem = new Memory();
    mem.attach();
    const rom = makeRom(0x00);
    rom[0x300] = 0x33; // $C300
    mem.loadRom(rom);
    expect(mem.read(0xc300)).toBe(0x33);
  });

  it("reads ROM at $D000-$FFFF by default after reset", () => {
    const mem = new Memory();
    mem.loadRom(makeRom(0xaa));
    mem.reset();
    expect(mem.read(0xd000)).toBe(0xaa);
    expect(mem.read(0xffff)).toBe(0xaa);
  });

  it("writes to $D000-$FFFF are ignored until the LC write-enable sequence runs", () => {
    const mem = new Memory();
    mem.loadRom(makeRom(0x00));
    mem.reset();
    mem.write(0xd000, 0x42);
    expect(mem.read(0xd000)).toBe(0x00); // still ROM, write was dropped

    // $C08B: mode 3 (read RAM, write-enable) bank 1 — requires two consecutive reads.
    mem.read(0xc08b);
    mem.read(0xc08b);
    mem.write(0xd000, 0x42);
    expect(mem.read(0xd000)).toBe(0x42); // now reading LC RAM bank 1
  });

  it("keeps LC bank 1 and bank 2 independent for $D000-$DFFF", () => {
    const mem = new Memory();
    mem.loadRom(makeRom(0x00));
    mem.reset();

    mem.read(0xc08b); // bank 1, mode 3 (RAM read + pending write-enable)
    mem.read(0xc08b);
    mem.write(0xd123, 0x11);

    mem.read(0xc083); // bank 2, mode 3
    mem.read(0xc083);
    mem.write(0xd123, 0x22);

    mem.read(0xc08b);
    mem.read(0xc08b);
    expect(mem.read(0xd123)).toBe(0x11);

    mem.read(0xc083);
    mem.read(0xc083);
    expect(mem.read(0xd123)).toBe(0x22);
  });

  it("a single read to an odd LC switch does not enable writes (needs two in a row)", () => {
    const mem = new Memory();
    mem.loadRom(makeRom(0x00));
    mem.reset();
    mem.read(0xc081); // only one read
    mem.write(0xd000, 0x99);
    expect(mem.read(0xd000)).toBe(0x00); // ROM still, write was dropped
  });

  it("main RAM below $C000 is plain flat memory", () => {
    const mem = new Memory();
    mem.write(0x0300, 0x55);
    expect(mem.read(0x0300)).toBe(0x55);
  });

  it("dispatches $C000-$C0FF reads/writes to registered I/O handlers", () => {
    const mem = new Memory();
    let written: number | null = null;
    mem.registerIoRead(0x30, () => 0x77); // $C030
    mem.registerIoWrite(0x30, (_addr, v) => {
      written = v;
    });
    expect(mem.read(0xc030)).toBe(0x77);
    mem.write(0xc030, 0x1);
    expect(written).toBe(0x1);
  });

  it("routes zero-page and stack to auxiliary RAM when ALTZP is on ($C009) and main RAM when off ($C008)", () => {
    const mem = new Memory();
    mem.attach();
    mem.reset();

    expect(mem.read(0xc016)).toBe(0x00);

    mem.write(0x0040, 0x11);
    mem.write(0x0150, 0x22);
    expect(mem.read(0x0040)).toBe(0x11);
    expect(mem.read(0x0150)).toBe(0x22);

    mem.write(0xc009, 0);
    expect(mem.read(0xc016)).toBe(0x80);
    expect(mem.read(0x0040)).toBe(0x00);
    expect(mem.read(0x0150)).toBe(0x00);

    mem.write(0x0040, 0xaa);
    mem.write(0x0150, 0xbb);
    expect(mem.read(0x0040)).toBe(0xaa);
    expect(mem.read(0x0150)).toBe(0xbb);

    mem.write(0xc008, 0);
    expect(mem.read(0xc016)).toBe(0x00);
    expect(mem.read(0x0040)).toBe(0x11);
    expect(mem.read(0x0150)).toBe(0x22);
  });

  it("reads auxiliary status soft switches at $C013-$C018", () => {
    const mem = new Memory();
    mem.attach();
    mem.reset();

    expect(mem.read(0xc013)).toBe(0x00);
    expect(mem.read(0xc014)).toBe(0x00);
    expect(mem.read(0xc015)).toBe(0x00);
    expect(mem.read(0xc016)).toBe(0x00);
    expect(mem.read(0xc018)).toBe(0x00);

    mem.write(0xc003, 0);
    expect(mem.read(0xc013)).toBe(0x80);
    mem.write(0xc002, 0);
    expect(mem.read(0xc013)).toBe(0x00);

    mem.write(0xc005, 0);
    expect(mem.read(0xc014)).toBe(0x80);
    mem.write(0xc004, 0);
    expect(mem.read(0xc014)).toBe(0x00);

    mem.write(0xc007, 0);
    expect(mem.read(0xc015)).toBe(0x80);
    mem.write(0xc006, 0);
    expect(mem.read(0xc015)).toBe(0x00);

    mem.write(0xc001, 0);
    expect(mem.read(0xc018)).toBe(0x80);
    mem.write(0xc000, 0);
    expect(mem.read(0xc018)).toBe(0x00);
  });
});
