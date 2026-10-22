// Building blocks shared by the pages: tiles, chips, page headers, transaction text.
import { t } from '../i18n.js';
import { el, icon, showTooltip, hideTooltip } from '../lib.js';

const GRADIENT = 'linear-gradient(90deg, #ff2e84, #ff9650)';

/**
 * Colour for a category's bar: the biggest keeps the gradient, the rest are pink that pales with the amount,
 * on the heat grid's curve. Mixed with white rather than transparent, so it reads the same on the grey track.
 */
export function categoryColor(i, value, max) {
  if (i === 0) return GRADIENT;
  const s = 0.3 + 0.65 * (max > 0 ? Math.min(1, value / max) : 0) ** 0.55;
  return `rgb(255, ${Math.round(255 - 209 * s)}, ${Math.round(255 - 123 * s)})`;
}

/** Places a floating menu under its button, or above it when there is more room there; kept inside the window. */
function placeMenu(menu, button) {
  const r = button.getBoundingClientRect();
  const below = window.innerHeight - r.bottom - 14;
  const above = r.top - 14;
  menu.style.minWidth = `${Math.max(r.width, 150)}px`;
  menu.style.maxHeight = `${Math.min(320, Math.max(below, above))}px`;
  const m = menu.getBoundingClientRect();
  const top = m.height > below && above > below ? r.top - 6 - m.height : r.bottom + 6;
  menu.style.top = `${Math.max(8, top)}px`;
  menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - m.width - 8))}px`;
}

/**
 * Styled stand-in for <select>: a button that opens a floating list. options: [{ value, label }].
 * Picking a different option calls onChange(value) and shows it on the button, unless a fixed `placeholder` is set.
 * With `name`, a hidden input carries the value so it is sent with a form.
 */
export function dropdown({ options, value = '', onChange, label, placeholder, name, className = 'pill-select', disabled = false }) {
  const text = el('span', { class: 'dd-text' });
  const button = el('button', { class: `dd ${className}`, type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-label': label, title: label, disabled },
    text, icon('chevron', 14, 2.5));
  const input = name ? el('input', { type: 'hidden', name, value }) : null;
  const show = () => (text.textContent = placeholder ?? options.find((o) => o.value === value)?.label ?? value);
  show();
  let menu = null;

  const isOpen = () => Boolean(menu?.matches(':popover-open'));
  const close = () => isOpen() && menu.hidePopover();
  const onScroll = (e) => {
    if (!menu?.contains(e.target)) close();
  };
  const pick = (v) => {
    button.focus({ preventScroll: true });
    close();
    if (v === value) return;
    if (!placeholder) value = v;
    if (input) input.value = v;
    show();
    onChange?.(v);
  };
  const open = () => {
    const items = options.map((o) => el('button', {
      class: `dd-item${o.value === value ? ' is-selected' : ''}`, type: 'button', role: 'option', 'aria-selected': String(o.value === value), onclick: () => pick(o.value),
    }, el('span', { class: 'ellipsis', text: o.label }), o.value === value ? icon('check', 14, 3) : null));
    menu = el('div', { class: 'dd-menu', role: 'listbox', 'aria-label': label, popover: 'auto' }, ...items);
    menu.addEventListener('pointermove', (e) => e.target.closest('.dd-item')?.focus({ preventScroll: true }));
    menu.addEventListener('keydown', (e) => {
      const i = items.indexOf(document.activeElement);
      const go = (n) => {
        e.preventDefault();
        items[(n + items.length) % items.length]?.focus();
      };
      if (e.key === 'ArrowDown') go(i + 1);
      else if (e.key === 'ArrowUp') go(i - 1);
      else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(items.length - 1);
      else if (e.key === 'Tab') close();
      else if (e.key === 'Escape') {
        e.preventDefault();
        button.focus({ preventScroll: true });
        close();
      }
    });
    const shown = menu;
    shown.addEventListener('toggle', (e) => {
      if (e.newState !== 'closed') return;
      shown.remove();
      if (menu !== shown) return; // a newer menu is already open
      menu = null;
      button.setAttribute('aria-expanded', 'false');
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    });
    // Inside a modal dialog the menu must live in the dialog, or the dialog makes it unclickable.
    (button.closest('dialog') ?? document.body).append(shown);
    shown.showPopover();
    placeMenu(shown, button);
    button.setAttribute('aria-expanded', 'true');
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    const current = items.find((b) => b.classList.contains('is-selected')) ?? items[0];
    if (current) shown.scrollTop = current.offsetTop - (shown.clientHeight - current.offsetHeight) / 2;
    current?.focus({ preventScroll: true });
  };

  // Pressing the button while the menu is open closes it (as an outside click), so that click must not reopen it.
  let pressedWhileOpen = false;
  button.addEventListener('pointerdown', () => (pressedWhileOpen = isOpen()));
  button.addEventListener('click', () => {
    const wasOpen = pressedWhileOpen || isOpen();
    pressedWhileOpen = false;
    if (wasOpen) close();
    else open();
  });
  button.addEventListener('keydown', (e) => {
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !isOpen()) {
      e.preventDefault();
      open();
    }
  });
  return input ? el('span', { class: 'dd-wrap' }, button, input) : button;
}

/** Frosted glass tile. Extra classes set its grid span. */
export function tile(className, ...children) {
  return el('div', { class: `tile ${className}` }, ...children);
}

export function tileHead(title, aside) {
  return el('div', { class: 'tile-head' }, el('span', { class: 'tile-title', text: title }), aside ?? null);
}

export function pageHead(title, meta, ...actions) {
  return el(
    'div',
    { class: 'page-head' },
    el('h1', { text: title }),
    meta ? el('span', { class: 'page-meta' }, meta) : null,
    actions.length ? el('div', { class: 'page-actions' }, ...actions) : null,
  );
}

export function outlineButton(label, onclick, extra = {}) {
  return el('button', { class: 'btn', type: 'button', text: label, onclick, ...extra });
}

export function solidButton(label, onclick, extra = {}) {
  return el('button', { class: 'btn btn-solid', type: 'button', text: label, onclick, ...extra });
}

/** 32px square with the category's first letter; dashed with a pink "?" when uncategorized, "+" for money in. */
// Built-in categories' icons (lib.js ICONS); categories made by the user get a tag.
const CATEGORY_ICONS = {
  'Food & Drinks': 'utensils', Groceries: 'cart', Transport: 'car', 'PayLater & Loans': 'bank', Shopping: 'bag',
  'Bills & Utilities': 'receipt', Entertainment: 'clapper', 'Personal Care': 'sparkles', Donations: 'heart', Health: 'pill',
  Travel: 'plane', 'E-Wallet Top Up': 'wallet', Education: 'cap', Transfer: 'swap', Cash: 'banknote', Income: 'trendUp',
  Refund: 'undo', 'Credit Card Bill': 'card', Other: 'dots', Uncategorized: 'help',
};

/** A category's icon in a rounded square. */
export function categoryIcon(category, size = '') {
  const unknown = !category || category === 'Uncategorized';
  return el('span', { class: `cat-chip${unknown ? ' is-unknown' : ''}${size ? ` ${size}` : ''}`, 'aria-hidden': 'true' },
    icon(CATEGORY_ICONS[category] ?? 'tag', size ? 14 : 16, category === 'Other' ? 3 : 2));
}

/** A transaction's chip: money in gets a green arrow, an uncategorized debit a dashed question mark. */
export function categoryChip(tx, size = '') {
  if (tx.direction !== 'credit') return categoryIcon(tx.category, size);
  return el('span', { class: `cat-chip is-credit${size ? ` ${size}` : ''}`, 'aria-hidden': 'true' }, icon('arrowIn', size ? 14 : 16, 2.4));
}

export const txTitle = (tx) => tx.merchant || tx.description || tx.email_subject || '—';

export function pill(text, tone = '') {
  return el('span', { class: `status-pill${tone ? ` is-${tone}` : ''}`, text });
}

export function emptyNote(text) {
  return el('p', { class: 'empty', text });
}

/** Hover tooltip on a node. */
export function withTooltip(node, title, detail) {
  node.addEventListener('mousemove', (e) => showTooltip(e, typeof title === 'function' ? title() : title, typeof detail === 'function' ? detail() : detail));
  node.addEventListener('mouseleave', hideTooltip);
  return node;
}

export function linkButton(label, onclick) {
  return el('button', { class: 'link', type: 'button', onclick }, label, icon('arrowRight', 14, 2.2));
}

export { t };
