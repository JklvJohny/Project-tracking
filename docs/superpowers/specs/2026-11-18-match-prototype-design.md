# Match the prototype look (P1 polish): design

Date: 2026-11-18 · Status: draft for approval

## Intent

The running app works, but it does not look like `index.html`. The owner wants every P1 screen to look like the prototype.

Owner decisions (2026-11-18):
- **Buttons keep the app's current style** (the neutral shadcn primary). They are not changed to the prototype's blue.
- **Timeline (Gantt) and Reports are built for real**, as working features like `index.html`.
  - Reports files are **uploaded in the app** and stored on the server.
- **The other later-phase features stay visible, disabled "coming soon" placeholders.** These are search and filters, Dashboard, Import, and time or file counts on cards.

## Goals

- **Same visual system as the prototype:**
  - buttons keep the app's current neutral primary;
  - compact type scale;
  - the prototype's status pills (Active green, On hold amber, Done, Archived);
  - coloured initials avatars;
  - board area on a muted background;
  - light and dark themes.
- **Dev shell** looks like the prototype's host chrome:
  - header with an app mark, an EN/TH segmented toggle, a theme icon button and the current user's avatar;
  - sidebar with a Tracking section (Dashboard, Projects, Import, Reports) and an Other section (Settings).
  - It stays dev-only, and Ctrl+Shift+B still controls the user switcher.
- **Tracking tab bar** (Dashboard, Projects, Import, Reports) at the top of tracking pages, as in the prototype. Projects and Reports are live. Dashboard and Import are disabled with a "coming soon" tag.
- **Projects page:**
  - columns Project (name + description), Owner (avatar + name), Status pill, Timeline, Members (avatar stack, +N), and Progress (bar + done/total);
  - a list/grid toggle kept in `?view=`.
- **Board page:**
  - Header: breadcrumb, back arrow, large title with status pill, member avatar stack, and the buttons Members, Settings, Import (placeholder) and Archived (with count).
  - Filters row: Search, Assignee, Label, Priority, Due, all as disabled placeholders.
  - A collapsible "Board · N lists · M cards" section.
  - A collapsible **Timeline** section, "who finishes which task, by date", below the board. It is built for real:
    - **Split:** a drag handle between Board and Timeline resizes them. The split is a preference saved in `localStorage` as `pt-split`. The handle is keyboard operable (arrow keys) with `role="separator"`.
    - **Gantt layout:** rows grouped by assignee, plus an "Unassigned" group. Each bar spans a card's start → due date and is coloured by status: done, in progress, not started or overdue, using the validated `--s-*` tokens.
    - **Grid:** week grid columns, a "today" line, and a visible date range with prev / next / today controls.
    - **Card dates:**
      - A card with only a due date shows as a milestone.
      - A card with no dates is listed in a "No dates" note.
      - Clicking a bar opens the card panel.
    - **Labels:** each bar has a text label (title) and an accessible description (assignee, dates, status), so status is never colour alone.
    - **Data:** built from the board snapshot already in the cache (`startDate`, `dueDate`, `assigneeIds`, `completedAt`), so there is no new API call. Full width; percentage positioning, as the prototype fix did.
- **Card on the board:**
  - priority badge, labels and title as today;
  - coloured avatar stack plus a dashed "+" that opens the assignee picker (editors only);
  - a "N SUBTASKS" header with a "+" that opens the card panel focused on the add-item field;
  - the first 3 checklist items as toggleable checkboxes, then "+N more";
  - a meta row with a due chip (calendar icon, overdue red with a warning icon, completed green with a check) and a comment count.
  - **No** time-spent or file-count placeholders on cards: they would read as real data.
- **Card panel** (wide sheet, about 900px, two columns on desktop, stacked below 768px):
  - **Top bar:** "Project / List" breadcrumb, Archive, Close.
  - **Main column:** large title; labels and priority inline; Description with a Write/Preview segmented control; Checklist; Comments with the author avatar and a blue Comment button.
  - **Side column:**
    - Status (list) select, which moves the card to the end of the chosen list;
    - Assignees with an Edit picker, and Priority;
    - Start and Due dates, and Labels with an Edit picker;
    - "Created by · Card ID".

- **Reports page** (`/tracking/reports`, live tab), like the prototype:
  - **Folders:** a list of project folders (only projects the caller can see) with document counts. Opening a folder lists its PDFs (name, size, uploaded by, date) in a table.
  - **Opening a document:** double-click or Enter opens it in an in-app viewer. The viewer is a dialog with the browser's PDF viewer in an `iframe` pointing at the authorised file URL. It has prev/next across the folder (arrow keys) and Download.
  - **Upload:** a button plus drag & drop onto the folder, for the PM, members and admin. Viewers cannot upload. Uploads are blocked on archived projects.
  - **Limits:** PDF only, at most 20 MB per file. Both are checked on the client for a quick message, and enforced on the server.
  - **Delete:** the uploader, a PM or an admin can delete. It asks for confirmation first, then shows a toast with Undo, because it is a soft delete.

## Reports backend (new `document` module)

- **Table:** `documents`, per the ERD: `id, project_id, storage_key, filename, mime_type, size_bytes, uploaded_by, created_at, deleted_at`.
- **Store contract:** a new `Documents` repo, with its SQL obligations written in `docs/db-contract.md`.
- **File storage:** a `blob.Store` interface with `Put(ctx, key, r) / Open(ctx, key) / Delete(ctx, key)`. The local implementation writes under `./uploads` (configurable `UPLOAD_DIR`); MinIO comes later.
  - Files never go in the database or a public folder.
  - The storage key is server-generated (`<projectID>/<uuid>.pdf`), never derived from the file name.
- **Endpoints:**

  | Method and path | Behaviour |
  |---|---|
  | `GET /projects/{projectID}/documents` | List the project's documents. |
  | `POST /projects/{projectID}/documents` | `multipart/form-data`, field `file`. Answers 201 with the document. |
  | `GET /documents/{documentID}/file` | Streams the file through an authorised route: `Content-Type: application/pdf`, `Content-Disposition: inline; filename*=UTF-8''…`, and `X-Content-Type-Options: nosniff`. |
  | `DELETE /documents/{documentID}` | Soft delete. |
  | `POST /documents/{documentID}/restore` | Undo a delete. |

- **Validation on the server:**
  - the size limit is enforced while reading, with `http.MaxBytesReader`;
  - the file must start with `%PDF-` (magic bytes), whatever the client claims;
  - the file name is cleaned (path separators and control characters stripped, length capped);
  - errors use the existing envelope. New field codes are `too_large` and `not_pdf`.
- **Permissions:**
  - View and download: any project member, or an admin. Every other caller gets `not_found`.
  - Upload: admin, pm or member.
  - Delete or restore: the uploader, a pm or an admin.
  - Archived project: read-only (R14 `project_archived`).
- **Activity events:** `document.uploaded`, `document.deleted` and `document.restored`.
- **ETag:** document writes do not touch the board ETag, because the board does not show documents.

## Non-goals

- Building search and filters, Dashboard, Import, time tracking or card attachments. Search and filters, Dashboard and Import are placeholders only.
- PDF thumbnails, file versioning, and any file type other than PDF.
- Changing behaviour that the P1 review approved. This is a visual and layout change, plus the small read additions below.

## Backend additions (read-only data the new UI needs)

- **`GET /projects`:** each project gains `owner {id,name,avatarUrl}`, `members [{id,name,avatarUrl}]`, `cardsDone` and `cardsTotal`.
  - These are counts of active cards; done means `completed_at` is not null.
  - They come from one store call, with no N+1.
- **Board snapshot:** each card summary gains `checklistPreview`, the first 3 items by position as `{id, text, isDone}`.
- `docs/db-contract.md` and `openapi.yaml` are updated. The generated TS types are regenerated.

## Approach

There is one sensible way:

- Restyle the existing components in place, and add a shared `Avatar` with a deterministic colour per user id from a validated token palette.
- Keep every existing test green, and add tests for the new behaviour:
  - checklist toggle on the card;
  - Status select moves the card;
  - placeholders are disabled and have translated "coming soon" text;
  - the view toggle.

Rejected alternatives:

- Copying the prototype's markup wholesale. The prototype is vanilla JS and the conventions forbid porting it line by line.
- Showing fake data placeholders on cards. They are misleading.

## Verification

- All gates must pass: Go test/vet/gofmt, vitest, tsc and next build.
- Real-Chrome pass of the two new features:
  - Timeline bars, split drag and keyboard resize;
  - Reports upload, open in viewer, prev/next, download, delete with Undo, and viewer read-only;
  - non-PDF and oversize uploads rejected.
- Side-by-side screenshots of the prototype and the app with real Chrome:
  - pages: projects, board with Timeline, card panel, Reports;
  - TH and EN, light and dark, 1440px and 400px.
