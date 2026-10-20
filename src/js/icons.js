// One stroke icon set, drawn on a 24px grid. Static markup only, never user data.
const PATHS = {
  today: '<circle cx="12" cy="12" r="8.5"/><path d="m8.4 12.3 2.5 2.5 4.8-5.1"/>',
  focus: '<circle cx="12" cy="13.2" r="7.3"/><path d="M12 9.6v3.6l2.4 1.5M9.6 2.9h4.8"/>',
  music: '<path d="M9 17.5V6.2l10-2.1v11.4"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="15.5" r="2.5"/>',
  clipboard: '<rect x="5.5" y="4.5" width="13" height="16" rx="2.5"/><path d="M9 4.5a3 3 0 0 1 6 0M9 10.5h6M9 14.5h3.5"/>',
  search: '<circle cx="11" cy="11" r="6.3"/><path d="m15.7 15.7 4.1 4.1"/>',
  wallpaper: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="m3.5 16 4.6-4.6a1.5 1.5 0 0 1 2.1 0l5.9 5.8M14 13.6l1.4-1.4a1.5 1.5 0 0 1 2.1 0l3 3"/><circle cx="15.6" cy="9" r="1.3"/>',
  routines: '<path d="M4.5 12a7.5 7.5 0 0 1 12.8-5.3L19.5 9M19.5 4.5V9H15M19.5 12a7.5 7.5 0 0 1-12.8 5.3L4.5 15M4.5 19.5V15H9"/>',
  settings: '<path d="M4 7h9.5M17.5 7H20M4 17h2.5M10.5 17H20"/><circle cx="15.5" cy="7" r="2"/><circle cx="8.5" cy="17" r="2"/>',
  stats: '<path d="M3.5 12.5h3.6l2.4-6 4.5 11 2.4-5h4.1"/>',
  play: '<path d="M8.5 5.8v12.4a.8.8 0 0 0 1.2.7l9.6-6.2a.8.8 0 0 0 0-1.4L9.7 5.1a.8.8 0 0 0-1.2.7z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6.8" y="5.5" width="3.6" height="13" rx="1.1" fill="currentColor" stroke="none"/><rect x="13.6" y="5.5" width="3.6" height="13" rx="1.1" fill="currentColor" stroke="none"/>',
  next: '<path d="M5.5 6.6v10.8a.8.8 0 0 0 1.2.7l8.3-5.4a.8.8 0 0 0 0-1.4L6.7 5.9a.8.8 0 0 0-1.2.7z" fill="currentColor" stroke="none"/><rect x="16.2" y="5.8" width="2.6" height="12.4" rx="1.1" fill="currentColor" stroke="none"/>',
  previous: '<path d="M18.5 6.6v10.8a.8.8 0 0 1-1.2.7L9 12.7a.8.8 0 0 1 0-1.4l8.3-5.4a.8.8 0 0 1 1.2.7z" fill="currentColor" stroke="none"/><rect x="5.2" y="5.8" width="2.6" height="12.4" rx="1.1" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2.5" fill="currentColor" stroke="none"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5.5 12.5 4 4 9-9"/>',
  close: '<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>',
  trash: '<path d="M5 7h14M10 4h4M7 7l.8 11.2a2 2 0 0 0 2 1.8h4.4a2 2 0 0 0 2-1.8L17 7"/>',
  pin: '<path d="M9 4.5h6l-1 5.2 3 2.8H7l3-2.8zM12 12.5v7"/>',
  volume: '<path d="M4 9.5h3l4.5-4v13L7 14.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  mute: '<path d="M4 9.5h3l4.5-4v13L7 14.5H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
  moon: '<path d="M19 14.5A7.5 7.5 0 1 1 9.5 5a6 6 0 0 0 9.5 9.5z"/>',
  display: '<rect x="3.5" y="4.5" width="17" height="11.5" rx="2"/><path d="M9 20h6M12 16v4"/>',
  bluetooth: '<path d="m7 7.5 10 9-5 4V3.5l5 4-10 9"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.2 0 1.8-.9 1.4-2l-.3-.8c-.4-1.1.4-2.2 1.6-2.2h1.8a4 4 0 0 0 4-4C20.5 7 16.7 3.5 12 3.5z"/><circle cx="7.8" cy="11" r="1.1"/><circle cx="10.5" cy="7.6" r="1.1"/><circle cx="15" cy="8" r="1.1"/>',
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  flame: '<path d="M12 20.5c-3.6 0-6-2.4-6-5.6 0-3.4 3-5 3.9-8.4.2-.8 1.2-1 1.6-.3C13 9 18 10.6 18 15c0 3.2-2.4 5.5-6 5.5z"/>',
  work: '<rect x="3.5" y="7.5" width="17" height="11.5" rx="2.5"/><path d="M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5M3.5 12.5h17"/>',
  study: '<path d="M12 6.6c-1.8-1.3-4.2-2-7.5-2v13c3.3 0 5.7.7 7.5 2 1.8-1.3 4.2-2 7.5-2v-13c-3.3 0-5.7.7-7.5 2zM12 6.6v13"/>',
  bell: '<path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5H5z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14" rx="2.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  flag: '<path d="M6 20.5v-16M6 4.5h10.5l-2 4 2 4H6"/>',
  chevronDown: '<path d="m6.5 9.5 5.5 5.5 5.5-5.5"/>',
  chevronRight: '<path d="m9.5 6.5 5.5 5.5-5.5 5.5"/>',
  chevronLeft: '<path d="m14.5 6.5-5.5 5.5 5.5 5.5"/>',
  more: '<circle cx="5.5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  repeat: '<path d="M4.5 11.5V10a3.5 3.5 0 0 1 3.5-3.5h11.5M16.5 3.5l3 3-3 3M19.5 12.5V14a3.5 3.5 0 0 1-3.5 3.5H4.5M7.5 20.5l-3-3 3-3"/>',
  steps: '<path d="m4.5 7.2 1.8 1.8 3.2-3.3M4.5 15.2l1.8 1.8 3.2-3.3M12.5 7.5h7M12.5 15.5h7"/>',
  note: '<path d="M6 4.5h8.5L18 8v11.5H6z"/><path d="M14 4.5V8h4M9 12h6M9 15.5h4"/>',
  lyrics: '<path d="M5 5.5h14A1.5 1.5 0 0 1 20.5 7v8.5A1.5 1.5 0 0 1 19 17h-7l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5z"/><path d="M8 10h8M8 13h5"/>',
  upcoming: '<rect x="4" y="5.5" width="16" height="14" rx="2.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4M8 14h3M8 16.8h6"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.3 2.4 3.5 5.2 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.2-3.5-8.5S9.7 5.9 12 3.5z"/>',
  video: '<rect x="3" y="6" width="18" height="12" rx="4"/><path d="M10.5 9.6v4.8l4-2.4z" fill="currentColor"/>',
  cart: '<path d="M3.5 5h2.2l2.1 10h10.4l2-7.2H7"/><circle cx="9.6" cy="18.6" r="1.3"/><circle cx="16.6" cy="18.6" r="1.3"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  app: '<rect x="4.5" y="4.5" width="15" height="15" rx="4"/>',
  edit: '<path d="M15 5.5l3.5 3.5L9 18.5H5.5V15z"/>',
  coffee: '<path d="M5 9.5h11v4.5a4.5 4.5 0 0 1-4.5 4.5h-2A4.5 4.5 0 0 1 5 14z"/><path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16M8.5 3.5c-.6.9-.6 1.6 0 2.5M12 3.5c-.6.9-.6 1.6 0 2.5"/>',
  sparkle: '<path d="M12 3.8 13.8 9l5.2 1.8-5.2 1.8L12 17.8l-1.8-5.2L5 10.8 10.2 9z"/>',
  power: '<path d="M12 3.5v8M7.2 6.5a7 7 0 1 0 9.6 0"/>',
  key: '<circle cx="8" cy="15.5" r="4"/><path d="m10.9 12.6 8.6-8.6M16.5 7l2.5 2.5M14 9.5l2 2"/>',
  send: '<path d="M12 19V5.5M6.5 11 12 5.5l5.5 5.5"/>',
  rocket: '<path d="M12 15.5 8.5 12c1.2-4.8 4.5-8 10-8.5-.5 5.5-3.7 8.8-8.5 10zM8.5 12l-3-.5 2.5-3h3.5M12 15.5l.5 3 3-2.5v-3.5"/><path d="M6 18c-.5-1.5.5-3 2-3"/>',
};

export function icon(name, label) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon');
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  svg.innerHTML = PATHS[name] ?? PATHS.app;
  return svg;
}
