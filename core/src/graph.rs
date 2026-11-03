//! Undirected table graph built from FKs (self-FKs ignored, parallel FKs collapsed).
use crate::types::SchemaGraph;
use std::collections::{BTreeMap, HashMap};

pub type FkChoices = BTreeMap<String, String>;

pub struct Graph {
    pub names: Vec<String>,
    pub adj: Vec<Vec<usize>>,
    index: HashMap<String, usize>,
    fks: HashMap<(usize, usize), Vec<String>>,
}

pub fn pair(a: usize, b: usize) -> (usize, usize) {
    if a < b { (a, b) } else { (b, a) }
}

impl Graph {
    pub fn new(g: &SchemaGraph) -> Graph {
        let names: Vec<String> = g.tables.iter().map(|t| t.name.clone()).collect();
        let index: HashMap<String, usize> = names.iter().cloned().enumerate().map(|(i, n)| (n, i)).collect();
        let mut adj = vec![Vec::new(); names.len()];
        let mut fks: HashMap<(usize, usize), Vec<String>> = HashMap::new();
        for f in &g.fks {
            if let (Some(&a), Some(&b)) = (index.get(&f.from.table), index.get(&f.to.table)) {
                if a == b {
                    continue;
                }
                let e = fks.entry(pair(a, b)).or_default();
                if e.is_empty() {
                    adj[a].push(b);
                    adj[b].push(a);
                }
                e.push(f.id.clone());
            }
        }
        for v in fks.values_mut() {
            v.sort();
        }
        for a in adj.iter_mut() {
            a.sort();
        }
        Graph { names, adj, index, fks }
    }

    pub fn len(&self) -> usize {
        self.names.len()
    }

    pub fn is_empty(&self) -> bool {
        self.names.is_empty()
    }

    pub fn table_index(&self, name: &str) -> Option<usize> {
        self.index.get(name).copied()
    }

    /// All FK ids between two tables, sorted.
    pub fn fk_ids_between(&self, a: usize, b: usize) -> &[String] {
        self.fks.get(&pair(a, b)).map(|v| v.as_slice()).unwrap_or(&[])
    }

    pub fn choice_key(&self, a: usize, b: usize) -> String {
        let (x, y) = pair(a, b);
        let (mut n1, mut n2) = (self.names[x].clone(), self.names[y].clone());
        if n1 > n2 {
            std::mem::swap(&mut n1, &mut n2);
        }
        format!("{n1}|{n2}")
    }
}

/// Connected components (islands), each sorted, ordered by smallest member.
pub fn islands(g: &Graph) -> Vec<Vec<usize>> {
    let mut seen = vec![false; g.len()];
    let mut out = Vec::new();
    for s in 0..g.len() {
        if seen[s] {
            continue;
        }
        let mut comp = vec![];
        let mut st = vec![s];
        seen[s] = true;
        while let Some(v) = st.pop() {
            comp.push(v);
            for &w in &g.adj[v] {
                if !seen[w] {
                    seen[w] = true;
                    st.push(w);
                }
            }
        }
        comp.sort();
        out.push(comp);
    }
    out
}
