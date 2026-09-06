import { describe, expect, it } from "vitest";
import { AUDIO_HEADER_INT32_LENGTH, FRAME_HEADER_INT32_LENGTH } from "../protocol.js";
import { AudioRing, FrameRingReader, FrameRingWriter } from "../ring-buffers.js";

describe("FrameRing writer/reader", () => {
  function makePair(w: number, h: number): { writer: FrameRingWriter; reader: FrameRingReader } {
    const buffer = new SharedArrayBuffer(FRAME_HEADER_INT32_LENGTH * 4 + w * h);
    return { writer: new FrameRingWriter(buffer, w, h), reader: new FrameRingReader(buffer, w, h) };
  }

  it("returns null before any write and for repeat reads of the same frame", () => {
    const { writer, reader } = makePair(64, 64);
    expect(reader.read()).toBeNull();
    writer.write(new Uint8Array(64 * 32).fill(7), 64, 32);
    expect(reader.read()).not.toBeNull();
    expect(reader.read()).toBeNull(); // same sequence number
  });

  it("delivers written pixels with correct dimensions", () => {
    const { writer, reader } = makePair(64, 64);
    const pixels = new Uint8Array(64 * 32);
    for (let i = 0; i < pixels.length; i++) pixels[i] = i & 0xff;
    writer.write(pixels, 64, 32);
    const frame = reader.read()!;
    expect(frame.width).toBe(64);
    expect(frame.height).toBe(32);
    expect(Array.from(frame.pixels)).toEqual(Array.from(pixels));
  });

  it("truncates pixel data larger than the buffer's max capacity", () => {
    const { writer, reader } = makePair(64, 64);
    writer.write(new Uint8Array(64 * 64 + 10).fill(3), 64, 64);
    const frame = reader.read()!;
    expect(frame.pixels.length).toBe(64 * 64);
  });

  it("sequence increments per write and force re-reads the latest frame", () => {
    const { writer, reader } = makePair(8, 8);
    writer.write(new Uint8Array(64).fill(1), 8, 8);
    expect(reader.getSequence()).toBe(2);
    expect(reader.read()).not.toBeNull();
    expect(reader.read()).toBeNull();
    expect(reader.read(true)).not.toBeNull(); // force ignores lastSeq
  });
});

describe("AudioRing", () => {
  function makeRing(capacity: number, minBufferSamples: number): AudioRing {
    const buffer = new SharedArrayBuffer(AUDIO_HEADER_INT32_LENGTH * 4 + capacity * 4);
    return new AudioRing(buffer, capacity, minBufferSamples);
  }

  it("outputs silence until the prebuffer threshold is reached", () => {
    const ring = makeRing(64, 8);
    ring.write(Float32Array.from([1, 2, 3, 4])); // below threshold of 8
    const out = new Float32Array(8);
    ring.read(out);
    expect(out.every((v) => v === 0)).toBe(true);

    ring.write(Float32Array.from([5, 6, 7, 8])); // now >= 8 buffered
    ring.read(out);
    expect([...out]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("preserves FIFO order across capacity wraparound", () => {
    const ring = makeRing(16, 1);
    const out = new Float32Array(10);
    ring.write(Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    ring.read(out); // drains 10, indices wrap
    expect([...out]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    ring.write(Float32Array.from([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]));
    ring.read(out);
    expect([...out]).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  });

  it("deinterleaves stereo pairs into left/right outputs", () => {
    const ring = makeRing(64, 2);
    ring.write(Float32Array.from([1, -1, 2, -2, 3, -3, 4, -4])); // L,R,L,R,...
    const left = new Float32Array(4);
    const right = new Float32Array(4);
    ring.readStereo(left, right);
    expect([...left]).toEqual([1, 2, 3, 4]);
    expect([...right]).toEqual([-1, -2, -3, -4]);
  });

  it("drops stale data on overflow, resyncing to the newest minBuffer samples", () => {
    const ring = makeRing(10_000, 100);
    const data = new Float32Array(9000);
    for (let i = 0; i < data.length; i++) data[i] = i;
    ring.write(data); // available 9000 > 8820 -> read side must resync

    const left = new Float32Array(50);
    const right = new Float32Array(50);
    ring.readStereo(left, right);
    // resync keeps exactly minBuffer (100) samples: frames 0..49 = data[8900..8999]
    expect(left[0]).toBe(8900);
    expect(right[0]).toBe(8901);
    expect(left[49]).toBe(8998);
    expect(right[49]).toBe(8999);
  });

  it("underrun after prebuffer outputs silence and re-arms the prebuffer gate", () => {
    const ring = makeRing(64, 4);
    ring.write(Float32Array.from([1, 2, 3, 4]));
    const out = new Float32Array(8);
    ring.read(out); // drains everything
    expect([...out]).toEqual([1, 2, 3, 4, 0, 0, 0, 0]);

    // buffer now empty -> silence, and the next small write is held back again
    ring.read(out);
    expect(out.every((v) => v === 0)).toBe(true);
    ring.write(Float32Array.from([9, 10]));
    ring.read(out);
    expect(out[0]).toBe(0); // 2 < minBuffer 4 -> still silent
  });
});
