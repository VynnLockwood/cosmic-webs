//! Join-path search: Steiner trees over the FK graph (unit edge weight).
use crate::graph::{islands, pair, FkChoices, Graph};
use std::cmp::Reverse;
use std::collections::{BinaryHeap, BTreeSet, HashSet};

#[derive(Debug, Clone, PartialEq)]
pub struct Tree {
    pub tables: Vec<usize>,
    pub fk_ids: Vec<String>,
    pub cost: u32,
    pub ambiguous_pairs: Vec<(usize, usize)>,
    /// table-index pairs of each edge, for SQL generation (same order as fk_ids)
    pub edges: Vec<(usize, usize)>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum PathError {
    Unreachable { islands: Vec<Vec<usize>> },
}

const INF: u32 = u32::MAX / 4;
type Banned = HashSet<(usize, usize)>;

pub fn steiner_trees(g: &Graph, required: &[usize], choices: &FkChoices, max: usize) -> Result<Vec<Tree>, PathError> {
    let mut req: Vec<usize> = required.to_vec();
    req.sort();
    req.dedup();
    if req.is_empty() || max == 0 {
        return Ok(vec![]);
    }
    let comps = islands(g);
    let hit: Vec<Vec<usize>> = comps.into_iter().filter(|c| req.iter().any(|r| c.contains(r))).collect();
    if hit.len() > 1 {
        return Err(PathError::Unreachable { islands: hit });
    }
    let mut found: Vec<BTreeSet<(usize, usize)>> = Vec::new();
    let best = core(g, &req, &Banned::new()).expect("connected");
    found.push(best.clone());
    for e in best.iter() {
        let mut banned = Banned::new();
        banned.insert(*e);
        if let Some(alt) = core(g, &req, &banned) {
            if !found.contains(&alt) {
                found.push(alt);
            }
        }
    }
    found.sort_by_key(|e| e.len());
    Ok(found.into_iter().take(max).map(|e| build_tree(g, &req, e, choices)).collect())
}

fn build_tree(g: &Graph, req: &[usize], edges: BTreeSet<(usize, usize)>, choices: &FkChoices) -> Tree {
    let mut tables: BTreeSet<usize> = req.iter().copied().collect();
    let (mut fk_ids, mut amb, mut elist) = (vec![], vec![], vec![]);
    for &(a, b) in &edges {
        tables.insert(a);
        tables.insert(b);
        let ids = g.fk_ids_between(a, b);
        let chosen = choices.get(&g.choice_key(a, b)).filter(|c| ids.contains(c)).cloned();
        if ids.len() > 1 && chosen.is_none() {
            amb.push((a, b));
        }
        fk_ids.push(chosen.unwrap_or_else(|| ids[0].clone()));
        elist.push((a, b));
    }
    Tree { tables: tables.into_iter().collect(), fk_ids, cost: edges.len() as u32, ambiguous_pairs: amb, edges: elist }
}

fn core(g: &Graph, req: &[usize], banned: &Banned) -> Option<BTreeSet<(usize, usize)>> {
    if req.len() <= 8 { dreyfus_wagner(g, req, banned) } else { heuristic(g, req, banned) }
}

#[derive(Clone, Copy)]
enum Back {
    None,
    Merge(u32),
    Edge(u32),
}

fn dreyfus_wagner(g: &Graph, req: &[usize], banned: &Banned) -> Option<BTreeSet<(usize, usize)>> {
    let (n, k) = (g.len(), req.len());
    if k == 1 {
        return Some(BTreeSet::new());
    }
    let full = (1usize << k) - 1;
    let mut dp = vec![vec![INF; n]; full + 1];
    let mut bk = vec![vec![Back::None; n]; full + 1];
    for (i, &t) in req.iter().enumerate() {
        dp[1 << i][t] = 0;
    }
    for mask in 1..=full {
        if mask & (mask - 1) != 0 {
            let mut sub = (mask - 1) & mask;
            while sub > 0 {
                if sub < (mask ^ sub) {
                    sub = (sub - 1) & mask;
                    continue;
                }
                for v in 0..n {
                    let c = dp[sub][v].saturating_add(dp[mask ^ sub][v]);
                    if c < dp[mask][v] {
                        dp[mask][v] = c;
                        bk[mask][v] = Back::Merge(sub as u32);
                    }
                }
                sub = (sub - 1) & mask;
            }
        }
        let mut heap: BinaryHeap<Reverse<(u32, usize)>> = (0..n).filter(|&v| dp[mask][v] < INF).map(|v| Reverse((dp[mask][v], v))).collect();
        while let Some(Reverse((d, u))) = heap.pop() {
            if d > dp[mask][u] {
                continue;
            }
            for &w in &g.adj[u] {
                if banned.contains(&pair(u, w)) {
                    continue;
                }
                if d + 1 < dp[mask][w] {
                    dp[mask][w] = d + 1;
                    bk[mask][w] = Back::Edge(u as u32);
                    heap.push(Reverse((d + 1, w)));
                }
            }
        }
    }
    let root = req[0];
    if dp[full][root] >= INF {
        return None;
    }
    let mut edges = BTreeSet::new();
    let mut stack = vec![(full, root)];
    while let Some((mask, v)) = stack.pop() {
        match bk[mask][v] {
            Back::None => {}
            Back::Merge(s) => {
                stack.push((s as usize, v));
                stack.push((mask ^ s as usize, v));
            }
            Back::Edge(u) => {
                edges.insert(pair(u as usize, v));
                stack.push((mask, u as usize));
            }
        }
    }
    Some(edges)
}

/// Shortest-path (Takahashi–Matsuyama) heuristic for > 8 required tables.
fn heuristic(g: &Graph, req: &[usize], banned: &Banned) -> Option<BTreeSet<(usize, usize)>> {
    let n = g.len();
    let mut in_tree = vec![false; n];
    in_tree[req[0]] = true;
    let mut edges = BTreeSet::new();
    let mut left: Vec<usize> = req[1..].to_vec();
    while !left.is_empty() {
        let mut prev = vec![usize::MAX; n];
        let mut dist = vec![INF; n];
        let mut q = std::collections::VecDeque::new();
        for v in 0..n {
            if in_tree[v] {
                dist[v] = 0;
                q.push_back(v);
            }
        }
        while let Some(u) = q.pop_front() {
            for &w in &g.adj[u] {
                if banned.contains(&pair(u, w)) || dist[w] != INF {
                    continue;
                }
                dist[w] = dist[u] + 1;
                prev[w] = u;
                q.push_back(w);
            }
        }
        let (idx, &t) = left.iter().enumerate().filter(|(_, &t)| dist[t] < INF).min_by_key(|(_, &t)| dist[t])?;
        let mut v = t;
        while !in_tree[v] {
            edges.insert(pair(v, prev[v]));
            in_tree[v] = true;
            v = prev[v];
        }
        left.remove(idx);
    }
    Some(edges)
}
