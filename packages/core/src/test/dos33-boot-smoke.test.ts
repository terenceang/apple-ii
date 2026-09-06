import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AppleIIe } from "../machines/appleIIe.js";
import { parseDsk } from "../disk/dsk.js";
import { dumpScreenText, typeString } from "./testSupport.js";

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

  it("boots DOS 3.3 completely to the Applesoft prompt and turns motor off", () => {
    const machine = new AppleIIe();
    machine.loadRom(new Uint8Array(readFileSync(romPath)));
    machine.insertDisk(parseDsk(new Uint8Array(readFileSync(diskPath)), "dsk"));
    machine.reset();

    // Booting DOS 3.3: loads boot0, boot1, boot2 (relocates DOS to high RAM),
    // seeks to track 17 (VTOC), loads catalog, runs HELLO, and returns to prompt.
    for (let i = 0; i < 7000; i++) machine.runFrame();

    expect(machine.disk.isMotorOn).toBe(false);

    // Verify screen text has booted to DOS 3.3 and Applesoft ']' prompt
    const screenText = dumpScreenText(machine);
    expect(screenText).toContain("DOS VERSION 3.3");
    expect(screenText).toContain("]");
  });

  it("recognizes CATALOG as a DOS command and lists the disk's files", () => {
    const machine = new AppleIIe();
    machine.loadRom(new Uint8Array(readFileSync(romPath)));
    machine.insertDisk(parseDsk(new Uint8Array(readFileSync(diskPath)), "dsk"));
    machine.reset();
    for (let i = 0; i < 7000; i++) machine.runFrame();

    typeString(machine, "CATALOG\n");
    for (let i = 0; i < 300; i++) machine.runFrame();

    const screenText = dumpScreenText(machine);
    expect(screenText).not.toContain("SYNTAX ERROR");
    expect(screenText).toContain("DISK VOLUME");
    expect(screenText).toContain("HELLO");
  });
});

