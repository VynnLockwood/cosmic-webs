use cosmos_core::graph::{FkChoices, Graph};
use cosmos_core::paths::*;
use cosmos_core::types::*;

fn build(names: &[&str], edges: &[(&str, &str)]) -> Graph {
    let tables = names.iter().map(|n| Table { name: format!("public.{n}"), columns: vec![], row_estimate: 0 }).collect();
    let fks = edges
        .iter()
        .enumerate()
        .map(|(i, (a, b))| Fk {
            id: format!("fk{i}"),
            from: FkEnd { table: format!("public.{a}"), columns: vec!["x".into()] },
            to: FkEnd { table: format!("public.{b}"), columns: vec!["id".into()] },
        })
        .collect();
    Graph::new(&SchemaGraph { tables, fks })
}

fn idx(g: &Graph, n: &str) -> usize {
    g.table_index(&format!("public.{n}")).unwrap()
}

#[test]
fn chain_includes_middle() {
    let g = build(&["A", "B", "C"], &[("A", "B"), ("B", "C")]);
    let t = &steiner_trees(&g, &[idx(&g, "A"), idx(&g, "C")], &FkChoices::new(), 5).unwrap()[0];
    assert_eq!(t.tables.len(), 3);
    assert_eq!(t.fk_ids.len(), 2);
}

#[test]
fn single_required_table() {
    let g = build(&["A", "B"], &[("A", "B")]);
    let t = &steiner_trees(&g, &[0], &FkChoices::new(), 5).unwrap()[0];
    assert_eq!((t.tables.len(), t.fk_ids.len()), (1, 0));
}

#[test]
fn diamond_has_two_alternates() {
    let g = build(&["A", "B", "C", "D"], &[("A", "B"), ("B", "D"), ("A", "C"), ("C", "D")]);
    let ts = steiner_trees(&g, &[idx(&g, "A"), idx(&g, "D")], &FkChoices::new(), 5).unwrap();
    assert_eq!(ts.len(), 2);
    assert_eq!(ts[0].cost, ts[1].cost);
    assert_ne!(ts[0].tables, ts[1].tables);
}

fn lcg(s: &mut u64) -> usize {
    *s = s.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
    (*s >> 33) as usize
}

fn brute(n: usize, adj: &[Vec<bool>], terms: &[usize]) -> Option<u32> {
    let others: Vec<usize> = (0..n).filter(|v| !terms.contains(v)).collect();
    let mut best: Option<u32> = None;
    for m in 0..(1u32 << others.len()) {
        let mut set: Vec<usize> = terms.to_vec();
        for (i, &o) in others.iter().enumerate() {
            if m >> i & 1 == 1 {
                set.push(o);
            }
        }
        let mut seen = vec![set[0]];
        let mut changed = true;
        while changed {
            changed = false;
            for &v in &set {
                if !seen.contains(&v) && seen.iter().any(|&u| adj[u][v]) {
                    seen.push(v);
                    changed = true;
                }
            }
        }
        if seen.len() == set.len() {
            let c = set.len() as u32 - 1;
            best = Some(best.map_or(c, |b| b.min(c)));
        }
    }
    best
}

#[test]
fn optimal_matches_bruteforce() {
    let mut s = 42u64;
    let mut tested = 0;
    while tested < 20 {
        let n = 8;
        let mut adj = vec![vec![false; n]; n];
        let mut edges = vec![];
        for _ in 0..11 {
            let (a, b) = (lcg(&mut s) % n, lcg(&mut s) % n);
            if a != b && !adj[a][b] {
                adj[a][b] = true;
                adj[b][a] = true;
                edges.push((format!("T{a}"), format!("T{b}")));
            }
        }
        let names: Vec<String> = (0..n).map(|i| format!("T{i}")).collect();
        let nr: Vec<&str> = names.iter().map(|s| s.as_str()).collect();
        let er: Vec<(&str, &str)> = edges.iter().map(|(a, b)| (a.as_str(), b.as_str())).collect();
        let g = build(&nr, &er);
        let terms = vec![0usize, 2, 5, 7];
        let want = brute(n, &adj, &terms);
        let got = steiner_trees(&g, &terms.iter().map(|&t| idx(&g, &format!("T{t}"))).collect::<Vec<_>>(), &FkChoices::new(), 1);
        match (want, got) {
            (Some(w), Ok(t)) => assert_eq!(t[0].cost, w),
            (None, Err(_)) => {}
            (w, g) => panic!("mismatch {w:?} {g:?}"),
        }
        tested += 1;
    }
}

#[test]
fn nine_required_heuristic_connected() {
    let names: Vec<String> = (0..30).map(|i| format!("N{i}")).collect();
    let nr: Vec<&str> = names.iter().map(|s| s.as_str()).collect();
    let edges: Vec<(String, String)> = (1..30).map(|i| (format!("N{i}"), format!("N{}", (i - 1) / 2))).collect();
    let er: Vec<(&str, &str)> = edges.iter().map(|(a, b)| (a.as_str(), b.as_str())).collect();
    let g = build(&nr, &er);
    let req: Vec<usize> = [3, 7, 11, 14, 19, 22, 25, 28, 29].iter().map(|&i| idx(&g, &format!("N{i}"))).collect();
    let t = &steiner_trees(&g, &req, &FkChoices::new(), 1).unwrap()[0];
    for r in &req {
        assert!(t.tables.contains(r));
    }
    assert_eq!(t.fk_ids.len(), t.tables.len() - 1); // a tree
}

#[test]
fn disconnected_unreachable() {
    let g = build(&["A", "B", "C", "D"], &[("A", "B"), ("C", "D")]);
    match steiner_trees(&g, &[idx(&g, "A"), idx(&g, "C")], &FkChoices::new(), 3) {
        Err(PathError::Unreachable { islands }) => assert_eq!(islands.len(), 2),
        o => panic!("{o:?}"),
    }
}

#[test]
fn self_fk_ignored() {
    let g = build(&["A", "B"], &[("A", "A"), ("A", "B")]);
    for t in steiner_trees(&g, &[0, 1], &FkChoices::new(), 5).unwrap() {
        assert_eq!(t.fk_ids, vec!["fk1".to_string()]);
    }
}

#[test]
fn parallel_fks_ambiguous() {
    let g = build(&["A", "B"], &[("A", "B"), ("A", "B")]);
    let t = &steiner_trees(&g, &[0, 1], &FkChoices::new(), 1).unwrap()[0];
    assert_eq!(t.ambiguous_pairs, vec![(0, 1)]);
    let mut c = FkChoices::new();
    c.insert("public.A|public.B".into(), "fk1".into());
    let t = &steiner_trees(&g, &[0, 1], &c, 1).unwrap()[0];
    assert!(t.ambiguous_pairs.is_empty());
    assert_eq!(t.fk_ids, vec!["fk1".to_string()]);
}

#[test]
fn max_respected() {
    let g = build(&["A", "B", "C", "D"], &[("A", "B"), ("B", "D"), ("A", "C"), ("C", "D")]);
    assert!(steiner_trees(&g, &[0, 3], &FkChoices::new(), 1).unwrap().len() <= 1);
}
