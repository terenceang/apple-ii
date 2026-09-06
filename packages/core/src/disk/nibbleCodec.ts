/**
 * Apple Disk II "6-and-2" GCR nibble encoding, used by DOS 3.3 and ProDOS to
 * turn a 256-byte sector into a self-clocking stream of disk bytes (each
 * disk byte has its high bit set) that a real RWTS decodes with the exact
 * same table and bit-shuffle this file implements.
 *
 * Layout verified byte-for-byte against two independent, battle-tested
 * reference implementations: AppleWin (`CImageBase::Code62`/`Decode62` in
 * source/DiskImageHelper.cpp) and MAME (`a2_16sect_format` in
 * src/lib/formats/ap2_dsk.cpp). The reference-vector tests alongside this
 * file pin the table and the aux-buffer layout.
 *
 * Real DOS 3.3 layout (all references agree):
 * - raw 6-bit stream position i (0..85) carries the low 2 bits of sector
 *   bytes i, i+0x56 and i+0xAC — each 2-bit pair bit-SWAPPED (bit0 of the
 *   data byte lands in the HIGH bit of the pair) — and the third pair is
 *   absent (zero) for i >= 84 since only 256 bytes exist.
 * - positions 86..341 carry sector bytes 0..255 shifted right by 2.
 * - each written disk byte is TABLE[raw[i] ^ raw[i-1]] (delayed XOR against
 *   the previous RAW value), and the 343rd byte is TABLE[raw[341]] — the
 *   last raw value, un-XORed (this is what real DOS RWTS accepts).
 */

// The 64 disk-byte values valid for 6-and-2 data (each has bit 7 set); this exact
// list (in ascending order) is the standard DOS 3.3 write-translate table.
export const SIX_AND_TWO_TABLE: readonly number[] = [
  0x96, 0x97, 0x9a, 0x9b, 0x9d, 0x9e, 0x9f, 0xa6, 0xa7, 0xab, 0xac, 0xad, 0xae, 0xaf, 0xb2, 0xb3,
  0xb4, 0xb5, 0xb6, 0xb7, 0xb9, 0xba, 0xbb, 0xbc, 0xbd, 0xbe, 0xbf, 0xcb, 0xcd, 0xce, 0xcf, 0xd3,
  0xd6, 0xd7, 0xd9, 0xda, 0xdb, 0xdc, 0xdd, 0xde, 0xdf, 0xe5, 0xe6, 0xe7, 0xe9, 0xea, 0xeb, 0xec,
  0xed, 0xee, 0xef, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf9, 0xfa, 0xfb, 0xfc, 0xfd, 0xfe, 0xff,
];

const REVERSE_TABLE = new Map<number, number>();
SIX_AND_TWO_TABLE.forEach((diskByte, sixBit) => REVERSE_TABLE.set(diskByte, sixBit));

export const DATA_FIELD_NIBBLE_COUNT = 343; // 342 data nibbles + 1 checksum nibble

/** The low 2 bits of a sector byte, swapped as real DOS 3.3 stores them (bit0 -> high bit of the pair). */
function swapPair(b: number): number {
  return ((b & 0x01) << 1) | ((b & 0x02) >> 1);
}

/** Encodes 256 sector bytes into 343 disk-byte nibbles (342 data + checksum), all already table-translated. */
export function encode6and2(sector: Uint8Array): Uint8Array {
  if (sector.length !== 256) throw new Error(`encode6and2 expects 256 bytes, got ${sector.length}`);

  // Raw (untranslated) 6-bit stream: 86 aux values then 256 primary values.
  const raw = new Uint8Array(342);
  for (let i = 0; i < 86; i++) {
    raw[i] = swapPair(sector[i]!) | (swapPair(sector[i + 0x56]!) << 2);
    if (i < 84) raw[i] = raw[i]! | (swapPair(sector[i + 0xac]!) << 4);
  }
  for (let i = 0; i < 256; i++) raw[86 + i] = sector[i]! >> 2;

  let prev = 0;
  const out = new Uint8Array(DATA_FIELD_NIBBLE_COUNT);
  for (let i = 0; i < 342; i++) {
    const r = raw[i]!;
    out[i] = SIX_AND_TWO_TABLE[r ^ prev]!;
    prev = r;
  }
  out[342] = SIX_AND_TWO_TABLE[prev]!;
  return out;
}

/** Reverses encode6and2. Returns null if a disk byte is invalid or the checksum doesn't validate. */
export function decode6and2(nibbles: Uint8Array): Uint8Array | null {
  if (nibbles.length !== DATA_FIELD_NIBBLE_COUNT) return null;

  const raw = new Uint8Array(342);
  let prev = 0;
  for (let i = 0; i < 342; i++) {
    const encoded = REVERSE_TABLE.get(nibbles[i]!);
    if (encoded === undefined) return null;
    const r = encoded ^ prev;
    raw[i] = r;
    prev = r;
  }
  const checksumEncoded = REVERSE_TABLE.get(nibbles[342]!);
  if (checksumEncoded === undefined) return null;
  // The 343rd byte is the last raw value itself, un-delayed (see file docs).
  if (checksumEncoded !== prev) return null;

  const unswap = (pairBits: number): number => ((pairBits & 0x02) >> 1) | ((pairBits & 0x01) << 1);
  const sector = new Uint8Array(256);
  for (let i = 0; i < 86; i++) {
    const v = raw[i]!;
    sector[i] = (raw[86 + i]! << 2) | unswap(v & 0x03);
    sector[i + 0x56] = (raw[86 + i + 0x56]! << 2) | unswap((v >> 2) & 0x03);
    if (i < 84) sector[i + 0xac] = (raw[86 + i + 0xac]! << 2) | unswap((v >> 4) & 0x03);
  }
  return sector;
}

/** "4-and-4" odd-even encoding used for address-field bytes (volume/track/sector/checksum). */
export function encode4and4(value: number): [number, number] {
  return [((value >> 1) & 0x55) | 0xaa, (value & 0x55) | 0xaa];
}

export function decode4and4(oddByte: number, evenByte: number): number {
  return ((oddByte << 1) | 0x01) & evenByte;
}
