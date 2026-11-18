# Host integration: adding Project Tracking to the existing system

This page is for the developer who moves the tracking frontend into the existing Next.js host app. The tracking
service itself (Go + PostgreSQL) runs next to the host and is reached through a same-origin rewrite.

Everything the host needs lives in `frontend/app/tracking/**` plus a few shadcn parts. The `frontend/` project
around it is a local harness (dev shell, user switcher, boilerplate) and is not copied.

## 1. Folders to copy

| From `frontend/` | To the host | Notes |
|---|---|---|
| `app/tracking/` (all of it) | `app/tracking/` | Pages, board, card panel, projects, `shared/`, `tracking.css`. Tests (`*.test.ts(x)`) can come along. |
| `components/ui/` (only the parts below) | `components/ui/` | Copy these versions; never keep the host's file just because the name matches (see below). |

shadcn parts the tracking code imports: `alert-dialog`, `avatar`, `button`, `checkbox`, `command`, `dialog`,
`dropdown-menu`, `input`, `input-group`, `popover`, `select`, `sheet`, `skeleton`, `sonner`, `textarea`, `tooltip`.
`input-group` is not imported by tracking directly: `command.tsx` imports it (and it imports `button`, `input` and
`textarea`), so it must come along. `components/ui/sonner.tsx` imports `next-themes`; it only reads the theme, the host
does not need a `ThemeProvider` for tracking (the tracking provider sets the `dark` class itself, see section 5).

They are the shadcn `radix-nova` style, and tracking uses APIs that only that style has. A host file with the same
name but another style compiles or renders wrong, so **do not skip a file because the host already has one**. For
each part, either diff the host's file against `frontend/components/ui/<part>.tsx` and confirm every API below is
there, or vendor the tracking versions (for example as `components/ui/tracking/*` with the imports adjusted) so the
host's own parts stay untouched.

Required component APIs (check each one in the host's file before keeping it):

| Part | API tracking relies on |
|---|---|
| `button` | `size` values `xs`, `sm`, `icon-xs`, `icon-sm` (plus `default`); `variant` values `outline`, `ghost`, `destructive`; `asChild`. |
| `sheet` | `SheetContent` prop `showCloseButton` (tracking passes `false` and draws its own close button); `side` default `right` with `data-[side=right]` classes; `SheetClose asChild`. |
| `dialog` | `DialogContent` draws its own close button (`showCloseButton` defaults to `true`); `DialogFooter`. |
| `dropdown-menu` | `DropdownMenuItem` prop `variant="destructive"`. |
| `alert-dialog` | `AlertDialogAction` / `AlertDialogCancel` render buttons; `AlertDialogContent` with the default `size`. |
| `command` | `CommandInput`, `CommandList`, `CommandEmpty`, `CommandGroup`, `CommandItem` (cmdk 1.x) and its `input-group` import. |
| `select` | `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem` (Radix Select). |
| `avatar` | `Avatar`, `AvatarImage`, `AvatarFallback`. |
| `popover`, `tooltip`, `checkbox`, `skeleton`, `input`, `textarea` | The standard shadcn exports; animations use the `data-open:` / `data-closed:` variants from `shadcn/tailwind.css` (section 4). |

The match-prototype work added files only under `app/tracking/`, so the copy above already includes them:
`reports/` (the Reports page: folder list, document table, PDF viewer, upload zone, queries), `board/timeline/`
(Timeline), `board/Splitter.tsx`, `board/BoardSection.tsx`, `board/BoardFilters.tsx`, `board/AssignPopover.tsx`,
`card/StatusField.tsx`, and `shared/Avatar.tsx`, `AvatarStack.tsx`, `StatusPill.tsx`, `TrackingTabs.tsx`. It added no
npm dependency and no shadcn part: the list above is unchanged. `tracking.css` gained colour tokens (light and dark)
for the status pills, avatars and Timeline bars, so copy that file too.

After the copy, open a board and a card panel in both themes as a final visual check; it does not replace the API
check above.

`lib/utils.ts` (`cn`) is the shadcn helper and the host almost certainly has it.

## 2. npm dependencies

Versions the harness was built and tested with. Use the same majors in the host.

| Package | Version | Why |
|---|---|---|
| `next` | 16.4.6 | App Router. Tracking pages are `'use client'` and read params with `useParams()` / `useSearchParams()`, so they also work on an older host Next. |
| `react`, `react-dom` | 19.3.0 | |
| `@tanstack/react-query` | ^5.107.1 | All server data and optimistic updates. |
| `@dnd-kit/core` | ^6.3.1 | Drag and drop (cards, lists). |
| `@dnd-kit/sortable` | ^10.0.0 | |
| `@dnd-kit/utilities` | ^3.2.2 | |
| `react-markdown` | ^10.1.0 | Description and comments. |
| `radix-ui` | ^1.8.1 | shadcn primitives. |
| `cmdk` | ^1.1.1 | Assignee and member pickers (`command`). |
| `sonner` | ^2.0.8 | Toasts. |
| `lucide-react` | ^1.74.0 | Icons. |
| `class-variance-authority` | ^0.7.1 | shadcn variants. |
| `next-themes` | ^0.4.6 | Imported by `components/ui/sonner.tsx`. |
| `cn` | ^0.5.2 | `lib/utils.ts`. |
| `tw-animate-css` | ^1.4.0 | Dialog and sheet animations; imported from the host's global CSS (section 4). |
| `shadcn` | ^4.23.0 | Its `shadcn/tailwind.css` provides the data-state variants the sheet, dialog and select animations use; imported from the host's global CSS (section 4). |
| `tailwindcss` | 4.3.3 | The host must be on Tailwind 4: the components use v4 syntax such as `max-sm:hidden` and `text-(--s-done)`. |

No package was added for Reports or Timeline. The PDF viewer is a plain `<iframe>` and the upload is `fetch` with
`FormData`.

Dev only: `openapi-typescript` (`npm run gen:api` regenerates `app/tracking/shared/api/schema.d.ts` from
`backend/api/openapi.yaml`; the generated file is committed, so the host does not need it to build).

## 3. The rewrite

The client always calls `/api/tracking/v1/...` on its own origin (`API_BASE` in `shared/api/client.ts`). Add a rewrite
to the host's `next.config`, pointing at the tracking service:

```ts
async rewrites() {
  return [
    {
      source: '/api/tracking/:path*',
      destination: `${process.env.TRACKING_API_URL}/api/tracking/:path*`,
    },
  ];
},
```

`TRACKING_API_URL` is the service base, for example `http://tracking-service:8081`. No CORS setup is needed.
The service authenticates with whatever the host sends, see `getAuthHeaders` below. If the host already proxies
`/api/*` in a different way (reverse proxy, gateway), route `/api/tracking/` to the tracking service there instead.

Reports files. The Reports page lists and uploads PDFs through `/api/tracking/v1/projects/{id}/documents` and
`/api/tracking/v1/documents/{id}` (file, delete, restore), all behind the same rewrite. The tracking service
stores the bytes under its `UPLOAD_DIR` environment variable (default `./uploads`, relative to the service's working
directory; in a container mount a persistent volume there, because the file store is local disk and metadata lives in
the database). Uploads are PDF only and at most 20 MB. If the host's gateway or reverse proxy caps request bodies,
raise the cap to at least 21 MiB for `/api/tracking/` (nginx: `client_max_body_size 21m;`). A lower cap
surfaces as an HTTP 413 from the proxy, not the service's `too_large` message.

PDF viewer note. The viewer does not point the iframe at the file URL. `getAuthHeaders` cannot be applied to an
`<iframe src>` or an `<a download>`, so the viewer fetches the file with the same headers (`apiBlob`), turns the bytes
into an object URL (`URL.createObjectURL`) and gives that to the iframe; the URL is revoked when the viewer changes
file or closes. This works with any host auth. If the host sets a `Content-Security-Policy`, it must allow `blob:` in
`frame-src` (and must not send `X-Frame-Options: DENY` for `blob:` documents, which it does not by default).

## 4. The CSS import

Two parts.

**Host global CSS.** The host's global stylesheet (the file that has `@import "tailwindcss";`) must also carry:

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

@custom-variant dark (&:is(.dark *));
```

Without `tw-animate-css` and `shadcn/tailwind.css` the dialogs, sheets, selects and popovers lose their open and
close animations and state variants. The `@custom-variant dark` line must match how the host marks dark mode
(`.dark` on `<html>`). A host created with the shadcn CLI usually has all of this already: check, do not duplicate.

**Tracking's own CSS.** `app/tracking/layout.tsx` imports `./tracking.css`, so nothing more is needed when the
tracking folder is mounted as a route segment. If the host mounts the pages another way, import
`app/tracking/tracking.css` once from whatever layout wraps them. It holds only the series colours (`--s-*`,
`--p-*`, `--pb-*`), the 13px type scale of `.tracking-root`, the drag styles and the `.card-row`
`content-visibility` rule. All surface colours (`background`, `border`, `primary`, `muted`...) come from the host's
shadcn theme, so tracking follows the host's light and dark themes.

## 5. TrackingProvider props

`app/tracking/layout.tsx` wraps the pages in `TrackingProvider` (from `shared/provider.tsx`). It provides the language
and theme context, the React Query client, the tooltip provider, the confirm dialog and the toaster. Pass the host's
state in through props instead of letting it use its own store:

```tsx
import { TrackingProvider } from './shared/provider';

<TrackingProvider
  lang={hostLang}                       // 'th' | 'en'
  theme={hostTheme}                     // 'light' | 'dark' | 'system'
  getAuthHeaders={() => ({ Authorization: `Bearer ${token}` })}
>
  {children}
</TrackingProvider>
```

| Prop | Type | Behaviour |
|---|---|---|
| `lang` | `'th' \| 'en'` | Controlled language. Omit it and the provider keeps its own value in `localStorage` key `pt-lang` (default `th`). Every user-facing string is looked up from it; user content is never translated. |
| `theme` | `'light' \| 'dark' \| 'system'` | Controlled theme. Omit it and the provider uses `localStorage` key `pt-theme` (default `system`). The provider toggles the `dark` class on `<html>` and sets `<html lang>`. If the host already does both, pass its value and the result is the same. |
| `getAuthHeaders` | `() => Record<string,string> \| Promise<Record<string,string>>` | Called before every request; its headers are merged into the request. This is where the host's auth goes. The local harness uses it to send `X-User-ID`; production sends the real credentials and the service validates them with the production authenticator. |

A `TrackingProvider` nested inside another one is a no-op, so the host can mount one high up (for example around its
whole shell, to put the language switch in its header using `useLang()` / `useTheme()`) and the layout's own one does
nothing.

## 6. Sidebar entry

Page URLs are defined once in `app/tracking/shared/routes.ts`:

```ts
const BASE = '/tracking';
export const routes = {
  projects: BASE,                                       // projects list
  reports: `${BASE}/reports`,                           // Reports page (?project=<id> opens a folder)
  board: (projectId) => `${BASE}/${projectId}`,         // board
  card: (projectId, cardId) => `${BASE}/${projectId}?card=${cardId}`, // board with the card panel open
};
```

Add one sidebar item whose `href` is `routes.projects` (label "Projects" / "โปรเจกต์"). The tracking pages carry their
own tab bar (Projects, Reports) from `shared/TrackingTabs.tsx`, so the Reports route needs no second sidebar entry;
add one with `href: routes.reports` only if the host wants a direct link. The board and card links inside
the tracking pages are built from the same file, so changing `BASE` there moves the whole feature to another mount
point (and the route folder `app/tracking/` must move with it). Navigation inside tracking uses `<Link>`, never
`router.push`.

## 7. What not to copy

- `app/(dev)/` (`DevShell.tsx`): the stand-in sidebar, header, language and theme selects and the dev user switcher.
- `app/layout.tsx`: the harness root layout (Noto Sans Thai font, `DevShell`). The host keeps its own root layout.
- `app/page.tsx` (redirect to `/tracking`), `app/globals.css`, `app/favicon.ico`.
- The dev user switcher only renders when `NEXT_PUBLIC_ENV=local`; the host never sets that variable, and the
  `X-User-ID` header is not accepted by a production backend build (`-tags local` only).
- `next.config.ts` of the harness (the host merges only the rewrite from section 3), `vitest.config.mts`,
  `eslint.config.mjs`, `components.json`, `AGENTS.md`, `app/globals.css` (merge only the imports from section 4).

## 8. Checks in the host

1. `npx tsc --noEmit` and the copied vitest suites pass.
2. `/tracking` lists projects for a manager, `/tracking/<id>` shows the board.
3. Switch the host language and theme and confirm both flow through the provider props.
4. Drag a card, open it (`?card=<id>`), comment with `@name`. The tracking service logs
   `tracking.comment.mentioned` for the mention.
5. Stop the service and drag a card: the card snaps back and a toast offers Retry.
6. Open `/tracking/reports`, pick a folder, upload a PDF, double-click it to open the viewer, delete it and press
   Undo. A non-PDF and a file over 20 MB are rejected with a message.
7. Open a board and press Timeline: bars appear grouped by assignee, and the splitter resizes the board and timeline.
