//! Force-directed 3D layout: Barnes–Hut repulsion, FK springs, centering, alpha cooling.
use crate::types::SchemaGraph;

const THETA: f32 = 0.8;
const REPULSION: f32 = 900.0;
const SPRING_K: f32 = 0.08;
const REST_LEN: f32 = 28.0;
const GRAVITY: f32 = 0.012;
const DAMPING: f32 = 0.82;
const MAX_STEP: f32 = 12.0;
const ALPHA_DECAY: f32 = 0.9775; // ~300 steps from 1.0 to ALPHA_MIN
const ALPHA_MIN: f32 = 0.001;

pub struct Layout {
    n: usize,
    pos: Vec<f32>,
    vel: Vec<f32>,
    edges: Vec<(usize, usize)>,
    alpha: f32,
}

struct Rng(u32);
impl Rng {
    fn next(&mut self) -> f32 {
        // xorshift32 -> [0,1)
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.0 = x;
        (x >> 8) as f32 / (1u32 << 24) as f32
    }
}

impl Layout {
    pub fn new(graph: &SchemaGraph, seed: u32) -> Layout {
        let n = graph.tables.len();
        let mut rng = Rng(seed.wrapping_mul(2654435761).max(1));
        let mut pos = Vec::with_capacity(n * 3);
        for _ in 0..n {
            loop {
                let p = [rng.next() * 2.0 - 1.0, rng.next() * 2.0 - 1.0, rng.next() * 2.0 - 1.0];
                if p[0] * p[0] + p[1] * p[1] + p[2] * p[2] <= 1.0 {
                    pos.extend(p.iter().map(|v| v * 100.0));
                    break;
                }
            }
        }
        let mut edges = Vec::new();
        for f in &graph.fks {
            if let (Some(a), Some(b)) = (graph.table_index(&f.from.table), graph.table_index(&f.to.table)) {
                if a != b {
                    edges.push((a, b));
                }
            }
        }
        Layout { n, pos, vel: vec![0.0; n * 3], edges, alpha: 1.0 }
    }

    pub fn positions(&self) -> &[f32] {
        &self.pos
    }

    pub fn is_settled(&self) -> bool {
        self.alpha < ALPHA_MIN
    }

    pub fn step(&mut self, iterations: u32) {
        for _ in 0..iterations {
            if self.is_settled() {
                return;
            }
            self.one_step();
        }
    }

    fn one_step(&mut self) {
        let n = self.n;
        if n == 0 {
            self.alpha *= ALPHA_DECAY;
            return;
        }
        let tree = Octree::build(&self.pos);
        let mut force = vec![0.0f32; n * 3];
        for i in 0..n {
            let p = [self.pos[i * 3], self.pos[i * 3 + 1], self.pos[i * 3 + 2]];
            let f = tree.repulsion(i, p);
            for k in 0..3 {
                force[i * 3 + k] += f[k] * REPULSION - self.pos[i * 3 + k] * GRAVITY;
            }
        }
        for &(a, b) in &self.edges {
            let mut d = [0.0f32; 3];
            let mut len2 = 0.0;
            for k in 0..3 {
                d[k] = self.pos[b * 3 + k] - self.pos[a * 3 + k];
                len2 += d[k] * d[k];
            }
            let len = len2.sqrt().max(0.01);
            let pull = SPRING_K * (len - REST_LEN) / len;
            for k in 0..3 {
                force[a * 3 + k] += d[k] * pull;
                force[b * 3 + k] -= d[k] * pull;
            }
        }
        for i in 0..n * 3 {
            self.vel[i] = (self.vel[i] + force[i] * self.alpha) * DAMPING;
            self.vel[i] = self.vel[i].clamp(-MAX_STEP, MAX_STEP);
            self.pos[i] += self.vel[i];
            if !self.pos[i].is_finite() {
                self.pos[i] = 0.0;
                self.vel[i] = 0.0;
            }
        }
        self.alpha *= ALPHA_DECAY;
    }
}

struct Node {
    c: [f32; 3],
    half: f32,
    mass: f32,
    sum: [f32; 3],
    kids: [u32; 8],
    body: i32,
    leaf: bool,
}

struct Octree {
    nodes: Vec<Node>,
    pos: Vec<f32>,
}

impl Octree {
    fn build(pos: &[f32]) -> Octree {
        let n = pos.len() / 3;
        let (mut lo, mut hi) = ([f32::MAX; 3], [f32::MIN; 3]);
        for i in 0..n {
            for k in 0..3 {
                lo[k] = lo[k].min(pos[i * 3 + k]);
                hi[k] = hi[k].max(pos[i * 3 + k]);
            }
        }
        let half = (0..3).map(|k| hi[k] - lo[k]).fold(1.0f32, f32::max) / 2.0 + 1.0;
        let c = [(lo[0] + hi[0]) / 2.0, (lo[1] + hi[1]) / 2.0, (lo[2] + hi[2]) / 2.0];
        let mut t = Octree { nodes: vec![Node { c, half, mass: 0.0, sum: [0.0; 3], kids: [0; 8], body: -1, leaf: true }], pos: pos.to_vec() };
        for i in 0..n {
            t.insert(0, i as i32, 0);
        }
        t
    }

    fn octant(c: [f32; 3], p: [f32; 3]) -> usize {
        ((p[0] > c[0]) as usize) | (((p[1] > c[1]) as usize) << 1) | (((p[2] > c[2]) as usize) << 2)
    }

    fn pt(&self, i: i32) -> [f32; 3] {
        let i = i as usize * 3;
        [self.pos[i], self.pos[i + 1], self.pos[i + 2]]
    }

    fn insert(&mut self, node: usize, body: i32, depth: u32) {
        let p = self.pt(body);
        {
            let nd = &mut self.nodes[node];
            nd.mass += 1.0;
            for k in 0..3 {
                nd.sum[k] += p[k];
            }
        }
        if self.nodes[node].leaf {
            if self.nodes[node].body < 0 {
                self.nodes[node].body = body;
                return;
            }
            if depth >= 24 {
                return; // coincident points: just accumulate mass
            }
            let old = self.nodes[node].body;
            self.nodes[node].body = -1;
            self.nodes[node].leaf = false;
            self.push_down(node, old, depth);
        }
        self.push_down(node, body, depth);
    }

    fn push_down(&mut self, node: usize, body: i32, depth: u32) {
        let p = self.pt(body);
        let (c, half) = (self.nodes[node].c, self.nodes[node].half);
        let o = Self::octant(c, p);
        if self.nodes[node].kids[o] == 0 {
            let h = half / 2.0;
            let cc = [c[0] + if o & 1 != 0 { h } else { -h }, c[1] + if o & 2 != 0 { h } else { -h }, c[2] + if o & 4 != 0 { h } else { -h }];
            self.nodes.push(Node { c: cc, half: h, mass: 0.0, sum: [0.0; 3], kids: [0; 8], body: -1, leaf: true });
            let idx = (self.nodes.len() - 1) as u32;
            self.nodes[node].kids[o] = idx;
        }
        let kid = self.nodes[node].kids[o] as usize;
        // the node's own mass was already counted by the caller for `body`; kids count their own
        self.insert(kid, body, depth + 1);
    }

    /// Unit-repulsion vector on body `i` at `p` (pointing away from other mass).
    fn repulsion(&self, i: usize, p: [f32; 3]) -> [f32; 3] {
        let mut out = [0.0f32; 3];
        let mut stack = vec![0usize];
        while let Some(ni) = stack.pop() {
            let nd = &self.nodes[ni];
            if nd.mass == 0.0 {
                continue;
            }
            if nd.leaf && nd.body == i as i32 && nd.mass == 1.0 {
                continue;
            }
            let com = [nd.sum[0] / nd.mass, nd.sum[1] / nd.mass, nd.sum[2] / nd.mass];
            let d = [p[0] - com[0], p[1] - com[1], p[2] - com[2]];
            let d2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
            let dist = d2.sqrt();
            if nd.leaf || (nd.half * 2.0) / dist.max(1e-6) < THETA {
                // a leaf holding body i plus coincident others still repels by (mass - 1)
                let m = if nd.leaf && nd.body == i as i32 { nd.mass - 1.0 } else { nd.mass };
                let (dx, scale) = if d2 < 1e-6 {
                    // coincident: deterministic nudge based on index
                    ([((i % 7) as f32) - 3.0, ((i % 5) as f32) - 2.0, ((i % 3) as f32) - 1.0], m)
                } else {
                    (d, m / (d2 + 1.0) / dist)
                };
                for k in 0..3 {
                    out[k] += dx[k] * scale;
                }
            } else {
                for &k in &nd.kids {
                    if k != 0 {
                        stack.push(k as usize);
                    }
                }
            }
        }
        out
    }
}
