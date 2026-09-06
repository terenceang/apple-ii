import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AppleIIe } from "../machines/appleIIe.js";
import { parseDsk } from "../disk/dsk.js";

const romPath = join(import.meta.dirname, "../../../../rom/APPLE2E.ROM");
const diskPath = join(import.meta.dirname, "../../../../Disk/DOS33.dsk");
const haveFixtures = existsSync(romPath) && existsSync(diskPath);

describe.skipIf(!haveFixtures)("DOS 3.3 boot smoke test — real ROM + real disk", () => {
  it("boot0 reads its bootstrap sectors off the disk via BTRDSEC", () => {
    const machine = new AppleIIe();
    machine.loadRom(new Uint8Array(readFileSync(romPath)));
    machine.insertDisk(parseDsk(new Uint8Array(readFileSync(diskPath)), "dsk"));
    machine.reset();

    for (let i = 0; i < 60; i++) machine.runFrame();

    expect(machine.disk.isMotorOn).toBe(true);
    // boot0 computes its first BTRDSEC destination page from this disk's own
    // sector-0 payload ($08FE + $08FF = $36 + $09 = $3F) and stores it in
    // zero page $27 right before each call — see BOOT1 disassembly at
    // https://6502disassembly.com/a2-boot/BOOT1.html. Nonzero here means the
    // boot PROM's slot-16/BTRDSEC handoff (see diskII.ts) is working, not
    // just the initial sector-0 shortcut.
    expect(machine.memory.read(0x3f00)).not.toBe(0);
  });
});
