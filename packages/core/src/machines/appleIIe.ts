import { Speaker } from "../audio/speaker.js";
import { Mos6502 } from "../cpu/mos6502.js";
import type { DiskImage } from "../disk/dsk.js";
import { DiskII } from "../disk/diskII.js";
import { Keyboard } from "../io/keyboard.js";
import { Paddle } from "../io/paddle.js";
import { Memory } from "../memory/memory.js";
import {
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
  SCREEN_WIDTH_80,
  VideoState,
  renderFrame,
} from "../video/videoEngine.js";

/** ~1.023MHz NTSC Apple II clock / 60 frames-per-second. */
export const CYCLES_PER_FRAME = 17048;
export const FPS = 60;

const FLASH_HALF_PERIOD_FRAMES = 15; // ~4 toggles/sec at 60fps, close to real hardware's blink rate

export interface Frame {
  pixels: Uint8Array;
  width: number;
  height: number;
}

export class AppleIIe {
  readonly memory = new Memory();
  readonly cpu = new Mos6502(this.memory);
  readonly keyboard = new Keyboard();
  readonly speaker = new Speaker();
  readonly paddle = new Paddle();
  readonly video = new VideoState();
  readonly disk = new DiskII();

  private flashCounter = 0;
  private frameCycles = 0;

  constructor() {
    this.memory.attach();
    this.video.attach(this.memory);
    this.keyboard.attach(this.memory);
    this.keyboard.onBreak = () => {
      this.cpu.nmiPending = true;
      this.disk.turnOffMotor();
    };
    this.speaker.attach(this.memory);
    this.disk.attach(this.memory);
    this.paddle.attach(this.memory, () => this.frameCycles);
  }

  loadRom(bytes: Uint8Array): void {
    this.memory.loadRom(bytes);
  }

  reset(): void {
    this.memory.reset();
    this.cpu.reset();
    this.speaker.reset();
    this.disk.turnOffMotor();
    const resetVector = this.memory.read(0xfffc) | (this.memory.read(0xfffd) << 8);
    // If running with a non-autostart test ROM (e.g. mock NOP ROM used in unit tests),
    // emulate the hardware power-on shortcut directly into the loaded boot sector.
    if (resetVector !== 0xfa62 && this.disk.loadBootSectorInto(this.memory)) {
      this.cpu.pc = 0x0801;
    }
  }

  insertDisk(image: DiskImage): void {
    this.disk.insertDisk(image);
  }

  ejectDisk(): DiskImage | null {
    return this.disk.ejectDisk();
  }

  runFrame(): void {
    this.frameCycles = 0;
    this.disk.resetMotorActivity();
    while (this.frameCycles < CYCLES_PER_FRAME) {
      this.speaker.currentCycle = this.frameCycles;
      this.frameCycles += this.cpu.step();
    }
    this.flashCounter = (this.flashCounter + 1) % (FLASH_HALF_PERIOD_FRAMES * 2);
  }

  getFrameBuffer(): Frame {
    const flashOn = this.flashCounter >= FLASH_HALF_PERIOD_FRAMES;
    const pixels = renderFrame(this.memory, this.video, flashOn);
    const is80 = this.video.col80 && this.video.textMode;
    return { pixels, width: is80 ? SCREEN_WIDTH_80 : SCREEN_WIDTH, height: SCREEN_HEIGHT };
  }

  /** Returns `count` interleaved stereo samples (L,R,L,R,...) for the frame just rendered. */
  getStereoAudioSamples(count: number): Float32Array {
    return this.speaker.renderFrame(count, CYCLES_PER_FRAME);
  }
}
