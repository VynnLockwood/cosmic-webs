# Cosmic Webs

Look at a Postgres schema as a **cosmic web**: every table is a glowing dot, every foreign key a thread between
dots, floating in deep space you can orbit and fly through. Pick columns and conditions from anywhere in the
schema and Cosmic Webs finds the **top 5 ranked SQL plans** that fetch them — and flags what can't be reached, and why.

## Run it

```bash
docker compose up --build      # http://localhost
```

Services: `nginx` (reverse proxy) → `web` (Vite + React + TypeScript, Rust math compiled to WASM) and `api` (FastAPI),
plus `sandbox-pg` (Postgres 16 with generated mock data). The default 25-table shop schema loads on start.

- **Schema** (left rail): upload a `.sql` file or paste DDL → every table becomes a dot, every FK a link.
- **Data source**: *Sandbox* (mock data, default) or *Live Postgres* (read-only, 5 s statement timeout, password kept only in API memory).
- **Click a dot**: the camera flies in; the panel shows columns (PK/FK) and paged rows. `Esc` flies back.
- **Search**: pick columns (multi-select over the whole schema) and AND/OR conditions (`= != < <= > >= IN NOT IN LIKE ILIKE IS NULL IS NOT NULL BETWEEN`).
  The Rust core finds join paths (Steiner trees over the FK graph), builds up to 20 candidate queries (join / EXISTS / split),
  the API runs `EXPLAIN` on each, and the best 5 are shown with SQL, joins, queries and cost.
  Unreachable tables, ambiguous FKs, type mismatches, timeouts and permission errors are flagged.

- **Why is plan #1 first?** Every result card has a *Why #n?* score sheet: the four things compared (run time or estimated cost 50 %,
  queries 25 %, joins 15 %, rows 10 %), where the plan sits between the best and worst of the compared plans, and the points each adds.
  In the sandbox every plan is really executed (median of 3 timed runs after a warm-up), so the rank follows measured run time; on a live
  database it follows the planner's estimate. Split plans return separate result sets, so they are hidden unless you include them.
- **Structure lab** (sandbox only): add or drop indexes, links (FKs) and columns, run one DDL statement, or change the data size
  (up to 100,000 rows per table). The web updates in place, your search re-runs, and a *Before / after* table shows how the best plan changed.
- **Import**: pgAdmin / `pg_dump` exports work as they are (`\restrict` lines, owners, sequences and grants are skipped). When the file contains rows
  (`COPY` blocks) they are loaded as they are — empty tables stay empty; otherwise mock rows are generated. Tables or statements that fail are
  skipped and reported, never leaving the sandbox half-built.
- **Suggested links**: many databases declare few foreign keys. Columns named like another table (`sppProject`, `customer_id`) are suggested as links; with
  real rows each suggestion shows how many of its values exist in the target key (`✓ 289/289 values match`), and one click declares it in the sandbox.

Keys: drag = rotate · right-drag = pan · wheel = zoom · `/` search · `Esc` back · `F` frame all · `+`/`-` zoom · arrows rotate 15°.

## Layout

| Path | What |
|---|---|
| `core/` | Rust crate `cosmos-core`: force layout, join paths, SQL generation, diagnosis, ranking (WASM via `wasm-pack`) |
| `api/` | FastAPI: DDL parsing (`pglast`), sandbox + mock data, live source, rows, `EXPLAIN`/run |
| `web/` | Vite + React + TS + react-three-fiber: scene, camera motion, UI, search |
| `samples/` | `shop.sql` (default schema), fixtures, 500-table synthetic schema |
| `docs/superpowers/` | design spec, visual design spec, implementation plan |

## Develop

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up    # api reload + Vite HMR behind nginx
core/build-wasm.sh                                                   # build the Rust core to web/src/wasm
cd web && npm test && npm run e2e                                    # unit + browser tests
cd api && pytest                                                     # needs Postgres 16 server binaries (starts a throwaway cluster)
cd core && cargo test --release
```

### Testing notes

- `web/src/wasm-stub` is a small JS stand-in for the WASM package. Unit tests and `VITE_USE_STUB=1` builds use it, so the
  UI can be developed and tested without wasm32 tooling. Real WASM is used by the Docker build and the `WASM_REAL=1` browser tests.
- `api/tests/test_contract_rust.py` runs the real Rust planner/ranker (via `core/examples/cli.rs`) against the API and a real
  Postgres, so the Rust ↔ Python JSON contract is checked without a browser.
- Browser tests mock the API unless `E2E_REAL_API=1`. Visual baselines are recorded with the stub layout on Linux/SwiftShader.
- Performance targets (500 tables ≥ 50 fps, layout < 3 s): the layout budget is a Rust test; the fps check runs with `PERF=1` on a machine with a GPU.
- The sandbox login is a Postgres superuser only for building tables and filling data. User-supplied DDL runs as `cosmos_ddl` and every
  user-supplied SELECT as the read-only `cosmos_ro`, so neither can read server files.
- Set `CHROMIUM_PATH` to use a specific Chromium for Playwright.
