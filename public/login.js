// Sign-in page copy (English / Bahasa Indonesia) and error messages from the Google callback.
import { bounceTitleDot } from './title-dot.js';

const STORAGE_KEY = 'spending-monitor.lang';

const COPY = {
  en: {
    tagline: 'Know where your money goes.',
    foot1: 'Platform', foot2: 'Monitored', foot3: 'Centralized',
    eyebrow: 'Sign in', readOnly: 'Read-only', continueTo: 'Continue to',
    button: 'Continue with Google',
    note: 'Revoke access anytime from your Google Account.',
    cancelled: 'Sign-in was cancelled.',
    expired: 'That sign-in attempt expired. Please try again.',
    failed: 'Google sign-in failed. Please try again.',
    denied: "This Google account isn't allowed to open this dashboard.",
  },
  id: {
    tagline: 'Tahu ke mana uangmu pergi.',
    foot1: 'Platform', foot2: 'Terpantau', foot3: 'Terpusat',
    eyebrow: 'Masuk', readOnly: 'Hanya-baca', continueTo: 'Lanjut ke',
    button: 'Lanjutkan dengan Google',
    note: 'Akses bisa dicabut kapan saja dari Akun Google kamu.',
    cancelled: 'Proses masuk dibatalkan.',
    expired: 'Percobaan masuk sudah kedaluwarsa. Silakan coba lagi.',
    failed: 'Masuk dengan Google gagal. Silakan coba lagi.',
    denied: 'Akun Google ini tidak diizinkan membuka dashboard ini.',
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
const ERRORS = new Set(['cancelled', 'expired', 'failed', 'denied']);
const error = new URLSearchParams(window.location.search).get('error');

function apply() {
  const copy = COPY[lang];
  document.documentElement.lang = lang;
  for (const node of document.querySelectorAll('[data-l]')) node.textContent = copy[node.dataset.l];
  const box = document.querySelector('#login-error');
  if (ERRORS.has(error)) {
    box.textContent = copy[error];
    box.hidden = false;
  }
  const toggle = document.querySelector('#login-lang');
  toggle.dataset.lang = lang;
  toggle.querySelector('.lang-code').textContent = lang.toUpperCase();
  toggle.setAttribute('aria-label', lang === 'en' ? 'English. Switch to Bahasa Indonesia' : 'Bahasa Indonesia. Ganti ke English');
}

const measure = document.createElement('canvas').getContext('2d');

/** The drawn (ink) extent of an element's text: from its box's left edge, how far left and right the letters reach. */
function ink(node, text) {
  const style = getComputedStyle(node);
  measure.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  measure.letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
  const m = measure.measureText(text);
  return { left: -m.actualBoundingBoxLeft, right: m.actualBoundingBoxRight };
}

/**
 * Sizes the tagline so its letters span exactly the logo + wordmark row above it, from the wave's left tip to the
 * pink dot, in either language.
 */
function fitTagline() {
  const tagline = document.querySelector('.tagline');
  const brand = document.querySelector('.login-brand').getBoundingClientRect();
  const wordmark = document.querySelector('.login-brand .wordmark');
  tagline.style.fontSize = '';
  tagline.style.marginLeft = '';
  const target = wordmark.getBoundingClientRect().left + ink(wordmark, 'nusa.').right - brand.left;
  const text = tagline.textContent.toUpperCase();
  const before = ink(tagline, text);
  if (!target || before.right <= before.left) return;
  const size = (parseFloat(getComputedStyle(tagline).fontSize) * target) / (before.right - before.left);
  tagline.style.fontSize = `${size.toFixed(2)}px`;
  tagline.style.marginLeft = `${(-ink(tagline, text).left).toFixed(2)}px`; // the K's side bearing
}

document.fonts.ready.then(fitTagline);
window.addEventListener('resize', fitTagline);

document.querySelector('#login-lang').addEventListener('click', () => {
  lang = lang === 'en' ? 'id' : 'en';
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // not saved; applies for this visit
  }
  apply();
  fitTagline();
});

apply();
bounceTitleDot();
