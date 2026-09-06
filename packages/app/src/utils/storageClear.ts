import { deleteDb } from "./idb.js";

export async function clearAllClientStorage(): Promise<void> {
  const keysToRemove = [
    "apple2_rom",
    "apple2_volume",
    "apple2_muted",
    "apple2_library_open",
    "apple2_controls_open",
    "apple2_left_tab",
    "apple2_right_tab",
    "apple2_paddle_type",
    "apple2_paddle_bindings",
  ];
  for (const key of keysToRemove) {
    localStorage.removeItem(key);
  }

  await Promise.all([
    deleteDb("apple2-session"),
    deleteDb("apple2-disks"),
    deleteDb("apple2_save_states"),
  ]);
}
