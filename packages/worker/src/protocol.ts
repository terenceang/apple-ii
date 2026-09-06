import type { DiskFormat } from "@apple2/core";

export type { DiskFormat };

export type HostToWorkerMessage =
  | { type: "init"; frameBuffer: SharedArrayBuffer | null; audioBuffer: SharedArrayBuffer | null }
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
  | { type: "loadState"; data: ArrayBuffer };

export type WorkerToHostMessage =
  | { type: "ready" }
  | { type: "frame"; pixels: ArrayBuffer; width: number; height: number; audio: ArrayBuffer }
  | { type: "diskStatus"; drive: number; inserted: boolean; motorOn: boolean; track: number }
  | { type: "error"; message: string }
  | { type: "stateData"; data: ArrayBuffer };

export const MAX_FRAME_WIDTH = 560;
export const MAX_FRAME_HEIGHT = 192;
export const DEFAULT_SAMPLE_RATE = 44100;
export const AUDIO_CHANNELS = 2;
export const APPLE_II_FPS = 60;
export const FRAME_INTERVAL_MS = 1000 / APPLE_II_FPS;
export const SAMPLES_PER_FRAME = Math.round(DEFAULT_SAMPLE_RATE / APPLE_II_FPS);
export const STEREO_SAMPLES_PER_FRAME = SAMPLES_PER_FRAME * AUDIO_CHANNELS;
export const AUDIO_CAPACITY_SAMPLES = 44100;
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
