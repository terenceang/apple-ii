import type { DiskFormat } from "../disk/dsk.js";
import { DISK_EXTENSIONS } from "../disk/dsk.js";

export const MCP_BRIDGE_PORT = 8791;

export { DISK_EXTENSIONS };

export type BridgeCommand =
  | { reqId: string; cmd: "getStatus" }
  | { reqId: string; cmd: "readScreen" }
  | { reqId: string; cmd: "saveSnapshot" }
  | { reqId: string; cmd: "loadRom"; romBase64: string }
  | { reqId: string; cmd: "loadSnapshot"; dataBase64: string }
  | { reqId: string; cmd: "loadDisk"; format: DiskFormat; dataBase64: string; drive?: number }
  | { reqId: string; cmd: "ejectDisk"; drive?: number }
  | { reqId: string; cmd: "reset" }
  | { reqId: string; cmd: "keyEvent"; ascii: number; down: boolean }
  | { reqId: string; cmd: "typeText"; text: string };
