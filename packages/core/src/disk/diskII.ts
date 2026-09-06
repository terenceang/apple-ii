import type { Memory } from "../memory/memory.js";
import { SECTORS_PER_TRACK, SECTOR_SIZE, TRACKS_PER_DISK, type DiskImage } from "./dsk.js";
import { DATA_FIELD_NIBBLE_COUNT, decode6and2, encode4and4, encode6and2 } from "./nibbleCodec.js";

const ADDRESS_GAP = 12;
const DATA_GAP = 6;
const SECTOR_GAP = 24;
const VOLUME_NUMBER = 0xfe;

interface DataFieldRange {
  sector: number;
  start: number;
}

interface TrackLayout {
  nibbles: Uint8Array;
  dataFields: DataFieldRange[];
}

function buildTrackLayout(track: Uint8Array, trackNumber: number): TrackLayout {
  const bytes: number[] = [];
  const dataFields: DataFieldRange[] = [];

  for (let sector = 0; sector < SECTORS_PER_TRACK; sector++) {
    for (let i = 0; i < ADDRESS_GAP; i++) bytes.push(0xff);
    bytes.push(0xd5, 0xaa, 0x96);
    const [volOdd, volEven] = encode4and4(VOLUME_NUMBER);
    const [trkOdd, trkEven] = encode4and4(trackNumber);
    const [secOdd, secEven] = encode4and4(sector);
    const [chkOdd, chkEven] = encode4and4(VOLUME_NUMBER ^ trackNumber ^ sector);
    bytes.push(volOdd, volEven, trkOdd, trkEven, secOdd, secEven, chkOdd, chkEven);
    bytes.push(0xde, 0xaa, 0xeb);

    for (let i = 0; i < DATA_GAP; i++) bytes.push(0xff);
    bytes.push(0xd5, 0xaa, 0xad);
    const sectorBytes = track.subarray(sector * SECTOR_SIZE, (sector + 1) * SECTOR_SIZE);
    const encoded = encode6and2(sectorBytes);
    dataFields.push({ sector, start: bytes.length });
    for (const b of encoded) bytes.push(b);
    bytes.push(0xde, 0xaa, 0xeb);

    for (let i = 0; i < SECTOR_GAP; i++) bytes.push(0xff);
  }

  return { nibbles: Uint8Array.from(bytes), dataFields };
}

/**
 * Disk II controller: stepper-motor track selection, motor on/off, and the
 * Q6/Q7 read/write latch at $C0EC-$C0EF. Serves nibbles from a lazily-built,
 * fully-nibblized track image (see nibbleCodec.ts) rather than a cycle-timed
 * raw bitstream — real DOS 3.3/ProDOS RWTS code just loops reading the latch
 * until it finds the sync/prologue bytes it expects, so this is enough for
 * it to work without needing disk-rotation-accurate timing.
 */
export class DiskII {
  private image: DiskImage | null = null;
  private halfTrack = 0;
  private lastActivePhase = -1;
  private motorOn = false;
  private q7 = false;
  private headPos = 0;
  private currentLayout: TrackLayout | null = null;
  private currentLayoutTrack = -1;
  private writeScratch = new Uint8Array(DATA_FIELD_NIBBLE_COUNT);

  get isMotorOn(): boolean {
    return this.motorOn;
  }

  get currentTrack(): number {
    return Math.floor(this.halfTrack / 2);
  }

  turnOffMotor(): void {
    this.motorOn = false;
  }

  insertDisk(image: DiskImage): void {
    this.image = image;
    this.currentLayout = null;
    this.headPos = 0;
  }

  ejectDisk(): DiskImage | null {
    const image = this.image;
    this.image = null;
    this.currentLayout = null;
    return image;
  }

  getDisk(): DiskImage | null {
    return this.image;
  }

  /**
   * Reads track 0, physical sector 0 directly from the sector image (no
   * nibble encode/decode involved) and writes it to $0800, exactly what a
   * real Disk II boot PROM's entry point does. Returns false (writes
   * nothing) if no disk is inserted. Used both at machine reset (to emulate
   * the Autostart ROM's power-on disk boot) and by the $C600 boot stub
   * installed in attach() below (so PR#6 / a manual slot-6 invocation from
   * an already-running program works too, not just a cold power-on).
   */
  loadBootSectorInto(memory: Memory): boolean {
    if (!this.image) return false;
    const sector0 = this.image.tracks[0]!.subarray(0, SECTOR_SIZE);
    for (let i = 0; i < sector0.length; i++) memory.write(0x0800 + i, sector0[i]!);
    return true;
  }

  private layoutForCurrentTrack(): TrackLayout | null {
    if (!this.image) return null;
    const trackIndex = Math.min(TRACKS_PER_DISK - 1, this.currentTrack);
    if (this.currentLayout && this.currentLayoutTrack === trackIndex) return this.currentLayout;
    this.currentLayout = buildTrackLayout(this.image.tracks[trackIndex]!, trackIndex);
    this.currentLayoutTrack = trackIndex;
    this.headPos = 0;
    return this.currentLayout;
  }

  private stepPhase(phase: number, on: boolean): void {
    if (!on) return;
    if (this.lastActivePhase >= 0) {
      const forward = (this.lastActivePhase + 1) % 4;
      const backward = (this.lastActivePhase + 3) % 4;
      if (phase === forward) this.halfTrack = Math.min(TRACKS_PER_DISK * 2 - 2, this.halfTrack + 1);
      else if (phase === backward) this.halfTrack = Math.max(0, this.halfTrack - 1);
    }
    this.lastActivePhase = phase;
    this.currentLayout = null; // force re-fetch (may be a new track)
  }

  private readLatch(): number {
    const layout = this.layoutForCurrentTrack();
    if (!layout || layout.nibbles.length === 0) return 0;
    const value = layout.nibbles[this.headPos]!;
    this.headPos = (this.headPos + 1) % layout.nibbles.length;
    return value;
  }

  private writeLatch(value: number): void {
    const layout = this.layoutForCurrentTrack();
    if (!layout || !this.image) return;
    layout.nibbles[this.headPos] = value;

    const field = layout.dataFields.find(
      (f) => this.headPos >= f.start && this.headPos < f.start + DATA_FIELD_NIBBLE_COUNT,
    );
    if (field) {
      const localIndex = this.headPos - field.start;
      this.writeScratch[localIndex] = value;
      if (localIndex === DATA_FIELD_NIBBLE_COUNT - 1) {
        const decoded = decode6and2(this.writeScratch);
        if (decoded) {
          const trackIndex = this.currentLayoutTrack;
          this.image.tracks[trackIndex]!.set(decoded, field.sector * SECTOR_SIZE);
        }
      }
    }
    this.headPos = (this.headPos + 1) % layout.nibbles.length;
  }

  attach(memory: Memory): void {
    for (let phase = 0; phase < 4; phase++) {
      memory.registerIoRead(0xe0 + phase * 2, () => {
        this.stepPhase(phase, false);
        return 0;
      });
      memory.registerIoRead(0xe0 + phase * 2 + 1, () => {
        this.stepPhase(phase, true);
        return 0;
      });
    }
    memory.registerIoRead(0xe8, () => {
      this.motorOn = false;
      return 0;
    });
    memory.registerIoRead(0xe9, () => {
      this.motorOn = true;
      return 0;
    });
    // Drive select (single-drive emulator: accepted for real-hardware compatibility, not tracked).
    memory.registerIoRead(0xea, () => 0);
    memory.registerIoRead(0xeb, () => 0);
    memory.registerIoRead(0xec, () => (this.q7 ? 0 : this.readLatch()));
    memory.registerIoWrite(0xec, (_addr, value) => {
      if (this.q7) this.writeLatch(value);
    });
    memory.registerIoRead(0xed, () => 0); // write-protect sense: always reports "not protected"
    memory.registerIoRead(0xee, () => {
      this.q7 = false;
      return 0;
    });
    memory.registerIoRead(0xef, () => {
      this.q7 = true;
      return 0;
    });

    // Apple Disk II boot PROM stub at $C600.
    // The Apple Autostart ROM verifies slot 6 by checking $C601==$20, $C603==$00, $C605==$03.
    // Real Disk II PROM starts with: LDX #$20; LDY #$00; LDX #$03.
    // We add motor-on ($C0E9) and track-0 seek (phase 0) before loading the
    // boot sector — matching real hardware behavior where the drive spins and heads
    // seek to track 0 before any read attempt.  With no disk inserted, $C6FD returns
    // bytes that form JMP $C6FD — an infinite loop with motor on, just like real
    // hardware where the RWTS retries forever looking for sector headers.
    const bootStub = [
      0xa2, 0x20,       // $C600: LDX #$20   ($C601 = $20 ✓)
      0xa0, 0x00,       // $C602: LDY #$00   ($C603 = $00 ✓)
      0xa2, 0x03,       // $C604: LDX #$03   ($C605 = $03 ✓)
      0xad, 0xe9, 0xc0, // $C606: LDA $C0E9  (motor on)
      0xa9, 0x01,       // $C609: LDA #$01
      0x8d, 0xe0, 0xc0, // $C60B: STA $C0E0  (phase 0 on — seek track 0)
      0xa9, 0x00,       // $C60E: LDA #$00
      0x8d, 0xe2, 0xc0, // $C610: STA $C0E2  (phase 1 off)
      0x8d, 0xe4, 0xc0, // $C613: STA $C0E4  (phase 2 off)
      0x8d, 0xe6, 0xc0, // $C616: STA $C0E6  (phase 3 off)
      0x20, 0xfd, 0xc6, // $C619: JSR $C6FD  (load boot sector to $0800)
      0x4c, 0x01, 0x08, // $C61C: JMP $0801
    ];
    for (let i = 0; i < bootStub.length; i++) {
      const addr = 0xc600 + i;
      const byteVal = bootStub[i]!;
      memory.registerSlotOverlayRead(addr, () => byteVal);
    }
    // $C6FD: with disk → load boot sector + RTS; without disk → JMP $C6FD (spin forever)
    memory.registerSlotOverlayRead(0xc6fd, () => {
      if (this.image) {
        this.loadBootSectorInto(memory);
        return 0x60; // RTS
      }
      return 0x4c; // JMP — first byte
    });
    memory.registerSlotOverlayRead(0xc6fe, () => 0xfd); // JMP target lo
    memory.registerSlotOverlayRead(0xc6ff, () => 0xc6); // JMP target hi
  }
}

