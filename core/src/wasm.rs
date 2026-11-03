use crate::layout::Layout;
use crate::types::SchemaGraph;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct WasmLayout {
    inner: Layout,
}

#[wasm_bindgen]
impl WasmLayout {
    #[wasm_bindgen(constructor)]
    pub fn new(graph_json: &str, seed: u32) -> Result<WasmLayout, JsError> {
        let g: SchemaGraph = serde_json::from_str(graph_json).map_err(|e| JsError::new(&e.to_string()))?;
        Ok(WasmLayout { inner: Layout::new(&g, seed) })
    }
    /// Like `new`, but keeps the given x,y,z positions (NaN = place randomly); used after structure edits.
    pub fn with_positions(graph_json: &str, seed: u32, init: Vec<f32>) -> Result<WasmLayout, JsError> {
        let g: SchemaGraph = serde_json::from_str(graph_json).map_err(|e| JsError::new(&e.to_string()))?;
        Ok(WasmLayout { inner: Layout::with_positions(&g, seed, &init) })
    }
    pub fn step(&mut self, n: u32) {
        self.inner.step(n);
    }
    pub fn positions(&self) -> Vec<f32> {
        self.inner.positions().to_vec()
    }
    pub fn settled(&self) -> bool {
        self.inner.is_settled()
    }
}

use crate::{diagnose as dg, rank as rk, search::SearchRequest, sqlgen};

fn js<E: std::fmt::Display>(e: E) -> JsError {
    JsError::new(&e.to_string())
}

#[wasm_bindgen(js_name = plan_candidates)]
pub fn plan_candidates_json(graph_json: &str, req_json: &str) -> Result<String, JsError> {
    let g: SchemaGraph = serde_json::from_str(graph_json).map_err(js)?;
    let r: SearchRequest = serde_json::from_str(req_json).map_err(js)?;
    serde_json::to_string(&sqlgen::plan_candidates(&g, &r)).map_err(js)
}

#[wasm_bindgen(js_name = diagnose)]
pub fn diagnose_json(graph_json: &str, req_json: &str) -> Result<String, JsError> {
    let g: SchemaGraph = serde_json::from_str(graph_json).map_err(js)?;
    let r: SearchRequest = serde_json::from_str(req_json).map_err(js)?;
    serde_json::to_string(&dg::diagnose(&g, &r)).map_err(js)
}

#[wasm_bindgen(js_name = rank)]
pub fn rank_json(cands_json: &str, costs_json: &str) -> Result<String, JsError> {
    let c: Vec<sqlgen::Candidate> = serde_json::from_str(cands_json).map_err(js)?;
    let x: Vec<rk::ExplainCost> = serde_json::from_str(costs_json).map_err(js)?;
    serde_json::to_string(&rk::rank(&c, &x)).map_err(js)
}

#[wasm_bindgen(js_name = rank_flags)]
pub fn rank_flags_json(costs_json: &str) -> Result<String, JsError> {
    let x: Vec<rk::ExplainCost> = serde_json::from_str(costs_json).map_err(js)?;
    serde_json::to_string(&rk::rank_flags(&x)).map_err(js)
}
