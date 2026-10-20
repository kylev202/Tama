import { icon } from './icons.js';

/**
 * Builds an element. Text always goes in as text nodes, so titles from songs, tasks or the
 * clipboard can never inject markup into a window that can call native commands.
 * Props: `class`, `on<event>` listeners, `dataset`, `style` (object), booleans, attributes.
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style') for (const [prop, v] of Object.entries(value)) el.style.setProperty(prop, v);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key === 'value' || key === 'checked' || key === 'disabled' || key === 'hidden') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** An icon-only button with an accessible name. */
export function iconButton(name, label, onclick, extraClass = '') {
  return h('button', { class: `icon-btn press ${extraClass}`.trim(), type: 'button', 'aria-label': label, title: label, onclick }, icon(name));
}

/** A labelled button. `kind` is '', 'primary' or 'ghost'. */
export function button(text, onclick, { kind = '', iconName, label } = {}) {
  return h(
    'button',
    { class: `btn press ${kind}`.trim(), type: 'button', onclick, 'aria-label': label },
    iconName ? icon(iconName) : null,
    text,
  );
}

/** A circular progress ring. Returns the svg plus a setter for 0..1. */
export function ring(size, stroke, color) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'ring');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('aria-hidden', 'true');
  const circle = (cls) => {
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('class', cls);
    c.setAttribute('cx', size / 2);
    c.setAttribute('cy', size / 2);
    c.setAttribute('r', radius);
    c.setAttribute('stroke-width', stroke);
    svg.append(c);
    return c;
  };
  circle('track');
  const value = circle('value');
  value.setAttribute('stroke-dasharray', circumference);
  if (color) svg.style.setProperty('--ring-color', color);
  const set = (fraction) => {
    const f = Math.min(1, Math.max(0, fraction || 0));
    value.setAttribute('stroke-dashoffset', circumference * (1 - f));
    value.style.opacity = f > 0 ? 1 : 0;
  };
  set(0);
  return { el: svg, set, tint: (c) => svg.style.setProperty('--ring-color', c) };
}

/** Replaces an element's children, keeping the element. */
export function fill(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

export const listTint = (list) => (list === 'study' ? 'var(--study)' : 'var(--work)');
export const listName = (list) => (list === 'study' ? 'Study' : 'Work');
