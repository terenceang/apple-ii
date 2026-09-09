export const TRACKS_PER_DISK = 35;
export const SECTORS_PER_TRACK = 16;
export const SECTOR_SIZE = 256;
export const TRACK_SIZE = SECTORS_PER_TRACK * SECTOR_SIZE; // 4096
export const DISK_IMAGE_SIZE = TRACKS_PER_DISK * TRACK_SIZE; // 143,360 bytes

export type DiskFormat = "dsk" | "po";

export const DISK_EXTENSIONS = { ".dsk": "dsk", ".po": "po" } as const;

/**
 * DOS 3.3 (.dsk) physical-to-logical sector order. A .dsk file stores each
 * track's 16 sectors in *logical* (DOS) order; the disk controller reads
 * sectors in *physical* order off the track, so this table translates
 * logical sector index -> physical sector position.
 */
const DOS_SECTOR_ORDER = [
  0x0, 0xd, 0xb, 0x9, 0x7, 0x5, 0x3, 0x1, 0xe, 0xc, 0xa, 0x8, 0x6, 0x4, 0x2, 0xf,
];

/** ProDOS (.po) images are already stored in physical sector order. */
const PRODOS_SECTOR_ORDER = [0x0, 0x1, 0x2, 0x3, 0x4, 0x5, 0x6, 0x7, 0x8, 0x9, 0xa, 0xb, 0xc, 0xd, 0xe, 0xf];

export interface DiskImage {
  format: DiskFormat;
  /** 35 tracks x 16 physical sectors x 256 bytes, already reordered to physical order. */
  tracks: Uint8Array[];
  /** Physical write-protect notch. When true, the Disk II reports write-protect on $C0ED. */
  writeProtected: boolean;
}

function sectorOrderFor(format: DiskFormat): number[] {
  return format === "dsk" ? DOS_SECTOR_ORDER : PRODOS_SECTOR_ORDER;
}

/**
 * Copies one track between a contiguous file-order slice and a
 * physically-ordered track buffer, applying the format's logical->physical
 * sector mapping in whichever direction is needed. Shared by parseDsk and
 * writeDsk so the two mappings can never diverge.
 */
function remapTrack(
  src: Uint8Array,
  srcIsPhysical: boolean,
  dst: Uint8Array,
  dstOffset: number,
  order: number[],
): void {
  for (let logical = 0; logical < SECTORS_PER_TRACK; logical++) {
    const physical = order[logical]!;
    const from = (srcIsPhysical ? physical : logical) * SECTOR_SIZE;
    const to = dstOffset + (srcIsPhysical ? logical : physical) * SECTOR_SIZE;
    dst.set(src.subarray(from, from + SECTOR_SIZE), to);
  }
}

export function parseDsk(bytes: Uint8Array, format: DiskFormat): DiskImage {
  if (bytes.length !== DISK_IMAGE_SIZE) {
    throw new Error(
      `Expected a ${DISK_IMAGE_SIZE}-byte disk image (35 tracks x 16 x 256), got ${bytes.length} bytes.`,
    );
  }
  const order = sectorOrderFor(format);
  const tracks: Uint8Array[] = [];
  for (let t = 0; t < TRACKS_PER_DISK; t++) {
    const physical = new Uint8Array(TRACK_SIZE);
    remapTrack(bytes.subarray(t * TRACK_SIZE, (t + 1) * TRACK_SIZE), false, physical, 0, order);
    tracks.push(physical);
  }
  return { format, tracks, writeProtected: false };
}

export function writeDsk(image: DiskImage): Uint8Array {
  const order = sectorOrderFor(image.format);
  const out = new Uint8Array(DISK_IMAGE_SIZE);
  for (let t = 0; t < TRACKS_PER_DISK; t++) {
    remapTrack(image.tracks[t]!, true, out, t * TRACK_SIZE, order);
  }
  return out;
}
