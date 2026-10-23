// Next month's spending forecast: the statistical baseline from forecast-model.js, refined and explained by DeepSeek
// (with lifestyle advice) when DEEPSEEK_API_KEY is set. Only monthly totals per category and merchant names are sent,
// never account numbers or email text. The answer is stored per month, so DeepSeek is asked again only on refresh.
import { config } from './config.js';
import * as db from './db.js';
import {
  baselineForecast, dailyPlan, forecastAccuracy, forecastMessages, monthlyHistory, parseModelJson, recurringPayments, sanitizeForecast,
  shiftMonth, topMerchants,
} from './forecast-model.js';

// Thinking mode can take a while; the page polls instead of waiting on one request (Cloudflare cuts those at 100 s).
const REQUEST_TIMEOUT_MS = 360_000;
// max_tokens counts the thinking too, and a run has needed more than 16k, so leave room: only what is used is billed.
const MAX_TOKENS = 32_000;

let running = null; // { month } while DeepSeek is working
let lastError = null; // { month, message, at } from the last failed run

export const aiConfigured = () => Boolean(config.deepseek.apiKey);

const todayIn = (timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());

async function gatherInput() {
  const today = todayIn(config.timezone);
  const target = shiftMonth(today.slice(0, 7), 1);
  const [rows, firstDay, merchantRows, budgets] = await Promise.all([
    db.monthlyCategoryTotals(),
    db.firstDataDay(),
    db.monthlyMerchantTotals(`${shiftMonth(today.slice(0, 7), -2)}-01`),
    db.getBudgets(),
  ]);
  const history = monthlyHistory(rows, firstDay, today);
  return {
    today,
    firstDay,
    rows,
    history,
    baseline: baselineForecast(history, target),
    recurring: recurringPayments(merchantRows, today),
    merchants: topMerchants(merchantRows, today),
    budgets,
  };
}

/**
 * The history, the statistical forecast, recurring payments, the stored AI forecast with its status, how past
 * forecasts did against what was spent, and a daily spending limit for next month.
 */
export async function getForecast() {
  const input = await gatherInput();
  const { today, firstDay, rows, history, baseline, recurring, budgets } = input;
  const month = baseline.month;
  // Kept until the month begins, so it can be checked against what was spent once the month is over.
  await db.saveBaseline(month, baseline);
  const daysBack = new Date(Date.parse(`${today}T00:00:00Z`) - 90 * 86_400_000).toISOString().slice(0, 10);
  const [saved, past, byDay] = await Promise.all([db.getForecast(month), db.pastForecasts(month), db.dailyTotals(daysBack)]);
  const failed = lastError?.month === month && (!saved || lastError.at > saved.created_at) ? lastError : null;
  return {
    today,
    firstDay,
    history,
    baseline,
    recurring,
    accuracy: forecastAccuracy({ rows, firstDay, history, baselines: past.baselines, ai: past.ai }),
    daily: dailyPlan({ month, budget: budgets.total, forecast: saved?.result ?? baseline, recurring, byDay, firstDay, today }),
    ai: {
      configured: aiConfigured(),
      status: running?.month === month ? 'running' : failed ? 'error' : saved ? 'ready' : 'none',
      model: saved?.model ?? config.deepseek.model,
      generatedAt: saved?.created_at ?? null,
      result: saved?.result ?? null,
      error: failed?.message ?? null,
    },
  };
}

/** Starts a DeepSeek run for next month unless one is already going, and returns the forecast with its status. */
export async function startForecast() {
  if (!running) {
    const input = await gatherInput();
    running = { month: input.baseline.month };
    generate(input).finally(() => (running = null));
  }
  return getForecast();
}

async function generate(input) {
  const month = input.baseline.month;
  try {
    if (input.history.length === 0) throw new Error('There is no spending recorded yet.');
    const messages = forecastMessages(input);
    let raw;
    // JSON mode can occasionally come back empty or cut off; one more try usually works.
    for (let attempt = 1; ; attempt++) {
      try {
        raw = parseModelJson(await askDeepSeek(messages));
        break;
      } catch (err) {
        if (attempt >= 2 || !(err.retry || err instanceof SyntaxError)) throw err;
      }
    }
    await db.saveForecast(month, config.deepseek.model, sanitizeForecast(raw, input));
    lastError = null;
  } catch (err) {
    lastError = { month, message: err.message, at: new Date() };
    console.error('[forecast]', err.message);
  }
}

async function askDeepSeek(messages) {
  const { apiKey, baseUrl, model } = config.deepseek;
  let res;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        response_format: { type: 'json_object' },
        thinking: { type: 'enabled' },
        reasoning_effort: 'high',
        max_tokens: MAX_TOKENS,
        stream: false,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(err.name === 'TimeoutError'
      ? `DeepSeek did not answer within ${REQUEST_TIMEOUT_MS / 60_000} minutes.`
      : `Could not reach DeepSeek (${err.cause?.code ?? err.message}).`);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const reason = {
      401: 'the API key was rejected', 402: 'the DeepSeek account has no balance left', 429: 'too many requests, try again in a minute',
    }[res.status] ?? String(body?.error?.message ?? 'the request failed').slice(0, 200);
    throw new Error(`DeepSeek: ${reason} (HTTP ${res.status}).`);
  }
  const choice = body?.choices?.[0];
  if (body?.usage) {
    const cut = choice?.finish_reason === 'length' ? ' (hit max_tokens)' : '';
    console.log(`[forecast] DeepSeek used ${body.usage.prompt_tokens} + ${body.usage.completion_tokens} tokens${cut}`);
  }
  const content = choice?.message?.content;
  if (!content) throw Object.assign(new Error('DeepSeek returned an empty answer.'), { retry: true });
  return content;
}
