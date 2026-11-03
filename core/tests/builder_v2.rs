//! Query builder v2: DISTINCT, ORDER BY, LIMIT/OFFSET, aggregates, GROUP BY, HAVING, NOT, more comparators.
use cosmos_core::diagnose::{diagnose, reachable_request, FlagCode};
use cosmos_core::search::*;
use cosmos_core::sqlgen::*;
use cosmos_core::types::*;
use serde_json::json;

fn t(name: &str, cols: &[(&str, &str)]) -> Table {
    Table { name: name.into(), row_estimate: 0, columns: cols.iter().map(|(n, ty)| Column { name: n.to_string(), r#type: ty.to_string(), nullable: false, pk: *n == "id" }).collect() }
}
fn shop() -> SchemaGraph {
    SchemaGraph {
        tables: vec![
            t("public.users", &[("id", "int4"), ("email", "text"), ("name", "text")]),
            t("public.orders", &[("id", "int4"), ("user_id", "int4"), ("status", "int4"), ("total", "numeric")]),
            t("public.island", &[("id", "int4"), ("x", "int4")]),
        ],
        fks: vec![Fk {
            id: "fk_orders_user".into(),
            from: FkEnd { table: "public.orders".into(), columns: vec!["user_id".into()] },
            to: FkEnd { table: "public.users".into(), columns: vec!["id".into()] },
        }],
    }
}
fn req(v: serde_json::Value) -> SearchRequest {
    serde_json::from_value(v).unwrap()
}
fn first_sql(v: serde_json::Value) -> SqlQuery {
    let c = plan_candidates(&shop(), &req(v));
    assert!(!c.is_empty(), "no candidates");
    c[0].queries[0].clone()
}

#[test]
fn distinct_adds_the_keyword() {
    assert_eq!(first_sql(json!({"select": ["public.orders.status"], "distinct": true})).sql, "SELECT DISTINCT \"t0\".\"status\" FROM \"public\".\"orders\" AS \"t0\"");
}

#[test]
fn order_limit_offset_in_order_with_literals() {
    let q = first_sql(json!({"select": ["public.users.email"], "order_by": [{"col": "public.users.email", "dir": "DESC"}, {"col": "public.users.name"}], "limit": 10, "offset": 20}));
    assert_eq!(q.sql, "SELECT \"t0\".\"email\" FROM \"public\".\"users\" AS \"t0\" ORDER BY \"t0\".\"email\" DESC, \"t0\".\"name\" ASC LIMIT 10 OFFSET 20");
    assert!(q.params.is_empty());
}

#[test]
fn order_by_a_column_outside_select_joins_its_table() {
    let q = first_sql(json!({"select": ["public.users.email"], "order_by": [{"col": "public.orders.total", "dir": "DESC"}]}));
    assert!(q.sql.contains("JOIN \"public\".\"orders\"") && q.sql.ends_with("ORDER BY \"t1\".\"total\" DESC"), "{}", q.sql);
}

#[test]
fn count_star_only() {
    let q = first_sql(json!({"select": [], "aggregates": [{"func": "COUNT"}], "where": {"col": "public.orders.status", "cmp": "=", "value": 1}}));
    assert_eq!(q.sql, "SELECT COUNT(*) AS \"count\" FROM \"public\".\"orders\" AS \"t0\" WHERE \"t0\".\"status\" = $1");
}

#[test]
fn group_by_having_order_by_aggregate() {
    let q = first_sql(json!({
        "select": ["public.users.name"],
        "aggregates": [{"func": "COUNT"}, {"func": "SUM", "col": "public.orders.total", "alias": "revenue"}],
        "having": [{"agg": 0, "cmp": ">=", "value": 2}],
        "order_by": [{"agg": 1, "dir": "DESC"}],
        "limit": 5
    }));
    assert_eq!(q.sql, "SELECT \"t0\".\"name\", COUNT(*) AS \"count\", SUM(\"t1\".\"total\") AS \"revenue\" FROM \"public\".\"users\" AS \"t0\" JOIN \"public\".\"orders\" AS \"t1\" ON \"t1\".\"user_id\" = \"t0\".\"id\" GROUP BY \"t0\".\"name\" HAVING COUNT(*) >= $1 ORDER BY \"revenue\" DESC LIMIT 5");
    assert_eq!(q.params, vec![json!(2)]);
}

#[test]
fn group_by_columns_not_shown_are_still_grouped() {
    let q = first_sql(json!({"select": [], "group_by": ["public.orders.status"], "aggregates": [{"func": "AVG", "col": "public.orders.total"}]}));
    assert_eq!(q.sql, "SELECT AVG(\"t0\".\"total\") AS \"avg_total\" FROM \"public\".\"orders\" AS \"t0\" GROUP BY \"t0\".\"status\"");
}

#[test]
fn count_distinct_and_duplicate_aliases_stay_unique() {
    let q = first_sql(json!({"select": [], "aggregates": [{"func": "COUNT_DISTINCT", "col": "public.orders.user_id"}, {"func": "COUNT_DISTINCT", "col": "public.orders.user_id"}]}));
    assert_eq!(
        q.sql,
        "SELECT COUNT(DISTINCT \"t0\".\"user_id\") AS \"count_distinct_user_id\", COUNT(DISTINCT \"t0\".\"user_id\") AS \"count_distinct_user_id_2\" FROM \"public\".\"orders\" AS \"t0\""
    );
}

#[test]
fn not_groups_and_new_comparators() {
    let q = first_sql(json!({"select": ["public.users.email"], "where": {"op": "AND", "children": [
        {"not": {"op": "OR", "children": [{"col": "public.users.name", "cmp": "=", "value": "a"}, {"col": "public.users.name", "cmp": "=", "value": "b"}]}},
        {"col": "public.users.email", "cmp": "NOT ILIKE", "value": "%x"},
        {"col": "public.users.id", "cmp": "NOT BETWEEN", "value": [1, 5]},
        {"col": "public.users.name", "cmp": "~*", "value": "^a"}]}}));
    assert!(
        q.sql.ends_with("WHERE NOT (\"t0\".\"name\" = $1 OR \"t0\".\"name\" = $2) AND \"t0\".\"email\" NOT ILIKE $3 AND \"t0\".\"id\" NOT BETWEEN $4 AND $5 AND \"t0\".\"name\" ~* $6"),
        "{}",
        q.sql
    );
    assert_eq!(q.params, vec![json!("a"), json!("b"), json!("%x"), json!(1), json!(5), json!("^a")]);
}

#[test]
fn split_is_not_offered_when_the_result_is_shaped() {
    let base = json!({"select": ["public.users.email", "public.orders.total"]});
    assert!(plan_candidates(&shop(), &req(base.clone())).iter().any(|c| c.shape == Shape::Split));
    for extra in [json!({"limit": 5}), json!({"distinct": true}), json!({"order_by": [{"col": "public.orders.total"}]}), json!({"aggregates": [{"func": "COUNT"}]})] {
        let mut v = base.clone();
        v.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        assert!(plan_candidates(&shop(), &req(v)).iter().all(|c| c.shape != Shape::Split));
    }
}

fn codes(v: serde_json::Value) -> Vec<FlagCode> {
    diagnose(&shop(), &req(v)).into_iter().map(|f| f.code).collect()
}

#[test]
fn invalid_combinations_are_flagged() {
    assert!(codes(json!({"select": ["public.users.email"], "distinct": true, "order_by": [{"col": "public.users.name"}]})).contains(&FlagCode::InvalidQuery));
    assert!(codes(json!({"select": [], "aggregates": [{"func": "SUM", "col": "public.users.email"}]})).contains(&FlagCode::InvalidQuery));
    assert!(codes(json!({"select": [], "aggregates": [{"func": "MAX"}]})).contains(&FlagCode::InvalidQuery));
    assert!(codes(json!({"select": ["public.users.email"], "having": [{"agg": 0, "cmp": ">", "value": 1}]})).contains(&FlagCode::InvalidQuery));
    assert!(codes(json!({"select": ["public.users.email"], "aggregates": [{"func": "COUNT"}], "order_by": [{"col": "public.users.name"}]})).contains(&FlagCode::InvalidQuery));
    assert!(!codes(json!({"select": ["public.users.email"], "distinct": true, "order_by": [{"col": "public.users.email"}]})).contains(&FlagCode::InvalidQuery));
    assert!(!codes(json!({"select": ["public.users.name"], "aggregates": [{"func": "SUM", "col": "public.orders.total"}], "order_by": [{"agg": 0}, {"col": "public.users.name"}]}))
        .contains(&FlagCode::InvalidQuery));
}

#[test]
fn aggregate_and_order_columns_are_checked_and_unreachable_ones_dropped() {
    assert!(codes(json!({"select": ["public.users.email"], "order_by": [{"col": "public.users.nope"}]})).contains(&FlagCode::UnknownColumn));
    let r = reachable_request(
        &shop(),
        &req(json!({
            "select": ["public.users.email"],
            "aggregates": [{"func": "SUM", "col": "public.island.x"}, {"func": "COUNT"}],
            "having": [{"agg": 0, "cmp": ">", "value": 1}, {"agg": 1, "cmp": ">", "value": 2}],
            "order_by": [{"agg": 0}, {"agg": 1, "dir": "DESC"}, {"col": "public.island.x"}]
        })),
    );
    assert_eq!(r.aggregates.len(), 1);
    assert_eq!(r.having.len(), 1);
    assert_eq!((r.having[0].agg, r.order_by.len(), r.order_by[0].agg), (0, 1, Some(0)));
}
