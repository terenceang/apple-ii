export interface DriveElements {
  led: HTMLSpanElement | null;
  screenLed: HTMLSpanElement | null;
  statusText: HTMLSpanElement | null;
  fileInput: HTMLInputElement | null;
  fileText: HTMLSpanElement | null;
  ejectBtn: HTMLButtonElement | null;
  exportBtn: HTMLButtonElement | null;
  section: HTMLDivElement | null;
  badge: HTMLSpanElement | null;
}

export interface DriveUi {
  readonly drive: 0 | 1;
  readonly el: DriveElements;
  setLoaded(filename: string): void;
  clear(): void;
  setActivity(motorOn: boolean, inserted: boolean, track: number): void;
}

function driveId(base: string, drive: 0 | 1): string {
  return drive === 0 ? base : `${base}-2`;
}

function getDriveElements(drive: 0 | 1): DriveElements {
  return {
    led: document.getElementById(driveId("floppy-led", drive)) as HTMLSpanElement | null,
    screenLed: document.getElementById(driveId("screen-floppy-led", drive)) as HTMLSpanElement | null,
    statusText: document.getElementById(driveId("floppy-status-text", drive)) as HTMLSpanElement | null,
    fileInput: document.getElementById(driveId("disk-file-input", drive)) as HTMLInputElement | null,
    fileText: document.getElementById(driveId("disk-file-text", drive)) as HTMLSpanElement | null,
    ejectBtn: document.getElementById(driveId("disk-eject-btn", drive)) as HTMLButtonElement | null,
    exportBtn: document.getElementById(driveId("disk-export-btn", drive)) as HTMLButtonElement | null,
    section: document.getElementById(driveId("floppy-drive-section", drive)) as HTMLDivElement | null,
    badge: document.getElementById(`screen-drive-badge-${drive + 1}`) as HTMLSpanElement | null,
  };
}

export function createDriveUi(drive: 0 | 1): DriveUi {
  const el = getDriveElements(drive);
  const label = `Drive ${drive + 1}`;
  return {
    drive,
    el,
    setLoaded(filename: string): void {
      if (el.fileText) el.fileText.textContent = filename;
      if (el.ejectBtn) el.ejectBtn.disabled = false;
      el.section?.classList.add("has-disk");
      if (el.badge) {
        el.badge.classList.add("loaded");
        el.badge.title = `${label} — loaded: ${filename}`;
      }
    },
    clear(): void {
      if (el.fileText) el.fileText.textContent = "Insert Disk…";
      if (el.fileInput) el.fileInput.value = "";
      if (el.ejectBtn) el.ejectBtn.disabled = true;
      el.led?.classList.remove("active");
      el.screenLed?.classList.remove("active");
      if (el.statusText) el.statusText.textContent = "No disk inserted";
      el.section?.classList.remove("has-disk");
      if (el.badge) {
        el.badge.classList.remove("loaded");
        el.badge.title = `${label} — empty`;
      }
    },
    setActivity(motorOn: boolean, inserted: boolean, track: number): void {
      el.led?.classList.toggle("active", motorOn);
      el.screenLed?.classList.toggle("active", motorOn);
      if (el.statusText) {
        el.statusText.textContent = inserted ? `Track ${track}${motorOn ? " (active)" : ""}` : "No disk inserted";
      }
      if (el.exportBtn) el.exportBtn.disabled = !inserted;
    },
  };
}
