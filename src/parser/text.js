const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '-',
  mdash: '-',
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
};

const BLOCK_TAGS = /<\/?(?:p|div|br|tr|table|tbody|thead|tfoot|h[1-6]|li|ul|ol|section|article|header|footer|center|hr)\b[^>]*>/gi;

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

function cleanLine(line) {
  return line
    .replace(/[ \t ​]+/g, ' ')
    .replace(/(\s*\|\s*)+/g, ' | ')
    .replace(/^[\s|]+|[\s|]+$/g, '');
}

// Flattens an email's HTML into text lines. Table cells on the same row are joined with " | ".
export function htmlToLines(html) {
  const text = html
    // Line breaks in HTML source are just spaces; only tags decide where lines break.
    .replace(/\s+/g, ' ')
    .replace(/<(script|style|head|title)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(BLOCK_TAGS, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(text).split(/\r?\n/).map(cleanLine).filter(Boolean);
}

export function textToLines(text) {
  return text.split(/\r?\n/).map(cleanLine).filter(Boolean);
}

export function normLabel(label) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9& ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
