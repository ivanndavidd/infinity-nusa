// BCA notification times are in WIB (UTC+7).
const WIB_OFFSET_HOURS = 7;

const MONTHS = {
  jan: 1, januari: 1, january: 1,
  feb: 2, februari: 2, february: 2, peb: 2,
  mar: 3, maret: 3, march: 3,
  apr: 4, april: 4,
  mei: 5, may: 5,
  jun: 6, juni: 6, june: 6,
  jul: 7, juli: 7, july: 7,
  agu: 8, agt: 8, ags: 8, agus: 8, agustus: 8, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oct: 10, oktober: 10, october: 10,
  nov: 11, nop: 11, november: 11, nopember: 11,
  des: 12, dec: 12, desember: 12, december: 12,
};

const DMY_RE = /\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/;
const YMD_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/;
const D_MON_Y_RE = /\b(\d{1,2})[\s-]+([A-Za-z]{3,9})\.?[\s-]+(\d{4})\b/;
const TIME_RE = /\b(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\b/;

function findDate(text) {
  let m = text.match(YMD_RE);
  if (m) return { y: +m[1], mo: +m[2], d: +m[3], end: m.index + m[0].length };
  m = text.match(DMY_RE);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return { y, mo: +m[2], d: +m[1], end: m.index + m[0].length };
  }
  m = text.match(D_MON_Y_RE);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()];
    if (mo) return { y: +m[3], mo, d: +m[1], end: m.index + m[0].length };
  }
  return null;
}

function valid({ y, mo, d }) {
  return y >= 2000 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31;
}

// Builds a timestamp from a BCA date (and optional separate time) string. Falls back to the email's own date.
export function parseTransactionDate(dateText, timeText, emailDate) {
  const fallback = emailDate instanceof Date && !Number.isNaN(emailDate.getTime()) ? emailDate : new Date();
  if (!dateText) return fallback;

  const date = findDate(dateText);
  if (!date || !valid(date)) return fallback;

  const time = (timeText && timeText.match(TIME_RE)) || dateText.slice(date.end).match(TIME_RE);
  let result;
  if (time) {
    const [hh, mm, ss] = [+time[1], +time[2], +(time[3] ?? 0)];
    if (hh > 23 || mm > 59 || ss > 59) return fallback;
    result = new Date(Date.UTC(date.y, date.mo - 1, date.d, hh - WIB_OFFSET_HOURS, mm, ss));
  } else {
    // No time in the email body: keep the email's own time if it falls on the same WIB day.
    const wib = new Date(fallback.getTime() + WIB_OFFSET_HOURS * 3600_000);
    const sameDay = wib.getUTCFullYear() === date.y && wib.getUTCMonth() + 1 === date.mo && wib.getUTCDate() === date.d;
    result = sameDay ? fallback : new Date(Date.UTC(date.y, date.mo - 1, date.d, -WIB_OFFSET_HOURS));
  }

  // Reject dates that are clearly wrong (e.g. a card expiry date picked up by mistake).
  const dayMs = 86_400_000;
  if (result.getTime() > fallback.getTime() + dayMs || result.getTime() < fallback.getTime() - 60 * dayMs) return fallback;
  return result;
}
