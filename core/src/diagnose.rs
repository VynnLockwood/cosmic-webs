//! Static diagnosis of a search request against a schema: unknown columns, type
//! mismatches, unreachable tables, ambiguous FKs. Also trims a request to its reachable part.
use crate::graph::{islands, Graph};
use crate::paths::steiner_trees;
use crate::search::*;
use crate::types::SchemaGraph;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeSet;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FlagCode {
    Unreachable,
    AmbiguousFk,
    TypeMismatch,
    UnknownColumn,
    Permission,
    Timeout,
    EmptyResult,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Flag {
    pub code: FlagCode,
    pub table: Option<String>,
    pub column: Option<String>,
    pub message: String,
}

fn flag(code: FlagCode, table: Option<&str>, column: Option<&str>, message: String) -> Flag {
    Flag { code, table: table.map(String::from), column: column.map(String::from), message }
}

fn col_type<'a>(g: &'a SchemaGraph, col: &str) -> Option<(&'a str, &'a str)> {
    let (t, c) = split_col(col)?;
    let tb = g.tables.iter().find(|x| x.name == t)?;
    let cc = tb.columns.iter().find(|x| x.name == c)?;
    Some((tb.name.as_str(), cc.r#type.as_str()))
}

#[derive(PartialEq, Clone, Copy)]
enum Class {
    Int,
    Num,
    Bool,
    Text,
    Uuid,
    Json,
    Other,
}

fn class(t: &str) -> Class {
    match t {
        "int2" | "int4" | "int8" => Class::Int,
        "numeric" | "float4" | "float8" | "money" => Class::Num,
        "bool" => Class::Bool,
        "text" | "varchar" | "bpchar" | "citext" | "name" => Class::Text,
        "uuid" => Class::Uuid,
        "json" | "jsonb" => Class::Json,
        _ => Class::Other, // timestamps, dates, enums: written as strings
    }
}

fn is_uuid(s: &str) -> bool {
    let p: Vec<&str> = s.split('-').collect();
    p.len() == 5 && [8, 4, 4, 4, 12].iter().zip(&p).all(|(n, x)| x.len() == *n && x.chars().all(|c| c.is_ascii_hexdigit()))
}

fn valid(v: &Value, c: Class) -> bool {
    match c {
        Class::Int => v.is_i64() || v.is_u64(),
        Class::Num => v.is_number(),
        Class::Bool => v.is_boolean(),
        Class::Uuid => v.as_str().map_or(false, is_uuid),
        Class::Json => true,
        Class::Text | Class::Other => v.is_string(),
    }
}

fn check_leaf(typ: &str, cmp: Cmp, value: &Option<Value>) -> Option<String> {
    let c = class(typ);
    let val = value.as_ref().filter(|v| !v.is_null());
    match cmp {
        Cmp::IsNull | Cmp::IsNotNull => val.map(|_| "IS [NOT] NULL takes no value".to_string()),
        Cmp::Between => match val.and_then(|v| v.as_array()) {
            Some(a) if a.len() == 2 && a.iter().all(|x| valid(x, c)) => None,
            _ => Some(format!("BETWEEN needs two {typ} values")),
        },
        Cmp::In | Cmp::NotIn => match val.and_then(|v| v.as_array()) {
            Some(a) if !a.is_empty() && a.iter().all(|x| valid(x, c)) => None,
            _ => Some(format!("IN needs a list of {typ} values")),
        },
        Cmp::Like | Cmp::ILike => {
            if c != Class::Text {
                Some(format!("LIKE only works on text columns, not {typ}"))
            } else if val.map_or(true, |v| !v.is_string()) {
                Some("LIKE needs a text pattern".to_string())
            } else {
                None
            }
        }
        _ => match val {
            Some(v) if valid(v, c) => None,
            Some(_) => Some(format!("value does not fit column type {typ}")),
            None => Some("missing value (use IS NULL to test for NULL)".to_string()),
        },
    }
}

struct Refs {
    /// known (table, column-string) pairs from select and where
    known: Vec<String>,
}

fn all_cols(req: &SearchRequest) -> Vec<String> {
    let mut v = req.select.clone();
    if let Some(w) = &req.where_ {
        let mut ls = vec![];
        leaves(w, &mut ls);
        v.extend(ls.into_iter().map(|(c, _, _)| c));
    }
    v
}

fn known_refs(g: &SchemaGraph, req: &SearchRequest) -> Refs {
    Refs { known: all_cols(req).into_iter().filter(|c| col_type(g, c).is_some()).collect() }
}

/// Picks the island holding the most required tables (ties: island of the first selected column).
fn main_island(gr: &Graph, g: &SchemaGraph, req: &SearchRequest) -> Option<BTreeSet<usize>> {
    let refs = known_refs(g, req);
    let tables: Vec<usize> = refs.known.iter().filter_map(|c| split_col(c).and_then(|(t, _)| gr.table_index(t))).collect();
    if tables.is_empty() {
        return None;
    }
    let first = req.select.iter().find_map(|c| split_col(c).and_then(|(t, _)| gr.table_index(t)));
    let comps = islands(gr);
    let score = |c: &Vec<usize>| {
        let n = tables.iter().collect::<BTreeSet<_>>().iter().filter(|t| c.contains(t)).count();
        (n, first.map_or(false, |f| c.contains(&f)))
    };
    comps.iter().filter(|c| tables.iter().any(|t| c.contains(t))).max_by(|a, b| score(a).cmp(&score(b)).then(b[0].cmp(&a[0]))).map(|c| c.iter().copied().collect())
}

pub fn diagnose(g: &SchemaGraph, req: &SearchRequest) -> Vec<Flag> {
    let mut out = vec![];
    for c in all_cols(req) {
        if col_type(g, &c).is_none() {
            out.push(flag(FlagCode::UnknownColumn, split_col(&c).map(|x| x.0), Some(&c), format!("column {c} does not exist in the schema")));
        }
    }
    if let Some(w) = &req.where_ {
        let mut ls = vec![];
        leaves(w, &mut ls);
        for (col, cmp, val) in ls {
            if let Some((t, typ)) = col_type(g, &col) {
                if let Some(m) = check_leaf(typ, cmp, &val) {
                    out.push(flag(FlagCode::TypeMismatch, Some(t), Some(&col), format!("{col}: {m}")));
                }
            }
        }
    }
    let gr = Graph::new(g);
    let Some(main) = main_island(&gr, g, req) else { return out };
    let refs = known_refs(g, req);
    let mut dropped: BTreeSet<usize> = BTreeSet::new();
    let mut required: Vec<usize> = vec![];
    for c in &refs.known {
        if let Some(ti) = split_col(c).and_then(|(t, _)| gr.table_index(t)) {
            if main.contains(&ti) {
                required.push(ti);
            } else {
                dropped.insert(ti);
            }
        }
    }
    let main_names: Vec<&str> = main.iter().map(|&i| gr.names[i].as_str()).collect();
    for ti in dropped {
        out.push(flag(
            FlagCode::Unreachable,
            Some(&gr.names[ti]),
            None,
            format!("{} has no foreign-key path to {}; its columns and filters were dropped", gr.names[ti], main_names.join(", ")),
        ));
    }
    if let Ok(trees) = steiner_trees(&gr, &required, &req.fk_choices, 1) {
        if let Some(t) = trees.first() {
            for &(a, b) in &t.ambiguous_pairs {
                out.push(flag(
                    FlagCode::AmbiguousFk,
                    Some(&gr.names[a]),
                    None,
                    format!("{} and {} have several foreign keys ({}); choose one", gr.names[a], gr.names[b], gr.fk_ids_between(a, b).join(", ")),
                ));
            }
        }
    }
    out
}

fn prune(c: &Cond, keep: &dyn Fn(&str) -> bool) -> Option<Cond> {
    match c {
        Cond::Leaf { col, .. } => keep(col).then(|| c.clone()),
        Cond::Group { op, children } => {
            let kids: Vec<Cond> = children.iter().filter_map(|x| prune(x, keep)).collect();
            (!kids.is_empty()).then(|| Cond::Group { op: *op, children: kids })
        }
    }
}

/// The part of a request that can be answered: known columns inside the main island.
pub fn reachable_request(g: &SchemaGraph, req: &SearchRequest) -> SearchRequest {
    let gr = Graph::new(g);
    let Some(main) = main_island(&gr, g, req) else {
        return SearchRequest { select: vec![], where_: None, fk_choices: req.fk_choices.clone() };
    };
    let keep = |c: &str| col_type(g, c).is_some() && split_col(c).and_then(|(t, _)| gr.table_index(t)).map_or(false, |i| main.contains(&i));
    SearchRequest {
        select: req.select.iter().filter(|c| keep(c)).cloned().collect(),
        where_: req.where_.as_ref().and_then(|w| prune(w, &keep)),
        fk_choices: req.fk_choices.clone(),
    }
}
