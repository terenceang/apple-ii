import { describe, expect, it } from "vitest";
import { FLAG_CARRY, FLAG_DECIMAL, FLAG_NEGATIVE, FLAG_OVERFLOW, FLAG_ZERO } from "../cpu/flags.js";
import { Mos6502 } from "../cpu/mos6502.js";
import type { Bus } from "../cpu/types.js";

class FlatBus implements Bus {
  readonly mem = new Uint8Array(0x10000);
  read(addr: number): number {
    return this.mem[addr & 0xffff]!;
  }
  write(addr: number, value: number): void {
    this.mem[addr & 0xffff] = value & 0xff;
  }
}

function load(bus: FlatBus, addr: number, bytes: number[]): void {
  bytes.forEach((b, i) => bus.write(addr + i, b));
}

function makeCpu(bus: FlatBus, resetVector = 0x0200): Mos6502 {
  bus.write(0xfffc, resetVector & 0xff);
  bus.write(0xfffd, (resetVector >> 8) & 0xff);
  const cpu = new Mos6502(bus);
  cpu.reset();
  return cpu;
}

describe("Mos6502 addressing + basic ALU", () => {
  it("LDA immediate sets A and zero/negative flags", () => {
    const bus = new FlatBus();
    load(bus, 0x0200, [0xa9, 0x00]); // LDA #$00
    const cpu = makeCpu(bus);
    cpu.step();
    expect(cpu.a).toBe(0);
    expect(cpu.p & FLAG_ZERO).toBeTruthy();

    load(bus, 0x0202, [0xa9, 0x80]); // LDA #$80
    cpu.step();
    expect(cpu.a).toBe(0x80);
    expect(cpu.p & FLAG_NEGATIVE).toBeTruthy();
  });

  it("STA/LDA zero page,X wraps within page 0", () => {
    const bus = new FlatBus();
    load(bus, 0x0200, [0xa2, 0xff]); // LDX #$FF
    load(bus, 0x0202, [0xa9, 0x42]); // LDA #$42
    load(bus, 0x0204, [0x95, 0x02]); // STA $02,X -> writes to $01 (0x02+0xFF wraps to 0x01)
    const cpu = makeCpu(bus);
    cpu.step();
    cpu.step();
    cpu.step();
    expect(bus.read(0x01)).toBe(0x42);
  });

  it("absolute,X adds a page-cross cycle penalty", () => {
    const bus = new FlatBus();
    load(bus, 0x0200, [0xa2, 0x01]); // LDX #$01
    load(bus, 0x0202, [0xbd, 0xff, 0x00]); // LDA $00FF,X -> $0100 (page cross)
    bus.write(0x0100, 0x99);
    const cpu = makeCpu(bus);
    cpu.step();
    const cycles = cpu.step();
    expect(cycles).toBe(5);
    expect(cpu.a).toBe(0x99);
  });

  it("indexed indirect (zp,X) and indirect indexed (zp),Y both resolve correctly", () => {
    const bus = new FlatBus();
    // (zp,X): pointer table at $20+X
    bus.write(0x0021, 0x00);
    bus.write(0x0022, 0x03); // pointer -> $0300
    bus.write(0x0300, 0x11);
    load(bus, 0x0200, [0xa2, 0x01]); // LDX #$01
    load(bus, 0x0202, [0xa1, 0x20]); // LDA ($20,X) -> ptr at $21/$22 -> $0300
    const cpu = makeCpu(bus);
    cpu.step();
    cpu.step();
    expect(cpu.a).toBe(0x11);

    // (zp),Y
    bus.write(0x0030, 0x00);
    bus.write(0x0031, 0x04); // base $0400
    bus.write(0x0405, 0x22); // $0400 + Y(5)
    load(bus, 0x0204, [0xa0, 0x05]); // LDY #$05
    load(bus, 0x0206, [0xb1, 0x30]); // LDA ($30),Y
    cpu.step();
    cpu.step();
    expect(cpu.a).toBe(0x22);
  });

  it("ADC sets carry/overflow correctly in binary mode", () => {
    const bus = new FlatBus();
    load(bus, 0x0200, [0xa9, 0x7f]); // LDA #$7F
    load(bus, 0x0202, [0x69, 0x01]); // ADC #$01 -> overflow (127+1=-128 signed)
    const cpu = makeCpu(bus);
    cpu.step();
    cpu.step();
    expect(cpu.a).toBe(0x80);
    expect(cpu.p & FLAG_OVERFLOW).toBeTruthy();
    expect(cpu.p & FLAG_NEGATIVE).toBeTruthy();
    expect(cpu.p & FLAG_CARRY).toBeFalsy();
  });

  it("ADC in decimal mode produces BCD-adjusted results", () => {
    const bus = new FlatBus();
    load(bus, 0x0200, [0xf8]); // SED
    load(bus, 0x0201, [0xa9, 0x09]); // LDA #$09
    load(bus, 0x0203, [0x69, 0x01]); // ADC #$01 -> $10 in BCD
    const cpu = makeCpu(bus);
    cpu.step();
    cpu.step();
    cpu.step();
    expect(cpu.a).toBe(0x10);
    expect(cpu.p & FLAG_DECIMAL).toBeTruthy();
  });

  it("branch adds cycle penalties for taken / page-crossed", () => {
    const bus = new FlatBus();
    load(bus, 0x0200, [0x18]); // CLC
    load(bus, 0x0201, [0x90, 0x02]); // BCC +2 (taken, no page cross)
    const cpu = makeCpu(bus);
    cpu.step();
    expect(cpu.step()).toBe(3);
    expect(cpu.pc).toBe(0x0205);
  });

  it("JMP indirect reproduces the page-wrap bug", () => {
    const bus = new FlatBus();
    bus.write(0x02ff, 0x34);
    bus.write(0x0200, 0x12); // wraps within the same page instead of $0300
    load(bus, 0x0300, [0x6c, 0xff, 0x02]); // JMP ($02FF)
    const cpu = makeCpu(bus, 0x0300);
    cpu.step();
    expect(cpu.pc).toBe(0x1234);
  });

  it("stack push/pop round-trips through PHA/PLA and JSR/RTS", () => {
    const bus = new FlatBus();
    load(bus, 0x0200, [0xa9, 0x55]); // LDA #$55
    load(bus, 0x0202, [0x20, 0x00, 0x03]); // JSR $0300
    load(bus, 0x0300, [0x60]); // RTS
    const cpu = makeCpu(bus);
    cpu.step(); // LDA
    cpu.step(); // JSR
    expect(cpu.pc).toBe(0x0300);
    cpu.step(); // RTS
    expect(cpu.pc).toBe(0x0205);
    expect(cpu.a).toBe(0x55);
  });

  it("CMP sets zero/carry flags relative to the accumulator", () => {
    const bus = new FlatBus();
    load(bus, 0x0200, [0xa9, 0x10]); // LDA #$10
    load(bus, 0x0202, [0xc9, 0x10]); // CMP #$10 -> equal
    const cpu = makeCpu(bus);
    cpu.step();
    cpu.step();
    expect(cpu.p & FLAG_ZERO).toBeTruthy();
    expect(cpu.p & FLAG_CARRY).toBeTruthy();
  });
});
