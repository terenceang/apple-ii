import { describe, expect, it } from "vitest";
import { arrayBufferToBase64, base64ToArrayBuffer } from "../utils/base64.js";

describe("base64 utils", () => {
  it("round-trips a known string", () => {
    const text = "Apple ][!";
    const encoded = arrayBufferToBase64(new TextEncoder().encode(text).buffer);
    expect(encoded).toBe(btoa(text));
    expect(new TextDecoder().decode(base64ToArrayBuffer(encoded))).toBe(text);
  });

  it("round-trips every byte value 0-255", () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;
    const decoded = new Uint8Array(base64ToArrayBuffer(arrayBufferToBase64(bytes.buffer)));
    expect(Array.from(decoded)).toEqual(Array.from(bytes));
  });

  it("handles the empty buffer", () => {
    expect(arrayBufferToBase64(new ArrayBuffer(0))).toBe("");
    expect(base64ToArrayBuffer("").byteLength).toBe(0);
  });
});
