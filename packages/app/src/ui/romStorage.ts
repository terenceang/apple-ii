import { arrayBufferToBase64, base64ToArrayBuffer } from "../utils/base64.js";

const ROM_KEY = "apple2_rom";

export interface StoredRom {
  filename: string;
  data: ArrayBuffer;
}

export function saveRom(rom: StoredRom): void {
  const payload = JSON.stringify({ filename: rom.filename, data: arrayBufferToBase64(rom.data) });
  localStorage.setItem(ROM_KEY, payload);
}

export function loadRom(): StoredRom | null {
  const raw = localStorage.getItem(ROM_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { filename: string; data: string };
    return { filename: parsed.filename, data: base64ToArrayBuffer(parsed.data) };
  } catch {
    return null;
  }
}

export function clearRom(): void {
  localStorage.removeItem(ROM_KEY);
}
