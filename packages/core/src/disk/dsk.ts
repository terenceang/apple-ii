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
    const trackOffset = t * TRACK_SIZE;
    for (let logicalSector = 0; logicalSector < SECTORS_PER_TRACK; logicalSector++) {
      const physicalSector = order[logicalSector]!;
      const src = bytes.subarray(
        trackOffset + logicalSector * SECTOR_SIZE,
        trackOffset + (logicalSector + 1) * SECTOR_SIZE,
      );
      physical.set(src, physicalSector * SECTOR_SIZE);
    }
    tracks.push(physical);
  }
  return { format, tracks, writeProtected: false };
}

export function writeDsk(image: DiskImage): Uint8Array {
  const order = sectorOrderFor(image.format);
  const out = new Uint8Array(DISK_IMAGE_SIZE);
  for (let t = 0; t < TRACKS_PER_DISK; t++) {
    const physical = image.tracks[t]!;
    const trackOffset = t * TRACK_SIZE;
    for (let logicalSector = 0; logicalSector < SECTORS_PER_TRACK; logicalSector++) {
      const physicalSector = order[logicalSector]!;
      const src = physical.subarray(physicalSector * SECTOR_SIZE, (physicalSector + 1) * SECTOR_SIZE);
      out.set(src, trackOffset + logicalSector * SECTOR_SIZE);
    }
  }
  return out;
}
