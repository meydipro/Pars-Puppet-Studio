import {
  CropRect,
  MouthGizmo,
  PuppetJoint,
  PuppetRig,
  RigMode,
  Vec2,
} from './types';

export interface ProcessedImageBuffer {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  hasTransparency: boolean;
}

export interface SilhouetteLandmarks {
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  hasTransparency: boolean;
  suggestedMode: RigMode;
  head: Vec2;
  headTop: Vec2;
  leftTemple: Vec2;
  rightTemple: Vec2;
  mouth: Vec2;
  neck: Vec2;
  chest: Vec2;
  waist: Vec2;
  hips: Vec2;
  leftShoulder: Vec2;
  leftElbow: Vec2;
  leftHand: Vec2;
  rightShoulder: Vec2;
  rightElbow: Vec2;
  rightHand: Vec2;
  leftKnee: Vec2;
  leftFoot: Vec2;
  rightKnee: Vec2;
  rightFoot: Vec2;
  baseLeft: Vec2;
  baseRight: Vec2;
  ribLeft: Vec2;
  ribRight: Vec2;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function parseHexRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    return [
      parseInt(clean[0] + clean[0], 16) || 255,
      parseInt(clean[1] + clean[1], 16) || 255,
      parseInt(clean[2] + clean[2], 16) || 255,
    ];
  }
  return [
    parseInt(clean.slice(0, 2), 16) || 255,
    parseInt(clean.slice(2, 4), 16) || 255,
    parseInt(clean.slice(4, 6), 16) || 255,
  ];
}

/**
 * Edge-seeded smart flood-fill background removal with soft edge feathering
 * and color spill decontamination. Runs in O(W*H) with zero GC churn.
 */
export function removeBackgroundFloodFill(
  srcRgba: Uint8ClampedArray,
  width: number,
  height: number,
  tolerance = 38,
  feather = 18
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(srcRgba);
  const total = width * height;
  if (total === 0) return out;

  // Estimate dominant border background colors from 8 border sample zones
  const samples: Array<[number, number, number]> = [];
  const addSample = (x: number, y: number) => {
    const idx = (clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1)) * 4;
    if (srcRgba[idx + 3] > 200) {
      samples.push([srcRgba[idx], srcRgba[idx + 1], srcRgba[idx + 2]]);
    }
  };

  addSample(0, 0);
  addSample(width - 1, 0);
  addSample(0, height - 1);
  addSample(width - 1, height - 1);
  addSample(width >> 1, 0);
  addSample(0, height >> 1);
  addSample(width - 1, height >> 1);

  if (samples.length === 0) {
    // Already transparent around borders
    return out;
  }

  const visited = new Uint8Array(total);
  const bgMask = new Uint8Array(total);
  const queue = new Int32Array(total);
  let qHead = 0;
  let qTail = 0;

  const tolSq = tolerance * tolerance * 3;
  const outerTol = tolerance + feather;
  const outerTolSq = outerTol * outerTol * 3;

  const minColorDistSq = (r: number, g: number, b: number): [number, number] => {
    let best = Infinity;
    let bestIdx = 0;
    for (let i = 0; i < samples.length; i++) {
      const dr = r - samples[i][0];
      const dg = g - samples[i][1];
      const db = b - samples[i][2];
      const d = dr * dr + dg * dg + db * db;
      if (d < best) {
        best = d;
        bestIdx = i;
      }
    }
    return [best, bestIdx];
  };

  const trySeed = (x: number, y: number) => {
    const p = y * width + x;
    if (visited[p]) return;
    const i4 = p * 4;
    if (srcRgba[i4 + 3] < 16) {
      visited[p] = 1;
      bgMask[p] = 1;
      queue[qTail++] = p;
      return;
    }
    const [dSq] = minColorDistSq(srcRgba[i4], srcRgba[i4 + 1], srcRgba[i4 + 2]);
    if (dSq <= tolSq) {
      visited[p] = 1;
      bgMask[p] = 1;
      queue[qTail++] = p;
    }
  };

  for (let x = 0; x < width; x++) {
    trySeed(x, 0);
    trySeed(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    trySeed(0, y);
    trySeed(width - 1, y);
  }

  while (qHead < qTail) {
    const p = queue[qHead++];
    const x = p % width;
    const y = (p - x) / width;

    // 4-connected neighbors
    const neighbors = [
      x > 0 ? p - 1 : -1,
      x + 1 < width ? p + 1 : -1,
      y > 0 ? p - width : -1,
      y + 1 < height ? p + width : -1,
    ];

    for (let n = 0; n < 4; n++) {
      const np = neighbors[n];
      if (np < 0 || visited[np]) continue;
      const i4 = np * 4;
      if (srcRgba[i4 + 3] < 16) {
        visited[np] = 1;
        bgMask[np] = 1;
        queue[qTail++] = np;
        continue;
      }
      const [dSq] = minColorDistSq(srcRgba[i4], srcRgba[i4 + 1], srcRgba[i4 + 2]);
      if (dSq <= tolSq) {
        visited[np] = 1;
        bgMask[np] = 1;
        queue[qTail++] = np;
      }
    }
  }

  // Apply background alpha = 0, and soft feather + spill removal on 2px boundary band
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const p = row + x;
      const i4 = p * 4;
      if (bgMask[p]) {
        out[i4 + 3] = 0;
        continue;
      }
      // Check if adjacent to removed background within 2px
      let nearBg = false;
      for (let dy = -2; dy <= 2 && !nearBg; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          if (bgMask[ny * width + nx]) {
            nearBg = true;
            break;
          }
        }
      }

      if (nearBg && feather > 0) {
        const [dSq, sampleIdx] = minColorDistSq(
          srcRgba[i4],
          srcRgba[i4 + 1],
          srcRgba[i4 + 2]
        );
        if (dSq < outerTolSq) {
          const dist = Math.sqrt(dSq / 3);
          const t = clamp((dist - tolerance * 0.75) / Math.max(1, feather), 0, 1);
          const newAlpha = Math.round(srcRgba[i4 + 3] * t);
          out[i4 + 3] = newAlpha;
          // Color decontamination to eliminate white/colored halo
          if (t > 0.08 && t < 0.98) {
            const bg = samples[sampleIdx];
            out[i4] = clamp(Math.round((srcRgba[i4] - (1 - t) * bg[0]) / t), 0, 255);
            out[i4 + 1] = clamp(
              Math.round((srcRgba[i4 + 1] - (1 - t) * bg[1]) / t),
              0,
              255
            );
            out[i4 + 2] = clamp(
              Math.round((srcRgba[i4 + 2] - (1 - t) * bg[2]) / t),
              0,
              255
            );
          }
        }
      }
    }
  }

  return out;
}

/**
 * Fast O(W*H) Chamfer Distance Transform sticker border generator.
 * Adds a crisp, anti-aliased sticker outline behind opaque character pixels.
 */
export function applyStickerBorderToRgba(
  srcRgba: Uint8ClampedArray,
  width: number,
  height: number,
  borderRadiusPx: number,
  borderHex = '#ffffff'
): Uint8ClampedArray {
  if (borderRadiusPx <= 0.2) return new Uint8ClampedArray(srcRgba);

  const total = width * height;
  const INF = 1e6;
  const dist = new Float32Array(total);

  for (let p = 0; p < total; p++) {
    dist[p] = srcRgba[p * 4 + 3] >= 90 ? 0 : INF;
  }

  const D1 = 1.0;
  const D2 = 1.41421356;

  // Forward pass
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const p = row + x;
      let d = dist[p];
      if (d === 0) continue;
      if (x > 0 && dist[p - 1] + D1 < d) d = dist[p - 1] + D1;
      if (y > 0) {
        const up = p - width;
        if (dist[up] + D1 < d) d = dist[up] + D1;
        if (x > 0 && dist[up - 1] + D2 < d) d = dist[up - 1] + D2;
        if (x + 1 < width && dist[up + 1] + D2 < d) d = dist[up + 1] + D2;
      }
      dist[p] = d;
    }
  }

  // Backward pass
  for (let y = height - 1; y >= 0; y--) {
    const row = y * width;
    for (let x = width - 1; x >= 0; x--) {
      const p = row + x;
      let d = dist[p];
      if (d === 0) continue;
      if (x + 1 < width && dist[p + 1] + D1 < d) d = dist[p + 1] + D1;
      if (y + 1 < height) {
        const dn = p + width;
        if (dist[dn] + D1 < d) d = dist[dn] + D1;
        if (x + 1 < width && dist[dn + 1] + D2 < d) d = dist[dn + 1] + D2;
        if (x > 0 && dist[dn - 1] + D2 < d) d = dist[dn - 1] + D2;
      }
      dist[p] = d;
    }
  }

  const [br, bg, bb] = parseHexRgb(borderHex);
  const out = new Uint8ClampedArray(srcRgba.length);

  for (let p = 0; p < total; p++) {
    const i4 = p * 4;
    const fgA = srcRgba[i4 + 3] / 255;
    const d = dist[p];

    // Anti-aliased outline coverage in [0..1]
    const outlineA = clamp(borderRadiusPx + 0.6 - d, 0, 1);

    if (fgA >= 0.995) {
      out[i4] = srcRgba[i4];
      out[i4 + 1] = srcRgba[i4 + 1];
      out[i4 + 2] = srcRgba[i4 + 2];
      out[i4 + 3] = 255;
    } else if (outlineA <= 0.001 && fgA <= 0.001) {
      out[i4 + 3] = 0;
    } else {
      // Porter-Duff source-over: fg over outline
      const outA = fgA + outlineA * (1 - fgA);
      if (outA > 0.001) {
        out[i4] = Math.round(
          (srcRgba[i4] * fgA + br * outlineA * (1 - fgA)) / outA
        );
        out[i4 + 1] = Math.round(
          (srcRgba[i4 + 1] * fgA + bg * outlineA * (1 - fgA)) / outA
        );
        out[i4 + 2] = Math.round(
          (srcRgba[i4 + 2] * fgA + bb * outlineA * (1 - fgA)) / outA
        );
        out[i4 + 3] = Math.round(outA * 255);
      }
    }
  }

  return out;
}

/**
 * Analyzes the alpha silhouette (or full rectangle if opaque) to detect
 * character proportions and place puppet landmarks accurately.
 */
export function analyzeCharacterSilhouette(
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): SilhouetteLandmarks {
  let borderTransparent = 0;
  let borderTotal = 0;
  for (let x = 0; x < width; x++) {
    borderTotal += 2;
    if (rgba[x * 4 + 3] < 32) borderTransparent++;
    if (rgba[((height - 1) * width + x) * 4 + 3] < 32) borderTransparent++;
  }
  for (let y = 1; y < height - 1; y++) {
    borderTotal += 2;
    if (rgba[y * width * 4 + 3] < 32) borderTransparent++;
    if (rgba[(y * width + (width - 1)) * 4 + 3] < 32) borderTransparent++;
  }

  const hasTransparency = borderTotal > 0 && borderTransparent / borderTotal > 0.12;

  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let opaqueCount = 0;

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (rgba[(row + x) * 4 + 3] > 28) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        opaqueCount++;
      }
    }
  }

  if (opaqueCount < 20) {
    minX = Math.floor(width * 0.1);
    maxX = Math.ceil(width * 0.9);
    minY = Math.floor(height * 0.1);
    maxY = Math.ceil(height * 0.9);
  }

  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);

  // Helper to scan horizontal span in a vertical band [yFrac0, yFrac1] of bbox
  const bandStats = (y0Frac: number, y1Frac: number) => {
    const sy0 = clamp(Math.floor(minY + bh * y0Frac), 0, height - 1);
    const sy1 = clamp(Math.ceil(minY + bh * y1Frac), sy0 + 1, height);
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    let leftX = maxX;
    let leftY = (sy0 + sy1) * 0.5;
    let rightX = minX;
    let rightY = (sy0 + sy1) * 0.5;

    for (let y = sy0; y < sy1; y++) {
      const row = y * width;
      for (let x = minX; x <= maxX; x++) {
        if (rgba[(row + x) * 4 + 3] > 40) {
          sumX += x;
          sumY += y;
          count++;
          if (x < leftX) {
            leftX = x;
            leftY = y;
          }
          if (x > rightX) {
            rightX = x;
            rightY = y;
          }
        }
      }
    }

    if (count === 0) {
      const cy = minY + bh * ((y0Frac + y1Frac) * 0.5);
      const cx = (minX + maxX) * 0.5;
      return {
        cx: cx / width,
        cy: cy / height,
        left: { x: (minX + bw * 0.2) / width, y: cy / height },
        right: { x: (minX + bw * 0.8) / width, y: cy / height },
        spanRatio: 0.6,
      };
    }

    return {
      cx: sumX / count / width,
      cy: sumY / count / height,
      left: {
        x: clamp((leftX + bw * 0.04) / width, 0.04, 0.96),
        y: clamp(leftY / height, 0.04, 0.96),
      },
      right: {
        x: clamp((rightX - bw * 0.04) / width, 0.04, 0.96),
        y: clamp(rightY / height, 0.04, 0.96),
      },
      spanRatio: (rightX - leftX) / bw,
    };
  };

  // Detect if bottom is wide continuous bust (portrait) vs taller figure
  const bottomBand = bandStats(0.82, 0.98);
  const aspect = bh / bw;
  const suggestedMode: RigMode =
    !hasTransparency || (aspect < 1.12 && bottomBand.spanRatio > 0.72)
      ? 'portrait'
      : 'fullBody';

  const headBand = bandStats(0.06, 0.28);
  const neckBand = bandStats(0.28, 0.36);
  const chestBand = bandStats(0.35, 0.52);
  const armBand = bandStats(0.34, 0.65);
  const hipBand = bandStats(0.56, 0.70);
  const footBand = bandStats(0.84, 0.99);

  // Separate left and right foot centroids in bottom band
  const midFootX = Math.round(hipBand.cx * width);
  let lfX = 0,
    lfY = 0,
    lfC = 0;
  let rfX = 0,
    rfY = 0,
    rfC = 0;
  const fy0 = clamp(Math.floor(minY + bh * 0.82), 0, height - 1);
  const fy1 = clamp(Math.ceil(minY + bh * 0.99), fy0 + 1, height);
  for (let y = fy0; y < fy1; y++) {
    const row = y * width;
    for (let x = minX; x <= maxX; x++) {
      if (rgba[(row + x) * 4 + 3] > 40) {
        if (x < midFootX) {
          lfX += x;
          lfY += y;
          lfC++;
        } else {
          rfX += x;
          rfY += y;
          rfC++;
        }
      }
    }
  }

  // Helper: ensures a candidate normalized pin [nx, ny] sits inside opaque character pixels
  const snapInside = (nx: number, ny: number): Vec2 => {
    const cx0 = clamp(nx, 0.04, 0.96);
    const cy0 = clamp(ny, 0.04, 0.96);
    if (!hasTransparency) return { x: cx0, y: cy0 };

    const px0 = clamp(Math.round(cx0 * (width - 1)), 0, width - 1);
    const py0 = clamp(Math.round(cy0 * (height - 1)), 0, height - 1);
    if (rgba[(py0 * width + px0) * 4 + 3] > 60) {
      return { x: cx0, y: cy0 };
    }

    const maxRad = Math.max(8, Math.round(Math.max(bw, bh) * 0.18));
    for (let r = 3; r <= maxRad; r += 3) {
      for (let k = 0; k < 16; k++) {
        const ang = (k / 16) * Math.PI * 2;
        const sx = clamp(Math.round(px0 + Math.cos(ang) * r), 0, width - 1);
        const sy = clamp(Math.round(py0 + Math.sin(ang) * r), 0, height - 1);
        if (rgba[(sy * width + sx) * 4 + 3] > 60) {
          return {
            x: clamp(sx / width, 0.04, 0.96),
            y: clamp(sy / height, 0.04, 0.96),
          };
        }
      }
    }
    return { x: cx0, y: cy0 };
  };

  const headPos: Vec2 = snapInside(
    headBand.cx,
    clamp((minY + bh * 0.17) / height, 0.06, 0.92)
  );
  const headTopPos: Vec2 = snapInside(
    headBand.cx,
    clamp((minY + bh * 0.075) / height, 0.04, 0.85)
  );
  const headHalfW = Math.max(0.05, (headBand.spanRatio * bw * 0.34) / width);
  const leftTemplePos: Vec2 = snapInside(headPos.x - headHalfW, headPos.y * 0.96);
  const rightTemplePos: Vec2 = snapInside(headPos.x + headHalfW, headPos.y * 0.96);

  const mouthPos: Vec2 = snapInside(
    headBand.cx,
    clamp((minY + bh * 0.235) / height, 0.08, 0.92)
  );

  const neckPos: Vec2 = snapInside(
    neckBand.cx,
    clamp((minY + bh * 0.31) / height, 0.1, 0.92)
  );
  const chestPos: Vec2 = snapInside(
    chestBand.cx,
    clamp((minY + bh * 0.42) / height, 0.15, 0.92)
  );
  const waistPos: Vec2 = snapInside(
    (chestBand.cx + hipBand.cx) * 0.5,
    clamp((minY + bh * 0.52) / height, 0.18, 0.93)
  );
  const hipsPos: Vec2 = snapInside(
    hipBand.cx,
    clamp((minY + bh * 0.62) / height, 0.2, 0.95)
  );

  const leftShoulderPos: Vec2 = snapInside(
    clamp(chestBand.cx - (bw * 0.16) / width, 0.05, 0.95),
    clamp((minY + bh * 0.36) / height, 0.12, 0.92)
  );
  const rightShoulderPos: Vec2 = snapInside(
    clamp(chestBand.cx + (bw * 0.16) / width, 0.05, 0.95),
    clamp((minY + bh * 0.36) / height, 0.12, 0.92)
  );

  const leftHandPos: Vec2 = snapInside(armBand.left.x, armBand.left.y);
  const rightHandPos: Vec2 = snapInside(armBand.right.x, armBand.right.y);

  const leftElbowPos: Vec2 = snapInside(
    (leftShoulderPos.x + leftHandPos.x) * 0.5,
    (leftShoulderPos.y + leftHandPos.y) * 0.5
  );
  const rightElbowPos: Vec2 = snapInside(
    (rightShoulderPos.x + rightHandPos.x) * 0.5,
    (rightShoulderPos.y + rightHandPos.y) * 0.5
  );

  const leftFootPos: Vec2 =
    lfC > 10
      ? snapInside(lfX / lfC / width, lfY / lfC / height)
      : snapInside(
          clamp(hipBand.cx - (bw * 0.14) / width, 0.08, 0.92),
          footBand.cy
        );
  const rightFootPos: Vec2 =
    rfC > 10
      ? snapInside(rfX / rfC / width, rfY / rfC / height)
      : snapInside(
          clamp(hipBand.cx + (bw * 0.14) / width, 0.08, 0.92),
          footBand.cy
        );

  const leftKneePos: Vec2 = snapInside(
    hipsPos.x * 0.35 + leftFootPos.x * 0.65,
    (hipsPos.y + leftFootPos.y) * 0.5
  );
  const rightKneePos: Vec2 = snapInside(
    hipsPos.x * 0.35 + rightFootPos.x * 0.65,
    (hipsPos.y + rightFootPos.y) * 0.5
  );

  const baseLeftPos: Vec2 = snapInside(
    clamp(bottomBand.cx - (bw * 0.28) / width, 0.06, 0.94),
    clamp((minY + bh * 0.92) / height, 0.35, 0.96)
  );
  const baseRightPos: Vec2 = snapInside(
    clamp(bottomBand.cx + (bw * 0.28) / width, 0.06, 0.94),
    clamp((minY + bh * 0.92) / height, 0.35, 0.96)
  );
  const ribLeftPos: Vec2 = snapInside(
    clamp(chestBand.cx - (bw * 0.26) / width, 0.06, 0.94),
    clamp((minY + bh * 0.78) / height, 0.28, 0.94)
  );
  const ribRightPos: Vec2 = snapInside(
    clamp(chestBand.cx + (bw * 0.26) / width, 0.06, 0.94),
    clamp((minY + bh * 0.78) / height, 0.28, 0.94)
  );

  return {
    bbox: {
      minX: minX / width,
      minY: minY / height,
      maxX: maxX / width,
      maxY: maxY / height,
    },
    hasTransparency,
    suggestedMode,
    head: headPos,
    headTop: headTopPos,
    leftTemple: leftTemplePos,
    rightTemple: rightTemplePos,
    mouth: mouthPos,
    neck: neckPos,
    chest: chestPos,
    waist: waistPos,
    hips: hipsPos,
    leftShoulder: leftShoulderPos,
    leftElbow: leftElbowPos,
    leftHand: leftHandPos,
    rightShoulder: rightShoulderPos,
    rightElbow: rightElbowPos,
    rightHand: rightHandPos,
    leftKnee: leftKneePos,
    leftFoot: leftFootPos,
    rightKnee: rightKneePos,
    rightFoot: rightFootPos,
    baseLeft: baseLeftPos,
    baseRight: baseRightPos,
    ribLeft: ribLeftPos,
    ribRight: ribRightPos,
  };
}

/**
 * Builds a high-control, multi-pin PuppetRig from silhouette landmarks
 * so animations stay crisp, grounded, and never deform out of control!
 */
export function buildAutoRigFromLandmarks(
  landmarks: SilhouetteLandmarks,
  mode: RigMode
): PuppetRig {
  const { bbox } = landmarks;
  const bw = Math.max(0.15, bbox.maxX - bbox.minX);
  const bh = Math.max(0.15, bbox.maxY - bbox.minY);
  const cx = (bbox.minX + bbox.maxX) * 0.5;

  if (mode === 'portrait') {
    const headCenter: Vec2 = {
      x: cx,
      y: clamp(bbox.minY + bh * 0.36, 0.12, 0.82),
    };
    const mouthCenter: Vec2 = {
      x: cx,
      y: clamp(bbox.minY + bh * 0.52, 0.18, 0.86),
    };
    const neckPos: Vec2 = {
      x: cx,
      y: clamp(bbox.minY + bh * 0.66, 0.24, 0.9),
    };
    const chestPos: Vec2 = {
      x: cx,
      y: clamp(bbox.minY + bh * 0.78, 0.28, 0.93),
    };
    const basePos: Vec2 = {
      x: cx,
      y: clamp(bbox.minY + bh * 0.93, 0.38, 0.97),
    };

    // 14 Default Pins in Portrait Mode (5 pinned base/flank anchors + 9 controlled upper/face pins)
    const joints: PuppetJoint[] = [
      {
        id: 'hips',
        nameFa: 'لنگر پایه میانی',
        parentId: null,
        rest: basePos,
        pinned: true,
        stiffness: 1.25,
        color: '#94a3b8',
      },
      {
        id: 'base_l',
        nameFa: 'لنگر پایین چپ',
        parentId: 'hips',
        rest: {
          x: clamp(cx - bw * 0.32, 0.06, 0.94),
          y: basePos.y,
        },
        pinned: true,
        stiffness: 1.25,
        color: '#94a3b8',
      },
      {
        id: 'base_r',
        nameFa: 'لنگر پایین راست',
        parentId: 'hips',
        rest: {
          x: clamp(cx + bw * 0.32, 0.06, 0.94),
          y: basePos.y,
        },
        pinned: true,
        stiffness: 1.25,
        color: '#94a3b8',
      },
      {
        id: 'rib_l',
        nameFa: 'نگهدارنده پهلوی چپ',
        parentId: 'hips',
        rest: {
          x: clamp(cx - bw * 0.34, 0.05, 0.95),
          y: clamp(bbox.minY + bh * 0.84, 0.3, 0.95),
        },
        pinned: true,
        stiffness: 1.15,
        color: '#64748b',
      },
      {
        id: 'rib_r',
        nameFa: 'نگهدارنده پهلوی راست',
        parentId: 'hips',
        rest: {
          x: clamp(cx + bw * 0.34, 0.05, 0.95),
          y: clamp(bbox.minY + bh * 0.84, 0.3, 0.95),
        },
        pinned: true,
        stiffness: 1.15,
        color: '#64748b',
      },
      {
        id: 'chest',
        nameFa: 'سینه و یقه',
        parentId: 'hips',
        rest: chestPos,
        stiffness: 1.15,
        color: '#38bdf8',
      },
      {
        id: 'l_shoulder',
        nameFa: 'شانه چپ',
        parentId: 'chest',
        rest: {
          x: clamp(cx - bw * 0.27, 0.06, 0.94),
          y: clamp(bbox.minY + bh * 0.75, 0.25, 0.94),
        },
        color: '#34d399',
      },
      {
        id: 'r_shoulder',
        nameFa: 'شانه راست',
        parentId: 'chest',
        rest: {
          x: clamp(cx + bw * 0.27, 0.06, 0.94),
          y: clamp(bbox.minY + bh * 0.75, 0.25, 0.94),
        },
        color: '#fb923c',
      },
      {
        id: 'neck',
        nameFa: 'گردن',
        parentId: 'chest',
        rest: neckPos,
        color: '#818cf8',
      },
      {
        id: 'head',
        nameFa: 'مرکز چهره',
        parentId: 'neck',
        rest: headCenter,
        stiffness: 1.25,
        color: '#a855f7',
      },
      {
        id: 'head_top',
        nameFa: 'تاج سر / مو',
        parentId: 'head',
        rest: { x: cx, y: clamp(bbox.minY + bh * 0.12, 0.04, 0.72) },
        stiffness: 1.2,
        color: '#c084fc',
      },
      {
        id: 'forehead',
        nameFa: 'پیشانی',
        parentId: 'head',
        rest: { x: cx, y: clamp(bbox.minY + bh * 0.24, 0.08, 0.78) },
        stiffness: 1.2,
        color: '#d8b4fe',
      },
      {
        id: 'l_temple',
        nameFa: 'گیجگاه و گونه چپ',
        parentId: 'head',
        rest: {
          x: clamp(cx - bw * 0.19, 0.06, 0.94),
          y: headCenter.y,
        },
        stiffness: 1.2,
        color: '#e879f9',
      },
      {
        id: 'r_temple',
        nameFa: 'گیجگاه و گونه راست',
        parentId: 'head',
        rest: {
          x: clamp(cx + bw * 0.19, 0.06, 0.94),
          y: headCenter.y,
        },
        stiffness: 1.2,
        color: '#e879f9',
      },
    ];

    const mouth: MouthGizmo = {
      center: mouthCenter,
      rx: clamp(bw * 0.13, 0.04, 0.22),
      ry: clamp(bh * 0.068, 0.026, 0.14),
      arch: 0.18,
      interiorColor: '#3b0a18',
      showTongue: true,
      showTeeth: true,
    };

    return { mode: 'portrait', joints, mouth };
  }

  if (mode === 'customPins') {
    // 12 Balanced Default Pins (3 pinned base anchors + 9 movable pins)
    const joints: PuppetJoint[] = [
      {
        id: 'hips',
        nameFa: 'پین پایه میانی (ثابت)',
        parentId: null,
        rest: landmarks.hips,
        pinned: true,
        stiffness: 1.2,
        color: '#f43f5e',
      },
      {
        id: 'base_l',
        nameFa: 'پین پایه چپ (ثابت)',
        parentId: 'hips',
        rest: landmarks.leftFoot,
        pinned: true,
        stiffness: 1.2,
        color: '#f43f5e',
      },
      {
        id: 'base_r',
        nameFa: 'پین پایه راست (ثابت)',
        parentId: 'hips',
        rest: landmarks.rightFoot,
        pinned: true,
        stiffness: 1.2,
        color: '#f43f5e',
      },
      {
        id: 'waist',
        nameFa: 'پین کمر',
        parentId: 'hips',
        rest: landmarks.waist,
        color: '#fbbf24',
      },
      {
        id: 'chest',
        nameFa: 'پین سینه',
        parentId: 'waist',
        rest: landmarks.chest,
        color: '#38bdf8',
      },
      {
        id: 'neck',
        nameFa: 'پین گردن',
        parentId: 'chest',
        rest: landmarks.neck,
        color: '#818cf8',
      },
      {
        id: 'head',
        nameFa: 'پین سر',
        parentId: 'neck',
        rest: landmarks.head,
        stiffness: 1.2,
        color: '#a855f7',
      },
      {
        id: 'head_top',
        nameFa: 'پین بالای سر',
        parentId: 'head',
        rest: landmarks.headTop,
        color: '#c084fc',
      },
      {
        id: 'l_temple',
        nameFa: 'پین گونه چپ',
        parentId: 'head',
        rest: landmarks.leftTemple,
        color: '#e879f9',
      },
      {
        id: 'r_temple',
        nameFa: 'پین گونه راست',
        parentId: 'head',
        rest: landmarks.rightTemple,
        color: '#e879f9',
      },
      {
        id: 'l_hand',
        nameFa: 'پین دست چپ',
        parentId: 'chest',
        rest: landmarks.leftHand,
        color: '#34d399',
      },
      {
        id: 'r_hand',
        nameFa: 'پین دست راست',
        parentId: 'chest',
        rest: landmarks.rightHand,
        color: '#fb923c',
      },
    ];

    const mouth: MouthGizmo = {
      center: landmarks.mouth,
      rx: clamp(bw * 0.1, 0.038, 0.19),
      ry: clamp(bh * 0.042, 0.024, 0.11),
      arch: 0.16,
      interiorColor: '#3b0a18',
      showTongue: true,
      showTeeth: true,
    };

    return { mode: 'customPins', joints, mouth };
  }

  // Default: 18-Pin Stabilized Full Body Skeleton (elbows, knees, waist, neck & head stabilizers!)
  const joints: PuppetJoint[] = [
    {
      id: 'hips',
      nameFa: 'لگن (مرکز ثقل)',
      parentId: null,
      rest: landmarks.hips,
      stiffness: 1.15,
      color: '#facc15',
    },
    {
      id: 'waist',
      nameFa: 'کمر و شکم',
      parentId: 'hips',
      rest: landmarks.waist,
      stiffness: 1.1,
      color: '#fde047',
    },
    {
      id: 'chest',
      nameFa: 'قفسه سینه',
      parentId: 'waist',
      rest: landmarks.chest,
      stiffness: 1.15,
      color: '#38bdf8',
    },
    {
      id: 'neck',
      nameFa: 'گردن',
      parentId: 'chest',
      rest: landmarks.neck,
      color: '#818cf8',
    },
    {
      id: 'head',
      nameFa: 'مرکز سر',
      parentId: 'neck',
      rest: landmarks.head,
      stiffness: 1.25,
      color: '#c084fc',
    },
    {
      id: 'head_top',
      nameFa: 'تاج سر',
      parentId: 'head',
      rest: landmarks.headTop,
      stiffness: 1.2,
      color: '#d8b4fe',
    },
    {
      id: 'l_temple',
      nameFa: 'گیجگاه چپ',
      parentId: 'head',
      rest: landmarks.leftTemple,
      stiffness: 1.2,
      color: '#e879f9',
    },
    {
      id: 'r_temple',
      nameFa: 'گیجگاه راست',
      parentId: 'head',
      rest: landmarks.rightTemple,
      stiffness: 1.2,
      color: '#e879f9',
    },
    {
      id: 'l_shoulder',
      nameFa: 'شانه چپ',
      parentId: 'chest',
      rest: landmarks.leftShoulder,
      color: '#34d399',
    },
    {
      id: 'l_elbow',
      nameFa: 'آرنج چپ',
      parentId: 'l_shoulder',
      rest: landmarks.leftElbow,
      color: '#6ee7b7',
    },
    {
      id: 'l_hand',
      nameFa: 'دست چپ',
      parentId: 'l_elbow',
      rest: landmarks.leftHand,
      color: '#10b981',
    },
    {
      id: 'r_shoulder',
      nameFa: 'شانه راست',
      parentId: 'chest',
      rest: landmarks.rightShoulder,
      color: '#fb923c',
    },
    {
      id: 'r_elbow',
      nameFa: 'آرنج راست',
      parentId: 'r_shoulder',
      rest: landmarks.rightElbow,
      color: '#fdba74',
    },
    {
      id: 'r_hand',
      nameFa: 'دست راست',
      parentId: 'r_elbow',
      rest: landmarks.rightHand,
      color: '#f97316',
    },
    {
      id: 'l_knee',
      nameFa: 'زانوی چپ',
      parentId: 'hips',
      rest: landmarks.leftKnee,
      color: '#5eead4',
    },
    {
      id: 'l_foot',
      nameFa: 'پای چپ',
      parentId: 'l_knee',
      rest: landmarks.leftFoot,
      color: '#2dd4bf',
    },
    {
      id: 'r_knee',
      nameFa: 'زانوی راست',
      parentId: 'hips',
      rest: landmarks.rightKnee,
      color: '#f9a8d4',
    },
    {
      id: 'r_foot',
      nameFa: 'پای راست',
      parentId: 'r_knee',
      rest: landmarks.rightFoot,
      color: '#f472b6',
    },
  ];

  const mouth: MouthGizmo = {
    center: landmarks.mouth,
    rx: clamp(bw * 0.095, 0.035, 0.17),
    ry: clamp(bh * 0.036, 0.022, 0.095),
    arch: 0.16,
    interiorColor: '#3b0a18',
    showTongue: true,
    showTeeth: true,
  };

  return { mode: 'fullBody', joints, mouth };
}

/**
 * Browser helper: Loads any File / Blob / DataURL into a normalized RGBA buffer
 * with clean safety padding so sticker borders and mesh deformations never clip.
 */
export async function loadBrowserImageToBuffer(
  source: File | Blob | string,
  maxDimension = 720
): Promise<ProcessedImageBuffer> {
  let objectUrl: string | null = null;
  const srcUrl =
    typeof source === 'string'
      ? source
      : ((objectUrl = URL.createObjectURL(source)), objectUrl);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = 'anonymous';
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('خطا در بارگذاری تصویر انتخاب‌شده.'));
      el.src = srcUrl;
    });

    const natW = Math.max(1, img.naturalWidth || img.width || 512);
    const natH = Math.max(1, img.naturalHeight || img.height || 512);

    // Add 7% padding around character so outlines & warp have breathing room
    const padFactor = 0.07;
    const scale = Math.min(1, (maxDimension * (1 - padFactor * 2)) / Math.max(natW, natH));
    const drawW = Math.max(16, Math.round(natW * scale));
    const drawH = Math.max(16, Math.round(natH * scale));
    const padX = Math.max(12, Math.round(drawW * padFactor));
    const padY = Math.max(12, Math.round(drawH * padFactor));

    const canvasW = drawW + padX * 2;
    const canvasH = drawH + padY * 2;

    const canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      throw new Error('مرورگر از پردازش دوبعدی تصویر پشتیبانی نمی‌کند.');
    }
    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, padX, padY, drawW, drawH);

    const imgData = ctx.getImageData(0, 0, canvasW, canvasH);

    // Check if the original inner region had transparency
    let innerTransparent = 0;
    const innerSamples = 40;
    for (let i = 0; i < innerSamples; i++) {
      const sx = padX + Math.floor(((i + 0.5) / innerSamples) * (drawW - 1));
      const topAlpha = imgData.data[(padY * canvasW + sx) * 4 + 3];
      const botAlpha = imgData.data[((padY + drawH - 1) * canvasW + sx) * 4 + 3];
      if (topAlpha < 40) innerTransparent++;
      if (botAlpha < 40) innerTransparent++;
    }

    return {
      rgba: imgData.data,
      width: canvasW,
      height: canvasH,
      hasTransparency: innerTransparent > innerSamples * 0.25,
    };
  } finally {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
  }
}

/**
 * Pure TypedArray rotation (0/90/180/270 CW) and horizontal/vertical flip.
 */
export function transformImageOrientation(
  src: ProcessedImageBuffer,
  rotation: 0 | 90 | 180 | 270 = 0,
  flipH = false,
  flipV = false
): ProcessedImageBuffer {
  if (rotation === 0 && !flipH && !flipV) {
    return src;
  }

  const W = src.width;
  const H = src.height;
  const outW = rotation === 90 || rotation === 270 ? H : W;
  const outH = rotation === 90 || rotation === 270 ? W : H;
  const out = new Uint8ClampedArray(outW * outH * 4);

  for (let y = 0; y < H; y++) {
    const srcRow = y * W;
    for (let x = 0; x < W; x++) {
      let ox = x;
      let oy = y;
      if (rotation === 90) {
        ox = H - 1 - y;
        oy = x;
      } else if (rotation === 180) {
        ox = W - 1 - x;
        oy = H - 1 - y;
      } else if (rotation === 270) {
        ox = y;
        oy = W - 1 - x;
      }

      if (flipH) ox = outW - 1 - ox;
      if (flipV) oy = outH - 1 - oy;

      const s4 = (srcRow + x) * 4;
      const d4 = (oy * outW + ox) * 4;
      out[d4] = src.rgba[s4];
      out[d4 + 1] = src.rgba[s4 + 1];
      out[d4 + 2] = src.rgba[s4 + 2];
      out[d4 + 3] = src.rgba[s4 + 3];
    }
  }

  return {
    rgba: out,
    width: outW,
    height: outH,
    hasTransparency: src.hasTransparency,
  };
}

/**
 * Detects a tight normalized CropRect around the character/subject, working
 * for both transparent PNGs and solid-background JPGs.
 */
export function computeSmartSubjectCrop(
  src: ProcessedImageBuffer,
  marginFrac = 0.04
): CropRect {
  const { rgba, width, height } = src;
  if (width < 4 || height < 4) {
    return { x: 0, y: 0, w: 1, h: 1 };
  }

  // Sample 4 corners to detect if opaque solid background
  const corners = [
    0,
    (width - 1) * 4,
    (height - 1) * width * 4,
    ((height - 1) * width + (width - 1)) * 4,
  ];
  let cornerOpaque = 0;
  let cr = 0,
    cg = 0,
    cb = 0;
  for (const idx of corners) {
    if (rgba[idx + 3] > 200) {
      cornerOpaque++;
      cr += rgba[idx];
      cg += rgba[idx + 1];
      cb += rgba[idx + 2];
    }
  }
  const useColorDiff = cornerOpaque >= 3;
  if (useColorDiff) {
    cr /= cornerOpaque;
    cg /= cornerOpaque;
    cb /= cornerOpaque;
  }

  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let hits = 0;

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const i4 = (row + x) * 4;
      const a = rgba[i4 + 3];
      let isSubject = a > 25;
      if (isSubject && useColorDiff) {
        const dr = rgba[i4] - cr;
        const dg = rgba[i4 + 1] - cg;
        const db = rgba[i4 + 2] - cb;
        isSubject = dr * dr + dg * dg + db * db > 32 * 32 * 3;
      }
      if (isSubject) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        hits++;
      }
    }
  }

  if (hits < 16 || maxX <= minX || maxY <= minY) {
    return { x: 0.05, y: 0.05, w: 0.9, h: 0.9 };
  }

  const x0 = clamp(minX / width - marginFrac, 0, 0.95);
  const y0 = clamp(minY / height - marginFrac, 0, 0.95);
  const x1 = clamp((maxX + 1) / width + marginFrac, x0 + 0.05, 1);
  const y1 = clamp((maxY + 1) / height + marginFrac, y0 + 0.05, 1);

  return {
    x: x0,
    y: y0,
    w: x1 - x0,
    h: y1 - y0,
  };
}

/**
 * Crops an RGBA buffer to normalized `crop` [0..1] and optionally adds subtle
 * transparent breathing padding so puppet mesh & sticker borders never clip.
 */
export function cropImageBuffer(
  src: ProcessedImageBuffer,
  crop: CropRect,
  addSafetyPadding = true
): ProcessedImageBuffer {
  const cx = clamp(crop.x, 0, 0.96);
  const cy = clamp(crop.y, 0, 0.96);
  const cw = clamp(crop.w, 0.04, 1 - cx);
  const ch = clamp(crop.h, 0.04, 1 - cy);

  const sx0 = clamp(Math.floor(cx * src.width), 0, src.width - 1);
  const sy0 = clamp(Math.floor(cy * src.height), 0, src.height - 1);
  const cropW = Math.max(8, Math.min(src.width - sx0, Math.round(cw * src.width)));
  const cropH = Math.max(8, Math.min(src.height - sy0, Math.round(ch * src.height)));

  const padX = addSafetyPadding ? Math.max(8, Math.round(cropW * 0.06)) : 0;
  const padY = addSafetyPadding ? Math.max(8, Math.round(cropH * 0.06)) : 0;

  const outW = cropW + padX * 2;
  const outH = cropH + padY * 2;
  const out = new Uint8ClampedArray(outW * outH * 4);

  let borderTransparent = 0;
  let borderCount = 0;

  for (let y = 0; y < cropH; y++) {
    const srcStart = ((sy0 + y) * src.width + sx0) * 4;
    const dstStart = ((padY + y) * outW + padX) * 4;
    out.set(src.rgba.subarray(srcStart, srcStart + cropW * 4), dstStart);

    // Check inner cropped border transparency
    borderCount += 2;
    if (out[dstStart + 3] < 40) borderTransparent++;
    if (out[dstStart + (cropW - 1) * 4 + 3] < 40) borderTransparent++;
  }

  for (let x = 0; x < cropW; x++) {
    borderCount += 2;
    if (out[(padY * outW + padX + x) * 4 + 3] < 40) borderTransparent++;
    if (out[((padY + cropH - 1) * outW + padX + x) * 4 + 3] < 40) {
      borderTransparent++;
    }
  }

  return {
    rgba: out,
    width: outW,
    height: outH,
    hasTransparency:
      borderCount > 0 ? borderTransparent / borderCount > 0.15 : src.hasTransparency,
  };
}

/**
 * Converts a ProcessedImageBuffer into a PNG DataURL for UI preview (e.g. Crop Modal).
 */
export function bufferToDataUrl(buf: ProcessedImageBuffer): string {
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  canvas.width = buf.width;
  canvas.height = buf.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const copy = new Uint8ClampedArray(buf.rgba.length);
  copy.set(buf.rgba);
  ctx.putImageData(new ImageData(copy, buf.width, buf.height), 0, 0);
  return canvas.toDataURL('image/png');
}
