# Apple //e Emulator — Agent Guide

## Quick commands

```
npm run dev         # build MCP server, start it, then Vite dev server
npm run build        # build all packages in dependency order
npm test             # vitest (packages/*/src/**/*.test.ts)
npm run typecheck    # tsc -b (composite project references)
npm run lint         # eslint .
npm run test:all     # typecheck + lint + test (pre-merge gate)
```

Build order matters: `core` → `worker` → `app` → `mcp-server`. The root `npm run build` handles this.

## Monorepo structure

```
packages/core/      6502 CPU, memory/language-card, video, speaker, Disk II, save states
packages/worker/    Web Worker host, shared-memory frame/audio ring buffers
packages/app/       Vite browser app, UI, input mapping, AudioWorklet, IndexedDB storage
packages/mcp-server/ MCP tool server + WebSocket bridge (ws://localhost:8791)
```

Dependency chain: `worker` → `core`; `app` → `core` + `worker`; `mcp-server` → `core`.

## Toolchain

- **Node 22** (`.nvmrc`)
- **TypeScript 5.7** with strict mode, composite references, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
- **Vitest** for tests, **ESLint** with `typescript-eslint`, **Prettier** (100 width, trailing commas)
- MCP server imports from `../../core/dist/index.js` (built output), so `core` must be built before the MCP server runs

## ROM files

No ROM is bundled in the repo (Apple copyright). The `rom/` directory contains local dumps that are not gitignored — do not commit them. The emulator accepts:
- 16KB combined CD+EF dump
- Two 8KB chip dumps (CD + EF)
- 12KB basic/monitor-only dump ($D000-$FFFF)
- 32KB combined dump (only second 16KB used)

## MCP server

The MCP server runs headlessly via stdio (`apple2-mcp` binary). When a browser tab connects to `ws://localhost:8791`, tools auto-route to the browser instance; otherwise they use a private headless `AppleIIe` machine. Key timing detail: `press_key` must hold the key for a few `run_frames` calls (down → run_frames → up).

## Testing notes

- All tests live in `packages/*/src/test/` (one folder per package, enforced by the vitest include pattern) — never colocate `*.test.ts` with sources
- Tests use a mock NOP ROM (`makeNopRom`) — real ROMs are not used in tests (except the optional PR#6 smoke test, which skips if `rom/APPLE2E.ROM` is absent)
- The CPU suite runs the full Klaus Dormann functional-test exerciser
  (`packages/core/src/test/mos6502.exerciser.test.ts`). The 64KB fixture binary lives in
  `packages/core/src/test/fixtures/` (GPLv3, from Klaus Dormann's repo — no network needed to run).
  Success = self-jam at $3469; any other jam address = CPU bug at that test.
- Disk nibble codec tests pin byte-for-byte vectors against AppleWin/MAME references
  (translate table, aux order, pair swap, checksum convention) — if you change
  `nibbleCodec.ts`, those vectors are the contract with real DOS 3.3 disks
- `DiskII` models two drives (`insertDisk(image, drive)`); $C0EA/$C0EB select the active
  one, and each has independent motor/track/write-protect state
- The MCP png test needs no build (png.ts only imports node:zlib)

## Code style

- No `//` comments in code unless explaining non-obvious hardware behavior
- Unused vars/params prefixed with `_` (eslint rule)
- Empty catch blocks allowed (`no-empty` with `allowEmptyCatch`)
