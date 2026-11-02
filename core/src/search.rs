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
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Cond {
    Group { op: BoolOp, children: Vec<Cond> },
    Leaf {
        col: String,
        cmp: Cmp,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        value: Option<Value>,
    },
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct SearchRequest {
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
        Cond::Leaf { col, cmp, value } => out.push((col.clone(), *cmp, value.clone())),
    }
}
