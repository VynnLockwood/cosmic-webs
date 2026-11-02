# Cosmic Webs — Visual Design Spec

Date: 2026-11-02
Status: Draft for review
Parent spec: `2026-11-02-cosmic-webs-design.md`
Theme: **Deep nebula** — calm, Hubble-photo deep space.

## 1. Core idea: one camera, one universe

The whole screen is a single camera looking into one 3D world. There is no flat
background image. Space itself (nebula, stars, dust) lives in the same world as the
dots and links, so when the user drags to rotate, everything — tables, links **and
the sky** — turns together and a new part of space comes into view.

```
world (fixed)
 ├─ nebula sky sphere   r = 5000  (fixed in world, centered on camera position)
 ├─ far star shell      r = 4000  (fixed in world, centered on camera position)
 ├─ mid star field      r ≈ 600–1500, real positions → slow parallax on zoom/pan
 ├─ near dust motes     r ≈ 50–400,  real positions → strong parallax
 └─ the web             dots + links, r ≈ 0–300
camera (only thing that moves)
```

- **Rotate** (drag): camera orbits the web. Sky sphere is fixed in world rotation, so
  the visible nebula changes with the new angle.
- **Zoom / fly**: sky and far stars follow camera position (infinite distance feel), but
  mid stars and dust have real positions, so they slide past → sense of depth and speed.
- Never rotate the sky on its own. If the camera is still, the sky is still (except slow
  idle drift, §5.6).

## 2. Color tokens

| Token | Value | Use |
|---|---|---|
| `space-void` | `#05060F` | Deepest background, clear color |
| `nebula-violet` | `#3B1E6B` | Main nebula cloud |
| `nebula-teal` | `#0F4C5C` | Secondary cloud |
| `nebula-rose` | `#6B1E4A` | Rare accent cloud |
| `star-white` | `#F4F6FF` | Stars, dot cores |
| `dot-glow-1..8` | `#7FD1FF #A98BFF #FF9EC7 #7FFFD4 #FFD27F #9EB4FF #FF8F7F #C6FF8F` | Dot glow per cluster / schema |
| `link-thread` | `#8FA8FF` @ 25% | Idle FK link |
| `link-active` | `#BFE4FF` @ 90% | Highlighted path |
| `flag-red` | `#FF5C6C` | Unreachable / error |
| `flag-amber` | `#FFC15C` | Warning (ambiguous FK, empty result) |
| `ui-glass` | `rgba(12,14,30,0.55)` + blur 16px | Sidebar, panels |
| `ui-border` | `rgba(160,180,255,0.14)` | Panel borders |
| `ui-text` | `#E6E9FF` / muted `#8A90B8` | Text |

All UI text meets WCAG AA on `ui-glass` over the darkest and brightest nebula areas
(test with a solid fallback panel when contrast fails).

## 3. Space layers

### 3.1 Nebula sky sphere
- Procedural fragment shader on inverted sphere: 3D fBm noise (5 octaves) in world
  direction space → violet + teal clouds, rose rare.
- Baked once at load to a 2048² cubemap (render-to-cubemap) for speed; seed is fixed
  per session so the same angle always shows the same sky.
- Brightness capped low (max ~18% luminance) so dots always read on top.

### 3.2 Stars (3 layers)
| Layer | Count | Size | Behavior |
|---|---|---|---|
| Far shell | 6,000 | 0.6–1.2 px | Fixed to sky, slight twinkle |
| Mid field | 2,500 | 1–2.5 px | Real world positions, parallax |
| Bright few | 60 | 3–5 px + cross flare | Fixed to sky, slow twinkle |

Twinkle: per-star random phase, sine on alpha, 0.3–1.5 Hz, amplitude 25%.

### 3.3 Dust motes
- 400 soft particles near the web, very low alpha (5–10%), drift slowly.
- Give depth when the camera flies through.

## 4. The web

### 4.1 Dots (tables)
- **Shape**: billboard sprite with white-hot core + soft colored glow (bloom does the halo).
- **Size**: `r = 2 + 3·log10(row_count + 1)` world units (column count when no rows).
- **Color**: `dot-glow-n` by cluster (connected component or Postgres schema).
- **Label**: table name appears on hover, and always for the 12 dots nearest camera
  (fade by distance).

| State | Look |
|---|---|
| Idle | Core + glow, gentle pulse (period 4–6 s, random phase) |
| Hover | Glow ×1.6, label shown, linked dots + links brighten |
| Selected | Thin orbit ring rotates around dot, glow ×2 |
| In search path | Glow ×1.8, steady (no pulse), color shifts toward `link-active` |
| Required by search | Same as in-path + small marker ring |
| Flagged unreachable | `flag-red` ring, slow red pulse, glow off |
| Dimmed | 20% opacity (when something else is focused) |

### 4.2 Links (FKs)
- Thin threads (line with width 1–1.5 px, additive blend), `link-thread` idle.
- **Pulse**: small light pulse travels from child table (FK owner) to parent every
  3–8 s per link → shows FK direction without arrows.
- Self-reference: small loop arc on the dot.
- Multiple FKs between same pair: slightly curved, spread apart.

| State | Look |
|---|---|
| Idle | 25% thread, rare pulse |
| Hover neighbor | 60% |
| In ranked plan path | `link-active` 90%, continuous pulse train along the join order |
| Ambiguous FK | `flag-amber` dashed, user clicks to choose |

## 5. Transitions and motion

Camera driven by `camera-controls` (drei `CameraControls`) for smooth eased moves,
damping and interruptible tweens. Default easing: `easeInOutCubic`.

| # | Event | Motion | Time |
|---|---|---|---|
| 5.1 | **App open** | Start far out (5× web radius), stars streak briefly (warp shader), camera glides in; sky turns naturally as camera arcs | 2.2 s |
| 5.2 | **Schema load** | "Big bang": all dots spawn at center, burst out to random positions, then force layout settles them; links fade in after dots stop moving fast | 1.5 s burst + live settle |
| 5.3 | **Drag rotate** | Orbit with inertia (damping 0.08). Sky, stars, web turn as one | live |
| 5.4 | **Click dot (fly in)** | Camera arcs (not straight line) to dot, ends 3× dot radius away, other dots dim, mid stars and dust streak past; table panel slides in from right after arrive | 1.1 s |
| 5.5 | **Back (Esc / click empty space)** | Reverse arc to previous camera pose, dims lift | 0.9 s |
| 5.6 | **Idle** | After 20 s no input, very slow auto-orbit (0.6°/s). Any input stops it at once | live |
| 5.7 | **Run search** | Camera frames all required dots (fit bounding sphere), non-path dots dim, path links light up in join order one by one | 1.2 s |
| 5.8 | **Hover result #1–5** | Path for that plan lights, others fade; no camera move | 0.25 s |
| 5.9 | **Flag appears** | Flagged dot red pulse; click flag in list → fly to that dot | 1.1 s |
| 5.10 | **Switch data source** | Brief nebula brightness dip + shimmer on all dots (data reload), no camera move | 0.6 s |

Rules:
- Every camera move is interruptible by user input.
- Click on dot during a move retargets the move from current pose (no jump).
- `prefers-reduced-motion`: no warp, no streaks, no idle orbit; camera moves become
  0.3 s fades; pulses off.

## 6. Post-processing

`@react-three/postprocessing`:
- **Bloom** (mipmap blur, threshold 0.6, intensity 1.2) — main glow source.
- **Vignette** (darkness 0.5) — frames the view.
- **Film grain** (very light, 0.03) — space-photo feel.
- **Depth of field** only during fly-in (5.4), focus on target dot, off after arrive.
- No chromatic aberration by default.

## 7. UI layout

```
┌──────┬───────────────────────────────────────────────┬───────────┐
│ rail │                                               │  table    │
│ 56px │          full-screen 3D space (canvas)        │  panel    │
│ ───  │                                               │  420px    │
│ menu │                                               │ (on dot   │
│ 320px│                                               │  select)  │
│ glass│                                     [mini HUD]│           │
└──────┴───────────────────────────────────────────────┴───────────┘
```

- Canvas always fills the full window, under all UI.
- **Left rail** (icons): Schema, Data source, Search, Results, Settings. Click icon →
  320 px glass drawer slides out over canvas (canvas does not resize).
- **Right table panel**: glass, shows columns (PK/FK badges) + paged row grid. Opens after
  fly-in.
- **Mini HUD** (bottom right): table count, link count, FPS (dev), reset-view button,
  zoom slider.
- **Results**: 5 cards, rank number, score bar, joins/queries/cost chips, SQL in mono,
  copy button. Flags list under cards with red/amber icons.
- Typography: Inter (UI), JetBrains Mono (SQL, column types). Base 13 px, headings 15/18.
- Radius 12 px panels, 8 px inputs. Motion for panels 220 ms ease-out.

## 8. Input

| Input | Action |
|---|---|
| Left drag | Rotate |
| Right drag / Shift+drag | Pan |
| Wheel / pinch | Zoom |
| Click dot | Fly in + open panel |
| Double-click empty | Reset view |
| `Esc` | Back / close panel |
| `/` | Focus search |
| Arrow keys | Rotate 15° |
| `+` / `-` | Zoom |
| `F` | Frame all |

## 9. Performance and quality tiers

- Dots: one `InstancedMesh`/points draw call. Links: one merged `LineSegments2`. Labels:
  pooled, max 12 + hover.
- Target: 500 tables, ~1,500 links, ≥ 50 fps on integrated GPU at High; ≥ 60 fps on
  discrete GPU.
- Auto tier by measured FPS in first 3 s:

| Tier | Nebula | Stars | Dust | Bloom | DoF | Grain |
|---|---|---|---|---|---|---|
| High | 2048 cubemap | 8,560 | 400 | on | on | on |
| Medium | 1024 | 4,000 | 150 | on (half-res) | off | off |
| Low | 512 | 1,500 | 0 | off (glow via sprite only) | off | off |

User can override in Settings.

## 10. Tech notes

- `@react-three/fiber`, `@react-three/drei` (`CameraControls`, `Html` labels, `Points`),
  `@react-three/postprocessing`, custom GLSL for nebula, twinkle, link pulse, warp.
- Positions come from the Rust WASM layout worker (parent spec §3.1) as a
  `Float32Array`; the GPU buffer updates in place, no React re-render per frame.
- This spec replaces "OrbitControls" in the parent spec with `CameraControls`
  (needed for interruptible, eased fly-to transitions).

## 11. Testing

- Visual snapshot tests (Playwright) with fixed seed + fixed camera poses: default,
  hover, selected, search path, flags, reduced-motion.
- Test that sky orientation changes after a scripted 90° orbit (sample pixel hash
  differs) and is identical after orbiting back.
- FPS benchmark on 500-table synthetic schema per tier.
- Contrast check on UI panels over brightest nebula pose.
