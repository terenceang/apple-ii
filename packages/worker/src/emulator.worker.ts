import { AppleIIe, loadState as applyState, parseDsk, saveState } from "@apple2/core";
import { AudioRing, FrameRingWriter } from "./ring-buffers.js";
import {
  AUDIO_CAPACITY_FLOATS,
  FRAME_INTERVAL_MS,
  MAX_FRAME_HEIGHT,
  MAX_FRAME_WIDTH,
  SAMPLES_PER_FRAME,
  type HostToWorkerMessage,
  type WorkerToHostMessage,
} from "./protocol.js";

const machine = new AppleIIe();

let frameWriter: FrameRingWriter | null = null;
let audioRing: AudioRing | null = null;
let running = false;
let timer: ReturnType<typeof setInterval> | null = null;
let lastDiskMotor = false;
let lastDiskInserted = false;
let lastDiskTrack = -1;
let motorHoldFrames = 0;
const MOTOR_HOLD_FRAMES = 8;

// Real Disk II boots (this DOS 3.3 System Master disk in particular) can take
// well over a minute of real 1MHz Apple II time. While the drive motor is
// spinning, run extra emulated frames per timer tick so disk activity
// fast-forwards; video/audio for the skipped frames is simply discarded
// (only the last frame in the batch is ever shown/heard), so this only
// affects wall-clock time, not the emulated CPU's behavior.
const FAST_FORWARD_EXTRA_FRAMES = 8;

function post(message: WorkerToHostMessage, transfer?: Transferable[]): void {
  if (transfer) self.postMessage(message, transfer);
  else self.postMessage(message);
}

function tick(): void {
  try {
    for (let i = 0; i < FAST_FORWARD_EXTRA_FRAMES && machine.disk.isMotorOn; i++) {
      machine.runFrame();
      machine.getStereoAudioSamples(SAMPLES_PER_FRAME); // discard; keeps speaker edge log from bleeding across frames
    }
    machine.runFrame();
    const { pixels, width, height } = machine.getFrameBuffer();
    const audio = machine.getStereoAudioSamples(SAMPLES_PER_FRAME);

    const inserted = machine.disk.getDisk(0) !== null;
    const rawMotorOn = machine.disk.hasMotorActivity;
    if (rawMotorOn) {
      motorHoldFrames = MOTOR_HOLD_FRAMES;
    } else if (motorHoldFrames > 0) {
      motorHoldFrames--;
    }
    const motorOn = rawMotorOn || motorHoldFrames > 0;
    const track = machine.disk.currentTrack;
    if (inserted !== lastDiskInserted || motorOn !== lastDiskMotor || track !== lastDiskTrack) {
      lastDiskInserted = inserted;
      lastDiskMotor = motorOn;
      lastDiskTrack = track;
      post({ type: "diskStatus", inserted, motorOn, track });
    }

    if (frameWriter && audioRing) {
      frameWriter.write(pixels, width, height);
      audioRing.write(audio);
    } else {
      const pixelsCopy = pixels.slice().buffer;
      const audioCopy = audio.slice().buffer;
      post({ type: "frame", pixels: pixelsCopy, width, height, audio: audioCopy }, [
        pixelsCopy,
        audioCopy,
      ]);
    }
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
    stop();
  }
}

function start(): void {
  if (running) return;
  running = true;
  timer = setInterval(tick, FRAME_INTERVAL_MS);
}

function stop(): void {
  running = false;
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

self.onmessage = (event: MessageEvent<HostToWorkerMessage>) => {
  const message = event.data;
  switch (message.type) {
    case "init": {
      if (message.frameBuffer && message.audioBuffer) {
        frameWriter = new FrameRingWriter(message.frameBuffer, MAX_FRAME_WIDTH, MAX_FRAME_HEIGHT);
        audioRing = new AudioRing(message.audioBuffer, AUDIO_CAPACITY_FLOATS);
      }
      post({ type: "ready" });
      break;
    }
    case "loadRom": {
      machine.loadRom(new Uint8Array(message.rom));
      break;
    }
    case "loadDisk": {
      const bytes = new Uint8Array(message.data);
      const disk = parseDsk(bytes, message.format);
      machine.insertDisk(disk);
      lastDiskInserted = true;
      lastDiskMotor = machine.disk.isMotorOn;
      lastDiskTrack = machine.disk.currentTrack;
      post({
        type: "diskStatus",
        inserted: true,
        motorOn: lastDiskMotor,
        track: lastDiskTrack,
      });
      break;
    }
    case "ejectDisk": {
      machine.ejectDisk();
      motorHoldFrames = 0;
      lastDiskInserted = false;
      lastDiskMotor = false;
      lastDiskTrack = 0;
      post({ type: "diskStatus", inserted: false, motorOn: false, track: 0 });
      break;
    }
    case "keyEvent": {
      machine.keyboard.setKey(message.ascii, message.down);
      break;
    }
    case "paddleEvent": {
      machine.paddle.setValue(message.index, message.value);
      break;
    }
    case "paddleButton": {
      machine.paddle.setButton(message.index, message.down);
      break;
    }
    case "pause": {
      stop();
      break;
    }
    case "resume": {
      start();
      break;
    }
    case "reset": {
      machine.reset();
      motorHoldFrames = 0;
      lastDiskInserted = machine.disk.getDisk(0) !== null;
      lastDiskMotor = false;
      lastDiskTrack = machine.disk.currentTrack;
      post({
        type: "diskStatus",
        inserted: lastDiskInserted,
        motorOn: false,
        track: lastDiskTrack,
      });
      start();
      break;
    }
    case "nmi": {
      machine.cpu.nmiPending = true;
      break;
    }
    case "saveState": {
      const data = saveState(machine);
      const buffer = data.buffer as ArrayBuffer;
      post({ type: "stateData", data: buffer }, [buffer]);
      break;
    }
    case "loadState": {
      applyState(machine, new Uint8Array(message.data));
      start();
      break;
    }
  }
};
