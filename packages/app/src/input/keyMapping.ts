/**
 * The Apple II keyboard is a simple ASCII latch (unlike the ZX Spectrum's row/bit
 * matrix), so mapping a browser KeyEvent down to it is much simpler: special keys
 * get a fixed control code, everything else uses the browser's own `e.key` (which
 * already accounts for Shift) as a literal ASCII character.
 */
const SPECIAL_CODES: Record<string, number> = {
  Enter: 0x0d,
  Escape: 0x1b,
  Tab: 0x09,
  Space: 0x20,
  // Real Apple II keyboards have no key that sends $7F and gets treated as a
  // destructive backspace by the Monitor/Applesoft line editor — that's what
  // the left-arrow key ($08) does. Delete genuinely sends $7F on a real IIe,
  // but it doesn't act as backspace there either, so mapping PC Backspace to
  // $7F silently did nothing useful; map it to $08 like ArrowLeft instead.
  Backspace: 0x08,
  Delete: 0x7f,
  ArrowLeft: 0x08,
  ArrowRight: 0x15,
  ArrowUp: 0x0b,
  ArrowDown: 0x0a,
};

export function keyEventToAscii(e: KeyboardEvent): number | null {
  if (e.ctrlKey && e.key.length === 1 && /[a-zA-Z]/.test(e.key)) {
    return e.key.toUpperCase().charCodeAt(0) & 0x1f;
  }
  const special = SPECIAL_CODES[e.code];
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
