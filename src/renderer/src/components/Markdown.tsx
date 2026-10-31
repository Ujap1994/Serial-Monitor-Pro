// Renders Markdown (release notes) as elements – never as HTML.

import { Fragment, type ReactNode } from 'react';
import { parseMarkdown, type Inline } from '@shared/core/markdown';

function renderInline(parts: Inline[]): ReactNode {
  return parts.map((part, i) => {
    switch (part.kind) {
      case 'bold':
        return <b key={i}>{part.text}</b>;
      case 'italic':
        return <i key={i}>{part.text}</i>;
      case 'code':
        return <code key={i}>{part.text}</code>;
      case 'link':
        return part.url.startsWith('https://') ? (
          <a
            key={i}
            href={part.url}
            onClick={(e) => {
              e.preventDefault();
              void window.smp.app.openExternal(part.url);
            }}
          >
            {part.text}
          </a>
        ) : (
          <Fragment key={i}>{part.text}</Fragment>
        );
      case 'text':
        return <Fragment key={i}>{part.text}</Fragment>;
    }
  });
}

export function Markdown({ source }: { source: string }): ReactNode {
  return (
    <div className="markdown">
      {parseMarkdown(source).map((block, i) => {
        if (block.kind === 'heading') return <h5 key={i}>{renderInline(block.content)}</h5>;
        if (block.kind === 'list') {
          return (
            <ul key={i}>
              {block.items.map((item, j) => (
                <li key={j}>{renderInline(item)}</li>
              ))}
            </ul>
          );
        }
        return <p key={i}>{renderInline(block.content)}</p>;
      })}
    </div>
  );
}
