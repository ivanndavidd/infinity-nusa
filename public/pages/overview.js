// Overview: spend vs budget, ring, daily heat grid, categories, review deck, email sync, recent transactions.
import { catName, channelName, dayCount, t } from '../i18n.js';
import {
  addDays, dateToUtc, dayKeyIn, dayLabel, el, icon, money, monthLabel, monthName, motion, shiftMonth,
  shortMonthLabel, signedMoney, stagger, svg, timeAgo, weekdayDayLabel,
} from '../lib.js';
import { categoryChip, categoryColor, dropdown, linkButton, outlineButton, tile, tileHead, txTitle, withTooltip } from './ui.js';

const PINK = '#ff2e84';
const DANGER = '#e5533d';
const GRADIENT = 'linear-gradient(90deg, #ff2e84, #ff9650)';

/** Spend against the (period-scaled) monthly budget. */
export function budgetState(ctx) {
  const { summary, budgets } = ctx.state;
  const budget = ctx.budgetForPeriod(budgets.total);
  const spent = summary.spent;
  if (!budget) return { budget: null, spent };
  const pct = (spent / budget) * 100;
  return { budget, spent, left: budget - spent, pct, over: spent > budget, near: pct > 85 && spent <= budget };
}

function heroMessage(ctx, b) {
  const { info, state } = ctx;
  if (!b.budget) return t('msgNoBudget');
  const name = info.isMonth ? monthName(info.month) : info.label;
  if (info.isFuture) return t('msgFuture', { month: name });
  if (info.isPast) {
    return b.over ? t('msgPastOver', { left: money(-b.left), month: info.isMonth ? monthLabel(info.month) : info.label })
      : t('msgPastUnder', { left: money(b.left), month: info.isMonth ? monthLabel(info.month) : info.label });
  }
  if (!info.isMonth) {
    return info.budgetScaled
      ? t('msgRange', { pct: `${Math.round(b.pct)}%`, days: dayCount(info.totalDays) })
      : t('msgRangeInMonth', { pct: `${Math.round(b.pct)}%`, month: monthName(info.from.slice(0, 7)) });
  }
  if (b.over) {
    const jump = biggestJump(state.summary, state.prevSummary);
    return [t('msgOver', { left: money(-b.left) }), jump ? t('msgOverJump', { category: catName(jump), prev: info.prevLabel }) : '']
      .filter(Boolean).join(' ');
  }
  if (b.near) return t('msgNear', { pct: `${Math.round(b.pct)}%`, days: dayCount(info.daysLeft), left: money(b.left) });
  return t('msgUnder', { left: money(b.left), month: name, perDay: money(b.left / Math.max(1, info.daysLeft)) });
}

/** The category whose spending grew most compared with the previous period. */
export function biggestJump(summary, prev) {
  const before = new Map((prev?.byCategory ?? []).map((c) => [c.category, c.total]));
  let best = null;
  let bestDelta = 0;
  for (const c of summary.byCategory) {
    const delta = c.total - (before.get(c.category) ?? 0);
    if (delta > bestDelta) [best, bestDelta] = [c.category, delta];
  }
  return best;
}

// ---------- tiles ----------

function spentTile(ctx, m, b) {
  const { info } = ctx;
  const figure = el('div', { class: 'hero-figure' });
  m.number(figure, b.spent, money);
  const children = [
    el('div', { class: 'caption-row' }, el('span', { text: t(info.isMonth && info.isCurrent ? 'spentThisMonth' : 'spentInPeriod') }), el('span', { text: info.label })),
    figure,
  ];
  if (b.budget) {
    const fill = el('div', { class: 'bar-fill', style: { background: b.over ? DANGER : GRADIENT } });
    m.width(fill, Math.min(b.pct, 100));
    const pctText = el('span');
    m.number(pctText, b.pct, (v) => `${Math.round(v)}% ${t('ofBudget', { budget: money(b.budget) })}`);
    children.push(
      el('div', { class: 'bar' }, fill),
      el('div', { class: 'caption-row' }, pctText,
        el('span', { class: 'strong', text: `${t(b.over ? 'over' : 'left')} · ${money(Math.abs(b.left))}` })),
    );
  }
  children.push(el('p', { class: 'hero-msg', text: heroMessage(ctx, b) }));
  return tile('t-spent', ...children);
}

function ringTile(ctx, m, b) {
  const ring = el('div', { class: 'ring' });
  const pctText = el('span', { class: 'ring-pct' });
  if (b.budget) {
    const color = b.over ? DANGER : PINK;
    const pct = Math.min(b.pct, 100);
    m.add((p) => (ring.style.background = `conic-gradient(${color} ${(pct * p).toFixed(2)}%, #f1f2f5 0)`));
    m.number(pctText, b.pct, (v) => `${Math.round(v)}%`);
  } else {
    pctText.textContent = '—';
  }
  return tile(
    't-ring',
    el('div', { class: 'ring-wrap' }, ring, el('div', { class: 'ring-hole' }, pctText, el('span', { class: 'ring-sub', text: t('ofBudgetShort') }))),
    b.budget
      ? el('div', { class: 'muted small ring-caption' }, `${t('budgetLine')} `, el('b', { text: money(b.budget) }),
          ctx.info.budgetScaled ? el('span', { class: 'per-month', text: t('perMonth', { amount: money(ctx.state.budgets.total) }) }) : null)
      : outlineButton(t('setBudget'), () => ctx.openBudgetDialog()),
  );
}

/** Calendar of days, Monday first. Darker pink = more spent; outlined = today; dashed = still to come. */
function heatGrid(ctx, m) {
  const { info, state } = ctx;
  const totals = new Map(state.summary.byDay.map((d) => [d.day, d.total]));
  const max = Math.max(0, ...totals.values());
  const lead = (new Date(dateToUtc(info.from)).getUTCDay() + 6) % 7;
  const rows = Math.ceil((lead + info.totalDays) / 7);
  const grid = el('div', { class: `heat${rows > 6 ? ' is-dense' : ''}` });
  for (const letter of t('dayLetters').split(',')) grid.append(el('span', { class: 'heat-day', text: letter }));
  for (let i = 0; i < lead; i++) grid.append(el('span', { class: 'heat-cell is-blank' }));
  for (let i = 0; i < info.totalDays; i++) {
    const date = addDays(info.from, i);
    const v = totals.get(date) ?? 0;
    const future = date > info.today;
    const cell = el('span', { class: `heat-cell${future ? ' is-future' : ''}${date === info.today ? ' is-today' : ''}` });
    if (!future && v > 0) {
      const a = 0.08 + 0.92 * (v / max) ** 0.55;
      m.add((p) => (cell.style.background = `rgba(255, 46, 132, ${(a * p).toFixed(3)})`));
    }
    if (!future) withTooltip(cell, weekdayDayLabel(date), v > 0 ? money(v) : t('noSpendingDay'));
    grid.append(cell);
  }
  return grid;
}

/** For periods longer than ~3 months: one column per month. */
function monthColumns(ctx, m) {
  const { info, state } = ctx;
  const totals = new Map();
  for (const d of state.summary.byDay) totals.set(d.day.slice(0, 7), (totals.get(d.day.slice(0, 7)) ?? 0) + d.total);
  const months = [];
  for (let month = info.from.slice(0, 7); month <= info.to.slice(0, 7); month = shiftMonth(month, 1)) months.push(month);
  const max = Math.max(1, ...totals.values());
  const width = 360;
  const height = 150;
  const slot = width / months.length;
  const colW = Math.min(24, Math.max(2, slot - 4));
  const root = svg('svg', { viewBox: `0 0 ${width} ${height + 18}`, class: 'month-cols', role: 'img' });
  months.forEach((month, i) => {
    const v = totals.get(month) ?? 0;
    const x = i * slot + (slot - colW) / 2;
    const col = svg('rect', { x, y: height, width: colW, height: 0, rx: Math.min(4, colW / 2), class: month === info.today.slice(0, 7) ? 'col is-now' : 'col' });
    m.add((p) => {
      const h = Math.max(v > 0 ? 2 : 0, (v / max) * (height - 8) * p);
      col.setAttribute('y', height - h);
      col.setAttribute('height', h);
    });
    root.append(col);
    if (months.length <= 12 || i % Math.ceil(months.length / 12) === 0) {
      const label = svg('text', { x: i * slot + slot / 2, y: height + 14, 'text-anchor': 'middle', class: 'col-label' });
      label.textContent = shortMonthLabel(month);
      root.append(label);
    }
    const hit = svg('rect', { x: i * slot, y: 0, width: slot, height, class: 'hit' });
    withTooltip(hit, monthLabel(month), money(v));
    root.append(hit);
  });
  return root;
}

function heatTile(ctx, m) {
  const { info, state } = ctx;
  const long = info.totalDays > 92;
  const avg = info.elapsedDays > 0 ? state.summary.spent / info.elapsedDays : 0;
  const title = long ? t('monthlyTitle') : info.isMonth && info.isCurrent ? t('heatTitle') : t('heatTitleRange');
  return tile(
    't-heat',
    tileHead(title, el('span', { class: 'muted small' }, `${t('avgPerDay')} `, el('b', { text: money(avg) }))),
    long ? monthColumns(ctx, m) : heatGrid(ctx, m),
  );
}

/** Top six categories, the rest folded into "Other". */
export function foldedCategories(byCategory, keep = 6) {
  if (byCategory.length <= keep + 1) return byCategory.map((c) => ({ ...c }));
  const head = byCategory.slice(0, keep).map((c) => ({ ...c }));
  const rest = byCategory.slice(keep);
  head.push({ category: null, total: rest.reduce((a, c) => a + c.total, 0), count: rest.reduce((a, c) => a + c.count, 0), folded: rest.length });
  return head;
}

function categoriesTile(ctx, m) {
  const { state, info } = ctx;
  const rows = foldedCategories(state.summary.byCategory);
  const total = state.summary.spent || 1;
  const max = Math.max(0, ...rows.map((c) => c.total));
  const list = rows.length
    ? rows.map((c, i) => {
        const fill = el('div', { class: 'bar-fill', style: { background: categoryColor(i, c.total, max) } });
        m.width(fill, (c.total / total) * 100);
        const name = c.category ? catName(c.category) : `${t('other')} (${c.folded})`;
        return el(
          'button',
          { class: 'cat-row', type: 'button', onclick: () => (c.category ? ctx.navigate('transactions', { category: c.category }) : ctx.navigate('categories')) },
          el('div', { class: 'cat-row-top' }, el('span', { class: 'cat-row-name', text: name }), el('span', { class: 'num muted-2', text: money(c.total) })),
          el('div', { class: 'bar bar-6' }, fill),
        );
      })
    : [el('p', { class: 'empty', text: t('noSpending') })];
  return tile('t-cats', tileHead(t('byCategory'), el('span', { class: 'muted small', text: info.label })), el('div', { class: 'cat-rows' }, ...list));
}

// ---------- review deck ----------

// Cards categorized from the deck for the current period, for the "3/7" progress label.
const handled = new Set();
let handledPeriod = '';

function reviewTile(ctx) {
  const { state, info } = ctx;
  if (handledPeriod !== `${info.from}/${info.to}`) {
    handled.clear();
    handledPeriod = `${info.from}/${info.to}`;
  }
  const queue = state.review.filter((tx) => !state.skipped.has(tx.id) && !handled.has(tx.id));
  const done = handled.size + state.review.filter((tx) => state.skipped.has(tx.id)).length;
  const top = queue[0];

  const deck = el('div', { class: 'deck', tabindex: top ? '0' : null, 'aria-label': t('reviewHint') });
  const finish = (direction, category) => {
    if (!top) return;
    const card = deck.querySelector('.card-top');
    card?.classList.add(direction === 'right' ? 'fly-right' : 'fly-left');
    setTimeout(async () => {
      if (category) {
        handled.add(top.id);
        await ctx.updateTransaction(top.id, { category }).catch((err) => {
          handled.delete(top.id);
          ctx.showError(err);
          ctx.render();
        });
      } else {
        state.skipped.add(top.id);
        ctx.render();
      }
    }, 220);
  };
  const accept = () => top?.suggestion && finish('right', top.suggestion);
  const skip = () => finish('left', null);

  if (top) {
    queue.slice(1, 3).forEach((_, i) => deck.prepend(el('div', { class: `card card-behind behind-${i + 1}` })));
    const acceptBadge = el('span', { class: 'swipe-badge badge-accept', text: t('accept') });
    const skipBadge = el('span', { class: 'swipe-badge badge-skip', text: t('skip') });
    const card = el(
      'div',
      { class: 'card card-top' },
      el('div', { class: 'card-meta' },
        el('span', { text: `${dayLabel(dayKeyIn(top.occurred_at, state.timezone))} · ${channelName(top.channel)}` }),
        top.suggestion ? el('span', { text: `${t('suggested')} · ${top.confidence}%` }) : null),
      el('div', { class: 'card-main' }, el('span', { class: 'card-title', text: txTitle(top) }), el('span', { class: 'card-amount', text: signedMoney({ ...top, direction: 'debit' }) })),
      top.suggestion ? el('span', { class: 'suggest-pill' }, el('span', { class: 'dot-pink' }), catName(top.suggestion)) : null,
      acceptBadge,
      skipBadge,
    );
    // Drag: right accepts the suggestion, left skips, a short drag springs back.
    let startX = null;
    let dx = 0;
    card.addEventListener('pointerdown', (e) => {
      startX = e.clientX;
      dx = 0;
      card.setPointerCapture?.(e.pointerId);
      card.classList.add('is-dragging');
    });
    card.addEventListener('pointermove', (e) => {
      if (startX === null) return;
      dx = e.clientX - startX;
      if (!top.suggestion && dx > 0) dx = Math.min(dx, 40); // nothing to accept
      card.style.transform = `translateX(${dx}px) rotate(${dx / 30}deg)`;
      acceptBadge.style.opacity = String(Math.max(0, Math.min(1, dx / 80)));
      skipBadge.style.opacity = String(Math.max(0, Math.min(1, -dx / 80)));
    });
    const release = () => {
      if (startX === null) return;
      startX = null;
      card.classList.remove('is-dragging');
      if (dx > 80 && top.suggestion) accept();
      else if (dx < -80) skip();
      else {
        card.style.transform = '';
        acceptBadge.style.opacity = '0';
        skipBadge.style.opacity = '0';
      }
    };
    card.addEventListener('pointerup', release);
    card.addEventListener('pointercancel', release);
    deck.append(card);
    deck.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') accept();
      if (e.key === 'ArrowLeft') skip();
    });
  } else {
    deck.append(
      el('div', { class: 'deck-empty' },
        el('span', { class: 'tile-title', text: t('allDone') }),
        el('span', { class: 'muted small', text: t('allDoneSub') }),
        state.skipped.size
          ? outlineButton(t('showSkipped'), () => {
              state.skipped.clear();
              ctx.render();
            }, { class: 'btn btn-sm' })
          : null),
    );
  }

  // Alternatives: the period's biggest spending categories other than the suggestion.
  const alternatives = state.summary.byCategory
    .map((c) => c.category)
    .filter((c) => !ctx.NON_SPENDING.has(c) && c !== top?.suggestion)
    .slice(0, 3);
  const more = dropdown({
    options: state.categories.filter((c) => c !== 'Uncategorized').map((c) => ({ value: c, label: catName(c) })),
    placeholder: t('moreCategories'),
    label: t('moreCategories'),
    disabled: !top,
    onChange: (c) => finish('right', c),
  });

  const actions = el(
    'div',
    { class: 'deck-actions' },
    el('button', { class: 'round-btn', type: 'button', 'aria-label': t('skip'), title: t('skip'), disabled: !top, onclick: skip }, icon('x', 16, 2.5)),
    el('div', { class: 'deck-pills' },
      ...alternatives.map((c) => el('button', { class: 'pill-btn', type: 'button', disabled: !top, text: catName(c), onclick: () => finish('right', c) }))),
    more,
    el('button', { class: 'round-btn round-solid', type: 'button', 'aria-label': t('accept'), title: t('accept'), disabled: !top?.suggestion, onclick: accept }, icon('check', 16, 3)),
  );

  return tile(
    't-review',
    el('div', { class: 'tile-head' },
      el('span', { class: 'tile-title', text: t('toReview') }),
      el('span', { class: 'count-pill', text: String(queue.length) }),
      el('span', { class: 'muted small push', text: `${done}/${done + queue.length}` })),
    deck,
    actions,
  );
}

// ---------- email sync & recent ----------

function syncTile(ctx, m) {
  const { sync, emailCounts } = ctx.state;
  const running = sync?.running;
  const parsed = el('span', { class: 'big-num' });
  m.count(parsed, emailCounts.parsed);
  return tile(
    't-sync',
    el('div', { class: 'tile-title with-dot' }, el('span', { class: `live-dot${sync?.lastError ? ' is-error' : ''}` }), t('navEmail')),
    el('div', { class: 'stat-stack' }, parsed, el('span', { class: 'muted small', text: t('emailsParsed') })),
    el('div', { class: 'kv-list' },
      el('div', { class: 'kv' }, el('span', { text: t('lastSynced') }), el('b', { text: sync?.lastSuccessAt ? timeAgo(sync.lastSuccessAt) : t('never') })),
      el('div', { class: 'kv' }, el('span', { text: t('filterSkipped') }), el('b', { text: String(emailCounts.ignored ?? 0) })),
      el('div', { class: 'kv' }, el('span', { text: t('account') }), el('b', { class: 'ellipsis', text: sync?.account ?? '—' }))),
    outlineButton(running ? t('syncing') : t('syncNow'), () => ctx.syncNow(), { disabled: running || !sync?.enabled }),
  );
}

function recentTile(ctx) {
  const { state } = ctx;
  const rows = state.transactions.slice(0, 5);
  return tile(
    't-recent',
    tileHead(t('recent'), linkButton(t('viewAll'), () => ctx.navigate('transactions', { category: '' }))),
    rows.length
      ? el('div', { class: 'recent-list' }, ...rows.map((tx) => {
          const unknown = tx.direction === 'debit' && tx.category === 'Uncategorized';
          return el(
            'button',
            { class: `recent-row${tx.hidden ? ' is-hidden' : ''}`, type: 'button', title: t('openEmail'), onclick: () => ctx.openEmail(tx.email_id) },
            el('span', { class: 'recent-title' }, categoryChip(tx, 'chip-sm'), el('span', { class: 'ellipsis', text: txTitle(tx) })),
            el('span', { class: 'muted', text: `${dayLabel(dayKeyIn(tx.occurred_at, state.timezone))} · ${channelName(tx.channel)}` }),
            el('span', { class: unknown ? 'cat-unknown' : 'muted', text: catName(tx.category) }),
            el('span', { class: `num strong${tx.direction === 'credit' ? ' is-positive' : ''}`, text: signedMoney(tx) }),
          );
        }))
      : el('p', { class: 'empty', text: t('noTx') }),
  );
}

export function render(root, ctx, { animate }) {
  const m = motion(animate);
  const b = budgetState(ctx);
  const tiles = [spentTile(ctx, m, b), ringTile(ctx, m, b), heatTile(ctx, m), categoriesTile(ctx, m), reviewTile(ctx), syncTile(ctx, m), recentTile(ctx)];
  stagger(tiles);
  root.replaceChildren(el('div', { class: 'bento' }, ...tiles));
  m.run();
}
