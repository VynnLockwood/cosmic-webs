//! SQL candidate generation: Join, SemiJoin (EXISTS) and Split plans. Values are always bind params.
use crate::diagnose::reachable_request;
use crate::graph::Graph;
use crate::paths::{steiner_trees, Tree};
use crate::search::*;
use crate::types::{Fk, SchemaGraph};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeSet, HashMap, VecDeque};

pub const MAX_CANDIDATES: usize = 20;
const MAX_TREES: usize = 6;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SqlQuery {
    pub sql: String,
    pub params: Vec<Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Shape {
    Join,
    SemiJoin,
    Split,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Candidate {
    pub id: String,
    pub shape: Shape,
    pub fk_ids: Vec<String>,
    pub tables: Vec<String>,
    pub queries: Vec<SqlQuery>,
    pub joins: u32,
    pub query_count: u32,
}

fn q(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\"\""))
}

fn qt(name: &str) -> String {
    match name.split_once('.') {
        Some((s, t)) => format!("{}.{}", q(s), q(t)),
        None => q(name),
    }
}

struct Ctx<'a> {
    g: &'a SchemaGraph,
    gr: &'a Graph,
}

impl<'a> Ctx<'a> {
    fn fk(&self, id: &str) -> &'a Fk {
        self.g.fks.iter().find(|f| f.id == id).expect("fk id from tree exists")
    }
    fn tidx(&self, col: &str) -> usize {
        self.gr.table_index(split_col(col).unwrap().0).unwrap()
    }
}

fn cond_tables(ctx: &Ctx, c: &Cond, out: &mut BTreeSet<usize>) {
    match c {
        Cond::Group { children, .. } => children.iter().for_each(|x| cond_tables(ctx, x, out)),
        Cond::Leaf { col, .. } => {
            out.insert(ctx.tidx(col));
        }
    }
}

fn conjuncts(w: &Option<Cond>) -> Vec<Cond> {
    match w {
        None => vec![],
        Some(Cond::Group { op: BoolOp::And, children }) => children.clone(),
        Some(c) => vec![c.clone()],
    }
}

fn compile(c: &Cond, alias: &dyn Fn(&str) -> String, params: &mut Vec<Value>, nested: bool) -> String {
    match c {
        Cond::Group { op, children } => {
            if children.len() == 1 {
                return compile(&children[0], alias, params, nested);
            }
            let sep = if *op == BoolOp::And { " AND " } else { " OR " };
            let parts: Vec<String> = children.iter().map(|x| compile(x, alias, params, true)).collect();
            let s = parts.join(sep);
            if nested { format!("({s})") } else { s }
        }
        Cond::Leaf { col, cmp, value } => {
            let name = format!("{}.{}", alias(col), q(split_col(col).unwrap().1));
            let mut ph = |v: &Value| {
                params.push(v.clone());
                format!("${}", params.len())
            };
            let arr = value.as_ref().and_then(|v| v.as_array()).cloned().unwrap_or_default();
            match cmp {
                Cmp::IsNull => format!("{name} IS NULL"),
                Cmp::IsNotNull => format!("{name} IS NOT NULL"),
                Cmp::Between => {
                    let a = ph(arr.first().unwrap_or(&Value::Null));
                    let b = ph(arr.get(1).unwrap_or(&Value::Null));
                    format!("{name} BETWEEN {a} AND {b}")
                }
                Cmp::In | Cmp::NotIn => {
                    let list: Vec<String> = arr.iter().map(&mut ph).collect();
                    format!("{name} {} ({})", if *cmp == Cmp::In { "IN" } else { "NOT IN" }, list.join(","))
                }
                _ => {
                    let op = match cmp {
                        Cmp::Eq => "=",
                        Cmp::Ne => "!=",
                        Cmp::Lt => "<",
                        Cmp::Le => "<=",
                        Cmp::Gt => ">",
                        Cmp::Ge => ">=",
                        Cmp::Like => "LIKE",
                        _ => "ILIKE",
                    };
                    let p = ph(value.as_ref().unwrap_or(&Value::Null));
                    format!("{name} {op} {p}")
                }
            }
        }
    }
}

fn on_clause(ctx: &Ctx, fk_id: &str, alias: &dyn Fn(usize) -> String) -> String {
    let f = ctx.fk(fk_id);
    let (a, b) = (ctx.gr.table_index(&f.from.table).unwrap(), ctx.gr.table_index(&f.to.table).unwrap());
    f.from.columns.iter().zip(&f.to.columns).map(|(c1, c2)| format!("{}.{} = {}.{}", alias(a), q(c1), alias(b), q(c2))).collect::<Vec<_>>().join(" AND ")
}

struct Semi {
    table: usize,
    parent: usize,
    fk_id: String,
    conds: Vec<Cond>,
}

/// One SELECT over a connected set of tables.
#[allow(clippy::too_many_arguments)]
fn join_query(ctx: &Ctx, root: usize, edges: &[(usize, usize, String)], select: &[String], extra: &[(usize, String)], conds: &[Cond], semis: &[Semi]) -> SqlQuery {
    let mut order = vec![root];
    let mut parent_edge: HashMap<usize, String> = HashMap::new();
    let mut q_ = VecDeque::from([root]);
    while let Some(v) = q_.pop_front() {
        for (a, b, id) in edges {
            let w = if *a == v { *b } else if *b == v { *a } else { continue };
            if !order.contains(&w) {
                order.push(w);
                parent_edge.insert(w, id.clone());
                q_.push_back(w);
            }
        }
    }
    let alias_map: HashMap<usize, String> = order.iter().enumerate().map(|(i, t)| (*t, q(&format!("t{i}")))).collect();
    let alias_t = |t: usize| alias_map[&t].clone();
    let alias_c = |c: &str| alias_map[&ctx.tidx(c)].clone();
    let mut cols: Vec<String> = select.iter().map(|c| format!("{}.{}", alias_c(c), q(split_col(c).unwrap().1))).collect();
    cols.extend(extra.iter().map(|(t, c)| format!("{}.{}", alias_t(*t), q(c))));
    let mut sql = format!("SELECT {} FROM {} AS {}", cols.join(", "), qt(&ctx.gr.names[root]), alias_t(root));
    for t in order.iter().skip(1) {
        sql += &format!(" JOIN {} AS {} ON {}", qt(&ctx.gr.names[*t]), alias_t(*t), on_clause(ctx, &parent_edge[t], &|x| alias_t(x)));
    }
    let mut params = vec![];
    let nested = conds.len() + semis.len() > 1;
    let mut parts: Vec<String> = conds.iter().map(|c| compile(c, &alias_c, &mut params, nested)).collect();
    for (k, s) in semis.iter().enumerate() {
        let ea = q(&format!("e{k}"));
        let ealias = |_: &str| ea.clone();
        let inner: Vec<String> = s.conds.iter().map(|c| compile(c, &ealias, &mut params, s.conds.len() > 1)).collect();
        let link = on_clause(ctx, &s.fk_id, &|x| if x == s.table { ea.clone() } else { alias_t(s.parent) });
        parts.push(format!("EXISTS (SELECT 1 FROM {} AS {} WHERE {} AND {})", qt(&ctx.gr.names[s.table]), ea, inner.join(" AND "), link));
    }
    if !parts.is_empty() {
        sql += &format!(" WHERE {}", parts.join(" AND "));
    }
    SqlQuery { sql, params }
}

fn tree_edges(t: &Tree) -> Vec<(usize, usize, String)> {
    t.edges.iter().zip(&t.fk_ids).map(|(e, id)| (e.0, e.1, id.clone())).collect()
}

fn names(ctx: &Ctx, t: &Tree) -> Vec<String> {
    t.tables.iter().map(|&i| ctx.gr.names[i].clone()).collect()
}

pub fn plan_candidates(g: &SchemaGraph, req: &SearchRequest) -> Vec<Candidate> {
    let r = reachable_request(g, req);
    if r.select.is_empty() {
        return vec![];
    }
    let gr = Graph::new(g);
    let ctx = Ctx { g, gr: &gr };
    let mut leaf_list = vec![];
    if let Some(w) = &r.where_ {
        leaves(w, &mut leaf_list);
    }
    let sel_tables: BTreeSet<usize> = r.select.iter().map(|c| ctx.tidx(c)).collect();
    let mut required: Vec<usize> = sel_tables.iter().copied().collect();
    required.extend(leaf_list.iter().map(|(c, _, _)| ctx.tidx(c)));
    required.sort();
    required.dedup();
    let Ok(trees) = steiner_trees(&gr, &required, &r.fk_choices, MAX_TREES) else { return vec![] };
    let root = ctx.tidx(&r.select[0]);
    let all = conjuncts(&r.where_);
    let mut out: Vec<Candidate> = vec![];
    let mk = |shape, t: &Tree, queries: Vec<SqlQuery>, joins: u32| Candidate { id: String::new(), shape, fk_ids: t.fk_ids.clone(), tables: names(&ctx, t), query_count: queries.len() as u32, queries, joins };

    // 1. Join
    for t in &trees {
        let qy = join_query(&ctx, root, &tree_edges(t), &r.select, &[], &all, &[]);
        out.push(mk(Shape::Join, t, vec![qy], t.edges.len() as u32));
    }
    // 2. SemiJoin: filter-only leaf tables become EXISTS
    for t in &trees {
        let mut semis = vec![];
        let mut dropped = BTreeSet::new();
        for &f in &t.tables {
            let nbrs: Vec<&(usize, usize)> = t.edges.iter().filter(|e| e.0 == f || e.1 == f).collect();
            if f == root || sel_tables.contains(&f) || nbrs.len() != 1 {
                continue;
            }
            let mine: Vec<&Cond> = all.iter().filter(|c| { let mut s = BTreeSet::new(); cond_tables(&ctx, c, &mut s); s.contains(&f) }).collect();
            let only_f = mine.iter().all(|c| { let mut s = BTreeSet::new(); cond_tables(&ctx, c, &mut s); s.len() == 1 });
            if mine.is_empty() || !only_f {
                continue;
            }
            let e = nbrs[0];
            let idx = t.edges.iter().position(|x| x == e).unwrap();
            semis.push(Semi { table: f, parent: if e.0 == f { e.1 } else { e.0 }, fk_id: t.fk_ids[idx].clone(), conds: mine.into_iter().cloned().collect() });
            dropped.insert(f);
        }
        if semis.is_empty() || dropped.len() == t.tables.len() {
            continue;
        }
        let edges: Vec<_> = tree_edges(t).into_iter().filter(|e| !dropped.contains(&e.0) && !dropped.contains(&e.1)).collect();
        let rest: Vec<Cond> = all.iter().filter(|c| { let mut s = BTreeSet::new(); cond_tables(&ctx, c, &mut s); !(s.len() == 1 && dropped.contains(s.iter().next().unwrap())) }).cloned().collect();
        let qy = join_query(&ctx, root, &edges, &r.select, &[], &rest, &semis);
        out.push(mk(Shape::SemiJoin, t, vec![qy], edges.len() as u32));
    }
    // 3. Split: only when the filter is a pure AND of per-table conjuncts
    let pure_and = match &r.where_ {
        None => true,
        Some(Cond::Group { op: BoolOp::And, .. }) | Some(Cond::Leaf { .. }) => true,
        Some(Cond::Group { .. }) => false,
    };
    if pure_and {
        for t in &trees {
            for (ei, &(a, b)) in t.edges.iter().enumerate() {
                let (ca, cb) = components(&t.edges, ei, a, b);
                if !ca.iter().any(|x| sel_tables.contains(x)) || !cb.iter().any(|x| sel_tables.contains(x)) {
                    continue;
                }
                let fk = ctx.fk(&t.fk_ids[ei]);
                let mut qs = vec![];
                let mut ok = true;
                for comp in [&ca, &cb] {
                    let edges: Vec<_> = tree_edges(t).into_iter().filter(|e| comp.contains(&e.0) && comp.contains(&e.1)).collect();
                    let sel: Vec<String> = r.select.iter().filter(|c| comp.contains(&ctx.tidx(c))).cloned().collect();
                    let conds: Vec<Cond> = all.iter().filter(|c| { let mut s = BTreeSet::new(); cond_tables(&ctx, c, &mut s); s.iter().all(|x| comp.contains(x)) }).cloned().collect();
                    let spanning = all.iter().any(|c| { let mut s = BTreeSet::new(); cond_tables(&ctx, c, &mut s); !s.iter().all(|x| ca.contains(x)) && !s.iter().all(|x| cb.contains(x)) });
                    if spanning || sel.is_empty() {
                        ok = false;
                        break;
                    }
                    let (side_t, side_cols) = if comp.contains(&ctx.gr.table_index(&fk.from.table).unwrap()) { (&fk.from.table, &fk.from.columns) } else { (&fk.to.table, &fk.to.columns) };
                    let ti = ctx.gr.table_index(side_t).unwrap();
                    let extra: Vec<(usize, String)> = side_cols.iter().map(|c| (ti, c.clone())).collect();
                    let r0 = ctx.tidx(&sel[0]);
                    qs.push(join_query(&ctx, r0, &edges, &sel, &extra, &conds, &[]));
                }
                if ok {
                    out.push(mk(Shape::Split, t, qs, t.edges.len() as u32 - 1));
                }
            }
        }
    }
    out.truncate(MAX_CANDIDATES);
    for (i, c) in out.iter_mut().enumerate() {
        c.id = format!("c{}", i + 1);
    }
    out
}

/// Tables on each side after removing edge `skip` (between a and b).
fn components(edges: &[(usize, usize)], skip: usize, a: usize, b: usize) -> (Vec<usize>, Vec<usize>) {
    let reach = |start: usize| {
        let mut seen = vec![start];
        let mut changed = true;
        while changed {
            changed = false;
            for (i, e) in edges.iter().enumerate() {
                if i == skip {
                    continue;
                }
                for (x, y) in [(e.0, e.1), (e.1, e.0)] {
                    if seen.contains(&x) && !seen.contains(&y) {
                        seen.push(y);
                        changed = true;
                    }
                }
            }
        }
        seen
    };
    (reach(a), reach(b))
}
