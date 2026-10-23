// Small DOM, formatting, date and motion helpers shared by every page.
import { locale, t } from './i18n.js';

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/** el('div', { class: 'x', text: 'hi', onclick, style: { width: '10px' }, data: { id: 1 } }, ...children) */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'style') Object.assign(node.style, value);
    else if (key === 'data') Object.assign(node.dataset, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child);
  return node;
}

export function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  for (const child of children) node.append(child);
  return node;
}

// Lucide-style 2px stroke icons.
const ICONS = {
  chevron: ['M6 9l6 6 6-6'],
  chevronLeft: ['M15 18l-6-6 6-6'],
  chevronRight: ['M9 18l6-6-6-6'],
  search: ['M21 21l-4.3-4.3', 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z'],
  check: ['M20 6L9 17l-5-5'],
  x: ['M18 6L6 18', 'M6 6l12 12'],
  plus: ['M5 12h14', 'M12 5v14'],
  arrowRight: ['M5 12h14', 'M12 5l7 7-7 7'],
  eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  eyeOff: ['M9.9 4.24A9 9 0 0 1 12 4c6.5 0 10 7 10 7a17 17 0 0 1-2.16 3.19', 'M6.61 6.61A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.39-1.61', 'M2 2l20 20', 'M14.12 14.12a3 3 0 1 1-4.24-4.24'],
  trash: ['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'],
  grid: ['M3 3h7v9H3z', 'M14 3h7v5h-7z', 'M14 12h7v9h-7z', 'M3 16h7v5H3z'],
  list: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'],
  tag: ['M12 2H2v10l9.3 9.3a1 1 0 0 0 1.4 0l8.6-8.6a1 1 0 0 0 0-1.4z', 'M7 7h.01'],
  pie: ['M21.21 15.89A10 10 0 1 1 8 2.83', 'M22 12A10 10 0 0 0 12 2v10z'],
  chartLine: ['M3 3v16a2 2 0 0 0 2 2h16', 'M19 9l-5 5-4-4-3 3'],
  mail: ['M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M22 7l-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7'],
  refresh: ['M3 12a9 9 0 0 1 15.5-6.3L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 0 1-15.5 6.3L3 16', 'M3 21v-5h5'],
  download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'],
  user: ['M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2', 'M8 7a4 4 0 1 0 8 0a4 4 0 1 0-8 0'],
  // categories
  utensils: ['M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2', 'M7 2v20', 'M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7'],
  cart: ['M7 21a1 1 0 1 0 2 0a1 1 0 1 0-2 0', 'M18 21a1 1 0 1 0 2 0a1 1 0 1 0-2 0', 'M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12'],
  car: ['M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2', 'M5 17a2 2 0 1 0 4 0a2 2 0 1 0-4 0', 'M9 17h6', 'M15 17a2 2 0 1 0 4 0a2 2 0 1 0-4 0'],
  bag: ['M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z', 'M3 6h18', 'M16 10a4 4 0 0 1-8 0'],
  receipt: ['M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z', 'M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8', 'M12 17.5v-11'],
  clapper: ['M20.2 6L3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3z', 'M6.2 5.3l3.1 3.9', 'M12.4 3.4l3.1 4', 'M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
  sparkles: ['M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0l1.58 6.14a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z', 'M20 3v4', 'M22 5h-4'],
  heart: ['M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7z'],
  pill: ['M10.5 20.5l10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7z', 'M8.5 8.5l7 7'],
  plane: ['M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z'],
  wallet: ['M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1', 'M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4'],
  cap: ['M21.42 10.92a1 1 0 0 0-.02-1.84L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.83l8.57 3.91a2 2 0 0 0 1.66 0z', 'M22 10v6', 'M6 12.5V16a6 3 0 0 0 12 0v-3.5'],
  swap: ['M8 3L4 7l4 4', 'M4 7h16', 'M16 21l4-4-4-4', 'M20 17H4'],
  banknote: ['M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z', 'M10 12a2 2 0 1 0 4 0a2 2 0 1 0-4 0', 'M6 12h.01', 'M18 12h.01'],
  trendUp: ['M22 7l-8.5 8.5-5-5L2 17', 'M16 7h6v6'],
  undo: ['M9 14L4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],
  card: ['M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z', 'M2 10h20'],
  bank: ['M3 22h18', 'M6 18v-7', 'M10 18v-7', 'M14 18v-7', 'M18 18v-7', 'M12 2l8 5H4z'],
  dots: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  help: ['M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0', 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3', 'M12 17h.01'],
  arrowIn: ['M17 7L7 17', 'M17 17H7V7'],
};

export function icon(name, size = 16, strokeWidth = 2) {
  return svg(
    'svg',
    { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': strokeWidth,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' },
    ...ICONS[name].map((d) => svg('path', { d })),
  );
}

export async function api(path, options = {}) {
  const res = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Signed out');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ---------- money ----------

const grouped = (n) => String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** Rp8.420.000 — dot thousands, no decimals. */
export function money(amount, currency = 'IDR') {
  if (currency !== 'IDR') {
    try {
      return new Intl.NumberFormat(locale(), { style: 'currency', currency }).format(amount);
    } catch {
      return `${currency} ${amount}`;
    }
  }
  return `${amount < 0 ? '-' : ''}Rp${grouped(amount)}`;
}

/** -Rp38.000 for spending, +Rp19.200 for money in. */
export const signedMoney = (tx) => `${tx.direction === 'credit' ? '+' : '-'}${money(tx.amount, tx.currency)}`;

export const compactMoney = (n) => new Intl.NumberFormat(locale(), { notation: 'compact', maximumFractionDigits: 1 }).format(n);

/** Reads an amount typed into a field: non-digits are ignored, so "12.000.000" and "Rp12000000" both work. */
export function parseAmount(text) {
  const digits = String(text ?? '').replace(/[^\d]/g, '');
  return digits ? Number(digits) : null;
}

// ---------- dates ('YYYY-MM-DD' strings, counted in UTC so no daylight-saving shifts creep in) ----------

export const DAY_MS = 86_400_000;
export const dateToUtc = (date) => Date.parse(`${date}T00:00:00Z`);
export const addDays = (date, n) => new Date(dateToUtc(date) + n * DAY_MS).toISOString().slice(0, 10);
export const daysBetween = (from, to) => Math.round((dateToUtc(to) - dateToUtc(from)) / DAY_MS) + 1; // inclusive

export function lastDayOfMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

export function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export const todayIn = (timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
export const dayKeyIn = (iso, timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(iso));

const fmtUtc = (date, options) => new Intl.DateTimeFormat(locale(), { ...options, timeZone: 'UTC' }).format(dateToUtc(date));

export const monthLabel = (month) => fmtUtc(`${month}-01`, { month: 'long', year: 'numeric' });
export const monthName = (month) => fmtUtc(`${month}-01`, { month: 'long' });
export const shortMonthLabel = (month) => fmtUtc(`${month}-01`, { month: 'short' });
export const dayLabel = (date, withYear = false) => fmtUtc(date, { day: 'numeric', month: 'short', year: withYear ? 'numeric' : undefined });
export const weekdayDayLabel = (date) => fmtUtc(date, { weekday: 'short', day: 'numeric', month: 'short' });

export const timeIn = (iso, timeZone) =>
  new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(new Date(iso));

export function timeAgo(iso) {
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  if (Math.abs(seconds) < 60) return rtf.format(seconds, 'second');
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
  return rtf.format(Math.round(hours / 24), 'day');
}

export function durationLabel(seconds) {
  const unit = seconds % 3600 === 0 ? 'hour' : seconds % 60 === 0 ? 'minute' : 'second';
  const value = unit === 'hour' ? seconds / 3600 : unit === 'minute' ? seconds / 60 : seconds;
  return new Intl.NumberFormat(locale(), { style: 'unit', unit, unitDisplay: 'long' }).format(value);
}

// ---------- misc ----------

export function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** First letter for a category chip. */
// ---------- tooltip & toast ----------

let tooltipNode;
export function showTooltip(event, title, detail) {
  tooltipNode ??= $('#tooltip');
  tooltipNode.replaceChildren(el('strong', { text: title }), detail ?? '');
  tooltipNode.hidden = false;
  const { width, height } = tooltipNode.getBoundingClientRect();
  let x = event.clientX + 12;
  let y = event.clientY - height - 12;
  if (x + width > window.innerWidth - 8) x = event.clientX - width - 12;
  if (y < 8) y = event.clientY + 16;
  tooltipNode.style.left = `${Math.max(8, x)}px`;
  tooltipNode.style.top = `${y}px`;
}

export function hideTooltip() {
  if (tooltipNode) tooltipNode.hidden = true;
}

let toastTimer;
export function toast(message, isError = false) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.toggle('is-error', isError);
  node.hidden = false;
  node.classList.remove('is-out');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.classList.add('is-out');
    setTimeout(() => (node.hidden = true), 300);
  }, isError ? 6000 : 3200);
}

// ---------- count-up ----------

/**
 * Collects "grow from zero" updates for a freshly rendered page, then plays them together:
 * progress goes 0→1 over 1.6s with an ease-out cubic. Skipped (applied at 1) when motion is reduced,
 * the tab is hidden, or the page is re-rendered after a small change.
 */
export function motion(animate) {
  const updates = [];
  const play = animate && !reducedMotion() && !document.hidden;
  return {
    add(update) {
      updates.push(update);
      update(play ? 0 : 1);
    },
    number(node, value, format) {
      this.add((p) => (node.textContent = format(value * p)));
    },
    count(node, value) {
      this.number(node, value ?? 0, (v) => String(Math.round(v)));
    },
    width(node, pct) {
      this.add((p) => (node.style.width = `${(pct * p).toFixed(2)}%`));
    },
    run() {
      if (!play || updates.length === 0) return;
      const t0 = performance.now();
      const duration = 1600;
      const fallback = setTimeout(() => updates.forEach((u) => u(1)), 2200);
      const step = (now) => {
        const x = Math.min(1, (now - t0) / duration);
        const p = 1 - (1 - x) ** 3;
        for (const u of updates) u(p);
        if (x < 1) requestAnimationFrame(step);
        else clearTimeout(fallback);
      };
      requestAnimationFrame(step);
    },
  };
}

/** Staggered entrance for tiles: each gets a slightly later animation start. */
export function stagger(nodes, startMs = 40, stepMs = 60) {
  nodes.forEach((node, i) => node.style.setProperty('--d', `${startMs + i * stepMs}ms`));
}

export { t };
