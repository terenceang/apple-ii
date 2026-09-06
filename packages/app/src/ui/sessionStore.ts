import type { DiskFormat } from "@apple2/core";
import { idbRequest, idbTx, openDb } from "../utils/idb.js";

export interface StoredMedia {
  filename: string;
  format: DiskFormat;
  data: ArrayBuffer;
}

const DB_NAME = "apple2-session";
const STORE_NAME = "session";

export async function saveSessionMedia(media: StoredMedia | null, drive = 0): Promise<void> {
  const db = await openDb(DB_NAME, STORE_NAME);
  const tx = db.transaction(STORE_NAME, "readwrite");
  const key = drive === 1 ? "last_media_2" : "last_media";
  if (media) {
    tx.objectStore(STORE_NAME).put(media, key);
  } else {
    tx.objectStore(STORE_NAME).delete(key);
  }
  await idbTx(tx);
  db.close();
}

export async function loadSessionMedia(drive = 0): Promise<StoredMedia | null> {
  const db = await openDb(DB_NAME, STORE_NAME);
  const tx = db.transaction(STORE_NAME, "readonly");
  const key = drive === 1 ? "last_media_2" : "last_media";
  const result = await idbRequest(tx.objectStore(STORE_NAME).get(key));
  db.close();
  return (result as StoredMedia | undefined) ?? null;
}
