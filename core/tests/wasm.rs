#![cfg(target_arch = "wasm32")]
use wasm_bindgen_test::*;

#[wasm_bindgen_test]
fn wasm_roundtrip_shop() {
    let g = include_str!("../../samples/shop.graph.json");
    let req = r#"{"select":["public.users.email","public.orders.total"],"where":{"col":"public.orders.status","cmp":"=","value":0},"fk_choices":{}}"#;
    let out = cosmos_core::wasm::plan_candidates_json(g, req).unwrap();
    let v: serde_json::Value = serde_json::from_str(&out).unwrap();
    assert!(v.as_array().unwrap().len() >= 1);
    let l = cosmos_core::wasm::WasmLayout::new(g, 1).unwrap();
    assert_eq!(l.positions().len(), 75);
}
