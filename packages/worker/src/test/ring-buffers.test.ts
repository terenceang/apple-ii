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
  function makeRing(capacity: number): AudioRing {
    const buffer = new SharedArrayBuffer(AUDIO_HEADER_INT32_LENGTH * 4 + capacity * 4);
    return new AudioRing(buffer, capacity);
  }

  it("reports the write count and advances the write index", () => {
    const ring = makeRing(16);
    expect(ring.write(Float32Array.from([1, 2, 3, 4]))).toBe(4);
    expect(ring.write(Float32Array.from([5, 6]))).toBe(2);
  });

  it("caps writes to the available free space, staying even-sized", () => {
    const ring = makeRing(8); // capacity 8 -> 7 usable slots -> 6 usable evenly
    const count = ring.write(new Float32Array(20).fill(1));
    expect(count).toBe(6);
  });
});
