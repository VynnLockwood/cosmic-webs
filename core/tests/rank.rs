use cosmos_core::diagnose::FlagCode;
use cosmos_core::rank::*;
use cosmos_core::sqlgen::*;

fn cand(id: &str, q: u32, j: u32) -> Candidate {
    Candidate { id: id.into(), shape: Shape::Join, fk_ids: vec![], tables: vec![], queries: vec![], joins: j, query_count: q }
}
fn cost(id: &str, c: f64, r: f64) -> ExplainCost {
    ExplainCost { id: id.into(), total_cost: c, plan_rows: r, error: None }
}

#[test]
fn cheapest_first() {
    let r = rank(&[cand("a", 1, 1), cand("b", 1, 1), cand("c", 1, 1)], &[cost("a", 30.0, 10.0), cost("b", 10.0, 10.0), cost("c", 20.0, 10.0)]);
    assert_eq!(r.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(), ["b", "c", "a"]);
}

#[test]
fn fewer_queries_beat_cost_tie() {
    let r = rank(&[cand("two", 2, 1), cand("one", 1, 1)], &[cost("two", 10.0, 1.0), cost("one", 10.0, 1.0)]);
    assert_eq!(r[0].id, "one");
}

#[test]
fn weights_exact() {
    let cs = [cand("A", 1, 1), cand("B", 2, 3), cand("C", 1, 2)];
    let xs = [cost("A", 10.0, 100.0), cost("B", 20.0, 400.0), cost("C", 15.0, 250.0)];
    let r = rank(&cs, &xs);
    let by = |id: &str| r.iter().find(|x| x.id == id).unwrap().score;
    assert!((by("A") - 0.0).abs() < 1e-9);
    assert!((by("B") - 1.0).abs() < 1e-9);
    assert!((by("C") - (0.5 * 0.5 + 0.0 + 0.15 * 0.5 + 0.1 * 0.5)).abs() < 1e-9);
}

#[test]
fn top5_cap() {
    let cs: Vec<Candidate> = (0..12).map(|i| cand(&format!("c{i}"), 1, 1)).collect();
    let xs: Vec<ExplainCost> = (0..12).map(|i| cost(&format!("c{i}"), (12 - i) as f64, 1.0)).collect();
    let r = rank(&cs, &xs);
    assert_eq!(r.len(), 5);
    assert!(r.windows(2).all(|w| w[0].score <= w[1].score));
}

#[test]
fn single_candidate_norm_ok() {
    let r = rank(&[cand("a", 1, 0)], &[cost("a", 5.0, 5.0)]);
    assert_eq!(r[0].score, 0.0);
}

#[test]
fn errored_excluded() {
    let mut bad = cost("b", 1.0, 1.0);
    bad.error = Some(FlagCode::Timeout);
    let xs = [cost("a", 9.0, 1.0), bad];
    let r = rank(&[cand("a", 1, 1), cand("b", 1, 1)], &xs);
    assert_eq!(r.len(), 1);
    assert_eq!(rank_flags(&xs)[0].code, FlagCode::Timeout);
}

#[test]
fn all_errored() {
    let mut bad = cost("a", 1.0, 1.0);
    bad.error = Some(FlagCode::Permission);
    assert!(rank(&[cand("a", 1, 1)], &[bad.clone()]).is_empty());
    assert!(!rank_flags(&[bad]).is_empty());
}

#[test]
fn reason_mentions_counts() {
    let r = rank(&[cand("a", 1, 2)], &[cost("a", 5.0, 5.0)]);
    assert!(r[0].reason.contains("1 query") && r[0].reason.contains("2 joins"));
}
