import type { Bus } from "../cpu/types.js";
import {
  IO_START,
  LC_START,
  LC_UPPER_SIZE,
  ROM_SIZE,
  ROM_SIZE_BASIC_MONITOR,
  ROM_SIZE_COMBINED_32K,
} from "./constants.js";

export type IoReadHandler = (addr: number) => number;
export type IoWriteHandler = (addr: number, value: number) => void;

/**
 * Apple //e memory management unit: 64K main RAM, 64K auxiliary RAM,
 * the real 16K motherboard ROM image mapped to $C100-$FFFF (only that range
 * is ever addressable — $C000-$C0FF is hardwired I/O regardless of the ROM
 * chip's content there), the $D000-$FFFF language card (16K RAM, bank-
 * switchable in the $D000-$DFFF window, overlaying the fixed ROM), and the
 * $C000-$C0FF soft-switch I/O space dispatched to devices registered by the
 * machine.
 *
 * Auxiliary (aux) 64K bank switching (80STORE/RAMRD/RAMWRT/ALTZP) is
 * implemented for 80-column text mode. When 80STORE is enabled, reads/writes
 * to $0400-$07FF and $0800-$0BFF (text pages) are automatically routed to
 * aux memory. RAMRD/RAMWRT provide general-purpose read/write routing for
 * the $0200-$BFFF range, and ALTZP switches zero-page ($00-$FF) and stack
 * ($0100-$01FF) to aux. INTCXROM/SLOTC3ROM are not implemented — no card
 * ROMs are emulated, so $C100-$CFFF always reads the motherboard ROM's own
 * content there, except where a slot overlay has been installed.
 */
export class Memory implements Bus {
  readonly ram = new Uint8Array(0x10000);
  readonly ramAux = new Uint8Array(0x10000);
  private rom = new Uint8Array(ROM_SIZE);

  // Language card RAM: two independent 4K banks for $D000-$DFFF, plus one shared 8K for $E000-$FFFF.
  private lcBank1 = new Uint8Array(0x1000);
  private lcBank2 = new Uint8Array(0x1000);
  private lcUpper = new Uint8Array(LC_UPPER_SIZE);

  private lcReadRam = false;
  private lcWriteEnabled = false;
  private lcPrewrite = false;
  private lcBankSelect: 1 | 2 = 2;

  // Auxiliary memory bank-switching state (80STORE / RAMRD / RAMWRT / ALTZP).
  private store80 = false;
  private ramrd = false;
  private ramwrt = false;
  private altzp = false;

  private readonly ioReaders = new Array<IoReadHandler | undefined>(256);
  private readonly ioWriters = new Array<IoWriteHandler | undefined>(256);

  /**
   * Static byte overlays for the $C100-$CFFF slot-ROM window (e.g. an
   * original, from-scratch Disk II boot stub at $C600) — these take
   * priority over the motherboard ROM's own content there, since no
   * peripheral card ROMs are otherwise emulated at all.
   */
  private readonly slotOverlay = new Map<number, number>();
  private readonly slotOverlayReaders = new Map<number, IoReadHandler>();

  installSlotOverlay(baseAddr: number, bytes: number[]): void {
    bytes.forEach((b, i) => this.slotOverlay.set(baseAddr + i, b));
  }

  registerSlotOverlayRead(addr: number, handler: IoReadHandler): void {
    this.slotOverlayReaders.set(addr, handler);
  }

  loadRom(bytes: Uint8Array): void {
    if (bytes.length === ROM_SIZE_COMBINED_32K) {
      this.rom.set(bytes.subarray(ROM_SIZE)); // second 16KB half is the real $C000-$FFFF image
      return;
    }
    if (bytes.length === ROM_SIZE) {
      this.rom.set(bytes);
      return;
    }
    if (bytes.length === ROM_SIZE_BASIC_MONITOR) {
      this.rom.fill(0);
      this.rom.set(bytes, LC_START - IO_START); // $D000-$FFFF only; $C100-$CFFF reads as 0
      return;
    }
    throw new Error(
      `Expected a ${ROM_SIZE}-byte ROM image, a ${ROM_SIZE_BASIC_MONITOR}-byte $D000-$FFFF-only ` +
        `image, or a ${ROM_SIZE_COMBINED_32K}-byte combined dump — got ${bytes.length} bytes.`,
    );
  }

  registerIoRead(addrLow: number, handler: IoReadHandler): void {
    this.ioReaders[addrLow] = handler;
  }

  registerIoWrite(addrLow: number, handler: IoWriteHandler): void {
    this.ioWriters[addrLow] = handler;
  }

  /** Registers the auxiliary memory bank-switching soft-switch handlers ($C000-$C009). */
  attach(): void {
    const setWrite = (addrLow: number, apply: () => void): void => {
      this.registerIoWrite(addrLow, () => {
        apply();
      });
    };
    // $C000-$C009 are write-only switches on Apple //e; reads access the keyboard latch ($C000-$C00F).
    setWrite(0x00, () => (this.store80 = false));
    setWrite(0x01, () => (this.store80 = true));
    setWrite(0x02, () => (this.ramrd = false));
    setWrite(0x03, () => (this.ramrd = true));
    setWrite(0x04, () => (this.ramwrt = false));
    setWrite(0x05, () => (this.ramwrt = true));
    setWrite(0x06, () => {});
    setWrite(0x07, () => {});
    setWrite(0x08, () => (this.altzp = false));
    setWrite(0x09, () => (this.altzp = true));
    this.registerIoRead(0x13, () => (this.ramrd ? 0x80 : 0));
    this.registerIoRead(0x14, () => (this.ramwrt ? 0x80 : 0));
    this.registerIoRead(0x18, () => (this.store80 ? 0x80 : 0));
    this.registerIoRead(0x1c, () => (this.altzp ? 0x80 : 0));
  }

  reset(): void {
    this.lcReadRam = false;
    this.lcWriteEnabled = false;
    this.lcPrewrite = false;
    this.lcBankSelect = 2;
    this.store80 = false;
    this.ramrd = false;
    this.ramwrt = false;
    this.altzp = false;
  }

  private handleLcSoftSwitch(addr: number, isWrite: boolean): void {
    const mode = addr & 0x03;
    this.lcBankSelect = addr & 0x08 ? 1 : 2;
    this.lcReadRam = mode === 0 || mode === 3;
    const wantsWriteEnable = mode === 1 || mode === 3;

    if (isWrite) {
      // A write access never itself enables LC writes (only a repeated *read* does);
      // it does immediately disable them if this switch selects a read-only mode.
      this.lcPrewrite = false;
      if (!wantsWriteEnable) this.lcWriteEnabled = false;
      return;
    }

    if (wantsWriteEnable) {
      if (this.lcPrewrite) this.lcWriteEnabled = true;
      this.lcPrewrite = true;
    } else {
      this.lcPrewrite = false;
      this.lcWriteEnabled = false;
    }
  }

  /** Reads from main RAM only (bypasses bank-switching). Used by the video engine for 80-col rendering. */
  readMain(addr: number): number {
    return this.ram[addr & 0xffff]!;
  }

  /** Reads from auxiliary RAM only (bypasses bank-switching). Used by the video engine for 80-col rendering. */
  readAux(addr: number): number {
    return this.ramAux[addr & 0xffff]!;
  }

  /** Writes to auxiliary RAM only (bypasses bank-switching). Used for test setup. */
  writeAux(addr: number, value: number): void {
    this.ramAux[addr & 0xffff] = value & 0xff;
  }

  read(addr: number): number {
    addr &= 0xffff;
    if (addr < 0xc000) {
      // Aux memory bank-switching: 80STORE overrides RAMRD for text pages.
      if (this.store80 && ((addr >= 0x0400 && addr <= 0x07ff) || (addr >= 0x0800 && addr <= 0x0bff))) {
        return this.ramAux[addr]!;
      }
      if (this.altzp && addr < 0x0200) {
        return this.ramAux[addr]!;
      }
      if (this.ramrd && addr >= 0x0200 && addr < 0xc000) {
        return this.ramAux[addr]!;
      }
      return this.ram[addr]!;
    }
    if (addr <= 0xc0ff) {
      if (addr >= 0xc080 && addr <= 0xc08f) {
        this.handleLcSoftSwitch(addr, false);
        return 0;
      }
      const handler = this.ioReaders[addr - 0xc000];
      return handler ? handler(addr) : 0;
    }
    if (addr < 0xd000) {
      const overlayReader = this.slotOverlayReaders.get(addr);
      if (overlayReader) return overlayReader(addr);
      const overlayByte = this.slotOverlay.get(addr);
      if (overlayByte !== undefined) return overlayByte;
      return this.rom[addr - 0xc000]!;
    }
    if (addr < 0xe000) {
      if (this.lcReadRam) {
        const bank = this.lcBankSelect === 1 ? this.lcBank1 : this.lcBank2;
        return bank[addr - 0xd000]!;
      }
      return this.rom[addr - 0xc000]!;
    }
    if (this.lcReadRam) return this.lcUpper[addr - 0xe000]!;
    return this.rom[addr - 0xc000]!;
  }

  /** Serializes everything a save-state needs: main RAM, aux RAM, LC RAM banks, LC + aux soft-switch state. */
  serialize(): Uint8Array {
    const out = new Uint8Array(0x10000 + 0x10000 + 0x1000 + 0x1000 + LC_UPPER_SIZE + 8);
    let offset = 0;
    out.set(this.ram, offset);
    offset += 0x10000;
    out.set(this.ramAux, offset);
    offset += 0x10000;
    out.set(this.lcBank1, offset);
    offset += 0x1000;
    out.set(this.lcBank2, offset);
    offset += 0x1000;
    out.set(this.lcUpper, offset);
    offset += LC_UPPER_SIZE;
    out[offset++] = this.lcReadRam ? 1 : 0;
    out[offset++] = this.lcWriteEnabled ? 1 : 0;
    out[offset++] = this.lcPrewrite ? 1 : 0;
    out[offset++] = this.lcBankSelect;
    out[offset++] = this.store80 ? 1 : 0;
    out[offset++] = this.ramrd ? 1 : 0;
    out[offset++] = this.ramwrt ? 1 : 0;
    out[offset++] = this.altzp ? 1 : 0;
    return out;
  }

  restore(data: Uint8Array): void {
    let offset = 0;
    this.ram.set(data.subarray(offset, offset + 0x10000));
    offset += 0x10000;
    this.ramAux.set(data.subarray(offset, offset + 0x10000));
    offset += 0x10000;
    this.lcBank1.set(data.subarray(offset, offset + 0x1000));
    offset += 0x1000;
    this.lcBank2.set(data.subarray(offset, offset + 0x1000));
    offset += 0x1000;
    this.lcUpper.set(data.subarray(offset, offset + LC_UPPER_SIZE));
    offset += LC_UPPER_SIZE;
    this.lcReadRam = data[offset++] === 1;
    this.lcWriteEnabled = data[offset++] === 1;
    this.lcPrewrite = data[offset++] === 1;
    this.lcBankSelect = data[offset] === 1 ? 1 : 2;
    offset++;
    // v2: aux memory bank-switching state (present in new save states, absent in v1)
    if (offset < data.length) {
      this.store80 = data[offset++] === 1;
      this.ramrd = data[offset++] === 1;
      this.ramwrt = data[offset++] === 1;
      this.altzp = data[offset++] === 1;
    } else {
      this.store80 = false;
      this.ramrd = false;
      this.ramwrt = false;
      this.altzp = false;
    }
  }

  write(addr: number, value: number): void {
    addr &= 0xffff;
    value &= 0xff;
    if (addr < 0xc000) {
      // Aux memory bank-switching: 80STORE overrides RAMWRT for text pages.
      if (this.store80 && ((addr >= 0x0400 && addr <= 0x07ff) || (addr >= 0x0800 && addr <= 0x0bff))) {
        this.ramAux[addr] = value;
        return;
      }
      if (this.altzp && addr < 0x0200) {
        this.ramAux[addr] = value;
        return;
      }
      if (this.ramwrt && addr >= 0x0200 && addr < 0xc000) {
        this.ramAux[addr] = value;
        return;
      }
      this.ram[addr] = value;
      return;
    }
    if (addr <= 0xc0ff) {
      if (addr >= 0xc080 && addr <= 0xc08f) {
        this.handleLcSoftSwitch(addr, true);
        return;
      }
      this.ioWriters[addr - 0xc000]?.(addr, value);
      return;
    }
    if (addr < 0xd000) return; // slot ROM space is read-only in this emulator
    if (!this.lcWriteEnabled) return;
    if (addr < 0xe000) {
      const bank = this.lcBankSelect === 1 ? this.lcBank1 : this.lcBank2;
      bank[addr - 0xd000] = value;
      return;
    }
    this.lcUpper[addr - 0xe000] = value;
  }
}
