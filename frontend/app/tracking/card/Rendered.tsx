'use client';
import { Children, type ComponentProps, type ElementType, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import { renderMentions } from './mentions';

type Users = Map<number, { name: string }>;

// Mentions are turned into chips on the text nodes react-markdown renders (never by rewriting the source
// first, which could break markdown syntax around a token). Code spans/blocks are left alone on purpose:
// a token inside code stays literal.
const TEXT_TAGS = ['p', 'li', 'strong', 'em', 'h1', 'h2', 'h3', 'blockquote', 'td', 'th'] as const;

function mapText(children: ReactNode, users: Users): ReactNode {
  return Children.map(children, (c) => (typeof c === 'string' ? renderMentions(c, users) : c));
}

// No rehype-raw: raw HTML in the source stays text. Links leave the app, so they never get the opener.
export function Rendered({ source, users }: { source: string; users?: Users }) {
  const components: Record<string, ElementType> = {
    a: ({ node, ...props }: ComponentProps<'a'> & { node?: unknown }) => {
      void node; // the hast node is not a DOM attribute
      return <a {...props} target="_blank" rel="noopener noreferrer" className="text-primary underline" />;
    },
  };
  if (users) {
    for (const tag of TEXT_TAGS) {
      components[tag] = ({ node, children, ...props }: { node?: unknown; children?: ReactNode }) => {
        void node;
        const Tag = tag as ElementType;
        return <Tag {...props}>{mapText(children, users)}</Tag>;
      };
    }
  }
  return (
    <div className="space-y-2 text-sm leading-relaxed break-words [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-2 [&_ul]:list-disc [&_ul]:pl-5">
      <Markdown components={components}>{source}</Markdown>
    </div>
  );
}
