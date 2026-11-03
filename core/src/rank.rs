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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Ranked {
    pub id: String,
    pub score: f64,
    pub breakdown: Breakdown,
    pub reason: String,
}

fn norm(v: f64, lo: f64, hi: f64) -> f64 {
    if hi - lo > 1e-12 { (v - lo) / (hi - lo) } else { 0.0 }
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
    let range = |f: &dyn Fn(&(&Candidate, &ExplainCost)) -> f64| {
        let v: Vec<f64> = items.iter().map(f).collect();
        (v.iter().cloned().fold(f64::MAX, f64::min), v.iter().cloned().fold(f64::MIN, f64::max))
    };
    let (c_lo, c_hi) = range(&|i| i.1.total_cost);
    let (q_lo, q_hi) = range(&|i| i.0.query_count as f64);
    let (j_lo, j_hi) = range(&|i| i.0.joins as f64);
    let (r_lo, r_hi) = range(&|i| i.1.plan_rows);
    let mut out: Vec<(u32, Ranked)> = items
        .iter()
        .map(|(c, x)| {
            let b = Breakdown {
                cost: W_COST * norm(x.total_cost, c_lo, c_hi),
                queries: W_QUERIES * norm(c.query_count as f64, q_lo, q_hi),
                joins: W_JOINS * norm(c.joins as f64, j_lo, j_hi),
                rows: W_ROWS * norm(x.plan_rows, r_lo, r_hi),
            };
            let reason = format!("{}, {}, est. cost {:.1} ({:?})", plural(c.query_count, "query", "queries"), plural(c.joins, "join", "joins"), x.total_cost, c.shape);
            (c.query_count, Ranked { id: c.id.clone(), score: b.cost + b.queries + b.joins + b.rows, breakdown: b, reason })
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
