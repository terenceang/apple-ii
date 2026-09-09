export interface Bus {
  read(addr: number): number;
  write(addr: number, value: number): void;
}

export interface CpuRegisters {
  a: number;
  x: number;
  y: number;
  s: number;
  pc: number;
  p: number;
}

/**
 * The CPU contract the machine drives: run one instruction per step() and
 * report the cycles it consumed (including page-cross/branch penalties).
 * Implemented by Mos6502 (table-driven interpreter) and Cpu6502ts (adapter
 * around the cycle-exact 6502.ts state-machine core).
 */
export interface Cpu extends CpuRegisters {
  irqPending: boolean;
  nmiPending: boolean;
  reset(): void;
  step(): number;
}
