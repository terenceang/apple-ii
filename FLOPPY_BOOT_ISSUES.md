# Floppy Boot Issues

Status of disk-boot emulation in `packages/core`'s `DiskII`/`AppleIIe`.

## Status: Resolved

DOS 3.3 boots completely to the Applesoft BASIC `]` prompt, turns the drive
motor off, and responds cleanly to DOS commands (e.g. `CATALOG`).

Verified in `packages/core/src/test/dos33-boot-smoke.test.ts`.

## Reproducing the Boot

```ts
const machine = new AppleIIe();
machine.loadRom(new Uint8Array(readFileSync("rom/APPLE2E.ROM")));
machine.insertDisk(parseDsk(new Uint8Array(readFileSync("Disk/DOS33.dsk")), "dsk"));
machine.reset();
for (let f = 0; f < 7000; f++) machine.runFrame();
expect(machine.disk.isMotorOn).toBe(false);
```

## History & Fixes

1. **`85f0962`** — `BTRDSEC` (the boot PROM's persistent sector-read entry
   point, `diskII.ts`) used a hardcoded page counter for where to write each
   sector boot1 requested. boot1 actually computes its own destination page
   (from bytes embedded in the disk's own sector-0 payload) and leaves it in
   zero page `$27` right before each call — `BTRDSEC` needed to read that,
   not track its own counter.
2. **`c944cf9`** — `INTCXROM` ($C006/$C007) wasn't implemented; unpopulated
   `$C100-$CFFF` slot space always read the motherboard ROM's own content
   there. Real hardware gates that window behind `INTCXROM` (off by default:
   open bus for an empty slot; on: internal ROM shadows every slot). Tracing
   actual `$C006`/`$C007` writes during boot revealed 9 toggles each,
   concentrated right around boot2 startup. `$C300-$C3FF` is a documented
   exception (`SLOTC3ROM` defaults to internal ROM; no slot-3 card is
   emulated) and always reads motherboard ROM regardless of `INTCXROM`.
3. **`0d74645`** — Backspace was mapped to `$7F`, which real ROM code does
   not treat as backspace in the Monitor or Applesoft's line editor. Mapped
   to `$08` (same as ArrowLeft).
4. **Resolution of BOOT2 Crash at `$1B86` (Double-Interleaving Bug)**:
   - **Symptom**: During boot2 relocation at `$1B86`, execution crashed into
     the system monitor (`*` prompt) due to `$C0xx` soft-switch writes
     (specifically `$C003` / RAMRD turning on and reading uninitialized aux
     memory).
   - **Investigation**: The loop at `$1B86` reads relocation records from
     `ADRTAB` located at `$1C28`. In memory, page `$1C00` contained 6502
     machine code instead of the table (`$B1, $48, $A8, $B9...`), causing
     insane relocation spans across page `$C0`.
   - **Root Cause**: An earlier commit (`4cb3a41`) had modified
     `buildTrackLayout()` to label sector address fields with logical DOS
     sector numbers via `logicalSectorAt(sector)`. On real Apple II Disk II
     floppies, address field headers are labeled with the **physical sector
     index (0..15)**. The logical-to-physical skew is handled entirely in
     software by RWTS via its internal translation table `SECTBL` at `$3FB8`
     (`00 0D 0B 09 07 05 03 01 0E 0C 0A 08 06 04 02 0F`). Because
     `buildTrackLayout()` had also labeled address headers with logical
     sector numbers, RWTS double-interleaved every sector read during BOOT1,
     loading completely scrambled sectors into `$1B00-$2000`. Sector 8
     ended up at page `$1C00`, overwriting `ADRTAB`.
   - **Fix**: Reverted address field headers in `buildTrackLayout()` to use
     physical sector numbers `0..15`, and deleted `logicalSectorAt()`.
     Boot now successfully loads all 27 DOS sectors, cleanly relocates DOS
     to high memory (`$B800-$BFFF`), seeks to track 17 (VTOC), executes
     `HELLO`, stops the drive motor, and enters Applesoft BASIC.
5. **Auxiliary Memory Soft-Switch Status Registers ($C013–$C018)**:
   - `RDALTZP` (bit 7 returns status of ALTZP bank switch) was previously
     registered at `$C01C` (which on an Apple //e is actually `RDPAGE2`).
     Corrected to `$C016` (`RDALTZP`), and registered `$C015` (`RDCXROM`).
   - Verified that `ALTZP` defaults to OFF (main zero page & stack) on reset,
     `$C008` disables ALTZP, `$C009` enables ALTZP, and `RAMRD`/`RAMWRT` are
     strictly isolated to `$0200–$BFFF` so they never clobber zero page or stack.
