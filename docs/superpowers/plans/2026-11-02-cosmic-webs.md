# Cosmic Webs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a full-screen 3D "cosmic web" of a Postgres schema (tables = dots, FKs = links) with a multi-column/condition search that returns the top 5 ranked SQL plans and flags what cannot be reached.

**Architecture:** Docker Compose runs nginx → web (Vite React TS) and api (FastAPI) plus a sandbox Postgres. All heavy math (force layout, join-path search, SQL candidate generation, diagnosis, ranking) lives in one Rust crate compiled to WASM and run in a Web Worker. The API parses DDL, builds mock data, serves rows, and runs `EXPLAIN`; the browser loops WASM → API → WASM to rank.

**Tech Stack:** Python 3.12 / FastAPI / pglast / psycopg 3 / Faker / pytest + testcontainers; Rust / wasm-bindgen / wasm-pack / serde; Vite / React / TypeScript / Zustand / react-three-fiber / drei / postprocessing / comlink / Vitest / Playwright; Docker Compose / nginx / Postgres 16.

**Spec:** `docs/superpowers/specs/2026-11-02-cosmic-webs-design.md` (system) and `docs/superpowers/specs/2026-11-02-cosmic-webs-visual-design.md` (visual). Read both.

## Global Constraints

- PostgreSQL only. Sandbox is Postgres 16. API is Python 3.12, FastAPI, `pglast` for DDL.
- Rust crate `cosmos-core` is pure functions, no I/O, JSON (serde) in/out, built with `wasm-pack` + `wasm-bindgen`. Layout runs in a Web Worker.
- Services: `nginx`, `web`, `api`, `sandbox-pg`; one command `docker compose up`; nginx routes `/` → web, `/api/*` → api.
- Live DB sessions: `default_transaction_read_only = on`, `statement_timeout = 5s`; plain `EXPLAIN` only unless the user explicitly enables analyze; credentials in API process memory only, never on disk or in logs.
- Values are always bind parameters, never concatenated. Identifiers are quoted from the parsed schema.
- Mock data: default 1,000 rows per table, FK topological order, cycles: insert NULL first then update.
- Comparators: `= != < <= > >= IN NOT IN LIKE ILIKE IS NULL IS NOT NULL BETWEEN`.
- Flag codes: `UNREACHABLE AMBIGUOUS_FK TYPE_MISMATCH UNKNOWN_COLUMN PERMISSION TIMEOUT EMPTY_RESULT`.
- Planner: ≤ 20 candidates, top 5 shown, Dreyfus–Wagner exact when ≤ 8 required tables, else shortest-path heuristic.
- Perf: 500 tables at ≥ 50 fps on integrated GPU; layout settles < 3 s.
- Camera: `CameraControls` (not OrbitControls); every move interruptible; `prefers-reduced-motion` → no warp, streaks, idle orbit, pulses; moves become 0.3 s fades.
- Theme tokens: `space-void #05060F`, `nebula-violet #3B1E6B`, `nebula-teal #0F4C5C`, `nebula-rose #6B1E4A`, `star-white #F4F6FF`, `link-thread #8FA8FF`@25%, `link-active #BFE4FF`@90%, `flag-red #FF5C6C`, `flag-amber #FFC15C`. Bloom threshold 0.6 intensity 1.2; vignette 0.5; grain 0.03.
- Work in the cloned repo `cosmic-webs/`. Commit after every task.

## Review Focus

1. DDL with zero tables (empty, comments only) → clear error, scene unchanged (Task 2).
2. Self-referencing FK (`employees.manager_id`) → layout, path search and mock data neither loop nor produce NaN (Tasks 3, 5, 6).
3. Identifiers with uppercase, spaces, double quotes, reserved words, or same table name in two schemas → always quoted, never merged (Tasks 2, 8).
4. Values containing `'`, `%`, `;`, `--` or SQL keywords → only ever bound params; `%` in identifiers does not break the driver (Tasks 8, 10).
5. Nothing selected, filters only, a single table, or a schema with zero FKs → no crash, clear flag or empty result (Tasks 5, 7, 8).

---

## Phase A — Foundation and API

### Task 1: Docker skeleton

**Files:**
- Create: `docker-compose.yml`, `docker-compose.dev.yml`, `nginx/nginx.conf`, `nginx/nginx.dev.conf`, `api/Dockerfile`, `api/pyproject.toml`, `api/app/main.py`, `api/tests/test_health.py`, `web/Dockerfile` (static placeholder page for now; Task 11 replaces it), `web/placeholder/index.html`, `scripts/smoke.sh`, `.gitignore`

**Interfaces:**
- Produces: `GET /api/health` → `{"status":"ok"}`; env `SANDBOX_DSN=postgresql://cosmos:cosmos@sandbox-pg:5432/cosmos`; FastAPI `app` in `api/app/main.py`; dev override proxies `/` to `web:5173` with WebSocket upgrade.

- [ ] **Step 1: Write failing test** `api/tests/test_health.py::test_health` — `TestClient(app).get("/api/health").json() == {"status": "ok"}`.
- [ ] **Step 2: Run** `cd api && pytest tests/test_health.py -v` → FAIL (no module).
- [ ] **Step 3: Implement** `app = FastAPI(title="cosmic-webs")` with `/api/health`; Dockerfile on `python:3.12-slim`; compose with 4 services (sandbox-pg = `postgres:16`, user/db/password `cosmos`, superuser); nginx proxies `/api/` → `api:8000`, `/` → `web:80`.
- [ ] **Step 4: Write `scripts/smoke.sh`**: `curl -fs localhost/api/health | grep -q ok && curl -fs localhost/ | grep -qi cosmic`. Run `docker compose up -d --build && scripts/smoke.sh` → exit 0; `pytest` → PASS.
- [ ] **Step 5: Commit** `feat: docker skeleton with nginx, api, web placeholder, sandbox-pg`

### Task 2: DDL parser and shop sample

**Files:**
- Create: `api/app/models.py`, `api/app/ddl.py`, `api/app/routes_schema.py`, `samples/shop.sql` (25 tables incl. composite FK, one self-referencing FK `employees.manager_id`, one FK cycle, one pair of parallel FKs), `samples/shop.graph.json`, `api/scripts/gen_fixture.py`, `api/tests/test_ddl.py`
- Modify: `api/app/main.py` (include router)

**Interfaces:**
- Produces (pydantic, JSON shape = spec §3.3): `Column(name:str, type:str, nullable:bool, pk:bool)`, `Table(name:str, columns:list[Column], row_estimate:int=0)`, `FkEnd(table:str, columns:list[str])`, `Fk(id:str, from_:FkEnd [alias "from"], to:FkEnd)`, `SchemaGraph(tables, fks)`, `ParseResult(graph:SchemaGraph, warnings:list[str])`.
- Produces: `parse_ddl(sql: str) -> ParseResult`; `class DdlError(Exception)` with `message, line, col`; table names are `"schema.table"` (default `public`); types are short pg names (`int4 int8 text bool numeric timestamptz uuid jsonb varchar`); FK id = constraint name else `fk_<table>_<cols>`, de-duplicated with numeric suffix.
- Produces: `POST /api/schema {ddl}` → `{graph, warnings}` (parse only here; Task 3 adds sandbox), `GET /api/schema/default` → same for `samples/shop.sql`; DdlError → HTTP 422 `{message,line,col}`.

- [ ] **Step 1: Write failing tests** in `test_ddl.py`:
```python
test_composite_fk          # FK (a,b)->(x,y) keeps column order in from_/to
test_self_reference_fk     # employees.manager_id -> employees.id parsed, from_.table == to.table
test_cyclic_fks            # a->b and b->a both present
test_alter_table_add_fk    # FK added by ALTER TABLE is found
test_unsupported_skipped   # CREATE FUNCTION / TRIGGER -> warnings non-empty, tables still parsed
test_syntax_error_position # DdlError.line == 2 for a bad token on line 2
test_zero_tables_rejected  # "" and "-- only comment" raise DdlError("no tables found")
test_quoted_names          # CREATE TABLE "Order Items" -> name 'public.Order Items'; "a""b" kept literally
test_same_name_two_schemas # public.users and audit.users are two tables
test_shop_matches_fixture  # 25 tables; parse_ddl(shop.sql).graph == shop.graph.json
```
- [ ] **Step 2: Run** `pytest tests/test_ddl.py -v` → FAIL.
- [ ] **Step 3: Implement** `parse_ddl` with `pglast.parse_sql` walking `CreateStmt` / `AlterTableStmt` (skip other statement kinds with a warning); write `gen_fixture.py` to regenerate `samples/shop.graph.json`.
- [ ] **Step 4: Run** all tests → PASS; `curl localhost/api/schema/default` returns 25 tables.
- [ ] **Step 5: Commit** `feat(api): DDL parser, models, shop sample and graph fixture`

### Task 3: Sandbox DB and mock data

**Files:**
- Create: `api/app/sandbox.py`, `api/app/mockdata.py`, `api/tests/conftest.py` (testcontainers `postgres:16` fixture `pg_conn`), `api/tests/test_mockdata.py`
- Modify: `api/app/routes_schema.py` (POST `/api/schema` rebuilds sandbox)

**Interfaces:**
- Consumes: `SchemaGraph`, `parse_ddl` (Task 2).
- Produces: `fk_load_order(graph: SchemaGraph) -> tuple[list[str], list[Fk]]` (parents-first table order; FKs deferred to break cycles and self-references); `fill_mock(conn, graph, rows_per_table: int = 1000, seed: int = 0) -> dict[str, int]` (row counts); `rebuild_sandbox(ddl: str, graph: SchemaGraph, rows_per_table: int = 1000) -> SchemaGraph` (drops all user tables in sandbox, runs DDL, fills data, returns graph with real `row_estimate`). Load runs under `SET session_replication_role = replica`; deferred FK columns are written NULL (or a placeholder if NOT NULL) then UPDATEd to existing parent keys.

- [ ] **Step 1: Write failing tests**:
```python
test_topo_order_parents_first        # for shop: every non-deferred FK parent precedes child
test_cycle_returns_deferred_fk       # a<->b yields exactly one deferred fk
test_all_fk_values_exist_in_parent   # for every FK in shop: anti-join count == 0
test_self_reference_rows_valid       # employees.manager_id is NULL or an existing id
test_types_covered                   # int, text, uuid, timestamp, numeric, bool, enum, json columns load
test_default_rows_1000               # every shop table has 1000 rows
test_rebuild_drops_old_tables        # second rebuild with different DDL leaves only new tables
```
- [ ] **Step 2: Run** `pytest tests/test_mockdata.py -v` → FAIL.
- [ ] **Step 3: Implement** with Faker by column type; PK ints sequential; composite FKs pick whole parent tuples.
- [ ] **Step 4: Run** → PASS; `curl -X POST localhost/api/schema -d '{"ddl":...}'` returns graph with `row_estimate: 1000`.
- [ ] **Step 5: Commit** `feat(api): sandbox rebuild and FK-valid mock data`

### Task 4: Sources, live connection, rows endpoint

**Files:**
- Create: `api/app/sources.py`, `api/app/introspect.py`, `api/app/routes_data.py`, `api/tests/test_sources.py`, `api/tests/test_rows.py`
- Modify: `api/app/main.py`

**Interfaces:**
- Consumes: `SchemaGraph`; `SANDBOX_DSN`.
- Produces: `LiveParams(host:str, port:int, dbname:str, user:str, password:str, schema:str="public", allow_analyze:bool=False)`; `class SourceRegistry` with `use_sandbox() -> None`, `use_live(p: LiveParams) -> None`, `mode -> Literal["sandbox","live"]`, `session() -> ContextManager[psycopg.Connection]` (live sessions run `SET default_transaction_read_only = on; SET statement_timeout = '5s'`); `introspect(conn, schema: str) -> SchemaGraph` (spec is silent on how a live graph is obtained; this reads pg catalogs); module-level `registry = SourceRegistry()`.
- Produces endpoints: `POST /api/source/live` (body `LiveParams`) → `{graph}`; 400 `{message}` on connect failure; `DELETE /api/source/live`; `GET /api/tables/{name}/rows?limit=50&offset=0` → `{columns:[str], rows:[[any]], total_estimate:int}`, `limit` max 200, ordered by PK else `ctid`; table name must exist in the active graph.

- [ ] **Step 1: Write failing tests**:
```python
test_live_session_is_read_only        # INSERT in live session raises ReadOnlySqlTransaction
test_live_statement_timeout_is_5s     # SHOW statement_timeout == '5s'
test_connect_failure_400_message      # bad host -> 400 with message, registry stays on sandbox
test_password_never_logged            # caplog contains no password string
test_introspect_matches_ddl_graph     # introspect(shop in pg) == parse_ddl(shop).graph (tables, fks)
test_rows_paging                      # limit=5&offset=5 returns rows 6-10 in PK order
test_rows_unknown_table_404           # also "public.users; drop table x" -> 404
test_rows_limit_capped_200            # limit=9999 -> 200 rows max
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Quote table identifiers via `psycopg.sql.Identifier` only after matching against graph names.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(api): live source, introspection, paged rows`

Order note: Tasks 5–9 are the Rust core; Task 10 (explain/run API) needs the `SqlQuery` shape from Task 8 and is built after them.

---

## Phase B — Rust core

### Task 5: Core crate, types, force layout

**Files:**
- Create: `core/Cargo.toml` (crate `cosmos-core`, `crate-type = ["cdylib","rlib"]`), `core/src/lib.rs`, `core/src/types.rs`, `core/src/layout.rs`, `core/src/wasm.rs`, `core/build-wasm.sh` (`wasm-pack build --target web --out-dir ../web/src/wasm`), `core/tests/contract.rs`, `core/tests/layout.rs`

**Interfaces:**
- Produces (serde, same JSON as Task 2): `SchemaGraph{tables:Vec<Table>, fks:Vec<Fk>}`, `Table{name,columns:Vec<Column>,row_estimate:u64}`, `Column{name,r#type,nullable,pk}`, `Fk{id, from:FkEnd, to:FkEnd}` (`FkEnd{table, columns}`).
- Produces: `pub struct Layout`; `Layout::new(graph:&SchemaGraph, seed:u32) -> Layout` (random points inside a sphere r ≤ 100); `step(&mut self, iterations:u32)` (Barnes–Hut repulsion θ=0.8, spring on FK links, centering); `positions(&self) -> &[f32]` (x,y,z per table, graph order); `is_settled(&self) -> bool`. Spec's `layout_init/layout_step` are exposed as this struct.
- Produces (wasm): `#[wasm_bindgen] struct WasmLayout { new(graph_json:&str, seed:u32), step(n:u32), positions()->Vec<f32>, settled()->bool }`.

- [ ] **Step 1: Write failing tests**:
```rust
// contract.rs
shop_graph_deserializes: serde_json from ../samples/shop.graph.json -> 25 tables
// layout.rs
init_deterministic_for_seed:  same seed => identical positions; different seed => different
init_inside_sphere:           every point norm <= 100.0
linked_pairs_closer:          after 300 steps mean FK distance < 0.7 * mean all-pair distance (shop)
no_nan_zero_fks:              10 tables, no FKs, 500 steps => all finite
no_nan_self_fk:               table with FK to itself, 500 steps => all finite
settles_500_tables_under_3s:  synthetic 500 tables / 1500 FKs, step until settled, elapsed < 3s (cargo test --release)
```
- [ ] **Step 2: Run** `cd core && cargo test --release` → FAIL.
- [ ] **Step 3: Implement** layout (octree built per step; self-FK ignored in springs; settled = max displacement < 0.01 for 10 consecutive steps).
- [ ] **Step 4: Run** → PASS; `./build-wasm.sh` produces `web/src/wasm/` (git-ignored).
- [ ] **Step 5: Commit** `feat(core): types and Barnes-Hut force layout`

### Task 6: Join-path search (Steiner trees)

**Files:**
- Create: `core/src/graph.rs`, `core/src/paths.rs`, `core/tests/paths.rs`

**Interfaces:**
- Produces: `Graph::new(g:&SchemaGraph) -> Graph` (undirected; self-FKs ignored; parallel FKs collapse to one edge remembering all FK ids); `Graph::table_index(&self, name:&str) -> Option<usize>`; `islands(g:&Graph) -> Vec<Vec<usize>>`; `type FkChoices = BTreeMap<String,String>` (key = two table names sorted, joined by `|`; value = fk id); `Tree{tables:Vec<usize>, fk_ids:Vec<String>, cost:u32, ambiguous_pairs:Vec<(usize,usize)>}` (a pair is ambiguous when it has >1 FK and no entry in FkChoices; default FK = lowest id); `steiner_trees(g:&Graph, required:&[usize], choices:&FkChoices, max:usize) -> Result<Vec<Tree>, PathError>` sorted by cost; `enum PathError{ Unreachable{islands:Vec<Vec<usize>>} }`. Exact Dreyfus–Wagner when `required.len() <= 8`, else shortest-path heuristic; alternates by removing each edge of the best tree in turn (Yen-style), de-duplicated.

- [ ] **Step 1: Write failing tests**:
```rust
chain_includes_middle:        A-B-C, required [A,C] -> tables {A,B,C}, 2 edges
single_required_table:        required [A] -> 1 table, 0 edges
diamond_has_two_alternates:   A-B-D and A-C-D, required [A,D] -> 2 trees, same cost
optimal_matches_bruteforce:   20 random 8-table graphs, DW cost == brute-force minimum
nine_required_heuristic_connected: 9 required tables on a 30-node graph -> one tree covering all 9
disconnected_unreachable:     required in two components -> Err(Unreachable) listing both islands
self_fk_ignored:              self-loop never appears in any tree
parallel_fks_ambiguous:       2 FKs between A,B -> ambiguous_pairs == [(A,B)]; with choice -> empty and chosen id used
max_respected:                max=2 -> at most 2 trees
```
- [ ] **Step 2: Run** `cargo test paths` → FAIL.
- [ ] **Step 3: Implement** `graph.rs` and `paths.rs`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(core): steiner join-path search`

### Task 7: Search types and diagnosis

**Files:**
- Create: `core/src/search.rs`, `core/src/diagnose.rs`, `core/tests/diagnose.rs`

**Interfaces:**
- Consumes: `Graph`, `islands`, `steiner_trees`, `FkChoices` (Task 6).
- Produces (serde; JSON = spec §3.4): `enum BoolOp{And,Or}`, `enum Cmp` (12 comparators, serialized as their SQL text), `#[serde(untagged)] enum Cond{ Group{op:BoolOp, children:Vec<Cond>}, Leaf{col:String, cmp:Cmp, value:Option<serde_json::Value>} }`, `SearchRequest{select:Vec<String>, r#where:Option<Cond> [json "where"], fk_choices:FkChoices}`.
- Produces: `enum FlagCode` (the 7 codes, SCREAMING_SNAKE in JSON); `Flag{code:FlagCode, table:Option<String>, column:Option<String>, message:String}`; `diagnose(g:&SchemaGraph, req:&SearchRequest) -> Vec<Flag>` (emits UNKNOWN_COLUMN, TYPE_MISMATCH, UNREACHABLE, AMBIGUOUS_FK); `reachable_request(g:&SchemaGraph, req:&SearchRequest) -> SearchRequest` (keeps the island holding most required tables, ties → island of first selected column; drops select columns and condition leaves outside it, and groups left empty; UNREACHABLE message names what was dropped). TYPE_MISMATCH rules: int types need a JSON integer, numeric a number, bool a bool, text/varchar/uuid/timestamptz a string (uuid must match uuid shape), `LIKE/ILIKE` only on text-like, `BETWEEN` needs 2-element array, `IN/NOT IN` need an array, `IS [NOT] NULL` takes no value.

- [ ] **Step 1: Write failing tests**:
```rust
unknown_column_flagged:        "public.users.nope" -> UNKNOWN_COLUMN with column set
type_mismatch_int_gets_string: orders.status = "abc" (int4) -> TYPE_MISMATCH
like_on_int_flagged:           users.id LIKE "1%" -> TYPE_MISMATCH
between_needs_two_values:      BETWEEN [1] -> TYPE_MISMATCH
unreachable_island_flagged:    isolated table + users selected -> UNREACHABLE naming the isolated table
reachable_request_drops_island: select [users.email, iso.x] -> select == [users.email]
dropped_group_removed:         group whose only leaf is on island disappears; siblings stay
ambiguous_fk_flagged:          parallel FKs, no choice -> AMBIGUOUS_FK; with fk_choices -> none
zero_fk_schema_all_islands:    select from 2 tables, no FKs -> UNREACHABLE, no panic
empty_select_no_flags_crash:   select [] -> returns [] without panic
serde_roundtrip:               spec §3.4 example JSON deserializes and re-serializes equal
```
- [ ] **Step 2: Run** `cargo test diagnose` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(core): search request types and diagnosis flags`

### Task 8: SQL candidate generation

**Files:**
- Create: `core/src/sqlgen.rs`, `core/tests/sqlgen.rs`

**Interfaces:**
- Consumes: `reachable_request`, `steiner_trees`, `Cond`, `SearchRequest` (Tasks 6–7).
- Produces: `SqlQuery{sql:String, params:Vec<serde_json::Value>}` (placeholders `$1..$n`); `enum Shape{Join, SemiJoin, Split}`; `Candidate{id:String ("c1".."c20"), shape:Shape, fk_ids:Vec<String>, tables:Vec<String>, queries:Vec<SqlQuery>, joins:u32, query_count:u32}`; `plan_candidates(g:&SchemaGraph, req:&SearchRequest) -> Vec<Candidate>` (max 20; empty vec when `select` is empty after `reachable_request`).
- Shapes: **Join** — one query joining the tree. **SemiJoin** — a filter-only leaf table of the tree becomes `EXISTS (...)`; generated only when all its conditions sit directly under a top-level AND. **Split** — cut one tree edge; each side is a Join query selecting its own columns plus that edge's key column; generated only when the top-level where is a pure AND; `/api/run` returns each result set separately (no app-side merge in v1).
- SQL rules: identifiers quoted `"schema"."table"` (split at first `.`; embedded `"` doubled); one alias per table `t0..tn`; `IN` → `IN ($1,$2)`; `BETWEEN` → `BETWEEN $1 AND $2`; `IS NULL` has no param; nested groups parenthesised.

- [ ] **Step 1: Write failing tests**:
```rust
single_table_no_join:     select [users.email] -> 1 candidate, joins == 0, sql has no JOIN
two_table_join_exact:     select users.email, orders.total where orders.status=0 ->
  SELECT "t0"."email", "t1"."total" FROM "public"."users" AS "t0" JOIN "public"."orders" AS "t1" ON "t1"."user_id" = "t0"."id" WHERE "t1"."status" = $1   (params [0])
params_never_inlined:     value "x' OR 1=1 --" and "50%;" appear in params only; sql contains neither
identifier_quoting:       tables "Order Items", `a"b`, "user" (reserved), audit.users vs public.users all quoted and distinct
between_in_isnull:        BETWEEN -> "$1 AND $2"; IN [1,2] -> "IN ($1,$2)"; IS NULL -> no params
nested_or_parenthesised:  AND(a, OR(b,c)) -> "a AND (b OR c)"
semijoin_generated:       filter-only leaf under top AND -> a SemiJoin candidate with EXISTS
split_requires_pure_and:  top-level OR -> no Split candidate
max_20_candidates:        dense 12-table graph -> len <= 20
empty_where_ok:           where None -> no WHERE clause
empty_select_none:        select [] -> []
fk_choice_used:           parallel FKs + fk_choices -> ON clause uses chosen fk columns
```
- [ ] **Step 2: Run** `cargo test sqlgen` → FAIL.
- [ ] **Step 3: Implement.** Candidate order: Join shapes by tree cost first, then SemiJoin, then Split; truncate to 20.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(core): sql candidate generation (join, semijoin, split)`

### Task 9: Ranking and WASM exports

**Files:**
- Create: `core/src/rank.rs`, `core/tests/rank.rs`
- Modify: `core/src/wasm.rs`

**Interfaces:**
- Consumes: `Candidate`, `Flag`, `FlagCode`.
- Produces: `ExplainCost{id:String, total_cost:f64, plan_rows:f64, error:Option<FlagCode>}` (one per candidate; cost summed over its queries); `Breakdown{cost:f64, joins:f64, queries:f64, rows:f64}`; `Ranked{id:String, score:f64, breakdown:Breakdown, reason:String}`; `rank(cands:&[Candidate], costs:&[ExplainCost]) -> Vec<Ranked>` — score = 0.5·norm(cost) + 0.25·norm(queries) + 0.15·norm(joins) + 0.10·norm(rows), min-max over candidates, lower is better, ties → fewer queries then id, top 5; candidates whose `ExplainCost.error` is set are excluded from ranking (all errored → empty result); `rank_flags(costs:&[ExplainCost]) -> Vec<Flag>` returns one PERMISSION/TIMEOUT flag per distinct errored code.
- Produces (wasm): `plan_candidates(graph_json:&str, req_json:&str) -> String`, `diagnose(graph_json, req_json) -> String`, `rank(cands_json, costs_json) -> String`, `rank_flags(costs_json) -> String` (all JSON).

- [ ] **Step 1: Write failing tests**:
```rust
cheapest_first:           3 candidates, lower cost ranks first when other metrics equal
fewer_queries_beat_cost_tie: equal cost, 1 query beats 2
weights_exact:            hand-computed score for a 2-candidate set equals 0.5/0.25/0.15/0.10 mix within 1e-9
top5_cap:                 12 candidates -> 5 results ascending score
single_candidate_norm_ok: one candidate -> score 0, no NaN
errored_excluded:         candidate with TIMEOUT error not in results; rank_flags returns TIMEOUT
all_errored:              -> empty ranked, flags non-empty
reason_mentions_counts:   reason contains "1 query" and "2 joins" for such a plan
```
Plus `wasm-pack test --headless --chrome`: `wasm_roundtrip_shop` — plan_candidates on the shop fixture returns parseable JSON.
- [ ] **Step 2: Run** `cargo test rank` → FAIL.
- [ ] **Step 3: Implement** rank and wasm wrappers.
- [ ] **Step 4: Run** `cargo test` and `wasm-pack test --headless --chrome` → PASS.
- [ ] **Step 5: Commit** `feat(core): ranking and wasm exports`

---

## Phase C — Explain/run API

### Task 10: Explain and run endpoints

**Files:**
- Create: `api/app/explain.py`, `api/app/routes_query.py`, `api/tests/test_explain.py`
- Modify: `api/app/main.py`

**Interfaces:**
- Consumes: `registry` (Task 4); `SqlQuery` shape `{sql, params}` from Task 8.
- Produces: `POST /api/explain` body `{candidates:[{id, queries:[SqlQuery]}], analyze:bool=false}` → `{results:[{id, total_cost, plan_rows, summary, error:{code,message}|null}]}` (costs summed over queries). `analyze=true` honored on sandbox; on live only when `LiveParams.allow_analyze` is true, else 403. `POST /api/run` body `{query:SqlQuery, limit:int=100}` (cap 1000) → `{columns, rows, row_count, flags:[Flag]}` with an `EMPTY_RESULT` flag when 0 rows. Error mapping: insufficient privilege → `PERMISSION`, query canceled → `TIMEOUT`, other → `SQL_ERROR`. Helper `to_driver_sql(sql:str, params:list) -> tuple[str, list]` converts `$n` to `%s` in order of use and escapes literal `%` as `%%`. Only a single `SELECT` (checked with pglast) is accepted; anything else → 400.

- [ ] **Step 1: Write failing tests**:
```python
test_dollar_params_and_percent_identifier  # table named "50%" with WHERE x = $1 runs; $1 used twice binds twice
test_explain_returns_cost                  # shop join query -> total_cost > 0, plan_rows > 0
test_explain_sums_split_queries            # two queries -> cost equals sum
test_rejects_non_select                    # "DROP TABLE users", "SELECT 1; SELECT 2" -> 400
test_live_analyze_forbidden_by_default     # live mode analyze=true -> 403
test_permission_error_mapped               # role without grant -> error.code == "PERMISSION"
test_timeout_mapped                        # pg_sleep(10) on live -> error.code == "TIMEOUT"
test_run_limit_default_and_cap             # no limit -> <=100 rows; limit=5000 -> <=1000
test_run_empty_flag                        # WHERE 1=0 -> flags has EMPTY_RESULT
test_injection_value_is_data               # param "x' OR 1=1 --" returns 0 rows, table intact
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `run` as `SELECT * FROM (<sql>) AS q LIMIT %s`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(api): explain and run endpoints with error mapping`

---

## Phase D — Web

### Task 11: Web scaffold, WASM worker, store

**Files:**
- Create: `web/package.json`, `web/vite.config.ts`, `web/tsconfig.json`, `web/index.html`, `web/src/main.tsx`, `web/src/App.tsx`, `web/src/types.ts`, `web/src/api/client.ts`, `web/src/core/coreWorker.ts`, `web/src/core/coreClient.ts`, `web/src/store/useStore.ts`, `web/src/store/useStore.test.ts`, `web/src/core/core.browser.test.ts`
- Modify: `web/Dockerfile` (multi-stage: rust + wasm-pack → node build → nginx static), `docker-compose.dev.yml`

**Interfaces:**
- Consumes: wasm package from `core/build-wasm.sh`; API endpoints (Tasks 2–4, 10).
- Produces: `types.ts` mirroring the JSON (`SchemaGraph, SearchRequest, Cond, Candidate, ExplainCost, Ranked, Flag, FlagCode`); `api/client.ts`: `getDefaultSchema()`, `postSchema(ddl)`, `connectLive(p)`, `disconnectLive()`, `getRows(table, limit, offset)`, `explain(cands, analyze)`, `run(query, limit)` (types from `openapi-typescript` via `npm run gen:api`).
- Produces: `core` (comlink proxy of worker) with `layoutNew(graph, seed): Promise<void>`, `layoutStep(n): Promise<Float32Array>`, `layoutSettled(): Promise<boolean>`, `planCandidates(graph, req): Promise<Candidate[]>`, `diagnose(graph, req): Promise<Flag[]>`, `rank(cands, costs): Promise<Ranked[]>`, `rankFlags(costs): Promise<Flag[]>`.
- Produces Zustand store fields/actions: `graph, positions:Float32Array, selectedTable:string|null, hoveredTable:string|null, sourceMode:'sandbox'|'live', drawer:'schema'|'source'|'search'|'results'|'settings'|null, searchRequest, results:Ranked[], flags:Flag[], tier:'high'|'medium'|'low'|'auto', reducedMotion:boolean`; `setGraph(g)` (resets selection/results), `selectTable(name|null)`, `setDrawer(d)`.

- [ ] **Step 1: Write failing tests**: `useStore.test.ts::setGraph_resets_selection_and_results`; `core.browser.test.ts` (Vitest browser mode, Playwright provider) `layout_of_shop_fixture_returns_75_floats` (25 tables × 3) and `plan_candidates_via_worker_returns_array`.
- [ ] **Step 2: Run** `npm test` → FAIL.
- [ ] **Step 3: Implement** scaffold; worker wraps `WasmLayout` and the JSON wasm functions; `App` renders the placeholder text "Cosmic Webs".
- [ ] **Step 4: Run** `npm test` → PASS; `docker compose up --build` serves the built app at `/`.
- [ ] **Step 5: Commit** `feat(web): scaffold, wasm worker client, store`

### Task 12: 3D scene base (dots, links, labels)

**Files:**
- Create: `web/src/scene/Scene.tsx`, `Dots.tsx`, `Links.tsx`, `Labels.tsx`, `useLayoutLoop.ts`, `style.ts`, `style.test.ts`, `e2eHook.ts`, `web/e2e/scene.spec.ts`
- Modify: `web/src/App.tsx` (loads `getDefaultSchema()` on start)

**Interfaces:**
- Consumes: store, `core`, `types` (Task 11).
- Produces: `dotRadius(rowEstimate:number, columnCount:number): number` = `2 + 3·log10(rowEstimate+1)` (uses `columnCount` when `rowEstimate` is 0); `clusterColor(graph, tableIndex): string` (connected component index mod 8 into the 8 `dot-glow` colors `#7FD1FF #A98BFF #FF9EC7 #7FFFD4 #FFD27F #9EB4FF #FF8F7F #C6FF8F`); `type DotState='idle'|'hover'|'selected'|'path'|'required'|'flagged'|'dimmed'`; `dotStyle(s:DotState): {glow:number, pulse:boolean, ring:string|null, opacity:number}` (hover glow 1.6; selected glow 2 + ring; path/required glow 1.8, no pulse; flagged ring `#FF5C6C`, glow 0; dimmed opacity 0.2; idle glow 1, pulse true, opacity 1); `type LinkState='idle'|'neighbor'|'path'|'ambiguous'`; `linkStyle(s): {opacity:number, dashed:boolean, color:string}` (0.25 / 0.6 / 0.9 / amber dashed).
- Produces e2e hook (only with `?e2e=1`, also freezes twinkle, pulse, idle): `window.__cosmos = { dotCount:number, linkCount:number, cameraPose():{pos:[n,n,n],target:[n,n,n]}, orbitTo(azimuthDeg:number):void, fps():number, lastRequest():SearchRequest|null }`.
- Behavior: dots and links are each one instanced draw call fed from the layout `Float32Array`; the layout loop steps in the worker until settled; hover shows label; labels also always shown for the 12 dots nearest the camera (fade by distance); `CameraControls` with drag-rotate, wheel-zoom, right-drag pan; self-FK drawn as a small loop.

- [ ] **Step 1: Write failing tests**: `style.test.ts` — `dotRadius(1000,5) ≈ 2+3*log10(1001)`; `dotRadius(0,5) == 2+3*log10(6)`; `dotStyle('dimmed').opacity == 0.2`; `dotStyle('selected').glow == 2`; `linkStyle('idle').opacity == 0.25`; `clusterColor` wraps after 8 components. `scene.spec.ts::default_schema_renders` — `/?e2e=1` → `__cosmos.dotCount == 25` and `linkCount == fixture.fks.length`; `zero_fk_graph_has_finite_positions` (upload DDL of 3 FK-less tables → `dotCount == 3`, no console errors).
- [ ] **Step 2: Run** `npm test && npx playwright test scene` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(web): 3D scene with dots, links, labels and layout loop`

### Task 13: Space environment and post-processing

**Files:**
- Create: `web/src/scene/space/Nebula.tsx`, `nebula.frag.glsl`, `Stars.tsx`, `Dust.tsx`, `Effects.tsx`, `quality.ts`, `quality.test.ts`, `web/e2e/sky.spec.ts`
- Modify: `web/src/scene/Scene.tsx`

**Interfaces:**
- Produces: `type Tier='high'|'medium'|'low'`; `TIERS: Record<Tier,{cubemap:number, stars:number, dust:number, bloom:'full'|'half'|'off', dof:boolean, grain:boolean}>` = high `{2048, 8560, 400, full, true, true}`, medium `{1024, 4000, 150, half, false, false}`, low `{512, 1500, 0, off, false, false}`; `starCounts(t:Tier): {far:number, mid:number, bright:number}` (high = 6000/2500/60, others scaled, summing to `TIERS[t].stars`); `pickTier(avgFps:number): Tier` (≥55 high, ≥35 medium, else low; measured over the first 3 s; `store.tier` overrides).
- Behavior (visual spec §1, §3, §6): nebula is a fixed-orientation 3D-fBm cubemap (5 octaves, fixed seed, luminance capped at 0.18) around the camera position, so orbiting changes the visible sky; far and bright stars follow the camera position; mid stars (r 600–1500) and dust (r 50–400) have real positions for parallax; twinkle 0.3–1.5 Hz, amplitude 25%; effects: Bloom (mipmap blur, threshold 0.6, intensity 1.2), Vignette 0.5, Noise 0.03, DepthOfField only while `store.flyingIn`. Query `?e2e=1&sky=only` hides dots, links and UI.

- [ ] **Step 1: Write failing tests**: `quality.test.ts` — `TIERS` equals the table above; `starCounts('high')` sums to 8560; `pickTier(60)=='high'`, `pickTier(40)=='medium'`, `pickTier(20)=='low'`. `sky.spec.ts` — with `?e2e=1&sky=only`: `sky_changes_after_90deg_orbit` (screenshot hash at `orbitTo(0)` ≠ hash at `orbitTo(90)`); `sky_identical_after_return` (hash at `orbitTo(0)` after orbiting away and back equals the first).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(web): nebula sky, stars, dust, post-processing, quality tiers`

### Task 14: Camera motion and transitions

**Files:**
- Create: `web/src/scene/camera/director.ts`, `director.test.ts`, `useCameraDirector.ts`, `Warp.tsx`, `reducedMotion.ts`, `web/e2e/camera.spec.ts`
- Modify: `web/src/scene/Scene.tsx`, `Dots.tsx` (apply `dimmed` during fly-in)

**Interfaces:**
- Produces: `type Vec3=[number,number,number]`, `type Pose={position:Vec3, target:Vec3}`; `easeInOutCubic(t:number): number`; `MOVE_MS = { open:2200, bang:1500, flyIn:1100, back:900, frameSet:1200, flag:1100 }`; `arcPose(from:Pose, to:Pose, t:number): Pose` (arcs, not a straight line); `flyInPose(dot:Vec3, radius:number, cameraPos:Vec3): Pose` (ends 3× radius from the dot); `frameSetPose(points:Vec3[], fovDeg:number): Pose` (fits bounding sphere); `IDLE_AFTER_MS = 20000`, `IDLE_DEG_PER_S = 0.6`; `class Director` with `play(kind, to:Pose, now:number)`, `cancel()`, `sample(now:number): Pose | null`, `durationFor(kind, reduced:boolean): number` (0.3 s fade when reduced).
- Hook actions on the store: `flyToTable(name)`, `back()` (pose stack), `frameAll()`, `frameTables(names)`, `resetView()`.
- Behavior (visual spec §5): app-open glide with warp streaks; schema load "big bang" (all dots from origin to random positions over 1.5 s, links fade in after movement slows); click dot → fly-in, others dim, table panel opens on arrival; Esc / empty-space click → back; idle auto-orbit after 20 s, stopped by any input; any input cancels a tween and a new move starts from the current pose (no jump); `prefers-reduced-motion` disables warp, idle and pulses.

- [ ] **Step 1: Write failing tests**: `director.test.ts` — `easeInOutCubic(0)==0`, `(1)==1`, `(0.5)==0.5`; `flyInPose` distance from dot == `3*radius` (±1e-6); `frameSetPose` keeps every input point inside the frustum; `retarget_starts_from_current_pose` (cancel mid-move at fake t=300 ms, new move's first sample equals the pose at cancel); `idle_starts_after_20000ms_and_stops_on_input`; `reduced_motion_duration_is_300`. `camera.spec.ts` — `click_dot_flies_to_3r` (after 1.3 s camera–dot distance ≈ 3·radius, panel visible); `esc_returns_to_previous_pose` (within 1.2 s); `reduced_motion_no_warp` (`emulateMedia({reducedMotion:'reduce'})`, move completes in ≤ 0.5 s).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `director.ts` as pure code; `useCameraDirector` drives drei `CameraControls.setLookAt` each frame.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(web): camera director, fly-in, big bang, idle orbit, reduced motion`

### Task 15: Sidebar, table panel, HUD, shortcuts

**Files:**
- Create: `web/src/ui/theme.css` (tokens + `ui-glass` rgba(12,14,30,0.55), blur 16px, border rgba(160,180,255,0.14)), `Rail.tsx`, `Drawer.tsx`, `SchemaPanel.tsx`, `SourcePanel.tsx`, `SettingsPanel.tsx`, `TablePanel.tsx`, `Hud.tsx`, `shortcuts.ts`, `shortcuts.test.ts`, `ui/ui.test.tsx`, `web/e2e/sidebar.spec.ts`
- Modify: `web/src/store/useStore.ts`, `web/src/App.tsx`

**Interfaces:**
- Consumes: api client (Task 11), director actions (Task 14).
- Produces store actions: `loadSchema(ddl:string): Promise<void>` (on `422` keeps the old graph and sets `schemaError:{message,line,col}`), `resetSchema()`, `connectLive(p:LiveParams)`, `disconnectLive()`; `keyToAction(e:{key:string, shiftKey?:boolean}): Action|null` with `/`→`focusSearch`, `Escape`→`back`, `f`→`frameAll`, `+`→`zoomIn`, `-`→`zoomOut`, arrows→`rotate15`.
- Layout (visual spec §7): 56 px left rail (Schema, Data source, Search, Results, Settings), 320 px glass drawer slides over the canvas (canvas never resizes), 420 px right table panel after fly-in (columns with PK/FK badges, rows paged 50 per page), bottom-right HUD (table count, link count, reset-view button). Settings: tier override (auto/high/medium/low) and reduced-motion override. Switching data source plays the 0.6 s shimmer (visual spec §5.10). Double-click empty space resets view.

- [ ] **Step 1: Write failing tests**: `shortcuts.test.ts` — each mapping above; `ui.test.tsx` — `rail_icon_opens_drawer`; `ddl_error_shows_line_and_keeps_graph`; `table_panel_shows_pk_fk_badges` (orders: `id` PK, `user_id` FK); `rows_paged_50`. `sidebar.spec.ts` — `upload_shop_sql_gives_25_dots`; `invalid_ddl_shows_error_dotcount_unchanged`; `live_connect_bad_host_shows_message`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(web): sidebar, schema/source/settings panels, table panel, HUD, shortcuts`

### Task 16: Search builder

**Files:**
- Create: `web/src/ui/search/searchTree.ts`, `searchTree.test.ts`, `ColumnPicker.tsx`, `ConditionEditor.tsx`, `ValueInput.tsx`, `SearchPanel.tsx`, `web/e2e/search-builder.spec.ts`

**Interfaces:**
- Produces (pure): `type Path=number[]`; `addLeaf(tree:Cond|null, path:Path, leaf:Cond): Cond`; `addGroup(tree, path, op:BoolOp): Cond`; `removeNode(tree, path): Cond|null` (removes groups left empty); `toggleOp(tree, path): Cond`; `cmpOptionsFor(pgType:string): Cmp[]` (no `LIKE/ILIKE` for non-text; bool only `= != IS NULL IS NOT NULL`); `parseValue(pgType:string, cmp:Cmp, raw:string): {ok:true,value:unknown}|{ok:false,error:string}` (`BETWEEN "1,5"` → `[1,5]`, `IN "a,b"` → `["a","b"]`, `IS NULL` → no value, `int4` rejects `"abc"`); `toRequest(select:string[], tree:Cond|null, fkChoices:FkChoices): SearchRequest` (exact spec §3.4 shape; empty tree → `where: null`).
- UI: ColumnPicker is a multiselect over every column in the schema, grouped by table, type-to-filter; ConditionEditor edits the AND/OR tree with typed value inputs; `/` focuses the picker; "Search" button calls `runSearch` (Task 17) and stores the request on `window.__cosmos.lastRequest()`.

- [ ] **Step 1: Write failing tests**: `searchTree.test.ts` — `addLeaf_nested_path`; `removeNode_prunes_empty_group`; `toRequest_matches_spec_example` (equals the §3.4 JSON for `users.email, orders.total`, `orders.status = 0 AND (users.name = "xxx" OR users.name ILIKE "%x%")`); `empty_tree_where_null`; `cmpOptions_bool_excludes_like`; `parseValue_int_rejects_text`; `parseValue_between`; `parseValue_in`; `percent_and_quote_values_preserved` (`"50%'; --"` stays byte-identical). `search-builder.spec.ts::builds_request` — pick 3 columns across 3 tables, add two conditions, click Search, `lastRequest()` deep-equals the expected request.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(web): search builder with multiselect columns and condition tree`

### Task 17: Search orchestration, results, path highlight

**Files:**
- Create: `web/src/search/runSearch.ts`, `runSearch.test.ts`, `web/src/ui/ResultsPanel.tsx`, `ResultCard.tsx`, `FlagList.tsx`, `FkChooser.tsx`, `web/src/scene/PathHighlight.tsx`, `web/e2e/search.spec.ts`
- Modify: `Dots.tsx`, `Links.tsx` (consume path/flag states), store

**Interfaces:**
- Consumes: `core`, `api.explain`, `api.run`, director `frameTables` / `flyToTable`.
- Produces: `type SearchOutcome={ranked:Ranked[], flags:Flag[]}`; `runSearch(req:SearchRequest, deps?:{core,api}): Promise<SearchOutcome>` — order: `core.diagnose` → `core.planCandidates` → `api.explain(candidates)` → map to `ExplainCost` → `core.rank` + `core.rankFlags`; flags from diagnose and rankFlags are merged and de-duplicated; empty candidates skips explain. Explain network failure → rejects with a message the panel shows.
- UI (visual spec §5.7–5.9, §7): Results shows ≤ 5 cards (rank, score bar, chips for joins / queries / cost, SQL in mono with copy button, reason) and a "Run" button per card that calls `api.run` (adds `EMPTY_RESULT` warning chip, shows first rows); on search, camera frames the required tables, non-path dots dim, path links light in join order; hovering a card highlights that plan's path only (0.25 s fade); clicking a flag flies to its table; clicking an amber dashed link opens FkChooser, choice updates `fk_choices` and reruns.

- [ ] **Step 1: Write failing tests**: `runSearch.test.ts` with fake deps — `calls_in_order` (diagnose, plan, explain, rank); `top5_at_most`; `merges_and_dedupes_flags`; `no_candidates_skips_explain`; `all_errors_returns_empty_ranked_with_flags`; `explain_failure_rejects`. `search.spec.ts` on sandbox shop — `ranked_results_shown` (select `users.email`, `orders.total`, filter `orders.status = 0` → 1–5 cards, first SQL contains `JOIN`, scores ascending); `unreachable_flag_flies_to_table` (isolated table + users → UNREACHABLE flag, click → camera moves to that dot); `ambiguous_fk_chooser_reruns` (parallel-FK pair → amber link, choose FK, results update); `percent_value_searches_safely` (`name ILIKE "50%'; --"` → results or empty, `users` table still has 1000 rows).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(web): search orchestration, ranked results, flags, path highlight`

### Task 18: Perf, visual snapshots, CI, README

**Files:**
- Create: `scripts/gen_synthetic_schema.py` (500 tables, ~1500 FKs → `samples/synthetic500.sql`), `web/e2e/perf.spec.ts`, `web/e2e/visual.spec.ts`, `.github/workflows/ci.yml`
- Modify: `README.md`

**Interfaces:**
- Consumes: `__cosmos.fps()`, `?e2e=1`, `orbitTo`, camera actions.

- [ ] **Step 1: Write failing tests**: `perf.spec.ts::five_hundred_tables` — upload `synthetic500.sql`, 5 s warm-up, then `__cosmos.fps() >= 50` and layout settled within 3 s of load; `visual.spec.ts` snapshots (fixed seed, frozen animation, fixed camera): `default`, `hover`, `selected`, `search_path`, `flags`, `reduced_motion`; `panel_contrast` computes WCAG AA contrast of panel text over the brightest nebula pose (≥ 4.5:1).
- [ ] **Step 2: Run** `npx playwright test perf visual` → FAIL (no fixture, no snapshots).
- [ ] **Step 3: Implement** the generator, record baseline snapshots, CI jobs: `cargo test`, `wasm-pack test --headless --chrome`, `pytest`, `npm test`, `npx playwright test`; README: `docker compose up`, dev override, running tests, spec links.
- [ ] **Step 4: Run** the full suite locally → PASS; `docker compose up --build` + `scripts/smoke.sh` → exit 0.
- [ ] **Step 5: Commit** `test: perf, visual snapshots, CI and README`
