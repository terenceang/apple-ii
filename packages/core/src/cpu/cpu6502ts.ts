import StateMachineCpuModule from "6502.ts/lib/machine/cpu/StateMachineCpu.js";
import type StateMachineCpuClass from "6502.ts/lib/machine/cpu/StateMachineCpu.js";
import type Bus6502ts from "6502.ts/lib/machine/bus/BusInterface.js";
import type Cpu6502tsCore from "6502.ts/lib/machine/cpu/CpuInterface.js";
import type { Bus, Cpu } from "./types.js";

// CJS default-export interop: Node ESM hands us `module.exports` (whose
// `.default` is the class), while bundlers honoring `__esModule` hand us the
// class directly. Resolve both shapes to the constructor.
type StateMachineCpuConstructor = typeof StateMachineCpuClass;
const StateMachineCpu = (StateMachineCpuModule as unknown as Partial<{ default: StateMachineCpuConstructor }>)
  .default ?? (StateMachineCpuModule as unknown as StateMachineCpuConstructor);

// 6502.ts's CpuInterface.ExecutionState is an ambient const enum, which is
// unusable under isolatedModules — these are its compiled numeric values.
const EXEC_FETCH = 1;

/**
 * Adapter exposing the cycle-exact 6502.ts state-machine core through the
 * machine's instruction-stepped Cpu interface. Each step() runs the core's
 * bus-accurate cycle state machine until the next instruction boundary and
 * returns the cycles consumed — including real per-cycle bus traffic (dummy
 * reads, double writes on RMW) that an instruction interpreter never issues.
 */
export class Cpu6502ts implements Cpu {
  private readonly core: Cpu6502tsCore;

  constructor(bus: Bus) {
    const bus6502ts: Bus6502ts = {
      read: (address) => bus.read(address & 0xffff) & 0xff,
      // Our bus has side-effecting I/O on every access, so peek is read.
      peek: (address) => bus.read(address & 0xffff) & 0xff,
      readWord: (address) => {
        const addr = address & 0xffff;
        return bus.read(addr) | (bus.read((addr + 1) & 0xffff) << 8);
      },
      write: (address, value) => bus.write(address & 0xffff, value & 0xff),
      poke: (address, value) => bus.write(address & 0xffff, value & 0xff),
    };
    this.core = new StateMachineCpu(bus6502ts);
  }

  get a(): number {
    return this.core.state.a;
  }
  set a(value: number) {
    this.core.state.a = value & 0xff;
  }
  get x(): number {
    return this.core.state.x;
  }
  set x(value: number) {
    this.core.state.x = value & 0xff;
  }
  get y(): number {
    return this.core.state.y;
  }
  set y(value: number) {
    this.core.state.y = value & 0xff;
  }
  get s(): number {
    return this.core.state.s;
  }
  set s(value: number) {
    this.core.state.s = value & 0xff;
  }
  get pc(): number {
    return this.core.state.p;
  }
  set pc(value: number) {
    this.core.state.p = value & 0xffff;
    // An explicit PC write (test-ROM boot path, save-state restore) replaces
    // the reset vector — cancel the core's pending boot sequence so the next
    // step() fetches at this address instead of re-reading the vector.
    this.core.executionState = EXEC_FETCH;
  }
  get p(): number {
    return this.core.state.flags;
  }
  set p(value: number) {
    this.core.state.flags = value & 0xff;
  }

  /** 6502.ts models IRQ as a line level; the machine only ever raises it. */
  get irqPending(): boolean {
    return this.core.isInterrupt();
  }
  set irqPending(value: boolean) {
    this.core.setInterrupt(value);
  }
  get nmiPending(): boolean {
    return this.core.state.nmi;
  }
  set nmiPending(value: boolean) {
    if (value) this.core.nmi();
  }

  reset(): void {
    this.core.reset();
  }

  step(): number {
    let cycles = 0;
    do {
      this.core.cycle();
      cycles++;
    } while (this.core.executionState !== EXEC_FETCH);
    return cycles;
  }
}
