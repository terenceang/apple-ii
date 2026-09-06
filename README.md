# Apple //e Emulator

A browser-based Apple //e (Enhanced) emulator written in pure TypeScript, with the 6502 CPU and
machine running in a Web Worker off the main thread. Built the same way as the ZX Spectrum
emulator this repo is a sibling of: a small monorepo (`core` / `worker` / `app` / `mcp-server`),
zero-latency `AudioWorklet` audio, disk-image support, save states, and an MCP bridge so an AI
agent (or any MCP client) can drive a running instance.

## Quickstart

```
npm install
npm run dev
```

Open the app, then use the **ROM Setup** modal to load your own Apple IIe ROM image (see below —
none is bundled). Insert a `.dsk`/`.po` disk image to boot into DOS 3.3 / ProDOS, or just use the
Monitor/Applesoft prompt directly.

## About the ROM (read this first)

Apple's IIe firmware is still under copyright, so **no ROM is bundled**, unlike some retro
emulators. You need to supply your own dump from hardware you legally own.

This emulator needs the real 16KB motherboard ROM covering $C000-$FFFF (Applesoft BASIC, the
Monitor, and the internal slot-ROM/self-test space). That ROM is physically two 8KB chips on a
real Apple IIe board, in sockets commonly nicknamed **"CD"** ($C000-$DFFF) and **"EF"**
($E000-$FFFF) — dumps of them typically come as two separate 8,192-byte files named after those
sockets. The setup modal and the "Load ROM" control both accept either:

- **one 16,384-byte file** (a pre-combined CD+EF dump),
- **two 8,192-byte files selected together** (the CD and EF chip dumps) — they're combined in
  alphabetical-by-filename order, so a normal "...CD..." / "...EF..." naming pair sorts correctly
  on its own, or
- **one 12,288-byte file** covering only $D000-$FFFF (Applesoft + the Monitor, no self-test/
  slot-ROM space) — accepted for dumps that only extracted that portion; $C100-$CFFF reads as
  zero in that case, or
- **one 32,768-byte combined dump** (commonly distributed as `APPLE2E.ROM`) — only its second
  16KB half is used; the first half is a different/unused bank in that file format.

Two things a full hardware ROM set would normally also include are handled without any extra ROM
file at all:

- **Character generator / font**: drawn from an original bitmap font authored for this project
  (`packages/core/src/video/font.ts`), not a copy of Apple's character ROM.
- **Disk II boot PROM** (the code that reads track 0 / sector 0 and jumps to it): replaced by the
  machine directly performing that read-and-jump at reset time (`AppleIIe.reset()` in
  `packages/core/src/machines/appleIIe.ts`), rather than reproducing Apple's actual 256-byte P5
  boot ROM.

If you don't have a way to dump your own Apple IIe ROM, plenty of legal options exist for
enthusiasts (e.g. archival projects that document how to read your own EPROM) — that's outside
the scope of this README.

## Disk images

- Supports `.dsk` (DOS 3.3 sector order) and `.po` (ProDOS sector order) images — standard
  143,360-byte (35 track x 16 sector x 256 byte) raw sector dumps.
- Disk II emulation nibblizes each track on the fly using the standard 6-and-2 GCR encoding, so
  ordinary DOS 3.3 / ProDOS disks boot and read/write normally.
- **Copy-protected / raw-nibble images are not supported.** Only standard, unprotected sector
  images work.

## Features

- 6502 CPU (all documented opcodes), Apple //e language-card memory (64K RAM + 16K bank-switched
  language card), keyboard, speaker, and paddle emulation.
- Video: TEXT40, TEXT80, LORES, HIRES, and MIXED mode, rendered to a 280x192 (560x192 in 80-column) canvas.
- Disk II controller with two drives, read/write support, and write-protect sensing.
- Save states (5 slots, thumbnails, F5/F8 quick save/load), a disk library (IndexedDB-backed,
  search/rename/bulk-delete), and a paddle/gamepad input mapper — same dark "dev console" UI
  shell as the ZX Spectrum project this was built alongside.
- An MCP server (`packages/mcp-server`) exposing `load_rom`, `insert_disk`, `eject_disk`,
  `reset`, `run_frames`, `press_key`, `type_text`, `read_screen`, `save_snapshot`,
  `load_snapshot`, `get_status`, and `list_instances` — usable headlessly or against a live
  connected browser tab (the app auto-connects to `ws://localhost:8791`).

## Known limitations (deliberate v1 cuts)

- No double-hi-res, no MouseText glyphs.
- Video is rendered as a whole frame per 60Hz tick, not scanline-by-scanline — correct for the
  vast majority of software, but not cycle-accurate.
- HIRES colour uses a simplified fixed-parity approximation, not true NTSC composite artifact
  simulation.
- Only Disk II in slot 6 is emulated; no other peripheral card slots.
- The CPU passes the full Klaus Dormann 6502 functional-test exerciser
  (`packages/core/src/test/mos6502.exerciser.test.ts`, fixture committed under
  `packages/core/src/test/fixtures/`); illegal opcodes are deliberately treated as 2-cycle
  NOPs rather than implemented.
- **The 6-and-2 nibble encoding** (`packages/core/src/disk/nibbleCodec.ts`) is verified
  byte-for-byte against two independent reference implementations — AppleWin's
  `CImageBase::Code62`/`Decode62` and MAME's `a2_16sect_format` — including the
  64-entry translate table, the aux-buffer bit layout, and the checksum convention.
  (The original from-memory implementation had the aux order reversed and the pairs
  unswapped — internally round-trip-consistent, but unreadable by real DOS 3.3 RWTS.)

## Project layout

```
packages/
  core/         6502 CPU, memory/language-card, video, speaker, Disk II, save states
  worker/       Web Worker host + shared-memory frame/audio ring buffers
  app/          Vite app: UI, input mapping, audio, IndexedDB-backed storage
  mcp-server/   MCP tool server + browser bridge (WebSocket, ws://localhost:8791)
```

## Scripts

```
npm run dev         # builds the MCP server, runs it, and starts the Vite dev server
npm run build        # builds all packages in dependency order
npm test              # runs the vitest suite
npm run typecheck  # tsc -b across the whole monorepo
npm run lint            # eslint .
```
