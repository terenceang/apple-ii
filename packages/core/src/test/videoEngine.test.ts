import { describe, expect, it } from "vitest";
import { Memory } from "../memory/memory.js";
import { ColorIndex } from "../video/palette.js";
import { SCREEN_WIDTH, SCREEN_WIDTH_80, VideoState, renderFrame } from "../video/videoEngine.js";

describe("videoEngine", () => {
  it("renders a normal-attribute character as white-on-black using the built-in font", () => {
    const memory = new Memory();
    memory.write(0x0400, 0xc1); // normal 'A' (0xC1 & 0x7F = 0x41 = 'A')
    const state = new VideoState();
    state.textMode = true;
    const frame = renderFrame(memory, state, false);
    // Row 0 of 'A' is ".###." -> with a 1px margin at screen col0, the glyph's 5 columns
    // land at screen cols 1-5, so cols 2,3,4 are lit and cols 0,1,5,6 are not.
    const rowOffset = 0 * SCREEN_WIDTH;
    expect(frame[rowOffset + 0]).toBe(ColorIndex.Black);
    expect(frame[rowOffset + 1]).toBe(ColorIndex.Black);
    expect(frame[rowOffset + 2]).toBe(ColorIndex.White);
    expect(frame[rowOffset + 3]).toBe(ColorIndex.White);
    expect(frame[rowOffset + 4]).toBe(ColorIndex.White);
    expect(frame[rowOffset + 5]).toBe(ColorIndex.Black);
  });

  it("renders an inverse-attribute character with polarity flipped", () => {
    const memory = new Memory();
    // byte 0x00 -> index6=0 -> ascii 0x20 (space), inverse (bits7:6=00). An all-blank
    // glyph inverted should paint the whole cell white.
    memory.write(0x0400, 0x00);
    const state = new VideoState();
    state.textMode = true;
    const frame = renderFrame(memory, state, false);
    for (let col = 0; col < 7; col++) {
      expect(frame[col]).toBe(ColorIndex.White);
    }
  });

  it("renders LORES blocks using the low/high nibble split for top/bottom half", () => {
    const memory = new Memory();
    memory.write(0x0400, 0xf0); // low nibble 0 (top half), high nibble 0xF=15 (bottom half)
    const state = new VideoState();
    state.textMode = false;
    state.hiresMode = false;
    const frame = renderFrame(memory, state, false);
    expect(frame[0 * SCREEN_WIDTH + 0]).toBe(0); // scanline 0 -> top half -> low nibble (0)
    expect(frame[4 * SCREEN_WIDTH + 0]).toBe(15); // scanline 4 -> bottom half -> high nibble (15)
  });

  it("renders HIRES: an isolated set bit gets a color, adjacent set bits merge to white", () => {
    const memory = new Memory();
    // Hires line 0 base is $2000 exactly (group 0, subgroup 0, section 0).
    memory.write(0x2000, 0b00000100); // bit 2 set in isolation, group bit (bit7) clear
    memory.write(0x2001, 0b00000011); // two adjacent bits set (bits 0,1) -> should merge white
    const state = new VideoState();
    state.textMode = false;
    state.hiresMode = true;
    const frame = renderFrame(memory, state, false);
    expect(frame[2]).not.toBe(ColorIndex.Black);
    expect(frame[2]).not.toBe(ColorIndex.White);
    expect(frame[7]).toBe(ColorIndex.White);
    expect(frame[8]).toBe(ColorIndex.White);
  });

  it("renders 80-column text at 560px width, interleaving main and aux banks", () => {
    const memory = new Memory();
    // Main text page ($0400): put 'A' (0xC1) at row 0, col 0
    memory.write(0x0400, 0xc1);
    // Aux text page ($0800): put 'B' (0xC2) at row 0, col 0 (will appear as column 1)
    memory.writeAux(0x0800, 0xc2);
    const state = new VideoState();
    state.textMode = true;
    state.col80 = true;
    const frame = renderFrame(memory, state, false);
    // Frame should be 560px wide
    expect(frame.length).toBe(SCREEN_WIDTH_80 * 192);
    // Column 0 (main bank) should have 'A' glyph
    const rowOffset = 0;
    // Column 1 (aux bank) should have 'B' glyph
    // Both should be visible as white pixels at different column positions
    expect(frame[rowOffset + 3]).toBe(ColorIndex.White); // 'A' glyph lit pixel
    expect(frame[rowOffset + 10]).toBe(ColorIndex.White); // 'B' glyph lit pixel
  });

  it("falls back to 280px when col80 is false", () => {
    const memory = new Memory();
    memory.write(0x0400, 0xc1);
    const state = new VideoState();
    state.textMode = true;
    state.col80 = false;
    const frame = renderFrame(memory, state, false);
    expect(frame.length).toBe(SCREEN_WIDTH * 192);
  });
});
