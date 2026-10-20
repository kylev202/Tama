// Chatbot: chat with a model that sets up and looks after your routines.
//   "Every weekday at 9:00, open Unity and Spotify."
//   "Move my morning routine to 8:30."
import { button, fill, h, iconButton } from '../dom.js';
import { icon } from '../icons.js';
import { createChat } from '../chat.js';
import { nextRun } from '../schedule.js';
import { state } from '../store.js';
import { invoke } from '../tauri.js';
import { formatDue } from '../time.js';

const KEYS_PAGE = 'https://console.groq.com/keys';
const EXAMPLES = ['Every weekday at 9:00, open Spotify', 'Tomorrow at 8:00, open YouTube', 'What routines do I have?'];

export default function chatbotPanel() {
  let app;
  let root;
  let visible = false;
  let hasKey = null; // unknown until first shown
  let changingKey = false;
  let keyError = '';
  let items = []; // what the chat shows: { kind: 'user' | 'bot' | 'event' | 'error', text, iconName }
  let busy = false;
  let els;

  const chat = createChat({
    show(item) {
      items.push(item);
      renderChat();
    },
    undo(message, run) {
      app.toast(message, {
        label: 'Undo',
        run: () => {
          run();
          renderChat();
        },
      });
    },
  });

  function render() {
    if (!hasKey || changingKey) renderKeyForm();
    else {
      fill(root, els.head, els.list, els.composer);
      renderChat();
    }
  }

  function renderChat() {
    if (!els) return;
    els.summary.textContent = routinesLine();
    els.newChat.disabled = busy || !items.length;
    els.send.disabled = busy;
    if (!items.length && !busy) {
      fill(
        els.list,
        h(
          'div',
          { class: 'empty' },
          icon('sparkle'),
          h('strong', {}, 'Ask anything'),
          'Say what to open and when, and the chatbot sets up the routine. Or ask about the ones you have.',
          h(
            'div',
            { class: 'chat-examples' },
            EXAMPLES.map((text) => h('button', { class: 'chip press', type: 'button', onclick: () => send(text) }, text)),
          ),
        ),
      );
      return;
    }
    fill(
      els.list,
      items.map((item) => {
        if (item.kind === 'event') return h('div', { class: 'chat-event' }, icon(item.iconName), item.text);
        if (item.kind === 'error') {
          return h(
            'div',
            { class: 'chat-msg error', role: 'alert' },
            item.text,
            /API key/.test(item.text) ? button('Change key', changeKey, { kind: 'ghost' }) : null,
          );
        }
        return h('div', { class: `chat-msg ${item.kind}` }, item.text);
      }),
      busy ? h('div', { class: 'chat-thinking', role: 'status', 'aria-label': 'The chatbot is thinking' }, h('span'), h('span'), h('span')) : null,
    );
    els.list.scrollTop = els.list.scrollHeight;
  }

  /** "3 routines · next Tomorrow 09:00", so the routines are still in sight. */
  function routinesLine(now = Date.now()) {
    const count = state.routines.length;
    if (!count) return 'No routines yet';
    const next = state.routines
      .filter((r) => r.enabled)
      .map((r) => nextRun(r, now))
      .filter((at) => at != null)
      .sort((a, b) => a - b)[0];
    const label = `${count} routine${count === 1 ? '' : 's'}`;
    return next == null ? label : `${label} · next ${formatDue(next, false, now)}`;
  }

  async function send(text) {
    text = text.trim();
    if (!text || busy) return;
    items.push({ kind: 'user', text });
    busy = true;
    els.input.value = '';
    renderChat();
    try {
      await chat.send(text);
    } catch (error) {
      items.push({ kind: 'error', text: error.message });
      if (!els.input.value) els.input.value = text; // ready to send again
    }
    busy = false;
    renderChat();
  }

  function newChat() {
    chat.reset();
    items = [];
    renderChat();
    app.island.borrowKeyboard(els.input);
  }

  function changeKey() {
    changingKey = true;
    keyError = '';
    render();
  }

  function renderKeyForm() {
    const input = h('input', {
      type: 'password',
      placeholder: 'gsk_…',
      'aria-label': 'Groq API key',
      autocomplete: 'off',
      spellcheck: 'false',
    });
    const save = async (e) => {
      e.preventDefault();
      const key = input.value.trim();
      if (!key) return input.focus();
      try {
        await invoke('chat_key_set', { key });
        hasKey = true;
        changingKey = false;
        render();
      } catch (error) {
        keyError = `Couldn't save the key: ${error}`;
        render();
      }
    };
    const remove = async () => {
      await invoke('chat_key_set', { key: '' }).catch(console.error);
      hasKey = false;
      changingKey = false;
      chat.reset();
      items = [];
      render();
    };
    fill(
      root,
      h(
        'form',
        { class: 'chat-key', onsubmit: save },
        h('div', { class: 'empty compact' }, icon('sparkle'), h('strong', {}, hasKey ? 'Change your Groq key' : 'Add a free Groq key')),
        h('label', { class: 'field' }, icon('key'), input),
        keyError ? h('p', { class: 'form-error', role: 'alert' }, keyError) : null,
        h(
          'div',
          { class: 'editor-row' },
          button('Get a key', () => invoke('url_open', { url: KEYS_PAGE }).catch(console.error), { kind: 'ghost', iconName: 'link' }),
          h('span', { class: 'spacer' }),
          hasKey ? button('Remove key', remove, { kind: 'ghost', iconName: 'trash' }) : null,
          hasKey
            ? button('Cancel', () => {
                changingKey = false;
                render();
              })
            : null,
          h('button', { class: 'btn primary press', type: 'submit' }, 'Save key'),
        ),
      ),
    );
  }

  return {
    id: 'chatbot',
    label: 'Chatbot',
    icon: 'sparkle',
    mount(view, context) {
      app = context;
      root = view;
      const summary = h('span', { class: 'panel-sub' });
      const newChatButton = iconButton('plus', 'New chat', newChat);
      const input = h('input', { type: 'text', placeholder: 'Ask anything', 'aria-label': 'Message to the chatbot', maxlength: 2000 });
      const sendButton = h('button', { class: 'icon-btn chat-send press', type: 'submit', 'aria-label': 'Send', title: 'Send' }, icon('send'));
      els = {
        summary,
        newChat: newChatButton,
        input,
        send: sendButton,
        head: h('div', { class: 'panel-head' }, summary, h('span', { class: 'chat-tools' }, newChatButton, iconButton('key', 'API key', changeKey))),
        list: h('div', { class: 'chat-list scroll' }),
        composer: h(
          'form',
          {
            class: 'chat-composer',
            onsubmit: (e) => {
              e.preventDefault();
              send(input.value);
            },
          },
          h('label', { class: 'field grow' }, input),
          sendButton,
        ),
      };
    },
    async show({ user } = {}) {
      visible = true;
      hasKey ??= await invoke('chat_key_status').catch(() => false);
      if (!visible) return;
      render();
      if (user && hasKey && !changingKey) app.island.borrowKeyboard(els.input);
    },
    hide() {
      visible = false;
    },
  };
}
