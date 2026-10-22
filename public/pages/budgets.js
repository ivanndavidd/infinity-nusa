// Budgets: monthly budget, end-of-period projection, and per-category limits.
import { catName, dayCount, t } from '../i18n.js';
import { el, money, motion, stagger } from '../lib.js';
import { budgetState } from './overview.js';
import { categoryIcon, emptyNote, outlineButton, pageHead, pill, tile } from './ui.js';

const GRADIENT = 'linear-gradient(90deg, #ff2e84, #ff9650)';
const DANGER = '#e5533d';
const NEAR = '#ff9650';

function totalTile(ctx, m, b) {
  if (!b.budget) {
    return tile('t-third', el('span', { class: 'stat-label', text: t('budgetTotal') }), el('span', { class: 'figure-lg', text: '—' }),
      el('span', { class: 'muted small', text: t('noBudgetYet') }), outlineButton(t('setBudget'), () => ctx.openBudgetDialog()));
  }
  const fill = el('div', { class: 'bar-fill', style: { background: b.over ? DANGER : GRADIENT } });
  m.width(fill, Math.min(b.pct, 100));
  const pct = el('span');
  m.number(pct, b.pct, (v) => `${Math.round(v)}% ${t('used')}`);
  const figure = el('span', { class: 'figure-lg' });
  m.number(figure, b.budget, money);
  const scaled = ctx.info.budgetScaled;
  return tile('t-third',
    el('span', { class: 'stat-label', text: t(scaled ? 'budgetPeriod' : 'budgetTotal') }),
    figure,
    scaled ? el('span', { class: 'muted small', text: t('perMonth', { amount: money(ctx.state.budgets.total) }) }) : null,
    el('div', { class: 'bar' }, fill),
    el('span', { class: 'muted small' }, pct, ` · ${t(b.over ? 'over' : 'left')} `, el('b', { text: money(Math.abs(b.left)) })));
}

function projectionTile(ctx, m, b) {
  const { info, state } = ctx;
  const projected = info.elapsedDays > 0 ? (state.summary.spent / info.elapsedDays) * info.totalDays : 0;
  const title = info.isPast ? t('projFinal') : info.isMonth ? t('projected') : t('projectedRange');
  const over = b.budget && projected > b.budget;
  const figure = el('span', { class: 'figure-lg' });
  m.number(figure, projected, money);
  return tile('t-third',
    el('span', { class: 'stat-label', text: title }),
    figure,
    b.budget ? pill(t(info.isPast ? (over ? 'endedOver' : 'endedUnder') : over ? 'projOver' : 'projUnder'), over ? 'danger' : 'good') : null,
    el('span', { class: 'muted small push-down', text: t('projSub', { days: dayCount(info.elapsedDays) }) }));
}

function unallocatedTile(ctx, m) {
  const { budgets } = ctx.state;
  const total = ctx.budgetForPeriod(budgets.total);
  const allocated = Object.values(budgets.categories).reduce((a, v) => a + ctx.budgetForPeriod(v), 0);
  const left = total === null ? null : total - allocated;
  const figure = el('span', { class: `figure-lg${left !== null && left < 0 ? ' is-danger' : ''}`, text: '—' });
  if (left !== null) m.number(figure, left, money);
  return tile('t-third',
    el('span', { class: 'stat-label', text: t('unallocated') }),
    figure,
    el('span', { class: `small push-down ${left !== null && left < 0 ? 'is-danger' : 'muted'}`, text: t(left !== null && left < 0 ? 'overAllocated' : 'unallocatedSub') }));
}

function budgetTable(ctx, m) {
  const { state } = ctx;
  const spent = new Map(state.summary.byCategory.map((c) => [c.category, c.total]));
  const names = new Set([...Object.keys(state.budgets.categories), ...spent.keys()]);
  const rows = [...names]
    .filter((c) => !ctx.NON_SPENDING.has(c))
    .map((c) => ({ category: c, monthly: state.budgets.categories[c], budget: ctx.budgetForPeriod(state.budgets.categories[c]), spent: spent.get(c) ?? 0 }))
    .sort((a, b) => (b.budget ? 1 : 0) - (a.budget ? 1 : 0) || b.spent - a.spent);
  if (rows.length === 0) return emptyNote(t('noSpending'));

  const head = el('div', { class: 'budget-row budget-head' },
    el('span', { text: t('colCategory') }), el('span', { class: 'num', text: t('colBudget') }), el('span', { text: t('colSpent') }),
    el('span', { class: 'num', text: t('colLeft') }), el('span', { class: 'num', text: t('colStatus') }));
  return [head, ...rows.map((r) => {
    const pct = r.budget ? (r.spent / r.budget) * 100 : null;
    const over = pct !== null && pct > 100;
    const near = pct !== null && pct > 85 && !over;
    const bar = r.budget ? el('div', { class: 'bar bar-5' }, (() => {
      const fill = el('div', { class: 'bar-fill', style: { background: over ? DANGER : near ? NEAR : '#121418' } });
      m.width(fill, Math.min(pct, 100));
      return fill;
    })()) : null;
    return el('div', { class: 'budget-row' },
      el('span', { class: 'budget-cat' }, categoryIcon(r.category), el('span', { class: 'strong ellipsis', text: catName(r.category) })),
      el('span', { class: 'num muted budget-amount' }, r.budget ? money(r.budget) : '—',
        r.budget && ctx.info.budgetScaled ? el('span', { class: 'per-month', text: t('perMonth', { amount: money(r.monthly) }) }) : null),
      el('span', { class: 'budget-spent' }, el('span', { class: 'num strong', text: money(r.spent) }), bar),
      el('span', { class: `num strong${over ? ' is-danger' : ''}`, text: r.budget ? money(r.budget - r.spent) : '—' }),
      el('span', { class: 'num' }, pill(t(pct === null ? 'stNone' : over ? 'stOver' : near ? 'stNear' : 'stOn'), over ? 'danger' : near ? 'warn' : '')));
  })];
}

export function render(root, ctx, { animate }) {
  const m = motion(animate);
  const b = budgetState(ctx);
  const tiles = [totalTile(ctx, m, b), projectionTile(ctx, m, b), unallocatedTile(ctx, m)];
  const table = tile('t-wide t-table', ...[budgetTable(ctx, m)].flat());
  stagger([...tiles, table]);
  root.replaceChildren(...[
    pageHead(t('navBudgets'), ctx.info.label, outlineButton(t('editBudget'), () => ctx.openBudgetDialog())),
    ctx.info.budgetScaled ? el('p', { class: 'muted small note', text: t('budgetRangeNote') }) : null,
    el('div', { class: 'three-grid' }, ...tiles),
    table,
  ].filter(Boolean));
  m.run();
}
