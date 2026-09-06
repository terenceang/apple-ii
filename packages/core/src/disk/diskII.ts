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

interface DriveState {
  image: DiskImage | null;
  halfTrack: number;
  lastActivePhase: number;
  motorOn: boolean;
  headPos: number;
  currentLayout: TrackLayout | null;
  currentLayoutTrack: number;
  writeScratch: Uint8Array;
}

function createDriveState(): DriveState {
  return {
    image: null,
    halfTrack: 0,
    lastActivePhase: -1,
    motorOn: false,
    headPos: 0,
    currentLayout: null,
    currentLayoutTrack: -1,
    writeScratch: new Uint8Array(DATA_FIELD_NIBBLE_COUNT),
  };
}

/**
 * Disk II controller: stepper-motor track selection, motor on/off, and the
 * Q6/Q7 read/write latch at $C0EC-$C0EF. Supports two drives with independent
 * motor, track, and head-position state. Serves nibbles from a lazily-built,
 * fully-nibblized track image (see nibbleCodec.ts) rather than a cycle-timed
 * raw bitstream — real DOS 3.3/ProDOS RWTS code just loops reading the latch
 * until it finds the sync/prologue bytes it expects, so this is enough for
 * it to work without needing disk-rotation-accurate timing.
 */
export class DiskII {
  private readonly drives: [DriveState, DriveState] = [createDriveState(), createDriveState()];
  private selectedDrive = 0;
  private q7 = false;
  private motorRanThisFrame = false;

  get isMotorOn(): boolean {
    return this.drives[this.selectedDrive]!.motorOn;
  }

  get hasMotorActivity(): boolean {
    return this.isMotorOn || this.motorRanThisFrame;
  }

  resetMotorActivity(): void {
    this.motorRanThisFrame = false;
  }

  get currentTrack(): number {
    return Math.floor(this.drives[this.selectedDrive]!.halfTrack / 2);
  }

  get isWriteProtected(): boolean {
    return this.drives[this.selectedDrive]!.image?.writeProtected ?? false;
  }

  turnOffMotor(): void {
    for (const d of this.drives) d.motorOn = false;
    this.motorRanThisFrame = false;
  }

  insertDisk(image: DiskImage, drive = 0): void {
    const d = this.drives[drive]!;
    d.image = image;
    d.currentLayout = null;
    d.headPos = 0;
  }

  ejectDisk(drive?: number): DiskImage | null {
    const d = this.drives[drive ?? this.selectedDrive]!;
    const image = d.image;
    d.image = null;
    d.currentLayout = null;
    d.motorOn = false;
    this.motorRanThisFrame = false;
    return image;
  }

  getDisk(drive?: number): DiskImage | null {
    return this.drives[drive ?? this.selectedDrive]!.image;
  }

  /**
   * Reads track 0, physical sector 0 directly from the sector image (no
   * nibble encode/decode involved) and writes it to $0800, exactly what a
   * real Disk II boot PROM's entry point does. Returns false (writes
   * nothing) if no disk is inserted in the given drive. Used both at
   * machine reset (to emulate the Autostart ROM's power-on disk boot)
   * and by the $C600 boot stub installed in attach() below.
   */
  loadBootSectorInto(memory: Memory, drive = 0): boolean {
    const image = this.drives[drive]!.image;
    if (!image) return false;
    const sector0 = image.tracks[0]!.subarray(0, SECTOR_SIZE);
    for (let i = 0; i < sector0.length; i++) memory.write(0x0800 + i, sector0[i]!);
    return true;
  }

  private drive(): DriveState {
    return this.drives[this.selectedDrive]!;
  }

  private layoutForCurrentTrack(): TrackLayout | null {
    const d = this.drive();
    if (!d.image) return null;
    const trackIndex = Math.min(TRACKS_PER_DISK - 1, this.currentTrack);
    if (d.currentLayout && d.currentLayoutTrack === trackIndex) return d.currentLayout;
    d.currentLayout = buildTrackLayout(d.image.tracks[trackIndex]!, trackIndex);
    d.currentLayoutTrack = trackIndex;
    d.headPos = 0;
    return d.currentLayout;
  }

  private stepPhase(phase: number, on: boolean): void {
    if (!on) return;
    const d = this.drive();
    if (d.lastActivePhase >= 0) {
      const forward = (d.lastActivePhase + 1) % 4;
      const backward = (d.lastActivePhase + 3) % 4;
      if (phase === forward) d.halfTrack = Math.min(TRACKS_PER_DISK * 2 - 2, d.halfTrack + 1);
      else if (phase === backward) d.halfTrack = Math.max(0, d.halfTrack - 1);
    }
    d.lastActivePhase = phase;
    d.currentLayout = null;
  }

  private readLatch(): number {
    const layout = this.layoutForCurrentTrack();
    if (!layout || layout.nibbles.length === 0) return 0;
    const d = this.drive();
    const value = layout.nibbles[d.headPos]!;
    d.headPos = (d.headPos + 1) % layout.nibbles.length;
    return value;
  }

  private writeLatch(value: number): void {
    const layout = this.layoutForCurrentTrack();
    const d = this.drive();
    if (!layout || !d.image) return;
    if (d.image.writeProtected) return;
    layout.nibbles[d.headPos] = value;

    const field = layout.dataFields.find(
      (f) => d.headPos >= f.start && d.headPos < f.start + DATA_FIELD_NIBBLE_COUNT,
    );
    if (field) {
      const localIndex = d.headPos - field.start;
      d.writeScratch[localIndex] = value;
      if (localIndex === DATA_FIELD_NIBBLE_COUNT - 1) {
        const decoded = decode6and2(d.writeScratch);
        if (decoded) {
          const trackIndex = d.currentLayoutTrack;
          d.image.tracks[trackIndex]!.set(decoded, field.sector * SECTOR_SIZE);
        }
      }
    }
    d.headPos = (d.headPos + 1) % layout.nibbles.length;
  }

  attach(memory: Memory): void {
    for (let phase = 0; phase < 4; phase++) {
      const step = (on: boolean) => {
        this.stepPhase(phase, on);
        return 0;
      };
      memory.registerIoRead(0xe0 + phase * 2, () => step(false));
      memory.registerIoWrite(0xe0 + phase * 2, () => step(false));
      memory.registerIoRead(0xe0 + phase * 2 + 1, () => step(true));
      memory.registerIoWrite(0xe0 + phase * 2 + 1, () => step(true));
    }
    const setMotor = (on: boolean) => {
      this.drive().motorOn = on;
      if (on) this.motorRanThisFrame = true;
      return 0;
    };
    memory.registerIoRead(0xe8, () => setMotor(false));
    memory.registerIoWrite(0xe8, () => setMotor(false));
    memory.registerIoRead(0xe9, () => setMotor(true));
    memory.registerIoWrite(0xe9, () => setMotor(true));

    const selectDrive = (drive: number) => {
      this.selectedDrive = drive;
      return 0;
    };
    memory.registerIoRead(0xea, () => selectDrive(0));
    memory.registerIoWrite(0xea, () => selectDrive(0));
    memory.registerIoRead(0xeb, () => selectDrive(1));
    memory.registerIoWrite(0xeb, () => selectDrive(1));

    memory.registerIoRead(0xec, () => (this.q7 ? 0 : this.readLatch()));
    memory.registerIoWrite(0xec, (_addr, value) => {
      if (this.q7) this.writeLatch(value);
    });
    memory.registerIoRead(0xed, () => (this.isWriteProtected ? 0x80 : 0));
    memory.registerIoRead(0xee, () => {
      this.q7 = false;
      return 0;
    });
    memory.registerIoWrite(0xee, () => {
      this.q7 = false;
    });
    memory.registerIoRead(0xef, () => {
      this.q7 = true;
      return 0;
    });
    memory.registerIoWrite(0xef, () => {
      this.q7 = true;
    });

    // Apple Disk II boot PROM stub at $C600.
    // The Apple Autostart ROM verifies slot 6 by checking $C601==$20, $C603==$00, $C605==$03.
    // Real Disk II PROM starts with: LDX #$20; LDY #$00; LDX #$03.
    // We add motor-on ($C0E9) and track-0 seek (phase 0) before loading the
    // boot sector — matching real hardware behavior where the drive spins and heads
    // seek to track 0 before any read attempt. With no disk inserted, $C6FD returns
    // bytes that form JMP $C6FD — an infinite loop with motor on, just like real
    // hardware where the RWTS retries forever looking for sector headers.
    const bootStub = [
      0xa2, 0x20,       // $C600: LDX #$20   ($C601 = $20 ✓)
      0xa0, 0x00,       // $C602: LDY #$00   ($C603 = $00 ✓)
      0xa2, 0x03,       // $C604: LDX #$03   ($C605 = $03 ✓)
      0xad, 0xea, 0xc0, // $C606: LDA $C0EA  (select drive 1)
      0xad, 0xe9, 0xc0, // $C609: LDA $C0E9  (motor on)
      0xa9, 0x01,       // $C60C: LDA #$01
      0x8d, 0xe0, 0xc0, // $C60E: STA $C0E0  (phase 0 on — seek track 0)
      0xa9, 0x00,       // $C611: LDA #$00
      0x8d, 0xe2, 0xc0, // $C613: STA $C0E2  (phase 1 off)
      0x8d, 0xe4, 0xc0, // $C616: STA $C0E4  (phase 2 off)
      0x8d, 0xe6, 0xc0, // $C619: STA $C0E6  (phase 3 off)
      0x20, 0xfd, 0xc6, // $C61C: JSR $C6FD  (load boot sector to $0800)
      0x4c, 0x01, 0x08, // $C61F: JMP $0801
    ];
    for (let i = 0; i < bootStub.length; i++) {
      const addr = 0xc600 + i;
      const byteVal = bootStub[i]!;
      memory.registerSlotOverlayRead(addr, () => byteVal);
    }
    // $C6FD: with disk → load boot sector + RTS; without disk → JMP $C6FD (spin forever)
    memory.registerSlotOverlayRead(0xc6fd, () => {
      if (this.getDisk(0)) {
        this.loadBootSectorInto(memory, 0);
        return 0x60; // RTS
      }
      return 0x4c; // JMP — first byte
    });
    memory.registerSlotOverlayRead(0xc6fe, () => 0xfd); // JMP target lo
    memory.registerSlotOverlayRead(0xc6ff, () => 0xc6); // JMP target hi
  }
}
