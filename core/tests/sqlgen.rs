use cosmos_core::search::*;
use cosmos_core::sqlgen::*;
use cosmos_core::types::*;
use serde_json::json;

fn t(name: &str, cols: &[(&str, &str)]) -> Table {
    Table { name: name.into(), row_estimate: 0, columns: cols.iter().map(|(n, ty)| Column { name: n.to_string(), r#type: ty.to_string(), nullable: false, pk: *n == "id" }).collect() }
}
fn fk(id: &str, a: &str, ac: &str, b: &str) -> Fk {
    Fk { id: id.into(), from: FkEnd { table: a.into(), columns: vec![ac.into()] }, to: FkEnd { table: b.into(), columns: vec!["id".into()] } }
}
fn shop() -> SchemaGraph {
    SchemaGraph {
        tables: vec![
            t("public.users", &[("id", "int4"), ("email", "text"), ("name", "text")]),
            t("public.orders", &[("id", "int4"), ("user_id", "int4"), ("alt_user_id", "int4"), ("status", "int4"), ("total", "numeric")]),
        ],
        fks: vec![fk("fk_orders_user", "public.orders", "user_id", "public.users")],
    }
}
fn req(v: serde_json::Value) -> SearchRequest {
    serde_json::from_value(v).unwrap()
}
fn joins_only(c: &[Candidate]) -> Vec<&Candidate> {
    c.iter().filter(|x| x.shape == Shape::Join).collect()
}

#[test]
fn single_table_no_join() {
    let c = plan_candidates(&shop(), &req(json!({"select": ["public.users.email"]})));
    assert_eq!(c.len(), 1);
    assert_eq!(c[0].joins, 0);
    assert!(!c[0].queries[0].sql.contains("JOIN"));
    assert!(!c[0].queries[0].sql.contains(" WHERE "));
}

#[test]
fn two_table_join_exact() {
    let c = plan_candidates(&shop(), &req(json!({"select": ["public.users.email", "public.orders.total"], "where": {"col": "public.orders.status", "cmp": "=", "value": 0}})));
    let j = &joins_only(&c)[0].queries[0];
    assert_eq!(j.sql, "SELECT \"t0\".\"email\", \"t1\".\"total\" FROM \"public\".\"users\" AS \"t0\" JOIN \"public\".\"orders\" AS \"t1\" ON \"t1\".\"user_id\" = \"t0\".\"id\" WHERE \"t1\".\"status\" = $1");
    assert_eq!(j.params, vec![json!(0)]);
}

#[test]
fn params_never_inlined() {
    let c = plan_candidates(&shop(), &req(json!({"select": ["public.users.email"], "where": {"op": "AND", "children": [
        {"col": "public.users.name", "cmp": "=", "value": "x' OR 1=1 --"},
        {"col": "public.users.email", "cmp": "LIKE", "value": "50%;"}]}})));
    for cand in &c {
        for qy in &cand.queries {
            assert!(!qy.sql.contains("OR 1=1") && !qy.sql.contains("50%;"));
        }
    }
    assert_eq!(c[0].queries[0].params, vec![json!("x' OR 1=1 --"), json!("50%;")]);
}

#[test]
fn identifier_quoting() {
    let s = SchemaGraph {
        tables: vec![
            t("public.Order Items", &[("id", "int4"), ("a\"b", "text")]),
            t("public.user", &[("id", "int4")]),
            t("audit.users", &[("id", "int4"), ("n", "text")]),
            t("public.users", &[("id", "int4"), ("n", "text")]),
        ],
        fks: vec![fk("f1", "public.Order Items", "id", "public.user"), fk("f2", "audit.users", "id", "public.user"), fk("f3", "public.users", "id", "public.user")],
    };
    let c = plan_candidates(&s, &req(json!({"select": ["public.Order Items.a\"b", "audit.users.n", "public.users.n"]})));
    let sql = &joins_only(&c)[0].queries[0].sql;
    for want in ["\"public\".\"Order Items\"", "\"a\"\"b\"", "\"audit\".\"users\"", "\"public\".\"users\"", "\"public\".\"user\""] {
        assert!(sql.contains(want), "{sql} missing {want}");
    }
}

#[test]
fn between_in_isnull() {
    let one = |v| plan_candidates(&shop(), &req(json!({"select": ["public.orders.id"], "where": v})))[0].queries[0].clone();
    let b = one(json!({"col": "public.orders.total", "cmp": "BETWEEN", "value": [1, 5]}));
    assert!(b.sql.ends_with("BETWEEN $1 AND $2") && b.params.len() == 2);
    let i = one(json!({"col": "public.orders.status", "cmp": "IN", "value": [1, 2]}));
    assert!(i.sql.ends_with("IN ($1,$2)"));
    let n = one(json!({"col": "public.orders.status", "cmp": "IS NULL"}));
    assert!(n.sql.ends_with("IS NULL") && n.params.is_empty());
}

#[test]
fn nested_or_parenthesised() {
    let c = plan_candidates(&shop(), &req(json!({"select": ["public.users.email"], "where": {"op": "AND", "children": [
        {"col": "public.users.id", "cmp": ">", "value": 1},
        {"op": "OR", "children": [{"col": "public.users.name", "cmp": "=", "value": "a"}, {"col": "public.users.name", "cmp": "=", "value": "b"}]}]}})));
    assert!(c[0].queries[0].sql.ends_with("\"t0\".\"id\" > $1 AND (\"t0\".\"name\" = $2 OR \"t0\".\"name\" = $3)"));
}

#[test]
fn semijoin_generated() {
    let c = plan_candidates(&shop(), &req(json!({"select": ["public.users.email"], "where": {"col": "public.orders.status", "cmp": "=", "value": 0}})));
    let s = c.iter().find(|x| x.shape == Shape::SemiJoin).expect("semijoin");
    let sql = &s.queries[0].sql;
    assert!(sql.contains("EXISTS (SELECT 1 FROM \"public\".\"orders\" AS \"e0\" WHERE \"e0\".\"status\" = $1 AND \"e0\".\"user_id\" = \"t0\".\"id\")"), "{sql}");
    assert!(!sql.contains(" JOIN "));
}

#[test]
fn split_requires_pure_and() {
    let sel = json!(["public.users.email", "public.orders.total"]);
    let or = plan_candidates(&shop(), &req(json!({"select": sel, "where": {"op": "OR", "children": [
        {"col": "public.users.name", "cmp": "=", "value": "a"}, {"col": "public.orders.status", "cmp": "=", "value": 1}]}})));
    assert!(or.iter().all(|x| x.shape != Shape::Split));
    let and = plan_candidates(&shop(), &req(json!({"select": sel, "where": {"op": "AND", "children": [
        {"col": "public.users.name", "cmp": "=", "value": "a"}, {"col": "public.orders.status", "cmp": "=", "value": 1}]}})));
    let s = and.iter().find(|x| x.shape == Shape::Split).expect("split");
    assert_eq!(s.query_count, 2);
    assert!(s.queries[0].sql.contains("\"t0\".\"id\"") || s.queries[0].sql.contains("\"user_id\""));
}

#[test]
fn max_20_candidates() {
    let n = 12;
    let tables: Vec<Table> = (0..n).map(|i| t(&format!("public.t{i}"), &[("id", "int4"), ("v", "text"), ("fa", "int4"), ("fb", "int4"), ("fc", "int4")])).collect();
    let mut fks = vec![];
    for i in 0..n {
        for (k, d) in [1, 2, 3].iter().enumerate() {
            if i + d < n {
                fks.push(fk(&format!("f{i}_{k}"), &format!("public.t{i}"), ["fa", "fb", "fc"][k], &format!("public.t{}", i + d)));
            }
        }
    }
    let s = SchemaGraph { tables, fks };
    let c = plan_candidates(&s, &req(json!({"select": ["public.t0.v", "public.t5.v", "public.t11.v"], "where": {"op": "AND", "children": [
        {"col": "public.t3.v", "cmp": "=", "value": "a"}, {"col": "public.t8.v", "cmp": "=", "value": "b"}]}})));
    assert!(!c.is_empty() && c.len() <= 20, "{}", c.len());
}

#[test]
fn empty_select_none() {
    assert!(plan_candidates(&shop(), &req(json!({"select": [], "where": {"col": "public.users.id", "cmp": "=", "value": 1}}))).is_empty());
}

#[test]
fn fk_choice_used() {
    let mut s = shop();
    s.fks.push(fk("fk_orders_alt", "public.orders", "alt_user_id", "public.users"));
    let c = plan_candidates(&s, &req(json!({"select": ["public.users.email", "public.orders.total"], "fk_choices": {"public.orders|public.users": "fk_orders_alt"}})));
    let sql = &joins_only(&c)[0].queries[0].sql;
    assert!(sql.contains("alt_user_id") && !sql.contains("\"user_id\""), "{sql}");
}
