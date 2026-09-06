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
