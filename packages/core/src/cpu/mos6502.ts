import {
  FLAG_BREAK,
  FLAG_CARRY,
  FLAG_DECIMAL,
  FLAG_IRQ_DISABLE,
  FLAG_NEGATIVE,
  FLAG_OVERFLOW,
  FLAG_UNUSED,
  FLAG_ZERO,
} from "./flags.js";
import type { Bus } from "./types.js";

const NMI_VECTOR = 0xfffa;
const RESET_VECTOR = 0xfffc;
const IRQ_VECTOR = 0xfffe;

/**
 * Cycle-stepped NMOS 6502 (documented opcodes only — no illegal/undocumented
 * instructions). One `step()` call executes exactly one instruction and
 * returns the number of clock cycles it took, including the +1 page-cross
 * and +1/+2 branch-taken penalties real hardware applies.
 */
export class Mos6502 {
  a = 0;
  x = 0;
  y = 0;
  s = 0xfd;
  pc = 0;
  p = FLAG_UNUSED | FLAG_IRQ_DISABLE;

  irqPending = false;
  nmiPending = false;

  constructor(private readonly bus: Bus) {}

  reset(): void {
    this.s = 0xfd;
    this.p = FLAG_UNUSED | FLAG_IRQ_DISABLE;
    this.pc = this.read16(RESET_VECTOR);
  }

  private read8(addr: number): number {
    return this.bus.read(addr & 0xffff) & 0xff;
  }

  private write8(addr: number, value: number): void {
    this.bus.write(addr & 0xffff, value & 0xff);
  }

  private read16(addr: number): number {
    const lo = this.read8(addr);
    const hi = this.read8((addr + 1) & 0xffff);
    return (hi << 8) | lo;
  }

  private push8(v: number): void {
    this.write8(0x0100 + this.s, v);
    this.s = (this.s - 1) & 0xff;
  }

  private pop8(): number {
    this.s = (this.s + 1) & 0xff;
    return this.read8(0x0100 + this.s);
  }

  private push16(v: number): void {
    this.push8((v >> 8) & 0xff);
    this.push8(v & 0xff);
  }

  private pop16(): number {
    const lo = this.pop8();
    const hi = this.pop8();
    return (hi << 8) | lo;
  }

  private setFlag(flag: number, on: boolean): void {
    this.p = on ? this.p | flag : this.p & ~flag;
  }

  private setZN(v: number): void {
    this.p = v & 0xff ? this.p & ~FLAG_ZERO : this.p | FLAG_ZERO;
    this.p = v & 0x80 ? this.p | FLAG_NEGATIVE : this.p & ~FLAG_NEGATIVE;
  }

  // ---- addressing modes: each advances pc past its operand bytes ----

  private immediate(): number {
    const addr = this.pc;
    this.pc = (this.pc + 1) & 0xffff;
    return addr;
  }

  private zp(): number {
    return this.read8(this.immediate());
  }

  private zpx(): number {
    return (this.zp() + this.x) & 0xff;
  }

  private zpy(): number {
    return (this.zp() + this.y) & 0xff;
  }

  private abs(): number {
    const lo = this.read8(this.immediate());
    const hi = this.read8(this.immediate());
    return (hi << 8) | lo;
  }

  private lastPageCrossed = false;

  private absIndexed(reg: number): number {
    const base = this.abs();
    const addr = (base + reg) & 0xffff;
    this.lastPageCrossed = (base & 0xff00) !== (addr & 0xff00);
    return addr;
  }

  private indirectX(): number {
    const zpAddr = (this.zp() + this.x) & 0xff;
    const lo = this.read8(zpAddr);
    const hi = this.read8((zpAddr + 1) & 0xff);
    return (hi << 8) | lo;
  }

  private indirectY(): number {
    const zpAddr = this.zp();
    const lo = this.read8(zpAddr);
    const hi = this.read8((zpAddr + 1) & 0xff);
    const base = (hi << 8) | lo;
    const addr = (base + this.y) & 0xffff;
    this.lastPageCrossed = (base & 0xff00) !== (addr & 0xff00);
    return addr;
  }

  /** JMP (indirect) reproduces the famous page-wrap hardware bug. */
  private indirectJmp(): number {
    const ptr = this.abs();
    const lo = this.read8(ptr);
    const hi = this.read8((ptr & 0xff00) | ((ptr + 1) & 0xff));
    return (hi << 8) | lo;
  }

  // ---- ALU helpers ----

  private adc(value: number): void {
    if (this.p & FLAG_DECIMAL) {
      let lo = (this.a & 0x0f) + (value & 0x0f) + (this.p & FLAG_CARRY ? 1 : 0);
      let hi = (this.a >> 4) + (value >> 4);
      if (lo > 9) {
        lo += 6;
        hi += 1;
      }
      const bin = this.a + value + (this.p & FLAG_CARRY ? 1 : 0);
      this.setFlag(FLAG_OVERFLOW, ((this.a ^ value) & 0x80) === 0 && ((this.a ^ bin) & 0x80) !== 0);
      if (hi > 9) hi += 6;
      this.setFlag(FLAG_CARRY, hi > 15);
      const result = ((hi << 4) | (lo & 0x0f)) & 0xff;
      this.setZN(bin & 0xff);
      this.a = result;
    } else {
      const sum = this.a + value + (this.p & FLAG_CARRY ? 1 : 0);
      this.setFlag(FLAG_OVERFLOW, ((this.a ^ sum) & (value ^ sum) & 0x80) !== 0);
      this.setFlag(FLAG_CARRY, sum > 0xff);
      this.a = sum & 0xff;
      this.setZN(this.a);
    }
  }

  private sbc(value: number): void {
    if (this.p & FLAG_DECIMAL) {
      const carry = this.p & FLAG_CARRY ? 1 : 0;
      const bin = this.a - value - (1 - carry);
      this.setFlag(FLAG_OVERFLOW, ((this.a ^ value) & (this.a ^ bin) & 0x80) !== 0);
      this.setFlag(FLAG_CARRY, bin >= 0);
      this.setZN(bin & 0xff);
      let lo = (this.a & 0x0f) - (value & 0x0f) - (1 - carry);
      let hi = (this.a >> 4) - (value >> 4);
      if (lo < 0) {
        lo -= 6;
        hi -= 1;
      }
      if (hi < 0) hi -= 6;
      this.a = ((hi << 4) | (lo & 0x0f)) & 0xff;
    } else {
      this.adc(value ^ 0xff);
    }
  }

  private cmp(reg: number, value: number): void {
    const result = reg - value;
    this.setFlag(FLAG_CARRY, reg >= value);
    this.setZN(result & 0xff);
  }

  private asl(value: number): number {
    this.setFlag(FLAG_CARRY, (value & 0x80) !== 0);
    const result = (value << 1) & 0xff;
    this.setZN(result);
    return result;
  }

  private lsr(value: number): number {
    this.setFlag(FLAG_CARRY, (value & 0x01) !== 0);
    const result = value >> 1;
    this.setZN(result);
    return result;
  }

  private rol(value: number): number {
    const carryIn = this.p & FLAG_CARRY ? 1 : 0;
    this.setFlag(FLAG_CARRY, (value & 0x80) !== 0);
    const result = ((value << 1) | carryIn) & 0xff;
    this.setZN(result);
    return result;
  }

  private ror(value: number): number {
    const carryIn = this.p & FLAG_CARRY ? 0x80 : 0;
    this.setFlag(FLAG_CARRY, (value & 0x01) !== 0);
    const result = (value >> 1) | carryIn;
    this.setZN(result);
    return result;
  }

  private branch(taken: boolean): number {
    const offsetAddr = this.immediate();
    const offset = this.read8(offsetAddr);
    if (!taken) return 2;
    const signed = offset & 0x80 ? offset - 256 : offset;
    const oldPc = this.pc;
    const newPc = (this.pc + signed) & 0xffff;
    this.pc = newPc;
    return (oldPc & 0xff00) !== (newPc & 0xff00) ? 4 : 3;
  }

  interrupt(vector: number, isBrk: boolean): void {
    this.push16(this.pc);
    const statusByte = isBrk ? this.p | FLAG_UNUSED | FLAG_BREAK : (this.p | FLAG_UNUSED) & ~FLAG_BREAK;
    this.push8(statusByte);
    this.setFlag(FLAG_IRQ_DISABLE, true);
    this.pc = this.read16(vector);
  }

  /** Executes exactly one instruction (or services a pending NMI/IRQ) and returns its cycle count. */
  step(): number {
    if (this.nmiPending) {
      this.nmiPending = false;
      this.interrupt(NMI_VECTOR, false);
      return 7;
    }
    if (this.irqPending && !(this.p & FLAG_IRQ_DISABLE)) {
      this.irqPending = false;
      this.interrupt(IRQ_VECTOR, false);
      return 7;
    }

    this.lastPageCrossed = false;
    const opcode = this.read8(this.pc);
    this.pc = (this.pc + 1) & 0xffff;
    return this.execute(opcode);
  }

  private execute(opcode: number): number {
    switch (opcode) {
      // ---- ADC ----
      case 0x69:
        this.adc(this.read8(this.immediate()));
        return 2;
      case 0x65:
        this.adc(this.read8(this.zp()));
        return 3;
      case 0x75:
        this.adc(this.read8(this.zpx()));
        return 4;
      case 0x6d:
        this.adc(this.read8(this.abs()));
        return 4;
      case 0x7d:
        this.adc(this.read8(this.absIndexed(this.x)));
        return 4 + (this.lastPageCrossed ? 1 : 0);
      case 0x79:
        this.adc(this.read8(this.absIndexed(this.y)));
        return 4 + (this.lastPageCrossed ? 1 : 0);
      case 0x61:
        this.adc(this.read8(this.indirectX()));
        return 6;
      case 0x71:
        this.adc(this.read8(this.indirectY()));
        return 5 + (this.lastPageCrossed ? 1 : 0);

      // ---- AND ----
      case 0x29:
        this.a &= this.read8(this.immediate());
        this.setZN(this.a);
        return 2;
      case 0x25:
        this.a &= this.read8(this.zp());
        this.setZN(this.a);
        return 3;
      case 0x35:
        this.a &= this.read8(this.zpx());
        this.setZN(this.a);
        return 4;
      case 0x2d:
        this.a &= this.read8(this.abs());
        this.setZN(this.a);
        return 4;
      case 0x3d:
        this.a &= this.read8(this.absIndexed(this.x));
        this.setZN(this.a);
        return 4 + (this.lastPageCrossed ? 1 : 0);
      case 0x39:
        this.a &= this.read8(this.absIndexed(this.y));
        this.setZN(this.a);
        return 4 + (this.lastPageCrossed ? 1 : 0);
      case 0x21:
        this.a &= this.read8(this.indirectX());
        this.setZN(this.a);
        return 6;
      case 0x31:
        this.a &= this.read8(this.indirectY());
        this.setZN(this.a);
        return 5 + (this.lastPageCrossed ? 1 : 0);

      // ---- ASL ----
      case 0x0a:
        this.a = this.asl(this.a);
        return 2;
      case 0x06: {
        const addr = this.zp();
        this.write8(addr, this.asl(this.read8(addr)));
        return 5;
      }
      case 0x16: {
        const addr = this.zpx();
        this.write8(addr, this.asl(this.read8(addr)));
        return 6;
      }
      case 0x0e: {
        const addr = this.abs();
        this.write8(addr, this.asl(this.read8(addr)));
        return 6;
      }
      case 0x1e: {
        const addr = this.absIndexed(this.x);
        this.write8(addr, this.asl(this.read8(addr)));
        return 7;
      }

      // ---- branches ----
      case 0x90:
        return this.branch(!(this.p & FLAG_CARRY));
      case 0xb0:
        return this.branch(!!(this.p & FLAG_CARRY));
      case 0xf0:
        return this.branch(!!(this.p & FLAG_ZERO));
      case 0x30:
        return this.branch(!!(this.p & FLAG_NEGATIVE));
      case 0xd0:
        return this.branch(!(this.p & FLAG_ZERO));
      case 0x10:
        return this.branch(!(this.p & FLAG_NEGATIVE));
      case 0x50:
        return this.branch(!(this.p & FLAG_OVERFLOW));
      case 0x70:
        return this.branch(!!(this.p & FLAG_OVERFLOW));

      // ---- BIT ----
      case 0x24: {
        const v = this.read8(this.zp());
        this.setFlag(FLAG_ZERO, (this.a & v) === 0);
        this.setFlag(FLAG_NEGATIVE, (v & 0x80) !== 0);
        this.setFlag(FLAG_OVERFLOW, (v & 0x40) !== 0);
        return 3;
      }
      case 0x2c: {
        const v = this.read8(this.abs());
        this.setFlag(FLAG_ZERO, (this.a & v) === 0);
        this.setFlag(FLAG_NEGATIVE, (v & 0x80) !== 0);
        this.setFlag(FLAG_OVERFLOW, (v & 0x40) !== 0);
        return 4;
      }

      // ---- BRK ----
      case 0x00:
        this.pc = (this.pc + 1) & 0xffff;
        this.interrupt(IRQ_VECTOR, true);
        return 7;

      // ---- flag ops ----
      case 0x18:
        this.setFlag(FLAG_CARRY, false);
        return 2;
      case 0xd8:
        this.setFlag(FLAG_DECIMAL, false);
        return 2;
      case 0x58:
        this.setFlag(FLAG_IRQ_DISABLE, false);
        return 2;
      case 0xb8:
        this.setFlag(FLAG_OVERFLOW, false);
        return 2;
      case 0x38:
        this.setFlag(FLAG_CARRY, true);
        return 2;
      case 0xf8:
        this.setFlag(FLAG_DECIMAL, true);
        return 2;
      case 0x78:
        this.setFlag(FLAG_IRQ_DISABLE, true);
        return 2;

      // ---- CMP ----
      case 0xc9:
        this.cmp(this.a, this.read8(this.immediate()));
        return 2;
      case 0xc5:
        this.cmp(this.a, this.read8(this.zp()));
        return 3;
      case 0xd5:
        this.cmp(this.a, this.read8(this.zpx()));
        return 4;
      case 0xcd:
        this.cmp(this.a, this.read8(this.abs()));
        return 4;
      case 0xdd:
        this.cmp(this.a, this.read8(this.absIndexed(this.x)));
        return 4 + (this.lastPageCrossed ? 1 : 0);
      case 0xd9:
        this.cmp(this.a, this.read8(this.absIndexed(this.y)));
        return 4 + (this.lastPageCrossed ? 1 : 0);
      case 0xc1:
        this.cmp(this.a, this.read8(this.indirectX()));
        return 6;
      case 0xd1:
        this.cmp(this.a, this.read8(this.indirectY()));
        return 5 + (this.lastPageCrossed ? 1 : 0);

      // ---- CPX / CPY ----
      case 0xe0:
        this.cmp(this.x, this.read8(this.immediate()));
        return 2;
      case 0xe4:
        this.cmp(this.x, this.read8(this.zp()));
        return 3;
      case 0xec:
        this.cmp(this.x, this.read8(this.abs()));
        return 4;
      case 0xc0:
        this.cmp(this.y, this.read8(this.immediate()));
        return 2;
      case 0xc4:
        this.cmp(this.y, this.read8(this.zp()));
        return 3;
      case 0xcc:
        this.cmp(this.y, this.read8(this.abs()));
        return 4;

      // ---- DEC ----
      case 0xc6: {
        const addr = this.zp();
        const v = (this.read8(addr) - 1) & 0xff;
        this.write8(addr, v);
        this.setZN(v);
        return 5;
      }
      case 0xd6: {
        const addr = this.zpx();
        const v = (this.read8(addr) - 1) & 0xff;
        this.write8(addr, v);
        this.setZN(v);
        return 6;
      }
      case 0xce: {
        const addr = this.abs();
        const v = (this.read8(addr) - 1) & 0xff;
        this.write8(addr, v);
        this.setZN(v);
        return 6;
      }
      case 0xde: {
        const addr = this.absIndexed(this.x);
        const v = (this.read8(addr) - 1) & 0xff;
        this.write8(addr, v);
        this.setZN(v);
        return 7;
      }

      case 0xca:
        this.x = (this.x - 1) & 0xff;
        this.setZN(this.x);
        return 2;
      case 0x88:
        this.y = (this.y - 1) & 0xff;
        this.setZN(this.y);
        return 2;

      // ---- EOR ----
      case 0x49:
        this.a ^= this.read8(this.immediate());
        this.setZN(this.a);
        return 2;
      case 0x45:
        this.a ^= this.read8(this.zp());
        this.setZN(this.a);
        return 3;
      case 0x55:
        this.a ^= this.read8(this.zpx());
        this.setZN(this.a);
        return 4;
      case 0x4d:
        this.a ^= this.read8(this.abs());
        this.setZN(this.a);
        return 4;
      case 0x5d:
        this.a ^= this.read8(this.absIndexed(this.x));
        this.setZN(this.a);
        return 4 + (this.lastPageCrossed ? 1 : 0);
      case 0x59:
        this.a ^= this.read8(this.absIndexed(this.y));
        this.setZN(this.a);
        return 4 + (this.lastPageCrossed ? 1 : 0);
      case 0x41:
        this.a ^= this.read8(this.indirectX());
        this.setZN(this.a);
        return 6;
      case 0x51:
        this.a ^= this.read8(this.indirectY());
        this.setZN(this.a);
        return 5 + (this.lastPageCrossed ? 1 : 0);

      // ---- INC ----
      case 0xe6: {
        const addr = this.zp();
        const v = (this.read8(addr) + 1) & 0xff;
        this.write8(addr, v);
        this.setZN(v);
        return 5;
      }
      case 0xf6: {
        const addr = this.zpx();
        const v = (this.read8(addr) + 1) & 0xff;
        this.write8(addr, v);
        this.setZN(v);
        return 6;
      }
      case 0xee: {
        const addr = this.abs();
        const v = (this.read8(addr) + 1) & 0xff;
        this.write8(addr, v);
        this.setZN(v);
        return 6;
      }
      case 0xfe: {
        const addr = this.absIndexed(this.x);
        const v = (this.read8(addr) + 1) & 0xff;
        this.write8(addr, v);
        this.setZN(v);
        return 7;
      }

      case 0xe8:
        this.x = (this.x + 1) & 0xff;
        this.setZN(this.x);
        return 2;
      case 0xc8:
        this.y = (this.y + 1) & 0xff;
        this.setZN(this.y);
        return 2;

      // ---- JMP / JSR ----
      case 0x4c:
        this.pc = this.abs();
        return 3;
      case 0x6c:
        this.pc = this.indirectJmp();
        return 5;
      case 0x20: {
        const addr = this.abs();
        this.push16((this.pc - 1) & 0xffff);
        this.pc = addr;
        return 6;
      }

      // ---- LDA ----
      case 0xa9:
        this.a = this.read8(this.immediate());
        this.setZN(this.a);
        return 2;
      case 0xa5:
        this.a = this.read8(this.zp());
        this.setZN(this.a);
        return 3;
      case 0xb5:
        this.a = this.read8(this.zpx());
        this.setZN(this.a);
        return 4;
      case 0xad:
        this.a = this.read8(this.abs());
        this.setZN(this.a);
        return 4;
      case 0xbd:
        this.a = this.read8(this.absIndexed(this.x));
        this.setZN(this.a);
        return 4 + (this.lastPageCrossed ? 1 : 0);
      case 0xb9:
        this.a = this.read8(this.absIndexed(this.y));
        this.setZN(this.a);
        return 4 + (this.lastPageCrossed ? 1 : 0);
      case 0xa1:
        this.a = this.read8(this.indirectX());
        this.setZN(this.a);
        return 6;
      case 0xb1:
        this.a = this.read8(this.indirectY());
        this.setZN(this.a);
        return 5 + (this.lastPageCrossed ? 1 : 0);

      // ---- LDX ----
      case 0xa2:
        this.x = this.read8(this.immediate());
        this.setZN(this.x);
        return 2;
      case 0xa6:
        this.x = this.read8(this.zp());
        this.setZN(this.x);
        return 3;
      case 0xb6:
        this.x = this.read8(this.zpy());
        this.setZN(this.x);
        return 4;
      case 0xae:
        this.x = this.read8(this.abs());
        this.setZN(this.x);
        return 4;
      case 0xbe:
        this.x = this.read8(this.absIndexed(this.y));
        this.setZN(this.x);
        return 4 + (this.lastPageCrossed ? 1 : 0);

      // ---- LDY ----
      case 0xa0:
        this.y = this.read8(this.immediate());
        this.setZN(this.y);
        return 2;
      case 0xa4:
        this.y = this.read8(this.zp());
        this.setZN(this.y);
        return 3;
      case 0xb4:
        this.y = this.read8(this.zpx());
        this.setZN(this.y);
        return 4;
      case 0xac:
        this.y = this.read8(this.abs());
        this.setZN(this.y);
        return 4;
      case 0xbc:
        this.y = this.read8(this.absIndexed(this.x));
        this.setZN(this.y);
        return 4 + (this.lastPageCrossed ? 1 : 0);

      // ---- LSR ----
      case 0x4a:
        this.a = this.lsr(this.a);
        return 2;
      case 0x46: {
        const addr = this.zp();
        this.write8(addr, this.lsr(this.read8(addr)));
        return 5;
      }
      case 0x56: {
        const addr = this.zpx();
        this.write8(addr, this.lsr(this.read8(addr)));
        return 6;
      }
      case 0x4e: {
        const addr = this.abs();
        this.write8(addr, this.lsr(this.read8(addr)));
        return 6;
      }
      case 0x5e: {
        const addr = this.absIndexed(this.x);
        this.write8(addr, this.lsr(this.read8(addr)));
        return 7;
      }

      case 0xea:
        return 2;

      // ---- ORA ----
      case 0x09:
        this.a |= this.read8(this.immediate());
        this.setZN(this.a);
        return 2;
      case 0x05:
        this.a |= this.read8(this.zp());
        this.setZN(this.a);
        return 3;
      case 0x15:
        this.a |= this.read8(this.zpx());
        this.setZN(this.a);
        return 4;
      case 0x0d:
        this.a |= this.read8(this.abs());
        this.setZN(this.a);
        return 4;
      case 0x1d:
        this.a |= this.read8(this.absIndexed(this.x));
        this.setZN(this.a);
        return 4 + (this.lastPageCrossed ? 1 : 0);
      case 0x19:
        this.a |= this.read8(this.absIndexed(this.y));
        this.setZN(this.a);
        return 4 + (this.lastPageCrossed ? 1 : 0);
      case 0x01:
        this.a |= this.read8(this.indirectX());
        this.setZN(this.a);
        return 6;
      case 0x11:
        this.a |= this.read8(this.indirectY());
        this.setZN(this.a);
        return 5 + (this.lastPageCrossed ? 1 : 0);

      // ---- stack ----
      case 0x48:
        this.push8(this.a);
        return 3;
      case 0x08:
        this.push8(this.p | FLAG_UNUSED | FLAG_BREAK);
        return 3;
      case 0x68:
        this.a = this.pop8();
        this.setZN(this.a);
        return 4;
      case 0x28:
        this.p = (this.pop8() & ~FLAG_BREAK) | FLAG_UNUSED;
        return 4;

      // ---- ROL / ROR ----
      case 0x2a:
        this.a = this.rol(this.a);
        return 2;
      case 0x26: {
        const addr = this.zp();
        this.write8(addr, this.rol(this.read8(addr)));
        return 5;
      }
      case 0x36: {
        const addr = this.zpx();
        this.write8(addr, this.rol(this.read8(addr)));
        return 6;
      }
      case 0x2e: {
        const addr = this.abs();
        this.write8(addr, this.rol(this.read8(addr)));
        return 6;
      }
      case 0x3e: {
        const addr = this.absIndexed(this.x);
        this.write8(addr, this.rol(this.read8(addr)));
        return 7;
      }
      case 0x6a:
        this.a = this.ror(this.a);
        return 2;
      case 0x66: {
        const addr = this.zp();
        this.write8(addr, this.ror(this.read8(addr)));
        return 5;
      }
      case 0x76: {
        const addr = this.zpx();
        this.write8(addr, this.ror(this.read8(addr)));
        return 6;
      }
      case 0x6e: {
        const addr = this.abs();
        this.write8(addr, this.ror(this.read8(addr)));
        return 6;
      }
      case 0x7e: {
        const addr = this.absIndexed(this.x);
        this.write8(addr, this.ror(this.read8(addr)));
        return 7;
      }

      // ---- RTI / RTS ----
      case 0x40:
        this.p = (this.pop8() & ~FLAG_BREAK) | FLAG_UNUSED;
        this.pc = this.pop16();
        return 6;
      case 0x60:
        this.pc = (this.pop16() + 1) & 0xffff;
        return 6;

      // ---- SBC ----
      case 0xe9:
        this.sbc(this.read8(this.immediate()));
        return 2;
      case 0xe5:
        this.sbc(this.read8(this.zp()));
        return 3;
      case 0xf5:
        this.sbc(this.read8(this.zpx()));
        return 4;
      case 0xed:
        this.sbc(this.read8(this.abs()));
        return 4;
      case 0xfd:
        this.sbc(this.read8(this.absIndexed(this.x)));
        return 4 + (this.lastPageCrossed ? 1 : 0);
      case 0xf9:
        this.sbc(this.read8(this.absIndexed(this.y)));
        return 4 + (this.lastPageCrossed ? 1 : 0);
      case 0xe1:
        this.sbc(this.read8(this.indirectX()));
        return 6;
      case 0xf1:
        this.sbc(this.read8(this.indirectY()));
        return 5 + (this.lastPageCrossed ? 1 : 0);

      // ---- STA / STX / STY ----
      case 0x85:
        this.write8(this.zp(), this.a);
        return 3;
      case 0x95:
        this.write8(this.zpx(), this.a);
        return 4;
      case 0x8d:
        this.write8(this.abs(), this.a);
        return 4;
      case 0x9d:
        this.write8(this.absIndexed(this.x), this.a);
        return 5;
      case 0x99:
        this.write8(this.absIndexed(this.y), this.a);
        return 5;
      case 0x81:
        this.write8(this.indirectX(), this.a);
        return 6;
      case 0x91:
        this.write8(this.indirectY(), this.a);
        return 6;
      case 0x86:
        this.write8(this.zp(), this.x);
        return 3;
      case 0x96:
        this.write8(this.zpy(), this.x);
        return 4;
      case 0x8e:
        this.write8(this.abs(), this.x);
        return 4;
      case 0x84:
        this.write8(this.zp(), this.y);
        return 3;
      case 0x94:
        this.write8(this.zpx(), this.y);
        return 4;
      case 0x8c:
        this.write8(this.abs(), this.y);
        return 4;

      // ---- register transfers ----
      case 0xaa:
        this.x = this.a;
        this.setZN(this.x);
        return 2;
      case 0xa8:
        this.y = this.a;
        this.setZN(this.y);
        return 2;
      case 0xba:
        this.x = this.s;
        this.setZN(this.x);
        return 2;
      case 0x8a:
        this.a = this.x;
        this.setZN(this.a);
        return 2;
      case 0x9a:
        this.s = this.x;
        return 2;
      case 0x98:
        this.a = this.y;
        this.setZN(this.a);
        return 2;

      default:
        // Unimplemented/illegal opcode: treat as a 2-cycle NOP rather than throwing,
        // so a stray illegal opcode in ROM data doesn't crash the whole machine.
        return 2;
    }
  }
}
