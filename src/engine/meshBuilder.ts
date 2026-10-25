import Delaunator from 'delaunator';
import { compileMouthGeometry } from './mouthPenGeometry';
import { PuppetMesh, PuppetRig } from './types';

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * Builds a silhouette-clipped Delaunay 2D mesh with mouth-region refinement
 * and geodesic graph-distance bone skinning weights.
 */
export function buildPuppetMesh(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  rig: PuppetRig
): PuppetMesh {
  const GRID = 88;
  const rawOcc = new Uint8Array(GRID * GRID);

  // Step 1: Populate raw alpha occupancy grid
  let anyOpaque = false;
  for (let gy = 0; gy < GRID; gy++) {
    const y0 = Math.floor((gy / GRID) * height);
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) / GRID) * height));
    for (let gx = 0; gx < GRID; gx++) {
      const x0 = Math.floor((gx / GRID) * width);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) / GRID) * width));
      let hit = 0;
      // Sample step inside cell for speed on high-res images
      const stepY = Math.max(1, (y1 - y0) >> 1);
      const stepX = Math.max(1, (x1 - x0) >> 1);
      for (let py = y0; py < y1 && !hit; py += stepY) {
        const row = py * width;
        for (let px = x0; px < x1; px += stepX) {
          if (rgba[(row + px) * 4 + 3] > 10) {
            hit = 1;
            anyOpaque = true;
            break;
          }
        }
      }
      rawOcc[gy * GRID + gx] = hit;
    }
  }

  // Fallback if completely blank image
  if (!anyOpaque) {
    rawOcc.fill(1);
  }

  // Dilate occupancy by 2 cells (~2.3% margin) to preserve anti-aliased edges
  const occ = new Uint8Array(GRID * GRID);
  const DILATE = 2;
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      let found = 0;
      for (let dy = -DILATE; dy <= DILATE && !found; dy++) {
        const ny = gy + dy;
        if (ny < 0 || ny >= GRID) continue;
        for (let dx = -DILATE; dx <= DILATE; dx++) {
          const nx = gx + dx;
          if (nx < 0 || nx >= GRID) continue;
          if (rawOcc[ny * GRID + nx]) {
            found = 1;
            break;
          }
        }
      }
      occ[gy * GRID + gx] = found;
    }
  }

  const isOccupied = (x: number, y: number): boolean => {
    const gx = clamp(Math.floor(x * GRID), 0, GRID - 1);
    const gy = clamp(Math.floor(y * GRID), 0, GRID - 1);
    return occ[gy * GRID + gx] === 1;
  };

  // Step 2: Generate candidate points with spatial hash deduplication
  const pts: number[] = [];
  const minSpacing = 0.011;
  const minSpacingSq = minSpacing * minSpacing;

  const tryAddPoint = (
    x: number,
    y: number,
    requireOccupied = true,
    customMinSpacingSq = minSpacingSq
  ) => {
    const cx = clamp(x, 0.002, 0.998);
    const cy = clamp(y, 0.002, 0.998);
    if (requireOccupied && !isOccupied(cx, cy)) return;
    for (let i = 0; i < pts.length; i += 2) {
      const dx = pts[i] - cx;
      const dy = pts[i + 1] - cy;
      if (dx * dx + dy * dy < customMinSpacingSq) return;
    }
    pts.push(cx, cy);
  };

  // 2a: Ultra-clean contour points along the Mouth (both Custom Pen & Curved Default Mouth!)
  const compiledMouth = compileMouthGeometry(rig.mouth);
  const fineMouthSq = 0.0075 * 0.0075;
  for (let i = 0; i < compiledMouth.seam.length; i += 2) {
    const sPt = compiledMouth.seam[i];
    const uPt = compiledMouth.upperChain[i];
    const lPt = compiledMouth.lowerChain[i];
    const nVec = compiledMouth.localNormals[i];
    const jd = compiledMouth.jawDepth;

    tryAddPoint(sPt.x, sPt.y, true, fineMouthSq);
    tryAddPoint(uPt.x, uPt.y, true, fineMouthSq);
    tryAddPoint(lPt.x, lPt.y, true, fineMouthSq);

    // Smooth upper philtrum & lower chin falloff bands
    tryAddPoint(
      sPt.x - nVec.x * jd * 0.55,
      sPt.y - nVec.y * jd * 0.55,
      true,
      fineMouthSq
    );
    tryAddPoint(
      sPt.x + nVec.x * jd * 0.65,
      sPt.y + nVec.y * jd * 0.65,
      true,
      fineMouthSq
    );
    tryAddPoint(
      sPt.x + nVec.x * jd * 1.35,
      sPt.y + nVec.y * jd * 1.35,
      true
    );
  }

  // 2b: Add joint rest positions so bones anchor directly on vertices
  for (const j of rig.joints) {
    tryAddPoint(j.rest.x, j.rest.y, true);
  }

  // 2c: Staggered interior lattice (~27x27)
  const STEPS = 27;
  for (let iy = 0; iy <= STEPS; iy++) {
    const y = iy / STEPS;
    const stagger = iy % 2 === 1 ? 0.5 / STEPS : 0;
    for (let ix = 0; ix <= STEPS; ix++) {
      const x = ix / STEPS + stagger;
      if (x <= 1.0) {
        tryAddPoint(x, y, true);
      }
    }
  }

  // 2d: Contour boundary points along dilated silhouette edge
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      if (!occ[gy * GRID + gx]) continue;
      const isEdge =
        gx === 0 ||
        gy === 0 ||
        gx === GRID - 1 ||
        gy === GRID - 1 ||
        !occ[gy * GRID + (gx - 1)] ||
        !occ[gy * GRID + (gx + 1)] ||
        !occ[(gy - 1) * GRID + gx] ||
        !occ[(gy + 1) * GRID + gx];
      if (isEdge && (gx + gy) % 2 === 0) {
        tryAddPoint((gx + 0.5) / GRID, (gy + 0.5) / GRID, false);
      }
    }
  }

  // Guarantee at least 4 non-collinear points
  if (pts.length < 8) {
    pts.push(0.2, 0.2, 0.8, 0.2, 0.8, 0.8, 0.2, 0.8);
  }

  // Step 3: Delaunay Triangulation + Silhouette Clipping
  const delaunay = new Delaunator(pts);
  const rawTris = delaunay.triangles;
  const keptTris: number[] = [];

  for (let t = 0; t < rawTris.length; t += 3) {
    const a = rawTris[t];
    const b = rawTris[t + 1];
    const c = rawTris[t + 2];

    const ax = pts[a * 2],
      ay = pts[a * 2 + 1];
    const bx = pts[b * 2],
      by = pts[b * 2 + 1];
    const cx = pts[c * 2],
      cy = pts[c * 2 + 1];

    // Filter degenerate slivers
    const twiceArea = Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay));
    if (twiceArea < 1e-7) continue;

    // Filter long exterior bridging triangles across empty gaps (e.g. between legs/arms)
    const centX = (ax + bx + cx) / 3;
    const centY = (ay + by + cy) / 3;
    const mABx = (ax + bx) * 0.5,
      mABy = (ay + by) * 0.5;
    const mBCx = (bx + cx) * 0.5,
      mBCy = (by + cy) * 0.5;
    const mCAx = (cx + ax) * 0.5,
      mCAy = (cy + ay) * 0.5;

    if (
      isOccupied(centX, centY) &&
      isOccupied(mABx, mABy) &&
      isOccupied(mBCx, mBCy) &&
      isOccupied(mCAx, mCAy)
    ) {
      keptTris.push(a, b, c);
    }
  }

  // Safety fallback if silhouette was ultra-thin
  if (keptTris.length === 0) {
    for (let t = 0; t < rawTris.length; t++) {
      keptTris.push(rawTris[t]);
    }
  }

  // Step 4: Compact active vertices
  const totalCandidateVerts = pts.length >> 1;
  const remap = new Int32Array(totalCandidateVerts).fill(-1);
  let vertexCount = 0;

  for (let i = 0; i < keptTris.length; i++) {
    const oldIdx = keptTris[i];
    if (remap[oldIdx] === -1) {
      remap[oldIdx] = vertexCount++;
    }
  }

  const restPositions = new Float32Array(vertexCount * 2);
  const deformedPositions = new Float32Array(vertexCount * 2);
  const uvs = new Float32Array(vertexCount * 2);
  for (let oldIdx = 0; oldIdx < totalCandidateVerts; oldIdx++) {
    const newIdx = remap[oldIdx];
    if (newIdx !== -1) {
      const px = pts[oldIdx * 2];
      const py = pts[oldIdx * 2 + 1];
      restPositions[newIdx * 2] = px;
      restPositions[newIdx * 2 + 1] = py;
      deformedPositions[newIdx * 2] = px;
      deformedPositions[newIdx * 2 + 1] = py;
      uvs[newIdx * 2] = px;
      uvs[newIdx * 2 + 1] = py;
    }
  }

  const indices = new Uint16Array(keptTris.length);
  for (let i = 0; i < keptTris.length; i++) {
    indices[i] = remap[keptTris[i]];
  }

  // Step 5: Compute Geodesic Graph Skinning Weights
  const { boneIndices, boneWeights } = computeGeodesicSkinningWeights(
    restPositions,
    vertexCount,
    indices,
    rig
  );

  let headBoneIndex = rig.joints.findIndex((j) => j.id === 'head');
  if (headBoneIndex < 0) headBoneIndex = 0;

  return {
    vertexCount,
    restPositions,
    deformedPositions,
    uvs,
    indices,
    boneIndices,
    boneWeights,
    headBoneIndex,
  };
}

function computeGeodesicSkinningWeights(
  restPositions: Float32Array,
  vertexCount: number,
  indices: Uint16Array,
  rig: PuppetRig
): { boneIndices: Uint8Array; boneWeights: Float32Array } {
  const numJoints = Math.max(1, rig.joints.length);
  const boneIndices = new Uint8Array(vertexCount * 4);
  const boneWeights = new Float32Array(vertexCount * 4);

  if (vertexCount === 0) {
    return { boneIndices, boneWeights };
  }

  // Build vertex adjacency graph
  const adj: Array<Array<{ to: number; w: number }>> = Array.from(
    { length: vertexCount },
    () => []
  );

  const addEdge = (u: number, v: number, penalty = 1.0) => {
    if (u === v) return;
    for (let i = 0; i < adj[u].length; i++) {
      if (adj[u][i].to === v) return;
    }
    const dx = restPositions[u * 2] - restPositions[v * 2];
    const dy = restPositions[u * 2 + 1] - restPositions[v * 2 + 1];
    const d = Math.hypot(dx, dy) * penalty;
    adj[u].push({ to: v, w: d });
    adj[v].push({ to: u, w: d });
  };

  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t];
    const b = indices[t + 1];
    const c = indices[t + 2];
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  }

  // Ensure disconnected islands (hats, floating props) connect via high-cost bridges
  const comp = new Int32Array(vertexCount).fill(-1);
  const compRep: number[] = [];
  let compCount = 0;
  const bfs = new Int32Array(vertexCount);

  for (let v = 0; v < vertexCount; v++) {
    if (comp[v] !== -1) continue;
    const cid = compCount++;
    compRep.push(v);
    let head = 0,
      tail = 0;
    bfs[tail++] = v;
    comp[v] = cid;
    while (head < tail) {
      const cur = bfs[head++];
      const edges = adj[cur];
      for (let i = 0; i < edges.length; i++) {
        const nxt = edges[i].to;
        if (comp[nxt] === -1) {
          comp[nxt] = cid;
          bfs[tail++] = nxt;
        }
      }
    }
  }

  if (compCount > 1) {
    // Connect each island's closest vertex pair to component 0 with 3x bridge penalty
    for (let cid = 1; cid < compCount; cid++) {
      let bestU = compRep[0];
      let bestV = compRep[cid];
      let bestDistSq = Infinity;
      for (let v = 0; v < vertexCount; v++) {
        if (comp[v] !== cid) continue;
        const vx = restPositions[v * 2];
        const vy = restPositions[v * 2 + 1];
        for (let u = 0; u < vertexCount; u++) {
          if (comp[u] !== 0) continue;
          const dx = vx - restPositions[u * 2];
          const dy = vy - restPositions[u * 2 + 1];
          const dSq = dx * dx + dy * dy;
          if (dSq < bestDistSq) {
            bestDistSq = dSq;
            bestU = u;
            bestV = v;
          }
        }
      }
      addEdge(bestU, bestV, 3.0);
    }
  }

  // Count children per joint to identify single-child limb bones (shoulders, neck)
  const childrenMap: number[][] = Array.from({ length: numJoints }, () => []);
  rig.joints.forEach((j, idx) => {
    if (j.parentId) {
      const pIdx = rig.joints.findIndex((p) => p.id === j.parentId);
      if (pIdx >= 0) childrenMap[pIdx].push(idx);
    }
  });

  // Compute geodesic distance matrix [numJoints][vertexCount]
  const distMatrix = new Float32Array(numJoints * vertexCount);
  distMatrix.fill(1e6);

  // Lightweight binary min-heap for fast Dijkstra
  const heapNodes = new Int32Array(vertexCount * 8 + 64);
  const heapKeys = new Float32Array(vertexCount * 8 + 64);

  for (let jIdx = 0; jIdx < numJoints; jIdx++) {
    const joint = rig.joints[jIdx];
    const baseOffset = jIdx * vertexCount;

    // Seed points for this joint: joint rest position + partial segment if single-child limb
    const seeds: Array<{ x: number; y: number }> = [joint.rest];
    if (childrenMap[jIdx].length === 1) {
      const child = rig.joints[childrenMap[jIdx][0]];
      seeds.push({
        x: joint.rest.x * 0.65 + child.rest.x * 0.35,
        y: joint.rest.y * 0.65 + child.rest.y * 0.35,
      });
    }

    let heapSize = 0;
    const heapPush = (node: number, key: number) => {
      let i = heapSize++;
      heapNodes[i] = node;
      heapKeys[i] = key;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heapKeys[p] <= heapKeys[i]) break;
        const tn = heapNodes[p],
          tk = heapKeys[p];
        heapNodes[p] = heapNodes[i];
        heapKeys[p] = heapKeys[i];
        heapNodes[i] = tn;
        heapKeys[i] = tk;
        i = p;
      }
    };

    const heapPop = (): [number, number] => {
      const topN = heapNodes[0];
      const topK = heapKeys[0];
      heapSize--;
      if (heapSize > 0) {
        heapNodes[0] = heapNodes[heapSize];
        heapKeys[0] = heapKeys[heapSize];
        let i = 0;
        while (true) {
          const l = i * 2 + 1;
          const r = l + 1;
          let smallest = i;
          if (l < heapSize && heapKeys[l] < heapKeys[smallest]) smallest = l;
          if (r < heapSize && heapKeys[r] < heapKeys[smallest]) smallest = r;
          if (smallest === i) break;
          const tn = heapNodes[i],
            tk = heapKeys[i];
          heapNodes[i] = heapNodes[smallest];
          heapKeys[i] = heapKeys[smallest];
          heapNodes[smallest] = tn;
          heapKeys[smallest] = tk;
          i = smallest;
        }
      }
      return [topN, topK];
    };

    // Find closest mesh vertex for each seed
    for (const s of seeds) {
      let bestV = 0;
      let bestD = Infinity;
      for (let v = 0; v < vertexCount; v++) {
        const dx = restPositions[v * 2] - s.x;
        const dy = restPositions[v * 2 + 1] - s.y;
        const d = Math.hypot(dx, dy);
        if (d < bestD) {
          bestD = d;
          bestV = v;
        }
      }
      if (bestD < distMatrix[baseOffset + bestV]) {
        distMatrix[baseOffset + bestV] = bestD;
        heapPush(bestV, bestD);
      }
    }

    while (heapSize > 0) {
      const [u, d] = heapPop();
      if (d > distMatrix[baseOffset + u] + 1e-6) continue;
      const edges = adj[u];
      for (let i = 0; i < edges.length; i++) {
        const { to, w } = edges[i];
        const nd = d + w;
        if (nd < distMatrix[baseOffset + to]) {
          distMatrix[baseOffset + to] = nd;
          heapPush(to, nd);
        }
      }
    }
  }

  // Convert geodesic distances to crisp, localized normalized top-4 weights per vertex
  const SIGMA = 0.19;
  const twoSigmaSq = 2 * SIGMA * SIGMA;
  const EPS = 0.014;

  for (let v = 0; v < vertexCount; v++) {
    const topIdx = [0, 0, 0, 0];
    const topW = [0, 0, 0, 0];

    for (let j = 0; j < numJoints; j++) {
      const d = distMatrix[j * vertexCount + v];
      const stiff = rig.joints[j].stiffness ?? 1.0;
      const invPow = stiff / Math.pow(d + EPS, 2.65);
      const gauss = Math.exp(-(d * d) / twoSigmaSq);
      const w = invPow * (0.3 + 0.7 * gauss);

      if (w > topW[3]) {
        topW[3] = w;
        topIdx[3] = j;
        for (let k = 3; k > 0 && topW[k] > topW[k - 1]; k--) {
          const tw = topW[k];
          topW[k] = topW[k - 1];
          topW[k - 1] = tw;
          const ti = topIdx[k];
          topIdx[k] = topIdx[k - 1];
          topIdx[k - 1] = ti;
        }
      }
    }

    const sum = topW[0] + topW[1] + topW[2] + topW[3];
    const base4 = v * 4;
    if (sum > 1e-9) {
      for (let k = 0; k < 4; k++) {
        boneIndices[base4 + k] = topIdx[k];
        boneWeights[base4 + k] = topW[k] / sum;
      }
    } else {
      boneIndices[base4] = 0;
      boneWeights[base4] = 1.0;
    }
  }

  return { boneIndices, boneWeights };
}
