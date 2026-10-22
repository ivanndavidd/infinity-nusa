const CURRENCY_ALIASES = { rp: 'IDR', 'rp.': 'IDR', idr: 'IDR' };

const AMOUNT_RE =
  /(?:\b(Rp\.?|IDR|USD|SGD|EUR|JPY|MYR|AUD|GBP|CNY|HKD|THB)\s*)?(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/i;

const CURRENCY_AMOUNT_RE =
  /\b(Rp\.?|IDR|USD|SGD|EUR|JPY|MYR|AUD|GBP|CNY|HKD|THB)\s*(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/i;

// Handles both Indonesian ("1.234.567,89") and English ("1,234,567.89") number formats.
export function normalizeNumber(raw) {
  const s = raw.trim();
  const lastSep = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  if (lastSep === -1) return Number(s);

  const sep = s[lastSep];
  const hasBoth = s.includes('.') && s.includes(',');
  const sepCount = s.split(sep).length - 1;
  const digitsAfter = s.length - lastSep - 1;

  let isDecimal;
  if (hasBoth) isDecimal = true;
  else if (sepCount > 1) isDecimal = false;
  else isDecimal = digitsAfter !== 3;

  const intPart = (isDecimal ? s.slice(0, lastSep) : s).replace(/[.,]/g, '');
  const fracPart = isDecimal ? s.slice(lastSep + 1) : '';
  return Number(fracPart ? `${intPart}.${fracPart}` : intPart);
}

function toCurrency(symbol) {
  if (!symbol) return 'IDR';
  return CURRENCY_ALIASES[symbol.toLowerCase()] ?? symbol.toUpperCase();
}

// Parses an amount from a labelled value such as "Rp 50.000,00" or "IDR 1,250,000.00".
export function parseAmount(value) {
  const m = value.match(AMOUNT_RE);
  if (!m) return null;
  const amount = normalizeNumber(m[2]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { amount, currency: toCurrency(m[1]) };
}

// Finds an amount inside free text; requires an explicit currency marker so dates and numbers are not mistaken for money.
export function findCurrencyAmount(text) {
  const m = text.match(CURRENCY_AMOUNT_RE);
  if (!m) return null;
  const amount = normalizeNumber(m[2]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { amount, currency: toCurrency(m[1]) };
}
