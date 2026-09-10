export const SPECIAL_KEY_CODES: Record<string, number> = {
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
