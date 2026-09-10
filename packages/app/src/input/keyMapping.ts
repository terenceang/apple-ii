/**
 * The Apple II keyboard is a simple ASCII latch (unlike the ZX Spectrum's row/bit
 * matrix), so mapping a browser KeyEvent down to it is much simpler: special keys
 * get a fixed control code, everything else uses the browser's own `e.key` (which
 * already accounts for Shift) as a literal ASCII character.
 */
import { SPECIAL_KEY_CODES } from "@apple2/core";

export function keyEventToAscii(e: KeyboardEvent): number | null {
  if (e.ctrlKey && e.key.length === 1 && /[a-zA-Z]/.test(e.key)) {
    return e.key.toUpperCase().charCodeAt(0) & 0x1f;
  }
  const special = SPECIAL_KEY_CODES[e.code];
  if (special !== undefined) return special;
  if (e.key.length === 1) {
    // A real Apple II keyboard has no lowercase: every letter key latches
    // uppercase ASCII. Games like Lode Runner compare against uppercase
    // codes, so unshifted browser letters must uppercase to match hardware.
    return e.key.toUpperCase().charCodeAt(0) & 0x7f;
  }
  return null;
}

export function isInteractiveElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}
