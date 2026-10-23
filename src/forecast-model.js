// The forecast's arithmetic and the conversation with the language model, kept free of the database and config so
// they can be tested on their own. forecast.js feeds them the data and calls the model.

const DAY_MS = 86_400_000;
const HISTORY_MONTHS = 12;
const BASELINE_MONTHS = 3;

const dateToUtc = (date) => Date.parse(`${date}T00:00:00Z`);
const daysBetween = (from, to) => Math.round((dateToUtc(to) - dateToUtc(from)) / DAY_MS) + 1; // inclusive
const round = (n) => Math.round(n);

export function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function lastDayOfMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Spending month by month up to today, oldest first. A month is complete once it is over and the data covers it from
 * its first day; the first sync only reaches back so far, so the oldest month is usually partial.
 * rows: [{ month: 'YYYY-MM', category, total }]; firstDay: the first day with data; today: 'YYYY-MM-DD'.
 */
export function monthlyHistory(rows, firstDay, today) {
  if (!firstDay) return [];
  const current = today.slice(0, 7);
  const earliest = shiftMonth(current, 1 - HISTORY_MONTHS);
  const start = firstDay.slice(0, 7) > earliest ? firstDay.slice(0, 7) : earliest;
  const byMonth = new Map();
  for (const r of rows) {
    const totals = byMonth.get(r.month) ?? {};
    totals[r.category] = (totals[r.category] ?? 0) + r.total;
    byMonth.set(r.month, totals);
  }
  const months = [];
  for (let month = start; month <= current; month = shiftMonth(month, 1)) {
    const monthStart = `${month}-01`;
    const monthEnd = lastDayOfMonth(month);
    const from = firstDay > monthStart ? firstDay : monthStart;
    const to = today < monthEnd ? today : monthEnd;
    const byCategory = Object.fromEntries(Object.entries(byMonth.get(month) ?? {}).map(([c, v]) => [c, round(v)]));
    months.push({
      month,
      days: Number(monthEnd.slice(8)),
      coveredDays: from > to ? 0 : daysBetween(from, to),
      complete: month < current && from === monthStart,
      isCurrent: month === current,
      total: Object.values(byCategory).reduce((a, v) => a + v, 0),
      byCategory,
    });
  }
  return months;
}

/**
 * The statistical forecast for targetMonth: per category, a weighted average of the last three complete months (the
 * latest counts most: 3, 2, 1), with the lowest and highest of those months as the range. Before any month is
 * complete, the daily rate so far is stretched to the target month's length instead.
 */
export function baselineForecast(history, targetMonth) {
  const days = Number(lastDayOfMonth(targetMonth).slice(8));
  const complete = history.filter((m) => m.complete).slice(-BASELINE_MONTHS);
  const names = [...new Set(history.flatMap((m) => Object.keys(m.byCategory)))];
  let categories;
  let low;
  let high;

  if (complete.length) {
    const weights = complete.map((_, i) => i + 1);
    const weightSum = weights.reduce((a, w) => a + w, 0);
    categories = names.map((category) => {
      const values = complete.map((m) => m.byCategory[category] ?? 0);
      const amount = values.reduce((a, v, i) => a + v * weights[i], 0) / weightSum;
      const spread = complete.length > 1 ? [Math.min(...values), Math.max(...values)] : [amount * 0.8, amount * 1.2];
      return {
        category,
        amount: round(amount),
        low: round(Math.min(spread[0], amount)),
        high: round(Math.max(spread[1], amount)),
        average: round(values.reduce((a, v) => a + v, 0) / values.length),
      };
    });
    const totals = complete.map((m) => m.total);
    [low, high] = complete.length > 1 ? [Math.min(...totals), Math.max(...totals)] : [null, null];
  } else {
    const covered = history.reduce((a, m) => a + m.coveredDays, 0);
    categories = names.map((category) => {
      const spent = history.reduce((a, m) => a + (m.byCategory[category] ?? 0), 0);
      const amount = covered ? (spent / covered) * days : 0;
      return { category, amount: round(amount), low: round(amount * 0.75), high: round(amount * 1.25), average: round(amount) };
    });
    [low, high] = [null, null];
  }

  categories = categories.filter((c) => c.amount > 0).sort((a, b) => b.amount - a.amount);
  const total = categories.reduce((a, c) => a + c.amount, 0);
  return {
    month: targetMonth,
    days,
    method: complete.length ? 'weighted' : 'runRate',
    basedOn: complete.map((m) => m.month),
    total,
    low: round(Math.min(low ?? total * 0.8, total)),
    high: round(Math.max(high ?? total * 1.2, total)),
    categories,
  };
}

/** The last three months, current one included: the window for recurring payments and top merchants. */
const recentMonths = (today) => [shiftMonth(today.slice(0, 7), -2), shiftMonth(today.slice(0, 7), -1), today.slice(0, 7)];

/**
 * Merchants paid in at least two of the last three months, once or twice a month, for about the same amount:
 * subscriptions, bills and instalments. rows: [{ month, merchant, category, total, count, day }], one per merchant
 * and month.
 */
export function recurringPayments(rows, today) {
  const window = new Set(recentMonths(today));
  const byMerchant = new Map();
  for (const r of rows) {
    if (!window.has(r.month) || !r.merchant) continue;
    const key = r.merchant.trim().toLowerCase();
    const entry = byMerchant.get(key) ?? { merchant: r.merchant.trim(), category: r.category, months: [] };
    entry.months.push(r);
    byMerchant.set(key, entry);
  }
  const found = [];
  for (const { merchant, category, months } of byMerchant.values()) {
    if (months.length < 2 || months.some((m) => m.count > 2)) continue;
    const amounts = months.map((m) => m.total);
    if (Math.max(...amounts) > 1.5 * Math.min(...amounts)) continue;
    found.push({
      merchant,
      category,
      amount: round(median(amounts)),
      day: round(median(months.map((m) => m.day))),
      months: months.length,
      paidThisMonth: months.some((m) => m.month === today.slice(0, 7)),
    });
  }
  return found.sort((a, b) => b.amount - a.amount).slice(0, 15);
}

/** The biggest merchants of each category over the last three months. */
export function topMerchants(rows, today, perCategory = 3) {
  const window = new Set(recentMonths(today));
  const sums = new Map();
  for (const r of rows) {
    if (!window.has(r.month) || !r.merchant) continue;
    const key = `${r.category}\u0000${r.merchant.trim().toLowerCase()}`;
    const entry = sums.get(key) ?? { category: r.category, merchant: r.merchant.trim(), total: 0, count: 0 };
    entry.total += r.total;
    entry.count += r.count;
    sums.set(key, entry);
  }
  const byCategory = {};
  for (const e of [...sums.values()].sort((a, b) => b.total - a.total)) {
    const list = (byCategory[e.category] ??= []);
    if (list.length < perCategory) list.push({ merchant: e.merchant, total: round(e.total), count: e.count });
  }
  return byCategory;
}

const SYSTEM_PROMPT = `You are a careful personal-finance analyst. You forecast how much one person in Indonesia will spend in the target month: the debit transactions from their BCA bank notifications, in Indonesian rupiah (IDR). You get their recent history as JSON.

Rules:
- Start from the baseline (a weighted average of recent complete months) and move away from it only for reasons visible in the data: recurring payments, clear trends, one-off spikes that should not repeat, categories that are new or have stopped, and what the target month usually brings in Indonesia (number of days, public holidays, Ramadan and Lebaran, Christmas and New Year, the 11.11 and 12.12 online sales, school terms).
- A month with "complete": false is partial: compare it per day (days_with_data), never as a full month. The current month is still in progress.
- Use only categories that appear in the data, spelled exactly as given, and give every baseline category an amount (0 is allowed).
- Amounts are whole rupiah. For each category low <= amount <= high, and total_low <= total <= total_high.
- Keep each reason under 25 words, concrete and tied to the numbers. Write every text twice: English ("en") and natural Bahasa Indonesia ("id").
- Do not repeat the names of individual people, such as transfer recipients; say "a transfer to a person" instead. Merchant and company names are fine.
- With fewer than 2 complete months of data, say so in the summary and keep the ranges wide.
- Lifestyle advice is about everyday spending habits only (eating out, shopping, transport, subscriptions, transfers and so on). Never recommend investment, insurance, loan, credit or tax products. Be practical and kind, never judgmental.

Reply with json only, in exactly this shape:
{"total": 0, "total_low": 0, "total_high": 0,
 "categories": [{"category": "Food & Drinks", "amount": 0, "low": 0, "high": 0, "reason": {"en": "", "id": ""}}],
 "summary": {"en": "", "id": ""},
 "insights": {"en": [""], "id": [""]},
 "lifestyle": {"en": "", "id": ""},
 "advice": [{"category": "Food & Drinks", "title": {"en": "", "id": ""}, "detail": {"en": "", "id": ""}, "monthly_saving": 0}]}
"summary" is 2-3 sentences on the expected total and its main drivers. "insights" are 2-5 short observations on what drives the change and what to watch.
"lifestyle" is 2-3 sentences describing the lifestyle this spending suggests (for example often eating out, frequent online shopping, ride-hailing to commute) and the direction that would make the money go further.
"advice" is 3-5 concrete habit changes grounded in their own categories and merchants. "title" is under 8 words, "detail" under 40 words and says what to do in practice, "category" is the category it is about (or null), and "monthly_saving" is a realistic estimate in rupiah of what it would save per month (0 when it is not about saving).`;

/** The chat messages asking the model for a forecast. Only monthly totals and merchant names are included. */
export function forecastMessages({ today, history, baseline, recurring, merchants, budgets }) {
  const data = {
    today,
    target_month: baseline.month,
    target_month_days: baseline.days,
    months: history.map((m) => ({
      month: m.month, days_in_month: m.days, days_with_data: m.coveredDays, complete: m.complete, total: m.total, by_category: m.byCategory,
    })),
    baseline: {
      method: baseline.method === 'weighted' ? `weighted average of ${baseline.basedOn.join(', ')} (weights 1..n, latest highest)` : 'daily rate so far x days in target month',
      total: baseline.total,
      by_category: baseline.categories.map(({ category, amount, low, high }) => ({ category, amount, low, high })),
    },
    recurring_payments: recurring.map((r) => ({
      merchant: r.merchant, category: r.category, typical_amount: r.amount, typical_day_of_month: r.day, months_seen_of_last_3: r.months, paid_this_month: r.paidThisMonth,
    })),
    top_merchants_last_3_months: merchants,
    monthly_budget: budgets?.total ?? null,
    category_budgets: budgets?.categories ?? {},
  };
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify(data) },
  ];
}

const cleanText = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const bothLangs = (v, max) => ({ en: cleanText(v?.en, max), id: cleanText(v?.id, max) });
const textList = (v, max, count) => (Array.isArray(v) ? v.map((s) => cleanText(s, max)).filter(Boolean).slice(0, count) : []);

function wholeAmount(v) {
  let n = v;
  if (typeof v === 'string') {
    // "2.400.000" and "2,400,000" are thousands, as an amount in rupiah would be written.
    const s = v.replace(/[^\d.,]/g, '');
    n = /^\d{1,3}([.,]\d{3})+$/.test(s) ? Number(s.replace(/[.,]/g, '')) : Number(s.replace(',', '.'));
  }
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? round(n) : null;
}

/**
 * Checks the model's answer against the data before anything is shown: only known categories, amounts that are
 * numbers within reach of what was ever spent, ranges around them, short plain texts. Baseline categories the model
 * left out keep their baseline amount. The total is always the sum of the categories.
 */
export function sanitizeForecast(raw, { history, baseline }) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.categories)) throw new Error('The model did not return a forecast.');
  const base = new Map(baseline.categories.map((c) => [c.category, c]));
  // The most a category ever cost in a month, partial months counted per day.
  const peak = new Map();
  for (const m of history) {
    for (const [category, total] of Object.entries(m.byCategory)) {
      const perMonth = m.coveredDays ? (total / m.coveredDays) * m.days : total;
      peak.set(category, Math.max(peak.get(category) ?? 0, perMonth));
    }
  }

  const categories = [];
  for (const c of raw.categories) {
    const name = typeof c?.category === 'string' ? c.category.trim() : '';
    if (!peak.has(name) || categories.some((x) => x.category === name)) continue;
    const ref = base.get(name);
    const cap = 5 * Math.max(peak.get(name), ref?.amount ?? 0) || baseline.total;
    const amount = Math.min(wholeAmount(c.amount) ?? ref?.amount ?? 0, cap);
    const low = Math.min(wholeAmount(c.low) ?? ref?.low ?? amount, amount);
    const high = Math.min(Math.max(wholeAmount(c.high) ?? ref?.high ?? amount, amount), Math.max(cap, amount));
    categories.push({ category: name, amount, low, high, reason: bothLangs(c.reason, 300) });
  }
  for (const ref of baseline.categories) {
    if (!categories.some((c) => c.category === ref.category)) {
      categories.push({ category: ref.category, amount: ref.amount, low: ref.low, high: ref.high, reason: { en: '', id: '' }, fromBaseline: true });
    }
  }
  const kept = categories.filter((c) => c.amount > 0 || base.has(c.category)).sort((a, b) => b.amount - a.amount);

  const total = kept.reduce((a, c) => a + c.amount, 0);
  const lowSum = kept.reduce((a, c) => a + c.low, 0);
  const highSum = kept.reduce((a, c) => a + c.high, 0);
  const totalLow = wholeAmount(raw.total_low);
  const totalHigh = wholeAmount(raw.total_high);
  // A habit change can't save more than its category is expected to cost, nor more than everything together.
  const advice = (Array.isArray(raw.advice) ? raw.advice : [])
    .map((a) => {
      const category = typeof a?.category === 'string' && peak.has(a.category.trim()) ? a.category.trim() : null;
      const ceiling = category ? kept.find((c) => c.category === category)?.amount ?? 0 : total;
      return {
        category,
        title: bothLangs(a?.title, 80),
        detail: bothLangs(a?.detail, 320),
        monthlySaving: Math.min(wholeAmount(a?.monthly_saving) ?? 0, ceiling),
      };
    })
    .filter((a) => a.title.en || a.title.id)
    .slice(0, 5);
  return {
    total,
    low: totalLow !== null && totalLow <= total ? totalLow : lowSum,
    high: totalHigh !== null && totalHigh >= total && totalHigh <= highSum * 2 ? totalHigh : highSum,
    categories: kept,
    summary: bothLangs(raw.summary, 600),
    insights: { en: textList(raw.insights?.en, 240, 5), id: textList(raw.insights?.id, 240, 5) },
    lifestyle: bothLangs(raw.lifestyle, 600),
    advice,
  };
}

/** Reads the model's JSON answer, tolerating a ```json fence around it. */
export function parseModelJson(content) {
  const text = String(content ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(text);
}
