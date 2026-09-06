import { describe, expect, it } from "vitest";
import { DISK_IMAGE_SIZE, parseDsk } from "../disk/dsk.js";
import { loadState, saveState } from "../state.js";
import { ROM_SIZE } from "../memory/constants.js";
import { AppleIIe } from "../machines/appleIIe.js";

function makeNopRom(resetVector: number): Uint8Array {
  const rom = new Uint8Array(ROM_SIZE).fill(0xea); // NOP
  const vectorOffset = 0xfffc - 0xc000;
  rom[vectorOffset] = resetVector & 0xff;
  rom[vectorOffset + 1] = (resetVector >> 8) & 0xff;
  return rom;
}

describe("AppleIIe machine", () => {
  it("resets into the ROM's reset vector when no disk is inserted", () => {
    const machine = new AppleIIe();
    machine.loadRom(makeNopRom(0xd000));
    machine.reset();
    expect(machine.cpu.pc).toBe(0xd000);
  });

  it("runs a frame of NOPs without crashing and produces a full-size frame buffer", () => {
    const machine = new AppleIIe();
    machine.loadRom(makeNopRom(0xd000));
    machine.reset();
    machine.runFrame();
    const frame = machine.getFrameBuffer();
    expect(frame.pixels.length).toBe(frame.width * frame.height);
    const audio = machine.getStereoAudioSamples(100);
    expect(audio.length).toBe(200);
  });

  it("boots straight from a disk's track0/sector0 when one is inserted at reset", () => {
    const machine = new AppleIIe();
    machine.loadRom(makeNopRom(0xd000));
    const bytes = new Uint8Array(DISK_IMAGE_SIZE);
    bytes[0] = 0x00; // byte at $0800 (unused by convention)
    bytes[1] = 0xa9; // LDA # at $0801, the real entry point
    bytes[2] = 0x42;
    machine.insertDisk(parseDsk(bytes, "po"));
    machine.reset();
    expect(machine.cpu.pc).toBe(0x0801);
    expect(machine.memory.read(0x0801)).toBe(0xa9);
  });

  it("routes keyboard events to $C000 latch with strobe bit", () => {
    const machine = new AppleIIe();
    machine.keyboard.setKey(0x41, true);
    expect(machine.memory.read(0xc000)).toBe(0xc1);
    machine.memory.read(0xc010);
    expect(machine.memory.read(0xc000)).toBe(0x41);
  });

  it("supports inserting and ejecting disk in drive 2 independently", () => {
    const machine = new AppleIIe();
    const disk1 = parseDsk(new Uint8Array(DISK_IMAGE_SIZE), "po");
    const disk2 = parseDsk(new Uint8Array(DISK_IMAGE_SIZE), "po");
    machine.insertDisk(disk1, 0);
    machine.insertDisk(disk2, 1);

    expect(machine.getDisk(0)).toBe(disk1);
    expect(machine.getDisk(1)).toBe(disk2);
    expect(machine.disk.hasDriveMotorActivity(0)).toBe(false);
    expect(machine.disk.hasDriveMotorActivity(1)).toBe(false);

    machine.ejectDisk(1);
    expect(machine.getDisk(0)).toBe(disk1);
    expect(machine.getDisk(1)).toBeNull();
  });
});

describe("save state", () => {
  it("round-trips CPU registers and memory contents", () => {
    const machine = new AppleIIe();
    machine.loadRom(makeNopRom(0xd000));
    machine.reset();
    machine.memory.write(0x1234, 0x77);
    machine.cpu.a = 0x99;
    machine.cpu.pc = 0xd010;

    const blob = saveState(machine);

    machine.memory.write(0x1234, 0x00);
    machine.cpu.a = 0x00;
    machine.cpu.pc = 0xd000;

    loadState(machine, blob);
    expect(machine.memory.read(0x1234)).toBe(0x77);
    expect(machine.cpu.a).toBe(0x99);
    expect(machine.cpu.pc).toBe(0xd010);
  });

  it("rejects a blob with the wrong magic", () => {
    const machine = new AppleIIe();
    expect(() => loadState(machine, new Uint8Array(100))).toThrow();
  });
});
