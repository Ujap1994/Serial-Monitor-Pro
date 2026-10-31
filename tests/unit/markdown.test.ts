import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown } from '@shared/core/markdown';

describe('parseInline', () => {
  it('recognises code, bold, italic and links', () => {
    expect(parseInline('a `x` **b** _c_ [d](https://e.invalid/f) g')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'code', text: 'x' },
      { kind: 'text', text: ' ' },
      { kind: 'bold', text: 'b' },
      { kind: 'text', text: ' ' },
      { kind: 'italic', text: 'c' },
      { kind: 'text', text: ' ' },
      { kind: 'link', text: 'd', url: 'https://e.invalid/f' },
      { kind: 'text', text: ' g' },
    ]);
  });

  it('does not take underscores inside words for italics', () => {
    expect(parseInline('SMP_HW_PORT and snake_case')).toEqual([
      { kind: 'text', text: 'SMP_HW_PORT and snake_case' },
    ]);
  });

  it('keeps markup characters as text – nothing is interpreted as HTML', () => {
    expect(parseInline('<img src=x onerror=alert(1)>')).toEqual([
      { kind: 'text', text: '<img src=x onerror=alert(1)>' },
    ]);
  });
});

describe('parseMarkdown', () => {
  it('reads the structure of release notes', () => {
    const notes = [
      '### Fixed',
      '',
      '- **Automation**: an answer was missed',
      '  and the sequence ended.',
      '- Second item',
      '',
      'A paragraph',
      'over two lines.',
      '',
      '> [!NOTE]',
      '> A hint.',
    ].join('\n');
    expect(parseMarkdown(notes)).toEqual([
      { kind: 'heading', level: 3, content: [{ kind: 'text', text: 'Fixed' }] },
      {
        kind: 'list',
        items: [
          [
            { kind: 'bold', text: 'Automation' },
            { kind: 'text', text: ': an answer was missed and the sequence ended.' },
          ],
          [{ kind: 'text', text: 'Second item' }],
        ],
      },
      { kind: 'paragraph', content: [{ kind: 'text', text: 'A paragraph over two lines.' }] },
      { kind: 'paragraph', content: [{ kind: 'text', text: 'A hint.' }] },
    ]);
  });

  it('copes with empty input', () => {
    expect(parseMarkdown('')).toEqual([]);
  });
});
