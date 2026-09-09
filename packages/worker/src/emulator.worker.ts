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
interface DriveReportState {
  inserted: boolean;
  motorOn: boolean;
  track: number;
  motorHoldFrames: number;
}

const driveReports: [DriveReportState, DriveReportState] = [
  { inserted: false, motorOn: false, track: -1, motorHoldFrames: 0 },
  { inserted: false, motorOn: false, track: -1, motorHoldFrames: 0 },
];
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

/** Posts one diskStatus message, preferring explicit overrides over live machine state. */
function postDriveStatus(drive: number, status?: Partial<{ inserted: boolean; motorOn: boolean; track: number }>): void {
  const inserted = status?.inserted ?? machine.disk.getDisk(drive) !== null;
  const motorOn = status?.motorOn ?? machine.disk.isDriveMotorOn(drive);
  const track = status?.track ?? machine.disk.getDriveTrack(drive);
  const rep = driveReports[drive]!;
  rep.inserted = inserted;
  rep.motorOn = motorOn;
  rep.track = track;
  post({ type: "diskStatus", drive, inserted, motorOn, track });
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

    for (let d = 0; d < 2; d++) {
      const rep = driveReports[d]!;
      const inserted = machine.disk.getDisk(d) !== null;
      const rawMotorOn = machine.disk.hasDriveMotorActivity(d);
      if (rawMotorOn) {
        rep.motorHoldFrames = MOTOR_HOLD_FRAMES;
      } else if (rep.motorHoldFrames > 0) {
        rep.motorHoldFrames--;
      }
      const motorOn = rawMotorOn || rep.motorHoldFrames > 0;
      const track = machine.disk.getDriveTrack(d);
      if (inserted !== rep.inserted || motorOn !== rep.motorOn || track !== rep.track) {
        rep.inserted = inserted;
        rep.motorOn = motorOn;
        rep.track = track;
        post({ type: "diskStatus", drive: d, inserted, motorOn, track });
      }
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
      const drive = message.drive ?? 0;
      const bytes = new Uint8Array(message.data);
      const disk = parseDsk(bytes, message.format);
      machine.insertDisk(disk, drive);
      postDriveStatus(drive, { inserted: true });
      break;
    }
    case "ejectDisk": {
      const drive = message.drive ?? 0;
      machine.ejectDisk(drive);
      driveReports[drive]!.motorHoldFrames = 0;
      postDriveStatus(drive, { inserted: false, motorOn: false, track: 0 });
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
      for (let d = 0; d < 2; d++) {
        driveReports[d]!.motorHoldFrames = 0;
        postDriveStatus(d, { motorOn: false });
      }
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
