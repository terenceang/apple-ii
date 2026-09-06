import { describe, expect, it } from "vitest";
import { Memory } from "../memory/memory.js";
import { Speaker } from "../audio/speaker.js";

describe("Speaker", () => {
  it("any access to $C030 (read or write) records an edge at the current cycle", () => {
    const memory = new Memory();
    const speaker = new Speaker();
    speaker.attach(memory);

    speaker.currentCycle = 100;
    memory.read(0xc030);
    speaker.currentCycle = 250;
    memory.write(0xc030, 0);
    expect(speaker.edgeCycles).toEqual([100, 250]);
  });

  it("renderFrame replays edges as a waveform with correct channel/polarity", () => {
    const memory = new Memory();
    const speaker = new Speaker();
    speaker.attach(memory);

    // 4 samples per 17048-cycle frame -> sample boundaries at cycles 0, 4262, 8524, 12786.
    // Toggle at cycle 0 (level goes high) and at 8524 (back low): samples 0-1 high, 2-3 low.
    memory.read(0xc030);
    speaker.currentCycle = 8524;
    memory.read(0xc030);

    const samples = speaker.renderFrame(4, 17048);
    expect(samples.length).toBe(8); // interleaved stereo
    // first pair of frames: positive level (~+0.25 through the DC blocker)
    expect(samples[0]).toBeGreaterThan(0.2);
    expect(samples[1]).toBeGreaterThan(0.2);
    expect(samples[2]).toBeGreaterThan(0.2);
    // after the second edge: negative (~-0.25)
    expect(samples[4]).toBeLessThan(-0.2);
    expect(samples[6]).toBeLessThan(-0.2);
    // left and right channels carry identical samples
    expect(samples[0]).toBeCloseTo(samples[1], 5);
    expect(samples[4]).toBeCloseTo(samples[5], 5);
    // edges consumed
    expect(speaker.edgeCycles.length).toBe(0);
  });

  it("renderFrame with no edges outputs a flat, near-silent frame and resets state", () => {
    const speaker = new Speaker();
    const samples = speaker.renderFrame(8, 17048);
    expect(samples.length).toBe(16);
    for (const v of samples) expect(Math.abs(v)).toBeLessThanOrEqual(1);
  });

  it("reset clears edges and cycle counter", () => {
    const memory = new Memory();
    const speaker = new Speaker();
    speaker.attach(memory);
    memory.read(0xc030);
    speaker.reset();
    expect(speaker.edgeCycles).toEqual([]);
    expect(speaker.currentCycle).toBe(0);
  });
});
