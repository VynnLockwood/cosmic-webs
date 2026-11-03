//! Search request types (JSON contract = spec §3.4).
use crate::graph::FkChoices;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum BoolOp {
    And,
    Or,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Cmp {
    #[serde(rename = "=")]
    Eq,
    #[serde(rename = "!=")]
    Ne,
    #[serde(rename = "<")]
    Lt,
    #[serde(rename = "<=")]
    Le,
    #[serde(rename = ">")]
    Gt,
    #[serde(rename = ">=")]
    Ge,
    #[serde(rename = "IN")]
    In,
    #[serde(rename = "NOT IN")]
    NotIn,
    #[serde(rename = "LIKE")]
    Like,
    #[serde(rename = "ILIKE")]
    ILike,
    #[serde(rename = "IS NULL")]
    IsNull,
    #[serde(rename = "IS NOT NULL")]
    IsNotNull,
    #[serde(rename = "BETWEEN")]
    Between,
    #[serde(rename = "NOT LIKE")]
    NotLike,
    #[serde(rename = "NOT ILIKE")]
    NotILike,
    #[serde(rename = "NOT BETWEEN")]
    NotBetween,
    #[serde(rename = "~")]
    Regex,
    #[serde(rename = "~*")]
    IRegex,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Cond {
    Group {
        op: BoolOp,
        children: Vec<Cond>,
    },
    Not {
        not: Box<Cond>,
    },
    Leaf {
        col: String,
        cmp: Cmp,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        value: Option<Value>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AggFunc {
    Count,
    CountDistinct,
    Sum,
    Avg,
    Min,
    Max,
}

/// `col: None` means `COUNT(*)`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Aggregate {
    pub func: AggFunc,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub col: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alias: Option<String>,
}

/// HAVING on `aggregates[agg]`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Having {
    pub agg: usize,
    pub cmp: Cmp,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Dir {
    #[default]
    Asc,
    Desc,
}

/// Sort by a column (`col`) or by an aggregate (`agg`, an index into `aggregates`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OrderBy {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub col: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agg: Option<usize>,
    #[serde(default)]
    pub dir: Dir,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct SearchRequest {
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub distinct: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub aggregates: Vec<Aggregate>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub group_by: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub having: Vec<Having>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub order_by: Vec<OrderBy>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub offset: Option<u64>,
    #[serde(default)]
    pub select: Vec<String>,
    #[serde(rename = "where", default)]
    pub where_: Option<Cond>,
    #[serde(default)]
    pub fk_choices: FkChoices,
}

/// "public.users.email" -> ("public.users", "email")
pub fn split_col(col: &str) -> Option<(&str, &str)> {
    col.rsplit_once('.')
}

pub fn leaves(c: &Cond, out: &mut Vec<(String, Cmp, Option<Value>)>) {
    match c {
        Cond::Group { children, .. } => children.iter().for_each(|x| leaves(x, out)),
        Cond::Not { not } => leaves(not, out),
        Cond::Leaf { col, cmp, value } => out.push((col.clone(), *cmp, value.clone())),
    }
}

impl SearchRequest {
    /// Columns that are shown, grouped, aggregated or sorted on (the tables the result is built from).
    pub fn projected_cols(&self) -> Vec<String> {
        let mut v = self.select.clone();
        v.extend(self.group_by.iter().cloned());
        v.extend(self.aggregates.iter().filter_map(|a| a.col.clone()));
        v.extend(self.order_by.iter().filter_map(|o| o.col.clone()));
        v
    }
    /// True when the result is shaped (DISTINCT, ORDER BY, LIMIT, GROUP BY ...): it cannot be split across queries.
    pub fn is_shaped(&self) -> bool {
        self.distinct || !self.aggregates.is_empty() || !self.group_by.is_empty() || !self.order_by.is_empty() || self.limit.is_some() || self.offset.is_some()
    }
}
