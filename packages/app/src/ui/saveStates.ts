import { idbRequest, idbTx, openDb } from "../utils/idb.js";
import { IDB_DATABASES } from "../utils/storageKeys.js";

const DB_NAME = IDB_DATABASES.saveStates;
const STORE_NAME = "states";

export interface SaveStateEntry {
  id: string;
  slot: number;
  timestamp: number;
  data: ArrayBuffer;
  screenshot: string;
  name?: string | undefined;
}

function stateDb(): Promise<IDBDatabase> {
  return openDb(DB_NAME, STORE_NAME, { keyPath: "id" });
}

function stateId(slot: number): string {
  return `slot_${slot}`;
}

export async function saveStateToStorage(
  slot: number,
  data: ArrayBuffer,
  screenshot: string,
  name?: string,
): Promise<void> {
  const db = await stateDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const entry: SaveStateEntry = { id: stateId(slot), slot, timestamp: Date.now(), data, screenshot, name };
  tx.objectStore(STORE_NAME).put(entry);
  return idbTx(tx);
}

export async function loadStateFromStorage(slot: number): Promise<SaveStateEntry | null> {
  const db = await stateDb();
  const tx = db.transaction(STORE_NAME, "readonly");
  const result = await idbRequest<SaveStateEntry | undefined>(
    tx.objectStore(STORE_NAME).get(stateId(slot)),
  );
  return result ?? null;
}

export async function deleteStateFromStorage(slot: number): Promise<void> {
  const db = await stateDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).delete(stateId(slot));
  return idbTx(tx);
}

export async function getAllSaveStates(): Promise<SaveStateEntry[]> {
  const db = await stateDb();
  const tx = db.transaction(STORE_NAME, "readonly");
  return idbRequest<SaveStateEntry[]>(tx.objectStore(STORE_NAME).getAll());
}
