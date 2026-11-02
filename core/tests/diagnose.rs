use cosmos_core::diagnose::*;
use cosmos_core::search::*;
use cosmos_core::types::*;
use serde_json::json;

fn t(name: &str, cols: &[(&str, &str)]) -> Table {
    Table { name: format!("public.{name}"), row_estimate: 0, columns: cols.iter().map(|(n, ty)| Column { name: n.to_string(), r#type: ty.to_string(), nullable: false, pk: *n == "id" }).collect() }
}
fn fk(id: &str, a: &str, ac: &str, b: &str) -> Fk {
    Fk { id: id.into(), from: FkEnd { table: format!("public.{a}"), columns: vec![ac.into()] }, to: FkEnd { table: format!("public.{b}"), columns: vec!["id".into()] } }
}
fn schema() -> SchemaGraph {
    SchemaGraph {
        tables: vec![
            t("users", &[("id", "int4"), ("email", "text"), ("name", "text")]),
            t("orders", &[("id", "int4"), ("user_id", "int4"), ("status", "int4"), ("total", "numeric")]),
            t("iso", &[("id", "int4"), ("x", "text")]),
        ],
        fks: vec![fk("fk_orders_user", "orders", "user_id", "users")],
    }
}
fn req(v: serde_json::Value) -> SearchRequest {
    serde_json::from_value(v).unwrap()
}
fn codes(f: &[Flag]) -> Vec<FlagCode> {
    f.iter().map(|x| x.code).collect()
}

#[test]
fn unknown_column_flagged() {
    let f = diagnose(&schema(), &req(json!({"select": ["public.users.nope"]})));
    assert_eq!(f[0].code, FlagCode::UnknownColumn);
    assert_eq!(f[0].column.as_deref(), Some("public.users.nope"));
}

#[test]
fn type_mismatch_int_gets_string() {
    let r = req(json!({"select": ["public.orders.id"], "where": {"col": "public.orders.status", "cmp": "=", "value": "abc"}}));
    assert_eq!(codes(&diagnose(&schema(), &r)), vec![FlagCode::TypeMismatch]);
}

#[test]
fn like_on_int_flagged() {
    let r = req(json!({"select": ["public.users.id"], "where": {"col": "public.users.id", "cmp": "LIKE", "value": "1%"}}));
    assert!(codes(&diagnose(&schema(), &r)).contains(&FlagCode::TypeMismatch));
}

#[test]
fn between_needs_two_values() {
    let r = req(json!({"select": ["public.orders.id"], "where": {"col": "public.orders.total", "cmp": "BETWEEN", "value": [1]}}));
    assert!(codes(&diagnose(&schema(), &r)).contains(&FlagCode::TypeMismatch));
}

#[test]
fn unreachable_island_flagged() {
    let r = req(json!({"select": ["public.users.email", "public.iso.x"]}));
    let f = diagnose(&schema(), &r);
    assert_eq!(f[0].code, FlagCode::Unreachable);
    assert_eq!(f[0].table.as_deref(), Some("public.iso"));
}

#[test]
fn reachable_request_drops_island() {
    let r = req(json!({"select": ["public.users.email", "public.iso.x"]}));
    assert_eq!(reachable_request(&schema(), &r).select, vec!["public.users.email".to_string()]);
}

#[test]
fn dropped_group_removed() {
    let r = req(json!({"select": ["public.users.email"], "where": {"op": "AND", "children": [
        {"op": "OR", "children": [{"col": "public.iso.x", "cmp": "=", "value": "a"}]},
        {"col": "public.users.name", "cmp": "=", "value": "n"}]}}));
    let out = reachable_request(&schema(), &r);
    match out.where_.unwrap() {
        Cond::Group { children, .. } => assert_eq!(children.len(), 1),
        _ => panic!("expected group"),
    }
}

#[test]
fn ambiguous_fk_flagged() {
    let mut s = schema();
    s.fks.push(fk("fk_orders_user2", "orders", "id", "users"));
    let r = req(json!({"select": ["public.users.email", "public.orders.total"]}));
    assert_eq!(codes(&diagnose(&s, &r)), vec![FlagCode::AmbiguousFk]);
    let r2 = req(json!({"select": ["public.users.email", "public.orders.total"], "fk_choices": {"public.orders|public.users": "fk_orders_user"}}));
    assert!(diagnose(&s, &r2).is_empty());
}

#[test]
fn zero_fk_schema_all_islands() {
    let mut s = schema();
    s.fks.clear();
    let r = req(json!({"select": ["public.users.email", "public.orders.total"]}));
    assert_eq!(codes(&diagnose(&s, &r)), vec![FlagCode::Unreachable]);
}

#[test]
fn empty_select_no_flags_crash() {
    assert!(diagnose(&schema(), &req(json!({"select": []}))).is_empty());
    assert!(reachable_request(&schema(), &req(json!({"select": []}))).select.is_empty());
}

#[test]
fn serde_roundtrip() {
    let v = json!({"select": ["public.users.email", "public.orders.total"], "where": {"op": "AND", "children": [
        {"col": "public.orders.status", "cmp": "=", "value": 0},
        {"op": "OR", "children": [
            {"col": "public.users.name", "cmp": "=", "value": "xxx"},
            {"col": "public.users.name", "cmp": "ILIKE", "value": "%x%"}]}]}, "fk_choices": {}});
    let r: SearchRequest = serde_json::from_value(v.clone()).unwrap();
    assert_eq!(serde_json::to_value(&r).unwrap(), v);
}
