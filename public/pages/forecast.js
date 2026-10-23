// Forecast: next month's expected spending, month by month history, a daily spending limit, per-category forecast,
// recurring payments, the AI's analysis and lifestyle advice, and how past forecasts compared with what was spent.
// Shows the statistical forecast until the AI (DeepSeek) has answered.
import { catName, dayCount, getLang, t } from '../i18n.js';
import { api, compactMoney, dayLabel, el, icon, money, monthLabel, motion, shortMonthLabel, stagger, svg, timeAgo } from '../lib.js';
import { categoryIcon, emptyNote, outlineButton, pageHead, pill, tile, tileHead, withTooltip } from './ui.js';

let data = null; // the last GET /api/forecast answer
let loading = null; // the request in flight
let pollTimer = null;
const autoStarted = new Set(); // months whose AI run this visit already started on its own

const onPage = (ctx) => ctx.state.page === 'forecast';
const inLang = (pair) => (pair?.[getLang()] || pair?.en || '');

async function load(ctx) {
  const first = !data;
  loading ??= api('/api/forecast').finally(() => (loading = null));
  data = await loading;
  // The first visit in a month asks the AI on its own; after that it waits for the refresh button.
  if (data.ai.configured && data.ai.status === 'none' && data.history.length && !autoStarted.has(data.baseline.month)) {
    autoStarted.add(data.baseline.month);
    await start(ctx);
  }
  poll(ctx);
  if (onPage(ctx)) ctx.render({ animate: first });
}

async function start(ctx) {
  try {
    data = await api('/api/forecast', { method: 'POST', body: '{}' });
  } catch (err) {
    ctx.showError(err);
  }
  poll(ctx);
  if (onPage(ctx)) ctx.render();
}

/** While the AI works, checks every few seconds and redraws once its status changes. */
function poll(ctx) {
  clearTimeout(pollTimer);
  if (data?.ai.status !== 'running') return;
  pollTimer = setTimeout(async () => {
    const before = data.ai.status;
    try {
      data = await api('/api/forecast');
    } catch {
      // try again on the next tick
    }
    poll(ctx);
    if (onPage(ctx) && data.ai.status !== before) ctx.render();
  }, 3000);
}

// ---------- tiles ----------

/** The numbers on show: the AI's once it has answered, the statistical forecast until then. */
const shown = (d) => d.ai.result ?? d.baseline;

function sourceLine(d) {
  const { ai, baseline } = d;
  if (ai.status === 'running') return el('p', { class: 'fc-source is-running' }, el('span', { class: 'live-dot' }), t('fcAnalysing'));
  const lines = [];
  if (ai.result) lines.push(t('fcByAi', { model: ai.model, ago: timeAgo(ai.generatedAt) }));
  else {
    const method = baseline.method === 'weighted'
      ? t('fcMethodWeighted', { months: baseline.basedOn.map(shortMonthLabel).join(', ') })
      : t('fcMethodRunRate');
    lines.push(t('fcStatOnly', { method }));
  }
  if (ai.status === 'error') lines.push(t(ai.result ? 'fcRefreshFailed' : 'fcAiFailed', { error: ai.error }));
  else if (!ai.configured) lines.push(t('fcAiOff'));
  return el('p', { class: `fc-source${ai.status === 'error' ? ' is-danger' : ''}` }, lines.join(' '));
}

function heroTile(ctx, m, d) {
  const f = shown(d);
  const figure = el('div', { class: 'hero-figure' });
  m.number(figure, f.total, money);
  const complete = d.history.filter((h) => h.complete).slice(-3);
  const average = complete.length ? complete.reduce((a, h) => a + h.total, 0) / complete.length : null;
  const budget = ctx.state.budgets.total;
  const pills = [];
  if (budget) {
    const over = f.total > budget;
    pills.push(pill(t(over ? 'fcOverBudget' : 'fcUnderBudget', { amount: money(Math.abs(f.total - budget)) }), over ? 'danger' : 'good'));
  }
  if (average) {
    const pct = Math.round(((f.total - average) / average) * 100);
    pills.push(pill(t('fcVsAvg', { pct: `${pct > 0 ? '+' : ''}${pct}%`, n: complete.length })));
  }
  return tile('t-fc-hero',
    el('div', { class: 'caption-row' }, el('span', { text: t('fcExpected') }), el('span', { text: monthLabel(d.baseline.month) })),
    figure,
    el('span', { class: 'muted small', text: t('fcRange', { low: money(f.low), high: money(f.high) }) }),
    pills.length ? el('div', { class: 'fc-pills' }, ...pills) : null,
    sourceLine(d));
}

/** Columns: recorded months in ink, months the data only partly covers in grey, the forecast in pink with its range. */
function chartTile(m, d) {
  const f = shown(d);
  const bars = [
    ...d.history.map((h) => ({ label: shortMonthLabel(h.month), value: h.total, kind: h.complete ? 'actual' : 'partial', h })),
    { label: shortMonthLabel(d.baseline.month), value: f.total, kind: 'forecast' },
  ];
  const width = 360;
  const height = 150;
  const slot = width / bars.length;
  const colW = Math.min(28, Math.max(6, slot - 12));
  const max = Math.max(1, f.high, ...bars.map((b) => b.value));
  const y = (v) => height - (v / max) * (height - 10);
  const root = svg('svg', { viewBox: `0 0 ${width} ${height + 18}`, class: 'fc-cols', role: 'img', 'aria-label': t('fcChartTitle') });
  root.append(svg('line', { x1: 0, x2: width, y1: height + 0.5, y2: height + 0.5, class: 'fc-axis' }));
  bars.forEach((b, i) => {
    const x = i * slot + (slot - colW) / 2;
    const col = svg('rect', { x, y: height, width: colW, height: 0, rx: Math.min(4, colW / 2), class: `col is-${b.kind}` });
    m.add((p) => {
      const top = y(b.value * p);
      col.setAttribute('y', top);
      col.setAttribute('height', height - top);
    });
    root.append(col);
    if (b.kind === 'forecast' && f.high > f.low) {
      const cx = x + colW / 2;
      const whisker = svg('path', { d: `M${cx - 5} ${y(f.high)}H${cx + 5}M${cx} ${y(f.high)}V${y(f.low)}M${cx - 5} ${y(f.low)}H${cx + 5}`, class: 'fc-range' });
      root.append(whisker);
    }
    const label = svg('text', { x: i * slot + slot / 2, y: height + 14, 'text-anchor': 'middle', class: `col-label${b.kind === 'forecast' ? ' is-forecast' : ''}` });
    label.textContent = b.label;
    root.append(label);
    const detail = b.kind === 'forecast'
      ? `${money(b.value)} · ${t('fcRangeShort', { low: money(f.low), high: money(f.high) })}`
      : b.h.isCurrent ? `${money(b.value)} · ${t('fcSoFar', { days: dayCount(b.h.coveredDays) })}`
        : b.kind === 'partial' ? `${money(b.value)} · ${t('fcPartialFrom', { date: dayLabel(d.firstDay ?? `${b.h.month}-01`) })}` : money(b.value);
    const hit = svg('rect', { x: i * slot, y: 0, width: slot, height, class: 'hit' });
    withTooltip(hit, b.kind === 'forecast' ? `${t('fcLegendForecast')} · ${monthLabel(d.baseline.month)}` : monthLabel(b.h.month), detail);
    root.append(hit);
  });
  const key = (kind, text) => el('span', { class: 'fc-key' }, el('span', { class: `fc-swatch is-${kind}` }), text);
  return tile('t-fc-chart',
    tileHead(t('fcChartTitle')),
    root,
    el('div', { class: 'fc-legend' }, key('actual', t('fcLegendActual')), key('partial', t('fcLegendPartial')), key('forecast', t('fcLegendForecast'))));
}

function skeleton(lines) {
  return el('div', { class: 'fc-skeleton', 'aria-hidden': 'true' }, ...Array.from({ length: lines }, () => el('span')));
}

function aiTile(d) {
  const r = d.ai.result;
  let body;
  if (r) {
    const insights = r.insights[getLang()]?.length ? r.insights[getLang()] : r.insights.en;
    body = [el('p', { class: 'fc-summary', text: inLang(r.summary) }), insights.length ? el('ul', { class: 'fc-insights' }, ...insights.map((s) => el('li', { text: s }))) : null];
  } else if (d.ai.status === 'running') {
    body = [skeleton(4)];
  } else {
    const note = !d.ai.configured ? t('fcAiOff') : d.ai.status === 'error' ? t('fcAiFailed', { error: d.ai.error }) : t('fcAdviceWaiting');
    body = [el('p', { class: `small ${d.ai.status === 'error' ? 'is-danger' : 'muted'}`, text: note })];
  }
  return tile('t-fc-ai', tileHead(t('fcAiTitle')), ...body);
}

function lifestyleTile(d) {
  const r = d.ai.result;
  let body;
  if (r?.advice?.length || inLang(r?.lifestyle)) {
    body = [
      inLang(r.lifestyle) ? el('p', { class: 'fc-summary', text: inLang(r.lifestyle) }) : null,
      el('div', { class: 'fc-advice' }, ...r.advice.map((a) => el('div', { class: 'fc-tip' },
        categoryIcon(a.category ?? 'Other'),
        el('div', { class: 'fc-tip-body' },
          el('span', { class: 'strong', text: inLang(a.title) }),
          el('span', { class: 'muted small', text: inLang(a.detail) }),
          a.monthlySaving > 0 ? pill(t('fcSaving', { amount: money(a.monthlySaving) }), 'good') : null)))),
      el('p', { class: 'faint small', text: t('fcAdviceNote') }),
    ];
  } else if (d.ai.status === 'running') {
    body = [skeleton(5)];
  } else {
    body = [el('p', { class: 'muted small', text: d.ai.configured ? t('fcAdviceWaiting') : t('fcAiOff') })];
  }
  return tile('t-fc-life', tileHead(t('fcLifestyleTitle')), ...body);
}

/** Next month's daily limit: the target less recurring payments, per day, split into weekdays and weekends. */
function dailyTile(m, d) {
  const p = d.daily;
  const perDay = (amount) => t('fcPerDay', { amount: money(amount) });
  const figure = el('div', { class: 'hero-figure' });
  m.number(figure, p.perDay, money);
  const how = t(p.fixed ? 'fcDailyHow' : 'fcDailyHowNoFixed', {
    source: t(p.source === 'budget' ? 'fcSourceBudget' : 'fcSourceForecast'), target: money(p.target), fixed: money(p.fixed), days: p.days,
  });
  // A budget can ask for less (or allow more) than the forecast says the days usually cost.
  const gap = p.source === 'budget' ? p.forecastPerDay - p.perDay : 0;
  const tip = inLang(d.ai.result?.dailyTip);
  return tile('t-fc-daily',
    el('div', { class: 'caption-row' }, el('span', { text: t('fcDailyTitle') }), el('span', { text: monthLabel(p.month) })),
    el('div', { class: 'fc-daily-figure' }, figure, el('span', { class: 'fc-per', text: t('fcPerDayUnit') })),
    p.perDay <= 0 ? el('p', { class: 'small is-danger', text: t('fcDailyNone') }) : null,
    p.perDay > 0 && p.weekday !== p.weekend
      ? el('div', { class: 'fc-split' },
          el('div', {}, el('span', { class: 'muted small', text: t('fcWeekday') }), el('span', { class: 'strong', text: perDay(p.weekday) })),
          el('div', {}, el('span', { class: 'muted small', text: t('fcWeekend', { n: p.weekendDays }) }), el('span', { class: 'strong', text: perDay(p.weekend) })))
      : null,
    el('p', { class: 'muted small fc-how', text: how }),
    Math.abs(gap) >= 1000 ? el('div', { class: 'fc-pills' }, pill(t(gap > 0 ? 'fcDailyTighter' : 'fcDailyRoomy', { amount: perDay(Math.abs(gap)) }), gap > 0 ? 'warn' : 'good')) : null,
    p.categories.length && p.perDay > 0
      ? el('div', { class: 'fc-daily-cats' }, ...p.categories.map((c) => el('div', { class: 'fc-recur' },
          categoryIcon(c.category),
          el('span', { class: 'strong ellipsis', text: catName(c.category) }),
          el('span', { class: 'num strong', text: perDay(c.perDay) }))))
      : null,
    tip ? el('p', { class: 'fc-daily-tip' }, icon('sparkles', 14, 2), el('span', { text: tip })) : null);
}

/** How far a forecast was from what was spent, as a signed share of the actual amount. */
const missOf = (forecast, actual) => (actual > 0 ? (forecast - actual) / actual : null);
const shortMoney = (n) => `Rp${compactMoney(n)}`;

function missCell(f, actual, closer) {
  if (!f) return el('span', { class: 'num faint', text: '—' });
  const miss = missOf(f.total, actual);
  const pct = Math.round(miss * 100);
  const size = Math.abs(pct);
  const inRange = actual >= f.low && actual <= f.high;
  const cell = el('span', { class: 'num fc-miss' },
    el('span', { class: 'fc-miss-amount' },
      closer ? el('span', { class: 'fc-closer', title: t('fcAccCloser') }, icon('check', 13, 3)) : null,
      el('span', { class: 'strong', text: `${shortMoney(f.total)}${f.backtest ? '*' : ''}` })),
    pill(`${pct > 0 ? '+' : ''}${pct}%`, size <= 10 ? 'good' : size <= 25 ? 'warn' : 'danger'));
  return withTooltip(cell, money(f.total), `${t('fcRangeShort', { low: money(f.low), high: money(f.high) })} · ${t(inRange ? 'fcAccInRange' : 'fcAccOutRange')}`);
}

/** Each month that is over, against the forecasts made before it began: which came closer, statistics or the AI. */
function accuracyTile(d) {
  const entries = d.accuracy;
  const current = d.history.find((h) => h.isCurrent)?.month ?? d.baseline.month;
  const head = el('div', { class: 'fc-acc-row fc-head' },
    el('span', { text: t('fcColMonth') }), el('span', { class: 'num', text: t('fcColActual') }),
    el('span', { class: 'num', text: t('fcColStats') }), el('span', { class: 'num', text: t('fcColAi') }));
  let statsWins = 0;
  let aiWins = 0;
  const statsMiss = [];
  const aiMiss = [];
  const rows = entries.map((e) => {
    const s = e.stats ? Math.abs(missOf(e.stats.total, e.actual)) : null;
    const a = e.ai ? Math.abs(missOf(e.ai.total, e.actual)) : null;
    if (s !== null) statsMiss.push(s);
    if (a !== null) aiMiss.push(a);
    const both = s !== null && a !== null;
    if (both && s < a) statsWins++;
    if (both && a < s) aiWins++;
    return el('div', { class: 'fc-acc-row' },
      el('span', { class: 'strong', text: monthLabel(e.month) }),
      el('span', { class: 'num strong', text: shortMoney(e.actual) }),
      missCell(e.stats, e.actual, both && s < a),
      missCell(e.ai, e.actual, both && a < s));
  });
  const avg = (list) => `${Math.round((list.reduce((x, v) => x + v, 0) / list.length) * 100)}%`;
  const notes = [];
  if (statsWins + aiWins) notes.push(t('fcAccVerdict', { n: statsWins + aiWins, s: statsWins, a: aiWins }));
  if (statsMiss.length && aiMiss.length) notes.push(t('fcAccAvgMiss', { s: avg(statsMiss), a: avg(aiMiss) }));
  else if (statsMiss.length) notes.push(t('fcAccAvgMissStats', { s: avg(statsMiss) }));
  if (!aiMiss.length) notes.push(t('fcAccAiFirst', { month: monthLabel(d.baseline.month) }));
  return tile('t-wide t-table t-fc-acc',
    tileHead(t('fcAccTitle')),
    el('span', { class: 'muted small fc-sub', text: t('fcAccSub') }),
    ...(entries.length
      ? [head, ...rows, el('p', { class: 'fc-acc-note small', text: notes.join(' ') }),
          entries.some((e) => e.stats?.backtest) ? el('p', { class: 'faint small', text: t('fcAccBacktest') }) : null]
      : [el('p', { class: 'muted small fc-acc-note', text: t('fcAccNone', { month: monthLabel(current) }) })]));
}

function categoryTable(d) {
  const f = shown(d);
  const average = new Map(d.baseline.categories.map((c) => [c.category, c.average]));
  const head = el('div', { class: 'fc-row fc-head' },
    el('span', { text: t('colCategory') }), el('span', { class: 'num', text: t('fcColAvg') }),
    el('span', { class: 'num', text: t('fcColForecast') }), el('span', { class: 'num', text: t('fcColChange') }));
  const rows = f.categories.map((c) => {
    const avg = average.get(c.category) ?? 0;
    const pct = avg ? Math.round(((c.amount - avg) / avg) * 100) : null;
    const reason = inLang(c.reason);
    return el('div', { class: 'fc-row' },
      el('span', { class: 'budget-cat' }, categoryIcon(c.category), el('span', { class: 'strong ellipsis', text: catName(c.category) })),
      el('span', { class: 'num muted', text: avg ? money(avg) : '—' }),
      el('span', { class: 'num fc-amount' }, el('span', { class: 'strong', text: money(c.amount) }),
        el('span', { class: 'per-month', text: t('fcRangeShort', { low: money(c.low), high: money(c.high) }) })),
      el('span', { class: `num strong${pct > 10 ? ' is-danger' : pct < -10 ? ' is-positive' : ''}`, text: pct === null ? '—' : `${pct > 0 ? '+' : ''}${pct}%` }),
      reason ? el('span', { class: 'fc-reason muted small', text: reason }) : null);
  });
  return tile('t-wide t-table', tileHead(t('fcTableTitle')), head, ...rows);
}

function recurringTile(d) {
  const list = d.recurring.length
    ? d.recurring.map((r) => el('div', { class: 'fc-recur' },
        categoryIcon(r.category),
        el('span', { class: 'fc-cat-text' }, el('span', { class: 'strong ellipsis', text: r.merchant }), el('span', { class: 'muted small', text: t('fcAroundDay', { day: r.day }) })),
        el('span', { class: 'num strong', text: money(r.amount) })))
    : [el('p', { class: 'muted small', text: t('fcNoRecurring') })];
  return tile('t-fc-recur', tileHead(t('fcRecurringTitle')), el('span', { class: 'muted small fc-sub', text: t('fcRecurringSub') }), ...list);
}

export function render(root, ctx, { animate }) {
  if (animate || !data) load(ctx).catch(ctx.showError);
  const refresh = outlineButton(data?.ai.status === 'running' ? t('fcAnalysingShort') : t('fcRefresh'), () => start(ctx), {
    disabled: !data?.ai.configured || data.ai.status === 'running' || !data.history.length,
  });
  const head = pageHead(t('navForecast'), data ? t('fcMeta', { month: monthLabel(data.baseline.month) }) : null, refresh);
  if (!data) {
    root.replaceChildren(head, el('p', { class: 'empty', text: t('loading') }));
    return;
  }
  if (!data.history.length) {
    root.replaceChildren(head, emptyNote(t('fcNoData')));
    return;
  }
  const m = motion(animate);
  const complete = data.history.filter((h) => h.complete).length;
  const tiles = [
    heroTile(ctx, m, data), chartTile(m, data), dailyTile(m, data), aiTile(data), lifestyleTile(data), recurringTile(data),
    accuracyTile(data), categoryTable(data),
  ];
  stagger(tiles);
  root.replaceChildren(...[
    head,
    complete < 2 ? el('p', { class: 'muted small note', text: t('fcThinData', { n: complete }) }) : null,
    el('div', { class: 'fc-grid' }, ...tiles),
  ].filter(Boolean));
  m.run();
}
