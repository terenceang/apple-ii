import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Bus } from "../cpu/types.js";
import { Mos6502 } from "../cpu/mos6502.js";

/**
 * Full-opcode CPU exerciser: Klaus Dormann's 6502 functional test
 * (https://github.com/Klaus2m5/6502_65C02_functional_tests, GPLv3).
 *
 * The fixture binary (packages/core/src/cpu/fixtures/6502_functional_test.bin)
 * is a complete 64K image assembled for load at $0000, entry $0400. It tests
 * every documented NMOS 6502 opcode, all addressing modes, and flag behavior
 * (including decimal-mode edge cases). Both error traps and the final success
 * trap are `jmp *` (self-jumps), so the harness detects a stuck PC and asserts
 * it matches this build's success trap at $3469 (13469 decimal) — any other
 * address means the CPU failed at that test's trap.
 */
const SUCCESS_TRAP = 0x3469;

class FlatBus implements Bus {
  readonly mem = new Uint8Array(0x10000);
  read(addr: number): number {
    return this.mem[addr & 0xffff]!;
  }
  write(addr: number, value: number): void {
    this.mem[addr & 0xffff] = value & 0xff;
  }
}

function loadExerciser(): { cpu: Mos6502; bus: FlatBus } {
  const bus = new FlatBus();
  const image = readFileSync(new URL("./fixtures/6502_functional_test.bin", import.meta.url));
  bus.mem.set(image);
  const cpu = new Mos6502(bus);
  cpu.pc = 0x0400;
  return { cpu, bus };
}

describe("Mos6502 Klaus Dormann functional test (all documented opcodes)", () => {
  it(
    "completes the full exerciser and jams at the success trap",
    { timeout: 120_000 },
    () => {
      const { cpu, bus } = loadExerciser();
      const CYCLE_BUDGET = 200_000_000; // full suite is ~100M cycles; generous margin
      let cycles = 0;

      while (cycles < CYCLE_BUDGET) {
        cycles += cpu.step();
        const pc = cpu.pc;
        // Detect `jmp *` (4C lo hi targeting itself) — the test's trap mechanism.
        if (bus.read(pc) === 0x4c && bus.read(pc + 1) === (pc & 0xff) && bus.read(pc + 2) === (pc >> 8)) {
          expect(pc).toBe(SUCCESS_TRAP);
          return;
        }
      }
      throw new Error(`Exerciser did not trap within ${CYCLE_BUDGET} cycles (last pc=$${cpu.pc.toString(16)})`);
    },
  );
});
