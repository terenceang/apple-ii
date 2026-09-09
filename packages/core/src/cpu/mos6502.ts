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
import type { Bus, Cpu } from "./types.js";

const NMI_VECTOR = 0xfffa;
const RESET_VECTOR = 0xfffc;
const IRQ_VECTOR = 0xfffe;

/** Addressing modes — see MODE table built from SPEC. */
const enum Mode {
  Imp,
  Acc,
  Imm,
  Zp,
  Zpx,
  Zpy,
  Abs,
  AbsX,
  AbsY,
  Ind,
  IndX,
  IndY,
  Rel,
}

/** Operation identifiers — see OP table built from SPEC. */
const enum Op {
  None,
  Adc,
  And,
  Asl,
  Bit,
  Branch,
  Brk,
  Clc,
  Cld,
  Cli,
  Clv,
  Cmp,
  Cpx,
  Cpy,
  Dec,
  Dex,
  Dey,
  Eor,
  Inc,
  Inx,
  Iny,
  Jmp,
  Jsr,
  Lda,
  Ldx,
  Ldy,
  Lsr,
  Nop,
  Ora,
  Pha,
  Php,
  Pla,
  Plp,
  Rol,
  Ror,
  Rti,
  Rts,
  Sbc,
  Sec,
  Sed,
  Sei,
  Sta,
  Stx,
  Sty,
  Tax,
  Tay,
  Tsx,
  Txa,
  Txs,
  Tya,
}

/**
 * The single source of truth for the whole instruction set: one row per
 * documented opcode — [opcode, operation, addressing mode, base cycles,
 * +1-cycle page-cross penalty]. The CPU's behavior tables (MODE/OP/CYCLE/
 * PENALTY below) are compiled from this list, so cycles, operands and
 * effects are never specified in more than one place.
 */
const SPEC: readonly (readonly [number, Op, Mode, number, 0 | 1])[] = [
  //      opc   op           mode        cyc pen
  [0x69, Op.Adc, Mode.Imm, 2, 0],
  [0x65, Op.Adc, Mode.Zp, 3, 0],
  [0x75, Op.Adc, Mode.Zpx, 4, 0],
  [0x6d, Op.Adc, Mode.Abs, 4, 0],
  [0x7d, Op.Adc, Mode.AbsX, 4, 1],
  [0x79, Op.Adc, Mode.AbsY, 4, 1],
  [0x61, Op.Adc, Mode.IndX, 6, 0],
  [0x71, Op.Adc, Mode.IndY, 5, 1],
  [0x29, Op.And, Mode.Imm, 2, 0],
  [0x25, Op.And, Mode.Zp, 3, 0],
  [0x35, Op.And, Mode.Zpx, 4, 0],
  [0x2d, Op.And, Mode.Abs, 4, 0],
  [0x3d, Op.And, Mode.AbsX, 4, 1],
  [0x39, Op.And, Mode.AbsY, 4, 1],
  [0x21, Op.And, Mode.IndX, 6, 0],
  [0x31, Op.And, Mode.IndY, 5, 1],
  [0x0a, Op.Asl, Mode.Acc, 2, 0],
  [0x06, Op.Asl, Mode.Zp, 5, 0],
  [0x16, Op.Asl, Mode.Zpx, 6, 0],
  [0x0e, Op.Asl, Mode.Abs, 6, 0],
  [0x1e, Op.Asl, Mode.AbsX, 7, 0],
  [0x24, Op.Bit, Mode.Zp, 3, 0],
  [0x2c, Op.Bit, Mode.Abs, 4, 0],
  [0x00, Op.Brk, Mode.Imp, 7, 0],
  [0x10, Op.Branch, Mode.Rel, 2, 0], // BPL
  [0x30, Op.Branch, Mode.Rel, 2, 0], // BMI
  [0x50, Op.Branch, Mode.Rel, 2, 0], // BVC
  [0x70, Op.Branch, Mode.Rel, 2, 0], // BVS
  [0x90, Op.Branch, Mode.Rel, 2, 0], // BCC
  [0xb0, Op.Branch, Mode.Rel, 2, 0], // BCS
  [0xd0, Op.Branch, Mode.Rel, 2, 0], // BNE
  [0xf0, Op.Branch, Mode.Rel, 2, 0], // BEQ
  [0x18, Op.Clc, Mode.Imp, 2, 0],
  [0xd8, Op.Cld, Mode.Imp, 2, 0],
  [0x58, Op.Cli, Mode.Imp, 2, 0],
  [0xb8, Op.Clv, Mode.Imp, 2, 0],
  [0xc9, Op.Cmp, Mode.Imm, 2, 0],
  [0xc5, Op.Cmp, Mode.Zp, 3, 0],
  [0xd5, Op.Cmp, Mode.Zpx, 4, 0],
  [0xcd, Op.Cmp, Mode.Abs, 4, 0],
  [0xdd, Op.Cmp, Mode.AbsX, 4, 1],
  [0xd9, Op.Cmp, Mode.AbsY, 4, 1],
  [0xc1, Op.Cmp, Mode.IndX, 6, 0],
  [0xd1, Op.Cmp, Mode.IndY, 5, 1],
  [0xe0, Op.Cpx, Mode.Imm, 2, 0],
  [0xe4, Op.Cpx, Mode.Zp, 3, 0],
  [0xec, Op.Cpx, Mode.Abs, 4, 0],
  [0xc0, Op.Cpy, Mode.Imm, 2, 0],
  [0xc4, Op.Cpy, Mode.Zp, 3, 0],
  [0xcc, Op.Cpy, Mode.Abs, 4, 0],
  [0xc6, Op.Dec, Mode.Zp, 5, 0],
  [0xd6, Op.Dec, Mode.Zpx, 6, 0],
  [0xce, Op.Dec, Mode.Abs, 6, 0],
  [0xde, Op.Dec, Mode.AbsX, 7, 0],
  [0xca, Op.Dex, Mode.Imp, 2, 0],
  [0x88, Op.Dey, Mode.Imp, 2, 0],
  [0x49, Op.Eor, Mode.Imm, 2, 0],
  [0x45, Op.Eor, Mode.Zp, 3, 0],
  [0x55, Op.Eor, Mode.Zpx, 4, 0],
  [0x4d, Op.Eor, Mode.Abs, 4, 0],
  [0x5d, Op.Eor, Mode.AbsX, 4, 1],
  [0x59, Op.Eor, Mode.AbsY, 4, 1],
  [0x41, Op.Eor, Mode.IndX, 6, 0],
  [0x51, Op.Eor, Mode.IndY, 5, 1],
  [0xe6, Op.Inc, Mode.Zp, 5, 0],
  [0xf6, Op.Inc, Mode.Zpx, 6, 0],
  [0xee, Op.Inc, Mode.Abs, 6, 0],
  [0xfe, Op.Inc, Mode.AbsX, 7, 0],
  [0xe8, Op.Inx, Mode.Imp, 2, 0],
  [0xc8, Op.Iny, Mode.Imp, 2, 0],
  [0x4c, Op.Jmp, Mode.Abs, 3, 0],
  [0x6c, Op.Jmp, Mode.Ind, 5, 0],
  [0x20, Op.Jsr, Mode.Abs, 6, 0],
  [0xa9, Op.Lda, Mode.Imm, 2, 0],
  [0xa5, Op.Lda, Mode.Zp, 3, 0],
  [0xb5, Op.Lda, Mode.Zpx, 4, 0],
  [0xad, Op.Lda, Mode.Abs, 4, 0],
  [0xbd, Op.Lda, Mode.AbsX, 4, 1],
  [0xb9, Op.Lda, Mode.AbsY, 4, 1],
  [0xa1, Op.Lda, Mode.IndX, 6, 0],
  [0xb1, Op.Lda, Mode.IndY, 5, 1],
  [0xa2, Op.Ldx, Mode.Imm, 2, 0],
  [0xa6, Op.Ldx, Mode.Zp, 3, 0],
  [0xb6, Op.Ldx, Mode.Zpy, 4, 0],
  [0xae, Op.Ldx, Mode.Abs, 4, 0],
  [0xbe, Op.Ldx, Mode.AbsY, 4, 1],
  [0xa0, Op.Ldy, Mode.Imm, 2, 0],
  [0xa4, Op.Ldy, Mode.Zp, 3, 0],
  [0xb4, Op.Ldy, Mode.Zpx, 4, 0],
  [0xac, Op.Ldy, Mode.Abs, 4, 0],
  [0xbc, Op.Ldy, Mode.AbsX, 4, 1],
  [0x4a, Op.Lsr, Mode.Acc, 2, 0],
  [0x46, Op.Lsr, Mode.Zp, 5, 0],
  [0x56, Op.Lsr, Mode.Zpx, 6, 0],
  [0x4e, Op.Lsr, Mode.Abs, 6, 0],
  [0x5e, Op.Lsr, Mode.AbsX, 7, 0],
  [0xea, Op.Nop, Mode.Imp, 2, 0],
  [0x09, Op.Ora, Mode.Imm, 2, 0],
  [0x05, Op.Ora, Mode.Zp, 3, 0],
  [0x15, Op.Ora, Mode.Zpx, 4, 0],
  [0x0d, Op.Ora, Mode.Abs, 4, 0],
  [0x1d, Op.Ora, Mode.AbsX, 4, 1],
  [0x19, Op.Ora, Mode.AbsY, 4, 1],
  [0x01, Op.Ora, Mode.IndX, 6, 0],
  [0x11, Op.Ora, Mode.IndY, 5, 1],
  [0x48, Op.Pha, Mode.Imp, 3, 0],
  [0x08, Op.Php, Mode.Imp, 3, 0],
  [0x68, Op.Pla, Mode.Imp, 4, 0],
  [0x28, Op.Plp, Mode.Imp, 4, 0],
  [0x2a, Op.Rol, Mode.Acc, 2, 0],
  [0x26, Op.Rol, Mode.Zp, 5, 0],
  [0x36, Op.Rol, Mode.Zpx, 6, 0],
  [0x2e, Op.Rol, Mode.Abs, 6, 0],
  [0x3e, Op.Rol, Mode.AbsX, 7, 0],
  [0x6a, Op.Ror, Mode.Acc, 2, 0],
  [0x66, Op.Ror, Mode.Zp, 5, 0],
  [0x76, Op.Ror, Mode.Zpx, 6, 0],
  [0x6e, Op.Ror, Mode.Abs, 6, 0],
  [0x7e, Op.Ror, Mode.AbsX, 7, 0],
  [0x40, Op.Rti, Mode.Imp, 6, 0],
  [0x60, Op.Rts, Mode.Imp, 6, 0],
  [0xf8, Op.Sed, Mode.Imp, 2, 0],
  [0xe9, Op.Sbc, Mode.Imm, 2, 0],
  [0xe5, Op.Sbc, Mode.Zp, 3, 0],
  [0xf5, Op.Sbc, Mode.Zpx, 4, 0],
  [0xed, Op.Sbc, Mode.Abs, 4, 0],
  [0xfd, Op.Sbc, Mode.AbsX, 4, 1],
  [0xf9, Op.Sbc, Mode.AbsY, 4, 1],
  [0xe1, Op.Sbc, Mode.IndX, 6, 0],
  [0xf1, Op.Sbc, Mode.IndY, 5, 1],
  [0x38, Op.Sec, Mode.Imp, 2, 0],
  [0x78, Op.Sei, Mode.Imp, 2, 0],
  [0x85, Op.Sta, Mode.Zp, 3, 0],
  [0x95, Op.Sta, Mode.Zpx, 4, 0],
  [0x8d, Op.Sta, Mode.Abs, 4, 0],
  [0x9d, Op.Sta, Mode.AbsX, 5, 0], // fixed 5: no page-cross penalty on stores
  [0x99, Op.Sta, Mode.AbsY, 5, 0],
  [0x81, Op.Sta, Mode.IndX, 6, 0],
  [0x91, Op.Sta, Mode.IndY, 6, 0],
  [0x86, Op.Stx, Mode.Zp, 3, 0],
  [0x96, Op.Stx, Mode.Zpy, 4, 0],
  [0x8e, Op.Stx, Mode.Abs, 4, 0],
  [0x84, Op.Sty, Mode.Zp, 3, 0],
  [0x94, Op.Sty, Mode.Zpx, 4, 0],
  [0x8c, Op.Sty, Mode.Abs, 4, 0],
  [0xaa, Op.Tax, Mode.Imp, 2, 0],
  [0xa8, Op.Tay, Mode.Imp, 2, 0],
  [0xba, Op.Tsx, Mode.Imp, 2, 0],
  [0x8a, Op.Txa, Mode.Imp, 2, 0],
  [0x9a, Op.Txs, Mode.Imp, 2, 0],
  [0x98, Op.Tya, Mode.Imp, 2, 0],
];

const MODE = new Uint8Array(256);
const OP = new Uint8Array(256);
const CYCLE = new Uint8Array(256).fill(2); // undecoded opcodes act as 2-cycle NOPs
const PENALTY = new Uint8Array(256);
for (const [opcode, op, mode, cycles, penalty] of SPEC) {
  MODE[opcode] = mode;
  OP[opcode] = op;
  CYCLE[opcode] = cycles;
  PENALTY[opcode] = penalty;
}

// Branch condition table indexed by (opcode >> 6) & 3; expected state is (opcode >> 5) & 1.
// BPL/BMI -> N, BVC/BVS -> V, BCC/BCS -> C, BNE/BEQ -> Z.
const BRANCH_FLAGS = [FLAG_NEGATIVE, FLAG_OVERFLOW, FLAG_CARRY, FLAG_ZERO];

/**
 * Cycle-stepped NMOS 6502 (documented opcodes only — no illegal/undocumented
 * instructions). One `step()` call executes exactly one instruction and
 * returns the number of clock cycles it took, including the +1 page-cross
 * and +1/+2 branch-taken penalties real hardware applies.
 */
export class Mos6502 implements Cpu {
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

  private operand(mode: Mode): number {
    switch (mode) {
      case Mode.Imm:
        return this.immediate();
      case Mode.Zp:
        return this.zp();
      case Mode.Zpx:
        return this.zpx();
      case Mode.Zpy:
        return this.zpy();
      case Mode.Abs:
      case Mode.AbsX:
      case Mode.AbsY: {
        const reg = mode === Mode.Abs ? 0 : mode === Mode.AbsX ? this.x : this.y;
        return mode === Mode.Abs ? this.abs() : this.absIndexed(reg);
      }
      case Mode.Ind:
        return this.indirectJmp();
      case Mode.IndX:
        return this.indirectX();
      case Mode.IndY:
        return this.indirectY();
      default:
        return 0; // Implied, accumulator, relative: no effective address
    }
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

  /** Read-modify-write shifts/rotates, shared by accumulator and memory forms. */
  private rmw(mode: Mode, op: (v: number) => number, addr: number): void {
    if (mode === Mode.Acc) this.a = op(this.a);
    else this.write8(addr, op(this.read8(addr)));
  }

  // Pre-bound shift/rotate functions so RMW dispatch allocates nothing per instruction.
  private readonly aslOp = (v: number): number => this.asl(v);
  private readonly lsrOp = (v: number): number => this.lsr(v);
  private readonly rolOp = (v: number): number => this.rol(v);
  private readonly rorOp = (v: number): number => this.ror(v);

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
    const mode = MODE[opcode] as Mode;
    const addr = this.operand(mode);
    const cycles = CYCLE[opcode]! + (PENALTY[opcode] === 1 && this.lastPageCrossed ? 1 : 0);

    switch (OP[opcode]) {
      case Op.Adc:
        this.adc(this.read8(addr));
        break;
      case Op.And:
        this.a &= this.read8(addr);
        this.setZN(this.a);
        break;
      case Op.Ora:
        this.a |= this.read8(addr);
        this.setZN(this.a);
        break;
      case Op.Eor:
        this.a ^= this.read8(addr);
        this.setZN(this.a);
        break;
      case Op.Asl:
        this.rmw(mode, this.aslOp, addr);
        break;
      case Op.Lsr:
        this.rmw(mode, this.lsrOp, addr);
        break;
      case Op.Rol:
        this.rmw(mode, this.rolOp, addr);
        break;
      case Op.Ror:
        this.rmw(mode, this.rorOp, addr);
        break;
      case Op.Inc: {
        const v = (this.read8(addr) + 1) & 0xff;
        this.write8(addr, v);
        this.setZN(v);
        break;
      }
      case Op.Dec: {
        const v = (this.read8(addr) - 1) & 0xff;
        this.write8(addr, v);
        this.setZN(v);
        break;
      }
      case Op.Bit: {
        const v = this.read8(addr);
        this.setFlag(FLAG_ZERO, (this.a & v) === 0);
        this.setFlag(FLAG_NEGATIVE, (v & 0x80) !== 0);
        this.setFlag(FLAG_OVERFLOW, (v & 0x40) !== 0);
        break;
      }
      case Op.Branch: {
        const flag = BRANCH_FLAGS[(opcode >> 6) & 3]!;
        const taken = ((this.p & flag) !== 0) === ((opcode & 0x20) !== 0);
        return this.branch(taken);
      }
      case Op.Brk:
        this.pc = (this.pc + 1) & 0xffff;
        this.interrupt(IRQ_VECTOR, true);
        break;
      case Op.Clc:
        this.setFlag(FLAG_CARRY, false);
        break;
      case Op.Sec:
        this.setFlag(FLAG_CARRY, true);
        break;
      case Op.Cli:
        this.setFlag(FLAG_IRQ_DISABLE, false);
        break;
      case Op.Sei:
        this.setFlag(FLAG_IRQ_DISABLE, true);
        break;
      case Op.Clv:
        this.setFlag(FLAG_OVERFLOW, false);
        break;
      case Op.Cld:
        this.setFlag(FLAG_DECIMAL, false);
        break;
      case Op.Sed:
        this.setFlag(FLAG_DECIMAL, true);
        break;
      case Op.Cmp:
        this.cmp(this.a, this.read8(addr));
        break;
      case Op.Cpx:
        this.cmp(this.x, this.read8(addr));
        break;
      case Op.Cpy:
        this.cmp(this.y, this.read8(addr));
        break;
      case Op.Lda:
        this.a = this.read8(addr);
        this.setZN(this.a);
        break;
      case Op.Ldx:
        this.x = this.read8(addr);
        this.setZN(this.x);
        break;
      case Op.Ldy:
        this.y = this.read8(addr);
        this.setZN(this.y);
        break;
      case Op.Sta:
        this.write8(addr, this.a);
        break;
      case Op.Stx:
        this.write8(addr, this.x);
        break;
      case Op.Sty:
        this.write8(addr, this.y);
        break;
      case Op.Inx:
        this.x = (this.x + 1) & 0xff;
        this.setZN(this.x);
        break;
      case Op.Iny:
        this.y = (this.y + 1) & 0xff;
        this.setZN(this.y);
        break;
      case Op.Dex:
        this.x = (this.x - 1) & 0xff;
        this.setZN(this.x);
        break;
      case Op.Dey:
        this.y = (this.y - 1) & 0xff;
        this.setZN(this.y);
        break;
      case Op.Tax:
        this.x = this.a;
        this.setZN(this.x);
        break;
      case Op.Tay:
        this.y = this.a;
        this.setZN(this.y);
        break;
      case Op.Txa:
        this.a = this.x;
        this.setZN(this.a);
        break;
      case Op.Tya:
        this.a = this.y;
        this.setZN(this.a);
        break;
      case Op.Tsx:
        this.x = this.s;
        this.setZN(this.x);
        break;
      case Op.Txs:
        this.s = this.x;
        break;
      case Op.Jmp:
        this.pc = addr;
        break;
      case Op.Jsr: {
        this.push16((this.pc - 1) & 0xffff);
        this.pc = addr;
        break;
      }
      case Op.Pha:
        this.push8(this.a);
        break;
      case Op.Php:
        this.push8(this.p | FLAG_UNUSED | FLAG_BREAK);
        break;
      case Op.Pla:
        this.a = this.pop8();
        this.setZN(this.a);
        break;
      case Op.Plp:
        this.p = (this.pop8() & ~FLAG_BREAK) | FLAG_UNUSED;
        break;
      case Op.Rti:
        this.p = (this.pop8() & ~FLAG_BREAK) | FLAG_UNUSED;
        this.pc = this.pop16();
        break;
      case Op.Rts:
        this.pc = (this.pop16() + 1) & 0xffff;
        break;
      case Op.Sbc:
        this.sbc(this.read8(addr));
        break;
      case Op.Nop:
      case Op.None:
      default:
        // Unimplemented/illegal opcode: treat as a 2-cycle NOP rather than throwing,
        // so a stray illegal opcode in ROM data doesn't crash the whole machine.
        break;
    }
    return cycles;
  }
}
