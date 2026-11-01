// ANSI escape sequences in received text (colours of ESP-IDF, Zephyr, U-Boot,
// Linux consoles …).
//
// The monitor shows lines, not a screen: colours and text attributes (SGR) are
// kept, everything else (cursor movement, erasing, window titles) is removed.
// Every line starts with the default style – consoles that colour a line end it
// with a reset anyway.

export interface AnsiStyle {
  /** Palette colour 0–15 or a CSS colour (#rrggbb) for 256-colour and true-colour codes. */
  fg?: number | string;
  bg?: number | string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
}

export interface AnsiSegment {
  text: string;
  style: AnsiStyle | null;
}

// CSI: ESC [ parameters intermediates final byte; OSC: ESC ] … BEL or ESC \;
// other two-byte sequences: ESC and one character.
// eslint-disable-next-line no-control-regex
const SEQUENCE = /\x1b(?:\[([0-?]*)[ -/]*([@-~])|\][^\x07\x1b]*(?:\x07|\x1b\\)?|[@-Z\\-_]|.?)/g;

/** True when the text contains an escape character at all (cheap pre-check). */
export function hasAnsi(text: string): boolean {
  return text.includes('\x1b');
}

/** The text without any escape sequence. */
export function stripAnsi(text: string): string {
  return hasAnsi(text) ? text.replace(SEQUENCE, '') : text;
}

function color256(n: number): number | string {
  if (n < 16) return n;
  if (n < 232) {
    const i = n - 16;
    const level = (v: number) => (v === 0 ? 0 : 55 + v * 40);
    const r = level(Math.floor(i / 36));
    const g = level(Math.floor(i / 6) % 6);
    const b = level(i % 6);
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  }
  const gray = (8 + (n - 232) * 10).toString(16).padStart(2, '0');
  return `#${gray}${gray}${gray}`;
}

function applySgr(style: AnsiStyle, params: string): AnsiStyle {
  const codes = params === '' ? [0] : params.split(/[;:]/).map((p) => (p === '' ? 0 : Number(p)));
  let s: AnsiStyle = { ...style };
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i]!;
    if (c === 0) s = {};
    else if (c === 1) s.bold = true;
    else if (c === 2) s.dim = true;
    else if (c === 3) s.italic = true;
    else if (c === 4) s.underline = true;
    else if (c === 7) s.inverse = true;
    else if (c === 22) {
      delete s.bold;
      delete s.dim;
    } else if (c === 23) delete s.italic;
    else if (c === 24) delete s.underline;
    else if (c === 27) delete s.inverse;
    else if (c >= 30 && c <= 37) s.fg = c - 30;
    else if (c >= 90 && c <= 97) s.fg = c - 90 + 8;
    else if (c >= 40 && c <= 47) s.bg = c - 40;
    else if (c >= 100 && c <= 107) s.bg = c - 100 + 8;
    else if (c === 39) delete s.fg;
    else if (c === 49) delete s.bg;
    else if (c === 38 || c === 48) {
      let value: number | string | undefined;
      if (codes[i + 1] === 5 && codes[i + 2] !== undefined) {
        value = color256(Math.min(255, Math.max(0, codes[i + 2]!)));
        i += 2;
      } else if (codes[i + 1] === 2 && codes[i + 4] !== undefined) {
        const rgb = codes.slice(i + 2, i + 5).map((v) => Math.min(255, Math.max(0, v)));
        value = `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
        i += 4;
      }
      if (value !== undefined) {
        if (c === 38) s.fg = value;
        else s.bg = value;
      }
    }
  }
  return s;
}

const isPlain = (s: AnsiStyle): boolean =>
  s.fg === undefined &&
  s.bg === undefined &&
  !s.bold &&
  !s.dim &&
  !s.italic &&
  !s.underline &&
  !s.inverse;

/** Splits a line into text segments with their style; escape sequences are consumed. */
export function parseAnsi(text: string): AnsiSegment[] {
  if (!hasAnsi(text)) return text ? [{ text, style: null }] : [];
  const segments: AnsiSegment[] = [];
  let style: AnsiStyle = {};
  let pos = 0;
  const push = (part: string): void => {
    if (!part) return;
    const current = isPlain(style) ? null : { ...style };
    const last = segments[segments.length - 1];
    if (last && JSON.stringify(last.style) === JSON.stringify(current)) last.text += part;
    else segments.push({ text: part, style: current });
  };
  for (const m of text.matchAll(SEQUENCE)) {
    push(text.slice(pos, m.index));
    pos = m.index + m[0].length;
    if (m[2] === 'm') style = applySgr(style, m[1] ?? '');
  }
  push(text.slice(pos));
  return segments;
}
