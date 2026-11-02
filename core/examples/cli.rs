//! JSON-over-stdin driver for cross-language contract tests.
//!   cli plan     {"graph":…, "request":…}      -> candidates
//!   cli diagnose {"graph":…, "request":…}      -> flags
//!   cli rank     {"candidates":…, "costs":…}   -> {"ranked":…, "flags":…}
use cosmos_core::{diagnose, rank, search::SearchRequest, sqlgen, types::SchemaGraph};
use serde_json::{from_value, json, Value};
use std::io::Read;

fn main() {
    let mode = std::env::args().nth(1).expect("mode");
    let mut s = String::new();
    std::io::stdin().read_to_string(&mut s).unwrap();
    let v: Value = serde_json::from_str(&s).unwrap();
    let out = match mode.as_str() {
        "plan" | "diagnose" => {
            let g: SchemaGraph = from_value(v["graph"].clone()).unwrap();
            let r: SearchRequest = from_value(v["request"].clone()).unwrap();
            if mode == "plan" { json!(sqlgen::plan_candidates(&g, &r)) } else { json!(diagnose::diagnose(&g, &r)) }
        }
        "rank" => {
            let c: Vec<sqlgen::Candidate> = from_value(v["candidates"].clone()).unwrap();
            let x: Vec<rank::ExplainCost> = from_value(v["costs"].clone()).unwrap();
            json!({"ranked": rank::rank(&c, &x), "flags": rank::rank_flags(&x)})
        }
        m => panic!("unknown mode {m}"),
    };
    println!("{out}");
}
