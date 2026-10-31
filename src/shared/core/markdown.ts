// A small Markdown reader for release notes: headings, bullet lists and
// paragraphs with bold, italic, code and links. The result is plain data that
// the interface renders as elements – never as HTML – so text from the
// internet cannot inject anything.

export type Inline =
  | { kind: 'text' | 'bold' | 'italic' | 'code'; text: string }
  | { kind: 'link'; text: string; url: string };

export type Block =
  | { kind: 'heading'; level: number; content: Inline[] }
  | { kind: 'list'; items: Inline[][] }
  | { kind: 'paragraph'; content: Inline[] };

const INLINE = /`([^`]+)`|\*\*([^*]+)\*\*|(?<![\w])_([^_]+)_(?![\w])|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of source.matchAll(INLINE)) {
    if (m.index > last) out.push({ kind: 'text', text: source.slice(last, m.index) });
    const [, code, bold, italic, linkText, url] = m;
    if (code !== undefined) out.push({ kind: 'code', text: code });
    else if (bold !== undefined) out.push({ kind: 'bold', text: bold });
    else if (italic !== undefined) out.push({ kind: 'italic', text: italic });
    else out.push({ kind: 'link', text: linkText ?? '', url: url ?? '' });
    last = m.index + m[0].length;
  }
  if (last < source.length) out.push({ kind: 'text', text: source.slice(last) });
  return out;
}

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let items: string[] | null = null;

  const flush = (): void => {
    if (paragraph.length)
      blocks.push({ kind: 'paragraph', content: parseInline(paragraph.join(' ')) });
    if (items) blocks.push({ kind: 'list', items: items.map(parseInline) });
    paragraph = [];
    items = null;
  };

  for (const raw of source.replace(/\r\n/g, '\n').split('\n')) {
    // Block quotes and GitHub alerts ("> [!NOTE]") are shown as plain text.
    const line = raw.replace(/^>\s?/, '').replace(/^\[![A-Z]+\]\s*$/, '');
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const item = /^\s*[-*]\s+(.*)$/.exec(line);
    if (!line.trim()) {
      flush();
    } else if (heading) {
      flush();
      blocks.push({
        kind: 'heading',
        level: heading[1]?.length ?? 1,
        content: parseInline(heading[2] ?? ''),
      });
    } else if (item) {
      if (paragraph.length) flush();
      items ??= [];
      items.push(item[1] ?? '');
    } else if (items && /^\s{2,}\S/.test(line)) {
      // Continuation of the previous list item.
      items[items.length - 1] += ` ${line.trim()}`;
    } else {
      if (items) flush();
      paragraph.push(line.trim());
    }
  }
  flush();
  return blocks;
}
