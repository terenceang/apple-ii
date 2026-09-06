import type { Memory } from "../memory/memory.js";
import { CELL_HEIGHT, CELL_WIDTH, getGlyph } from "./font.js";
import { ColorIndex } from "./palette.js";

export const SCREEN_WIDTH = 280;
export const SCREEN_WIDTH_80 = 560;
export const SCREEN_HEIGHT = 192;
export const TEXT_COLS = 40;
export const TEXT_COLS_80 = 80;
export const TEXT_ROWS = 24;

const TEXT_PAGE1 = 0x0400;
const TEXT_PAGE2 = 0x0800;
const HIRES_PAGE1 = 0x2000;
const HIRES_PAGE2 = 0x4000;

/** Apple II's non-linear text/lores row interleave: 3 groups of 8, spaced $80 apart, $28 per group. */
function textRowAddress(base: number, row: number): number {
  const group = row % 8;
  const section = Math.floor(row / 8);
  return base + group * 0x80 + section * 0x28;
}

/** Hires's deeper 3-level interleave (8 groups of $400, 8 sub-groups of $80, 3 sections of $28). */
function hiresLineAddress(base: number, y: number): number {
  return base + (y & 0x07) * 0x400 + ((y >> 3) & 0x07) * 0x80 + (y >> 6) * 0x28;
}

export class VideoState {
  textMode = true;
  mixedMode = false;
  page2 = false;
  hiresMode = false;
  col80 = false;

  attach(memory: Memory): void {
    const set = (addrLow: number, apply: () => void): void => {
      const handler = (): number => {
        apply();
        return 0;
      };
      memory.registerIoRead(addrLow, handler);
      memory.registerIoWrite(addrLow, handler);
    };
    set(0x50, () => (this.textMode = false));
    set(0x51, () => (this.textMode = true));
    set(0x52, () => (this.mixedMode = false));
    set(0x53, () => (this.mixedMode = true));
    set(0x54, () => (this.page2 = false));
    set(0x55, () => (this.page2 = true));
    set(0x56, () => (this.hiresMode = false));
    set(0x57, () => (this.hiresMode = true));
    // 80-column: $C00C off, $C00D on
    set(0x0c, () => (this.col80 = false));
    set(0x0d, () => (this.col80 = true));
  }
}

function decodeTextByte(byte: number): { ascii: number; inverse: boolean; flash: boolean } {
  if (byte & 0x80) {
    return { ascii: byte & 0x7f, inverse: false, flash: false };
  }
  const ascii = (byte & 0x3f) + 0x20;
  const flash = (byte & 0x40) !== 0;
  return { ascii, inverse: !flash, flash };
}

function drawTextRow(
  memory: Memory,
  out: Uint8Array,
  charRow: number,
  scanline: number,
  base: number,
  flashOn: boolean,
): void {
  const rowAddr = textRowAddress(base, charRow);
  const withinCell = scanline % CELL_HEIGHT;
  const outRowOffset = scanline * SCREEN_WIDTH;
  for (let col = 0; col < TEXT_COLS; col++) {
    const byte = memory.read(rowAddr + col);
    const { ascii, inverse, flash } = decodeTextByte(byte);
    const showInverse = inverse || (flash && flashOn);
    const glyphRow = getGlyph(ascii)[withinCell] ?? 0;
    const outCol = col * CELL_WIDTH;
    for (let bit = 0; bit < CELL_WIDTH; bit++) {
      const pixelOn = ((glyphRow >> (CELL_WIDTH - 1 - bit)) & 1) !== 0;
      const lit = showInverse ? !pixelOn : pixelOn;
      out[outRowOffset + outCol + bit] = lit ? ColorIndex.White : ColorIndex.Black;
    }
  }
}

/** 80-column text: even columns from main text page ($0400), odd columns from aux ($0800). */
function drawTextRow80(
  memory: Memory,
  out: Uint8Array,
  charRow: number,
  scanline: number,
  base: number,
  flashOn: boolean,
): void {
  const mainAddr = textRowAddress(base, charRow);
  const auxAddr = textRowAddress(base + 0x0400, charRow); // aux page is +$0400 from main
  const withinCell = scanline % CELL_HEIGHT;
  const outRowOffset = scanline * SCREEN_WIDTH_80;
  for (let col80 = 0; col80 < TEXT_COLS_80; col80++) {
    const col40 = col80 >> 1;
    const byte = col80 & 1 ? memory.readAux(auxAddr + col40) : memory.readMain(mainAddr + col40);
    const { ascii, inverse, flash } = decodeTextByte(byte);
    const showInverse = inverse || (flash && flashOn);
    const glyphRow = getGlyph(ascii)[withinCell] ?? 0;
    const outCol = col80 * CELL_WIDTH;
    for (let bit = 0; bit < CELL_WIDTH; bit++) {
      const pixelOn = ((glyphRow >> (CELL_WIDTH - 1 - bit)) & 1) !== 0;
      const lit = showInverse ? !pixelOn : pixelOn;
      out[outRowOffset + outCol + bit] = lit ? ColorIndex.White : ColorIndex.Black;
    }
  }
}

function drawLoresRow(memory: Memory, out: Uint8Array, charRow: number, scanline: number, base: number): void {
  const rowAddr = textRowAddress(base, charRow);
  const withinCell = scanline % CELL_HEIGHT;
  const upperHalf = withinCell < 4;
  const outRowOffset = scanline * SCREEN_WIDTH;
  for (let col = 0; col < TEXT_COLS; col++) {
    const byte = memory.read(rowAddr + col);
    const color = upperHalf ? byte & 0x0f : (byte >> 4) & 0x0f;
    const outCol = col * CELL_WIDTH;
    for (let bit = 0; bit < CELL_WIDTH; bit++) out[outRowOffset + outCol + bit] = color;
  }
}

const HIRES_GROUP0: [ColorIndex, ColorIndex] = [ColorIndex.Green, ColorIndex.Violet];
const HIRES_GROUP1: [ColorIndex, ColorIndex] = [ColorIndex.Orange, ColorIndex.MediumBlue];

function drawHiresRow(memory: Memory, out: Uint8Array, y: number, base: number): void {
  const rowAddr = hiresLineAddress(base, y);
  const bits = new Uint8Array(SCREEN_WIDTH);
  const groups = new Uint8Array(SCREEN_WIDTH);
  for (let byteIndex = 0; byteIndex < 40; byteIndex++) {
    const byte = memory.read(rowAddr + byteIndex);
    const group = (byte & 0x80) !== 0 ? 1 : 0;
    for (let bit = 0; bit < 7; bit++) {
      const px = byteIndex * 7 + bit;
      bits[px] = (byte >> bit) & 1;
      groups[px] = group;
    }
  }
  const outRowOffset = y * SCREEN_WIDTH;
  for (let px = 0; px < SCREEN_WIDTH; px++) {
    if (!bits[px]) {
      out[outRowOffset + px] = ColorIndex.Black;
      continue;
    }
    const prevOn = px > 0 && bits[px - 1] === 1;
    const nextOn = px < SCREEN_WIDTH - 1 && bits[px + 1] === 1;
    if (prevOn || nextOn) {
      out[outRowOffset + px] = ColorIndex.White;
      continue;
    }
    const palette = groups[px] === 1 ? HIRES_GROUP1 : HIRES_GROUP0;
    out[outRowOffset + px] = px % 2 === 0 ? palette[0] : palette[1];
  }
}

/** Renders one whole frame from the current memory image (not scanline-timed — see docs on cuts). */
export function renderFrame(memory: Memory, state: VideoState, flashOn: boolean): Uint8Array {
  const is80 = state.col80 && state.textMode;
  const width = is80 ? SCREEN_WIDTH_80 : SCREEN_WIDTH;
  const out = new Uint8Array(width * SCREEN_HEIGHT);
  const textBase = state.page2 ? TEXT_PAGE2 : TEXT_PAGE1;
  const hiresBase = state.page2 ? HIRES_PAGE2 : HIRES_PAGE1;

  for (let y = 0; y < SCREEN_HEIGHT; y++) {
    const charRow = Math.floor(y / CELL_HEIGHT);
    const isTextLine = state.textMode || (state.mixedMode && charRow >= 20);
    if (isTextLine) {
      if (is80) {
        drawTextRow80(memory, out, charRow, y, textBase, flashOn);
      } else {
        drawTextRow(memory, out, charRow, y, textBase, flashOn);
      }
    } else if (state.hiresMode) {
      // Hires is always 280px — center it in a 560px buffer when in 80-col mode
      if (is80) {
        const hiresRow = new Uint8Array(SCREEN_WIDTH);
        drawHiresRow(memory, hiresRow, y, hiresBase);
        const outRowOffset = y * SCREEN_WIDTH_80;
        for (let px = 0; px < SCREEN_WIDTH; px++) {
          out[outRowOffset + px * 2] = hiresRow[px]!;
          out[outRowOffset + px * 2 + 1] = hiresRow[px]!;
        }
      } else {
        drawHiresRow(memory, out, y, hiresBase);
      }
    } else {
      // LORES is always 280px — center it in a 560px buffer when in 80-col mode
      if (is80) {
        const loresRow = new Uint8Array(SCREEN_WIDTH);
        drawLoresRow(memory, loresRow, charRow, y, textBase);
        const outRowOffset = y * SCREEN_WIDTH_80;
        for (let px = 0; px < SCREEN_WIDTH; px++) {
          out[outRowOffset + px * 2] = loresRow[px]!;
          out[outRowOffset + px * 2 + 1] = loresRow[px]!;
        }
      } else {
        drawLoresRow(memory, out, charRow, y, textBase);
      }
    }
  }
  return out;
}
