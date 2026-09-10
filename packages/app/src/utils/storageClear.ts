import { deleteDb } from "./idb.js";
import { IDB_DATABASES, LS_KEYS } from "./storageKeys.js";

export async function clearAllClientStorage(): Promise<void> {
  for (const key of Object.values(LS_KEYS)) {
    localStorage.removeItem(key);
  }

  await Promise.all(Object.values(IDB_DATABASES).map((name) => deleteDb(name)));
}
