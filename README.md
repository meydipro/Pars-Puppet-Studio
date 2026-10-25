# Pars Puppet Studio

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18.3-61DAFB?logo=react&logoColor=0B1120)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-6.x-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![WebGL](https://img.shields.io/badge/Renderer-WebGL1%20%2B%20CPU%20Fallback-990000)](https://get.webgl.org/)
[![Tests](https://img.shields.io/badge/Vitest-12%2F12%20Passing-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-F59E0B.svg)](./LICENSE)

**Pars Puppet Studio** (`پاپت‌استودیو`) is a browser-based **2D Mesh Puppet Animation & Lip-Sync Studio** that turns any static character illustration, avatar, portrait, or meme into an expressive, loop-seamless animated puppet and exports clean, transparent **GIF89a** stickers and animations — 100% client-side with zero server uploads.

---

## Highlights & Capabilities

### 1. Non-Destructive Image Preparation
- **Universal Image Import:** Upload `PNG`, `JPG`, `WebP`, or `SVG` files via file picker, drag-and-drop onto the stage, or direct clipboard paste (`Ctrl+V` / `Cmd+V`), plus **4 procedural rigged sample characters** ready out of the box.
- **Interactive Crop, Rotate & Flip Modal:** Drag handles, aspect-ratio presets (`Free`, `1:1`, `4:5`, `16:9`), `90°` CW/CCW rotation, horizontal/vertical mirroring, and **1-click Smart Subject Auto-Trim** with non-destructive reset at any time.
- **Flood-Fill Background Removal & Sticker Outlines:** Border-seeded flood-fill background extraction with edge color-spill decontamination (preserving interior white highlights such as eye reflections), plus an $O(W \times H)$ two-pass Chamfer distance transform for crisp sticker borders.

### 2. Custom Pen Mouth Tool & Organic Curved Lip Sync
- **Interactive Vector Pen Tool (`ابزار Pen`):** Built specifically for characters with crooked, tilted, asymmetric, or stylized mouths. Trace an **open curved lip seam** (`〰`) from corner to corner or close a **full lip loop** (`⬠`) using Catmull-Rom splines or sharp linear segments, with `100%–400%` stage zoom/pan, mid-edge point insertion, right-click vertex deletion, and live vowel preview.
- **Curved Smile/Frown Seam Architecture:** Even default mouths compile into smooth Catmull-Rom arcs with an interactive middle bend handle and arch slider (`-80%` to `+80%`) rather than rigid flat lines.
- **Zero-Artifact Anti-Ghosting Lip Tuck:** Mesh deformation and inner-cavity rendering share a unified viseme rim solver (`evaluateSampleLipRim`). Static mouth pixels on the source texture are monotonically tucked behind the animated upper and lower lip rims—preventing both triangle fold-overs and static mouth lines from poking out underneath.
- **3 Mouth Rendering Modes + Co-Articulated Speech:** Choose between **Cutout Hinged Jaw** (shaded oral cavity, clipped curved upper teeth & tongue), **Pure Mesh Jaw**, or **Cartoon Viseme Overlay** (with automatic local skin-tone sampling & concealment). Drive lip-sync from **typed Persian/English dialogue** (with optional RTL comic speech bubbles), **live Web Audio microphone input**, or push-to-talk (`Space`).

### 3. Silhouette-Clipped Delaunay Mesh & Stabilized Geodesic Rigging
- **Adaptive Delaunay Triangulation:** High-density interior and contour sampling with sub-centimeter (`0.0075`) refinement rings around custom/curved lip seams so mouth opening never shears neighboring nose or cheek pixels.
- **Geodesic Shortest-Path Bone Skinning:** Top-4 per-vertex bone weights are solved via Dijkstra shortest paths *strictly inside the character silhouette*, preventing empty-space weight bleeding between separated arms or legs, with automatic Euclidean fallback for floating accessories (hats, eyebrows, detached props).
- **High-Density Stabilizer Pin Layouts:**
  - **Full-Body (`18` pins):** Includes shoulders, 2-bone IK-assisted elbows (`l_elbow`, `r_elbow`), hands, waist, knees (`l_knee`, `r_knee`), ground-planted feet, and a rigid head-cluster shield (`head_top`, `l_temple`, `r_temple`) that prevents facial feature distortion.
  - **Portrait / Avatar (`14` pins):** Includes `5` pinned lower-frame & ribcage anchors plus forehead/temple stabilizers for controlled upper-body motion.
  - **Custom Puppet Pins (`12` base pins + unlimited click-to-add pins):** Toggle any pin between free motion and hard anchor lock (`Pinned`), or drag joints live on stage.

### 4. Multi-Track Timeline, Presets & Web Worker GIF89a Export
- **12 Loop-Seamless Procedural Presets:** *Natural Talk*, *Excited Talk*, *Laugh*, *Wave Hello*, *Happy Jump*, *Dance Groove*, *Walk Cycle*, *Run Cycle*, *Idle Breathe*, *Surprised*, *Nod Yes*, and *Shake No* — all guaranteed $C^0$ continuous across loop boundaries ($u = 0 \leftrightarrow 1$).
- **Visual Multi-Track Studio Timeline:** Frame/second ruler, interactive scrubbing playhead, real-time body-motion & lip-sync waveform curves, draggable keyframe diamonds, **1-click Bake Preset to Editable Keyframes**, and a 64-bucket live mouse puppeteering recorder with full `Undo / Redo`.
- **Multi-Threaded Transparent GIF89a Exporter:** Offloads palette quantization and LZW encoding to a dedicated Web Worker (`gifenc`). Palette index `0` is strictly reserved for `alpha < 128` while opaque colors quantize into `255` slots shifted by `+1`, guaranteeing pure black (`#000000`) pupils and ink outlines never turn transparent.

---

## Architecture & Pipeline

```text
Source Image (Upload / Paste / Sample)
  │
  ├─► Non-Destructive Orientation & Crop (ImageCropModal ─► cropImageBuffer)
  │
  ├─► Flood-Fill Cutout + Chamfer Sticker Border (imageProcessor.ts)
  │
  ├─► Silhouette Landmark Scanner + 18/14/12 Auto-Rigger (imageProcessor.ts)
  │
  ├─► Unified Curved / Pen Mouth Compiler (mouthPenGeometry.ts)
  │
  ├─► Silhouette-Clipped Delaunay Mesh + Geodesic Dijkstra Weights (meshBuilder.ts)
  │
  ├─► 60 FPS Pose & Co-Articulated Viseme Solver (rigAndAnimator.ts)
  │     ├── Layer 1: 12 Loop-Seamless Presets + Standing Foot-Plant + 2-Bone Limb Solver
  │     ├── Layer 2: Recorded Live Puppeteering Track (64-bucket circular buffer)
  │     ├── Layer 3: Hermite-Interpolated Keyframe Track
  │     └── Layer 4: Live Interactive Drag + Limb Auto-Aim
  │
  ├─► WebGL1 Textured Mesh Renderer + Barycentric Software Fallback (renderer.ts)
  │
  └─► Offscreen Frame Rasterizer ─► Web Worker GIF89a Encoder (gifExporter.ts / gifCore.ts)
```

### Project Structure

| Path | Responsibility |
| :--- | :--- |
| `src/engine/types.ts` | Core data contracts for rigs, `CustomMouthPath`, poses, meshes, timeline keyframes, and export options |
| `src/engine/imageProcessor.ts` | Flood-fill background removal, color decontamination, Chamfer sticker border, crop/rotate/flip, and 18/14/12 auto-rigger |
| `src/engine/mouthPenGeometry.ts` | Catmull-Rom spline compiler, CW/CCW corner detector, viseme rim solver, anti-ghosting lip tuck, and skin-tone sampler |
| `src/engine/meshBuilder.ts` | Adaptive Delaunay triangulation, silhouette triangle clipping, mouth-seam vertex seeding, and Dijkstra geodesic bone weights |
| `src/engine/rigAndAnimator.ts` | 12 seamless presets, syllable co-articulation, FK + 2-bone mid-limb solver, mesh skinning deformer, and preset-to-keyframe baker |
| `src/engine/renderer.ts` | WebGL1 mesh pipeline, CPU Barycentric fallback, smooth curved mouth/teeth/tongue renderer, RTL speech bubbles, and Pen UI overlays |
| `src/engine/gifCore.ts` | Transparent-safe GIF89a quantization (`index 0` transparency isolation, GCT power-of-two padding, Floyd-Steinberg dithering) |
| `src/engine/gif.worker.ts` | Dedicated Web Worker wrapper for non-blocking multi-frame GIF encoding |
| `src/engine/gifExporter.ts` | Offscreen frame synthesis, ping-pong loop expansion, abort handling, and worker orchestration |
| `src/engine/sampleCharacters.ts` | 4 procedural vector-rendered sample characters with pre-configured stabilized rigs |
| `src/components/StageViewport.tsx` | Interactive 60 FPS stage with `animate`, `setup_rig`, and `pen_mouth` tools plus `100%–400%` camera zoom/pan |
| `src/components/TimelineBar.tsx` | Multi-track timeline with playhead scrubbing, motion/lip-sync curves, draggable keyframes, and live recording |
| `src/components/ImageCropModal.tsx` | Interactive non-destructive crop, aspect lock, `90°` rotation, mirror flip, and smart auto-trim modal |
| `src/components/CharacterRigPanel.tsx` | Character import, cutout, Pen mouth & smile-arch controls, rig mode switcher, and stage styling sidebar |
| `src/components/AnimationPresetsPanel.tsx` | Preset library, microphone lip-sync, mouth style selector, dialogue editor, and motion physics sliders |
| `src/components/GifExportModal.tsx` | Resolution, FPS, transparency, dithering, ping-pong loop settings, progress bar, and instant GIF preview/download |
| `src/engine/__tests__/puppetEngine.test.ts` | Automated Vitest verification suite covering cutout, geodesic skinning, loop continuity, Pen mouth geometry, and GIF89a binary headers |

---

## Getting Started

### Prerequisites
- **Node.js** `>= 18.0.0`
- **npm** `>= 9.0.0`

### Installation & Local Development

```bash
# Clone the repository
git clone https://github.com/<your-username>/pars-puppet-studio.git
cd pars-puppet-studio

# Install dependencies
npm install

# Start the development server (http://localhost:5173)
npm run dev
```

### Testing & Production Build

```bash
# Run the automated unit & integration test suite (Vitest)
npm test

# Type-check with TypeScript and build optimized production assets into ./dist
npm run build

# Preview the production build locally
npm run preview
```

---

## Keyboard & Stage Shortcuts

| Shortcut / Gesture | Action |
| :--- | :--- |
| **`Space` (Hold in Animate Mode)** | Push-to-talk live jaw & lip-sync animation |
| **`Drag Joint` (Animate Mode)** | Move hands, head, or torso live (records automatically when `REC` is active) |
| **`Mouse Wheel` / `Ctrl + Wheel`** | Zoom stage camera (`100%` – `400%`) around the character/mouth |
| **`Alt + Drag` / `Middle-Click Drag`** | Pan stage camera smoothly while zoomed in |
| **`Click` (Pen Mouth Mode)** | Place control point along crooked/curved mouth line (or click green `P0` to close loop) |
| **`Shift + Drag` (Pen Mouth Mode)** | Freehand curve tracing along uneven lips |
| **`Enter` / `Double-Click` (Pen Mode)** | Commit curved lip seam immediately |
| **`Backspace` / `Right-Click` (Pen Mode)** | Undo last draft point or delete hovered vertex on an existing custom mouth |
| **`Ctrl/Cmd + V`** | Paste an image directly from the clipboard into the studio |

---

## Deployment

Because **Pars Puppet Studio** is a pure static SPA (React + WebGL + Web Workers) with bundled self-hosted typography (`@fontsource/vazirmatn`), the `dist/` folder produced by `npm run build` can be deployed directly to:
- **GitHub Pages** / **GitHub Releases** (automated workflow included in `.github/workflows/ci-and-release.yml`)
- **Vercel** / **Netlify** / **Cloudflare Pages** (Build command: `npm run build`, Output directory: `dist`)

---

## License

Released under the [MIT License](./LICENSE).
