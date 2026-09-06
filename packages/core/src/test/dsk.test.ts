import { describe, expect, it } from "vitest";
import { DISK_IMAGE_SIZE, SECTOR_SIZE, parseDsk, writeDsk } from "../disk/dsk.js";

describe("dsk parse/write", () => {
  it("round-trips a DOS-order .dsk image through parseDsk/writeDsk", () => {
    const bytes = new Uint8Array(DISK_IMAGE_SIZE);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7 + 3) & 0xff;
    const image = parseDsk(bytes, "dsk");
    const roundTripped = writeDsk(image);
    expect(Array.from(roundTripped)).toEqual(Array.from(bytes));
  });

  it("round-trips a ProDOS-order .po image", () => {
    const bytes = new Uint8Array(DISK_IMAGE_SIZE);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 13 + 5) & 0xff;
    const image = parseDsk(bytes, "po");
    const roundTripped = writeDsk(image);
    expect(Array.from(roundTripped)).toEqual(Array.from(bytes));
  });

  it("rejects a wrong-sized image", () => {
    expect(() => parseDsk(new Uint8Array(100), "dsk")).toThrow();
  });

  it("actually reorders sectors for .dsk (DOS order) vs identity for .po", () => {
    const bytes = new Uint8Array(DISK_IMAGE_SIZE);
    // Mark logical sector 1 of track 0 distinctly.
    bytes.fill(0xaa, 1 * SECTOR_SIZE, 2 * SECTOR_SIZE);
    const dosImage = parseDsk(bytes, "dsk");
    const poImage = parseDsk(bytes, "po");
    // DOS order maps logical sector 1 -> physical sector 0xD (13); .po is identity (physical 1).
    expect(dosImage.tracks[0]!.subarray(0xd * SECTOR_SIZE, 0xe * SECTOR_SIZE)[0]).toBe(0xaa);
    expect(poImage.tracks[0]!.subarray(1 * SECTOR_SIZE, 2 * SECTOR_SIZE)[0]).toBe(0xaa);
  });
});
