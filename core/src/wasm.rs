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
