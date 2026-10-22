// Categories: share of spending, one tile per category, and the auto-categorize rules.
import { catName, t } from '../i18n.js';
import { el, icon, money, motion, stagger } from '../lib.js';
import { foldedCategories } from './overview.js';
import { categoryColor, categoryIcon, emptyNote, outlineButton, pageHead, tile, withTooltip } from './ui.js';

const PINK = '#ff2e84';

// The server's built-in categories (src/categorize.js); anything else was made by the user.
const BUILT_IN = new Set([
  'Food & Drinks', 'Groceries', 'Transport', 'PayLater & Loans', 'Shopping', 'Bills & Utilities', 'Entertainment', 'Personal Care',
  'Donations', 'Health', 'Travel', 'E-Wallet Top Up', 'Education', 'Transfer', 'Cash', 'Income', 'Refund', 'Credit Card Bill', 'Other', 'Uncategorized',
]);

function topMerchants(transactions) {
  const byCategory = new Map();
  for (const tx of transactions) {
    if (tx.direction !== 'debit' || tx.hidden || !tx.merchant) continue;
    const merchants = byCategory.get(tx.category) ?? new Map();
    merchants.set(tx.merchant, (merchants.get(tx.merchant) ?? 0) + tx.amount);
    byCategory.set(tx.category, merchants);
  }
  return new Map([...byCategory].map(([c, merchants]) => [c, [...merchants].sort((a, b) => b[1] - a[1])[0][0]]));
}

function deltaLabel(now, before, prevLabel) {
  if (!before) return { text: now ? t('deltaNew', { prev: prevLabel }) : '', tone: '' };
  const pct = Math.round(((now - before) / before) * 100);
  return { text: `${pct > 0 ? '+' : ''}${pct}% ${t('vsPrev', { prev: prevLabel })}`, tone: pct >= 25 ? 'up' : '' };
}

function summaryTile(ctx, m) {
  const { state } = ctx;
  const s = state.summary;
  const parts = foldedCategories(s.byCategory);
  const total = s.spent || 1;
  const figure = el('span', { class: 'figure-md' });
  m.number(figure, s.spent, money);
  const nameOf = (c) => (c.category ? catName(c.category) : `${t('other')} (${c.folded})`);
  const max = Math.max(0, ...parts.map((c) => c.total));
  const bar = el('div', { class: 'stack-bar' }, ...parts.map((c, i) => {
    const seg = el('div', { class: 'stack-seg', style: { background: categoryColor(i, c.total, max) } });
    m.width(seg, (c.total / total) * 100);
    return withTooltip(seg, nameOf(c), `${money(c.total)} · ${Math.round((c.total / total) * 100)}%`);
  }));
  const legend = el('div', { class: 'legend' }, ...parts.map((c, i) =>
    el('span', { class: 'legend-item' },
      el('span', { class: 'legend-dot', style: { background: i === 0 ? PINK : categoryColor(i, c.total, max) } }),
      nameOf(c),
      el('span', { class: 'faint', text: `${Math.round((c.total / total) * 100)}%` }))));
  return tile('t-wide', el('div', { class: 'tile-head' }, el('span', { class: 'tile-title', text: t(ctx.info.isMonth && ctx.info.isCurrent ? 'spentThisMonth' : 'spentInPeriod') }), figure),
    parts.length ? bar : null, parts.length ? legend : emptyNote(t('noSpending')));
}

function categoryTiles(ctx, m) {
  const { state, info } = ctx;
  const s = state.summary;
  const total = s.spent || 1;
  const before = new Map((state.prevSummary?.byCategory ?? []).map((c) => [c.category, c.total]));
  const tops = topMerchants(state.transactions);
  const spending = new Set(s.byCategory.map((c) => c.category));
  // Categories made here that have no spending yet still get a tile, so they can be found.
  const extra = state.categories.filter((c) => !spending.has(c) && !BUILT_IN.has(c));
  const rows = [...s.byCategory, ...extra.map((category) => ({ category, total: 0, count: 0 }))];
  const max = Math.max(0, ...rows.map((c) => c.total));

  return rows.map((c, i) => {
    const share = (c.total / total) * 100;
    const fill = el('div', { class: 'bar-fill', style: { background: categoryColor(i, c.total, max) } });
    m.width(fill, share);
    const delta = deltaLabel(c.total, before.get(c.category), info.prevLabel);
    const figure = el('span', { class: 'figure-sm' });
    m.number(figure, c.total, money);
    return el(
      'button',
      { class: 'tile t-cat is-clickable', type: 'button', onclick: () => ctx.navigate('transactions', { category: c.category }) },
      el('div', { class: 'cat-tile-head' },
        categoryIcon(c.category),
        el('span', { class: 'cat-tile-name', text: catName(c.category) }),
        el('span', { class: 'faint small push', text: `${Math.round(share)}%` })),
      figure,
      el('div', { class: 'bar bar-6' }, fill),
      el('div', { class: 'cat-tile-foot' },
        el('span', { class: 'ellipsis', text: tops.has(c.category) ? `${t('topMerchant')} · ${tops.get(c.category)}` : c.count === 1 ? t('txOne') : t('txCount', { n: c.count }) }),
        el('span', { class: `delta${delta.tone ? ` is-${delta.tone}` : ''}`, text: delta.text })),
    );
  });
}

function rulesTile(ctx) {
  const rules = ctx.state.rules ?? [];
  return tile(
    't-wide t-rules',
    el('div', { class: 'tile-head' },
      el('div', { class: 'stack-2' }, el('span', { class: 'tile-title', text: t('rulesTitle') }), el('span', { class: 'muted small', text: t('rulesSub') })),
      outlineButton(t('addRule'), () => ctx.openRuleDialog())),
    rules.length
      ? el('div', { class: 'rule-list' }, ...rules.map((r) => el(
          'div',
          { class: 'rule-row' },
          el('span', { class: 'mono-chip', text: r.pattern.toUpperCase() }),
          el('span', { class: 'faint' }, icon('arrowRight', 16, 2.2)),
          el('span', { class: 'strong', text: catName(r.category) }),
          el('span', { class: 'faint small', text: `${r.matches} ${t(r.matches === 1 ? 'match' : 'matches')}` }),
          el('button', { class: 'icon-btn icon-btn-sm', type: 'button', title: t('deleteRule'), 'aria-label': t('deleteRule'), onclick: () => ctx.deleteRule(r) }, icon('trash', 15)),
        )))
      : emptyNote(t('noRules')),
  );
}

export function render(root, ctx, { animate }) {
  const m = motion(animate);
  const cats = categoryTiles(ctx, m);
  const newTile = el('button', { class: 'tile-dashed', type: 'button', onclick: () => ctx.openCategoryDialog() },
    el('span', { class: 'plus-circle' }, icon('plus', 16, 2.5)), t('newCatTile'));
  const summary = summaryTile(ctx, m);
  const rules = rulesTile(ctx);
  stagger([summary, ...cats, newTile, rules], 60, 40);
  root.replaceChildren(
    pageHead(t('navCategories'), `${t('categoriesCount', { n: cats.length })} · ${ctx.info.label}`, outlineButton(t('addCategory'), () => ctx.openCategoryDialog())),
    summary,
    el('div', { class: 'cat-grid' }, ...cats, newTile),
    rules,
  );
  m.run();
}
