'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera, ListChecks, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { Suspense, useId, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api, API_BASE, ApiError } from '../shared/api/client';
import { useMe, useMyTasks, useProjects } from '../shared/api/queries';
import type { components } from '../shared/api/schema';
import { Avatar } from '../shared/Avatar';
import { useConfirm } from '../shared/confirm';
import { errorMessage } from '../shared/errors';
import { useLang, useT } from '../shared/i18n';
import { routes } from '../shared/routes';
import { SkillsEditor } from '../team/SkillsEditor';
import { allSkills, useSetSkills, useTeam } from '../team/queries';
import { SkillsByCategory, TaskCalendar, WorkloadStats } from '../people/parts';

type S = components['schemas'];

const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const TEXT = {
  th: {
    title: 'โปรไฟล์',
    change: 'เปลี่ยนรูป',
    remove: 'ลบรูป',
    photoHint: 'JPG, PNG หรือ WebP ไม่เกิน 5 MB ระบบจะครอปเป็นสี่เหลี่ยมจัตุรัสตรงกลาง',
    photoLabel: 'รูปโปรไฟล์ใหม่',
    changed: 'เปลี่ยนรูปโปรไฟล์แล้ว',
    removed: 'ลบรูปโปรไฟล์แล้ว',
    confirmTitle: 'ลบรูปโปรไฟล์?',
    confirmBody: 'ทุกหน้าจะกลับไปแสดงรูปจากระบบหลัก หรือตัวย่อชื่อถ้าไม่มีรูป',
    errors: {
      unsupported_type: 'ใช้ได้เฉพาะไฟล์ JPG, PNG หรือ WebP',
      too_large: 'ไฟล์ใหญ่เกิน 5 MB หรือรูปใหญ่เกินไป',
      required: 'กรุณาเลือกไฟล์รูป',
    } as Record<string, string>,
    workload: 'งานของฉันตอนนี้',
    allTasks: 'ดูงานทั้งหมด',
    skills: 'ทักษะ',
    skillsHint: 'แก้ที่นี่แล้วหน้าทีมงานจะเปลี่ยนตาม',
    noSkills: 'ยังไม่ได้ใส่ทักษะ',
    addSkills: 'เพิ่มทักษะ',
    calendar: 'ตารางงานของฉัน',
    calendarHint: 'งานที่ยังไม่เสร็จซึ่งมอบหมายให้คุณ ทุกโปรเจกต์',
    retry: 'ลองอีกครั้ง',
  },
  en: {
    title: 'Profile',
    change: 'Change photo',
    remove: 'Remove photo',
    photoHint: 'JPG, PNG or WebP up to 5 MB. It is cropped to a centred square.',
    photoLabel: 'New profile photo',
    changed: 'Profile photo changed',
    removed: 'Profile photo removed',
    confirmTitle: 'Remove your profile photo?',
    confirmBody: 'Every page goes back to the picture from the main system, or your initials if there is none.',
    errors: {
      unsupported_type: 'Only JPG, PNG or WebP files',
      too_large: 'The file is over 5 MB or the picture is too big',
      required: 'Choose an image file',
    } as Record<string, string>,
    workload: 'My work right now',
    allTasks: 'See all my tasks',
    skills: 'Skills',
    skillsHint: 'Changes here show on the Team page too.',
    noSkills: 'No skills listed yet',
    addSkills: 'Add skills',
    calendar: 'My schedule',
    calendarHint: 'Open cards assigned to you, across every project.',
    retry: 'Retry',
  },
};

/** A tracking-uploaded picture (as opposed to one from user-service, or none): only that one can be removed here. */
const isOwnPhoto = (url: string | null | undefined) => !!url && url.startsWith(`${API_BASE}/users/`);

function usePhoto() {
  const qc = useQueryClient();
  // The new URL appears in every list that shows people (team, boards, members...): refetch what is on screen.
  const refresh = () => qc.invalidateQueries();
  const upload = useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.append('file', file);
      return api<{ avatarUrl: string }>('/me/avatar', { method: 'PUT', body });
    },
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: () => api<{ avatarUrl: string }>('/me/avatar', { method: 'DELETE' }),
    onSuccess: refresh,
  });
  return { upload, remove };
}

function PhotoCard({ user }: { user: S['User'] }) {
  const t = useT(TEXT);
  const { lang } = useLang();
  const confirm = useConfirm();
  const { upload, remove } = usePhoto();
  const input = useRef<HTMLInputElement>(null);
  // The code or the error itself, never its text: the message is resolved at render so it follows a language switch.
  const [error, setError] = useState<{ code?: string; err?: unknown } | null>(null);
  const message = error && (error.code && t.errors[error.code] ? t.errors[error.code] : errorMessage(error.err, lang));
  const ids = useId();

  const pick = (file: File | undefined) => {
    if (!file) return;
    // Mirrors the server (internal/profile); it checks again, and also the pixel count.
    if (!TYPES.includes(file.type)) return setError({ code: 'unsupported_type' });
    if (file.size > MAX_BYTES) return setError({ code: 'too_large' });
    setError(null);
    upload.mutate(file, {
      onSuccess: () => toast.success(t.changed),
      onError: (e) => setError({ code: e instanceof ApiError ? e.fields?.file : undefined, err: e }),
    });
  };
  const onRemove = async () => {
    if (!(await confirm({ title: t.confirmTitle, description: t.confirmBody, confirmLabel: t.remove, destructive: true }))) return;
    remove.mutate(undefined, {
      onSuccess: () => toast.success(t.removed),
      onError: (e) => toast.error(errorMessage(e, lang)),
    });
  };

  return (
    <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:items-center sm:text-left">
      <div className="relative">
        <Avatar user={user} size="xl" />
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={upload.isPending}
          aria-label={t.change}
          title={t.change}
          className="absolute right-0 bottom-0 inline-flex size-8 items-center justify-center rounded-full border bg-background text-foreground shadow-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60"
        >
          <Camera className="size-4" aria-hidden />
        </button>
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{user.name}</h1>
        <div className="flex flex-wrap justify-center gap-2 sm:justify-start">
          <Button variant="outline" size="sm" onClick={() => input.current?.click()} disabled={upload.isPending}>
            <Camera aria-hidden />
            {t.change}
          </Button>
          {isOwnPhoto(user.avatarUrl) && (
            <Button variant="ghost" size="sm" onClick={onRemove} disabled={remove.isPending}>
              <Trash2 aria-hidden />
              {t.remove}
            </Button>
          )}
        </div>
        <input
          ref={input}
          id={`${ids}-file`}
          type="file"
          accept={TYPES.join(',')}
          aria-label={t.photoLabel}
          aria-describedby={`${ids}-hint${error ? ` ${ids}-err` : ''}`}
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            pick(e.target.files?.[0]);
            // The same file can be picked again after an error.
            e.target.value = '';
          }}
        />
        <p id={`${ids}-hint`} className="text-xs text-muted-foreground">
          {t.photoHint}
        </p>
        {error && (
          <p id={`${ids}-err`} role="alert" className="text-xs text-destructive">
            {message}
          </p>
        )}
      </div>
    </div>
  );
}

function SkillsCard({ userId, name }: { userId: number; name: string }) {
  const t = useT(TEXT);
  const team = useTeam();
  const save = useSetSkills();
  const [editing, setEditing] = useState(false);
  const me = team.data?.people.find((p) => p.userId === userId);
  const skills = useMemo(() => (team.data ? allSkills(team.data.people, team.data.catalog) : []), [team.data]);

  return (
    <section aria-labelledby="profile-skills" className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 id="profile-skills" className="font-semibold">
            {t.skills}
          </h2>
          <p className="text-xs text-muted-foreground">{t.skillsHint}</p>
        </div>
        {me && (
          <SkillsEditor
            name={name}
            skills={me.skills}
            suggestions={skills.map((s) => s.name)}
            open={editing}
            onOpenChange={setEditing}
            onSave={(next) => {
              setEditing(false);
              save.mutate({ userId, skills: next });
            }}
          />
        )}
      </div>
      {!me ? (
        <Skeleton className="h-16 w-full" />
      ) : me.skills.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {t.noSkills}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            {t.addSkills}
          </button>
        </div>
      ) : (
        <SkillsByCategory skills={me.skills} />
      )}
    </section>
  );
}

function ScheduleCard() {
  const t = useT(TEXT);
  const { lang } = useLang();
  const q = useMyTasks();
  const projects = useProjects();
  const visible = useMemo(() => new Set(projects.data?.map((p) => p.id) ?? []), [projects.data]);

  return (
    <section aria-labelledby="profile-calendar" className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div>
        <h2 id="profile-calendar" className="font-semibold">
          {t.calendar}
        </h2>
        <p className="text-xs text-muted-foreground">{t.calendarHint}</p>
      </div>
      {q.isError ? (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="text-sm">{errorMessage(q.error, lang)}</p>
          <Button variant="outline" onClick={() => q.refetch()}>
            {t.retry}
          </Button>
        </div>
      ) : (
        <TaskCalendar tasks={q.data?.tasks} canOpen={(id) => visible.has(id)} here={routes.profile} />
      )}
    </section>
  );
}

function Profile() {
  const t = useT(TEXT);
  const { lang } = useLang();
  const me = useMe();
  const team = useTeam();
  const user = me.data?.user;
  const mine = user ? team.data?.people.find((p) => p.userId === user.id) : undefined;

  if (me.isError)
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border p-6">
        <p className="text-sm">{errorMessage(me.error, lang)}</p>
        <Button variant="outline" onClick={() => me.refetch()}>
          {t.retry}
        </Button>
      </div>
    );
  return (
    <>
      <section aria-label={t.title} className="flex flex-col gap-4 rounded-xl border bg-card p-4 lg:flex-row lg:items-center">
        <div className="lg:flex-1">{user ? <PhotoCard user={user} /> : <Skeleton className="h-24 w-72" />}</div>
        <div className="flex flex-col gap-2 lg:w-[30rem]">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">{t.workload}</h2>
            <Link href={routes.myTasks} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              <ListChecks className="size-3.5" aria-hidden />
              {t.allTasks}
            </Link>
          </div>
          <WorkloadStats load={team.data ? (mine ?? { open: 0, overdue: 0, dueSoon: 0 }) : undefined} />
        </div>
      </section>
      {user && <SkillsCard userId={user.id} name={user.name} />}
      <ScheduleCard />
    </>
  );
}

/** The signed-in user's own page: photo, open work, skills (shared with the Team page) and a month of their tasks. */
export default function ProfilePage() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-5 sm:px-6 sm:py-6">
      {/* useSearchParams (the calendar month) needs a Suspense boundary for static builds. */}
      <Suspense>
        <Profile />
      </Suspense>
    </div>
  );
}
