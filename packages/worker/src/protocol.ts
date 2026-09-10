import { FPS, SCREEN_HEIGHT, SCREEN_WIDTH_80, type CpuKind, type DiskFormat } from "@apple2/core";

export type { CpuKind, DiskFormat };

// Frame geometry and frame rate come from core — single source of truth.
export const MAX_FRAME_WIDTH = SCREEN_WIDTH_80;
export const MAX_FRAME_HEIGHT = SCREEN_HEIGHT;
export const DEFAULT_SAMPLE_RATE = 44100;
export const AUDIO_CHANNELS = 2;
export const APPLE_II_FPS = FPS;
export const FRAME_INTERVAL_MS = 1000 / APPLE_II_FPS;
export const SAMPLES_PER_FRAME = Math.round(DEFAULT_SAMPLE_RATE / APPLE_II_FPS);

export type HostToWorkerMessage =
  | {
      type: "init";
      frameBuffer: SharedArrayBuffer | null;
      audioBuffer: SharedArrayBuffer | null;
      cpu?: CpuKind;
    }
  | { type: "loadRom"; rom: ArrayBuffer }
  | { type: "loadDisk"; format: DiskFormat; data: ArrayBuffer; drive?: number }
  | { type: "ejectDisk"; drive?: number }
  | { type: "keyEvent"; ascii: number; down: boolean }
  | { type: "paddleEvent"; index: number; value: number }
  | { type: "paddleButton"; index: number; down: boolean }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "reset" }
  | { type: "nmi" }
  | { type: "saveState" }
  | { type: "loadState"; data: ArrayBuffer }
  | { type: "exportDisk"; drive?: number };

export type WorkerToHostMessage =
  | { type: "ready" }
  | { type: "frame"; pixels: ArrayBuffer; width: number; height: number; audio: ArrayBuffer }
  | { type: "diskStatus"; drive: number; inserted: boolean; motorOn: boolean; track: number }
  | { type: "error"; message: string }
  | { type: "stateData"; data: ArrayBuffer }
  /** Replies to exportDisk. Empty data means no disk is inserted in that drive. */
  | { type: "diskData"; drive: number; format: DiskFormat; data: ArrayBuffer };

export const STEREO_SAMPLES_PER_FRAME = SAMPLES_PER_FRAME * AUDIO_CHANNELS;
export const AUDIO_CAPACITY_SAMPLES = DEFAULT_SAMPLE_RATE;
export const AUDIO_CAPACITY_FLOATS = AUDIO_CAPACITY_SAMPLES * AUDIO_CHANNELS;
export const FRAME_HEADER_INT32_LENGTH = 3;

export function frameBufferByteLength(
  maxWidth = MAX_FRAME_WIDTH,
  maxHeight = MAX_FRAME_HEIGHT,
): number {
  return FRAME_HEADER_INT32_LENGTH * 4 + maxWidth * maxHeight;
}

export const AUDIO_HEADER_INT32_LENGTH = 3;

export function audioBufferByteLength(capacityFloats = AUDIO_CAPACITY_FLOATS): number {
  return AUDIO_HEADER_INT32_LENGTH * 4 + capacityFloats * 4;
}
