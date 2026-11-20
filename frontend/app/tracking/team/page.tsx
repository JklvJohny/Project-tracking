'use client';
import { AlarmClock, CircleCheck, Search, TriangleAlert, Users, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useMe } from '../shared/api/queries';
import { Avatar } from '../shared/Avatar';
import { errorMessage } from '../shared/errors';
import { useLang, useT } from '../shared/i18n';
import { SkillBar } from './SkillBar';
import { SkillsEditor } from './SkillsEditor';
import { allSkills, matchesTeam, useSetSkills, useTeam, type Person, type TeamFilter } from './queries';

type Sort = 'name' | 'load';

const TEXT = {
  th: {
    title: 'ทีมงาน',
    lead: 'ทักษะและงานที่ค้างอยู่ของแต่ละคน ใช้เลือกคนให้เหมาะกับงาน',
    search: 'ค้นหาชื่อหรือทักษะ',
    clear: 'ล้างตัวกรอง',
    sort: 'เรียงตาม',
    sorts: { name: 'ชื่อ', load: 'งานค้างน้อยสุด' } as Record<Sort, string>,
    showing: (n: number, m: number) => `แสดง ${n} จาก ${m} คน`,
    people: 'สมาชิกในทีม',
    you: 'คุณ',
    open: (n: number) => `งานค้าง ${n}`,
    free: 'ไม่มีงานค้าง',
    overdue: (n: number) => `เลยกำหนด ${n}`,
    soon: (n: number) => `ครบกำหนดใน 7 วัน ${n}`,
    workload: 'ภาระงาน',
    skillList: (n: string) => `ทักษะของ ${n}`,
    noSkills: 'ยังไม่ได้ใส่ทักษะ',
    addSkills: 'เพิ่มทักษะ',
    filterBy: (s: string) => `กรองด้วย ${s}`,
    none: 'ไม่พบคนที่ตรงกับตัวกรอง',
    empty: 'ยังไม่มีสมาชิกในทีม',
    loading: 'กำลังโหลดทีมงาน',
    retry: 'ลองอีกครั้ง',
  },
  en: {
    title: 'Team',
    lead: "Each person's skills and open work, to pick who fits a task.",
    search: 'Search name or skill',
    clear: 'Clear filters',
    sort: 'Sort by',
    sorts: { name: 'Name', load: 'Least busy' } as Record<Sort, string>,
    showing: (n: number, m: number) => `Showing ${n} of ${m} ${m === 1 ? 'person' : 'people'}`,
    people: 'Team members',
    you: 'You',
    open: (n: number) => `${n} open`,
    free: 'Nothing open',
    overdue: (n: number) => `${n} overdue`,
    soon: (n: number) => `${n} due in 7 days`,
    workload: 'Workload',
    skillList: (n: string) => `${n}'s skills`,
    noSkills: 'No skills listed yet',
    addSkills: 'Add skills',
    filterBy: (s: string) => `Filter by ${s}`,
    none: 'Nobody matches these filters',
    empty: 'No team members yet',
    loading: 'Loading the team',
    retry: 'Retry',
  },
};

const chip = 'rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring';

function Workload({ p }: { p: Person }) {
  const t = useT(TEXT);
  if (p.open === 0)
    return (
      <p className="flex items-center gap-1 text-xs text-(--s-done)">
        <CircleCheck className="size-3.5" aria-hidden />
        {t.free}
      </p>
    );
  return (
    <ul aria-label={t.workload} className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
      <li className="font-medium text-foreground tabular-nums">{t.open(p.open)}</li>
      {p.overdue > 0 && (
        <li className="flex items-center gap-1 text-(--s-overdue) tabular-nums">
          <TriangleAlert className="size-3.5" aria-hidden />
          {t.overdue(p.overdue)}
        </li>
      )}
      {p.dueSoon > 0 && (
        <li className="flex items-center gap-1 tabular-nums">
          <AlarmClock className="size-3.5" aria-hidden />
          {t.soon(p.dueSoon)}
        </li>
      )}
    </ul>
  );
}

function PersonCard({
  p,
  me,
  chosen,
  suggestions,
  onToggleSkill,
}: {
  p: Person;
  me: boolean;
  chosen: string[];
  suggestions: string[];
  onToggleSkill: (s: string) => void;
}) {
  const t = useT(TEXT);
  const save = useSetSkills();
  const [editing, setEditing] = useState(false);
  const picked = new Set(chosen.map((s) => s.toLocaleLowerCase()));
  return (
    <li className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <Avatar user={{ id: p.userId, name: p.name, avatarUrl: p.avatarUrl }} size="lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-1 pt-0.5">
          <h2 className="flex min-w-0 items-center gap-1.5 font-semibold">
            <span className="truncate">{p.name}</span>
            {me && <span className="shrink-0 rounded-full bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">{t.you}</span>}
          </h2>
          <Workload p={p} />
        </div>
        <SkillsEditor
          name={p.name}
          skills={p.skills}
          suggestions={suggestions}
          open={editing}
          onOpenChange={setEditing}
          onSave={(skills) => {
            setEditing(false);
            save.mutate({ userId: p.userId, skills });
          }}
        />
      </div>
      {p.skills.length === 0 ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
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
        <ul aria-label={t.skillList(p.name)} className="flex flex-wrap gap-1.5">
          {p.skills.map((s) => {
            const on = picked.has(s.toLocaleLowerCase());
            return (
              <li key={s}>
                {/* A skill on a card is a shortcut to filter the team by it. */}
                <button
                  type="button"
                  aria-pressed={on}
                  title={t.filterBy(s)}
                  onClick={() => onToggleSkill(s)}
                  className={`${chip} ${on ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-accent'}`}
                >
                  {s}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

export default function TeamPage() {
  const t = useT(TEXT);
  const { lang } = useLang();
  const q = useTeam();
  const me = useMe();
  const [filter, setFilter] = useState<TeamFilter>({ q: '', skills: [] });
  const [sort, setSort] = useState<Sort>('name');
  const people = q.data?.people;
  const catalog = q.data?.catalog;
  const skills = useMemo(() => allSkills(people ?? [], catalog), [people, catalog]);
  const shown = useMemo(() => {
    const list = (people ?? []).filter((p) => matchesTeam(p, filter));
    // The server sends them by name; "least busy" puts the freest first, fewest overdue breaking ties.
    return sort === 'load' ? [...list].sort((a, b) => a.open - b.open || a.overdue - b.overdue) : list;
  }, [people, filter, sort]);
  const toggle = (s: string) =>
    setFilter((f) => {
      const k = s.toLocaleLowerCase();
      const has = f.skills.some((x) => x.toLocaleLowerCase() === k);
      return { ...f, skills: has ? f.skills.filter((x) => x.toLocaleLowerCase() !== k) : [...f.skills, s] };
    });
  const filtering = filter.q.trim() !== '' || filter.skills.length > 0;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6 sm:py-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.lead}</p>
      </div>

      {q.isPending ? (
        <div aria-busy="true" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <span role="status" className="sr-only">
            {t.loading}
          </span>
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="h-40 animate-pulse rounded-xl border bg-muted/40" />
          ))}
        </div>
      ) : q.isError ? (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border p-6">
          <p className="text-sm">{errorMessage(q.error, lang)}</p>
          <Button variant="outline" onClick={() => q.refetch()}>
            {t.retry}
          </Button>
        </div>
      ) : q.data.people.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed px-6 py-16 text-center">
          <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
            <Users className="size-6 text-muted-foreground" aria-hidden />
          </div>
          <p className="text-base font-semibold">{t.empty}</p>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3 rounded-xl border bg-card p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-52 flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  type="search"
                  aria-label={t.search}
                  placeholder={t.search}
                  value={filter.q}
                  onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))}
                  className="h-9 pl-8"
                />
              </div>
              <div className="flex items-center gap-2">
                <span id="team-sort" className="text-xs text-muted-foreground">
                  {t.sort}
                </span>
                <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
                  <SelectTrigger aria-labelledby="team-sort" className="h-9 w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['name', 'load'] as const).map((s) => (
                      <SelectItem key={s} value={s}>
                        {t.sorts[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <SkillBar skills={skills} categories={q.data.categories} chosen={filter.skills} people={q.data.people} onToggle={toggle} />
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span role="status">{t.showing(shown.length, q.data.people.length)}</span>
              {filtering && (
                <button
                  type="button"
                  onClick={() => setFilter({ q: '', skills: [] })}
                  className="inline-flex items-center gap-1 rounded font-medium text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <X className="size-3.5" aria-hidden />
                  {t.clear}
                </button>
              )}
            </div>
          </div>

          {shown.length === 0 ? (
            <p className="rounded-xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">{t.none}</p>
          ) : (
            <ul aria-label={t.people} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {shown.map((p) => (
                <PersonCard
                  key={p.userId}
                  p={p}
                  me={p.userId === me.data?.user.id}
                  chosen={filter.skills}
                  suggestions={skills.map((s) => s.name)}
                  onToggleSkill={toggle}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
