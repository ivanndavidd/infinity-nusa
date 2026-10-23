// Forecast arithmetic and the checks on the model's answer, with made-up spending.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  baselineForecast, dailyPlan, forecastAccuracy, forecastMessages, monthlyHistory, parseModelJson, recurringPayments, sanitizeForecast,
  topMerchants,
} from '../src/forecast-model.js';

const TODAY = '2026-10-23';
const ROWS = [
  { month: '2026-07', category: 'Food & Drinks', total: 900_000 },
  { month: '2026-08', category: 'Food & Drinks', total: 3_000_000 },
  { month: '2026-08', category: 'Transport', total: 1_000_000 },
  { month: '2026-09', category: 'Food & Drinks', total: 2_000_000 },
  { month: '2026-09', category: 'Transport', total: 1_600_000 },
  { month: '2026-10', category: 'Food & Drinks', total: 1_500_000 },
];

test('monthlyHistory marks the months the data only partly covers', () => {
  const history = monthlyHistory(ROWS, '2026-07-23', TODAY);
  assert.deepEqual(history.map((m) => m.month), ['2026-07', '2026-08', '2026-09', '2026-10']);
  assert.deepEqual(history.map((m) => m.complete), [false, true, true, false]);
  assert.deepEqual(history.map((m) => m.coveredDays), [9, 31, 30, 23]);
  assert.equal(history[1].total, 4_000_000);
  assert.equal(history[3].isCurrent, true);
  assert.deepEqual(monthlyHistory(ROWS, null, TODAY), []);
});

test('baselineForecast weighs the latest complete month most', () => {
  const baseline = baselineForecast(monthlyHistory(ROWS, '2026-07-23', TODAY), '2026-11');
  assert.equal(baseline.method, 'weighted');
  assert.deepEqual(baseline.basedOn, ['2026-08', '2026-09']);
  assert.equal(baseline.days, 30);
  const food = baseline.categories.find((c) => c.category === 'Food & Drinks');
  // (3.0M x 1 + 2.0M x 2) / 3
  assert.equal(food.amount, 2_333_333);
  assert.equal(food.low, 2_000_000);
  assert.equal(food.high, 3_000_000);
  assert.equal(food.average, 2_500_000);
  assert.equal(baseline.total, baseline.categories.reduce((a, c) => a + c.amount, 0));
  assert.ok(baseline.low <= baseline.total && baseline.total <= baseline.high);
});

test('baselineForecast stretches the daily rate before any month is complete', () => {
  const rows = [{ month: '2026-10', category: 'Food & Drinks', total: 1_000_000 }];
  const baseline = baselineForecast(monthlyHistory(rows, '2026-10-14', '2026-10-23'), '2026-11');
  assert.equal(baseline.method, 'runRate');
  assert.equal(baseline.total, 3_000_000); // 1.0M over 10 days, times 30
});

test('recurringPayments finds steady monthly payments and skips everyday spending', () => {
  const rows = [
    { month: '2026-08', merchant: 'NETFLIX', category: 'Entertainment', total: 186_000, count: 1, day: 5 },
    { month: '2026-09', merchant: 'Netflix', category: 'Entertainment', total: 186_000, count: 1, day: 5 },
    { month: '2026-10', merchant: 'NETFLIX', category: 'Entertainment', total: 186_000, count: 1, day: 6 },
    { month: '2026-09', merchant: 'KOPI KENANGAN', category: 'Food & Drinks', total: 400_000, count: 9, day: 14 },
    { month: '2026-10', merchant: 'KOPI KENANGAN', category: 'Food & Drinks', total: 380_000, count: 8, day: 12 },
    { month: '2026-09', merchant: 'PLN', category: 'Bills & Utilities', total: 200_000, count: 1, day: 20 },
    { month: '2026-10', merchant: 'PLN', category: 'Bills & Utilities', total: 900_000, count: 1, day: 20 },
    { month: '2026-07', merchant: 'SPOTIFY', category: 'Entertainment', total: 55_000, count: 1, day: 2 },
    { month: '2026-10', merchant: 'SPOTIFY', category: 'Entertainment', total: 55_000, count: 1, day: 2 },
  ];
  const found = recurringPayments(rows, TODAY);
  assert.deepEqual(found.map((r) => r.merchant), ['NETFLIX']);
  assert.deepEqual(found[0], { merchant: 'NETFLIX', category: 'Entertainment', amount: 186_000, day: 5, months: 3, paidThisMonth: true });
  assert.deepEqual(topMerchants(rows, TODAY)['Food & Drinks'], [{ merchant: 'KOPI KENANGAN', total: 780_000, count: 17 }]);
});

test('sanitizeForecast keeps the model to known categories and believable amounts', () => {
  const history = monthlyHistory(ROWS, '2026-07-23', TODAY);
  const baseline = baselineForecast(history, '2026-11');
  const raw = {
    total: 999,
    total_low: 1,
    total_high: 999_999_999_999,
    categories: [
      { category: 'Food & Drinks', amount: '2.400.000', low: 2_800_000, high: 2_000_000, reason: { en: 'Steady.', id: 'Stabil.' } },
      { category: 'Food & Drinks', amount: 1 },
      { category: 'Crypto', amount: 5_000_000 },
      { category: 'Transport', amount: 1e12 },
    ],
    summary: { en: ' Fine. ', id: 'Oke.' },
    insights: { en: ['a', '', 'b'], id: 'not a list' },
    lifestyle: { en: 'You eat out a lot.', id: 'Kamu sering makan di luar.' },
    advice: [
      { category: 'Food & Drinks', title: { en: 'Cook at home', id: 'Masak di rumah' }, detail: { en: 'Twice a week.', id: 'Dua kali seminggu.' }, monthly_saving: 1e12 },
      { category: 'Nope', title: { en: 'Walk more' }, monthly_saving: -5 },
      { title: {} },
    ],
  };
  const f = sanitizeForecast(raw, { history, baseline });
  assert.deepEqual(f.categories.map((c) => c.category), ['Transport', 'Food & Drinks']);
  const food = f.categories.find((c) => c.category === 'Food & Drinks');
  assert.equal(food.amount, 2_400_000);
  assert.ok(food.low <= food.amount && food.amount <= food.high);
  const transport = f.categories.find((c) => c.category === 'Transport');
  assert.equal(transport.amount, 5 * 1_600_000); // capped at 5x the most it ever cost
  assert.equal(f.total, food.amount + transport.amount);
  assert.equal(f.low, 1);
  assert.ok(f.high >= f.total && f.high < 999_999_999_999);
  assert.deepEqual(f.summary, { en: 'Fine.', id: 'Oke.' });
  assert.deepEqual(f.insights, { en: ['a', 'b'], id: [] });
  assert.equal(f.lifestyle.id, 'Kamu sering makan di luar.');
  assert.equal(f.advice.length, 2);
  assert.equal(f.advice[0].monthlySaving, food.amount);
  assert.deepEqual([f.advice[1].category, f.advice[1].monthlySaving], [null, 0]);
});

test('sanitizeForecast fills in categories the model left out', () => {
  const history = monthlyHistory(ROWS, '2026-07-23', TODAY);
  const baseline = baselineForecast(history, '2026-11');
  const f = sanitizeForecast({ categories: [] }, { history, baseline });
  assert.deepEqual(f.categories.map((c) => [c.category, c.amount, c.fromBaseline]),
    baseline.categories.map((c) => [c.category, c.amount, true]));
  assert.throws(() => sanitizeForecast('nope', { history, baseline }), /did not return a forecast/);
});

test('forecastMessages asks for json and sends only the summarised data', () => {
  const history = monthlyHistory(ROWS, '2026-07-23', TODAY);
  const baseline = baselineForecast(history, '2026-11');
  const [system, user] = forecastMessages({ today: TODAY, history, baseline, recurring: [], merchants: {}, budgets: { total: 5_000_000, categories: {} } });
  assert.match(system.content, /json/);
  const data = JSON.parse(user.content);
  assert.equal(data.target_month, '2026-11');
  assert.equal(data.months.length, 4);
  assert.equal(data.monthly_budget, 5_000_000);
});

test('forecastAccuracy uses the stored forecasts and works out the missing statistical ones', () => {
  const history = monthlyHistory(ROWS, '2026-07-23', TODAY);
  const entries = forecastAccuracy({
    rows: ROWS,
    firstDay: '2026-07-23',
    history,
    baselines: { '2026-09': { total: 3_500_000, low: 3_000_000, high: 4_000_000 } },
    ai: { '2026-09': { total: 3_700_000, low: 3_200_000, high: 4_100_000 }, '2026-10': { total: 1, low: 1, high: 1 } },
  });
  // October is still running, so it isn't judged yet. August is left out: only nine days of July existed before it.
  assert.deepEqual(entries, [
    {
      month: '2026-09',
      actual: 3_600_000,
      stats: { total: 3_500_000, low: 3_000_000, high: 4_000_000, backtest: false },
      ai: { total: 3_700_000, low: 3_200_000, high: 4_100_000 },
    },
  ]);
  // With all of July, both are worked out from it, newest first: August's from July's daily rate (July was still running),
  // September's from July as a complete month (August was still running).
  const fromJuly = forecastAccuracy({ rows: ROWS, firstDay: '2026-07-01', history: monthlyHistory(ROWS, '2026-07-01', TODAY) });
  assert.deepEqual(fromJuly, [
    { month: '2026-09', actual: 3_600_000, stats: { total: 900_000, low: 720_000, high: 1_080_000, backtest: true }, ai: null },
    { month: '2026-08', actual: 4_000_000, stats: { total: 900_000, low: 720_000, high: 1_080_000, backtest: true }, ai: null },
  ]);
});

test('dailyPlan spreads what is left after recurring payments over the days, weekends their own share', () => {
  // Weekends cost twice a weekday over the last 90 days.
  const byDay = Array.from({ length: 90 }, (_, i) => {
    const day = new Date(Date.parse(`${TODAY}T00:00:00Z`) - (i + 1) * 86_400_000).toISOString().slice(0, 10);
    return { day, total: [0, 6].includes(new Date(`${day}T00:00:00Z`).getUTCDay()) ? 200_000 : 100_000 };
  });
  const forecast = {
    total: 6_000_000,
    categories: [
      { category: 'Food & Drinks', amount: 3_000_000 },
      { category: 'Bills & Utilities', amount: 1_000_000 },
      { category: 'Transport', amount: 900_000 },
    ],
  };
  const recurring = [{ amount: 600_000 }];
  const plan = dailyPlan({ month: '2026-11', budget: null, forecast, recurring, byDay, firstDay: '2026-07-23', today: TODAY });
  assert.equal(plan.source, 'forecast');
  assert.equal(plan.fixed, 600_000);
  assert.equal(plan.perDay, 180_000); // (6.0M - 0.6M) / 30
  assert.equal(plan.weekendDays, 9); // November 2026 starts on a Sunday
  assert.equal(plan.weekday, 138_000); // 5.4M / (21 + 9 x 2)
  assert.equal(plan.weekend, 277_000);
  // Bills aren't day-to-day spending.
  assert.deepEqual(plan.categories, [{ category: 'Food & Drinks', perDay: 100_000 }, { category: 'Transport', perDay: 30_000 }]);

  // A budget below the forecast sets the target, and the categories shrink with it.
  const tight = dailyPlan({ month: '2026-11', budget: 3_600_000, forecast, recurring, byDay: [], firstDay: '2026-07-23', today: TODAY });
  assert.equal(tight.source, 'budget');
  assert.equal(tight.perDay, 100_000);
  assert.equal(tight.forecastPerDay, 180_000);
  assert.equal(tight.weekday, tight.weekend); // no spending history: every day the same
  assert.equal(tight.categories[0].perDay, 56_000); // 3.0M x (3.0M / 5.4M) / 30
});

test('parseModelJson reads plain and fenced JSON', () => {
  assert.deepEqual(parseModelJson('{"a":1}'), { a: 1 });
  assert.deepEqual(parseModelJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.throws(() => parseModelJson(''), SyntaxError);
});
