// UI copy in English and Bahasa Indonesia. Keys follow the nusa. design handoff where it has them.

const STORAGE_KEY = 'spending-monitor.lang';

const T = {
  en: {
    navOverview: 'Overview', navTransactions: 'Transactions', navCategories: 'Categories', navBudgets: 'Budgets', navEmail: 'Email sync',
    signOut: 'Sign out', signedInAs: 'Signed in as', language: 'Language',
    periodMonth: 'Month', periodRange: 'Date range', from: 'From', to: 'To', prevMonth: 'Previous month', nextMonth: 'Next month',
    last7: 'Last 7 days', last30: 'Last 30 days', last90: 'Last 90 days', thisYear: 'This year',
    p7: '7 days', p30: '30 days', p90: '90 days', pYtd: 'This year',

    spentThisMonth: 'Spent this month', spentInPeriod: 'Spent in this period', ofBudget: 'of {budget} budget', ofBudgetShort: 'of budget',
    left: 'Left to spend', over: 'Over budget', budgetLine: 'Budget', noBudget: 'No budget set', setBudget: 'Set a budget',
    heatTitle: 'Every day this month', heatTitleRange: 'Every day in this period', monthlyTitle: 'Month by month', avgPerDay: 'Avg / day',
    byCategory: 'By category', other: 'Other', noSpending: 'No spending in this period.',
    toReview: 'To review', suggested: 'Suggested', accept: 'Accept', skip: 'Skip', moreCategories: 'More…',
    allDone: 'All caught up', allDoneSub: 'Every transaction in this period has a category.', showSkipped: 'Show skipped again',
    reviewHint: 'Drag right to accept, left to skip, or tap a category.',
    emailsParsed: 'BCA emails recorded', lastSynced: 'Last synced', never: 'Not yet', filterSkipped: 'Skipped', account: 'Gmail',
    syncNow: 'Sync now', syncing: 'Syncing…', recent: 'Recent transactions', viewAll: 'View all',
    msgUnder: "You're on track. {left} left for the rest of {month}, about {perDay} a day.",
    msgNear: 'Heads up: {pct} of your budget is used with {days} to go. {left} left.',
    msgOver: "You're {left} over budget this month.", msgOverJump: '{category} is the biggest jump vs {prev}.',
    msgPastUnder: 'You stayed within budget in {month}, with {left} to spare.', msgPastOver: 'You went {left} over budget in {month}.',
    msgRange: '{pct} of the budget for these {days} is used.', msgNoBudget: 'Set a monthly budget to see how much is left to spend.',
    msgFuture: 'Nothing spent yet in {month}.',

    transactions: 'Transactions', searchPh: 'Search merchant or amount', exportCsv: 'Export CSV', allSources: 'All sources',
    avgTx: 'Avg per transaction', uncategorized: 'Uncategorized', sortNewest: 'Newest first', sortOldest: 'Oldest first',
    sortLargest: 'Largest first', sortSmallest: 'Smallest first', sortBy: 'Sort',
    hide: 'Hide', unhide: 'Unhide', hideTitle: 'Leave this out of the totals', unhideTitle: 'Count this transaction again',
    hiddenTag: 'hidden', categoryFilter: 'Category', clearFilter: 'Clear filter', noTx: 'No transactions in this period.',
    noMatch: 'No transactions match.', openEmail: 'Show the email', categoryLabel: 'Category',
    applyToMerchant: 'Also file every transaction from "{merchant}" under "{category}" (past and future)?',

    addCategory: 'New category', topMerchant: 'Top merchant', vsPrev: 'vs {prev}', deltaNew: 'new vs {prev}', newCatTile: 'New category',
    rulesTitle: 'Auto-categorize rules', rulesSub: "When a BCA transaction's merchant contains a pattern, the category is applied automatically.",
    addRule: 'Add rule', matches: 'matches', match: 'match', txCount: '{n} transactions', txOne: '1 transaction', noRules: 'No rules yet. Add one here, or re-file a merchant on the Transactions page.',
    deleteRule: 'Delete rule', categoryName: 'Category name', create: 'Create', cancel: 'Cancel', save: 'Save', saving: 'Saving…',
    patternLabel: 'Merchant contains', patternHint: 'Not case-sensitive, e.g. KOPI KENANGAN', ruleSaved: 'Rule saved · {n} transactions re-filed',
    categoryCreated: 'Category "{name}" created', deleteRuleConfirm: 'Delete the rule "{pattern}"? Transactions it already filed keep their category.',
    categoriesCount: '{n} categories',

    budgetTotal: 'Monthly budget', editBudget: 'Edit budget', projected: 'Projected end of month', projectedRange: 'Projected for this period',
    projSub: 'Based on {days} of spending', projFinal: 'Final total for this period', projOver: 'Will exceed budget', projUnder: 'Within budget',
    endedOver: 'Over budget', endedUnder: 'Within budget',
    unallocated: 'Unallocated', unallocatedSub: 'Budget not assigned to any category', overAllocated: 'Category budgets exceed the monthly budget',
    colCategory: 'Category', colBudget: 'Budget', colSpent: 'Spent', colLeft: 'Left', colStatus: 'Status',
    stOn: 'On track', stNear: 'Near limit', stOver: 'Over', stNone: 'No limit', used: 'used',
    budgetHint: 'Amounts are per month. Leave a field empty for no limit.', budgetRangeNote: 'This period spans more than one month, so each monthly budget is scaled to the days it covers.',
    budgetSaved: 'Budget saved', noBudgetYet: 'No monthly budget yet.', perCategory: 'Per category',
    budgetAutoNote: 'Adds up the category budgets. Type an amount to set your own.', budgetManualNote: 'Set by you.', useSum: 'Use the category total',
    accountMenu: 'Account', perMonth: '{amount}/mo', budgetPeriod: 'Budget for this period', msgRangeInMonth: '{pct} of the {month} budget is used.',

    navForecast: 'Forecast', fcMeta: 'Next month · {month}', fcExpected: 'Expected spending', fcRange: 'Likely between {low} and {high}',
    fcOverBudget: '{amount} over budget', fcUnderBudget: '{amount} under budget', fcVsAvg: '{pct} vs {n}-month average',
    fcByAi: 'Analysed by {model} · {ago}.',fcAnalysing: 'AI is analysing your spending. This can take a minute.', fcAnalysingShort: 'Analysing…',
    fcRefresh: 'Refresh forecast', fcStatOnly: 'Statistical forecast: {method}.', fcMethodWeighted: 'weighted average of {months}',
    fcMethodRunRate: 'daily spending so far, stretched to a full month',
    fcAiOff: "Add DEEPSEEK_API_KEY to the server's .env for the AI analysis and lifestyle advice.", fcAiFailed: 'AI analysis failed: {error}',
    fcRefreshFailed: 'Refresh failed: {error}', fcAiTitle: 'AI analysis', fcChartTitle: 'Month by month',
    fcLegendActual: 'Recorded', fcLegendPartial: 'Part of a month', fcLegendForecast: 'Forecast', fcPartialFrom: 'Data from {date}', fcSoFar: 'So far · {days}',
    fcTableTitle: 'Per category', fcColAvg: 'Average', fcColForecast: 'Forecast', fcColChange: 'Change', fcRangeShort: '{low} – {high}',
    fcRecurringTitle: 'Recurring payments', fcRecurringSub: 'Paid in at least 2 of the last 3 months', fcAroundDay: 'around day {day}',
    fcNoRecurring: 'None yet. A merchant shows up here once it is paid in 2 of the last 3 months.',
    fcNoData: 'No spending recorded yet, so there is nothing to forecast.', fcThinData: 'Only {n} complete month of data so far, so treat this as a rough guide. It gets better every month.',
    fcLifestyleTitle: 'Lifestyle advice', fcSaving: 'Save ~{amount}/mo', fcAdviceNote: 'General suggestions from your spending data, not professional financial advice.',
    fcAdviceWaiting: 'This appears once the AI analysis is done.',

    connected: 'Connected', syncFailed: 'Sync failed', syncOff: 'Sync off', permission: 'Access', imapReadOnly: 'IMAP · read-only',
    nextSync: 'Next sync', inTime: '{time}', syncEvery: 'Checks every {n}', readOnlyGmail: 'read-only',
    statParsed: 'recorded', statSkipped: 'skipped (not a transaction)', statReview: 'need a category', statUnread: "couldn't be read",
    typesTitle: 'Transaction types found', recentEmails: 'Recent emails', showMore: 'Show more',
    reread: 'Re-read all emails', rereadSub: 'Runs the parser again over every stored email, for example after it learned a new BCA format.',
    rereadDone: 'Done: {parsed} recorded, {ignored} skipped, {unparsed} couldn\'t be read',
    filterAll: 'All', filterParsed: 'Recorded', filterIgnored: 'Skipped', filterUnparsed: "Couldn't read", emailEmpty: 'Nothing here.',
    statusParsed: 'Parsed', statusSkipped: 'Skipped · not a transaction', statusReview: 'Needs category', statusUnparsed: "Couldn't read",
    dkimOk: 'DKIM verified', dkimNo: 'DKIM not verified', close: 'Close', syncOffHelp: 'Email sync is off. Set IMAP_USER and IMAP_PASSWORD in .env, then restart.',

    today: 'Today', yesterday: 'Yesterday', days: '{n} days', day: '1 day', noSpendingDay: 'No spending', loading: 'Loading…',
    dayLetters: 'M,T,W,T,F,S,S', prevPeriod: 'previous {days}',
  },
  id: {
    navOverview: 'Ringkasan', navTransactions: 'Transaksi', navCategories: 'Kategori', navBudgets: 'Anggaran', navEmail: 'Sinkron email',
    signOut: 'Keluar', signedInAs: 'Masuk sebagai', language: 'Bahasa',
    periodMonth: 'Bulan', periodRange: 'Rentang tanggal', from: 'Dari', to: 'Sampai', prevMonth: 'Bulan sebelumnya', nextMonth: 'Bulan berikutnya',
    last7: '7 hari terakhir', last30: '30 hari terakhir', last90: '90 hari terakhir', thisYear: 'Tahun ini',
    p7: '7 hari', p30: '30 hari', p90: '90 hari', pYtd: 'Tahun ini',

    spentThisMonth: 'Pengeluaran bulan ini', spentInPeriod: 'Pengeluaran periode ini', ofBudget: 'dari anggaran {budget}', ofBudgetShort: 'dari anggaran',
    left: 'Sisa anggaran', over: 'Melebihi anggaran', budgetLine: 'Anggaran', noBudget: 'Belum ada anggaran', setBudget: 'Atur anggaran',
    heatTitle: 'Setiap hari bulan ini', heatTitleRange: 'Setiap hari periode ini', monthlyTitle: 'Per bulan', avgPerDay: 'Rata-rata / hari',
    byCategory: 'Per kategori', other: 'Lainnya', noSpending: 'Belum ada pengeluaran di periode ini.',
    toReview: 'Perlu ditinjau', suggested: 'Saran', accept: 'Terima', skip: 'Lewati', moreCategories: 'Lainnya…',
    allDone: 'Semua beres', allDoneSub: 'Semua transaksi periode ini sudah punya kategori.', showSkipped: 'Tampilkan yang dilewati',
    reviewHint: 'Geser kanan untuk terima, kiri untuk lewati, atau ketuk kategori.',
    emailsParsed: 'email BCA tercatat', lastSynced: 'Terakhir sinkron', never: 'Belum', filterSkipped: 'Dilewati', account: 'Gmail',
    syncNow: 'Sinkron sekarang', syncing: 'Menyinkron…', recent: 'Transaksi terbaru', viewAll: 'Lihat semua',
    msgUnder: 'Masih aman. Sisa {left} untuk sisa {month}, sekitar {perDay} per hari.',
    msgNear: 'Perhatian: {pct} anggaran sudah terpakai, {days} lagi. Sisa {left}.',
    msgOver: 'Kamu melebihi anggaran {left} bulan ini.', msgOverJump: '{category} naik paling besar dibanding {prev}.',
    msgPastUnder: 'Pengeluaran {month} masih dalam anggaran, sisa {left}.', msgPastOver: 'Pengeluaran {month} melebihi anggaran {left}.',
    msgRange: '{pct} anggaran untuk {days} ini sudah terpakai.', msgNoBudget: 'Atur anggaran bulanan untuk melihat sisa yang bisa dibelanjakan.',
    msgFuture: 'Belum ada pengeluaran di {month}.',

    transactions: 'Transaksi', searchPh: 'Cari merchant atau jumlah', exportCsv: 'Ekspor CSV', allSources: 'Semua sumber',
    avgTx: 'Rata-rata per transaksi', uncategorized: 'Belum berkategori', sortNewest: 'Terbaru', sortOldest: 'Terlama',
    sortLargest: 'Terbesar', sortSmallest: 'Terkecil', sortBy: 'Urutkan',
    hide: 'Sembunyikan', unhide: 'Tampilkan', hideTitle: 'Jangan hitung di total', unhideTitle: 'Hitung lagi transaksi ini',
    hiddenTag: 'disembunyikan', categoryFilter: 'Kategori', clearFilter: 'Hapus filter', noTx: 'Belum ada transaksi di periode ini.',
    noMatch: 'Tidak ada transaksi yang cocok.', openEmail: 'Lihat email', categoryLabel: 'Kategori',
    applyToMerchant: 'Masukkan juga semua transaksi dari "{merchant}" ke "{category}" (yang lalu dan yang akan datang)?',

    addCategory: 'Kategori baru', topMerchant: 'Merchant teratas', vsPrev: 'vs {prev}', deltaNew: 'baru vs {prev}', newCatTile: 'Kategori baru',
    rulesTitle: 'Aturan kategori otomatis', rulesSub: 'Jika nama merchant transaksi BCA memuat pola ini, kategori diterapkan otomatis.',
    addRule: 'Tambah aturan', matches: 'cocok', match: 'cocok', txCount: '{n} transaksi', txOne: '1 transaksi', noRules: 'Belum ada aturan. Tambahkan di sini, atau ubah kategori merchant di halaman Transaksi.',
    deleteRule: 'Hapus aturan', categoryName: 'Nama kategori', create: 'Buat', cancel: 'Batal', save: 'Simpan', saving: 'Menyimpan…',
    patternLabel: 'Merchant memuat', patternHint: 'Huruf besar/kecil tidak berpengaruh, mis. KOPI KENANGAN', ruleSaved: 'Aturan disimpan · {n} transaksi dipindah',
    categoryCreated: 'Kategori "{name}" dibuat', deleteRuleConfirm: 'Hapus aturan "{pattern}"? Transaksi yang sudah dipindah tetap di kategorinya.',
    categoriesCount: '{n} kategori',

    budgetTotal: 'Anggaran bulanan', editBudget: 'Ubah anggaran', projected: 'Proyeksi akhir bulan', projectedRange: 'Proyeksi periode ini',
    projSub: 'Berdasarkan {days} pengeluaran', projFinal: 'Total akhir periode ini', projOver: 'Akan melebihi anggaran', projUnder: 'Masih dalam anggaran',
    endedOver: 'Melebihi anggaran', endedUnder: 'Dalam anggaran',
    unallocated: 'Belum dialokasikan', unallocatedSub: 'Anggaran yang belum masuk kategori mana pun', overAllocated: 'Anggaran kategori melebihi anggaran bulanan',
    colCategory: 'Kategori', colBudget: 'Anggaran', colSpent: 'Terpakai', colLeft: 'Sisa', colStatus: 'Status',
    stOn: 'Aman', stNear: 'Hampir batas', stOver: 'Lebih', stNone: 'Tanpa batas', used: 'terpakai',
    budgetHint: 'Jumlah per bulan. Kosongkan untuk tanpa batas.', budgetRangeNote: 'Periode ini mencakup lebih dari satu bulan, jadi tiap anggaran bulanan disesuaikan dengan jumlah harinya.',
    budgetSaved: 'Anggaran disimpan', noBudgetYet: 'Belum ada anggaran bulanan.', perCategory: 'Per kategori',
    budgetAutoNote: 'Dijumlah dari anggaran per kategori. Ketik nominal untuk mengatur sendiri.', budgetManualNote: 'Diatur manual.', useSum: 'Pakai total kategori',
    accountMenu: 'Akun', perMonth: '{amount}/bln', budgetPeriod: 'Anggaran periode ini', msgRangeInMonth: '{pct} anggaran {month} sudah terpakai.',

    navForecast: 'Perkiraan', fcMeta: 'Bulan depan · {month}', fcExpected: 'Perkiraan pengeluaran', fcRange: 'Kemungkinan antara {low} dan {high}',
    fcOverBudget: '{amount} di atas anggaran', fcUnderBudget: '{amount} di bawah anggaran', fcVsAvg: '{pct} dari rata-rata {n} bulan',
    fcByAi: 'Dianalisis {model} · {ago}.',fcAnalysing: 'AI sedang menganalisis pengeluaranmu. Bisa sampai semenit.', fcAnalysingShort: 'Menganalisis…',
    fcRefresh: 'Perbarui perkiraan', fcStatOnly: 'Perkiraan statistik: {method}.', fcMethodWeighted: 'rata-rata tertimbang {months}',
    fcMethodRunRate: 'pengeluaran harian sejauh ini, dihitung untuk sebulan penuh',
    fcAiOff: 'Tambahkan DEEPSEEK_API_KEY di .env server untuk analisis AI dan saran gaya hidup.', fcAiFailed: 'Analisis AI gagal: {error}',
    fcRefreshFailed: 'Pembaruan gagal: {error}', fcAiTitle: 'Analisis AI', fcChartTitle: 'Bulan ke bulan',
    fcLegendActual: 'Tercatat', fcLegendPartial: 'Sebagian bulan', fcLegendForecast: 'Perkiraan', fcPartialFrom: 'Data mulai {date}', fcSoFar: 'Sejauh ini · {days}',
    fcTableTitle: 'Per kategori', fcColAvg: 'Rata-rata', fcColForecast: 'Perkiraan', fcColChange: 'Perubahan', fcRangeShort: '{low} – {high}',
    fcRecurringTitle: 'Pembayaran rutin', fcRecurringSub: 'Dibayar minimal 2 dari 3 bulan terakhir', fcAroundDay: 'sekitar tgl {day}',
    fcNoRecurring: 'Belum ada. Merchant muncul di sini setelah dibayar di 2 dari 3 bulan terakhir.',
    fcNoData: 'Belum ada pengeluaran tercatat, jadi belum bisa diperkirakan.', fcThinData: 'Baru {n} bulan data lengkap, jadi anggap ini gambaran kasar. Makin akurat setiap bulan.',
    fcLifestyleTitle: 'Saran gaya hidup', fcSaving: 'Hemat ~{amount}/bln', fcAdviceNote: 'Saran umum dari data pengeluaranmu, bukan nasihat keuangan profesional.',
    fcAdviceWaiting: 'Muncul di sini setelah analisis AI selesai.',

    connected: 'Terhubung', syncFailed: 'Sinkron gagal', syncOff: 'Sinkron mati', permission: 'Akses', imapReadOnly: 'IMAP · hanya-baca',
    nextSync: 'Sinkron berikutnya', inTime: '{time}', syncEvery: 'Cek setiap {n}', readOnlyGmail: 'hanya-baca',
    statParsed: 'tercatat', statSkipped: 'dilewati (bukan transaksi)', statReview: 'perlu kategori', statUnread: 'tidak terbaca',
    typesTitle: 'Jenis transaksi yang ditemukan', recentEmails: 'Email terbaru', showMore: 'Tampilkan lebih banyak',
    reread: 'Baca ulang semua email', rereadSub: 'Menjalankan parser lagi untuk semua email yang tersimpan, misalnya setelah ia belajar format BCA baru.',
    rereadDone: 'Selesai: {parsed} tercatat, {ignored} dilewati, {unparsed} tidak terbaca',
    filterAll: 'Semua', filterParsed: 'Tercatat', filterIgnored: 'Dilewati', filterUnparsed: 'Tidak terbaca', emailEmpty: 'Tidak ada.',
    statusParsed: 'Terbaca', statusSkipped: 'Dilewati · bukan transaksi', statusReview: 'Butuh kategori', statusUnparsed: 'Tidak terbaca',
    dkimOk: 'DKIM terverifikasi', dkimNo: 'DKIM tidak terverifikasi', close: 'Tutup', syncOffHelp: 'Sinkron email mati. Isi IMAP_USER dan IMAP_PASSWORD di .env, lalu restart.',

    today: 'Hari ini', yesterday: 'Kemarin', days: '{n} hari', day: '1 hari', noSpendingDay: 'Tidak ada pengeluaran', loading: 'Memuat…',
    dayLetters: 'S,S,R,K,J,S,M', prevPeriod: '{days} sebelumnya',
  },
};

// Built-in category names are stored in English; these are their Indonesian labels.
const CATEGORY_ID = {
  'Food & Drinks': 'Makanan & minuman', Groceries: 'Kebutuhan harian', Transport: 'Transportasi',
  'PayLater & Loans': 'PayLater & pinjaman', Shopping: 'Belanja', 'Bills & Utilities': 'Tagihan', Entertainment: 'Hiburan',
  'Personal Care': 'Perawatan diri', Donations: 'Donasi', Health: 'Kesehatan', Travel: 'Perjalanan',
  'E-Wallet Top Up': 'Isi saldo e-wallet', Education: 'Pendidikan', Transfer: 'Transfer', Cash: 'Tunai', Income: 'Pemasukan',
  Refund: 'Pengembalian dana', 'Credit Card Bill': 'Tagihan kartu kredit', Other: 'Lainnya', Uncategorized: 'Belum berkategori',
};

const CHANNELS = {
  en: {
    QRIS: 'QRIS', Transfer: 'Transfer', 'Credit Card': 'Credit card', 'Debit Card': 'Debit card', 'Virtual Account': 'Virtual account',
    'Top Up': 'Top up', 'Card Bill': 'Card bill', 'Cash Deposit': 'Cash deposit', 'Cash Withdrawal': 'Cash withdrawal',
  },
  id: {
    QRIS: 'QRIS', Transfer: 'Transfer', 'Credit Card': 'Kartu kredit', 'Debit Card': 'Kartu debit', 'Virtual Account': 'Virtual account',
    'Top Up': 'Isi saldo', 'Card Bill': 'Tagihan kartu', 'Cash Deposit': 'Setor tunai', 'Cash Withdrawal': 'Tarik tunai',
  },
};

function loadLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'id') return saved;
  } catch {
    // storage unavailable: fall back to the browser language
  }
  return navigator.language?.toLowerCase().startsWith('id') ? 'id' : 'en';
}

let lang = loadLang();

export const getLang = () => lang;
export const locale = () => (lang === 'id' ? 'id-ID' : 'en-GB');

export function setLang(next) {
  lang = next === 'id' ? 'id' : 'en';
  document.documentElement.lang = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // not saved; applies for this visit
  }
}

export function t(key, vars) {
  const s = T[lang][key] ?? T.en[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? '')) : s;
}

export const catName = (category) => (lang === 'id' && CATEGORY_ID[category]) || category || t('uncategorized');
export const channelName = (channel) => (channel ? CHANNELS[lang][channel] ?? channel : '');
export const dayCount = (n) => (n === 1 ? t('day') : t('days', { n }));

/** Fills elements marked with data-i18n (text), data-i18n-placeholder, data-i18n-label (aria-label) and data-i18n-title. */
export function applyStatic(root = document) {
  document.documentElement.lang = lang;
  for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const node of root.querySelectorAll('[data-i18n-placeholder]')) node.placeholder = t(node.dataset.i18nPlaceholder);
  for (const node of root.querySelectorAll('[data-i18n-label]')) node.setAttribute('aria-label', t(node.dataset.i18nLabel));
  for (const node of root.querySelectorAll('[data-i18n-title]')) node.title = t(node.dataset.i18nTitle);
}
