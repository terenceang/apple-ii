export type PaddleDirection = "left" | "right" | "up" | "down" | "fire" | "fire2";

export const PADDLE_DIRECTIONS: PaddleDirection[] = ["left", "right", "up", "down", "fire", "fire2"];

export const DEFAULT_PADDLE_KEY_BINDINGS: Record<PaddleDirection, string> = {
  left: "ArrowLeft",
  right: "ArrowRight",
  up: "ArrowUp",
  down: "ArrowDown",
  fire: "Space",
  fire2: "ControlLeft",
};

const TYPE_STORAGE_KEY = "apple2_paddle_type";
const BINDINGS_STORAGE_KEY = "apple2_paddle_bindings";

export type PaddleInputType = "none" | "gamepad" | "keys";

export function loadPaddleType(): PaddleInputType {
  const stored = localStorage.getItem(TYPE_STORAGE_KEY);
  return stored === "gamepad" || stored === "keys" ? stored : "none";
}

export function savePaddleType(type: PaddleInputType): void {
  localStorage.setItem(TYPE_STORAGE_KEY, type);
}

export function loadPaddleKeyBindings(): Record<PaddleDirection, string> {
  try {
    const stored = JSON.parse(localStorage.getItem(BINDINGS_STORAGE_KEY) ?? "null");
    if (stored && PADDLE_DIRECTIONS.every((d) => typeof stored[d] === "string")) return stored;
  } catch {
    /* fall through to defaults */
  }
  return { ...DEFAULT_PADDLE_KEY_BINDINGS };
}

export function savePaddleKeyBindings(bindings: Record<PaddleDirection, string>): void {
  localStorage.setItem(BINDINGS_STORAGE_KEY, JSON.stringify(bindings));
}
