// Built-in keyword rules, checked in order. A keyword must start a word ("grab" matches "GRAB*CAR", not "AGRABAH");
// a trailing space means the keyword must also end the word.
const DEFAULT_RULES = [
  ['Food & Drinks', [
    'gofood', 'go food', 'grabfood', 'grab food', 'shopeefood', 'shopee food', 'mcd', 'mcdonald', 'kfc', 'starbucks',
    'sbux', 'kopi', 'coffee', 'cafe', 'resto', 'restaurant', 'rumah makan', 'rm ', 'bakery', 'warung', 'warteg',
    'kantin', 'kedai', 'depot', 'dapur', 'burger', 'pizza', 'sushi', 'ramen', 'steak', 'chatime', 'janji jiwa',
    'fore ', 'tomoro', 'jumpstart', 'solaria', 'hokben', 'bakmi', 'mie ', 'martabak', 'richeese', 'gacoan', 'sate ',
    'bakso', 'bubur', 'ayam', 'bebek', 'nasi', 'soto', 'padang', 'pempek', 'batagor', 'siomay', 'cireng', 'gorengan',
    'rujak', 'pecel', 'gado', 'seblak', 'geprek', 'kebab', 'dimsum', 'roti', 'donut', 'boba', 'es ', 'teh ', 'tea ',
    'juice', 'jus ', 'ismaya', 'food court', 'foodcourt',
  ]],
  ['Groceries', [
    'indomaret', 'alfamart', 'alfamidi', 'superindo', 'hypermart', 'transmart', 'lotte mart', 'lottemart',
    'ranch market', 'farmers market', 'hero ', 'giant ', 'lawson', 'family mart', 'familymart', 'circle k',
    'grand lucky', 'foodhall', 'tip top', 'sayurbox', 'astro', 'segari', 'mart ',
  ]],
  ['Transport', [
    'gojek', 'goride', 'gocar', 'grab', 'bluebird', 'blue bird', 'taxi', 'kai ', 'krl', 'mrt', 'lrt',
    'transjakarta', 'commuter', 'pertamina', 'shell', 'spbu', 'vivo energy', 'parkir', 'parking', 'tol ', 'e-toll',
    'jasa marga', 'whoosh', 'kcic', 'motor', 'bengkel',
  ]],
  ['PayLater & Loans', ['paylater', 'spaylater', 'kredivo', 'akulaku', 'home credit', 'adira', 'finance']],
  ['Shopping', [
    'tokopedia', 'shopee', 'lazada', 'blibli', 'bukalapak', 'tiktok', 'zalora', 'uniqlo', 'h&m', 'ikea',
    'ace hardware', 'azko', 'informa', 'miniso', 'erafone', 'ibox', 'digimap', 'amazon', 'matahari', 'sociolla',
    'vape', 'vapor',
  ]],
  ['Bills & Utilities', [
    'pln', 'listrik', 'telkom', 'mytelkomsel', 'indihome', 'telkomsel', 'xl ', 'axis', 'indosat', 'im3', 'smartfren',
    'pdam', 'bpjs', 'first media', 'biznet', 'myrep', 'pulsa', 'paket data', 'token', 'pajak', 'pbb', 'samsat',
  ]],
  ['Entertainment', [
    'netflix', 'spotify', 'youtube', 'disney', 'vidio', 'cgv', 'xxi', 'cinepolis', 'cinema', 'tix id', 'tix.id',
    'steam', 'playstation', 'nintendo', 'google play', 'apple.com', 'app store', 'itunes', 'loket', 'tiket konser',
  ]],
  ['Personal Care', ['barber', 'salon', 'spa ', 'pangkas', 'potong rambut']],
  ['Donations', ['kitabisa', 'donasi', 'zakat', 'infaq', 'sedekah', 'persembahan', 'gereja', 'church', 'masjid']],
  ['Health', [
    'apotek', 'apotik', 'pharmacy', 'kimia farma', 'guardian', 'watsons', 'century', 'klinik', 'clinic',
    'hospital', 'rumah sakit', 'rs ', 'halodoc', 'alodokter', 'dokter', 'lab ', 'prodia',
  ]],
  ['Travel', [
    'traveloka', 'tiket.com', 'garuda', 'lion air', 'citilink', 'airasia', 'batik air', 'hotel', 'agoda',
    'booking.com', 'airbnb', 'pegipegi', 'airport', 'bandara',
  ]],
  ['E-Wallet Top Up', ['gopay', 'ovo', 'dana ', 'shopeepay', 'linkaja', 'flazz', 'top up', 'topup', 'isi saldo']],
  ['Education', ['sekolah', 'school', 'kursus', 'course', 'udemy', 'coursera', 'universitas', 'university', 'gramedia']],
];

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const COMPILED_DEFAULTS = DEFAULT_RULES.map(([category, keywords]) => ({
  category,
  res: keywords.map((k) => new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(k)}`)),
}));

export const DEFAULT_CATEGORIES = [
  ...DEFAULT_RULES.map(([category]) => category),
  'Transfer',
  'Cash',
  'Income',
  'Refund',
  'Credit Card Bill',
  'Other',
  'Uncategorized',
];

/**
 * @param {{merchant?: string|null, description?: string|null, channel?: string|null, direction: string}} tx
 * @param {{pattern: string, category: string}[]} userRules  merchant substrings saved from the dashboard
 */
export function categorize(tx, userRules = []) {
  const merchant = (tx.merchant ?? '').toLowerCase();
  for (const rule of userRules) {
    if (merchant && merchant.includes(rule.pattern.toLowerCase())) return rule.category;
  }

  if (tx.channel === 'Card Bill') return 'Credit Card Bill';
  if (tx.direction === 'credit') {
    if (tx.refund) return 'Refund';
    return tx.channel === 'Cash Deposit' ? 'Cash' : 'Income';
  }

  const haystack = ` ${merchant} ${(tx.description ?? '').toLowerCase()} `;
  for (const { category, res } of COMPILED_DEFAULTS) {
    if (res.some((re) => re.test(haystack))) return category;
  }

  if (tx.channel === 'Cash Withdrawal') return 'Cash';
  if (tx.channel === 'Top Up') return 'E-Wallet Top Up';
  if (tx.channel === 'Transfer') return 'Transfer';
  return 'Uncategorized';
}
