import type { Memory } from "../memory/memory.js";

const PADDLE_COUNT = 4;
/** Roughly matches real hardware's ~2.8us/unit RC charge time at a 1.023MHz clock. */
const CYCLES_PER_UNIT = 11;

/**
 * Paddle 0-3 analog inputs ($C064-$C067, bit7 clears when the RC timer
 * expires) plus pushbuttons 0-2 ($C061-$C063, bit7 = pressed). $C070 (any
 * access) restarts the RC timer for all four paddles.
 */
export class Paddle {
  private value = [127, 127, 127, 127];
  private button = [false, false, false];
  private timerStartCycle = [0, 0, 0, 0];
  private getCycle: () => number = () => 0;

  attach(memory: Memory, getCycle: () => number): void {
    this.getCycle = getCycle;
    for (let i = 0; i < PADDLE_COUNT; i++) {
      memory.registerIoRead(0x64 + i, () => this.readPaddle(i));
    }
    for (let i = 0; i < 3; i++) {
      memory.registerIoRead(0x61 + i, () => (this.button[i] ? 0x80 : 0));
    }
    const restart = (): number => {
      const now = this.getCycle();
      for (let i = 0; i < PADDLE_COUNT; i++) this.timerStartCycle[i] = now;
      return 0;
    };
    memory.registerIoRead(0x70, restart);
    memory.registerIoWrite(0x70, restart);
  }

  private readPaddle(index: number): number {
    const elapsed = this.getCycle() - this.timerStartCycle[index]!;
    return elapsed < this.value[index]! * CYCLES_PER_UNIT ? 0x80 : 0;
  }

  /** `value` is 0-255 (analog position), `index` is 0-3. */
  setValue(index: number, value: number): void {
    this.value[index] = Math.max(0, Math.min(255, value));
  }

  setButton(index: number, down: boolean): void {
    this.button[index] = down;
  }
}
