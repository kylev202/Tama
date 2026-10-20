// Thin wrappers over Tauri's global API (enabled with `withGlobalTauri`).
const tauri = window.__TAURI__;

export const invoke = (command, args) => tauri.core.invoke(command, args);

export const listen = (event, handler) => tauri.event.listen(event, (e) => handler(e.payload));
