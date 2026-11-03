# Cosmic Webs

See a Postgres schema as a night sky. Every table is a **star**, every foreign key a **constellation line**.
Pick columns and conditions from anywhere in the schema and Cosmic Webs finds the **five best SQL plans** that fetch
them, ranks them by real run time, and tells you what could not be reached and why.

- **3D view** you can orbit, fly into, and search by name (`Ctrl/⌘ K`).
- **Search builder** with `AND`/`OR`/`NOT`, 18 comparators, `DISTINCT`, `ORDER BY`, `LIMIT`, `GROUP BY`, aggregates and `HAVING`.
- **Expected result (AI)**: describe what you want to see in plain words; a model of your choice (OpenRouter) drafts the query structure and any SQL the builder cannot say. It sees names only, never rows.
- **Ranking you can read**: every plan has a score sheet that shows why it is #1.
- **Structure lab**: add an index or a link, see if the best plan got faster, export the result.
- **Your data**: upload a `pg_dump` / pgAdmin export (rows included), or connect to a live Postgres read-only.

## Architecture

![Cosmic Webs architecture: the browser (which can call OpenRouter with the person's own key, sending names only) holds the React and three.js view and a Rust core compiled to WebAssembly; requests go over HTTPS through nginx to a FastAPI service, which runs SQL on the sandbox Postgres and, optionally, your live Postgres through read-only roles.](docs/architecture.svg)

The diagram source is [`docs/architecture.html`](docs/architecture.html) (open it for the web fonts).

| Part | Where it runs | Does what |
|---|---|---|
| **React + three.js** (`web/`) | browser | the 3D scene, panels, search builder, results, structure lab |
| **Rust core** (`core/`) | browser, in a Web Worker, compiled to WASM | force layout, join paths (Steiner trees over the FK graph), candidate SQL, diagnosis flags, ranking |
| **nginx** (`nginx/`) | server | one entry point: `/api` → FastAPI, everything else → the web files (gzip, long cache for hashed assets) |
| **FastAPI** (`api/`) | server | DDL parsing (`pglast`), import jobs, mock data, `EXPLAIN` and run, structure lab, export |
| **Sandbox Postgres** | server | your dump (or generated rows) in a throwaway database |
| **Your Postgres** | optional | connected read-only; never edited |
| **OpenRouter** | optional, called by the browser | drafts queries for **Expected result**; gets table and column names only, with your own key |

### What happens when you press Search

1. The Rust core **diagnoses** the request (unknown column, type mismatch, no foreign-key path, ambiguous links, invalid combinations).
2. It **plans** up to 20 candidate queries: one join, joins with `EXISTS` for filter-only tables, and split plans.
3. The API runs **`EXPLAIN`** on each candidate (in the sandbox it also times real runs: median of 3 after a warm-up).
4. The Rust core **ranks** them: run time (or estimated cost on a live database) 50 %, queries 25 %, joins 15 %, rows 10 %.
5. You see the top five, each with its SQL, a score sheet, flags, and a **Run** button.

When part of a request has no foreign-key path, the Results panel shows **BEFORE** (your request as SQL, dropped parts struck through)
above **AFTER** (the SQL of the best plan that ran).

## Run it

```bash
docker compose up --build      # http://localhost
```

Services: `nginx` → `web` (Vite build served by nginx, Rust math as WASM) and `api` (FastAPI), plus `sandbox-pg` (Postgres 16).
The default 25-table shop schema loads on start with a live progress bar.

## Using it

| | |
|---|---|
| **Schema** | Upload a `.sql` file or paste DDL. The graph appears at once; rows load in the background with a progress bar. |
| **Data source** | *Sandbox* (default) or *Live Postgres* (read-only, 5 s statement timeout, password kept only in API memory). |
| **Click a star** | The camera flies in; the panel shows columns (PK/FK) and paged rows. `Esc` flies back. |
| **Search** | Describe the result in **Expected result** (AI), or pick columns, add conditions, joins and shape yourself. Every column box is a search box; a value box lists the values the column really holds, with counts. |
| **Results** | Top five plans; **Run** shows up to 200 rows in a scrolling table and says when there are more. Switch **SQL** between *Hardcoded values* (paste into pgAdmin and it runs) and *Params ($1)* (for application code). |
| **Structure lab** | Indexes, links, columns, data size, one raw DDL statement; *Before / after* table; **Export** (see below). |
| **Settings** | OpenRouter key and model, star size, star brightness, web line brightness, spin sensitivity (all saved in this browser), quality, reduced motion. |

Keys: drag = rotate · right-drag = pan · wheel = zoom · `Ctrl/⌘ K` find a table · `/` search · `Esc` back or close · `F` frame all · `+`/`-` zoom · arrows rotate 15°.
Side panels can be dragged wider or narrower (double-click the handle to reset).

### What the search can do

- **Conditions:** `AND` / `OR` groups, `NOT (…)` on any group, `= != < <= > >=`, `IN`, `NOT IN`, `BETWEEN`, `NOT BETWEEN`, `LIKE`, `ILIKE`, `NOT LIKE`, `NOT ILIKE`, `~`, `~*`, `IS NULL`, `IS NOT NULL`.
- **Shape:** `DISTINCT`, `ORDER BY` (columns or aggregates, ASC/DESC), `LIMIT`, `OFFSET`, `GROUP BY`, `COUNT`, `COUNT DISTINCT`, `SUM`, `AVG`, `MIN`, `MAX`, `HAVING`.
  Combinations Postgres would reject are flagged `INVALID_QUERY` before anything runs.
- **Flags:** `UNREACHABLE`, `AMBIGUOUS_FK`, `TYPE_MISMATCH`, `UNKNOWN_COLUMN`, `INVALID_QUERY`, `PERMISSION`, `TIMEOUT`, `EMPTY_RESULT`.

### Joins you declare

Tables with no foreign key cannot be joined by the planner, and a query that mixes them pairs every row with every row (a 289-row table against another one can
return 10,000+ rows). In **Search → Joins** pick two columns that hold the same values; the planner then joins on them for that search. Your database is not changed.
The BEFORE block in Results has an **Add a join** button for exactly this case.

### Expected result (AI)

Write what you want to see, for example *"every customer's name with the total they paid, biggest first, top 20; include customers who never ordered"*.

1. Set your **OpenRouter API key and model** in Settings. They are stored in this browser's localStorage and sent only to `openrouter.ai`.
2. The browser sends the model **table and column names, types, keys and links** (when the schema is large, only the tables that look related to your words). **No rows, no values, no row counts.** The server and your database are not involved in this step.
3. The model answers with a structured request (columns, conditions, joins, `GROUP BY`, aggregates, sort, limit), optional custom joins, and, for anything the builder cannot say, full SQL:
   `LEFT`/`RIGHT`/`FULL JOIN`, subqueries, `WITH` (CTEs), window functions, `UNION`, `CASE`, `DISTINCT ON`, date and string functions.
4. Every part is checked before it is used: unknown columns and operators are dropped and listed as warnings, and only a single `SELECT` / `WITH … SELECT` is kept.
5. The builder is filled so you can read and change it. The model's own SQL is listed under **AI SQL** and is **ranked together with the planner's queries** (`EXPLAIN`, timing, score sheet, Run).

Only reading is possible: the API accepts one `SELECT` per query, and the sandbox and live sessions run it through a read-only role in a read-only transaction,
so `INSERT`, `UPDATE`, `DELETE`, DDL and data-changing `WITH` queries are refused.

### Import and suggested links

pgAdmin / `pg_dump` exports work as they are (`\restrict` lines, owners, sequences and grants are skipped). When the file has rows (`COPY` blocks) they are
loaded as they are and empty tables stay empty; otherwise mock rows are generated. Tables or statements that fail are skipped and reported, never
leaving the sandbox half-built. Many databases declare few foreign keys, so columns named like another table (`sppProject`, `customer_id`) are suggested as
links; with real rows each suggestion shows how many values exist in the target key (`✓ 289/289 values match`).

### Structure lab and export

Change the sandbox live; the web updates in place, your search re-runs, and *Before / after* compares the best plan with the baseline.
**Export** gives you four files: the current structure (`.sql`, via `pg_dump`), structure plus data, a **changes script** with only the statements you ran
(to apply to your real database), and the before/after table as `.csv`.

## API

| Method and path | Purpose |
|---|---|
| `POST /api/schema/jobs` · `GET /api/jobs/{id}` | import a schema in the background; poll progress |
| `POST /api/schema` · `GET /api/schema/default` | import in one request (no progress) |
| `GET/POST/DELETE /api/source…` | sandbox or live source |
| `GET /api/tables/{t}/rows` · `…/columns/{c}/values` | paged rows; distinct values with counts for autocomplete |
| `POST /api/explain` · `POST /api/run` | `EXPLAIN` (optionally timed) and run a candidate query (one read-only `SELECT`; `run` returns up to 1,000 rows and a `truncated` flag) |
| `GET /api/relations/suggest` | suggested foreign keys, checked against rows |
| `GET /api/structure` · `POST /api/structure/apply` · `POST /api/sandbox/refill` | structure lab |
| `GET /api/structure/export?kind=schema\|full` | download the sandbox as `.sql` |

## Repository

| Path | What |
|---|---|
| `core/` | Rust crate `cosmos-core` (WASM via `wasm-pack`), plus a native CLI used by contract tests |
| `api/` | FastAPI service |
| `web/` | Vite + React + TypeScript + react-three-fiber |
| `nginx/` | reverse proxy configs |
| `samples/` | `shop.sql` (default schema), fixtures, 500-table synthetic schema |
| `docs/` | architecture diagram; `docs/superpowers/` holds the design specs and plans |

## Develop

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up    # api reload + Vite HMR behind nginx
core/build-wasm.sh                                                   # build the Rust core to web/src/wasm
cd web && npm test && npm run e2e                                    # unit + browser tests
cd api && pytest                                                     # needs Postgres 16 server binaries (starts a throwaway cluster)
cd core && cargo test --release
```

### Testing notes

- `web/src/wasm-stub` is a small JS stand-in for the WASM package. Unit tests and `VITE_USE_STUB=1` builds use it, so the UI can be developed without wasm32 tooling. Real WASM is used by the Docker build and the `WASM_REAL=1` browser tests.
- `api/tests/test_contract_rust.py` runs the real Rust planner and ranker (via `core/examples/cli.rs`) against the API and a real Postgres, so the Rust ↔ Python JSON contract is checked without a browser.
- Browser tests mock the API unless `E2E_REAL_API=1`. Visual baselines use the stub layout on Linux/SwiftShader; re-record with `--update-snapshots=all`.
- Performance targets (500 tables ≥ 50 fps, layout < 3 s): the layout budget is a Rust test; the fps check runs with `PERF=1` on a machine with a GPU.
- Set `CHROMIUM_PATH` to use a specific Chromium for Playwright.

### Security

The sandbox login is a Postgres superuser only for building tables and filling data. User-supplied DDL runs as `cosmos_ddl` (not a superuser) and every
user-supplied `SELECT` as the read-only `cosmos_ro`, so neither can read server files. Live connections are read-only with a statement timeout. SQL shown with
hardcoded values is for copying only; plans always run with bind parameters. The OpenRouter key never reaches this app's server: the browser calls OpenRouter directly.

### Editing the architecture diagram

The diagram was made with the [diagram-design](https://github.com/cathrynlavery/diagram-design) skill (`npx skills add cathrynlavery/diagram-design`),
architecture type, default light skin. Edit `docs/architecture.html`, then export the SVG with the skill's `scripts/export_svg.py`.
