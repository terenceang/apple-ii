import type { Memory } from "../memory/memory.js";

export const KEYBOARD_REPEAT_DELAY_CYCLES = 255_000;
export const KEYBOARD_REPEAT_RATE_CYCLES = 51_000;

/**
 * $C000: bit7 set + low 7 bits = ASCII of the last key pressed (latched until
 * cleared). $C010: any access (read or write) clears the strobe; bit7 of the
 * read reflects whether a key is currently held down.
 */
export class Keyboard {
  private latchedAscii = 0;
  private strobed = false;
  private anyKeyDown = false;
  private readonly heldKeys: number[] = [];
  private repeatTimer = 0;

  /** Called when the Break key is pressed — wired to CPU NMI by the machine. */
  onBreak?: () => void;

  attach(memory: Memory): void {
    const readKbd = (): number => (this.strobed ? 0x80 | this.latchedAscii : this.latchedAscii);
    for (let addr = 0x00; addr <= 0x0f; addr++) {
      memory.registerIoRead(addr, readKbd);
    }
    memory.registerIoRead(0x10, () => this.clearStrobe());
    memory.registerIoWrite(0x10, () => this.clearStrobe());
  }

  reset(): void {
    this.latchedAscii = 0;
    this.strobed = false;
    this.anyKeyDown = false;
    this.heldKeys.length = 0;
    this.repeatTimer = 0;
  }

  private clearStrobe(): number {
    const result = (this.anyKeyDown ? 0x80 : 0) | this.latchedAscii;
    this.strobed = false;
    return result;
  }

  step(cycles: number): void {
    if (!this.anyKeyDown || this.heldKeys.length === 0) return;
    this.repeatTimer -= cycles;
    if (this.repeatTimer <= 0) {
      this.strobed = true;
      this.repeatTimer += KEYBOARD_REPEAT_RATE_CYCLES;
    }
  }

  /** `ascii` is the Apple II key-in code (0-127). */
  setKey(ascii: number, down: boolean): void {
    const code = ascii & 0x7f;
    if (down) {
      const idx = this.heldKeys.indexOf(code);
      if (idx !== -1) this.heldKeys.splice(idx, 1);
      this.heldKeys.push(code);
      this.latchedAscii = code;
      this.strobed = true;
      this.anyKeyDown = true;
      this.repeatTimer = KEYBOARD_REPEAT_DELAY_CYCLES;
    } else {
      const idx = this.heldKeys.indexOf(code);
      if (idx !== -1) this.heldKeys.splice(idx, 1);
      this.anyKeyDown = this.heldKeys.length > 0;
      if (this.heldKeys.length > 0) {
        this.latchedAscii = this.heldKeys[this.heldKeys.length - 1]!;
        this.strobed = true;
        this.repeatTimer = KEYBOARD_REPEAT_RATE_CYCLES;
      } else {
        this.repeatTimer = 0;
      }
    }
  }

  /** Triggers a hardware NMI (Break key on real Apple //e). */
  triggerNmi(): void {
    this.onBreak?.();
  }
}

