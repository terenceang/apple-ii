import type { AppleIIe } from "../machines/appleIIe.js";

/** Types `text` into the keyboard, holding each key down for two frames (as real key repeat would). */
export function typeString(machine: AppleIIe, text: string): void {
  for (const ch of text) {
    const ascii = ch === "\n" ? 0x0d : ch.charCodeAt(0) & 0x7f;
    machine.keyboard.setKey(ascii, true);
    machine.runFrame();
    machine.runFrame();
    machine.keyboard.setKey(ascii, false);
    machine.runFrame();
    machine.runFrame();
  }
}

/** Dumps the 40x24 text screen as plain text (non-printable bytes become spaces). */
export function dumpScreenText(machine: AppleIIe): string {
  let screenText = "";
  for (let row = 0; row < 24; row++) {
    const base = 0x0400 + ((row & 7) << 7) + ((row >> 3) * 0x28);
    for (let col = 0; col < 40; col++) {
      const ch = machine.memory.read(base + col) & 0x7f;
      screenText += ch >= 32 && ch < 127 ? String.fromCharCode(ch) : " ";
    }
  }
  return screenText;
}
