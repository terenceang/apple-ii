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
      memory.registerIo(addrLow, () => {
        apply();
        return 0;
      });
    };
    set(0x50, () => (this.textMode = false));
    set(0x51, () => (this.textMode = true));
    set(0x52, () => (this.mixedMode = false));
    set(0x53, () => (this.mixedMode = true));
    set(0x54, () => (this.page2 = false));
    set(0x55, () => (this.page2 = true));
    set(0x56, () => (this.hiresMode = false));
    set(0x57, () => (this.hiresMode = true));
    // 80-column: $C00C off, $C00D on (write-only on Apple //e; read status at $C01F)
    memory.registerIoWrite(0x0c, () => (this.col80 = false));
    memory.registerIoWrite(0x0d, () => (this.col80 = true));
    memory.registerIoRead(0x1f, () => (this.col80 ? 0x80 : 0));
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

/**
 * Renders one text scanline in 40- or 80-column mode. In 80-column mode even
 * columns come from the main text page and odd columns from aux (+$0400 from
 * main), so only the per-column byte fetch differs between the two modes.
 */
function drawTextRow(
  memory: Memory,
  out: Uint8Array,
  charRow: number,
  scanline: number,
  base: number,
  flashOn: boolean,
  wide: boolean,
): void {
  const mainAddr = textRowAddress(base, charRow);
  const auxAddr = textRowAddress(base + TEXT_PAGE1, charRow);
  const withinCell = scanline % CELL_HEIGHT;
  const cols = wide ? TEXT_COLS_80 : TEXT_COLS;
  const outRowOffset = scanline * (wide ? SCREEN_WIDTH_80 : SCREEN_WIDTH);
  for (let col = 0; col < cols; col++) {
    const byte = wide
      ? col & 1
        ? memory.readAux(auxAddr + (col >> 1))
        : memory.readMain(mainAddr + (col >> 1))
      : memory.read(mainAddr + col);
    const { ascii, inverse, flash } = decodeTextByte(byte);
    const showInverse = inverse || (flash && flashOn);
    const glyphRow = getGlyph(ascii)[withinCell] ?? 0;
    const outCol = outRowOffset + col * CELL_WIDTH;
    for (let bit = 0; bit < CELL_WIDTH; bit++) {
      const pixelOn = ((glyphRow >> (CELL_WIDTH - 1 - bit)) & 1) !== 0;
      const lit = showInverse ? !pixelOn : pixelOn;
      out[outCol + bit] = lit ? ColorIndex.White : ColorIndex.Black;
    }
  }
}

function drawLoresRow(
  memory: Memory,
  out: Uint8Array,
  charRow: number,
  scanline: number,
  base: number,
  wide: boolean,
): void {
  const rowAddr = textRowAddress(base, charRow);
  const withinCell = scanline % CELL_HEIGHT;
  const upperHalf = withinCell < 4;
  // In wide mode the 280px row is centered in a 560px buffer (doubled pixels).
  const outRowOffset = scanline * (wide ? SCREEN_WIDTH_80 : SCREEN_WIDTH);
  for (let col = 0; col < TEXT_COLS; col++) {
    const byte = memory.read(rowAddr + col);
    const color = upperHalf ? byte & 0x0f : (byte >> 4) & 0x0f;
    const outCol = outRowOffset + col * CELL_WIDTH;
    for (let bit = 0; bit < CELL_WIDTH; bit++) {
      if (wide) {
        out[outCol + bit * 2] = color;
        out[outCol + bit * 2 + 1] = color;
      } else {
        out[outCol + bit] = color;
      }
    }
  }
}

const HIRES_GROUP0: [ColorIndex, ColorIndex] = [ColorIndex.Green, ColorIndex.Violet];
const HIRES_GROUP1: [ColorIndex, ColorIndex] = [ColorIndex.Orange, ColorIndex.MediumBlue];

// Per-scanline scratch for the hires decoder, reused across rows and frames
// (renderFrame is single-threaded and consumes a row fully before the next).
const HIRES_BITS = new Uint8Array(SCREEN_WIDTH);
const HIRES_GROUPS = new Uint8Array(SCREEN_WIDTH);

function drawHiresRow(memory: Memory, out: Uint8Array, y: number, base: number, wide: boolean): void {
  const rowAddr = hiresLineAddress(base, y);
  for (let byteIndex = 0; byteIndex < 40; byteIndex++) {
    const byte = memory.read(rowAddr + byteIndex);
    const group = (byte & 0x80) !== 0 ? 1 : 0;
    for (let bit = 0; bit < 7; bit++) {
      const px = byteIndex * 7 + bit;
      HIRES_BITS[px] = (byte >> bit) & 1;
      HIRES_GROUPS[px] = group;
    }
  }
  // In wide mode the 280px row is centered in a 560px buffer (doubled pixels).
  const outRowOffset = y * (wide ? SCREEN_WIDTH_80 : SCREEN_WIDTH);
  for (let px = 0; px < SCREEN_WIDTH; px++) {
    let color: ColorIndex;
    if (!HIRES_BITS[px]) {
      color = ColorIndex.Black;
    } else {
      const prevOn = px > 0 && HIRES_BITS[px - 1] === 1;
      const nextOn = px < SCREEN_WIDTH - 1 && HIRES_BITS[px + 1] === 1;
      if (prevOn || nextOn) {
        color = ColorIndex.White;
      } else {
        const palette = HIRES_GROUPS[px] === 1 ? HIRES_GROUP1 : HIRES_GROUP0;
        color = px % 2 === 0 ? palette[0] : palette[1];
      }
    }
    if (wide) {
      out[outRowOffset + px * 2] = color;
      out[outRowOffset + px * 2 + 1] = color;
    } else {
      out[outRowOffset + px] = color;
    }
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
      drawTextRow(memory, out, charRow, y, textBase, flashOn, is80);
    } else if (state.hiresMode) {
      drawHiresRow(memory, out, y, hiresBase, is80);
    } else {
      drawLoresRow(memory, out, charRow, y, textBase, is80);
    }
  }
  return out;
}
