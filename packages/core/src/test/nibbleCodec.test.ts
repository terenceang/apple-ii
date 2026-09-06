import { describe, expect, it } from "vitest";
import {
  SIX_AND_TWO_TABLE,
  decode4and4,
  decode6and2,
  encode4and4,
  encode6and2,
} from "../disk/nibbleCodec.js";

describe("nibbleCodec", () => {
  it("SIX_AND_TWO_TABLE has 64 distinct disk-byte values, all with the high bit set", () => {
    expect(SIX_AND_TWO_TABLE.length).toBe(64);
    expect(new Set(SIX_AND_TWO_TABLE).size).toBe(64);
    for (const b of SIX_AND_TWO_TABLE) expect(b & 0x80).toBeTruthy();
  });

  it("encode6and2/decode6and2 round-trips arbitrary sector data", () => {
    const sector = new Uint8Array(256);
    for (let i = 0; i < 256; i++) sector[i] = (i * 37 + 11) & 0xff;
    const nibbles = encode6and2(sector);
    expect(nibbles.length).toBe(343);
    for (const n of nibbles) expect(n & 0x80).toBeTruthy();
    const decoded = decode6and2(nibbles);
    expect(decoded).not.toBeNull();
    expect(Array.from(decoded!)).toEqual(Array.from(sector));
  });

  it("round-trips an all-zero sector and an all-0xFF sector", () => {
    for (const fill of [0x00, 0xff]) {
      const sector = new Uint8Array(256).fill(fill);
      const decoded = decode6and2(encode6and2(sector));
      expect(Array.from(decoded!)).toEqual(Array.from(sector));
    }
  });

  it("decode6and2 rejects a corrupted checksum", () => {
    const sector = new Uint8Array(256).fill(0x42);
    const nibbles = encode6and2(sector);
    nibbles[342] = nibbles[342] === 0x96 ? 0x97 : 0x96; // corrupt the checksum nibble
    expect(decode6and2(nibbles)).toBeNull();
  });

  it("encode4and4/decode4and4 round-trips every byte value", () => {
    for (let v = 0; v < 256; v++) {
      const [odd, even] = encode4and4(v);
      expect(odd & 0x80).toBeTruthy();
      expect(even & 0x80).toBeTruthy();
      expect(decode4and4(odd, even)).toBe(v);
    }
  });

  // ---- reference-vector tests pinning real DOS 3.3 byte-for-byte layout ----
  // Reference: AppleWin CImageBase::ms_DiskByte / Code62 (source/DiskImageHelper.cpp),
  // independently confirmed by MAME's a2_16sect_format (src/lib/formats/ap2_dsk.cpp).
  it("translate table matches the canonical DOS 3.3 64-byte table", () => {
    expect([...SIX_AND_TWO_TABLE]).toEqual([
      0x96, 0x97, 0x9a, 0x9b, 0x9d, 0x9e, 0x9f, 0xa6, 0xa7, 0xab, 0xac, 0xad, 0xae, 0xaf, 0xb2, 0xb3,
      0xb4, 0xb5, 0xb6, 0xb7, 0xb9, 0xba, 0xbb, 0xbc, 0xbd, 0xbe, 0xbf, 0xcb, 0xcd, 0xce, 0xcf, 0xd3,
      0xd6, 0xd7, 0xd9, 0xda, 0xdb, 0xdc, 0xdd, 0xde, 0xdf, 0xe5, 0xe6, 0xe7, 0xe9, 0xea, 0xeb, 0xec,
      0xed, 0xee, 0xef, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf9, 0xfa, 0xfb, 0xfc, 0xfd, 0xfe, 0xff,
    ]);
  });

  it("an all-zero sector encodes to 343 copies of TABLE[0] (0x96)", () => {
    const out = encode6and2(new Uint8Array(256));
    expect(out.length).toBe(343);
    expect(new Set(out).size).toBe(1);
    expect(out[0]).toBe(0x96);
    expect(out[342]).toBe(0x96);
  });

  it("aux pairs are bit-swapped: s[0] low bits land swapped in stream position 0", () => {
    // s[0]=0x01 -> pair 0b10 (bit0 of the data byte becomes the HIGH bit of the pair).
    // out[0]=TABLE[pair^0], out[1]=TABLE[0^pair] (delayed XOR), everything after decays to TABLE[0].
    for (const [lowBits, expectedPair] of [
      [0x01, 0b10],
      [0x02, 0b01],
      [0x03, 0b11],
    ] as const) {
      const sector = new Uint8Array(256);
      sector[0] = lowBits;
      const out = encode6and2(sector);
      expect(out[0]).toBe(SIX_AND_TWO_TABLE[expectedPair]);
      expect(out[1]).toBe(SIX_AND_TWO_TABLE[expectedPair]);
      expect(out[2]).toBe(0x96);
    }
  });

  it("aux stream is in forward order: s[0x56] and s[0xAC] pairs also land in stream position 0", () => {
    const withMid = new Uint8Array(256);
    withMid[0x56] = 0x01; // second group -> pair<<2 = 0b1000 = 8
    expect(encode6and2(withMid)[0]).toBe(SIX_AND_TWO_TABLE[8]);

    const withTop = new Uint8Array(256);
    withTop[0xac] = 0x01; // third group -> pair<<4 = 0b100000 = 0x20
    expect(encode6and2(withTop)[0]).toBe(SIX_AND_TWO_TABLE[0x20]);
  });

  it("the third aux pair is absent for stream positions 84 and 85 (only 256 bytes exist)", () => {
    // s[255] feeds raw[83]'s top pair; nothing feeds a top pair at raw[84]/raw[85].
    const sector = new Uint8Array(256);
    sector[255] = 0x01;
    const out = encode6and2(sector);
    expect(out[83]).toBe(SIX_AND_TWO_TABLE[0x20]);
    expect(out[84]).toBe(SIX_AND_TWO_TABLE[0x20]); // delayed XOR of the same value
    expect(out[85]).toBe(0x96); // raw[85] top pair stays 0
  });

  it("the checksum slot is the last raw value, un-XORed (AppleWin/MAME convention)", () => {
    const sector = new Uint8Array(256);
    sector[255] = 0xff; // primary raw[341] = 0x3F -> checksum = TABLE[0x3F] = 0xFF
    const out = encode6and2(sector);
    expect(out[342]).toBe(SIX_AND_TWO_TABLE[0x3f]);
  });

  it("encode4and4 matches the canonical address-field bytes for volume 0xFE", () => {
    expect(encode4and4(0xfe)).toEqual([0xff, 0xfe]);
  });
});
