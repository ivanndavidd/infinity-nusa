import { findCurrencyAmount, parseAmount } from './amount.js';
import { parseTransactionDate } from './date.js';
import { htmlToLines, normLabel, textToLines } from './text.js';

// Label aliases seen in BCA (myBCA journal, KlikBCA, credit card) notifications, in priority order.
const LABELS = {
  amount: [
    'total payment', 'transfer amount', 'top up amount', 'payment amount', 'transaction amount', 'amount', 'sejumlah',
    'nominal transaksi', 'nominal', 'jumlah transaksi', 'jumlah pembayaran', 'jumlah transfer', 'jumlah',
    'nominal transfer', 'nominal pembayaran', 'total pembayaran', 'total bayar', 'total transaksi', 'nilai transaksi',
    'total amount', 'total', 'bill total', 'total bill',
  ],
  merchant: [
    'payment to', 'merchant atm', 'nama merchant', 'merchant', 'merchant name', 'nama toko', 'pembayaran ke',
    'beneficiary name', 'nama penerima', 'penerima', 'company product name', 'company name', 'nama perusahaan',
    'biller', 'nama biller', 'beneficiary', 'payee', 'kepada', 'tujuan', 'nama tujuan', 'ke', 'to',
  ],
  // Who sent the money, for incoming transfers
  sender: ['nama pengirim', 'pengirim', 'dari', 'from', 'sender', 'sender name', 'remitter', 'nama remitter'],
  description: ['keterangan', 'berita', 'remark', 'remarks', 'description', 'catatan', 'layanan'],
  date: [
    'transaction date', 'tanggal transaksi', 'pada tanggal', 'tanggal & waktu', 'tanggal dan waktu', 'tanggal waktu',
    'waktu transaksi', 'tanggal', 'tgl transaksi', 'tgl', 'date', 'date & time', 'date time',
  ],
  time: ['waktu', 'jam', 'time', 'pukul'],
  status: ['status', 'status transaksi', 'transaction status'],
  type: ['transaction type', 'transfer type', 'jenis transaksi', 'tipe transaksi', 'jenis', 'mutasi'],
};

for (const key of Object.keys(LABELS)) LABELS[key] = LABELS[key].map(normLabel);
// "from"/"to" are too generic to be trusted as a label standing alone on its own line
const KNOWN_LABELS = new Set(Object.values(LABELS).flat().filter((l) => l.length > 4));

const LABEL_VALUE_RE = /^([A-Za-z][A-Za-z0-9 /&().'-]{0,40}?)\s*:\s*(.+)$/;
const LABEL_ONLY_RE = /^[A-Za-z][A-Za-z /&().'.-]{0,40}:?$/;

const NON_TRANSACTION_SUBJECT_RE =
  /promo|penawaran|undian|newsletter|e-?statement|rekening koran|lembar tagihan|billing statement|kode otp|\botp\b|verifikasi|verification|login|perubahan data|password|\bpin\b|aktivasi|activation|survey|survei|undangan|webinar|chat history/i;
const FAILED_RE = /declin|ditolak|gagal|failed|unsuccessful|tidak berhasil|dibatalkan|cancel|pending/i;
const TRANSACTION_SUBJECT_RE =
  /transaksi|transaction|pembayaran|payment|transfer|qris|top ?up|tarik tunai|cardless|bukti|receipt|berhasil|successful|notifikasi|notification|debit|kartu kredit|credit card|pembelian|purchase|deposit/i;
const CREDIT_RE =
  /dana masuk|transfer masuk|uang masuk|incoming|received|diterima|kredit masuk|refund|pengembalian dana|reversal|\bvoid\b|deposit cash|cash deposit|setor tunai/i;
const REFUND_RE = /refund|reversal|\bvoid\b|pengembalian/i;
const FALLBACK_SKIP_RE = /saldo|balance|limit|biaya|fee|minimal|minimum|maks|maximum|cashback|hadiah|diskon|potongan|hingga|up to|mulai|s\.?d\.?/i;
const FOOTER_RE = /halo ?bca|contact|hubungi|telepon|call|1500888/i;
// Paying the credit card / PayLater bill from a bank account: the card purchases are already counted one by one.
const CARD_BILL_RE = /credit card|kartu kredit|paylater/i;

const CHANNELS = [
  ['QRIS', /qris/i],
  ['Credit Card', /kartu kredit|credit card/i],
  ['Debit Card', /kartu debit|debit card|\bedc\b|gerbang pembayaran nasional|\bgpn\b/i],
  ['Cash Deposit', /deposit cash|cash deposit|setor tunai/i],
  ['Cash Withdrawal', /tarik tunai|cardless|cash withdrawal/i],
  ['Top Up', /top ?up|isi saldo|gopay|\bovo\b|shopeepay|linkaja|flazz/i],
  ['Virtual Account', /virtual account|\bva\b/i],
  ['Transfer', /transfer|bi-?fast|\brtol\b|kliring|\brtgs\b|m-?transfer/i],
  ['Payment', /pembayaran|payment|bayar|pembelian|purchase/i],
];

function extractFields(lines) {
  const fields = new Map();
  const add = (label, value) => {
    const key = normLabel(label);
    const clean = value.replace(/^[\s:|]+/, '').trim();
    if (key && clean && clean !== '-' && !fields.has(key)) fields.set(key, clean);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1];

    if (line.includes('|')) {
      const rawCells = line.split('|').map((c) => c.trim());
      const cells = rawCells.filter((c) => c && c !== ':');
      for (let j = 0; j < cells.length; j++) {
        const m = cells[j].match(LABEL_VALUE_RE);
        if (m) add(m[1], m[2]);
        else if (LABEL_ONLY_RE.test(cells[j]) && j + 1 < cells.length) add(cells[j], cells[++j]);
      }
      // A row holding only a label (and no ":" cell, which would mean an empty value): the value is on the next row.
      const emptyValueRow = rawCells.includes(':');
      if (cells.length === 1 && !emptyValueRow && KNOWN_LABELS.has(normLabel(cells[0])) && next !== undefined) {
        add(cells[0], lines[++i]);
      }
      continue;
    }

    // myBCA layout: label, ":" and value each on their own line.
    if (next === ':' && LABEL_ONLY_RE.test(line)) {
      // An empty value: the line after ":" is already the next label.
      if (lines[i + 3] === ':') {
        i += 1;
        continue;
      }
      if (lines[i + 2] !== undefined) add(line, lines[i + 2]);
      i += 2;
      continue;
    }
    // Label on one line, ": value" on the next.
    if (next?.startsWith(':') && next.length > 1 && LABEL_ONLY_RE.test(line)) {
      add(line, next);
      i += 1;
      continue;
    }

    const m = line.match(LABEL_VALUE_RE);
    if (m) add(m[1], m[2]);
    else if (KNOWN_LABELS.has(normLabel(line)) && next !== undefined) add(line, lines[++i]);
  }
  return fields;
}

function getField(fields, aliases) {
  for (const alias of aliases) {
    if (fields.has(alias)) return fields.get(alias);
  }
  // Looser match for labels such as "Nominal Transaksi (Rp)"
  for (const alias of aliases) {
    if (alias.length < 6) continue;
    for (const [key, value] of fields) {
      if (key.startsWith(`${alias} `)) return value;
    }
  }
  return null;
}

function findAmount(fields, subject, lines) {
  for (const alias of LABELS.amount) {
    const value = getField(fields, [alias]);
    const parsed = value && parseAmount(value);
    if (parsed) return { ...parsed, labelled: true };
  }
  for (const line of [subject, ...lines.slice(0, 80)]) {
    if (FALLBACK_SKIP_RE.test(line)) continue;
    const parsed = findCurrencyAmount(line);
    if (parsed) return { ...parsed, labelled: false };
  }
  return null;
}

function findMerchantInSentence(lines) {
  const re = /\b(?:di|at|pada merchant|ke)\s+([A-Z0-9][A-Z0-9 .&'*\-/]{2,60}?)(?=\s+(?:pada|on|tanggal|tgl|sebesar|senilai|dengan)\b|[,.;]|$)/;
  for (const line of lines.slice(0, 40)) {
    if (FOOTER_RE.test(line)) continue;
    const m = line.match(re);
    if (m && /[A-Z]/.test(m[1])) return m[1].trim();
  }
  return null;
}

function cleanText(value, max = 120) {
  if (!value) return null;
  const s = value.replace(/\s*\|\s*/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}

// Drops order/reference codes from card merchant names: "Grab* A-9VQQPCGGXEGNAV" -> "Grab".
function cleanMerchant(value) {
  const text = cleanText(value);
  if (!text) return null;
  const kept = text.split(' ').filter((token) => !(token.length >= 6 && /\d/.test(token) && /[A-Za-z]/.test(token)));
  const result = kept.join(' ').replace(/[\s*#:-]+$/, '').trim();
  return result || text;
}

function detectChannel(typeValue, subject, haystack) {
  if (typeValue && CARD_BILL_RE.test(typeValue)) return 'Card Bill';
  // The transaction type names the channel most reliably, then the subject, then the rest of the email.
  for (const text of [typeValue, subject, haystack]) {
    if (!text) continue;
    for (const [name, re] of CHANNELS) {
      if (re.test(text)) return name;
    }
  }
  return 'Other';
}

function detectDirection(subject, typeValue) {
  if (CREDIT_RE.test(subject) || (typeValue && CREDIT_RE.test(typeValue))) return 'credit';
  if (typeValue && /^(cr|kredit|credit)$/i.test(typeValue.trim())) return 'credit';
  return 'debit';
}

/**
 * Parses a BCA notification email.
 * @param {{subject?: string, text?: string, html?: string, date?: Date}} email
 * @returns {{status: 'parsed', transaction: object} | {status: 'ignored'|'unparsed', note: string}}
 */
export function parseBcaEmail({ subject = '', text = '', html = '', date } = {}) {
  const lines = html ? htmlToLines(html) : textToLines(text);
  const fields = extractFields(lines);

  if (NON_TRANSACTION_SUBJECT_RE.test(subject)) {
    return { status: 'ignored', note: 'Not a transaction email (promo, statement, OTP, chat or account notice)' };
  }
  if (FAILED_RE.test(subject)) {
    return { status: 'ignored', note: 'Declined, failed or pending transaction' };
  }
  const status = getField(fields, LABELS.status);
  if (status && FAILED_RE.test(status)) {
    return { status: 'ignored', note: `Transaction status: ${cleanText(status, 60)}` };
  }

  const amount = findAmount(fields, subject, lines);
  if (!amount) return { status: 'unparsed', note: 'No transaction amount found' };
  if (!amount.labelled && !TRANSACTION_SUBJECT_RE.test(subject)) {
    return { status: 'unparsed', note: 'Amount found but the email does not look like a transaction' };
  }

  const typeValue = cleanText(getField(fields, LABELS.type));
  const direction = detectDirection(subject, typeValue);
  const counterparty =
    direction === 'credit'
      ? getField(fields, LABELS.sender) ?? getField(fields, LABELS.merchant)
      : getField(fields, LABELS.merchant) ?? findMerchantInSentence(lines);
  const merchant = cleanMerchant(counterparty);
  const channelHaystack = [...fields.keys(), ...fields.values(), ...lines.slice(0, 15)].join('\n');
  const channel = detectChannel(typeValue, subject, channelHaystack);
  // Without a merchant (e.g. a Flazz top-up), the transaction type is the most useful description.
  const description = cleanText(getField(fields, LABELS.description), 200) ?? (merchant ? null : typeValue);

  return {
    status: 'parsed',
    transaction: {
      occurredAt: parseTransactionDate(getField(fields, LABELS.date), getField(fields, LABELS.time), date),
      amount: amount.amount,
      currency: amount.currency,
      direction,
      channel,
      merchant,
      description,
      refund: direction === 'credit' && REFUND_RE.test(`${subject} ${typeValue ?? ''}`),
      excludeFromTotals: channel === 'Card Bill',
    },
  };
}
