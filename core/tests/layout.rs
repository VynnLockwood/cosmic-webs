use cosmos_core::layout::Layout;
use cosmos_core::types::*;

fn shop() -> SchemaGraph {
    let p = concat!(env!("CARGO_MANIFEST_DIR"), "/../samples/shop.graph.json");
    serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap()
}

fn table(name: &str) -> Table {
    Table { name: name.into(), columns: vec![], row_estimate: 0 }
}

fn fk(id: &str, a: &str, b: &str) -> Fk {
    Fk { id: id.into(), from: FkEnd { table: a.into(), columns: vec!["x".into()] }, to: FkEnd { table: b.into(), columns: vec!["id".into()] } }
}

fn synthetic(n: usize, fks: usize) -> SchemaGraph {
    let tables: Vec<Table> = (0..n).map(|i| table(&format!("public.t{i}"))).collect();
    let mut f = Vec::new();
    let mut s = 12345u64;
    for k in 0..fks {
        s = s.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        let a = (s >> 33) as usize % n;
        s = s.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        let b = (s >> 33) as usize % n;
        f.push(fk(&format!("f{k}"), &format!("public.t{a}"), &format!("public.t{b}")));
    }
    SchemaGraph { tables, fks: f }
}

fn dist(p: &[f32], a: usize, b: usize) -> f32 {
    ((0..3).map(|k| (p[a * 3 + k] - p[b * 3 + k]).powi(2)).sum::<f32>()).sqrt()
}

#[test]
fn init_deterministic_for_seed() {
    let g = shop();
    assert_eq!(Layout::new(&g, 7).positions(), Layout::new(&g, 7).positions());
    assert_ne!(Layout::new(&g, 7).positions(), Layout::new(&g, 8).positions());
}

#[test]
fn init_inside_sphere() {
    let l = Layout::new(&shop(), 1);
    for c in l.positions().chunks(3) {
        assert!((c[0] * c[0] + c[1] * c[1] + c[2] * c[2]).sqrt() <= 100.0 + 1e-3);
    }
}

#[test]
fn linked_pairs_closer() {
    let g = shop();
    let mut l = Layout::new(&g, 3);
    l.step(300);
    let p = l.positions();
    let n = g.tables.len();
    let mut all = 0.0;
    let mut cnt = 0.0;
    for a in 0..n {
        for b in a + 1..n {
            all += dist(p, a, b);
            cnt += 1.0;
        }
    }
    let links: Vec<f32> = g
        .fks
        .iter()
        .filter(|f| f.from.table != f.to.table)
        .map(|f| dist(p, g.table_index(&f.from.table).unwrap(), g.table_index(&f.to.table).unwrap()))
        .collect();
    let mean_fk = links.iter().sum::<f32>() / links.len() as f32;
    assert!(mean_fk < 0.7 * (all / cnt), "fk {mean_fk} all {}", all / cnt);
}

#[test]
fn no_nan_zero_fks() {
    let g = SchemaGraph { tables: (0..10).map(|i| table(&format!("public.t{i}"))).collect(), fks: vec![] };
    let mut l = Layout::new(&g, 2);
    l.step(500);
    assert!(l.positions().iter().all(|v| v.is_finite()));
}

#[test]
fn no_nan_self_fk() {
    let g = SchemaGraph { tables: vec![table("public.e"), table("public.f")], fks: vec![fk("s", "public.e", "public.e")] };
    let mut l = Layout::new(&g, 2);
    l.step(500);
    assert!(l.positions().iter().all(|v| v.is_finite()));
}

#[test]
fn settles_500_tables_under_3s() {
    let g = synthetic(500, 1500);
    let mut l = Layout::new(&g, 5);
    let t = std::time::Instant::now();
    while !l.is_settled() {
        l.step(10);
    }
    assert!(t.elapsed().as_secs_f32() < 3.0, "took {:?}", t.elapsed());
    assert!(l.positions().iter().all(|v| v.is_finite()));
}
