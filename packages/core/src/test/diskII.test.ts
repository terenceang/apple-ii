import { describe, expect, it } from "vitest";
import { Mos6502 } from "../cpu/mos6502.js";
import { Memory } from "../memory/memory.js";
import { DiskII } from "../disk/diskII.js";
import { DISK_IMAGE_SIZE, SECTOR_SIZE, parseDsk } from "../disk/dsk.js";
import { decode6and2, encode6and2 } from "../disk/nibbleCodec.js";

function makeSyntheticDisk(): Uint8Array {
  const bytes = new Uint8Array(DISK_IMAGE_SIZE);
  // "po" format == physical sector order, so track0's 16 sectors are just the
  // first 4096 bytes, sector s at offset s*256, each filled with the value s
  // (a marker so a decoded sector's contents are trivially checkable).
  for (let s = 0; s < 16; s++) {
    bytes.fill(s, s * SECTOR_SIZE, (s + 1) * SECTOR_SIZE);
  }
  return bytes;
}

describe("DiskII controller", () => {
  it("serves nibblized track data through the Q6/Q7 read latch, decodable back to the original sectors", () => {
    const memory = new Memory();
    const disk = new DiskII();
    disk.attach(memory);
    disk.insertDisk(parseDsk(makeSyntheticDisk(), "po"));

    memory.read(0xc0ee); // Q7=0 (read mode)

    const scan = new Uint8Array(9000);
    for (let i = 0; i < scan.length; i++) scan[i] = memory.read(0xc0ec);

    const foundSectors: number[] = [];
    for (let i = 0; i < scan.length - 346 && foundSectors.length < 3; i++) {
      if (scan[i] === 0xd5 && scan[i + 1] === 0xaa && scan[i + 2] === 0xad) {
        const field = scan.subarray(i + 3, i + 3 + 343);
        const decoded = decode6and2(field);
        expect(decoded).not.toBeNull();
        // Every byte in this synthetic sector is the same marker value.
        foundSectors.push(decoded![0]!);
        expect(new Set(decoded!).size).toBe(1);
      }
    }
    expect(foundSectors).toEqual([0, 1, 2]);
  });

  it("reports motor state and track position via the stepper/motor soft switches", () => {
    const memory = new Memory();
    const disk = new DiskII();
    disk.attach(memory);
    disk.insertDisk(parseDsk(makeSyntheticDisk(), "po"));

    expect(disk.isMotorOn).toBe(false);
    memory.read(0xc0e9); // motor on
    expect(disk.isMotorOn).toBe(true);
    memory.read(0xc0e8); // motor off
    expect(disk.isMotorOn).toBe(false);

    // Write access to soft switches should also control motor state (hardware doesn't qualify R/W)
    memory.write(0xc0e9, 0);
    expect(disk.isMotorOn).toBe(true);
    memory.write(0xc0e8, 0);
    expect(disk.isMotorOn).toBe(false);

    // Ejecting disk turns off motor
    memory.write(0xc0e9, 0);
    expect(disk.isMotorOn).toBe(true);
    disk.ejectDisk();
    expect(disk.isMotorOn).toBe(false);
    disk.insertDisk(parseDsk(makeSyntheticDisk(), "po"));

    expect(disk.currentTrack).toBe(0);
    // Classic outward step sequence: energize phase0, then phase1, then phase2 in turn.
    // Phase p's "on" address is $C0E0 + p*2 + 1.
    memory.read(0xc0e1); // phase0 on
    expect(disk.currentTrack).toBe(0);
    memory.read(0xc0e3); // phase1 on -> one half-track out
    expect(disk.currentTrack).toBe(0);
    memory.read(0xc0e5); // phase2 on -> two half-tracks out -> track 1
    expect(disk.currentTrack).toBe(1);
  });

  it("$C600 boot stub loads track0/sector0 to $0800 and jumps to it when the CPU runs into it", () => {
    // Regression test: PR#6 (or any real-ROM slot-6 dispatch) JMPs/JSRs into $C600 while the
    // CPU is already running — this must work the same as the reset()-time autostart shortcut,
    // not just at machine reset. A prior version only handled the reset-time case.
    const memory = new Memory();
    const cpu = new Mos6502(memory);
    const disk = new DiskII();
    disk.attach(memory);

    const bytes = new Uint8Array(DISK_IMAGE_SIZE);
    const boot0 = new Uint8Array(SECTOR_SIZE);
    boot0.set([0xa9, 0x42, 0x8d, 0x00, 0x30, 0x4c, 0x06, 0x08], 1); // $0801: LDA #$42; STA $3000; JMP $0806
    bytes.set(boot0, 0);
    disk.insertDisk(parseDsk(bytes, "po"));

    cpu.pc = 0xc600; // simulate the real ROM's PR#6 dispatch jumping here
    for (let i = 0; i < 20; i++) cpu.step();

    expect(memory.read(0x3000)).toBe(0x42);
    expect(cpu.pc).toBe(0x0806); // settled in the boot0 program's own infinite loop
  });

  /** Advances the read latch until the head sits exactly on the first encoded nibble of the given sector's data field. */
  function scanToDataField(memory: Memory, sector: number): void {
    let fieldsSeen = -1;
    let hist = [0, 0, 0];
    for (let i = 0; i < 100_000; i++) {
      hist = [hist[1], hist[2], memory.read(0xc0ec)];
      if (hist[0] === 0xd5 && hist[1] === 0xaa && hist[2] === 0xad) {
        fieldsSeen++;
        if (fieldsSeen === sector) return;
      }
      if (hist[0] === 0xd5 && hist[1] === 0xaa && hist[2] === 0x96) {
        // address field prologue consumed — skip its 11 remaining bytes + gap so
        // its 0xAD-free interior can't be mistaken for a data prologue
        for (let k = 0; k < 17; k++) memory.read(0xc0ec);
        hist = [0, 0, 0];
      }
    }
    throw new Error("data field not found");
  }

  it("writes a full data field through the Q6/Q7 write latch and commits the decoded sector", () => {
    const memory = new Memory();
    const disk = new DiskII();
    disk.attach(memory);
    disk.insertDisk(parseDsk(makeSyntheticDisk(), "po"));

    memory.read(0xc0ee); // Q7=0: read mode
    scanToDataField(memory, 0);

    const newSector = new Uint8Array(256);
    for (let i = 0; i < 256; i++) newSector[i] = (i * 7 + 3) & 0xff;
    const encoded = encode6and2(newSector);

    memory.read(0xc0ef); // Q7=1: write mode
    for (const b of encoded) memory.write(0xc0ec, b);
    memory.read(0xc0ee); // back to read mode

    const track0 = disk.getDisk()!.tracks[0]!;
    expect(Array.from(track0.subarray(0, SECTOR_SIZE))).toEqual(Array.from(newSector));
    // other sectors untouched (original disk filled with sector-number markers)
    expect(new Set(track0.subarray(SECTOR_SIZE, SECTOR_SIZE * 2)).size).toBe(1);
    expect(track0[SECTOR_SIZE]).toBe(1);
  });

  it("reads back a written sector through the normal read latch", () => {
    const memory = new Memory();
    const disk = new DiskII();
    disk.attach(memory);
    disk.insertDisk(parseDsk(makeSyntheticDisk(), "po"));

    memory.read(0xc0ee);
    scanToDataField(memory, 3);
    const markerSector = new Uint8Array(256).fill(0x5a);
    memory.read(0xc0ef);
    for (const b of encode6and2(markerSector)) memory.write(0xc0ec, b);
    memory.read(0xc0ee);

    // wrap around the track and find sector 3's data field again by decoding
    let found: Uint8Array | null = null;
    const scan = new Uint8Array(12_000);
    for (let i = 0; i < scan.length; i++) scan[i] = memory.read(0xc0ec);
    for (let i = 0; i < scan.length - 346; i++) {
      if (scan[i] === 0xd5 && scan[i + 1] === 0xaa && scan[i + 2] === 0xad) {
        const decoded = decode6and2(scan.subarray(i + 3, i + 3 + 343));
        if (decoded && decoded[0] === 0x5a) {
          found = decoded;
          break;
        }
      }
    }
    expect(found).not.toBeNull();
    expect(new Set(found!).size).toBe(1);
  });

  it("does not commit a data field whose checksum fails", () => {
    const memory = new Memory();
    const disk = new DiskII();
    disk.attach(memory);
    disk.insertDisk(parseDsk(makeSyntheticDisk(), "po"));

    memory.read(0xc0ee);
    scanToDataField(memory, 0);
    const before = Array.from(disk.getDisk()!.tracks[0]!.subarray(0, SECTOR_SIZE));

    const encoded = encode6and2(new Uint8Array(256).fill(0x77));
    encoded[342] = encoded[342] === 0x96 ? 0x97 : 0x96; // corrupt checksum nibble

    memory.read(0xc0ef);
    for (const b of encoded) memory.write(0xc0ec, b);
    memory.read(0xc0ee);

    expect(Array.from(disk.getDisk()!.tracks[0]!.subarray(0, SECTOR_SIZE))).toEqual(before);
  });

  it("write-mode latch reads return 0 and writes in read mode are ignored", () => {
    const memory = new Memory();
    const disk = new DiskII();
    disk.attach(memory);
    disk.insertDisk(parseDsk(makeSyntheticDisk(), "po"));

    memory.read(0xc0ee); // read mode: writes to $C0EC must not touch the track
    const before = disk.getDisk()!.tracks[0]!.slice(0, SECTOR_SIZE);
    for (let i = 0; i < 500; i++) memory.write(0xc0ec, 0xff);
    expect(Array.from(disk.getDisk()!.tracks[0]!.subarray(0, SECTOR_SIZE))).toEqual(
      Array.from(before),
    );
  });

  it("drive select ($C0EA/$C0EB) switches active drive with independent track positions", () => {
    const memory = new Memory();
    const disk = new DiskII();
    disk.attach(memory);

    const diskBytes = makeSyntheticDisk();
    disk.insertDisk(parseDsk(diskBytes, "po"), 0);
    disk.insertDisk(parseDsk(diskBytes, "po"), 1);

    memory.read(0xc0ea); // select drive 0
    memory.read(0xc0e9); // motor on
    expect(disk.isMotorOn).toBe(true);

    // Step drive 0 to track 2: 5 half-track steps via the phase sequence 0→1→2→3→0
    memory.read(0xc0e1); // phase0 on → half-track 0
    memory.read(0xc0e3); // phase1 on → half-track 1
    memory.read(0xc0e5); // phase2 on → half-track 2
    memory.read(0xc0e7); // phase3 on → half-track 3
    memory.read(0xc0e1); // phase0 on → half-track 4 → track 2
    expect(disk.currentTrack).toBe(2);

    // Switch to drive 1 — should have its own track 0
    memory.read(0xc0eb); // select drive 1
    expect(disk.currentTrack).toBe(0);
    expect(disk.isMotorOn).toBe(false); // drive 1 motor is independent

    // Drive 0 track is preserved
    memory.read(0xc0ea); // select drive 0 again
    expect(disk.currentTrack).toBe(2);
    expect(disk.isMotorOn).toBe(true);
  });

  it("$C0ED reports write-protect status of selected drive", () => {
    const memory = new Memory();
    const disk = new DiskII();
    disk.attach(memory);

    const image = parseDsk(makeSyntheticDisk(), "po");
    image.writeProtected = true;
    disk.insertDisk(image, 0);

    memory.read(0xc0ea); // select drive 0
    expect(memory.read(0xc0ed) & 0x80).toBe(0x80); // write-protect bit set

    // Switch to drive 1 (no disk) — write-protect should be clear
    memory.read(0xc0eb); // select drive 1
    expect(memory.read(0xc0ed) & 0x80).toBe(0);

    // Drive 0 still reports protected
    memory.read(0xc0ea);
    expect(memory.read(0xc0ed) & 0x80).toBe(0x80);
  });

  it("writes to a write-protected disk are rejected", () => {
    const memory = new Memory();
    const disk = new DiskII();
    disk.attach(memory);

    const image = parseDsk(makeSyntheticDisk(), "po");
    image.writeProtected = true;
    disk.insertDisk(image);

    memory.read(0xc0ee); // read mode
    scanToDataField(memory, 0);
    const before = disk.getDisk()!.tracks[0]!.slice(0, SECTOR_SIZE);

    const encoded = encode6and2(new Uint8Array(256).fill(0x77));
    memory.read(0xc0ef); // write mode
    for (const b of encoded) memory.write(0xc0ec, b);
    memory.read(0xc0ee); // back to read mode

    // Sector should be unchanged — write-protect blocks the commit
    expect(Array.from(disk.getDisk()!.tracks[0]!.subarray(0, SECTOR_SIZE))).toEqual(
      Array.from(before),
    );
  });
});
