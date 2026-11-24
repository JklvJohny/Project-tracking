# Internal Team Project Tracking System Plan (Scalable)

Nov 16, 2026 · @Sax

**Goal:** Build a Trello-style work tracking system with no limits on users or projects, able to scale in the future.

**Requirement:** Everything must be free. Use only open-source and self-hosted software; no paid cloud services.

**Recommendation:** Start from an open-source project already designed to scale, then self-host it. You get a system with no limits on users or projects, and you own your data.

## Core Features

Phases follow the Roadmap: **P1** = MVP, **P2** = Ready for team use, **P3** = Scale-up

### 1. Workspaces and Projects

- Multiple Workspaces, e.g. one per department (P1)
- Unlimited Projects with name, description, owner, start and end dates (P1)
- Project status: Active / On hold / Done / Archived (P1)
- Assign members per Project (P1)
- Templates for new Projects, e.g. common Lists and Labels (P3)

### 2. Boards, Lists and Cards

- One Kanban Board per Project (P1)
- Create, edit, delete and reorder Lists (P1)
- Drag cards across Lists and reorder them (P1)
- Archive and restore cards (P1)
- WIP limit per List (P3)

### 3. Card Details

- Title and Markdown description (P1)
- Multiple assignees (P1)
- Due date and Start date (P1)
- Color Labels and Priority: Low / Medium / High / Urgent (P1)
- Checklist inside a card with % progress (P1)
- Comments and @mentions (P1)
- File attachments (P2)
- Estimated time and actual time spent (P2)
- Card dependencies (blocked by) (P3)
- Recurring cards, e.g. weekly (P3)

### 4. Views

- Board view (P1)
- List / Table view, sortable by column (P2)
- My Tasks: all my tasks across Projects on one page (P2)
- Calendar view by Due date (P2)
- Timeline / Gantt view (P3)

### 5. Search and Filters

- Search cards by title and description (P2)
- Filter by assignee, Label, Priority, Due date and overdue tasks (P2)
- Saved filters (P3)

### 6. Notifications

- In-app notifications: assigned, @mentioned, new comment (P2)
- Notifications when a Due date is near and when overdue (P2)
- Email delivery via the organization's SMTP (P2)
- Per-type notification settings (P3)

### 7. Activity Log

- Record every change: who, what, when (P2)
- Show history on each card and recent activity per Project (P2)

### 8. Dashboard and Reports

- Task count by status and overdue tasks (P3)
- Workload per person (P3)
- Progress of each Project against plan (P3)
- Export to CSV (P3)

### 9. Real-time and Automation

- Multiple people on the same Board see changes instantly (P3)
- Automation rules, e.g. moving a card to Done checks off its whole checklist (P3)
- Import from Trello (JSON) and CSV (P3)

## User Roles

| Permission | Admin | Project Manager | Member |
| --- | --- | --- | --- |
| Manage Workspace and members | ✓ |  |  |
| Create / delete Projects | ✓ | ✓ |  |
| Add members to a Project | ✓ | ✓ |  |
| Manage Lists and Labels | ✓ | ✓ |  |
| Create / edit / move cards | ✓ | ✓ | ✓ |
| Comment and attach files | ✓ | ✓ | ✓ |
| View Boards and Dashboard | ✓ | ✓ | ✓ |

Roles are set per Project. The same person can be a Project Manager in one Project and a Member in another.

## Options

### A. Fork or self-host open-source (recommended)

- **Plane:** Similar to Jira and Linear, with Kanban, Cycles, Modules, multiple Workspaces and Projects. Stack: Django + React + PostgreSQL + Redis
- **Planka:** Closest to Trello, lightweight. Stack: Node + React + PostgreSQL
- **License caution:** Both are AGPL. If you modify the code and expose it to people outside the organization over the web, you must publish your modified source. Internal-only use is usually fine, but have legal confirm.

### B. Build everything yourself

- Full control and no license constraints

## System Architecture (if building yourself)

### Stack

**Go + Next.js + PostgreSQL + Redis**

- **Backend (Go):** HTTP with `chi` or `echo`, DB with `sqlc` + `pgx`, migrations with `goose`, WebSocket with `coder/websocket`, background jobs with `asynq` (Redis)
- **Frontend (Next.js):** TypeScript + React
- **Sharing types across both sides:** Write an OpenAPI spec and generate the TypeScript client with `openapi-typescript` or `orval`
- **Why Go:** Fast enough, low memory, builds to a single binary, easy to deploy, handles real-time well with goroutines, easy to learn
- **Why not Rust:** This kind of workload is bound by DB and network, not CPU, and Rust is hard to learn

### Architecture

- **Multi-tenant:** Start with the hierarchy `workspace_id` > `project` > `board` > `list` > `card`, so new teams or departments can be added without schema changes
- **Stateless API:** Sits behind a load balancer and scales horizontally by adding instances
- **Real-time:** WebSocket with Redis pub/sub to sync across instances
- **Card ordering:** Use fractional indexing or LexoRank instead of 1, 2, 3, so dragging a card doesn't update every row
- **Attachments:** Store in a local folder (./uploads) at first, then move to self-hosted MinIO (free) as files grow; never in the DB
- **Background jobs:** A queue or worker handles notifications, email and reports, e.g. asynq
- **Activity log:** Store as a separate event table; can be extended into audit and dashboards
- **Deploy:** Docker from day one. Start on a single machine with Docker Compose, then scale to k3s (free Kubernetes) on your own servers as load grows

## Integrating with the Existing System

The existing system is already Go microservices. Build Project Tracking as one new service (`tracking-service`) following the same patterns as other services, without splitting tracking into multiple sub-services.

- **DB:** Its own DB or schema. Other services never access tracking tables directly, and tracking never accesses theirs
- **Auth:** Reuse the existing one. The API Gateway or existing auth middleware validates the token and forwards `user_id`. Tracking has no login system of its own
- **User data:** Store only `user_id`. Fetch names and avatars from user-service via API and cache them, or keep a copy updated from the `user.updated` event
- **Notifications:** If a notification service exists, publish events to it
- **Real-time:** If a WebSocket gateway exists, push through it; otherwise tracking opens its own WebSocket
- **Inside the service:** Split packages by responsibility, e.g. `board`, `card`, `activity`
- **Conventions:** Follow the existing system everywhere: inter-service communication (REST or gRPC), message broker, log format, config, health checks and CI/CD
- **Redis:** Not needed at first. A single server can broadcast real-time updates in memory. With multiple instances, use the existing broker or PostgreSQL `LISTEN/NOTIFY`

## Local Testing Before Production

Make `tracking-service` runnable on your own machine. Put everything that depends on the existing system behind interfaces and use stubs for now. In production, only the implementations change.

| Component | Local | Production |
| --- | --- | --- |
| Auth | Fake middleware reading the `X-User-ID` header | Existing middleware or gateway |
| User data | `UserProvider` returning fake users from config | Call user-service |
| Notifications / events | `EventPublisher` that prints to the log | Publish to the existing broker |
| DB | PostgreSQL in Docker | The service's DB or schema |

```go
type UserProvider interface {
    GetUsers(ctx context.Context, ids []string) ([]User, error)
}

type EventPublisher interface {
    Publish(ctx context.Context, topic string, payload any) error
}

if cfg.Env == "local" {
    users = stub.NewUserProvider()
    events = stub.NewLogPublisher()
} else {
    users = usersvc.NewClient(cfg.UserServiceURL)
    events = broker.NewPublisher(cfg.BrokerURL)
}
```

**Steps**

1. Use a `docker-compose.yml` with only PostgreSQL
2. Create the Go service using the same structure as other services in the existing system
3. Build all P1 features
4. Test with a single Next.js page, or Postman / curl with the `X-User-ID` header
5. For production, write the real `UserProvider` and `EventPublisher` implementations, wire in the existing auth middleware, and move migrations to the system's DB

**Cautions**

- Never ship the fake middleware (`X-User-ID`) to production: anyone could impersonate another user. Build it only for the `local` env
- Match table names, API names and error formats to the existing system's conventions from now on

## Roadmap

| Phase | Scope |
| --- | --- |
| 1. MVP | Auth, Workspace, Project, Board, Card, Drag & Drop |
| 2. Ready for team use | Roles, Activity log, Notifications, Search |
| 3. Scale-up | Real-time, Dashboard, Automation, Integration with internal systems, Mobile |

## Notes

"Unlimited" depends on the servers you run, not on the software.
