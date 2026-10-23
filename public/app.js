// nusa. — app shell: state, period picker, data loading, routing, dialogs and email sync status.
import { applyStatic, catName, dayCount, getLang, setLang, t } from './i18n.js';
import {
  $, $$, addDays, api, daysBetween, debounce, el, hideTooltip, icon, lastDayOfMonth, monthLabel, money, parseAmount,
  shiftMonth, shortMonthLabel, dayLabel, todayIn, toast,
} from './lib.js';
import { dropdown } from './pages/ui.js';
import * as overview from './pages/overview.js';
import * as transactions from './pages/transactions.js';
import * as categories from './pages/categories.js';
import * as budgets from './pages/budgets.js';
import * as forecast from './pages/forecast.js';
import * as email from './pages/email.js';

const PAGES = { overview, transactions, categories, budgets, forecast, email };

// Categories that are money in or bookkeeping rather than spending; they never get a budget.
const NON_SPENDING = new Set(['Income', 'Refund', 'Cash', 'Credit Card Bill', 'Uncategorized']);

const state = {
  page: 'overview',
  timezone: 'Asia/Jakarta',
  me: null,
  months: [],
  currentMonth: null,
  month: null,
  mode: 'month', // 'month' or 'range'
  preset: null, // '7' | '30' | '90' | 'ytd' while a quick range is picked
  range: null, // { from, to } picked by hand
  categories: [],
  budgets: { total: null, categories: {} },
  summary: null,
  prevSummary: null,
  transactions: [],
  review: [],
  skipped: new Set(), // review cards skipped during this visit
  rules: null,
  emails: null,
  emailCounts: {},
  channels: [],
  emailFilter: '',
  emailLimit: 30,
  sync: null,
  txFilter: { q: '', channel: '', category: '' },
  loaded: false,
};

// ---------- period ----------

const PERIOD_KEY = 'spending-monitor.period';
const PRESETS = new Set(['7', '30', '90', 'ytd']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function loadPeriod() {
  try {
    const saved = JSON.parse(localStorage.getItem(PERIOD_KEY));
    if (saved?.mode === 'range' && PRESETS.has(saved.preset)) return { mode: 'range', preset: saved.preset, range: null };
    if (saved?.mode === 'range' && DATE_RE.test(saved.from) && DATE_RE.test(saved.to)) {
      return { mode: 'range', preset: null, range: { from: saved.from, to: saved.to } };
    }
  } catch {
    // storage unavailable or corrupt: start on this month
  }
  return { mode: 'month', preset: null, range: null };
}

function savePeriod() {
  try {
    const { mode, preset, range } = state;
    localStorage.setItem(PERIOD_KEY, JSON.stringify(mode === 'month' ? { mode } : preset ? { mode, preset } : { mode, ...range }));
  } catch {
    // not saved; the period still applies for this visit
  }
}

const today = () => todayIn(state.timezone);

// Quick ranges end today and are worked out fresh each time, so "30 days" stays the last 30 days.
function presetRange(preset) {
  const now = today();
  return { from: preset === 'ytd' ? `${now.slice(0, 4)}-01-01` : addDays(now, 1 - Number(preset)), to: now };
}

function bounds() {
  if (state.mode === 'month') return { from: `${state.month}-01`, to: lastDayOfMonth(state.month) };
  return state.preset ? presetRange(state.preset) : state.range;
}

function previousBounds({ from, to }) {
  if (state.mode === 'month') {
    const pm = shiftMonth(state.month, -1);
    return { from: `${pm}-01`, to: lastDayOfMonth(pm), label: shortMonthLabel(pm) };
  }
  const n = daysBetween(from, to);
  return { from: addDays(from, -n), to: addDays(from, -1), label: t('prevPeriod', { days: dayCount(n) }) };
}

function periodLabel() {
  if (state.mode === 'month') return monthLabel(state.month);
  if (state.preset) return t({ 7: 'last7', 30: 'last30', 90: 'last90', ytd: 'thisYear' }[state.preset]);
  const { from, to } = state.range;
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${dayLabel(from, !sameYear)} – ${dayLabel(to, true)}`;
}

/** Everything pages need to know about the selected period. */
function periodInfo() {
  const { from, to } = state.summary ?? bounds();
  const now = today();
  const totalDays = daysBetween(from, to);
  const end = to < now ? to : now;
  const elapsedDays = end < from ? 0 : daysBetween(from, end);
  const prev = previousBounds({ from, to });
  return {
    from, to, today: now, totalDays, elapsedDays,
    daysLeft: now < from ? totalDays : now > to ? 0 : daysBetween(now, to) - 1,
    isMonth: state.mode === 'month', month: state.mode === 'month' ? state.month : null,
    // Budgets are monthly; only a period reaching into another month gets them scaled (see budgetForPeriod).
    budgetScaled: from.slice(0, 7) !== to.slice(0, 7),
    isCurrent: from <= now && now <= to, isPast: to < now, isFuture: from > now,
    prevLabel: prev.label, label: periodLabel(),
  };
}

/**
 * The budget for the selected period. A period inside one month (the month, or part of it) gets the full monthly
 * amount; one spanning several months gets each month's amount scaled to the days it covers.
 */
function budgetForPeriod(monthly) {
  if (!monthly) return null;
  const { from, to, budgetScaled } = periodInfo();
  if (!budgetScaled) return monthly;
  let total = 0;
  for (let cursor = from; cursor <= to;) {
    const monthEnd = lastDayOfMonth(cursor.slice(0, 7));
    const segmentEnd = monthEnd < to ? monthEnd : to;
    total += (monthly * daysBetween(cursor, segmentEnd)) / Number(monthEnd.slice(8));
    cursor = addDays(segmentEnd, 1);
  }
  return total;
}

function setPeriod(changes) {
  Object.assign(state, changes);
  savePeriod();
  renderPeriodControls();
  loadPeriodData({ animate: true }).catch(showError);
}

function setMode(mode) {
  if (mode === state.mode) return;
  if (mode === 'range' && !state.preset && !state.range) {
    // First switch: start with the month being viewed, up to today.
    const from = `${state.month}-01`;
    const end = lastDayOfMonth(state.month);
    const now = today();
    state.range = { from, to: now >= from && now < end ? now : end };
  }
  setPeriod({ mode });
}

let pickerYear = null;

function renderPeriodControls() {
  $('#period-label').textContent = periodLabel();
  const isRange = state.mode === 'range';
  for (const button of $$('.seg[data-mode]')) {
    const active = button.dataset.mode === state.mode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  $('#month-panel').hidden = isRange;
  $('#range-panel').hidden = !isRange;
  if (isRange) {
    const { from, to } = bounds();
    $('#range-from').value = from;
    $('#range-to').value = to;
  }
  for (const chip of $$('[data-preset]')) chip.classList.toggle('is-active', chip.dataset.preset === state.preset);

  pickerYear ??= Number((state.month ?? today()).slice(0, 4));
  $('#month-year').textContent = String(pickerYear);
  const withData = new Set(state.months);
  const current = state.currentMonth ?? today().slice(0, 7);
  $('#month-list').replaceChildren(
    ...Array.from({ length: 12 }, (_, i) => {
      const month = `${pickerYear}-${String(i + 1).padStart(2, '0')}`;
      return el('button', {
        type: 'button',
        class: `month-cell${month === state.month && !isRange ? ' is-active' : ''}${withData.has(month) ? ' has-data' : ''}`,
        text: shortMonthLabel(month),
        title: monthLabel(month),
        disabled: month > current,
        onclick: () => {
          closePopovers();
          if (state.mode === 'month' && month === state.month) return;
          setPeriod({ mode: 'month', month });
        },
      });
    }),
  );
  $('#month-next').disabled = pickerYear >= Number(current.slice(0, 4));
}

const onRangeInput = debounce(() => {
  let from = $('#range-from').value;
  let to = $('#range-to').value;
  // Skip half-typed dates, such as the year 0002 on the way to 2026.
  if (!from || !to || from < '2000' || to < '2000') return;
  if (from > to) [from, to] = [to, from];
  setPeriod({ preset: null, range: { from, to } });
}, 350);

// ---------- data ----------

let loadSeq = 0;

async function loadPeriodData({ animate = false } = {}) {
  const seq = ++loadSeq;
  const current = bounds();
  const prev = previousBounds(current);
  const q = (b) => new URLSearchParams({ from: b.from, to: b.to });
  const [summary, prevSummary, txs, review] = await Promise.all([
    api(`/api/summary?${q(current)}`),
    api(`/api/summary?${q(prev)}`),
    api(`/api/transactions?${q(current)}`),
    api(`/api/review?${q(current)}`),
  ]);
  if (seq !== loadSeq) return; // a newer period was picked meanwhile
  Object.assign(state, { summary, prevSummary, transactions: txs, review, loaded: true });
  render({ animate });
}

async function loadMonths() {
  const { current, months, timezone } = await api('/api/months');
  state.timezone = timezone;
  state.currentMonth = current;
  state.month ??= current;
  state.months = months;
}

async function loadCategories() {
  state.categories = await api('/api/categories');
}

async function loadBudgets() {
  state.budgets = await api('/api/budgets');
}

async function loadRules() {
  state.rules = await api('/api/rules');
}

async function loadEmails() {
  const params = new URLSearchParams({ limit: String(state.emailLimit) });
  if (state.emailFilter) params.set('status', state.emailFilter);
  const { counts, channels, emails } = await api(`/api/emails?${params}`);
  Object.assign(state, { emailCounts: counts, channels, emails });
}

async function reloadAll({ animate = false } = {}) {
  await Promise.all([loadMonths(), loadCategories(), loadBudgets(), loadEmails()]);
  if (state.page === 'categories') await loadRules();
  renderPeriodControls();
  await loadPeriodData({ animate });
}

// ---------- actions pages can call ----------

async function updateTransaction(id, body) {
  const result = await api(`/api/transactions/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  await Promise.all([loadCategories(), state.rules ? loadRules() : null]);
  await loadPeriodData();
  return result;
}

/** Changes a transaction's category, asking whether the merchant should always go there. */
async function setCategory(tx, category, { ask = true } = {}) {
  const applyToMerchant = ask && Boolean(tx.merchant) && window.confirm(t('applyToMerchant', { merchant: tx.merchant, category: catName(category) }));
  try {
    await updateTransaction(tx.id, { category, applyToMerchant });
  } catch (err) {
    showError(err);
  }
}

function navigate(page, { category } = {}) {
  if (category !== undefined) state.txFilter = { ...state.txFilter, category, q: '', channel: '' };
  if (window.location.hash === `#/${page}`) route();
  else window.location.hash = `#/${page}`;
}

async function syncNow() {
  try {
    state.sync = { ...(state.sync ?? {}), running: true };
    render();
    await api('/api/sync', { method: 'POST', body: '{}' });
    lastSyncSuccess = undefined;
    await refreshSync();
    await reloadAll();
  } catch (err) {
    showError(err);
    await refreshSync().catch(() => {});
  }
}

async function reread() {
  const r = await api('/api/reparse', { method: 'POST', body: '{}' });
  toast(t('rereadDone', r));
  await reloadAll();
}

async function openEmail(id) {
  try {
    const mail = await api(`/api/emails/${id}`);
    $('#email-dialog-title').textContent = mail.subject || '(no subject)';
    $('#email-dialog-meta').textContent = [
      mail.sender,
      new Intl.DateTimeFormat(getLang() === 'id' ? 'id-ID' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: state.timezone }).format(new Date(mail.received_at)),
      mail.parse_note,
      mail.dkim_pass ? t('dkimOk') : t('dkimNo'),
    ].filter(Boolean).join(' · ');
    $('#email-dialog-body').textContent = mail.lines.join('\n');
    $('#email-dialog').showModal();
  } catch (err) {
    showError(err);
  }
}

/** Opens the shared form dialog. onSubmit gets the form; throwing shows the message inside the dialog. */
function openForm({ title, sub, body, submitLabel, onSubmit }) {
  const dialog = $('#form-dialog');
  const error = el('p', { class: 'form-error', role: 'alert', hidden: true });
  const submit = el('button', { class: 'btn btn-solid', type: 'submit', text: submitLabel });
  const form = el(
    'form',
    { class: 'form', novalidate: true },
    el('div', { class: 'dialog-head' },
      el('div', {}, el('h2', { text: title }), sub ? el('p', { class: 'muted small', text: sub }) : null),
      el('button', { class: 'icon-btn', type: 'button', 'aria-label': t('close'), onclick: () => dialog.close() }, icon('x'))),
    ...body,
    error,
    el('div', { class: 'form-actions' },
      el('button', { class: 'btn', type: 'button', text: t('cancel'), onclick: () => dialog.close() }),
      submit),
  );
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    submit.textContent = t('saving');
    error.hidden = true;
    try {
      await onSubmit(form);
      dialog.close();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    } finally {
      submit.disabled = false;
      submit.textContent = submitLabel;
    }
  });
  dialog.replaceChildren(form);
  dialog.showModal();
  form.querySelector('input, select')?.focus();
}

function amountInput(name, value) {
  const input = el('input', { name, inputmode: 'numeric', autocomplete: 'off', placeholder: '–', value: value ? money(value).replace('Rp', '') : '' });
  // Keep thousands dots while typing.
  input.addEventListener('input', () => {
    const n = parseAmount(input.value);
    input.value = n === null ? '' : money(n).replace('Rp', '');
  });
  return el('span', { class: 'amount-input' }, el('span', { class: 'amount-prefix', text: 'Rp' }), input);
}

function openBudgetDialog() {
  const spendCategories = new Set([
    ...state.categories.filter((c) => !NON_SPENDING.has(c)),
    ...Object.keys(state.budgets.categories),
  ]);
  // Most-used categories first, so the ones that matter are at the top.
  const spent = new Map((state.summary?.byCategory ?? []).map((c) => [c.category, c.total]));
  const ordered = [...spendCategories].sort((a, b) => (spent.get(b) ?? 0) - (spent.get(a) ?? 0) || a.localeCompare(b));

  // The monthly budget follows the sum of the category budgets until it is typed in by hand.
  // Emptying it goes back to the sum. A saved total that equals the saved sum counts as automatic.
  const totalField = amountInput('total', state.budgets.total);
  const totalInput = totalField.querySelector('input');
  const catInputs = ordered.map((c) => amountInput(`cat:${c}`, state.budgets.categories[c]));
  const savedSum = Object.values(state.budgets.categories).reduce((a, v) => a + v, 0);
  let auto = state.budgets.total === null || state.budgets.total === savedSum;
  const note = el('span');
  const useSum = el('button', { class: 'link-inline', type: 'button', text: t('useSum') });
  const fillSum = () => {
    const sum = catInputs.reduce((a, f) => a + (parseAmount(f.querySelector('input').value) ?? 0), 0);
    totalInput.value = sum ? money(sum).replace('Rp', '') : '';
  };
  const showMode = () => {
    note.textContent = t(auto ? 'budgetAutoNote' : 'budgetManualNote');
    useSum.hidden = auto;
  };
  totalInput.addEventListener('input', () => {
    auto = parseAmount(totalInput.value) === null;
    showMode();
  });
  totalInput.addEventListener('blur', () => auto && fillSum());
  for (const f of catInputs) f.querySelector('input').addEventListener('input', () => auto && fillSum());
  useSum.addEventListener('click', () => {
    auto = true;
    fillSum();
    showMode();
  });
  if (auto) fillSum();
  showMode();

  openForm({
    title: t('editBudget'),
    sub: t('budgetHint'),
    submitLabel: t('save'),
    body: [
      el('label', { class: 'field field-wide' }, el('span', { text: t('budgetTotal') }), totalField, el('small', { class: 'muted' }, note, ' ', useSum)),
      el('p', { class: 'form-section', text: t('perCategory') }),
      el('div', { class: 'budget-fields' },
        ...ordered.map((c, i) => el('label', { class: 'field field-row' }, el('span', { text: catName(c) }), catInputs[i]))),
    ],
    onSubmit: async (form) => {
      const data = new FormData(form);
      const categoriesBody = {};
      for (const [key, value] of data) {
        if (key.startsWith('cat:') && parseAmount(value)) categoriesBody[key.slice(4)] = parseAmount(value);
      }
      state.budgets = await api('/api/budgets', {
        method: 'PUT',
        body: JSON.stringify({ total: parseAmount(data.get('total')), categories: categoriesBody }),
      });
      toast(t('budgetSaved'));
      await loadCategories();
      render();
    },
  });
}

function categoryOptions(selected) {
  const list = state.categories.filter((c) => c !== 'Uncategorized');
  if (selected && !list.includes(selected)) list.unshift(selected);
  return list.map((c) => ({ value: c, label: catName(c) }));
}

function openRuleDialog({ pattern = '', category = '' } = {}) {
  openForm({
    title: t('addRule'),
    sub: t('rulesSub'),
    submitLabel: t('save'),
    body: [
      el('label', { class: 'field field-wide' }, el('span', { text: t('patternLabel') }),
        el('input', { name: 'pattern', value: pattern, maxlength: 100, required: true, class: 'mono', placeholder: 'KOPI KENANGAN' }),
        el('small', { class: 'muted', text: t('patternHint') })),
      el('div', { class: 'field field-wide' }, el('span', { text: t('categoryLabel') }),
        dropdown({ options: categoryOptions(category || 'Food & Drinks'), value: category || 'Food & Drinks', name: 'category', label: t('categoryLabel'), className: 'field-select' })),
    ],
    onSubmit: async (form) => {
      const data = new FormData(form);
      const rule = await api('/api/rules', { method: 'POST', body: JSON.stringify({ pattern: data.get('pattern'), category: data.get('category') }) });
      toast(t('ruleSaved', { n: rule.updated }));
      await loadRules();
      await loadPeriodData();
    },
  });
}

function openCategoryDialog() {
  openForm({
    title: t('addCategory'),
    submitLabel: t('create'),
    body: [el('label', { class: 'field field-wide' }, el('span', { text: t('categoryName') }), el('input', { name: 'name', maxlength: 50, required: true }))],
    onSubmit: async (form) => {
      const name = String(new FormData(form).get('name') ?? '').trim();
      if (!name) throw new Error(t('categoryName'));
      await api('/api/categories', { method: 'POST', body: JSON.stringify({ name }) });
      toast(t('categoryCreated', { name }));
      await loadCategories();
      render();
    },
  });
}

async function deleteRule(rule) {
  if (!window.confirm(t('deleteRuleConfirm', { pattern: rule.pattern.toUpperCase() }))) return;
  try {
    await api(`/api/rules/${rule.id}`, { method: 'DELETE' });
    await loadRules();
    render();
  } catch (err) {
    showError(err);
  }
}

async function setEmailFilter(filter, limit = 30) {
  state.emailFilter = filter;
  state.emailLimit = limit;
  try {
    await loadEmails();
    render();
  } catch (err) {
    showError(err);
  }
}

function showError(err) {
  console.error(err);
  toast(`⚠ ${err.message}`, true);
}

const ctx = {
  state,
  get info() {
    return periodInfo();
  },
  budgetForPeriod,
  NON_SPENDING,
  navigate, setCategory, updateTransaction, openEmail, openBudgetDialog, openRuleDialog, openCategoryDialog, deleteRule,
  syncNow, reread, setEmailFilter, showError, render: (opts) => render(opts),
};

// ---------- rendering & routing ----------

function render({ animate = false } = {}) {
  if (!state.loaded) return;
  hideTooltip();
  const page = PAGES[state.page];
  const root = $(`#page-${state.page}`);
  root.classList.toggle('no-enter', !animate);
  page.render(root, ctx, { animate });
}

async function route() {
  const page = window.location.hash.replace(/^#\/?/, '') || 'overview';
  state.page = Object.hasOwn(PAGES, page) ? page : 'overview';
  for (const section of $$('.page')) section.hidden = section.dataset.page !== state.page;
  for (const link of $$('[data-page]')) {
    if (link.tagName === 'A') link.classList.toggle('is-active', link.dataset.page === state.page);
  }
  // The forecast is always about next month, so the period picker has nothing to do there.
  $('#period-btn').closest('.pop-anchor').hidden = state.page === 'forecast';
  window.scrollTo({ top: 0 });
  if (state.page === 'categories' && !state.rules) await loadRules().catch(showError);
  render({ animate: true });
}

// ---------- email sync status ----------

let lastSyncSuccess;

function renderBanner() {
  const s = state.sync;
  if (!s) return;
  const banner = $('#sync-banner');
  banner.hidden = s.enabled && !s.lastError;
  banner.textContent = !s.enabled ? t('syncOffHelp') : s.lastError ? `⚠ ${t('syncFailed')}: ${s.lastError}` : '';
}

async function refreshSync() {
  const previous = state.sync;
  state.sync = await api('/api/sync');
  const s = state.sync;
  renderBanner();

  const found = lastSyncSuccess !== undefined && s.lastSuccessAt !== lastSyncSuccess && s.lastResult?.found > 0;
  lastSyncSuccess = s.lastSuccessAt;
  if (found) {
    await reloadAll();
    return;
  }
  const changed = !previous || previous.running !== s.running || previous.lastSuccessAt !== s.lastSuccessAt || previous.lastError !== s.lastError;
  if (changed && (state.page === 'overview' || state.page === 'email')) render();
}

// ---------- shell wiring ----------

function closePopovers(except) {
  for (const [button, pop] of [['#period-btn', '#period-pop'], ['#avatar', '#account-pop']]) {
    if (pop === except) continue;
    $(pop).hidden = true;
    $(button).setAttribute('aria-expanded', 'false');
  }
}

function togglePopover(buttonSel, popSel) {
  const pop = $(popSel);
  const open = pop.hidden;
  closePopovers(popSel);
  pop.hidden = !open;
  $(buttonSel).setAttribute('aria-expanded', String(open));
}

function renderLang() {
  const other = getLang() === 'en' ? 'ID' : 'EN';
  const toggle = $('#lang-btn');
  toggle.dataset.lang = getLang();
  toggle.querySelector('.lang-code').textContent = getLang().toUpperCase();
  toggle.title = `${getLang().toUpperCase()} → ${other}`;
  toggle.setAttribute('aria-label', `${t('language')}: ${getLang() === 'en' ? 'English' : 'Bahasa Indonesia'} → ${other}`);
  $('#lang-btn-menu').textContent = `${t('language')}: ${getLang() === 'en' ? 'English' : 'Bahasa Indonesia'} → ${other}`;
}

function switchLang() {
  setLang(getLang() === 'en' ? 'id' : 'en');
  applyStatic();
  renderLang();
  renderPeriodControls();
  renderBanner();
  render();
}

function wire() {
  $('#period-btn').addEventListener('click', () => togglePopover('#period-btn', '#period-pop'));
  $('#avatar').addEventListener('click', () => togglePopover('#avatar', '#account-pop'));
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.pop-anchor')) closePopovers();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closePopovers();
  });
  window.addEventListener('scroll', hideTooltip, { passive: true });
  // A tapped tooltip stays open until the next touch; a tap on another chart mark then opens that one's.
  document.addEventListener('pointerdown', (event) => event.pointerType !== 'mouse' && hideTooltip(), true);

  for (const button of $$('.seg[data-mode]')) button.addEventListener('click', () => setMode(button.dataset.mode));
  $('#month-prev').append(icon('chevronLeft'));
  $('#month-next').append(icon('chevronRight'));
  $('#month-prev').addEventListener('click', () => {
    pickerYear -= 1;
    renderPeriodControls();
  });
  $('#month-next').addEventListener('click', () => {
    pickerYear += 1;
    renderPeriodControls();
  });
  $('#range-from').addEventListener('change', onRangeInput);
  $('#range-to').addEventListener('change', onRangeInput);
  for (const chip of $$('[data-preset]')) {
    chip.addEventListener('click', () => {
      closePopovers();
      setPeriod({ preset: chip.dataset.preset });
    });
  }
  $('.pill-chevron').append(icon('chevron', 14, 2.5));

  $('#lang-btn').addEventListener('click', switchLang);
  $('#lang-btn-menu').addEventListener('click', switchLang);
  $('#logout-btn').addEventListener('click', async () => {
    try {
      await api('/api/logout', { method: 'POST', body: '{}' });
    } finally {
      window.location.href = '/login';
    }
  });

  $('#email-dialog-close').append(icon('x'));
  $('#email-dialog-close').addEventListener('click', () => $('#email-dialog').close());
  for (const dialog of $$('dialog')) {
    // Click on the backdrop closes the dialog.
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  }
  for (const span of $$('.tab-icon')) span.append(icon(span.dataset.icon, 22));

  window.addEventListener('hashchange', () => route().catch(showError));
  window.addEventListener('resize', debounce(() => state.page === 'overview' && render(), 200));
}

async function loadAccount() {
  state.me = await api('/api/me');
  const mail = state.me.email ?? '';
  $('#avatar').replaceChildren(icon('user', 18, 2.2));
  $('#avatar').setAttribute('aria-label', mail || t('accountMenu'));
  $('#account-email').textContent = mail;
  $('#account-email').hidden = !mail;
  $('.pop-caption').hidden = !mail;
  $('#logout-btn').hidden = !state.me.authEnabled;
}

async function init() {
  Object.assign(state, loadPeriod());
  applyStatic();
  renderLang();
  wire();
  try {
    await loadAccount();
    await Promise.all([refreshSync(), loadMonths()]);
    await route();
    await reloadAll({ animate: true });
  } catch (err) {
    showError(err);
  }
  setInterval(() => refreshSync().catch(showError), 15_000);
}

init();
