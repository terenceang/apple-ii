export const LS_KEYS = {
  rom: "apple2_rom",
  volume: "apple2_volume",
  muted: "apple2_muted",
  libraryOpen: "apple2_library_open",
  controlsOpen: "apple2_controls_open",
  leftTab: "apple2_left_tab",
  rightTab: "apple2_right_tab",
  paddleType: "apple2_paddle_type",
  paddleBindings: "apple2_paddle_bindings",
  mcpEnabled: "apple2_mcp_enabled",
} as const;

export const IDB_DATABASES = {
  session: "apple2-session",
  disks: "apple2-disks",
  saveStates: "apple2_save_states",
} as const;

export const SESSION_MEDIA_KEYS = ["last_media", "last_media_2"] as const;
