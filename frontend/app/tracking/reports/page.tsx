'use client';
import { FileText, Folder, FolderOpen, LayoutTemplate } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe, useProjects } from '../shared/api/queries';
import { boardAccess } from '../shared/access';
import { useConfirm } from '../shared/confirm';
import { errorMessage } from '../shared/errors';
import { useLang, useT } from '../shared/i18n';
import { DocViewer } from './DocViewer';
import { DocumentTable } from './DocumentTable';
import { FolderList } from './FolderList';
import { UploadZone } from './UploadZone';
import { useDeleteDocument, useDocuments } from './queries';
import { Templates } from './Templates';
import { routes } from '../shared/routes';

const TEXT = {
  th: {
    title: 'รายงาน',
    sections: 'ส่วนของหน้ารายงาน',
    projectReports: 'รายงานโปรเจกต์',
    templates: 'แม่แบบรายงาน',
    select: 'เลือกโปรเจกต์',
    selectHint: 'เลือกโปรเจกต์ทางซ้ายเพื่อดูเอกสาร',
    docs: (n: number) => `${n} เอกสาร`,
    empty: 'ยังไม่มีเอกสาร',
    emptyHint: 'อัปโหลดไฟล์ PDF เพื่อเริ่มต้น',
    emptyRo: 'โปรเจกต์นี้ยังไม่มีเอกสาร',
    retry: 'ลองอีกครั้ง',
    delTitle: 'ลบเอกสารนี้?',
    delDesc: (n: string) => `"${n}" จะถูกลบ แต่เลิกทำได้ภายหลัง`,
    del: 'ลบ',
  },
  en: {
    title: 'Reports',
    sections: 'Reports sections',
    projectReports: 'Project reports',
    templates: 'Report templates',
    select: 'Select a project',
    selectHint: 'Choose a project on the left to see its documents.',
    docs: (n: number) => `${n} document${n === 1 ? '' : 's'}`,
    empty: 'No documents yet',
    emptyHint: 'Upload a PDF to get started.',
    emptyRo: 'This project has no documents yet.',
    retry: 'Retry',
    delTitle: 'Delete this document?',
    delDesc: (n: string) => `"${n}" will be deleted. You can undo this afterwards.`,
    del: 'Delete',
  },
};

type Project = NonNullable<ReturnType<typeof useProjects>['data']>[number];

function FolderPanel({ project }: { project: Project }) {
  const { id: projectId, name } = project;
  const t = useT(TEXT);
  const { lang } = useLang();
  const confirm = useConfirm();
  const me = useMe();
  const docs = useDocuments(projectId);
  const access = boardAccess({ myRole: project.myRole, project });
  const del = useDeleteDocument(projectId);
  // The open document is tracked by id: a refetch that reorders the list must not switch the viewed file.
  const [openId, setOpenId] = useState<number | null>(null);

  const myId = me.data?.user.id;
  // Uploader (still an editor), PM or admin. Archived projects are read-only for everyone.
  const canDelete = (d: { uploadedBy: number }) => access.canManage || (access.canEdit && d.uploadedBy === myId);

  if (docs.isPending) return <Skeleton className="h-72 rounded-xl" />;
  if (docs.isError)
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border p-6">
        <p className="text-sm">{errorMessage(docs.error, lang)}</p>
        <Button variant="outline" onClick={() => docs.refetch()}>
          {t.retry}
        </Button>
      </div>
    );

  const list = docs.data;
  const openIndex = openId === null ? -1 : list.findIndex((d) => d.id === openId);
  const body =
    list.length === 0 ? (
      <div className="flex flex-col items-center px-6 py-14 text-center">
        <FileText className="mb-3 h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <p className="font-semibold">{t.empty}</p>
        <p className="mt-1 text-sm text-muted-foreground">{access.canEdit ? t.emptyHint : t.emptyRo}</p>
      </div>
    ) : (
      <DocumentTable
        docs={list}
        canDelete={canDelete}
        onOpen={(i) => setOpenId(list[i]?.id ?? null)}
        onDelete={async (d) => {
          if (await confirm({ title: t.delTitle, description: t.delDesc(d.filename), confirmLabel: t.del, destructive: true })) del.mutate(d);
        }}
      />
    );

  return (
    <section className="min-w-0 rounded-xl border bg-card shadow-sm">
      <div className="flex items-center gap-2 border-b p-3">
        <Folder className="h-4 w-4 text-primary" aria-hidden="true" />
        <h2 className="truncate text-sm font-semibold">{name}</h2>
        <span className="text-xs text-muted-foreground">{t.docs(list.length)}</span>
      </div>
      {access.canEdit ? <UploadZone projectId={projectId}>{body}</UploadZone> : body}
      {openIndex >= 0 && (
        <DocViewer docs={list} index={openIndex} onIndex={(i) => setOpenId(list[i]?.id ?? null)} onClose={() => setOpenId(null)} />
      )}
    </section>
  );
}

function ReportsView() {
  const t = useT(TEXT);
  const { lang } = useLang();
  const projects = useProjects();
  const params = useSearchParams();
  const raw = Number(params.get('project'));
  const onTemplates = params.get('tab') === 'templates';
  const list = projects.data ?? [];
  const cur = list.find((p) => p.id === raw);

  let panel;
  if (cur) panel = <FolderPanel key={cur.id} project={cur} />;
  else
    panel = (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-16 text-center">
        <Folder className="mb-3 h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <p className="font-semibold">{t.select}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t.selectHint}</p>
      </div>
    );

  return (
    <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-6">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
      </div>
      {/* Two sections of one page; the URL (?tab=templates) decides which shows. */}
      <nav aria-label={t.sections} className="mb-4 flex gap-1 border-b">
        {[
          { key: 'projects', href: routes.reports, label: t.projectReports, icon: FolderOpen, current: !onTemplates },
          { key: 'templates', href: `${routes.reports}?tab=templates`, label: t.templates, icon: LayoutTemplate, current: onTemplates },
        ].map(({ key, href, label, icon: Icon, current }) => (
          <Link
            key={key}
            href={href}
            scroll={false}
            aria-current={current ? 'page' : undefined}
            className={`-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              current ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </Link>
        ))}
      </nav>
      {onTemplates ? (
        <Templates />
      ) : projects.isError ? (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border p-6">
          <p className="text-sm">{errorMessage(projects.error, lang)}</p>
          <Button variant="outline" onClick={() => projects.refetch()}>
            {t.retry}
          </Button>
        </div>
      ) : projects.isPending ? (
        <Skeleton className="h-72 rounded-xl" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <FolderList projects={list} current={cur?.id ?? null} />
          {panel}
        </div>
      )}
    </div>
  );
}

// useSearchParams needs a Suspense boundary for static builds.
export default function ReportsPage() {
  return (
    <Suspense>
      <ReportsView />
    </Suspense>
  );
}
