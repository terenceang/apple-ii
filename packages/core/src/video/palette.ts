/**
 * 16-color indexed palette. Approximate visual colors, not a hardware-exact
 * NTSC decode (documented v1 simplification — see docs on HIRES below).
 * Indices 0-15 double as both the LORES 16-color set and the 4 colors HIRES
 * needs (BLACK/WHITE/GREEN/VIOLET/ORANGE/BLUE, reused from this same table).
 */
export const APPLE_II_PALETTE_RGB: [number, number, number][] = [
  [0x00, 0x00, 0x00], // 0 Black
  [0xad, 0x21, 0x33], // 1 Deep Red / Magenta
  [0x42, 0x2c, 0x8e], // 2 Dark Blue
  [0xe0, 0x37, 0xe0], // 3 Purple / Violet
  [0x2d, 0x63, 0x2d], // 4 Dark Green
  [0x64, 0x64, 0x64], // 5 Gray 1
  [0x1c, 0x9f, 0xe8], // 6 Medium Blue
  [0xa0, 0xd4, 0xf0], // 7 Light Blue / Aqua
  [0x60, 0x4a, 0x1a], // 8 Brown
  [0xe0, 0x60, 0x20], // 9 Orange
  [0x9c, 0x9c, 0x9c], // 10 Gray 2
  [0xf0, 0x90, 0xb0], // 11 Pink
  [0x3c, 0xe0, 0x38], // 12 Green
  [0xe0, 0xe0, 0x30], // 13 Yellow
  [0x60, 0xe0, 0xc0], // 14 Aqua / Cyan
  [0xff, 0xff, 0xff], // 15 White
];

export const enum ColorIndex {
  Black = 0,
  Violet = 3,
  DarkGreen = 4,
  MediumBlue = 6,
  Orange = 9,
  Green = 12,
  White = 15,
}
