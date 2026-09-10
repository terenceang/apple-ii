import type { DiskFormat } from "@apple2/core";
import { idbRequest, idbTx, openDb } from "../utils/idb.js";
import { IDB_DATABASES } from "../utils/storageKeys.js";

export interface DiskEntry {
  id: string;
  name: string;
  filename: string;
  format: DiskFormat;
  data: ArrayBuffer;
  addedAt: number;
}

const DB_NAME = IDB_DATABASES.disks;
const STORE_NAME = "disks";

function openDisksDb(): Promise<IDBDatabase> {
  return openDb(DB_NAME, STORE_NAME, { keyPath: "id" });
}

export async function addDisk(disk: Omit<DiskEntry, "id" | "addedAt">): Promise<DiskEntry> {
  const entry: DiskEntry = { ...disk, id: crypto.randomUUID(), addedAt: Date.now() };
  const db = await openDisksDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).put(entry);
  await idbTx(tx);
  db.close();
  return entry;
}

export async function removeDisk(id: string): Promise<void> {
  const db = await openDisksDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).delete(id);
  await idbTx(tx);
  db.close();
}

export async function removeDisks(ids: string[]): Promise<void> {
  const db = await openDisksDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  for (const id of ids) store.delete(id);
  await idbTx(tx);
  db.close();
}

export async function getAllDisks(): Promise<DiskEntry[]> {
  const db = await openDisksDb();
  const tx = db.transaction(STORE_NAME, "readonly");
  const result = await idbRequest<DiskEntry[]>(tx.objectStore(STORE_NAME).getAll());
  db.close();
  return result.sort((a, b) => b.addedAt - a.addedAt);
}

async function getDisk(id: string): Promise<DiskEntry | null> {
  const db = await openDisksDb();
  const tx = db.transaction(STORE_NAME, "readonly");
  const result = await idbRequest<DiskEntry | undefined>(tx.objectStore(STORE_NAME).get(id));
  db.close();
  return result ?? null;
}

export async function renameDisk(id: string, name: string): Promise<void> {
  const entry = await getDisk(id);
  if (!entry) return;
  entry.name = name;
  const db = await openDisksDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).put(entry);
  await idbTx(tx);
  db.close();
}
