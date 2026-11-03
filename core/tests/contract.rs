use cosmos_core::types::SchemaGraph;

pub fn shop() -> SchemaGraph {
    let p = concat!(env!("CARGO_MANIFEST_DIR"), "/../samples/shop.graph.json");
    serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap()
}

#[test]
fn shop_graph_deserializes() {
    assert_eq!(shop().tables.len(), 25);
}
