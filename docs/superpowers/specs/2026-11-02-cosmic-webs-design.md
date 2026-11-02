# Cosmic Webs — Design Spec

Date: 2026-11-02
Status: Approved design, pending spec review

## 1. Goal

A full-screen, local developer tool that shows a PostgreSQL schema as a 3D "cosmic web":
tables are dots, foreign keys are links. The user can rotate, zoom, open a table to see
its rows, and — the core feature — pick columns plus conditions across the whole schema
and get the **top 5 ranked query plans** that gather that data, with clear flags for
anything that cannot be reached and why.

### Decided scope

| Topic | Decision |
|---|---|
| Users | Single user, local tool. No login. |
| Schema size | Up to 500 tables. |
| Database engine | PostgreSQL only (v1). |
| Data source | Both: built-in sandbox Postgres with generated mock data (default), and optional live Postgres connection (read-only). |
| Search input | Columns + conditions with a flexible boolean condition tree (AND/OR, nested). |

### Out of scope (v1)

Other engines (MySQL etc.), multi-user, auth, saved workspaces, writing data, schema editing.

## 2. Architecture

```
browser ──► nginx :80
              ├─ /       → web  (Vite + React + TypeScript, Rust core compiled to WASM)
              └─ /api/*  → api  (Python 3.12, FastAPI)
                              ├─ sandbox-pg (Postgres 16, owned by the app, mock data)
                              └─ live Postgres (user-provided, optional, read-only)
```

Docker Compose services: `nginx`, `web` (static build served by nginx in prod; Vite dev server in dev),
`api`, `sandbox-pg`. One command: `docker compose up`.

### Repo layout

```
cosmic-webs/
  docker-compose.yml
  nginx/nginx.conf
  core/            # Rust crate "cosmos-core" → wasm-pack → web/src/wasm
  web/             # Vite React TS app
  api/             # FastAPI app
  samples/         # default mock schema (shop.sql, ~25 tables)
  docs/
```

## 3. Components

### 3.1 Rust core (`core/`, compiled to WASM)

Pure functions, no I/O. Exposed via `wasm-bindgen` with JSON (serde) in/out.

| Function | Input | Output |
|---|---|---|
| `layout_init(graph, seed)` | schema graph | random 3D positions in a sphere |
| `layout_step(state, n)` | positions + graph | positions after n force-directed iterations (repulsion between all dots via Barnes–Hut octree, spring pull on FK links, centering) |
| `plan_candidates(graph, request)` | schema graph + search request | up to 20 candidate plans, each with SQL text(s) and static metrics |
| `rank(candidates, costs)` | candidates + EXPLAIN results | ordered top 5 with score breakdown |
| `diagnose(graph, request)` | schema graph + request | list of flags (see 3.4) |

Layout runs in a Web Worker so the UI never blocks. Initial positions are random (as requested),
then forces settle the web so FK-linked tables sit closer.

### 3.2 Web (`web/`)

- **Scene**: `@react-three/fiber` + `drei`. Dots = instanced spheres (size by row count or column count),
  links = line segments. `OrbitControls`: drag to rotate, scroll to zoom, right-drag to pan.
  Hover shows table name. Starfield background.
- **Click dot**: camera flies to it; a panel shows columns (type, PK/FK markers) and a paged row grid
  fetched from the API. Connected links and neighbor dots highlight.
- **Left sidebar** (function menu):
  1. *Schema* — upload `.sql` file or paste DDL; "Reset to default" mock.
  2. *Data source* — Sandbox (mock) or Live (connection form: host, port, db, user, password, schema).
  3. *Search* — query builder (see 3.4).
  4. *Results* — top 5 plans and flags.
- State: Zustand store. API calls: typed fetch client generated from FastAPI OpenAPI.

### 3.3 API (`api/`)

| Endpoint | Purpose |
|---|---|
| `POST /api/schema` | Parse DDL with `pglast`. Return schema graph JSON. Rebuild sandbox DB and fill mock data. |
| `GET /api/schema/default` | Default shop schema graph. |
| `POST /api/source/live` | Test + hold live connection (in memory only). |
| `DELETE /api/source/live` | Drop live connection. |
| `GET /api/tables/{name}/rows?limit&offset` | Rows for a table from active source. |
| `POST /api/explain` | Run `EXPLAIN (FORMAT JSON)` for each candidate SQL; return total cost, estimated rows, plan node summary. Optional `analyze=true` only allowed on sandbox, or on live when user explicitly enables it. |
| `POST /api/run` | Execute chosen plan with `LIMIT` and return rows. |

**Schema graph JSON** (shared contract between API, web, and Rust):

```json
{
  "tables": [{"name": "public.orders", "columns": [{"name": "id", "type": "int8", "nullable": false, "pk": true}], "row_estimate": 1000}],
  "fks": [{"id": "fk_orders_user", "from": {"table": "public.orders", "columns": ["user_id"]}, "to": {"table": "public.users", "columns": ["id"]}}]
}
```

**Mock data**: tables filled in FK topological order with Faker, type-aware (int, text, uuid,
timestamp, numeric, bool, enum, json). FK columns pick existing parent keys. Self-references and
cycles: insert with NULL first, then update. Default 1,000 rows per table (configurable).

### 3.4 Search, planning, ranking

**Search request** (stored as a tree, never as raw SQL string):

```json
{
  "select": ["public.users.email", "public.orders.total"],
  "where": {"op": "AND", "children": [
    {"col": "public.orders.status", "cmp": "=", "value": 0},
    {"op": "OR", "children": [
      {"col": "public.users.name", "cmp": "=", "value": "xxx"},
      {"col": "public.users.name", "cmp": "ILIKE", "value": "%x%"}
    ]}
  ]},
  "fk_choices": {}
}
```

Comparators: `= != < <= > >= IN NOT IN LIKE ILIKE IS NULL IS NOT NULL BETWEEN`.
Values are always sent as bind parameters, never string-concatenated.

**Candidate generation** (Rust):
1. Required tables = tables of all selected and filtered columns.
2. FK graph is undirected for pathing; each edge keeps its FK id.
3. Find connecting trees (Steiner tree over required tables): exact via Dreyfus–Wagner when ≤ 8 required
   tables, else shortest-path heuristic. Generate alternates with Yen-style k-shortest variants.
4. For each tree, emit plan shapes: single `JOIN` query; `EXISTS`/semi-join variant when a table only
   filters; split into 2+ queries with `IN (subquery)` or app-side merge.
5. Cap at 20 candidates.

**Ranking** (Rust, after API returns EXPLAIN):

```
score = w1·norm(explain_total_cost) + w2·join_count + w3·query_count + w4·norm(est_rows_scanned)
```

Lower is better. Default weights favor cost, then fewer queries. Top 5 shown with SQL, score
breakdown, and short reason ("1 query, 2 joins, uses index on orders.user_id").

**Flags** (from `diagnose` and API):

| Flag | Meaning |
|---|---|
| `UNREACHABLE` | No FK path links table A to the rest. Names the island. |
| `AMBIGUOUS_FK` | More than one FK between two tables; user must choose (fills `fk_choices`). |
| `TYPE_MISMATCH` | Condition value doesn't fit column type. |
| `UNKNOWN_COLUMN` | Column not in schema. |
| `PERMISSION` | Live DB denied access to a table. |
| `TIMEOUT` | EXPLAIN/run hit statement timeout. |
| `EMPTY_RESULT` | Warning: plan ran but returned 0 rows. |

A flagged column does not block the rest: plans are built for the reachable part, and the flag says what
was dropped and why.

## 4. Safety

- Live DB: every session `SET default_transaction_read_only = on`, `statement_timeout = 5s`.
- Plain `EXPLAIN` only on live by default; `EXPLAIN ANALYZE` needs explicit toggle (it executes the query).
- Credentials kept in API process memory only; never written to disk or logs.
- Identifiers quoted from the parsed schema; values always bound parameters.
- Sandbox DB dropped and rebuilt on each schema upload.

## 5. Error handling

- DDL parse errors → return line/position from `pglast`; sidebar shows them; current web stays.
- Unsupported DDL bits (triggers, functions) are skipped with a warning list, not a failure.
- WASM worker crash → toast + restart worker with last good state.

## 6. Testing

- **Rust**: unit tests for layout determinism (seeded), Steiner/path finding, SQL generation snapshots,
  ranking order, every flag type. Run `cargo test` and `wasm-pack test --headless`.
- **Python**: pytest for DDL parsing (sample schemas incl. composite FKs, self-refs, cycles), mock data FK
  validity, EXPLAIN endpoint against sandbox-pg (testcontainers), read-only enforcement on live.
- **Web**: Vitest for store/builder logic; Playwright smoke: load default → dots render → click dot →
  rows show → search → top 5 shown.
- Perf check: 500-table synthetic schema renders ≥ 50 fps and layout settles < 3 s.

## 7. Build order

1. Docker skeleton: nginx, api, web, sandbox-pg; default shop schema.
2. Schema parse → graph JSON → 3D dots and links (random positions, orbit controls).
3. Rust core + WASM worker: force layout.
4. Click dot → table panel + rows (sandbox, then live source).
5. Search builder → Rust candidates + diagnose → API EXPLAIN → Rust rank → top 5 + flags.
6. Polish: visuals, perf on 500 tables, error UX.
