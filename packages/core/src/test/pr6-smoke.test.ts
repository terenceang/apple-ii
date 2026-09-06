import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AppleIIe } from "../machines/appleIIe.js";
import { typeString } from "./testSupport.js";

const romPath = join(import.meta.dirname, "../../../../rom/APPLE2E.ROM");

function loadRealRom(machine: AppleIIe): void {
  const buf = readFileSync(romPath);
  machine.loadRom(new Uint8Array(buf));
}

describe("PR#6 smoke test — no disk", () => {
  it("drive motor should be on after PR#6 + Enter with no disk", () => {
    const machine = new AppleIIe();
    loadRealRom(machine);
    machine.reset();

    // Let the ROM boot to the Applesoft BASIC prompt
    for (let i = 0; i < 120; i++) machine.runFrame();

    typeString(machine, "PR#6\n");

    // Run several frames for the ROM to process the command
    for (let i = 0; i < 120; i++) machine.runFrame();

    // On real hardware, PR#6 turns the motor on and it spins forever looking
    // for track/sector headers that never come (no disk inserted).
    expect(machine.disk.isMotorOn).toBe(true);
  });

  it("Break (NMI) should stop the motor", () => {
    const machine = new AppleIIe();
    loadRealRom(machine);
    machine.reset();

    for (let i = 0; i < 120; i++) machine.runFrame();

    typeString(machine, "PR#6\n");
    for (let i = 0; i < 120; i++) machine.runFrame();

    expect(machine.disk.isMotorOn).toBe(true);

    // Simulate Break key — triggers NMI, ROM's break handler returns to BASIC
    machine.keyboard.triggerNmi();
    for (let i = 0; i < 120; i++) machine.runFrame();

    expect(machine.disk.isMotorOn).toBe(false);
  });
});
