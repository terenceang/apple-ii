import type { Memory } from "../memory/memory.js";

/**
 * The Apple II speaker is a single bit toggled by any access to $C030. This
 * class just timestamps each toggle (in CPU cycles since the last frame was
 * drawn); the machine turns those edges into a sample buffer per frame, the
 * same way the ZX project's beeper accumulates ULA-driven edges.
 */
export class DcBlocker {
  private prevIn = 0;
  private prevOut = 0;

  constructor(readonly r = 0.995) {}

  reset(): void {
    this.prevIn = 0;
    this.prevOut = 0;
  }

  process(raw: number): number {
    const y = raw - this.prevIn + this.r * this.prevOut;
    this.prevIn = raw;
    this.prevOut = y;
    return Math.max(-1, Math.min(1, y));
  }
}

export class Speaker {
  private level = false;
  edgeCycles: number[] = [];
  currentCycle = 0;
  private readonly dcBlocker = new DcBlocker();

  reset(): void {
    this.level = false;
    this.edgeCycles = [];
    this.currentCycle = 0;
    this.dcBlocker.reset();
  }

  attach(memory: Memory): void {
    const toggle = (): number => {
      this.level = !this.level;
      this.edgeCycles.push(this.currentCycle);
      return 0;
    };
    memory.registerIoRead(0x30, toggle);
    memory.registerIoWrite(0x30, toggle);
  }

  /** Renders edges recorded this frame into `count` interleaved stereo samples and resets state. */
  renderFrame(count: number, totalCyclesInFrame: number): Float32Array {
    const out = new Float32Array(count * 2);
    // `this.level` is the level *after* all of this frame's edges; walk it back to the
    // level the frame started at so we can replay the edges forward in cycle order.
    let level = this.edgeCycles.length % 2 === 0 ? this.level : !this.level;

    let edgeIndex = 0;
    const cyclesPerSample = totalCyclesInFrame / count;
    for (let i = 0; i < count; i++) {
      const sampleCycle = i * cyclesPerSample;
      while (edgeIndex < this.edgeCycles.length && this.edgeCycles[edgeIndex]! <= sampleCycle) {
        level = !level;
        edgeIndex++;
      }
      const raw = level ? 0.25 : -0.25;
      const v = this.dcBlocker.process(raw);
      out[i * 2] = v;
      out[i * 2 + 1] = v;
    }
    this.edgeCycles = [];
    return out;
  }
}

