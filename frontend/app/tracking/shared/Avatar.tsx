'use client';
import { useEffect, useState } from 'react';
import { API_BASE, apiBlob } from './api/client';
// Colour comes from the --av-* tokens in tracking.css, indexed by user id so a person keeps one colour everywhere.
export const AVATAR_COLORS = 6;

export type AvatarUser = { id: number; name: string; avatarUrl?: string | null };
export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export const AVATAR_SIZE: Record<AvatarSize, string> = {
  xs: 'h-5 w-5 text-[9px]',
  sm: 'h-6 w-6 text-[10px]',
  md: 'h-8 w-8 text-[11px]',
  lg: 'h-12 w-12 text-base',
  xl: 'h-24 w-24 text-3xl',
};

export const avatarColorIndex = (id: number) => Math.abs(id) % AVATAR_COLORS;

// First letters of the first two words; Array.from keeps Thai/emoji code points whole.
export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => Array.from(w)[0] ?? '')
    .join('')
    .toUpperCase();
}

/**
 * Pictures uploaded in tracking are served behind auth, and an <img src> cannot send the dev shell's X-User-ID
 * header, so they are fetched with the api headers once per URL and shown from an object URL. The URL carries a
 * version, so a cached entry never goes stale; a failed fetch is forgotten so a later render can retry.
 */
const blobUrls = new Map<string, Promise<string>>();
// The newest URL seen for each picture (path without ?v=): when someone changes their photo, the old version's
// object URL is released instead of staying in memory until the page closes.
const latest = new Map<string, string>();

function trackingAvatar(url: string): Promise<string> {
  const path = url.split('?')[0];
  const prev = latest.get(path);
  if (prev && prev !== url) {
    blobUrls.get(prev)?.then(URL.revokeObjectURL, () => {});
    blobUrls.delete(prev);
  }
  latest.set(path, url);
  let p = blobUrls.get(url);
  if (!p) {
    p = apiBlob(url.slice(API_BASE.length)).then((b) => URL.createObjectURL(b));
    p.catch(() => blobUrls.delete(url));
    blobUrls.set(url, p);
  }
  return p;
}

/** The image to show for avatarUrl, or null for initials (none, still loading, or failed). */
function useAvatarSrc(url: string | null | undefined): [string | null, () => void] {
  const own = !!url && url.startsWith(`${API_BASE}/`);
  const [loaded, setLoaded] = useState<{ url: string; src: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!url || !own) return;
    let live = true;
    trackingAvatar(url).then(
      (src) => live && setLoaded({ url, src }),
      () => live && setFailed(url),
    );
    return () => {
      live = false;
    };
  }, [url, own]);
  const fail = () => url && setFailed(url);
  if (!url || failed === url) return [null, fail];
  if (!own) return [/^https?:\/\//.test(url) ? url : null, fail];
  return [loaded?.url === url ? loaded.src : null, fail];
}

export function Avatar({ user, size = 'sm' }: { user: AvatarUser; size?: AvatarSize }) {
  const [src, fail] = useAvatarSrc(user.avatarUrl);
  return (
    <span
      title={user.name}
      style={{ backgroundColor: `var(--av-${avatarColorIndex(user.id)})` }}
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white ring-2 ring-card ${AVATAR_SIZE[size]}`}
    >
      {/* Initials sit underneath until the picture loads, and stay if it cannot. */}
      <span aria-hidden="true">{initials(user.name)}</span>
      {src && (
        // next/image cannot take a blob: URL, and the server already sends a 256px JPEG.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" onError={fail} className="absolute inset-0 size-full object-cover" />
      )}
      <span className="sr-only">{user.name}</span>
    </span>
  );
}
