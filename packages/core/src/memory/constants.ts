/**
 * A real Apple IIe motherboard ROM is 16KB, covering $C000-$FFFF, physically
 * split across two 8KB chips in sockets nicknamed "CD" ($C000-$DFFF) and
 * "EF" ($E000-$FFFF) — hence ROM dumps commonly arriving as two separate
 * 8192-byte files. $C000-$C0FF is always I/O regardless of what's in the ROM
 * chip at that offset (hardwired, never addressable), so only the
 * $C100-$FFFF portion is ever actually read.
 */
export const ROM_SIZE = 0x4000;
export const ROM_CHIP_SIZE = 0x2000;
/**
 * Some ROM dumps only cover $D000-$FFFF (Applesoft BASIC + the Monitor, no
 * self-test/slot-ROM space) — 12,288 bytes. Memory.loadRom also accepts this
 * size, zero-filling $C100-$CFFF.
 */
export const ROM_SIZE_BASIC_MONITOR = 0x3000;
/**
 * Some vendor dumps (e.g. the common "APPLE2E.ROM" filename) package the ROM
 * as a 32KB file: an unrelated/unused first 16KB half, then the real
 * $C000-$FFFF image as the second 16KB half. Memory.loadRom accepts this
 * size and just takes that second half.
 */
export const ROM_SIZE_COMBINED_32K = 0x8000;

/** Soft-switch I/O address space. */
export const IO_START = 0xc000;
export const IO_END = 0xc0ff;

/** Language-card bank-switched RAM/ROM region. */
export const LC_START = 0xd000;
export const LC_BANK_SIZE = 0x1000; // $D000-$DFFF (bank 1 or 2)
export const LC_UPPER_START = 0xe000; // $E000-$FFFF, shared by both banks
export const LC_UPPER_SIZE = 0x2000;
