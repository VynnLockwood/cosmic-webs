//! Ranking: combine static plan metrics with EXPLAIN costs. Lower score is better.
use crate::diagnose::{Flag, FlagCode};
use crate::sqlgen::Candidate;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

pub const W_COST: f64 = 0.5;
pub const W_QUERIES: f64 = 0.25;
pub const W_JOINS: f64 = 0.15;
pub const W_ROWS: f64 = 0.10;
pub const TOP_N: usize = 5;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExplainCost {
    pub id: String,
    pub total_cost: f64,
    pub plan_rows: f64,
    /// measured execution time (EXPLAIN ANALYZE), summed over the candidate's queries
    #[serde(default)]
    pub exec_ms: Option<f64>,
    #[serde(default)]
    pub error: Option<FlagCode>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Breakdown {
    pub cost: f64,
    pub joins: f64,
    pub queries: f64,
    pub rows: f64,
}

/// One line of the score sheet: where a plan stands on a metric and how many score points it costs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Metric {
    pub value: f64,
    /// best / worst value among all compared plans
    pub best: f64,
    pub worst: f64,
    /// 0 = best of the compared plans, 1 = worst
    pub norm: f64,
    pub weight: f64,
    /// weight * norm: what this metric adds to the score
    pub points: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Details {
    /// estimated planner cost, or measured milliseconds when every plan was timed (see `Ranked::metric`)
    pub cost: Metric,
    pub queries: Metric,
    pub joins: Metric,
    pub rows: Metric,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Ranked {
    pub id: String,
    pub score: f64,
    pub breakdown: Breakdown,
    pub reason: String,
    /// "time" when ranked by measured run time, otherwise "cost" (planner estimate)
    pub metric: String,
    /// how many plans were compared (the normalisation set)
    pub compared: usize,
    pub detail: Details,
}

fn norm(v: f64, lo: f64, hi: f64) -> f64 {
    if hi - lo > 1e-12 { (v - lo) / (hi - lo) } else { 0.0 }
}

/// Measured times closer together than this are noise, not a difference.
fn time_noise_floor(lo: f64) -> f64 {
    f64::max(0.5, 0.1 * lo)
}

fn plural(n: u32, one: &str, many: &str) -> String {
    format!("{n} {}", if n == 1 { one } else { many })
}

pub fn rank(cands: &[Candidate], costs: &[ExplainCost]) -> Vec<Ranked> {
    let items: Vec<(&Candidate, &ExplainCost)> = cands
        .iter()
        .filter_map(|c| costs.iter().find(|x| x.id == c.id).filter(|x| x.error.is_none()).map(|x| (c, x)))
        .collect();
    if items.is_empty() {
        return vec![];
    }
    let by_time = items.iter().all(|(_, x)| x.exec_ms.is_some());
    let primary = |i: &(&Candidate, &ExplainCost)| if by_time { i.1.exec_ms.unwrap() } else { i.1.total_cost };
    let range = |f: &dyn Fn(&(&Candidate, &ExplainCost)) -> f64| {
        let v: Vec<f64> = items.iter().map(f).collect();
        (v.iter().cloned().fold(f64::MAX, f64::min), v.iter().cloned().fold(f64::MIN, f64::max))
    };
    let (c_lo, c_hi) = range(&primary);
    let (q_lo, q_hi) = range(&|i| i.0.query_count as f64);
    let (j_lo, j_hi) = range(&|i| i.0.joins as f64);
    let (r_lo, r_hi) = range(&|i| i.1.plan_rows);
    let metric = |value: f64, lo: f64, hi: f64, weight: f64, n: f64| Metric { value, best: lo, worst: hi, norm: n, weight, points: weight * n };
    let mut out: Vec<(u32, Ranked)> = items
        .iter()
        .map(|it| {
            let (c, x) = *it;
            let cn = if by_time && c_hi - c_lo < time_noise_floor(c_lo) { 0.0 } else { norm(primary(it), c_lo, c_hi) };
            let detail = Details {
                cost: metric(primary(it), c_lo, c_hi, W_COST, cn),
                queries: metric(c.query_count as f64, q_lo, q_hi, W_QUERIES, norm(c.query_count as f64, q_lo, q_hi)),
                joins: metric(c.joins as f64, j_lo, j_hi, W_JOINS, norm(c.joins as f64, j_lo, j_hi)),
                rows: metric(x.plan_rows, r_lo, r_hi, W_ROWS, norm(x.plan_rows, r_lo, r_hi)),
            };
            let b = Breakdown { cost: detail.cost.points, queries: detail.queries.points, joins: detail.joins.points, rows: detail.rows.points };
            let how = if by_time { format!("measured {:.2} ms", primary(it)) } else { format!("est. cost {:.1}", x.total_cost) };
            let reason = format!("{}, {}, {} ({:?})", plural(c.query_count, "query", "queries"), plural(c.joins, "join", "joins"), how, c.shape);
            (c.query_count, Ranked { id: c.id.clone(), score: b.cost + b.queries + b.joins + b.rows, breakdown: b, reason, metric: if by_time { "time" } else { "cost" }.into(), compared: items.len(), detail })
        })
        .collect();
    out.sort_by(|a, b| a.1.score.partial_cmp(&b.1.score).unwrap().then(a.0.cmp(&b.0)).then(a.1.id.cmp(&b.1.id)));
    out.into_iter().take(TOP_N).map(|x| x.1).collect()
}

/// One flag per distinct error code reported by EXPLAIN.
pub fn rank_flags(costs: &[ExplainCost]) -> Vec<Flag> {
    let codes: BTreeSet<String> = costs.iter().filter_map(|c| c.error).map(|c| format!("{c:?}")).collect();
    let mut out = vec![];
    for code in [FlagCode::Permission, FlagCode::Timeout] {
        if codes.contains(&format!("{code:?}")) {
            let n = costs.iter().filter(|c| c.error == Some(code)).count();
            let what = if code == FlagCode::Permission { "permission denied" } else { "timed out" };
            out.push(Flag { code, table: None, column: None, message: format!("{n} candidate plan(s) {what}") });
        }
    }
    out
}
