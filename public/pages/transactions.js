// Transactions: every transaction in the period, grouped by day, with source filters, search, sort and CSV export.
import { catName, channelName, dayCount, t } from '../i18n.js';
import { dayKeyIn, el, icon, money, motion, signedMoney, stagger, timeIn, weekdayDayLabel, debounce } from '../lib.js';
import { categoryChip, dropdown, emptyNote, outlineButton, pageHead, tile, txTitle } from './ui.js';

const SORT_KEY = 'spending-monitor.sort';
const SORTS = {
  newest: { key: 'date', dir: 'desc', label: 'sortNewest' },
  oldest: { key: 'date', dir: 'asc', label: 'sortOldest' },
  largest: { key: 'amount', dir: 'desc', label: 'sortLargest' },
  smallest: { key: 'amount', dir: 'asc', label: 'sortSmallest' },
};

function loadSort() {
  try {
    const saved = JSON.parse(localStorage.getItem(SORT_KEY));
    const match = Object.entries(SORTS).find(([, s]) => s.key === saved?.key && s.dir === saved?.dir);
    if (match) return match[0];
  } catch {
    // storage unavailable or corrupt: newest first
  }
  return 'newest';
}

function saveSort(name) {
  try {
    const { key, dir } = SORTS[name];
    localStorage.setItem(SORT_KEY, JSON.stringify({ key, dir }));
  } catch {
    // not saved; sorting still works for this visit
  }
}

let sortName = loadSort();

const time = (tx) => Date.parse(tx.occurred_at);

function sortRows(rows) {
  const { key, dir } = SORTS[sortName];
  const sign = dir === 'asc' ? 1 : -1;
  const value = key === 'amount' ? (tx) => tx.amount : time;
  // Ties (same amount) fall back to newest first.
  return [...rows].sort((a, b) => sign * (value(a) - value(b)) || time(b) - time(a));
}

function matches(tx, filter) {
  if (filter.channel && (tx.channel ?? '') !== filter.channel) return false;
  if (filter.category && tx.category !== filter.category) return false;
  const q = filter.q.trim().toLowerCase();
  if (!q) return true;
  const text = [tx.merchant, tx.description, tx.email_subject, tx.category, catName(tx.category), channelName(tx.channel)]
    .filter(Boolean).join(' ').toLowerCase();
  if (text.includes(q)) return true;
  const digits = q.replace(/[^\d]/g, '');
  return digits.length > 0 && digits === q.replace(/[.,\srp]/g, '') && String(Math.round(tx.amount)).includes(digits);
}

function csv(rows, timezone) {
  const cell = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['date', 'time', 'merchant', 'description', 'source', 'category', 'direction', 'amount', 'currency', 'hidden'];
  const lines = rows.map((tx) => [
    dayKeyIn(tx.occurred_at, timezone), timeIn(tx.occurred_at, timezone), tx.merchant, tx.description, tx.channel,
    tx.category, tx.direction, tx.amount, tx.currency, tx.hidden,
  ].map(cell).join(','));
  return `﻿${[head.join(','), ...lines].join('\r\n')}\r\n`;
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function categorySelect(ctx, tx) {
  const list = ctx.state.categories.includes(tx.category) ? ctx.state.categories : [tx.category, ...ctx.state.categories];
  return dropdown({
    options: list.map((c) => ({ value: c, label: catName(c) })),
    value: tx.category,
    label: t('categoryLabel'),
    className: `cat-select${tx.category === 'Uncategorized' && tx.direction === 'debit' ? ' is-unknown' : ''}`,
    onChange: (c) => ctx.setCategory(tx, c),
  });
}

function row(ctx, tx) {
  const { timezone } = ctx.state;
  const hideBtn = el('button', {
    class: 'icon-btn icon-btn-sm',
    type: 'button',
    title: tx.hidden ? t('unhideTitle') : t('hideTitle'),
    'aria-label': tx.hidden ? t('unhide') : t('hide'),
    onclick: () => ctx.updateTransaction(tx.id, { hidden: !tx.hidden }).catch(ctx.showError),
  }, icon(tx.hidden ? 'eye' : 'eyeOff', 15));
  const sub = [timeIn(tx.occurred_at, timezone), tx.merchant && tx.description && tx.description !== tx.merchant ? tx.description : null]
    .filter(Boolean).join(' · ');
  return el(
    'div',
    { class: `tx-row${tx.hidden ? ' is-hidden' : ''}` },
    el('div', { class: 'tx-main' },
      categoryChip(tx),
      el('button', { class: 'tx-text', type: 'button', title: t('openEmail'), onclick: () => ctx.openEmail(tx.email_id) },
        el('span', { class: 'tx-title', text: txTitle(tx) }),
        el('span', { class: 'tx-sub' }, sub, tx.hidden ? el('span', { class: 'hidden-tag', text: t('hiddenTag') }) : null))),
    el('span', { class: 'tx-source muted', text: channelName(tx.channel) }),
    el('span', { class: 'tx-cat' }, categorySelect(ctx, tx)),
    el('span', { class: `tx-amount num${tx.direction === 'credit' ? ' is-positive' : ''}`, text: signedMoney(tx) }),
    el('span', { class: 'tx-act' }, hideBtn),
  );
}

function listBody(ctx, rows) {
  if (rows.length === 0) {
    return [emptyNote(ctx.state.transactions.length ? t('noMatch') : t('noTx'))];
  }
  const sorted = sortRows(rows);
  if (SORTS[sortName].key !== 'date') return sorted.map((tx) => row(ctx, tx));
  const groups = [];
  for (const tx of sorted) {
    const day = dayKeyIn(tx.occurred_at, ctx.state.timezone);
    let g = groups.at(-1);
    if (!g || g.day !== day) groups.push((g = { day, rows: [], spent: 0 }));
    g.rows.push(tx);
    if (tx.direction === 'debit' && !tx.hidden) g.spent += tx.amount;
  }
  return groups.flatMap((g) => [
    el('div', { class: 'day-head' }, el('span', { text: weekdayDayLabel(g.day) }), el('span', { class: 'num', text: g.spent ? money(-g.spent) : '' })),
    ...g.rows.map((tx) => row(ctx, tx)),
  ]);
}

export function render(root, ctx, { animate }) {
  const { state, info } = ctx;
  const filter = state.txFilter;
  const m = motion(animate);

  const list = el('div', { class: 'tx-list' });
  const count = el('span');
  const chipsRow = el('div', { class: 'chips chips-lg' });
  const filterRow = el('div', { class: 'filter-row' });

  const refresh = () => {
    const rows = state.transactions.filter((tx) => matches(tx, filter));
    const filtered = filter.q || filter.channel || filter.category;
    count.textContent = `${filtered ? `${rows.length} / ` : ''}${state.transactions.length} · ${info.label}`;
    list.replaceChildren(...listBody(ctx, rows));

    const channels = [...new Set(state.transactions.map((tx) => tx.channel).filter(Boolean))];
    chipsRow.replaceChildren(
      ...[['', t('allSources')], ...channels.map((c) => [c, channelName(c)])].map(([value, label]) =>
        el('button', {
          class: `chip${filter.channel === value ? ' is-active' : ''}`,
          type: 'button',
          text: label,
          onclick: () => {
            filter.channel = value;
            refresh();
          },
        })),
    );
    filterRow.hidden = !filter.category;
    filterRow.replaceChildren(
      ...(filter.category
        ? [el('button', { class: 'chip is-active chip-x', type: 'button', title: t('clearFilter'), onclick: () => {
            filter.category = '';
            refresh();
          } }, `${t('categoryFilter')}: ${catName(filter.category)}`, icon('x', 13, 2.5))]
        : []),
    );
  };

  const search = el('input', { type: 'search', value: filter.q, placeholder: t('searchPh'), 'aria-label': t('searchPh'), maxlength: 100 });
  search.addEventListener('input', debounce(() => {
    filter.q = search.value;
    refresh();
  }, 150));

  const sortSelect = dropdown({
    options: Object.entries(SORTS).map(([name, s]) => ({ value: name, label: t(s.label) })),
    value: sortName,
    label: t('sortBy'),
    onChange: (name) => {
      sortName = name;
      saveSort(sortName);
      refresh();
    },
  });

  const exportBtn = outlineButton(t('exportCsv'), () => {
    const rows = sortRows(state.transactions.filter((tx) => matches(tx, filter)));
    download(`nusa-transactions-${info.from}_${info.to}.csv`, csv(rows, state.timezone));
  });

  // Stat tiles describe the whole period, whatever the filters.
  const s = state.summary;
  const spent = el('span', { class: 'stat-num' });
  m.number(spent, s.spent, money);
  const txCount = el('span', { class: 'stat-num' });
  m.count(txCount, s.debit_count); // the same spending the average is taken over
  const avg = el('span', { class: 'stat-num' });
  m.number(avg, s.debit_count ? s.spent / s.debit_count : 0, money);
  const uncategorized = el('span', { class: 'stat-num is-pink' });
  m.count(uncategorized, state.review.length);
  // Per day over the days gone so far (all of them for a past period), quiet days included.
  const perDay = info.elapsedDays > 0
    ? el('span', { class: 'stat-sub' },
        el('span', { class: 'strong', text: t('fcPerDay', { amount: money(s.spent / info.elapsedDays) }) }), ' ',
        el('span', { class: 'muted', text: t('avgOverDays', { days: dayCount(info.elapsedDays) }) }))
    : null;
  const stats = [
    tile('t-stat', el('span', { class: 'stat-label', text: t(info.isMonth && info.isCurrent ? 'spentThisMonth' : 'spentInPeriod') }), spent, perDay),
    tile('t-stat', el('span', { class: 'stat-label', text: t('spendingTxs') }), txCount),
    tile('t-stat', el('span', { class: 'stat-label', text: t('avgTx') }), avg),
    el('button', { class: 'tile t-stat is-clickable', type: 'button', onclick: () => {
      filter.category = 'Uncategorized';
      refresh();
    } }, el('span', { class: 'stat-label', text: t('uncategorized') }), uncategorized),
  ];
  const listTile = tile('t-list', filterRow, list);
  stagger([...stats, listTile]);

  root.replaceChildren(
    pageHead(t('navTransactions'), count,
      el('label', { class: 'search-pill' }, icon('search', 15), search),
      sortSelect,
      exportBtn),
    chipsRow,
    el('div', { class: 'stat-grid' }, ...stats),
    listTile,
  );
  refresh();
  m.run();
}
