'use client';
import { useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useT } from '../shared/i18n';
import { SaveStatus, useInlineSave } from './inline';
import { useUpdateCard } from './mutations';

const TEXT = {
  th: { label: 'รายละเอียด', edit: 'แก้ไข', preview: 'ตัวอย่าง', empty: 'ยังไม่มีรายละเอียด', hint: 'รองรับ Markdown' },
  en: { label: 'Description', edit: 'Edit', preview: 'Preview', empty: 'No description yet', hint: 'Markdown supported' },
};

// No rehype-raw: raw HTML in the source stays text. Links leave the app, so they never get the opener.
function Rendered({ source }: { source: string }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed break-words [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-2 [&_ul]:list-disc [&_ul]:pl-5">
      <Markdown
        components={{
          a: ({ node, ...props }) => {
            void node; // the hast node is not a DOM attribute
            return <a {...props} target="_blank" rel="noopener noreferrer" className="text-primary underline" />;
          },
        }}
      >
        {source}
      </Markdown>
    </div>
  );
}

export function DescriptionField({
  projectId,
  cardId,
  value,
  readOnly,
}: {
  projectId: number;
  cardId: number;
  value: string;
  readOnly: boolean;
}) {
  const t = useT(TEXT);
  const update = useUpdateCard(projectId, cardId);
  const { state, save } = useInlineSave(update.mutateAsync);
  const [draft, setDraft] = useState(value);
  const [mode, setMode] = useState<'edit' | 'preview'>(value ? 'preview' : 'edit');
  const settled = useRef(false);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
  }

  if (readOnly) return value ? <Rendered source={value} /> : <p className="text-sm text-muted-foreground">{t.empty}</p>;

  function commit(raw: string) {
    if (settled.current) return;
    settled.current = true;
    if (raw !== value) void save({ descriptionMd: raw });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          size="xs"
          variant={mode === 'edit' ? 'secondary' : 'ghost'}
          aria-pressed={mode === 'edit'}
          onClick={() => setMode('edit')}
        >
          {t.edit}
        </Button>
        <Button
          type="button"
          size="xs"
          variant={mode === 'preview' ? 'secondary' : 'ghost'}
          aria-pressed={mode === 'preview'}
          onClick={() => setMode('preview')}
        >
          {t.preview}
        </Button>
        <span className="ml-auto" />
        <SaveStatus state={state} />
      </div>
      {mode === 'edit' ? (
        <Textarea
          value={draft}
          rows={6}
          maxLength={20000}
          aria-label={t.label}
          placeholder={t.hint}
          onFocus={() => (settled.current = false)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => {
            // Enter is a newline here; Ctrl/Cmd+Enter saves and keeps focus.
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
              commit(e.currentTarget.value);
              settled.current = false;
            }
          }}
        />
      ) : draft ? (
        <Rendered source={draft} />
      ) : (
        <p className="text-sm text-muted-foreground">{t.empty}</p>
      )}
    </div>
  );
}
