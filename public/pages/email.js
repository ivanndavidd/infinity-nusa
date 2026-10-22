// Email sync: mailbox connection, counts, transaction types, recent BCA emails, re-read.
import { channelName, t } from '../i18n.js';
import { dayKeyIn, dayLabel, durationLabel, el, money, motion, stagger, timeAgo, timeIn } from '../lib.js';
import { emptyNote, outlineButton, pageHead, pill, solidButton, tile } from './ui.js';

const GOOGLE_G = [
  ['#EA4335', 'M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z'],
  ['#4285F4', 'M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z'],
  ['#FBBC05', 'M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z'],
  ['#34A853', 'M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z'],
];

function googleLogo(size = 18) {
  const ns = 'http://www.w3.org/2000/svg';
  const root = document.createElementNS(ns, 'svg');
  root.setAttribute('width', size);
  root.setAttribute('height', size);
  root.setAttribute('viewBox', '0 0 48 48');
  root.setAttribute('aria-hidden', 'true');
  for (const [fill, d] of GOOGLE_G) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('fill', fill);
    path.setAttribute('d', d);
    root.append(path);
  }
  return root;
}

function connectionPill(sync) {
  if (!sync?.enabled) return pill(t('syncOff'));
  if (sync.lastError) return el('span', { class: 'status-pill is-danger with-dot' }, el('span', { class: 'live-dot is-error' }), t('syncFailed'));
  return el('span', { class: 'status-pill is-good with-dot' }, el('span', { class: 'live-dot is-good' }), t('connected'));
}

function accountTile(ctx) {
  const s = ctx.state.sync ?? {};
  const kv = (label, value) => el('div', { class: 'kv' }, el('span', { text: label }), el('b', { class: 'ellipsis', text: value }));
  return tile(
    't-account',
    el('div', { class: 'account-row' },
      el('span', { class: 'g-avatar' }, googleLogo()),
      el('div', { class: 'stack-2' },
        el('span', { class: 'tile-title', text: s.account ?? '—' }),
        el('span', { class: 'muted small', text: `Gmail · ${s.mailbox ?? 'INBOX'} · ${t('readOnlyGmail')}` }))),
    el('div', { class: 'kv-list kv-lined' },
      kv(t('permission'), t('imapReadOnly')),
      kv(t('lastSynced'), s.lastSuccessAt ? timeAgo(s.lastSuccessAt) : t('never')),
      kv(t('nextSync'), s.running ? t('syncing') : s.nextRunAt ? timeAgo(s.nextRunAt) : '—'),
      s.intervalSeconds ? el('div', { class: 'kv' }, el('span', { text: t('syncEvery', { n: durationLabel(s.intervalSeconds) }) })) : null),
    s.lastError ? el('p', { class: 'small is-danger', text: s.lastError }) : null,
  );
}

function statsTile(ctx, m) {
  const c = ctx.state.emailCounts;
  const stat = (value, label, tone = '') => {
    const num = el('span', { class: `big-num${tone ? ` is-${tone}` : ''}` });
    m.count(num, value);
    return el('div', { class: 'stat-stack' }, num, el('span', { class: 'muted small', text: label }));
  };
  return tile('t-stats',
    stat(c.parsed, t('statParsed')),
    stat(c.ignored, t('statSkipped')),
    stat(c.uncategorized, t('statReview'), 'pink'),
    stat(c.unparsed, t('statUnread'), c.unparsed ? 'danger' : ''));
}

function typesTile(ctx) {
  const { channels } = ctx.state;
  return tile('t-types',
    el('span', { class: 'tile-title', text: t('typesTitle') }),
    channels.length
      ? el('div', { class: 'kv-list kv-lined' }, ...channels.map((c) =>
          el('div', { class: 'kv' }, el('span', { class: 'strong ink', text: channelName(c.channel) }), el('b', { class: 'num', text: String(c.count) }))))
      : emptyNote(t('emailEmpty')));
}

function statusOf(mail) {
  if (mail.status === 'unparsed') return pill(t('statusUnparsed'), 'danger');
  if (mail.status === 'ignored') return pill(t('statusSkipped'));
  if (mail.direction === 'debit' && mail.category === 'Uncategorized') return pill(t('statusReview'), 'warn');
  return pill(t('statusParsed'), 'good');
}

function when(iso, ctx) {
  const tz = ctx.state.timezone;
  const day = dayKeyIn(iso, tz);
  const today = ctx.info.today;
  if (day === today) return timeIn(iso, tz);
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return day === yesterday ? t('yesterday') : dayLabel(day, day.slice(0, 4) !== today.slice(0, 4));
}

function emailsTile(ctx) {
  const { state } = ctx;
  const filters = [['', 'filterAll'], ['parsed', 'filterParsed'], ['ignored', 'filterIgnored'], ['unparsed', 'filterUnparsed']];
  const rows = state.emails ?? [];
  return tile('t-emails',
    el('div', { class: 'tile-head wrap' },
      el('span', { class: 'tile-title', text: t('recentEmails') }),
      el('div', { class: 'chips' }, ...filters.map(([value, key]) => el('button', {
        class: `chip chip-sm${state.emailFilter === value ? ' is-active' : ''}`,
        type: 'button',
        text: key === 'filterUnparsed' && state.emailCounts.unparsed ? `${t(key)} (${state.emailCounts.unparsed})` : t(key),
        onclick: () => ctx.setEmailFilter(value),
      })))),
    rows.length
      ? el('div', { class: 'email-list' }, ...rows.map((mail) => el(
          'button',
          { class: 'email-row', type: 'button', onclick: () => ctx.openEmail(mail.id) },
          el('span', { class: 'bca-chip', text: 'BCA' }),
          el('span', { class: 'email-text' },
            el('span', { class: 'email-line' }, el('span', { class: 'email-subject', text: mail.subject || '(no subject)' }), statusOf(mail)),
            el('span', { class: 'email-preview', text: mail.amount ? [mail.merchant || mail.description, money(mail.amount, mail.currency)].filter(Boolean).join(' · ') : (mail.parse_note ?? '') })),
          el('span', { class: 'email-side' },
            el('span', { class: 'faint small', text: when(mail.received_at, ctx) }),
            mail.amount ? el('span', { class: `num strong${mail.direction === 'credit' ? ' is-positive' : ''}`, text: `${mail.direction === 'credit' ? '+' : '-'}${money(mail.amount, mail.currency)}` }) : null),
        )))
      : emptyNote(t('emailEmpty')),
    rows.length >= state.emailLimit
      ? outlineButton(t('showMore'), () => ctx.setEmailFilter(state.emailFilter, state.emailLimit + 50), { class: 'btn btn-sm center' })
      : null);
}

function rereadTile(ctx) {
  const button = outlineButton(t('reread'), async () => {
    button.disabled = true;
    button.textContent = t('syncing');
    try {
      await ctx.reread();
    } catch (err) {
      ctx.showError(err);
    } finally {
      button.disabled = false;
      button.textContent = t('reread');
    }
  });
  return tile('t-reread', el('span', { class: 'tile-title', text: t('reread') }), el('span', { class: 'muted small lh', text: t('rereadSub') }), button);
}

export function render(root, ctx, { animate }) {
  const s = ctx.state.sync;
  const m = motion(animate);
  const tiles = [accountTile(ctx), statsTile(ctx, m), typesTile(ctx), emailsTile(ctx), rereadTile(ctx)];
  stagger(tiles);
  root.replaceChildren(
    pageHead(t('navEmail'), connectionPill(s),
      solidButton(s?.running ? t('syncing') : t('syncNow'), () => ctx.syncNow(), { disabled: s?.running || !s?.enabled })),
    el('div', { class: 'bento' }, ...tiles),
  );
  m.run();
}
