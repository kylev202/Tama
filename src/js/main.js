// Wires the island together.
import { accent, onLook, scale, catShown, standby as standbyScene } from './appearance.js'; // first: it sets up the time formats
import { createAlerts } from './alerts.js';
import { button, fill, h, listName, listTint } from './dom.js';
import * as focus from './focus.js';
import { createIsland } from './island.js';
import { createLive } from './live.js';
import { startScheduler, describeActions } from './schedule.js';
import { createCat } from './cat.js';
import { createStandby } from './standby.js';
import { setDone, snooze, state } from './store.js';
import { createTabs } from './tabs.js';
import { listen } from './tauri.js';
import { formatDuration, formatTime } from './time.js';
import chatbotPanel from './panels/chatbot.js';
import clipboardPanel from './panels/clipboard.js';
import focusPanel from './panels/focus.js';
import launchPanel from './panels/launch.js';
import morePanel from './panels/more.js';
import musicPanel from './panels/music.js';
import settingsPanel from './panels/settings.js';
import statsPanel from './panels/stats.js';
import todayPanel from './panels/today.js';
import wallpapersPanel from './panels/wallpapers.js';

const cat = createCat(document.getElementById('cat'));
const standby = createStandby(document.getElementById('standby'));
// Whatever sits in the middle of the bar hears when the island is being looked at.
const island = createIsland({
  setAttentive(value) {
    cat.setAttentive(value);
    standby.setAttentive(value);
  },
  lookAt: (x, y) => cat.lookAt(x, y),
});

// Shared with panels.
const app = {
  island,
  cat,
  open(tab, options = {}) {
    tabs.select(tab, options);
    island.set('open');
    tabs.select(tab, options);
  },
  toast: createToast(),
};

// Tasks, music and the chatbot up front; the desktop tools live under More. Routines are set
// up by chatting; the old Routines editor (panels/routines.js) is hidden.
const tabs = createTabs(
  island,
  [todayPanel(), focusPanel(), musicPanel(), chatbotPanel(), morePanel([clipboardPanel(), launchPanel(), wallpapersPanel(), statsPanel(), settingsPanel()])],
  app,
);
const alerts = createAlerts({ island, cat });
createLive({ island, cat, open: app.open });

startScheduler({
  onTask(task) {
    alerts.show({
      iconName: 'bell',
      tint: listTint(task.list),
      title: task.title,
      sub: `${listName(task.list)} · due ${formatTime(task.due)}`,
      actions: [
        { label: 'Snooze 10 min', run: () => snooze(task, 10) },
        {
          label: 'Mark done',
          primary: true,
          run: () => {
            setDone(task, true);
            cat.react('happy');
          },
        },
      ],
    });
  },
  onRoutine(routine) {
    alerts.show({
      iconName: 'routines',
      title: `${routine.name || 'Routine'} ran`,
      sub: describeActions(routine),
      actions: [{ label: 'OK', primary: true }],
      timeout: 8000,
    });
  },
  onFocus(id) {
    const finished = focus.finish(id);
    if (finished) announceFocusEnd(finished);
  },
});

// Fallback if the native alarm never arrives (it normally does): finish locally.
setInterval(() => {
  const session = focus.session();
  if (session && session.pausedLeft == null && Date.now() > session.endsAt + 3000) {
    const finished = focus.finish(session.id);
    if (finished) announceFocusEnd(finished);
  }
}, 1000);

function announceFocusEnd(session) {
  if (session.kind === 'focus') {
    const task = state.tasks.find((t) => t.id === session.taskId);
    cat.react('celebrate');
    alerts.show({
      iconName: 'sparkle',
      title: 'Focus session done',
      sub: `${formatDuration(session.length)}${task ? ` on ${task.title}` : ''}. Take ${state.focus.breakLength}?`,
      actions: [
        { label: 'Not now' },
        { label: `Start ${state.focus.breakLength} min break`, primary: true, run: () => focus.start('break', session.taskId) },
      ],
    });
  } else {
    alerts.show({
      iconName: 'coffee',
      title: 'Break is over',
      sub: 'Ready for another round?',
      actions: [
        { label: 'Done for now' },
        { label: 'Start focus', primary: true, run: () => focus.start('focus', session.taskId) },
      ],
    });
  }
}

// The cat draws only while it can be seen: not behind a fullscreen app, not switched off.
// The standby scene in its place draws only while the island rests.
let onScreen = true;
const runCat = () => (onScreen && catShown() ? cat.start() : cat.stop());
const runStandby = () => (onScreen && standbyScene() !== 'none' && island.state === 'rest' ? standby.start() : standby.stop());
island.onChange(runStandby);

// Hidden while a fullscreen app has the screen: stop drawing, put everything away.
listen('island-visible', (visible) => {
  onScreen = visible;
  runCat();
  runStandby();
  if (!visible) island.set('rest');
});

onLook((look) => {
  island.setLook({ style: look.style, scale: scale(), hoverPeek: look.hoverPeek });
  cat.setTint(accent());
  cat.setAntics(look.antics);
  standby.configure({ scene: standbyScene(), tint: accent(), light: look.surface === 'light' });
  runCat();
  runStandby();
});

// The island is a widget, not a browser page: no page menu, reload, print, find or caret
// browsing. Text fields keep their cut, copy and paste menu.
addEventListener('contextmenu', (e) => {
  if (!e.target.closest?.('input, textarea')) e.preventDefault();
});
addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  if (['f3', 'f5', 'f7'].includes(key) || (e.ctrlKey && ['f', 'g', 'p', 'r', 's', 'u'].includes(key))) e.preventDefault();
});

/** A short message with one action, shown inside the open island. */
function createToast() {
  let current = null;
  let timer = 0;
  return (message, action) => {
    clearTimeout(timer);
    current?.remove();
    const layer = document.getElementById('layer-open');
    current = h(
      'div',
      { class: 'toast', role: 'status' },
      message,
      action &&
        button(action.label, () => {
          action.run();
          current?.remove();
        }),
    );
    layer.append(current);
    timer = setTimeout(() => current?.remove(), 5000);
  };
}
