import {
  MCP_BRIDGE_PORT,
  ROM_CHIP_SIZE,
  ROM_SIZE,
  ROM_SIZE_BASIC_MONITOR,
  ROM_SIZE_COMBINED_32K,
  diskFormatFromPath,
  type BridgeCommand as McpBridgeCommand,
} from "@apple2/core";
import { AudioSink } from "./audio/audioSink.js";
import { isInteractiveElement, keyEventToAscii } from "./input/keyMapping.js";
import {
  DEFAULT_PADDLE_KEY_BINDINGS,
  PADDLE_DIRECTIONS,
  loadPaddleKeyBindings,
  loadPaddleType,
  savePaddleKeyBindings,
  savePaddleType,
  type PaddleDirection,
  type PaddleInputType,
} from "./input/paddleMapping.js";
import { Display } from "./ui/display.js";
import { createDriveUi, type DriveUi } from "./ui/driveUi.js";
import { loadSessionMedia, saveSessionMedia, type StoredMedia } from "./ui/sessionStore.js";
import { loadRom as loadRomFromStorage, saveRom as saveRomToStorage } from "./ui/romStorage.js";
import { clearAllClientStorage } from "./utils/storageClear.js";
import { LS_KEYS } from "./utils/storageKeys.js";
import { downloadBlob } from "./utils/download.js";
import { EmulatorClient } from "./worker-client.js";
import { arrayBufferToBase64, base64ToArrayBuffer } from "./utils/base64.js";
import {
  addDisk,
  getAllDisks,
  removeDisk,
  removeDisks,
  renameDisk,
  type DiskEntry,
} from "./ui/diskLibrary.js";
import {
  saveStateToStorage,
  loadStateFromStorage,
  deleteStateFromStorage,
  getAllSaveStates,
} from "./ui/saveStates.js";

const canvas = document.getElementById("screen") as HTMLCanvasElement;
const romFileBtn = document.getElementById("rom-file-btn") as HTMLLabelElement | null;
const romInput = document.getElementById("rom-input") as HTMLInputElement | null;
const romFileText = document.getElementById("rom-file-text") as HTMLSpanElement | null;
const romSetupBtn = document.getElementById("rom-setup-btn") as HTMLButtonElement | null;
const pauseBtn = document.getElementById("pause-btn") as HTMLButtonElement;
const resetBtn = document.getElementById("reset-btn") as HTMLButtonElement;
const fullscreenBtn = document.getElementById("fullscreen-btn") as HTMLButtonElement | null;
const screenFrame = document.getElementById("screen-frame") as HTMLDivElement;
const saveSnapshotBtn = document.getElementById("save-snapshot-btn") as HTMLButtonElement;
const muteBtn = document.getElementById("mute-btn") as HTMLButtonElement | null;
const volumeIcon = document.getElementById("volume-icon") as SVGElement | null;
const volumeSlider = document.getElementById("volume-slider") as HTMLInputElement | null;
const volumeValue = document.getElementById("volume-value") as HTMLSpanElement | null;
const status = document.getElementById("status") as HTMLDivElement;

const drives: [DriveUi, DriveUi] = [createDriveUi(0), createDriveUi(1)];

const saveStateSlots = document.getElementById("save-state-slots") as HTMLDivElement | null;
const stateThumbnail = document.getElementById("state-thumbnail") as HTMLDivElement | null;
const stateTimestamp = document.getElementById("state-timestamp") as HTMLSpanElement | null;
const quickSaveBtn = document.getElementById("quick-save-btn") as HTMLButtonElement | null;
const quickLoadBtn = document.getElementById("quick-load-btn") as HTMLButtonElement | null;
const deleteStateBtn = document.getElementById("delete-state-btn") as HTMLButtonElement | null;

const panelDisksTab = document.getElementById("panel-disks-tab") as HTMLDivElement | null;
const panelSnapshotsTab = document.getElementById("panel-snapshots-tab") as HTMLDivElement | null;
const snapshotsPanelToggle = document.getElementById(
  "snapshots-panel-toggle",
) as HTMLButtonElement | null;
const snapshotFileInput = document.getElementById("snapshot-file-input") as HTMLInputElement | null;
const snapshotFileText = document.getElementById("snapshot-file-text") as HTMLSpanElement | null;

const diskLibraryPanel = document.getElementById("disk-library-panel") as HTMLDivElement;
const diskLibraryToggle = document.getElementById("disk-library-toggle") as HTMLButtonElement;
const diskLibraryAddBtn = document.getElementById("disk-library-add-btn") as HTMLButtonElement;
const diskLibraryList = document.getElementById("disk-library-list") as HTMLDivElement;
const diskLibraryInput = document.getElementById("disk-library-input") as HTMLInputElement;
const diskLibrarySearch = document.getElementById("disk-library-search") as HTMLInputElement;
const diskLibraryBulkBar = document.getElementById("disk-library-bulk-bar") as HTMLDivElement;
const diskLibraryBulkCount = document.getElementById("disk-library-bulk-count") as HTMLSpanElement;
const diskLibraryBulkDeleteBtn = document.getElementById(
  "disk-library-bulk-delete",
) as HTMLButtonElement;
const diskLibraryBulkClearBtn = document.getElementById(
  "disk-library-bulk-clear",
) as HTMLButtonElement;

const controlsPanel = document.getElementById("controls-panel") as HTMLDivElement;
const controlsMachineToggle = document.getElementById(
  "controls-machine-toggle",
) as HTMLButtonElement;
const controlsInputToggle = document.getElementById(
  "controls-input-toggle",
) as HTMLButtonElement | null;
const controlsSystemToggle = document.getElementById(
  "controls-system-toggle",
) as HTMLButtonElement | null;
const diskLibraryCloseBtn = document.getElementById(
  "disk-library-close-btn",
) as HTMLButtonElement | null;
const controlsPanelCloseBtn = document.getElementById(
  "controls-panel-close-btn",
) as HTMLButtonElement | null;
const fpsVal = document.getElementById("fps-val") as HTMLSpanElement | null;
const logContainer = document.getElementById("log-container") as HTMLDivElement | null;
const logEntriesEl = document.getElementById("log-entries") as HTMLDivElement | null;
const saveLogBtn = document.getElementById("save-log-btn") as HTMLButtonElement | null;
const clearLogBtn = document.getElementById("clear-log-btn") as HTMLButtonElement | null;

const panelControlsMachineTab = document.getElementById(
  "panel-controls-machine-tab",
) as HTMLDivElement | null;
const panelControlsInputTab = document.getElementById(
  "panel-controls-input-tab",
) as HTMLDivElement | null;
const panelControlsSystemTab = document.getElementById(
  "panel-controls-system-tab",
) as HTMLDivElement | null;

const paddleTypeSelect = document.getElementById("paddle-type-select") as HTMLSelectElement;
const paddleSetupBtn = document.getElementById("paddle-setup-btn") as HTMLButtonElement | null;
const paddleModal = document.getElementById("paddle-modal") as HTMLDivElement;
const paddleCloseBtn = document.getElementById("paddle-close-btn") as HTMLButtonElement;
const paddleResetBtn = document.getElementById("paddle-reset-btn") as HTMLButtonElement;
const gamepadIndicator = document.getElementById("gamepad-indicator") as HTMLDivElement | null;
const gamepadIndicatorText = document.getElementById(
  "gamepad-indicator-text",
) as HTMLSpanElement | null;

const confirmLoadModal = document.getElementById("confirm-load-modal") as HTMLDivElement;
const confirmLoadName = document.getElementById("confirm-load-name") as HTMLParagraphElement;
const confirmLoadText = document.getElementById("confirm-load-text") as HTMLParagraphElement | null;
const confirmLoadCancel = document.getElementById("confirm-load-cancel") as HTMLButtonElement;
const confirmLoadPlay = document.getElementById("confirm-load-play") as HTMLButtonElement;
const confirmLoadDrive2 = document.getElementById("confirm-load-drive2") as HTMLButtonElement | null;

const setupModal = document.getElementById("setup-modal") as HTMLDivElement;
const modalRomInput = document.getElementById("modal-rom-input") as HTMLInputElement;
const modalRomText = document.getElementById("modal-rom-text") as HTMLSpanElement;
const modalStartBtn = document.getElementById("modal-start-btn") as HTMLButtonElement;
const modalCancelBtn = document.getElementById("modal-cancel-btn") as HTMLButtonElement | null;
const modalError = document.getElementById("modal-error") as HTMLDivElement;

const serverModal = document.getElementById("server-modal") as HTMLDivElement;
const serverModalHint = document.getElementById("server-modal-hint") as HTMLParagraphElement;
const serverModalRetryBtn = document.getElementById(
  "server-modal-retry-btn",
) as HTMLButtonElement;

let modalRomData: ArrayBuffer | null = null;
let modalRomFilename = "";

const savedVolume = parseFloat(localStorage.getItem(LS_KEYS.volume) ?? "0.5");
const savedMuted = localStorage.getItem(LS_KEYS.muted) === "true";
const initialVolume = isNaN(savedVolume) ? 0.5 : Math.max(0, Math.min(1, savedVolume));

const display = new Display(canvas);
const client = new EmulatorClient();
const audio = new AudioSink(initialVolume, savedMuted);

function updateVolumeUi(): void {
  const isMuted = audio.isMuted();
  const vol = audio.getVolume();
  const percent = Math.round(vol * 100);

  if (volumeSlider) volumeSlider.value = isMuted ? "0" : percent.toString();
  if (volumeValue) volumeValue.textContent = isMuted ? "Muted" : `${percent}%`;

  const muteLabel = document.getElementById("mute-btn-label");
  if (volumeIcon) {
    muteBtn?.setAttribute("title", isMuted || vol === 0 ? "Unmute audio" : "Mute audio");
    if (muteLabel) muteLabel.textContent = isMuted || vol === 0 ? "Unmute" : "Mute";
  }
}

updateVolumeUi();

volumeSlider?.addEventListener("input", async () => {
  const val = parseInt(volumeSlider.value, 10);
  const vol = Math.max(0, Math.min(1, val / 100));
  audio.setVolume(vol);
  if (audio.isMuted() && vol > 0) audio.setMuted(false);
  localStorage.setItem(LS_KEYS.volume, vol.toString());
  localStorage.setItem(LS_KEYS.muted, audio.isMuted().toString());
  updateVolumeUi();
  await ensureAudioStarted();
});

muteBtn?.addEventListener("click", async () => {
  audio.toggleMute();
  localStorage.setItem(LS_KEYS.muted, audio.isMuted().toString());
  updateVolumeUi();
  await ensureAudioStarted();
});

let paused = false;
let romLoaded = false;
const driveLoaded = [false, false];
const driveFilenames = ["", ""];
let hasPoweredOn = false;
let libraryOpen = localStorage.getItem(LS_KEYS.libraryOpen) === "true";
let controlsOpen = localStorage.getItem(LS_KEYS.controlsOpen) === "true";
let activeLeftTab: "disks" | "snapshots" =
  (localStorage.getItem(LS_KEYS.leftTab) as "disks" | "snapshots" | null) ?? "disks";
type RightTab = "machine" | "input" | "system";
let activeRightTab: RightTab =
  (localStorage.getItem(LS_KEYS.rightTab) as RightTab | null) ?? "machine";
let pendingDiskEntry: DiskEntry | null = null;
let libraryFilterText = "";
const selectedDiskIds = new Set<string>();

/**
 * Single source of truth for the paused flag: syncs the worker, refreshes the
 * UI, and (via the always-running frame loop) guarantees video keeps flowing
 * once unpaused. Never assign `paused` directly.
 */
function setPaused(value: boolean): void {
  paused = value;
  if (paused) client.pause();
  else client.resume();
  updatePauseUi();
}

function setLeftTab(tab: "disks" | "snapshots"): void {
  activeLeftTab = tab;
  localStorage.setItem(LS_KEYS.leftTab, tab);
  if (panelDisksTab) panelDisksTab.style.display = tab === "disks" ? "flex" : "none";
  if (panelSnapshotsTab) panelSnapshotsTab.style.display = tab === "snapshots" ? "flex" : "none";
  diskLibraryToggle?.classList.toggle("active", libraryOpen && tab === "disks");
  snapshotsPanelToggle?.classList.toggle("active", libraryOpen && tab === "snapshots");
}

function setRightTab(tab: RightTab): void {
  activeRightTab = tab;
  localStorage.setItem(LS_KEYS.rightTab, tab);
  if (panelControlsMachineTab)
    panelControlsMachineTab.style.display = tab === "machine" ? "flex" : "none";
  if (panelControlsInputTab) panelControlsInputTab.style.display = tab === "input" ? "flex" : "none";
  if (panelControlsSystemTab)
    panelControlsSystemTab.style.display = tab === "system" ? "flex" : "none";
  controlsMachineToggle.classList.toggle("active", controlsOpen && tab === "machine");
  controlsInputToggle?.classList.toggle("active", controlsOpen && tab === "input");
  controlsSystemToggle?.classList.toggle("active", controlsOpen && tab === "system");
}

interface LogEntry {
  timestamp: string;
  message: string;
  level: "debug" | "info" | "warn" | "error";
}

const logEntries: LogEntry[] = [];

function updateLogButtons(): void {
  const hasEntries = logEntries.length > 0;
  if (saveLogBtn) saveLogBtn.disabled = !hasEntries;
  if (clearLogBtn) clearLogBtn.disabled = !hasEntries;
}

function appendLogEntryUi(entry: LogEntry): void {
  if (!logEntriesEl) return;
  const empty = logEntriesEl.querySelector(".log-entry-empty");
  if (empty) empty.remove();

  const row = document.createElement("div");
  row.className = `log-entry log-${entry.level}`;
  const timeSpan = document.createElement("span");
  timeSpan.className = "log-entry-time";
  timeSpan.textContent = `[${entry.timestamp}]`;
  const msgSpan = document.createElement("span");
  msgSpan.className = "log-entry-msg";
  msgSpan.textContent = entry.message;
  row.appendChild(timeSpan);
  row.appendChild(msgSpan);
  logEntriesEl.appendChild(row);

  while (logEntriesEl.children.length > 200) logEntriesEl.removeChild(logEntriesEl.firstChild!);
  if (logContainer) logContainer.scrollTop = logContainer.scrollHeight;
  updateLogButtons();
}

function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderLogs(): void {
  if (!logEntriesEl) return;
  logEntriesEl.innerHTML = "";
  if (logEntries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "log-entry-empty";
    empty.textContent = "No log entries yet.";
    logEntriesEl.appendChild(empty);
    updateLogButtons();
    return;
  }
  for (const entry of logEntries) appendLogEntryUi(entry);
}

function logEvent(message: string, level: "debug" | "info" | "warn" | "error" = "info"): void {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const entry: LogEntry = { timestamp: timeStr, message, level };
  logEntries.push(entry);
  if (logEntries.length > 500) logEntries.shift();
  appendLogEntryUi(entry);
}

function setStatus(message: string, level: "info" | "warn" | "error" = "info"): void {
  status.textContent = message;
  logEvent(message, level);
}

renderLogs();

client.onError = (message) => setStatus(`Error: ${message}`, "error");

let lastFpsUpdate = performance.now();
let lastFpsFrameCount = 0;
let currentFps = 0;

function updateFpsUi(): void {
  if (!fpsVal) return;
  if (!romLoaded) {
    fpsVal.textContent = "--";
    return;
  }
  fpsVal.textContent = paused ? "Paused" : currentFps.toFixed(1);
}

function updatePauseUi(): void {
  const pauseIcon = pauseBtn.querySelector(".icon-pause") as SVGElement | null;
  const playIcon = pauseBtn.querySelector(".icon-play") as SVGElement | null;
  const label = document.getElementById("pause-btn-label");
  if (paused) {
    if (pauseIcon) pauseIcon.style.display = "none";
    if (playIcon) playIcon.style.display = "block";
    if (label) label.textContent = "Resume";
    pauseBtn.classList.add("btn-accent");
  } else {
    if (pauseIcon) pauseIcon.style.display = "block";
    if (playIcon) playIcon.style.display = "none";
    if (label) label.textContent = "Pause";
    pauseBtn.classList.remove("btn-accent");
  }
  updateFpsUi();
}

function updateFullscreenUi(): void {
  if (!fullscreenBtn) return;
  const enterIcon = fullscreenBtn.querySelector(".icon-fullscreen-enter") as SVGElement | null;
  const exitIcon = fullscreenBtn.querySelector(".icon-fullscreen-exit") as SVGElement | null;
  const label = document.getElementById("fullscreen-btn-label");
  const isFullscreen = document.fullscreenElement === screenFrame;
  if (enterIcon) enterIcon.style.display = isFullscreen ? "none" : "block";
  if (exitIcon) exitIcon.style.display = isFullscreen ? "block" : "none";
  if (label) label.textContent = isFullscreen ? "Exit" : "Fullscreen";
}

async function ensureAudioStarted(): Promise<void> {
  await audio.start(client);
  await audio.resume();
}

function openModal(el: HTMLElement): void {
  el.style.display = "flex";
  el.querySelector<HTMLButtonElement>(".modal-footer button:not([disabled])")?.focus();
}

function closeModal(el: HTMLElement): void {
  el.style.display = "none";
}

const MODALS = [serverModal, setupModal, paddleModal, confirmLoadModal];

function isModalOpen(): boolean {
  return MODALS.some((m) => m.style.display !== "none");
}

function dismissConfirmLoad(): void {
  closeModal(confirmLoadModal);
  pendingDiskEntry = null;
}

function showSetupModal(): void {
  openModal(setupModal);
  modalRomData = null;
  modalRomFilename = "";
  modalRomInput.value = "";
  modalRomText.textContent = "Choose ROM file(s)…";
  modalStartBtn.disabled = true;
  modalError.style.display = "none";
  if (modalCancelBtn) modalCancelBtn.style.display = romLoaded ? "" : "none";
}

function hideSetupModal(): void {
  closeModal(setupModal);
}

// Clicking the dark overlay (not the dialog itself) dismisses the modal.
function wireModalBackdrop(modal: HTMLElement, onClose: () => void): void {
  modal.addEventListener("pointerdown", (e) => {
    if (e.target === modal) onClose();
  });
}

wireModalBackdrop(setupModal, () => {
  if (romLoaded) hideSetupModal();
});
wireModalBackdrop(confirmLoadModal, () => dismissConfirmLoad());
wireModalBackdrop(paddleModal, () => closeModal(paddleModal));

function updateRomUi(filename?: string): void {
  if (!romFileText) return;
  if (filename) {
    romFileText.textContent = filename;
    romFileBtn?.setAttribute("title", `Loaded ROM: ${filename} (click to change)`);
  } else {
    const stored = loadRomFromStorage();
    if (stored) {
      romFileText.textContent = stored.filename;
      romFileBtn?.setAttribute("title", `Loaded ROM: ${stored.filename} (click to change)`);
    } else {
      romFileText.textContent = "Load ROM…";
      romFileBtn?.setAttribute("title", "Load Apple IIe ROM (.rom, .bin)");
    }
  }
}

function validateRomFiles(files: File[]): string | null {
  if (files.length === 1) {
    const size = files[0]!.size;
    if (size !== ROM_SIZE && size !== ROM_SIZE_BASIC_MONITOR && size !== ROM_SIZE_COMBINED_32K) {
      return (
        `Invalid ROM size: ${size} bytes (expected a ${ROM_SIZE}-byte file covering $C000-$FFFF, ` +
        `a ${ROM_SIZE_BASIC_MONITOR}-byte $D000-$FFFF-only file, a ${ROM_SIZE_COMBINED_32K}-byte ` +
        `combined dump, or two ${ROM_CHIP_SIZE}-byte chip dumps).`
      );
    }
    return null;
  }
  if (files.length === 2) {
    const bad = files.find((f) => f.size !== ROM_CHIP_SIZE);
    if (bad) {
      return `Invalid ROM chip size: "${bad.name}" is ${bad.size} bytes (each chip dump must be ${ROM_CHIP_SIZE} bytes).`;
    }
    return null;
  }
  return "Select either one 16KB ROM file or two 8KB chip dumps (CD + EF).";
}

async function readRomFiles(files: File[]): Promise<ArrayBuffer> {
  if (files.length === 1) return files[0]!.arrayBuffer();
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
  const buffers = await Promise.all(sorted.map((f) => f.arrayBuffer()));
  const combined = new Uint8Array(ROM_SIZE);
  combined.set(new Uint8Array(buffers[0]!), 0);
  combined.set(new Uint8Array(buffers[1]!), ROM_CHIP_SIZE);
  return combined.buffer;
}

function formatRomFilename(files: File[]): string {
  if (files.length === 1) return files[0]!.name;
  return [...files]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((f) => f.name)
    .join(", ");
}

/** Reflects a disk insert into both drive sections' filename/eject/state UI. */
function markDriveLoaded(drive: 0 | 1, filename: string): void {
  driveLoaded[drive] = true;
  driveFilenames[drive] = filename;
  drives[drive].setLoaded(filename);
}

/** Resets a drive section to the empty state (text, input, eject, LEDs, status). */
function clearDriveUi(drive: 0 | 1): void {
  driveLoaded[drive] = false;
  driveFilenames[drive] = "";
  drives[drive].clear();
}

const lastLoggedMotorOn = [false, false];
const lastLoggedTrack = [-1, -1];

client.onDiskStatus = (diskStatus) => {
  const drive = diskStatus.drive as 0 | 1;
  drives[drive].setActivity(diskStatus.motorOn, diskStatus.inserted, diskStatus.track);

  if (diskStatus.inserted) driveLoaded[drive] = true;
  else clearDriveUi(drive);

  if (diskStatus.motorOn !== lastLoggedMotorOn[drive]) {
    logEvent(
      `Drive ${drive + 1} motor ${diskStatus.motorOn ? "on" : "off"} (track ${diskStatus.track}).`,
      "debug",
    );
    lastLoggedMotorOn[drive] = diskStatus.motorOn;
  } else if (diskStatus.track !== lastLoggedTrack[drive]) {
    logEvent(`Drive ${drive + 1} seek to track ${diskStatus.track}.`, "debug");
  }
  lastLoggedTrack[drive] = diskStatus.track;
};

async function insertDiskFileIntoDrive(file: File, drive: 0 | 1): Promise<void> {
  const format = diskFormatFromPath(file.name);
  if (!format) {
    setStatus(`Unrecognized disk file: "${file.name}" (expected .dsk/.po)`, "warn");
    return;
  }
  const data = await file.arrayBuffer();
  logEvent(
    `Loading disk "${file.name}" (${format}, ${data.byteLength} bytes) into drive ${drive + 1}.`,
    "debug",
  );
  await saveSessionMedia({ filename: file.name, format, data: data.slice(0) }, drive);
  client.loadDisk(format, data, drive);
  markDriveLoaded(drive, file.name);
  setStatus(`Inserted disk "${file.name}" into drive ${drive + 1}.`);
}

async function ejectDrive(drive: 0 | 1): Promise<void> {
  logEvent(`Ejecting disk from drive ${drive + 1}.`, "debug");
  client.ejectDisk(drive);
  clearDriveUi(drive);
  await saveSessionMedia(null, drive);
  setStatus(`Disk ejected from drive ${drive + 1}.`);
}

for (const ui of drives) {
  ui.el.fileInput?.addEventListener("change", async () => {
    const input = ui.el.fileInput;
    if (!input) return;
    const file = input.files?.[0];
    if (!file) return;
    input.value = "";
    await insertDiskFileIntoDrive(file, ui.drive);
  });
  ui.el.ejectBtn?.addEventListener("click", () => void ejectDrive(ui.drive));
  ui.el.exportBtn?.addEventListener("click", () => void exportDriveImage(ui.drive));
}

// Round-trips through the worker: disks are deliberately excluded from save
// states (see state.ts), and the running program may have written to the
// image in place, so the only truthful export is the worker's live image.
async function exportDriveImage(drive: 0 | 1): Promise<void> {
  const result = await client.exportDisk(drive);
  if (!result) {
    setStatus(`No disk inserted in drive ${drive + 1}.`, "warn");
    return;
  }
  const name = driveFilenames[drive] || `drive${drive + 1}.${result.format}`;
  downloadBlob(result.data, name, "application/octet-stream");
  setStatus(`Exported "${name}" from drive ${drive + 1} (includes writes made by running programs).`);
}

let activeSaveStateSlot = 1;

async function refreshSaveStateSlotIndicators(): Promise<void> {
  const allStates = await getAllSaveStates();
  const savedSlots = new Set(allStates.map((s) => s.slot));
  const slotButtons = saveStateSlots?.querySelectorAll(".slot-btn");
  slotButtons?.forEach((btn) => {
    const slot = parseInt(btn.getAttribute("data-slot") ?? "0", 10);
    btn.classList.toggle("active", slot === activeSaveStateSlot);
    btn.classList.toggle("has-state", savedSlots.has(slot));
  });
}

async function updateSaveStatePreview(slot: number): Promise<void> {
  activeSaveStateSlot = slot;
  if (snapshotFileText) snapshotFileText.textContent = `Load into Slot ${slot}…`;
  const exportSlotBtnText = document.getElementById("export-slot-btn-text");
  if (exportSlotBtnText) exportSlotBtnText.textContent = `Export Slot ${slot}`;
  await refreshSaveStateSlotIndicators();
  const entry = await loadStateFromStorage(slot);
  if (entry) {
    if (stateThumbnail) stateThumbnail.innerHTML = `<img src="${entry.screenshot}" alt="Slot ${slot} snapshot" />`;
    if (stateTimestamp) {
      const date = new Date(entry.timestamp);
      const timeStr = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const label = entry.name ? `${entry.name} (${timeStr})` : `${date.toLocaleDateString()} ${timeStr}`;
      stateTimestamp.textContent = `Slot ${slot}: ${label}`;
    }
    if (quickLoadBtn) {
      quickLoadBtn.disabled = false;
      quickLoadBtn.title = `Load state from slot ${slot} (F8)`;
    }
    if (deleteStateBtn) deleteStateBtn.disabled = false;
    if (saveSnapshotBtn) saveSnapshotBtn.disabled = false;
  } else {
    if (stateThumbnail) stateThumbnail.textContent = "Empty slot";
    if (stateTimestamp) stateTimestamp.textContent = `Slot ${slot}: Empty slot`;
    if (quickLoadBtn) {
      quickLoadBtn.disabled = true;
      quickLoadBtn.title = `Slot ${slot} is empty (F8)`;
    }
    if (deleteStateBtn) deleteStateBtn.disabled = true;
    if (saveSnapshotBtn) saveSnapshotBtn.disabled = true;
  }
}

async function quickSaveCurrentSlot(): Promise<void> {
  if (!romLoaded) {
    setStatus("Load a ROM first.", "warn");
    return;
  }
  const data = await client.saveState();
  const screenshot = canvas.toDataURL("image/png");
  await saveStateToStorage(activeSaveStateSlot, data, screenshot, "Quick Save");
  await updateSaveStatePreview(activeSaveStateSlot);
  setStatus(`Saved state to slot ${activeSaveStateSlot}.`);
}

async function quickLoadCurrentSlot(): Promise<void> {
  if (!romLoaded) {
    setStatus("Load a ROM first.", "warn");
    return;
  }
  const entry = await loadStateFromStorage(activeSaveStateSlot);
  if (!entry) {
    setStatus(`Slot ${activeSaveStateSlot} is empty.`, "warn");
    return;
  }
  hasPoweredOn = true;
  client.loadState(entry.data.slice(0));
  setStatus(`Loaded state from slot ${activeSaveStateSlot}${entry.name ? ` (${entry.name})` : ""}.`);
  setPaused(false);
  await ensureAudioStarted();
}

async function deleteCurrentSlot(): Promise<void> {
  if (!window.confirm(`Delete save state in slot ${activeSaveStateSlot}?`)) return;
  await deleteStateFromStorage(activeSaveStateSlot);
  await updateSaveStatePreview(activeSaveStateSlot);
  setStatus(`Deleted state in slot ${activeSaveStateSlot}.`);
}

saveStateSlots?.addEventListener("click", (e) => {
  const target = (e.target as HTMLElement).closest(".slot-btn") as HTMLElement | null;
  if (!target) return;
  void updateSaveStatePreview(parseInt(target.getAttribute("data-slot") ?? "1", 10));
});

quickSaveBtn?.addEventListener("click", () => void quickSaveCurrentSlot());
quickLoadBtn?.addEventListener("click", () => void quickLoadCurrentSlot());
deleteStateBtn?.addEventListener("click", () => void deleteCurrentSlot());

saveSnapshotBtn?.addEventListener("click", async () => {
  const entry = await loadStateFromStorage(activeSaveStateSlot);
  if (!entry) return;
  downloadBlob(entry.data, `slot${activeSaveStateSlot}.a2state`, "application/octet-stream");
});

async function importSnapshotFile(file: File): Promise<void> {
  if (!romLoaded) {
    setStatus("Load a ROM first.", "warn");
    return;
  }
  const data = await file.arrayBuffer();
  hasPoweredOn = true;
  client.loadState(data.slice(0));
  await saveStateToStorage(activeSaveStateSlot, data, canvas.toDataURL("image/png"), file.name);
  await updateSaveStatePreview(activeSaveStateSlot);
  setPaused(false);
  await ensureAudioStarted();
  setStatus(`Loaded "${file.name}" into slot ${activeSaveStateSlot}.`);
}

snapshotFileInput?.addEventListener("change", async () => {
  const file = snapshotFileInput.files?.[0];
  if (!file) return;
  snapshotFileInput.value = "";
  await importSnapshotFile(file);
});

async function restoreSession(): Promise<void> {
  if (
    window.location.search.includes("clear") ||
    window.location.search.includes("reset") ||
    window.location.search.includes("bust-cache")
  ) {
    await clearAllClientStorage();
    window.location.replace(window.location.pathname);
    return;
  }
  updateRomUi();
  await updateSaveStatePreview(activeSaveStateSlot);
  const storedRom = loadRomFromStorage();

  if (storedRom) {
    client.loadRom(storedRom.data.slice(0));
    romLoaded = true;

    const storedMedia: [StoredMedia | null, StoredMedia | null] = [null, null];
    for (const drive of [0, 1] as const) {
      const media = await loadSessionMedia(drive);
      storedMedia[drive] = media;
      if (media) {
        client.loadDisk(media.format, media.data.slice(0), drive);
        markDriveLoaded(drive, media.filename);
      }
    }

    await audio.start(client);

    if (audio.getState() === "running") {
      hasPoweredOn = true;
      client.reset();
      setPaused(false);
      setStatus(romRestoredStatus(storedRom.filename, storedMedia[0]));
    } else {
      hasPoweredOn = false;
      setPaused(true);
      setStatus("Click screen or press any key to power on.");
    }
  } else {
    showSetupModal();
  }
  initLibraryState();
  initControlsState();
  await renderLibrary();
  renderLogs();
  updateFpsUi();
}

async function renderLibrary(): Promise<void> {
  const allDisks = await getAllDisks();
  const query = libraryFilterText.trim().toLowerCase();
  const disks = allDisks.filter(
    (d) => !query || d.name.toLowerCase().includes(query) || d.filename.toLowerCase().includes(query),
  );

  const liveIds = new Set(allDisks.map((d) => d.id));
  for (const id of [...selectedDiskIds]) if (!liveIds.has(id)) selectedDiskIds.delete(id);
  updateBulkBar();

  if (disks.length === 0) {
    diskLibraryList.innerHTML = `<div class="tape-library-empty">${
      allDisks.length === 0 ? "No disks yet. Click + to add." : "No disks match the search."
    }</div>`;
    return;
  }
  diskLibraryList.innerHTML = "";
  for (const disk of disks) {
    const item = document.createElement("div");
    item.className = "tape-library-item";
    item.dataset.id = disk.id;
    const safeName = escapeHtml(disk.name);
    const safeFilename = escapeHtml(disk.filename);
    const safeFormat = escapeHtml(disk.format);
    item.innerHTML = `
      <input type="checkbox" class="tape-library-item-checkbox" ${selectedDiskIds.has(disk.id) ? "checked" : ""} aria-label="Select ${safeName}" />
      <span class="tape-library-item-name" title="${safeFilename}">${safeName}</span>
      <span class="tape-library-item-format">${safeFormat}</span>
      <button class="tape-library-item-edit" title="Rename" aria-label="Rename ${safeName}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
        </svg>
      </button>
      <button class="tape-library-item-delete" title="Remove from library" aria-label="Remove ${safeName}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    `;
    item.querySelector(".tape-library-item-checkbox")!.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleDiskSelection(disk.id);
    });
    item.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target.closest(".tape-library-item-delete, .tape-library-item-edit, .tape-library-item-checkbox")) return;
      onLibraryDiskClick(disk);
    });
    item.querySelector(".tape-library-item-edit")!.addEventListener("click", (e) => {
      e.stopPropagation();
      startRenameDisk(item, disk);
    });
    item.querySelector(".tape-library-item-delete")!.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!window.confirm(`Remove "${disk.name}" from the library?`)) return;
      await removeDisk(disk.id);
      selectedDiskIds.delete(disk.id);
      await renderLibrary();
    });
    diskLibraryList.appendChild(item);
  }
}

function startRenameDisk(item: HTMLElement, disk: DiskEntry): void {
  const nameEl = item.querySelector(".tape-library-item-name") as HTMLElement;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "tape-library-search";
  input.value = disk.name;
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  let cancelled = false;
  const commit = async (): Promise<void> => {
    if (cancelled) return;
    const newName = input.value.trim();
    if (newName && newName !== disk.name) await renameDisk(disk.id, newName);
    await renderLibrary();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
    else if (e.key === "Escape") {
      cancelled = true;
      void renderLibrary();
    }
  });
  input.addEventListener("blur", () => void commit(), { once: true });
}

function toggleDiskSelection(id: string): void {
  if (selectedDiskIds.has(id)) selectedDiskIds.delete(id);
  else selectedDiskIds.add(id);
  updateBulkBar();
}

function updateBulkBar(): void {
  const n = selectedDiskIds.size;
  diskLibraryBulkBar.hidden = n === 0;
  diskLibraryBulkCount.textContent = `${n} selected`;
}

function toggleLibrary(): void {
  libraryOpen = !libraryOpen;
  diskLibraryPanel.classList.toggle("open", libraryOpen);
  document.body.classList.toggle("library-open", libraryOpen);
  localStorage.setItem(LS_KEYS.libraryOpen, libraryOpen.toString());
  diskLibraryToggle?.classList.toggle("active", libraryOpen && activeLeftTab === "disks");
  snapshotsPanelToggle?.classList.toggle("active", libraryOpen && activeLeftTab === "snapshots");
  if (libraryOpen && controlsOpen) toggleControls();
}

function initLibraryState(): void {
  diskLibraryPanel.classList.toggle("open", libraryOpen);
  document.body.classList.toggle("library-open", libraryOpen);
  setLeftTab(activeLeftTab);
}

function toggleControls(): void {
  controlsOpen = !controlsOpen;
  controlsPanel.classList.toggle("open", controlsOpen);
  document.body.classList.toggle("controls-open", controlsOpen);
  localStorage.setItem(LS_KEYS.controlsOpen, controlsOpen.toString());
  setRightTab(activeRightTab);
  if (controlsOpen && libraryOpen) toggleLibrary();
}

function initControlsState(): void {
  controlsPanel.classList.toggle("open", controlsOpen);
  document.body.classList.toggle("controls-open", controlsOpen);
  setRightTab(activeRightTab);
}

function stripExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(0, dot) : filename;
}

async function onLibraryFileSelect(files: FileList | null): Promise<void> {
  if (!files) return;
  let added = 0;
  for (const file of Array.from(files)) {
    const format = diskFormatFromPath(file.name);
    if (!format) continue;
    const data = await file.arrayBuffer();
    await addDisk({ name: stripExtension(file.name), filename: file.name, format, data: data.slice(0) });
    added++;
  }
  diskLibraryInput.value = "";
  await renderLibrary();
  if (added > 0) setStatus(`Added ${added} disk(s) to library.`);
}

function onLibraryDiskClick(entry: DiskEntry): void {
  if (!romLoaded) {
    setStatus("Load a ROM first.", "warn");
    return;
  }
  pendingDiskEntry = entry;
  if (!driveLoaded[0] && !driveLoaded[1]) {
    void loadDiskFromLibrary(0);
    return;
  }
  confirmLoadName.textContent = entry.filename;
  if (confirmLoadText) {
    const d1Info = driveLoaded[0] ? `Drive 1: ${driveFilenames[0] || "inserted"}` : "Drive 1: empty";
    const d2Info = driveLoaded[1] ? `Drive 2: ${driveFilenames[1] || "inserted"}` : "Drive 2: empty";
    confirmLoadText.textContent = `Select drive to insert disk into (${d1Info} · ${d2Info}):`;
  }
  openModal(confirmLoadModal);
}

async function loadDiskFromLibrary(drive: 0 | 1 = 0): Promise<void> {
  const entry = pendingDiskEntry;
  if (!entry) return;
  dismissConfirmLoad();

  hasPoweredOn = true;
  await ensureAudioStarted();
  logEvent(
    `Loading disk "${entry.filename}" (${entry.format}, ${entry.data.byteLength} bytes) into drive ${drive + 1}.`,
    "debug",
  );
  client.loadDisk(entry.format, entry.data.slice(0), drive);
  markDriveLoaded(drive, entry.filename);
  await saveSessionMedia({ filename: entry.filename, format: entry.format, data: entry.data.slice(0) }, drive);
  setPaused(false);
  setStatus(`Inserted "${entry.filename}" into drive ${drive + 1}${drive === 0 ? " and booting…" : "."}`);
}

async function loadRomFiles(files: File[]): Promise<void> {
  if (files.length === 0) return;
  if (romLoaded && !window.confirm("A ROM is already loaded. Replace it and reset the emulator?")) return;

  const error = validateRomFiles(files);
  if (error) {
    setStatus(error, "warn");
    return;
  }
  const data = await readRomFiles(files);
  const filename = formatRomFilename(files);
  saveRomToStorage({ filename, data: data.slice(0) });
  hasPoweredOn = true;
  await ensureAudioStarted();
  client.loadRom(data);
  client.reset();
  romLoaded = true;
  setPaused(false);
  updateRomUi(filename);
  setStatus(`ROM loaded and reset. Insert a disk to boot, or use the Monitor.`);
}

document.body.addEventListener("dragover", (e) => e.preventDefault());
document.body.addEventListener("drop", async (e) => {
  e.preventDefault();
  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return;
  const all = Array.from(files);
  const isRom = (f: File) => /\.(rom|bin)$/i.test(f.name);
  const isDisk = (f: File) => diskFormatFromPath(f.name) !== null;
  const isSnapshot = (f: File) => f.name.toLowerCase().endsWith(".a2state");
  if (all.length === 1 && isSnapshot(all[0]!)) {
    await importSnapshotFile(all[0]!);
    return;
  }
  if (all.every(isRom)) {
    await loadRomFiles(all);
    return;
  }
  if (all.every(isDisk)) {
    await onLibraryFileSelect(files);
    setStatus("Added disk(s) to library. Click one in the library to insert it.");
    return;
  }
  setStatus(
    "Drop one kind of file: ROM (.rom/.bin), disk images (.dsk/.po), or a single snapshot (.a2state).",
    "warn",
  );
});

modalRomInput.addEventListener("change", async () => {
  const files = Array.from(modalRomInput.files ?? []);
  if (files.length === 0) {
    modalRomData = null;
    modalRomFilename = "";
    modalRomText.textContent = "Choose ROM file(s)…";
    modalError.style.display = "none";
    modalStartBtn.disabled = true;
    return;
  }
  const error = validateRomFiles(files);
  if (error) {
    modalRomData = null;
    modalRomFilename = "";
    modalRomText.textContent = "Choose ROM file(s)…";
    modalError.textContent = error;
    modalError.style.display = "block";
    modalStartBtn.disabled = true;
    return;
  }
  modalError.style.display = "none";
  modalRomData = await readRomFiles(files);
  modalRomFilename = formatRomFilename(files);
  modalRomText.textContent = modalRomFilename;
  modalStartBtn.disabled = false;
});

modalStartBtn.addEventListener("click", async () => {
  if (!modalRomData) return;
  updateRomUi(modalRomFilename);
  await updateSaveStatePreview(activeSaveStateSlot);
  await renderLibrary();
  saveRomToStorage({ filename: modalRomFilename, data: modalRomData.slice(0) });

  hasPoweredOn = true;
  await ensureAudioStarted();
  client.loadRom(modalRomData);
  client.reset();
  romLoaded = true;
  setPaused(false);
  setStatus("ROM loaded and reset. Insert a disk to boot, or use the Monitor.");
  hideSetupModal();
});

modalCancelBtn?.addEventListener("click", () => hideSetupModal());

romInput?.addEventListener("change", async () => {
  const files = Array.from(romInput.files ?? []);
  if (files.length > 0) {
    await loadRomFiles(files);
    romInput.value = "";
  }
});

romSetupBtn?.addEventListener("click", () => showSetupModal());

pauseBtn.addEventListener("click", () => {
  if (romLoaded && !hasPoweredOn) {
    void onFirstGesture();
    return;
  }
  setPaused(!paused);
});

resetBtn.addEventListener("click", () => {
  if (!romLoaded) {
    setStatus("Load a ROM first.", "warn");
    return;
  }
  void ensureAudioStarted();
  hasPoweredOn = true;
  client.reset();
  setPaused(false);
  setStatus("System reset.");
});

fullscreenBtn?.addEventListener("click", async () => {
  if (document.fullscreenElement === screenFrame) await document.exitFullscreen();
  else await screenFrame.requestFullscreen();
});
document.addEventListener("fullscreenchange", updateFullscreenUi);

diskLibraryToggle.addEventListener("click", () => {
  if (libraryOpen && activeLeftTab === "disks") toggleLibrary();
  else {
    setLeftTab("disks");
    if (!libraryOpen) toggleLibrary();
  }
});
snapshotsPanelToggle?.addEventListener("click", () => {
  if (libraryOpen && activeLeftTab === "snapshots") toggleLibrary();
  else {
    setLeftTab("snapshots");
    if (!libraryOpen) toggleLibrary();
  }
});
controlsMachineToggle.addEventListener("click", () => {
  if (controlsOpen && activeRightTab === "machine") toggleControls();
  else {
    setRightTab("machine");
    if (!controlsOpen) toggleControls();
  }
});
controlsInputToggle?.addEventListener("click", () => {
  if (controlsOpen && activeRightTab === "input") toggleControls();
  else {
    setRightTab("input");
    if (!controlsOpen) toggleControls();
  }
});
controlsSystemToggle?.addEventListener("click", () => {
  if (controlsOpen && activeRightTab === "system") toggleControls();
  else {
    setRightTab("system");
    if (!controlsOpen) toggleControls();
  }
});

diskLibraryCloseBtn?.addEventListener("click", () => {
  if (libraryOpen) toggleLibrary();
});
controlsPanelCloseBtn?.addEventListener("click", () => {
  if (controlsOpen) toggleControls();
});

diskLibraryAddBtn.addEventListener("click", () => diskLibraryInput.click());
diskLibraryInput.addEventListener("change", () => void onLibraryFileSelect(diskLibraryInput.files));
diskLibrarySearch.addEventListener("input", () => {
  libraryFilterText = diskLibrarySearch.value;
  void renderLibrary();
});
diskLibraryBulkDeleteBtn.addEventListener("click", async () => {
  if (!window.confirm(`Remove ${selectedDiskIds.size} disk(s) from the library?`)) return;
  await removeDisks([...selectedDiskIds]);
  selectedDiskIds.clear();
  await renderLibrary();
});
diskLibraryBulkClearBtn.addEventListener("click", () => {
  selectedDiskIds.clear();
  void renderLibrary();
});

confirmLoadCancel.addEventListener("click", () => dismissConfirmLoad());
confirmLoadPlay.addEventListener("click", () => void loadDiskFromLibrary(0));
confirmLoadDrive2?.addEventListener("click", () => void loadDiskFromLibrary(1));

saveLogBtn?.addEventListener("click", () => {
  const text = logEntries.map((e) => `[${e.timestamp}] ${e.message}`).join("\n");
  downloadBlob(text, "apple2-log.txt", "text/plain");
});
clearLogBtn?.addEventListener("click", () => {
  logEntries.length = 0;
  renderLogs();
});

const clearCacheBtn = document.getElementById("clear-cache-btn") as HTMLButtonElement | null;
clearCacheBtn?.addEventListener("click", async () => {
  if (
    window.confirm(
      "Clear all client storage (cached ROM, disk library, save states, and session media) and reload?",
    )
  ) {
    await clearAllClientStorage();
    window.location.reload();
  }
});

(window as unknown as { clearApple2Cache: () => Promise<void> }).clearApple2Cache =
  clearAllClientStorage;

// ---- Paddle / joystick input ----

let paddleType: PaddleInputType = loadPaddleType();
let paddleKeyBindings = loadPaddleKeyBindings();
paddleTypeSelect.value = paddleType;

function renderPaddleKeyLabels(): void {
  for (const direction of PADDLE_DIRECTIONS) {
    const el = paddleModal.querySelector(`[data-key-label="${direction}"]`);
    if (el) el.textContent = paddleKeyBindings[direction];
  }
}
renderPaddleKeyLabels();

paddleTypeSelect.addEventListener("change", () => {
  paddleType = paddleTypeSelect.value as PaddleInputType;
  savePaddleType(paddleType);
  if (paddleType === "none") {
    sendPaddle(0, 127);
    sendPaddle(1, 127);
    sendPb(0, false);
    sendPb(1, false);
  }
});

let listeningDirection: PaddleDirection | null = null;

function endPaddleListen(bind: string | null): void {
  if (!listeningDirection) return;
  if (bind) {
    logEvent(`key ${bind} bound to paddle control "${listeningDirection}"`, "debug");
    paddleKeyBindings[listeningDirection] = bind;
    savePaddleKeyBindings(paddleKeyBindings);
    renderPaddleKeyLabels();
  }
  const btn = paddleModal.querySelector(
    `.joystick-bind-btn[data-direction="${listeningDirection}"]`,
  ) as HTMLButtonElement | null;
  if (btn) {
    btn.classList.remove("listening");
    btn.textContent = "Set";
  }
  listeningDirection = null;
}

paddleModal.querySelectorAll(".joystick-bind-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    paddleModal.querySelectorAll(".joystick-bind-btn").forEach((b) => b.classList.remove("listening"));
    listeningDirection = (btn as HTMLElement).dataset.direction as PaddleDirection;
    btn.classList.add("listening");
    btn.textContent = "Press a key…";
  });
});

// Escape cancels a pending capture; any other key binds it (capture phase so
// the emulator and browser shortcuts never see it).
window.addEventListener(
  "keydown",
  (e) => {
    if (!listeningDirection) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    endPaddleListen(e.code === "Escape" ? null : e.code);
  },
  { capture: true },
);

// Clicking anywhere outside the paddle modal also cancels a pending capture.
document.addEventListener("pointerdown", (e) => {
  if (!listeningDirection) return;
  if (paddleModal.contains(e.target as Node)) return;
  endPaddleListen(null);
});

paddleSetupBtn?.addEventListener("click", () => openModal(paddleModal));
paddleCloseBtn.addEventListener("click", () => closeModal(paddleModal));
paddleResetBtn.addEventListener("click", () => {
  paddleKeyBindings = { ...DEFAULT_PADDLE_KEY_BINDINGS };
  savePaddleKeyBindings(paddleKeyBindings);
  renderPaddleKeyLabels();
});

let gamepadIndex: number | null = null;
const kbPaddleState = { left: false, right: false, up: false, down: false, fire: false, fire2: false };

window.addEventListener("gamepadconnected", (e) => {
  gamepadIndex = e.gamepad.index;
  gamepadIndicator?.classList.add("connected");
  if (gamepadIndicatorText) gamepadIndicatorText.textContent = `Gamepad: ${e.gamepad.id}`;
});
window.addEventListener("gamepaddisconnected", (e) => {
  if (gamepadIndex !== e.gamepad.index) return;
  gamepadIndex = null;
  gamepadIndicator?.classList.remove("connected");
  if (gamepadIndicatorText) gamepadIndicatorText.textContent = "Gamepad: none";
  sendPaddle(0, 127);
  sendPaddle(1, 127);
  sendPb(0, false);
  sendPb(1, false);
});

function directionForCode(code: string): PaddleDirection | null {
  for (const direction of PADDLE_DIRECTIONS) {
    if (paddleKeyBindings[direction] === code) return direction;
  }
  return null;
}

// PB0/PB1 (Open/Closed Apple) are driven from three sources (gamepad poll,
// keyboard-paddle poll, Alt keys) so sends are deduped to last-known state
const pbDown = [false, false];

function sendPb(index: 0 | 1, down: boolean): void {
  if (pbDown[index] === down) return;
  pbDown[index] = down;
  client.sendPaddleButton(index, down);
}

const paddleValues = [-1, -1];

function sendPaddle(index: 0 | 1, value: number): void {
  if (paddleValues[index] === value) return;
  paddleValues[index] = value;
  client.sendPaddle(index, value);
}

function pollPaddles(): void {
  if (paddleType === "gamepad" && gamepadIndex !== null) {
    const pad = navigator.getGamepads()[gamepadIndex];
    if (pad) {
      const axisX = pad.axes[0] ?? 0;
      const axisY = pad.axes[1] ?? 0;
      sendPaddle(0, Math.round((axisX + 1) * 127.5));
      sendPaddle(1, Math.round((axisY + 1) * 127.5));
      sendPb(0, pad.buttons[0]?.pressed === true);
      sendPb(1, pad.buttons[1]?.pressed === true);
    }
  } else if (paddleType === "keys") {
    sendPaddle(0, kbPaddleState.left ? 0 : kbPaddleState.right ? 255 : 127);
    sendPaddle(1, kbPaddleState.up ? 0 : kbPaddleState.down ? 255 : 127);
    sendPb(0, kbPaddleState.fire);
    sendPb(1, kbPaddleState.fire2);
  }
}

// ---- Keyboard input (Apple II ASCII latch) ----

const activeAsciiByCode = new Map<string, number>();
let lastKeyboardHintAt = 0;

function romRestoredStatus(romFilename: string | undefined, media: StoredMedia | null): string {
  return media
    ? `ROM restored (${romFilename ?? "Apple //e"}). Loaded "${media.filename}". Ready.`
    : `ROM restored (${romFilename ?? "Apple //e"}). Insert a disk to boot, or use the Monitor.`;
}

async function onFirstGesture(): Promise<boolean> {
  await ensureAudioStarted();
  if (romLoaded && !hasPoweredOn) {
    hasPoweredOn = true;
    client.reset();
    setPaused(false);
    const storedRom = loadRomFromStorage();
    const storedMedia = await loadSessionMedia();
    setStatus(romRestoredStatus(storedRom?.filename, storedMedia));
    return true;
  }
  return false;
}

canvas?.addEventListener("pointerdown", () => {
  if (document.activeElement instanceof HTMLElement && isInteractiveElement(document.activeElement)) {
    document.activeElement.blur();
  }
  void onFirstGesture();
});
screenFrame?.addEventListener("pointerdown", () => {
  if (document.activeElement instanceof HTMLElement && isInteractiveElement(document.activeElement)) {
    document.activeElement.blur();
  }
  void onFirstGesture();
});

function asciiDebug(code: number): string {
  const hex = `$${code.toString(16).toUpperCase().padStart(2, "0")}`;
  return code >= 0x20 && code < 0x7f ? `${hex} '${String.fromCharCode(code)}'` : hex;
}

window.addEventListener("keydown", (e) => {
  if (isInteractiveElement(e.target)) {
    if (!e.repeat) logEvent(`key ${e.code} ignored — focus is in a UI field`, "debug");
    return;
  }
  // Escape closes whichever modal is open (the setup gate stays up until a
  // ROM is loaded); otherwise Escape passes through as $1B to the machine.
  if (e.code === "Escape") {
    if (setupModal.style.display !== "none") {
      if (romLoaded) {
        e.preventDefault();
        hideSetupModal();
      }
      return;
    }
    if (paddleModal.style.display !== "none") {
      e.preventDefault();
      closeModal(paddleModal);
      return;
    }
    if (confirmLoadModal.style.display !== "none") {
      e.preventDefault();
      dismissConfirmLoad();
      return;
    }
  }
  // With a modal overlaying the screen, keys must not reach the machine.
  if (isModalOpen()) {
    if (!e.repeat) logEvent(`key ${e.code} ignored — a modal is open`, "debug");
    return;
  }
  // Ctrl+Break / Ctrl+Pause = Ctrl+Reset
  if (e.ctrlKey && (e.code === "Break" || e.code === "Pause")) {
    e.preventDefault();
    resetBtn.click();
    return;
  }
  // Pause/Break triggers NMI on real Apple //e hardware
  if (e.code === "Pause") {
    e.preventDefault();
    client.sendNmi();
    return;
  }
  const isPowerOn = romLoaded && !hasPoweredOn;
  void onFirstGesture();
  if (isPowerOn) {
    e.preventDefault();
    return;
  }
  if (e.code === "F5") {
    e.preventDefault();
    void quickSaveCurrentSlot();
    return;
  }
  if (e.code === "F8") {
    e.preventDefault();
    void quickLoadCurrentSlot();
    return;
  }
  if (paddleType === "keys") {
    const direction = directionForCode(e.code);
    if (direction) {
      e.preventDefault();
      kbPaddleState[direction] = true;
      return;
    }
  }
  // Alt keys = Open/Closed Apple (PB0/PB1); explicit paddle bindings win above
  if (e.code === "AltLeft" || e.code === "AltRight") {
    e.preventDefault();
    sendPb(e.code === "AltLeft" ? 0 : 1, true);
    return;
  }
  // The machine only reacts to keys when running code that polls the
  // keyboard: with no disk inserted the boot ROM spins in the drive's boot
  // PROM (like real hardware with an empty drive), and while paused no frames
  // execute at all. Say so instead of silently swallowing keystrokes.
  const now = performance.now();
  if (romLoaded && now - lastKeyboardHintAt > 8000) {
    if (paused) {
      lastKeyboardHintAt = now;
      setStatus("Emulation is paused — press Resume (or the Pause button) for keystrokes to register.", "warn");
    } else if (!driveLoaded[0] && !driveLoaded[1] && hasPoweredOn) {
      lastKeyboardHintAt = now;
      setStatus("No disk inserted — the boot ROM is waiting on the drive. Press Reset for the BASIC prompt, or insert a disk.", "warn");
    }
  }
  const ascii = keyEventToAscii(e);
  if (ascii === null) {
    if (!e.repeat) logEvent(`key ${e.code} ignored — no Apple II mapping`, "debug");
    return;
  }
  e.preventDefault();
  if (!activeAsciiByCode.has(e.code) && !e.repeat) {
    logEvent(`key ${e.code} -> machine ${asciiDebug(ascii)}`, "debug");
  }
  activeAsciiByCode.set(e.code, ascii);
  client.sendKey(ascii, true);
});

window.addEventListener("keyup", (e) => {
  if (isInteractiveElement(e.target)) return;
  if (e.code === "AltLeft" || e.code === "AltRight") {
    e.preventDefault();
    sendPb(e.code === "AltLeft" ? 0 : 1, false);
    return;
  }
  if (paddleType === "keys") {
    const direction = directionForCode(e.code);
    if (direction) {
      e.preventDefault();
      kbPaddleState[direction] = false;
      return;
    }
  }
  const ascii = activeAsciiByCode.get(e.code);
  if (ascii === undefined) return;
  e.preventDefault();
  activeAsciiByCode.delete(e.code);
  client.sendKey(ascii, false);
  logEvent(`key ${e.code} released`, "debug");
});

// Release every latched key/paddle input when the tab loses focus, so a
// keyup missed during alt-tab can't leave the machine with a stuck key.
window.addEventListener("blur", () => {
  for (const [code, ascii] of [...activeAsciiByCode]) {
    client.sendKey(ascii, false);
    activeAsciiByCode.delete(code);
  }
  sendPb(0, false);
  sendPb(1, false);
  for (const key of Object.keys(kbPaddleState) as (keyof typeof kbPaddleState)[]) {
    kbPaddleState[key] = false;
  }
});

// Clicked buttons blur immediately so a later Space/Enter reaches the
// emulated machine instead of re-triggering the toolbar control.
document.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement | null)?.closest?.("button");
  if (btn) btn.blur();
});

// ---- Frame loop ----

let frameLoopRunning = false;

function frameLoop(): void {
  const frame = client.pollFrame();
  if (frame) display.render(frame);
  audio.pumpFallbackAudio(client);
  pollPaddles();

  const now = performance.now();
  const elapsed = now - lastFpsUpdate;
  if (elapsed >= 500) {
    const frames = client.getFrameCount();
    const frameDelta = frames - lastFpsFrameCount;
    if (elapsed <= 2000 && frameDelta >= 0) currentFps = (frameDelta * 1000) / elapsed;
    lastFpsUpdate = now;
    lastFpsFrameCount = frames;
    updateFpsUi();
  }
  // Always keep the loop alive: while the worker is paused pollFrame simply
  // returns null, and resuming can never strand the canvas with a dead loop.
  requestAnimationFrame(frameLoop);
}

client.onReady = () => {
  if (!frameLoopRunning) {
    frameLoopRunning = true;
    requestAnimationFrame(frameLoop);
  }
};

void restoreSession();

// ---- MCP bridge ----

const mcpInstanceId = Math.random().toString(36).slice(2, 8);
const mcpIndicator = document.getElementById("mcp-indicator") as HTMLDivElement;
const mcpIndicatorText = document.getElementById("mcp-indicator-text") as HTMLSpanElement;

let mcpEnabled = localStorage.getItem(LS_KEYS.mcpEnabled) === "true";
let mcpWs: WebSocket | null = null;
let mcpReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let mcpReconnectDelay = 2000;
const mcpReconnectMaxDelay = 30000;
let mcpCommandTail: Promise<void> = Promise.resolve();

function setMcpConnected(connected: boolean): void {
  mcpIndicator.classList.toggle("connected", connected);
  mcpIndicatorText.textContent = `MCP: ${connected ? "connected" : mcpEnabled ? "offline" : "disabled"} (${mcpInstanceId})`;
}

function disconnectMcpBridge(): void {
  if (mcpReconnectTimer !== null) {
    clearTimeout(mcpReconnectTimer);
    mcpReconnectTimer = null;
  }
  if (mcpWs) {
    const ws = mcpWs;
    mcpWs = null;
    ws.onclose = null;
    ws.close();
  }
  setMcpConnected(false);
}

function setMcpEnabled(enabled: boolean): void {
  mcpEnabled = enabled;
  localStorage.setItem(LS_KEYS.mcpEnabled, String(enabled));
  if (enabled) {
    connectMcpBridge();
  } else {
    disconnectMcpBridge();
  }
}

mcpIndicator.style.cursor = "pointer";
mcpIndicator.title = "Click to toggle MCP bridge";
mcpIndicator.addEventListener("click", () => setMcpEnabled(!mcpEnabled));
setMcpConnected(false);

// ---- Server heartbeat ----

const SERVER_HEARTBEAT_INTERVAL_MS = 5000;
const SERVER_HEARTBEAT_TIMEOUT_MS = 4000;

let serverOnline = true;
let serverHeartbeatTimer: ReturnType<typeof setTimeout> | null = null;

function setServerOnline(online: boolean): void {
  if (serverOnline === online) return;
  serverOnline = online;
  document.body.classList.toggle("server-offline", !online);
  if (online) {
    closeModal(serverModal);
    return;
  }
  serverModalHint.textContent = `No response from ${window.location.origin} — retrying…`;
  openModal(serverModal);
}

async function pollServer(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SERVER_HEARTBEAT_TIMEOUT_MS);
  try {
    await fetch(new URL("healthz", window.location.href), {
      cache: "no-store",
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function heartbeat(): Promise<void> {
  setServerOnline(await pollServer());
  serverHeartbeatTimer = setTimeout(() => void heartbeat(), SERVER_HEARTBEAT_INTERVAL_MS);
}

serverModalRetryBtn.addEventListener("click", () => {
  if (serverHeartbeatTimer !== null) {
    clearTimeout(serverHeartbeatTimer);
    serverHeartbeatTimer = null;
  }
  void heartbeat();
});

void heartbeat();

async function handleMcpCommand(message: McpBridgeCommand): Promise<unknown> {
  switch (message.cmd) {
    case "getStatus":
      return { romLoaded, paused, diskLoaded: driveLoaded[0], diskLoaded2: driveLoaded[1] };
    case "readScreen":
      return { pngBase64: canvas.toDataURL("image/png").split(",")[1] };
    case "saveSnapshot": {
      if (!romLoaded) throw new Error("saveSnapshot: no ROM loaded yet.");
      const data = await client.saveState();
      return { dataBase64: arrayBufferToBase64(data) };
    }
    case "loadRom":
      client.loadRom(base64ToArrayBuffer(message.romBase64));
      client.reset();
      romLoaded = true;
      hasPoweredOn = true;
      setPaused(false);
      return null;
    case "loadSnapshot":
      hasPoweredOn = true;
      client.loadState(base64ToArrayBuffer(message.dataBase64));
      setPaused(false);
      return null;
    case "loadDisk": {
      const data = base64ToArrayBuffer(message.dataBase64);
      const drive = (message.drive ?? 1) - 1;
      logEvent(`[MCP] Loading disk (${message.format}, ${data.byteLength} bytes) into drive ${drive + 1}.`, "debug");
      client.loadDisk(message.format, data, drive);
      markDriveLoaded(drive as 0 | 1, `disk.${message.format}`);
      await saveSessionMedia(
        { filename: `disk.${message.format}`, format: message.format, data: data.slice(0) },
        drive,
      );
      return null;
    }
    case "ejectDisk": {
      const drive = (message.drive ?? 1) - 1;
      logEvent(`[MCP] Ejecting disk from drive ${drive + 1}.`, "debug");
      client.ejectDisk(drive);
      clearDriveUi(drive as 0 | 1);
      await saveSessionMedia(null, drive);
      return null;
    }
    case "reset":
      client.reset();
      return null;
    case "keyEvent":
      client.sendKey(message.ascii, message.down);
      return null;
    case "typeText":
      await typeText(message.text);
      return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function typeText(text: string): Promise<void> {
  for (const ch of text) {
    const ascii = ch === "\n" ? 0x0d : ch.charCodeAt(0) & 0x7f;
    client.sendKey(ascii, true);
    await sleep(60);
    client.sendKey(ascii, false);
    await sleep(120);
  }
}

document.querySelectorAll<HTMLButtonElement>("button[data-macro]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const macro = btn.dataset.macro;
    if (!macro) return;
    void onFirstGesture();
    void typeText(`${macro}\n`);
  });
});

function connectMcpBridge(): void {
  if (!mcpEnabled || mcpWs) return;
  const ws = new WebSocket(`ws://localhost:${MCP_BRIDGE_PORT}`);
  mcpWs = ws;
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "hello", instanceId: mcpInstanceId }));
    setMcpConnected(true);
    mcpReconnectDelay = 2000;
  };
  ws.onclose = () => {
    if (mcpWs === ws) mcpWs = null;
    setMcpConnected(false);
    if (mcpEnabled) {
      mcpReconnectTimer = setTimeout(connectMcpBridge, mcpReconnectDelay);
      mcpReconnectDelay = Math.min(mcpReconnectDelay * 2, mcpReconnectMaxDelay);
    }
  };
  ws.onmessage = (event) => {
    if (mcpWs !== ws) return;
    const message = JSON.parse(event.data as string) as McpBridgeCommand;
    mcpCommandTail = mcpCommandTail.then(() => handleMcpCommand(message)).then(
      (result) => ws.send(JSON.stringify({ reqId: message.reqId, ok: true, result })),
      (err) =>
        ws.send(
          JSON.stringify({
            reqId: message.reqId,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          }),
        ),
    );
  };
}

connectMcpBridge();
