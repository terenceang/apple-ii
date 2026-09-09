import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AppleIIe, CYCLES_PER_FRAME } from "../machines/appleIIe.js";
import { parseDsk } from "../disk/dsk.js";
import { dumpScreenText, typeString } from "./testSupport.js";

const romPath = join(import.meta.dirname, "../../../../rom/APPLE2E.ROM");
const diskPath = join(import.meta.dirname, "../../../../Disk/DOS33.dsk");
const haveFixtures = existsSync(romPath) && existsSync(diskPath);

// Real NTSC Apple IIe CPU clock for realtime-multiple reporting
const REAL_CPU_HZ = 1_022_727;
// Longest 6502 instruction is 7 cycles, so a frame overshoots CYCLES_PER_FRAME by at most 6
const MAX_OVERSHOOT = 6;

interface CyclesProbe {
  totalCycles: number;
}

const totalCyclesOf = (m: AppleIIe): number => (m as unknown as CyclesProbe).totalCycles;

function report(label: string, frames: number, wallMs: number): void {
  const secs = wallMs / 1000;
  const mhz = (frames * CYCLES_PER_FRAME) / secs / 1e6;
  const realtime = (frames * CYCLES_PER_FRAME) / secs / REAL_CPU_HZ;
  console.log(
    `[bench] ${label.padEnd(16)} ${String(frames).padStart(5)} frames in ${wallMs.toFixed(1)} ms` +
      ` | ${((frames * 1000) / wallMs).toFixed(0)} fps` +
      ` | ${mhz.toFixed(2)} MHz emulated` +
      ` | ${realtime.toFixed(1)}x realtime`,
  );
}

describe.skipIf(!haveFixtures)("speed benchmark — real ROM + real disk", () => {
  it("runs realtime workloads and keeps per-frame cycle timing accurate", () => {
    const machine = new AppleIIe();
    machine.loadRom(new Uint8Array(readFileSync(romPath)));
    machine.insertDisk(parseDsk(new Uint8Array(readFileSync(diskPath)), "dsk"));
    machine.reset();

    // Warmup (JIT + module init), not measured
    for (let i = 0; i < 120; i++) machine.runFrame();

    // 1. Boot DOS 3.3 to the Applesoft prompt (CPU + video + disk seek/load)
    const bootFrames = 7000;
    let t0 = performance.now();
    for (let i = 0; i < bootFrames; i++) machine.runFrame();
    report("DOS 3.3 boot", bootFrames, performance.now() - t0);

    // 2. Idle at the prompt (text video scan + polling loop)
    const idleFrames = 600;
    t0 = performance.now();
    for (let i = 0; i < idleFrames; i++) machine.runFrame();
    report("idle at prompt", idleFrames, performance.now() - t0);

    // 3. CATALOG (disk reads + screen redraw)
    typeString(machine, "CATALOG\n");
    const catFrames = 300;
    t0 = performance.now();
    for (let i = 0; i < catFrames; i++) machine.runFrame();
    report("CATALOG", catFrames, performance.now() - t0);

    // Timing accuracy: every frame must schedule exactly CYCLES_PER_FRAME cycles
    // (plus at most one trailing instruction's overshoot, bounded by MAX_OVERSHOOT),
    // so N frames can never drift vs real hardware.
    const probe = new AppleIIe();
    probe.loadRom(new Uint8Array(readFileSync(romPath)));
    probe.reset();
    const probeFrames = 1000;
    let min = Infinity;
    let max = 0;
    let prev = totalCyclesOf(probe);
    for (let i = 0; i < probeFrames; i++) {
      probe.runFrame();
      const now = totalCyclesOf(probe);
      const per = now - prev;
      if (per < min) min = per;
      if (per > max) max = per;
      prev = now;
    }
    console.log(
      `[bench] frame cycles    min=${min} max=${max} target=${CYCLES_PER_FRAME} ` +
        `(overshoot must be 0..${MAX_OVERSHOOT})`,
    );
    expect(min).toBeGreaterThanOrEqual(CYCLES_PER_FRAME);
    expect(max).toBeLessThanOrEqual(CYCLES_PER_FRAME + MAX_OVERSHOOT);

    // The measured machine finished a real workload (not jammed mid-boot)
    const text = dumpScreenText(machine);
    expect(text).toContain("DISK VOLUME");
    expect(text).toContain("HELLO");
  });
});
