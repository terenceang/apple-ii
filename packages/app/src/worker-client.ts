import type { DiskFormat } from "@apple2/core";
import {
  AUDIO_CAPACITY_FLOATS,
  MAX_FRAME_HEIGHT,
  MAX_FRAME_WIDTH,
  audioBufferByteLength,
  frameBufferByteLength,
  type HostToWorkerMessage,
  type WorkerToHostMessage,
} from "../../worker/src/protocol.js";
import { FrameRingReader } from "../../worker/src/ring-buffers.js";

export type Frame = { pixels: Uint8Array; width: number; height: number };
export type ExportedDisk = { format: DiskFormat; data: ArrayBuffer };

export class EmulatorClient {
  private readonly worker: Worker;
  private readonly frameReader: FrameRingReader | null = null;
  readonly usesSharedMemory: boolean;
  readonly audioBuffer: SharedArrayBuffer | null = null;
  readonly audioCapacitySamples = AUDIO_CAPACITY_FLOATS;

  private latestFallbackFrame: Frame | null = null;
  private latestFallbackAudio: Float32Array | null = null;
  private fallbackFrameCount = 0;
  private readonly pendingStateRequests: ((data: ArrayBuffer) => void)[] = [];
  private readonly pendingDiskRequests: ((disk: ExportedDisk | null) => void)[] = [];

  onReady?: () => void;
  onError?: (message: string) => void;
  onDiskStatus?: (status: { drive: number; inserted: boolean; motorOn: boolean; track: number }) => void;

  constructor() {
    this.worker = new Worker(new URL("../../worker/src/emulator.worker.ts", import.meta.url), {
      type: "module",
    });

    this.worker.onerror = (e) => {
      this.onError?.(e.message || "Worker error");
    };

    this.usesSharedMemory = typeof SharedArrayBuffer !== "undefined";
    let frameBuffer: SharedArrayBuffer | null = null;
    let audioBuffer: SharedArrayBuffer | null = null;

    if (this.usesSharedMemory) {
      frameBuffer = new SharedArrayBuffer(frameBufferByteLength(MAX_FRAME_WIDTH, MAX_FRAME_HEIGHT));
      audioBuffer = new SharedArrayBuffer(audioBufferByteLength(AUDIO_CAPACITY_FLOATS));
      this.frameReader = new FrameRingReader(frameBuffer, MAX_FRAME_WIDTH, MAX_FRAME_HEIGHT);
      this.audioBuffer = audioBuffer;
    }

    this.worker.onmessage = (event: MessageEvent<WorkerToHostMessage>) => {
      const message = event.data;
      if (message.type === "ready") this.onReady?.();
      else if (message.type === "error") this.onError?.(message.message);
      else if (message.type === "diskStatus") {
        this.onDiskStatus?.({
          drive: message.drive,
          inserted: message.inserted,
          motorOn: message.motorOn,
          track: message.track,
        });
      } else if (message.type === "frame") {
        this.fallbackFrameCount++;
        this.latestFallbackFrame = {
          pixels: new Uint8Array(message.pixels),
          width: message.width,
          height: message.height,
        };
        this.latestFallbackAudio = new Float32Array(message.audio);
      } else if (message.type === "stateData") {
        this.pendingStateRequests.shift()?.(message.data);
      } else if (message.type === "diskData") {
        const resolve = this.pendingDiskRequests.shift();
        if (resolve) {
          resolve(message.data.byteLength === 0 ? null : { format: message.format, data: message.data });
        }
      }
    };

    this.send({ type: "init", frameBuffer, audioBuffer });
  }

  private send(message: HostToWorkerMessage, transfer?: Transferable[]): void {
    if (transfer) this.worker.postMessage(message, transfer);
    else this.worker.postMessage(message);
  }

  loadRom(rom: ArrayBuffer): void {
    this.send({ type: "loadRom", rom }, [rom]);
  }

  loadDisk(format: DiskFormat, data: ArrayBuffer, drive = 0): void {
    this.send({ type: "loadDisk", format, data, drive }, [data]);
  }

  ejectDisk(drive = 0): void {
    this.send({ type: "ejectDisk", drive });
  }

  sendKey(ascii: number, down: boolean): void {
    this.send({ type: "keyEvent", ascii, down });
  }

  sendPaddle(index: number, value: number): void {
    this.send({ type: "paddleEvent", index, value });
  }

  sendPaddleButton(index: number, down: boolean): void {
    this.send({ type: "paddleButton", index, down });
  }

  pause(): void {
    this.send({ type: "pause" });
  }

  resume(): void {
    this.send({ type: "resume" });
  }

  reset(): void {
    this.send({ type: "reset" });
  }

  sendNmi(): void {
    this.send({ type: "nmi" });
  }

  saveState(): Promise<ArrayBuffer> {
    return new Promise((resolve) => {
      this.pendingStateRequests.push(resolve);
      this.send({ type: "saveState" });
    });
  }

  loadState(data: ArrayBuffer): void {
    this.send({ type: "loadState", data }, [data]);
  }

  /** Returns the live (possibly written-to) disk image bytes, or null if the drive is empty. */
  exportDisk(drive = 0): Promise<ExportedDisk | null> {
    return new Promise((resolve) => {
      this.pendingDiskRequests.push(resolve);
      this.send({ type: "exportDisk", drive });
    });
  }

  pollFrame(): Frame | null {
    if (this.frameReader) return this.frameReader.read();
    const f = this.latestFallbackFrame;
    this.latestFallbackFrame = null;
    return f;
  }

  getFrameCount(): number {
    if (this.frameReader) {
      return Math.floor(this.frameReader.getSequence() / 2);
    }
    return this.fallbackFrameCount;
  }

  takeFallbackAudio(): Float32Array | null {
    const a = this.latestFallbackAudio;
    this.latestFallbackAudio = null;
    return a;
  }
}
