#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import {
  APPLE_II_PALETTE_RGB,
  AppleIIe,
  DISK_EXTENSIONS,
  ROM_CHIP_SIZE,
  ROM_SIZE,
  ROM_SIZE_BASIC_MONITOR,
  ROM_SIZE_COMBINED_32K,
  loadState,
  parseDsk,
  saveState,
  type DiskFormat,
} from "../../core/dist/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { callInstance, connectedInstanceIds, resolveInstance } from "./bridge.js";
import { encodeIndexedFramePng } from "./png.js";

const instanceIdSchema = { instanceId: z.string().optional() };

let machine: AppleIIe | null = null;

function requireMachine(): AppleIIe {
  if (!machine) throw new Error("No ROM loaded yet — call load_rom first.");
  return machine;
}

const SPECIAL_KEYS: Record<string, number> = {
  Enter: 0x0d,
  Escape: 0x1b,
  Tab: 0x09,
  Space: 0x20,
  Backspace: 0x7f,
  Delete: 0x7f,
  ArrowLeft: 0x08,
  ArrowRight: 0x15,
  ArrowUp: 0x0b,
  ArrowDown: 0x0a,
};

function keyToAscii(key: string): number {
  if (key.length === 1) return key.charCodeAt(0) & 0x7f;
  const special = SPECIAL_KEYS[key];
  if (special !== undefined) return special;
  throw new Error(`Unknown key "${key}" — pass a single character or one of: ${Object.keys(SPECIAL_KEYS).join(", ")}`);
}

function detectDiskFormat(path: string): DiskFormat {
  const lower = path.toLowerCase();
  for (const [ext, format] of Object.entries(DISK_EXTENSIONS)) {
    if (lower.endsWith(ext)) return format;
  }
  throw new Error(`Unrecognized disk file extension for "${path}" (expected .dsk/.po)`);
}

const server = new McpServer({ name: "apple2", version: "0.5.0" });

server.registerTool(
  "load_rom",
  {
    title: "Load ROM",
    description:
      `Loads an Apple IIe ROM image ($C000-$FFFF) and (re)creates the machine. Pass a single ` +
      `${ROM_SIZE}-byte (full), ${ROM_SIZE_BASIC_MONITOR}-byte ($D000-$FFFF-only), or ` +
      `${ROM_SIZE_COMBINED_32K}-byte (combined dump, e.g. "APPLE2E.ROM" — only its second half is ` +
      `used) romPath, or romPath + rom1Path as the two ${ROM_CHIP_SIZE}-byte chip dumps nicknamed ` +
      '"CD" ($C000-$DFFF) and "EF" ($E000-$FFFF) — romPath is CD, rom1Path is EF.',
    inputSchema: { romPath: z.string(), rom1Path: z.string().optional(), ...instanceIdSchema },
  },
  async ({ romPath, rom1Path, instanceId }) => {
    let romBytes: Buffer;
    if (rom1Path) {
      const cd = readFileSync(romPath);
      const ef = readFileSync(rom1Path);
      if (cd.byteLength !== ROM_CHIP_SIZE || ef.byteLength !== ROM_CHIP_SIZE) {
        throw new Error(`Each ROM chip dump must be ${ROM_CHIP_SIZE} bytes.`);
      }
      romBytes = Buffer.concat([cd, ef]);
    } else {
      romBytes = readFileSync(romPath);
      const validSizes: number[] = [ROM_SIZE, ROM_SIZE_BASIC_MONITOR, ROM_SIZE_COMBINED_32K];
      if (!validSizes.includes(romBytes.byteLength)) {
        throw new Error(
          `ROM must be ${ROM_SIZE}, ${ROM_SIZE_BASIC_MONITOR}, or ${ROM_SIZE_COMBINED_32K} bytes ` +
            `(got ${romBytes.byteLength}) — or pass rom1Path for the two-chip form.`,
        );
      }
    }
    const target = resolveInstance(instanceId);
    if (target) {
      await callInstance(target, "loadRom", { romBase64: romBytes.toString("base64") });
      return { content: [{ type: "text", text: `Loaded ROM into instance "${target}".` }] };
    }
    const m = new AppleIIe();
    m.loadRom(new Uint8Array(romBytes));
    m.reset();
    machine = m;
    return { content: [{ type: "text", text: "Loaded ROM and reset the machine." }] };
  },
);

server.registerTool(
  "insert_disk",
  {
    title: "Insert disk",
    description: "Inserts a .dsk or .po floppy disk image into the Disk II drive.",
    inputSchema: { path: z.string(), ...instanceIdSchema },
  },
  async ({ path, instanceId }) => {
    const format = detectDiskFormat(path);
    const target = resolveInstance(instanceId);
    if (target) {
      const dataBase64 = readFileSync(path).toString("base64");
      await callInstance(target, "loadDisk", { format, dataBase64 });
      return { content: [{ type: "text", text: `Inserted disk "${path}" into instance "${target}".` }] };
    }
    const m = requireMachine();
    const bytes = new Uint8Array(readFileSync(path));
    m.insertDisk(parseDsk(bytes, format));
    return { content: [{ type: "text", text: `Inserted disk "${path}".` }] };
  },
);

server.registerTool(
  "eject_disk",
  {
    title: "Eject disk",
    description: "Ejects the floppy disk from the Disk II drive.",
    inputSchema: instanceIdSchema,
  },
  async ({ instanceId }) => {
    const target = resolveInstance(instanceId);
    if (target) {
      await callInstance(target, "ejectDisk");
      return { content: [{ type: "text", text: `Ejected disk on instance "${target}".` }] };
    }
    requireMachine().ejectDisk();
    return { content: [{ type: "text", text: "Disk ejected." }] };
  },
);

server.registerTool(
  "reset",
  { title: "Reset", description: "Resets the machine (keeps the loaded ROM).", inputSchema: instanceIdSchema },
  async ({ instanceId }) => {
    const target = resolveInstance(instanceId);
    if (target) await callInstance(target, "reset");
    else requireMachine().reset();
    return { content: [{ type: "text", text: "Machine reset." }] };
  },
);

server.registerTool(
  "run_frames",
  {
    title: "Run frames",
    description:
      "Advances emulation by `count` frames (60/sec). Against a connected browser instance, " +
      "which already runs in real time, this just waits out that much wall-clock time instead of stepping.",
    inputSchema: { count: z.number().int().min(1).max(5000).default(1), ...instanceIdSchema },
  },
  async ({ count, instanceId }) => {
    const target = resolveInstance(instanceId);
    if (target) {
      await new Promise((resolve) => setTimeout(resolve, count * 17));
      return { content: [{ type: "text", text: `Waited ${count} frame(s) of real time on instance "${target}".` }] };
    }
    const m = requireMachine();
    for (let i = 0; i < count; i++) m.runFrame();
    return { content: [{ type: "text", text: `Ran ${count} frame(s).` }] };
  },
);

server.registerTool(
  "press_key",
  {
    title: "Press/release a key",
    description:
      "Sets one key up or down (a single character, or a named key: " +
      `${Object.keys(SPECIAL_KEYS).join(", ")}). A key must stay held for a few run_frames calls ` +
      "for the ROM's keyboard read to register it — press down, run_frames, then press up.",
    inputSchema: { key: z.string(), down: z.boolean(), ...instanceIdSchema },
  },
  async ({ key, down, instanceId }) => {
    const ascii = keyToAscii(key);
    const target = resolveInstance(instanceId);
    if (target) await callInstance(target, "keyEvent", { ascii, down });
    else requireMachine().keyboard.setKey(ascii, down);
    return { content: [{ type: "text", text: `${JSON.stringify(key)} ${down ? "pressed" : "released"}.` }] };
  },
);

server.registerTool(
  "type_text",
  {
    title: "Type text",
    description:
      "Types a string as a sequence of key taps. Supports printable ASCII and \\n (Enter). " +
      "Against the headless machine, each tap is held for 2 frames and released for 4; against a " +
      "connected browser instance the taps are timed in real time on the browser side.",
    inputSchema: { text: z.string(), ...instanceIdSchema },
  },
  async ({ text, instanceId }) => {
    const target = resolveInstance(instanceId);
    if (target) {
      await callInstance(target, "typeText", { text });
      return { content: [{ type: "text", text: `Typed ${JSON.stringify(text)} on instance "${target}".` }] };
    }
    const m = requireMachine();
    for (const ch of text) {
      const ascii = ch === "\n" ? 0x0d : ch.charCodeAt(0) & 0x7f;
      m.keyboard.setKey(ascii, true);
      m.runFrame();
      m.runFrame();
      m.keyboard.setKey(ascii, false);
      m.runFrame();
      m.runFrame();
      m.runFrame();
      m.runFrame();
    }
    return { content: [{ type: "text", text: `Typed ${JSON.stringify(text)}.` }] };
  },
);

server.registerTool(
  "read_screen",
  {
    title: "Read screen",
    description:
      "Renders the current frame as a PNG screenshot. Uses a connected browser instance if one " +
      "is live (see list_instances), otherwise the headless machine. Pass savePath to also write " +
      "the PNG to disk.",
    inputSchema: { ...instanceIdSchema, savePath: z.string().optional() },
  },
  async ({ instanceId, savePath }) => {
    const target = resolveInstance(instanceId);
    let pngBase64: string;
    if (target) {
      ({ pngBase64 } = (await callInstance(target, "readScreen")) as { pngBase64: string });
    } else {
      const m = requireMachine();
      const { pixels, width, height } = m.getFrameBuffer();
      pngBase64 = encodeIndexedFramePng(pixels, width, height, APPLE_II_PALETTE_RGB).toString("base64");
    }
    if (savePath) writeFileSync(savePath, Buffer.from(pngBase64, "base64"));
    return {
      content: [
        { type: "image" as const, data: pngBase64, mimeType: "image/png" },
        ...(savePath ? [{ type: "text" as const, text: `Saved to ${savePath}` }] : []),
      ],
    };
  },
);

server.registerTool(
  "save_snapshot",
  {
    title: "Save snapshot",
    description:
      "Captures the current machine state as a .a2state file and writes it to savePath. Uses a " +
      "connected browser instance if one is live, otherwise the headless machine.",
    inputSchema: { savePath: z.string(), ...instanceIdSchema },
  },
  async ({ savePath, instanceId }) => {
    const target = resolveInstance(instanceId);
    let dataBase64: string;
    if (target) {
      const res = (await callInstance(target, "saveSnapshot")) as { dataBase64: string };
      dataBase64 = res.dataBase64;
    } else {
      dataBase64 = Buffer.from(saveState(requireMachine())).toString("base64");
    }
    writeFileSync(savePath, Buffer.from(dataBase64, "base64"));
    return { content: [{ type: "text", text: `Saved snapshot to ${savePath}` }] };
  },
);

server.registerTool(
  "load_snapshot",
  {
    title: "Load snapshot",
    description: "Loads a .a2state snapshot into the current machine.",
    inputSchema: { path: z.string(), ...instanceIdSchema },
  },
  async ({ path, instanceId }) => {
    const target = resolveInstance(instanceId);
    if (target) {
      const dataBase64 = readFileSync(path).toString("base64");
      await callInstance(target, "loadSnapshot", { dataBase64 });
      return { content: [{ type: "text", text: `Loaded snapshot "${path}" into instance "${target}".` }] };
    }
    loadState(requireMachine(), new Uint8Array(readFileSync(path)));
    return { content: [{ type: "text", text: `Loaded snapshot "${path}".` }] };
  },
);

server.registerTool(
  "get_status",
  {
    title: "Get status",
    description:
      "Reports machine status. Uses a connected browser instance if one is live, otherwise the " +
      "headless machine (which also reports CPU PC).",
    inputSchema: instanceIdSchema,
  },
  async ({ instanceId }) => {
    const target = resolveInstance(instanceId);
    if (target) {
      const status = (await callInstance(target, "getStatus")) as Record<string, unknown>;
      return { content: [{ type: "text", text: JSON.stringify({ instanceId: target, ...status }, null, 2) }] };
    }
    if (!machine) return { content: [{ type: "text", text: "No ROM loaded yet." }] };
    const status = { pc: `0x${machine.cpu.pc.toString(16)}`, diskInserted: machine.disk.getDisk() !== null };
    return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
  },
);

server.registerTool(
  "list_instances",
  {
    title: "List connected instances",
    description:
      "Lists connected browser instance IDs (each tab running the app shows its ID next to the " +
      "MCP connection indicator). Pass one as instanceId to other tools to target it explicitly; " +
      "tools auto-target the sole connected instance, or fall back to a private headless machine, " +
      "when none is given.",
  },
  () => {
    const ids = connectedInstanceIds();
    return {
      content: [
        { type: "text", text: ids.length ? ids.join(", ") : "(none connected — tools will use the headless machine)" },
      ],
    };
  },
);

const transport = new StdioServerTransport();
void (async () => {
  try {
    await server.connect(transport);
  } catch (err) {
    console.error(`MCP server failed to start: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
})();
