import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { encodeIndexedFramePng } from "../png.js";

const PALETTE: readonly (readonly [number, number, number])[] = [
  [0, 0, 0],
  [255, 255, 255],
  [1, 2, 3],
];

function parseChunks(png: Buffer): { type: string; data: Uint8Array }[] {
  const chunks: { type: string; data: Uint8Array }[] = [];
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    chunks.push({ type, data: png.subarray(offset + 8, offset + 8 + length) });
    offset += 12 + length; // length + type + data + crc
  }
  return chunks;
}

describe("encodeIndexedFramePng", () => {
  const pixels = Uint8Array.from([0, 1, 2, 1, 0, 2]); // 3x2
  const png = encodeIndexedFramePng(pixels, 3, 2, PALETTE);

  it("starts with the PNG signature and ends with an empty IEND", () => {
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const chunks = parseChunks(png);
    expect(chunks.map((c) => c.type)).toEqual(["IHDR", "IDAT", "IEND"]);
    expect(chunks[2]!.data.length).toBe(0);
  });

  it("writes a correct 8-bit truecolor IHDR", () => {
    const ihdr = Buffer.from(parseChunks(png)[0]!.data);
    expect(ihdr.readUInt32BE(0)).toBe(3); // width
    expect(ihdr.readUInt32BE(4)).toBe(2); // height
    expect(ihdr[8]).toBe(8); // bit depth
    expect(ihdr[9]).toBe(2); // color type: truecolor
    expect(ihdr[10]).toBe(0); // compression: deflate
    expect(ihdr[11]).toBe(0); // filter method
    expect(ihdr[12]).toBe(0); // no interlace
  });

  it("IDAT inflates to filter-byte-0 RGB scanlines mapped through the palette", () => {
    const raw = inflateSync(parseChunks(png)[1]!.data);
    // row 0: filter 0 + pixels 0,1,2 as RGB; row 1: filter 0 + pixels 1,0,2
    expect([...raw]).toEqual([
      0, 0, 0, 0, 255, 255, 255, 1, 2, 3, //
      0, 255, 255, 255, 0, 0, 0, 1, 2, 3,
    ]);
  });

  it("encodes a single pixel frame without off-by-one truncation", () => {
    const one = encodeIndexedFramePng(Uint8Array.from([2]), 1, 1, PALETTE);
    const raw = inflateSync(parseChunks(one)[1]!.data);
    expect([...raw]).toEqual([0, 1, 2, 3]);
  });
});
