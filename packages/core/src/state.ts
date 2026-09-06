import type { AppleIIe } from "./machines/appleIIe.js";

const MAGIC = "A2ST";
const VERSION = 2;

/**
 * Our own versioned binary save-state format (CPU registers, video soft-
 * switch state, and the full memory image via Memory.serialize()). There's
 * no ubiquitous shared Apple II snapshot format worth targeting instead —
 * this is purely internal, used only by the save-state slot storage in the
 * app. The inserted disk image is intentionally not part of this blob
 * (matches the reference project's own snapshot format, which likewise
 * doesn't embed removable media state).
 */
export function saveState(machine: AppleIIe): Uint8Array {
  const memoryBlob = machine.memory.serialize();
  const header = new Uint8Array(4 + 1 + 7 + 2); // magic(4) + version(1) + cpu(7) + video(2)
  let offset = 0;
  for (let i = 0; i < 4; i++) header[offset++] = MAGIC.charCodeAt(i);
  header[offset++] = VERSION;
  header[offset++] = machine.cpu.a;
  header[offset++] = machine.cpu.x;
  header[offset++] = machine.cpu.y;
  header[offset++] = machine.cpu.s;
  header[offset++] = machine.cpu.pc & 0xff;
  header[offset++] = (machine.cpu.pc >> 8) & 0xff;
  header[offset++] = machine.cpu.p;
  header[offset++] =
    (machine.video.textMode ? 1 : 0) |
    (machine.video.mixedMode ? 2 : 0) |
    (machine.video.page2 ? 4 : 0) |
    (machine.video.hiresMode ? 8 : 0);
  header[offset++] = machine.video.col80 ? 1 : 0;

  const out = new Uint8Array(header.length + memoryBlob.length);
  out.set(header, 0);
  out.set(memoryBlob, header.length);
  return out;
}

export function loadState(machine: AppleIIe, data: Uint8Array): void {
  const magic = String.fromCharCode(data[0]!, data[1]!, data[2]!, data[3]!);
  if (magic !== MAGIC) throw new Error(`Not an Apple II save state (bad magic "${magic}").`);
  const version = data[4]!;
  if (version < 1 || version > VERSION) throw new Error(`Unsupported save-state version ${version}.`);

  let offset = 5;
  machine.cpu.a = data[offset++]!;
  machine.cpu.x = data[offset++]!;
  machine.cpu.y = data[offset++]!;
  machine.cpu.s = data[offset++]!;
  const pcLo = data[offset++]!;
  const pcHi = data[offset++]!;
  machine.cpu.pc = (pcHi << 8) | pcLo;
  machine.cpu.p = data[offset++]!;

  const videoFlags = data[offset++]!;
  machine.video.textMode = (videoFlags & 1) !== 0;
  machine.video.mixedMode = (videoFlags & 2) !== 0;
  machine.video.page2 = (videoFlags & 4) !== 0;
  machine.video.hiresMode = (videoFlags & 8) !== 0;

  // v2: 80-column flag (absent in v1 save states — defaults to off)
  if (version >= 2 && offset < data.length) {
    machine.video.col80 = data[offset++] === 1;
  } else {
    machine.video.col80 = false;
  }

  machine.memory.restore(data.subarray(offset));
}
