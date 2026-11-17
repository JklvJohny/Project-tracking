'use client';
import { useT } from './shared/i18n';

const TEXT = {
  th: { title: 'โปรเจกต์' },
  en: { title: 'Projects' },
};

// Placeholder until the projects page lands (Task 12).
export default function ProjectsPage() {
  const t = useT(TEXT);
  return <h1 className="p-4 text-base font-semibold">{t.title}</h1>;
}
