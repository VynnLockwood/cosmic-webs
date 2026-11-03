// JSON contracts shared with the API (pydantic) and the Rust core (serde).
export interface Column { name: string; type: string; nullable: boolean; pk: boolean }
export interface Table { name: string; columns: Column[]; row_estimate: number }
export interface FkEnd { table: string; columns: string[] }
export interface Fk { id: string; from: FkEnd; to: FkEnd }
export interface SchemaGraph { tables: Table[]; fks: Fk[] }
/** What the sandbox now holds: the rows of the uploaded file, or generated mock rows. */
export interface ImportData { source: "dump" | "mock"; rows_loaded: number; tables_with_data: number; tables_empty: number }
export interface JobState { id: string; status: "running" | "done" | "error"; stage: string; message: string; percent: number; result?: ParseResult | null; error?: string | null }
export interface ImportProgressInfo { stage: string; percent: number; message: string }
export interface ParseResult { graph: SchemaGraph; warnings: string[]; data?: ImportData }

export type BoolOp = "AND" | "OR";
export type Cmp = "=" | "!=" | "<" | "<=" | ">" | ">=" | "IN" | "NOT IN" | "LIKE" | "ILIKE" | "NOT LIKE" | "NOT ILIKE" | "~" | "~*" | "IS NULL" | "IS NOT NULL" | "BETWEEN" | "NOT BETWEEN";
export type Cond =
  | { op: BoolOp; children: Cond[] }
  | { not: Cond }
  | { col: string; cmp: Cmp; value?: unknown };
export type AggFunc = "COUNT" | "COUNT_DISTINCT" | "SUM" | "AVG" | "MIN" | "MAX";
/** `col` omitted = COUNT(*) */
export interface Aggregate { func: AggFunc; col?: string; alias?: string }
export interface Having { agg: number; cmp: Cmp; value?: unknown }
/** sort by a column (`col`) or an aggregate (`agg`, index into `aggregates`) */
export interface OrderBy { col?: string; agg?: number; dir?: "ASC" | "DESC" }
export type FkChoices = Record<string, string>;
export interface SearchRequest {
  select: string[];
  where: Cond | null;
  fk_choices: FkChoices;
  distinct?: boolean;
  aggregates?: Aggregate[];
  group_by?: string[];
  having?: Having[];
  order_by?: OrderBy[];
  limit?: number;
  offset?: number;
}

export type FlagCode = "UNREACHABLE" | "AMBIGUOUS_FK" | "TYPE_MISMATCH" | "UNKNOWN_COLUMN" | "PERMISSION" | "TIMEOUT" | "EMPTY_RESULT" | "INVALID_QUERY";
export interface Flag { code: FlagCode; table: string | null; column: string | null; message: string }

export interface SqlQuery { sql: string; params: unknown[] }
export type Shape = "Join" | "SemiJoin" | "Split";
export interface Candidate { id: string; shape: Shape; fk_ids: string[]; tables: string[]; queries: SqlQuery[]; joins: number; query_count: number }
export interface ExplainCost { id: string; total_cost: number; plan_rows: number; exec_ms?: number | null; error?: FlagCode | null }
export interface ExplainResult { id: string; total_cost: number; plan_rows: number; exec_ms: number | null; summary: string; error: { code: string; message: string } | null }
export interface Metric { value: number; best: number; worst: number; norm: number; weight: number; points: number }
export interface RankDetails { cost: Metric; queries: Metric; joins: Metric; rows: Metric }
export interface Ranked {
  id: string;
  score: number;
  breakdown: { cost: number; joins: number; queries: number; rows: number };
  reason: string;
  /** "time" = ranked by measured run time, "cost" = planner estimate */
  metric: "time" | "cost";
  /** how many plans were compared */
  compared: number;
  detail: RankDetails;
}

export interface LiveParams { host: string; port: number; dbname: string; user: string; password: string; schema?: string; allow_analyze?: boolean }
export interface ColumnValues { values: { value: unknown; count: number }[]; truncated: boolean }
export interface RowsPage { columns: string[]; rows: unknown[][]; total_estimate: number }
export interface RunResult { columns: string[]; rows: unknown[][]; row_count: number; /** more rows exist than were returned */ truncated?: boolean; flags: Flag[] }
export interface SchemaError { message: string; line: number; col: number }

// ---- structure lab (sandbox-only schema editing) ----
export interface IndexInfo { schema: string; table: string; name: string; columns: string[]; unique: boolean; primary: boolean; definition: string }
export type StructureOp =
  | { kind: "create_index"; table: string; columns: string[]; unique?: boolean }
  | { kind: "drop_index"; schema: string; name: string }
  | { kind: "add_fk"; table: string; columns: string[]; ref_table: string; ref_columns: string[]; validate?: boolean }
  | { kind: "drop_fk"; table: string; name: string }
  | { kind: "add_column"; table: string; name: string; type: string }
  | { kind: "drop_column"; table: string; name: string }
  | { kind: "sql"; statement: string };
export interface StructureState { graph: SchemaGraph; indexes: IndexInfo[] }
export type StructureResult = StructureState & { executed: string[] };

/** One row of the before/after comparison: the best plan after a change. */
export interface Experiment {
  id: number;
  label: string;
  plans: number;
  best: { id: string; shape: Shape; joins: number; queries: number; value: number; metric: "cost" | "time"; score: number; sql: string } | null;
  flags: number;
}

/** A relation the schema does not declare, inferred from column names and (for real data) confirmed by the rows. */
export interface Suggestion {
  id: string; from_table: string; from_columns: string[]; to_table: string; to_columns: string[]; reason: string;
  checked: number | null; matched: number | null; verified: boolean;
}
export interface SuggestionsResult { data_source: "dump" | "mock" | "live"; suggestions: Suggestion[] }
