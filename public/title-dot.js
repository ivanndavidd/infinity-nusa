// The dot in the tab title hops like the one in the header wordmark. A title is plain text, so the dot moves by
// swapping between three dots that sit at different heights: '.', '·' and '˙'. Public: the sign-in page uses it too.

// [ms into the 2.6 s loop, dot]: up, top, down, a small second hop, rest. Same rhythm as the header's `dot` animation.
const FRAMES = [[0, '.'], [350, '·'], [600, '˙'], [950, '·'], [1300, '.'], [1700, '·'], [1950, '.']];
const LOOP_MS = 2600;

export function bounceTitleDot() {
  const base = document.title;
  if (!base.startsWith('nusa.') || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const rest = base.slice('nusa.'.length);
  const hop = () => FRAMES.forEach(([at, dot]) => setTimeout(() => (document.title = `nusa${dot}${rest}`), at));
  hop();
  setInterval(hop, LOOP_MS);
}
