'use client';
import { Children, useMemo, type ComponentProps, type ElementType, type ReactNode } from 'react';
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

// Links leave the app, so they never get the opener.
function Link({ node, ...props }: ComponentProps<'a'> & { node?: unknown }) {
  void node; // the hast node is not a DOM attribute
  return <a {...props} target="_blank" rel="noopener noreferrer" className="text-primary underline" />;
}

// An image would load from any URL the author wrote (a tracking pixel reports who read the card), so it is
// never fetched: it renders as a link to the URL, labelled with its alt text.
function Img({ src, alt }: ComponentProps<'img'> & { node?: unknown }) {
  const href = typeof src === 'string' ? src : undefined;
  return <Link href={href}>{alt || href}</Link>;
}

/** Built once per users map: a new components object every render would remount every p/li (losing selection). */
function makeComponents(users?: Users): Record<string, ElementType> {
  const components: Record<string, ElementType> = { a: Link, img: Img };
  if (users) {
    for (const tag of TEXT_TAGS) {
      components[tag] = ({ node, children, ...props }: { node?: unknown; children?: ReactNode }) => {
        void node;
        const Tag = tag as ElementType;
        return <Tag {...props}>{mapText(children, users)}</Tag>;
      };
    }
  }
  return components;
}

const PLAIN = makeComponents();

// No rehype-raw: raw HTML in the source stays text.
export function Rendered({ source, users }: { source: string; users?: Users }) {
  const components = useMemo(() => (users ? makeComponents(users) : PLAIN), [users]);
  return (
    <div className="space-y-2 text-sm leading-relaxed break-words [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-2 [&_ul]:list-disc [&_ul]:pl-5">
      <Markdown components={components}>{source}</Markdown>
    </div>
  );
}
