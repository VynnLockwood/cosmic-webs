// JSON contracts shared with the API (pydantic) and the Rust core (serde).
export interface Column { name: string; type: string; nullable: boolean; pk: boolean }
export interface Table { name: string; columns: Column[]; row_estimate: number }
export interface FkEnd { table: string; columns: string[] }
export interface Fk { id: string; from: FkEnd; to: FkEnd }
export interface SchemaGraph { tables: Table[]; fks: Fk[] }
export interface ParseResult { graph: SchemaGraph; warnings: string[] }

export type BoolOp = "AND" | "OR";
export type Cmp = "=" | "!=" | "<" | "<=" | ">" | ">=" | "IN" | "NOT IN" | "LIKE" | "ILIKE" | "IS NULL" | "IS NOT NULL" | "BETWEEN";
export type Cond =
  | { op: BoolOp; children: Cond[] }
  | { col: string; cmp: Cmp; value?: unknown };
export type FkChoices = Record<string, string>;
export interface SearchRequest { select: string[]; where: Cond | null; fk_choices: FkChoices }

export type FlagCode = "UNREACHABLE" | "AMBIGUOUS_FK" | "TYPE_MISMATCH" | "UNKNOWN_COLUMN" | "PERMISSION" | "TIMEOUT" | "EMPTY_RESULT";
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
export interface RowsPage { columns: string[]; rows: unknown[][]; total_estimate: number }
export interface RunResult { columns: string[]; rows: unknown[][]; row_count: number; flags: Flag[] }
export interface SchemaError { message: string; line: number; col: number }
