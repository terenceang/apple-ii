import type { Memory } from "../memory/memory.js";

/**
 * $C000: bit7 set + low 7 bits = ASCII of the last key pressed (latched until
 * cleared). $C010: any access (read or write) clears the strobe; bit7 of the
 * read reflects whether a key is currently held down.
 */
export class Keyboard {
  private latchedAscii = 0;
  private strobed = false;
  private anyKeyDown = false;

  /** Called when the Break key is pressed — wired to CPU NMI by the machine. */
  onBreak?: () => void;

  attach(memory: Memory): void {
    memory.registerIoRead(0x00, () => (this.strobed ? 0x80 | this.latchedAscii : this.latchedAscii));
    memory.registerIoRead(0x10, () => this.clearStrobe());
    memory.registerIoWrite(0x10, () => this.clearStrobe());
  }

  private clearStrobe(): number {
    const result = (this.anyKeyDown ? 0x80 : 0) | this.latchedAscii;
    this.strobed = false;
    return result;
  }

  /** `ascii` is the Apple II key-in code (0-127); ignored on key-up except to clear anyKeyDown. */
  setKey(ascii: number, down: boolean): void {
    this.anyKeyDown = down;
    if (down) {
      this.latchedAscii = ascii & 0x7f;
      this.strobed = true;
    }
  }

  /** Triggers a hardware NMI (Break key on real Apple //e). */
  triggerNmi(): void {
    this.onBreak?.();
  }
}
