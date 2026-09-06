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
    // Page $0900 is the first bootstrap page boot0 loads via BTRDSEC — nonzero
    // here means the boot PROM's slot-16/BTRDSEC handoff (see diskII.ts) is
    // working, not just the initial sector-0 shortcut.
    expect(machine.memory.read(0x0900)).not.toBe(0);
  });
});
