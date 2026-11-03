export default function init(): Promise<unknown>;
export class WasmLayout {
  constructor(graph_json: string, seed: number);
  step(n: number): void;
  positions(): Float32Array;
  settled(): boolean;
  free?(): void;
}
export function plan_candidates(graph_json: string, req_json: string): string;
export function diagnose(graph_json: string, req_json: string): string;
export function rank(cands_json: string, costs_json: string): string;
export function rank_flags(costs_json: string): string;
