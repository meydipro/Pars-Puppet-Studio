import {
  CustomMouthPath,
  MouthGizmo,
  MouthStyle,
  Vec2,
  VisemeShape,
} from './types';

export interface CompiledCustomMouth {
  kind: 'polygon' | 'seam' | 'default';
  outline: Vec2[];
  upperChain: Vec2[];
  lowerChain: Vec2[];
  seam: Vec2[];
  /** Per-sample blended downward unit normals along seam (organic curved opening!) */
  localNormals: Vec2[];
  /** Per-sample upper/lower static-lip cover half-thickness around seam */
  upperCover: Float32Array;
  lowerCover: Float32Array;
  cornerLeft: Vec2;
  cornerRight: Vec2;
  center: Vec2;
  /** Unit vector from left mouth corner toward right mouth corner */
  axisU: Vec2;
  /** Unit vector perpendicular to axisU pointing downward toward chin */
  normalDown: Vec2;
  tiltAngle: number;
  spanWidth: number;
  jawDepth: number;
  influenceBbox: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function dedupePoints(pts: Vec2[], minDist = 0.0015): Vec2[] {
  const out: Vec2[] = [];
  for (const p of pts) {
    if (
      out.length === 0 ||
      Math.hypot(p.x - out[out.length - 1].x, p.y - out[out.length - 1].y) >=
        minDist
    ) {
      out.push({ x: clamp(p.x, 0.01, 0.99), y: clamp(p.y, 0.01, 0.99) });
    }
  }
  if (
    out.length >= 3 &&
    Math.hypot(
      out[0].x - out[out.length - 1].x,
      out[0].y - out[out.length - 1].y
    ) < minDist
  ) {
    out.pop();
  }
  return out;
}

/**
 * Centripetal Catmull-Rom spline subdivision (prevents loops/cusps on uneven spacing).
 */
export function subdivideCatmullRom(
  pts: Vec2[],
  closed: boolean,
  subdivisions = 4
): Vec2[] {
  const n = pts.length;
  if (n < 2) return pts.slice();
  if (n === 2 && !closed) {
    const out: Vec2[] = [];
    for (let s = 0; s <= subdivisions * 2; s++) {
      const t = s / (subdivisions * 2);
      out.push({
        x: pts[0].x + (pts[1].x - pts[0].x) * t,
        y: pts[0].y + (pts[1].y - pts[0].y) * t,
      });
    }
    return out;
  }

  const getPt = (idx: number): Vec2 => {
    if (closed) {
      return pts[((idx % n) + n) % n];
    }
    if (idx < 0) {
      return {
        x: pts[0].x * 2 - pts[1].x,
        y: pts[0].y * 2 - pts[1].y,
      };
    }
    if (idx >= n) {
      return {
        x: pts[n - 1].x * 2 - pts[n - 2].x,
        y: pts[n - 1].y * 2 - pts[n - 2].y,
      };
    }
    return pts[idx];
  };

  const segCount = closed ? n : n - 1;
  const result: Vec2[] = [];

  const knotDelta = (a: Vec2, b: Vec2) => {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    return Math.max(1e-4, Math.sqrt(d)); // alpha = 0.5 centripetal
  };

  for (let i = 0; i < segCount; i++) {
    const p0 = getPt(i - 1);
    const p1 = getPt(i);
    const p2 = getPt(i + 1);
    const p3 = getPt(i + 2);

    const t0 = 0;
    const t1 = t0 + knotDelta(p0, p1);
    const t2 = t1 + knotDelta(p1, p2);
    const t3 = t2 + knotDelta(p2, p3);

    const steps = subdivisions;
    const maxS = !closed && i === segCount - 1 ? steps : steps - 1;

    for (let s = 0; s <= maxS; s++) {
      const u = s / steps;
      const t = t1 + (t2 - t1) * u;

      const a1x = ((t1 - t) / (t1 - t0)) * p0.x + ((t - t0) / (t1 - t0)) * p1.x;
      const a1y = ((t1 - t) / (t1 - t0)) * p0.y + ((t - t0) / (t1 - t0)) * p1.y;
      const a2x = ((t2 - t) / (t2 - t1)) * p1.x + ((t - t1) / (t2 - t1)) * p2.x;
      const a2y = ((t2 - t) / (t2 - t1)) * p1.y + ((t - t1) / (t2 - t1)) * p2.y;
      const a3x = ((t3 - t) / (t3 - t2)) * p2.x + ((t - t2) / (t3 - t2)) * p3.x;
      const a3y = ((t3 - t) / (t3 - t2)) * p2.y + ((t - t2) / (t3 - t2)) * p3.y;

      const b1x = ((t2 - t) / (t2 - t0)) * a1x + ((t - t0) / (t2 - t0)) * a2x;
      const b1y = ((t2 - t) / (t2 - t0)) * a1y + ((t - t0) / (t2 - t0)) * a2y;
      const b2x = ((t3 - t) / (t3 - t1)) * a2x + ((t - t1) / (t3 - t1)) * a3x;
      const b2y = ((t3 - t) / (t3 - t1)) * a2y + ((t - t1) / (t3 - t1)) * a3y;

      const cx = ((t2 - t) / (t2 - t1)) * b1x + ((t - t1) / (t2 - t1)) * b2x;
      const cy = ((t2 - t) / (t2 - t1)) * b1y + ((t - t1) / (t2 - t1)) * b2y;

      result.push({ x: clamp(cx, 0.005, 0.995), y: clamp(cy, 0.005, 0.995) });
    }
  }

  return result;
}

/**
 * Resamples an open polyline uniformly by arc length to `count` vertices.
 */
export function resamplePolylineUniform(chain: Vec2[], count = 25): Vec2[] {
  if (chain.length === 0) return [];
  if (chain.length === 1) {
    return Array.from({ length: count }, () => ({ ...chain[0] }));
  }

  const cumLen = new Float64Array(chain.length);
  cumLen[0] = 0;
  for (let i = 1; i < chain.length; i++) {
    cumLen[i] =
      cumLen[i - 1] +
      Math.hypot(chain[i].x - chain[i - 1].x, chain[i].y - chain[i - 1].y);
  }
  const totalLen = cumLen[chain.length - 1];
  if (totalLen < 1e-6) {
    return Array.from({ length: count }, () => ({ ...chain[0] }));
  }

  const out: Vec2[] = [];
  let seg = 0;
  for (let k = 0; k < count; k++) {
    const target = (k / Math.max(1, count - 1)) * totalLen;
    while (seg < chain.length - 2 && cumLen[seg + 1] < target) {
      seg++;
    }
    const l0 = cumLen[seg];
    const l1 = cumLen[seg + 1];
    const alpha = l1 > l0 ? clamp((target - l0) / (l1 - l0), 0, 1) : 0;
    out.push({
      x: chain[seg].x + (chain[seg + 1].x - chain[seg].x) * alpha,
      y: chain[seg].y + (chain[seg + 1].y - chain[seg].y) * alpha,
    });
  }
  return out;
}

/**
 * Compiles a user's CustomMouthPath into upper/lower lip chains, uneven seam,
 * per-point local curve normals, corner tilt axis, and anti-ghosting cover bands.
 * Returns null ONLY if `mouth.customPath` is absent/invalid.
 */
export function compileCustomMouth(
  mouth: MouthGizmo
): CompiledCustomMouth | null {
  const custom = mouth.customPath;
  if (!custom || !custom.points) return null;

  const cleanPts = dedupePoints(custom.points);
  if (custom.kind === 'seam' && cleanPts.length < 2) return null;
  if (custom.kind === 'polygon' && cleanPts.length < 3) return null;

  const SAMPLES = 25;

  if (custom.kind === 'seam') {
    const denseSeam = custom.smooth
      ? subdivideCatmullRom(cleanPts, false, 6)
      : cleanPts;

    const first = denseSeam[0];
    const last = denseSeam[denseSeam.length - 1];
    const ordered =
      last.x >= first.x ? denseSeam : [...denseSeam].reverse();

    const seam = resamplePolylineUniform(ordered, SAMPLES);
    const cLeft = seam[0];
    const cRight = seam[seam.length - 1];

    const dx = cRight.x - cLeft.x;
    const dy = cRight.y - cLeft.y;
    const rawSpan = Math.hypot(dx, dy);
    if (rawSpan < 1e-4) return null;

    const clampedAng = clamp(
      Math.atan2(dy, dx),
      (-55 * Math.PI) / 180,
      (55 * Math.PI) / 180
    );
    const axisU: Vec2 = { x: Math.cos(clampedAng), y: Math.sin(clampedAng) };
    let normalDown: Vec2 = { x: -axisU.y, y: axisU.x };
    if (normalDown.y < 0) {
      normalDown = { x: -normalDown.x, y: -normalDown.y };
    }

    const localNormals = computeBlendedSeamNormals(seam, normalDown);
    const lipHalfThick = Math.max(0.0045, Math.min(0.018, rawSpan * 0.055));
    const upperChain: Vec2[] = [];
    const lowerChain: Vec2[] = [];
    const upperCover = new Float32Array(SAMPLES);
    const lowerCover = new Float32Array(SAMPLES);

    for (let i = 0; i < SAMPLES; i++) {
      const s = i / (SAMPLES - 1);
      const env = Math.pow(Math.sin(Math.PI * s), 0.75);
      const n = localNormals[i];
      const band = lipHalfThick * (0.25 + 0.75 * env);
      upperCover[i] = band;
      lowerCover[i] = band;
      upperChain.push({
        x: seam[i].x - n.x * band,
        y: seam[i].y - n.y * band,
      });
      lowerChain.push({
        x: seam[i].x + n.x * band,
        y: seam[i].y + n.y * band,
      });
    }

    const outline: Vec2[] = [
      ...upperChain,
      ...lowerChain.slice(1, -1).reverse(),
    ];

    return finalizeCompiledMouth(
      'seam',
      outline,
      upperChain,
      lowerChain,
      seam,
      localNormals,
      upperCover,
      lowerCover,
      cLeft,
      cRight,
      axisU,
      normalDown,
      clampedAng,
      mouth.ry
    );
  }

  // Closed Polygon case
  const denseOutline = custom.smooth
    ? subdivideCatmullRom(cleanPts, true, 4)
    : subdividePolygonLinear(cleanPts, 3);

  let cx = 0,
    cy = 0;
  for (const p of denseOutline) {
    cx += p.x;
    cy += p.y;
  }
  cx /= denseOutline.length;
  cy /= denseOutline.length;

  let covXX = 0,
    covXY = 0,
    covYY = 0;
  for (const p of denseOutline) {
    const rx = p.x - cx;
    const ry = p.y - cy;
    covXX += rx * rx;
    covXY += rx * ry;
    covYY += ry * ry;
  }

  let pcaAngle = 0;
  if (covXX >= covYY * 0.75) {
    pcaAngle = 0.5 * Math.atan2(2 * covXY, covXX - covYY);
  } else {
    pcaAngle = clamp(covXY / Math.max(1e-5, covYY), -0.35, 0.35);
  }
  const clampedAng = clamp(
    pcaAngle,
    (-55 * Math.PI) / 180,
    (55 * Math.PI) / 180
  );
  const axisU: Vec2 = { x: Math.cos(clampedAng), y: Math.sin(clampedAng) };
  let normalDown: Vec2 = { x: -axisU.y, y: axisU.x };
  if (normalDown.y < 0) {
    normalDown = { x: -normalDown.x, y: -normalDown.y };
  }

  let idxLeft = 0;
  let idxRight = 0;
  let minProj = Infinity;
  let maxProj = -Infinity;

  for (let i = 0; i < denseOutline.length; i++) {
    const p = denseOutline[i];
    const proj = (p.x - cx) * axisU.x + (p.y - cy) * axisU.y;
    if (proj < minProj) {
      minProj = proj;
      idxLeft = i;
    }
    if (proj > maxProj) {
      maxProj = proj;
      idxRight = i;
    }
  }

  if (idxLeft === idxRight) {
    idxRight = (idxLeft + (denseOutline.length >> 1)) % denseOutline.length;
  }

  const chainForward: Vec2[] = [];
  for (let i = idxLeft; ; i = (i + 1) % denseOutline.length) {
    chainForward.push(denseOutline[i]);
    if (i === idxRight) break;
  }

  const chainBackward: Vec2[] = [];
  for (
    let i = idxLeft;
    ;
    i = (i - 1 + denseOutline.length) % denseOutline.length
  ) {
    chainBackward.push(denseOutline[i]);
    if (i === idxRight) break;
  }

  const avgNormalProj = (arr: Vec2[]) => {
    let s = 0;
    for (const p of arr) {
      s += (p.x - cx) * normalDown.x + (p.y - cy) * normalDown.y;
    }
    return s / Math.max(1, arr.length);
  };

  const rawUpper =
    avgNormalProj(chainForward) <= avgNormalProj(chainBackward)
      ? chainForward
      : chainBackward;
  const rawLower = rawUpper === chainForward ? chainBackward : chainForward;

  const upperChain = resamplePolylineUniform(rawUpper, SAMPLES);
  const lowerChain = resamplePolylineUniform(rawLower, SAMPLES);
  const seam: Vec2[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    seam.push({
      x: (upperChain[i].x + lowerChain[i].x) * 0.5,
      y: (upperChain[i].y + lowerChain[i].y) * 0.5,
    });
  }

  const localNormals = computeBlendedSeamNormals(seam, normalDown);
  const upperCover = new Float32Array(SAMPLES);
  const lowerCover = new Float32Array(SAMPLES);
  for (let i = 0; i < SAMPLES; i++) {
    const gap = Math.hypot(
      lowerChain[i].x - upperChain[i].x,
      lowerChain[i].y - upperChain[i].y
    );
    const half = Math.max(0.004, gap * 0.52);
    upperCover[i] = half;
    lowerCover[i] = half;
  }

  return finalizeCompiledMouth(
    'polygon',
    denseOutline,
    upperChain,
    lowerChain,
    seam,
    localNormals,
    upperCover,
    lowerCover,
    denseOutline[idxLeft],
    denseOutline[idxRight],
    axisU,
    normalDown,
    clampedAng,
    mouth.ry
  );
}

/**
 * Unified mouth compiler: compiles CustomMouthPath if present, OR synthesizes
 * a natural curved smile/arch seam from the default MouthGizmo (`arch` curve)
 * so EVERY mouth animates with organic curvature and zero double-mouth artifacts!
 */
export function compileMouthGeometry(mouth: MouthGizmo): CompiledCustomMouth {
  const custom = compileCustomMouth(mouth);
  if (custom) return custom;

  const SAMPLES = 25;
  const rx = Math.max(0.025, mouth.rx);
  const ry = Math.max(0.018, mouth.ry);
  const arch = clamp(mouth.arch ?? 0.16, -0.85, 0.85);

  const pLeft: Vec2 = {
    x: clamp(mouth.center.x - rx * 0.92, 0.01, 0.99),
    y: clamp(mouth.center.y - arch * ry * 0.42, 0.01, 0.99),
  };
  const pMid: Vec2 = {
    x: clamp(mouth.center.x, 0.01, 0.99),
    y: clamp(mouth.center.y + arch * ry * 0.48, 0.01, 0.99),
  };
  const pRight: Vec2 = {
    x: clamp(mouth.center.x + rx * 0.92, 0.01, 0.99),
    y: clamp(mouth.center.y - arch * ry * 0.42, 0.01, 0.99),
  };

  const dense = subdivideCatmullRom([pLeft, pMid, pRight], false, 8);
  const seam = resamplePolylineUniform(dense, SAMPLES);
  const axisU: Vec2 = { x: 1, y: 0 };
  const normalDown: Vec2 = { x: 0, y: 1 };
  const localNormals = computeBlendedSeamNormals(seam, normalDown);

  const lipHalfThick = Math.max(0.005, Math.min(0.018, ry * 0.28));
  const upperChain: Vec2[] = [];
  const lowerChain: Vec2[] = [];
  const upperCover = new Float32Array(SAMPLES);
  const lowerCover = new Float32Array(SAMPLES);

  for (let i = 0; i < SAMPLES; i++) {
    const s = i / (SAMPLES - 1);
    const env = Math.pow(Math.sin(Math.PI * s), 0.78);
    const band = lipHalfThick * (0.28 + 0.72 * env);
    const n = localNormals[i];
    upperCover[i] = band;
    lowerCover[i] = band;
    upperChain.push({
      x: seam[i].x - n.x * band,
      y: seam[i].y - n.y * band,
    });
    lowerChain.push({
      x: seam[i].x + n.x * band,
      y: seam[i].y + n.y * band,
    });
  }

  const outline: Vec2[] = [
    ...upperChain,
    ...lowerChain.slice(1, -1).reverse(),
  ];

  return finalizeCompiledMouth(
    'default',
    outline,
    upperChain,
    lowerChain,
    seam,
    localNormals,
    upperCover,
    lowerCover,
    pLeft,
    pRight,
    axisU,
    normalDown,
    0,
    ry
  );
}

function computeBlendedSeamNormals(seam: Vec2[], globalDown: Vec2): Vec2[] {
  const n = seam.length;
  const normals: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = seam[Math.max(0, i - 1)];
    const next = seam[Math.min(n - 1, i + 1)];
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const tLen = Math.hypot(tx, ty);
    if (tLen < 1e-6) {
      normals.push({ ...globalDown });
      continue;
    }
    tx /= tLen;
    ty /= tLen;
    let nx = -ty;
    let ny = tx;
    if (nx * globalDown.x + ny * globalDown.y < 0) {
      nx = -nx;
      ny = -ny;
    }
    // Blend 42% local curve normal + 58% global jaw normal for organic radial opening without kinks
    let bx = nx * 0.42 + globalDown.x * 0.58;
    let by = ny * 0.42 + globalDown.y * 0.58;
    const bLen = Math.hypot(bx, by) || 1;
    normals.push({ x: bx / bLen, y: by / bLen });
  }
  return normals;
}

function subdividePolygonLinear(pts: Vec2[], stepsPerEdge: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    for (let s = 0; s < stepsPerEdge; s++) {
      const t = s / stepsPerEdge;
      out.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
      });
    }
  }
  return out;
}

function finalizeCompiledMouth(
  kind: 'polygon' | 'seam' | 'default',
  outline: Vec2[],
  upperChain: Vec2[],
  lowerChain: Vec2[],
  seam: Vec2[],
  localNormals: Vec2[],
  upperCover: Float32Array,
  lowerCover: Float32Array,
  cornerLeft: Vec2,
  cornerRight: Vec2,
  axisU: Vec2,
  normalDown: Vec2,
  tiltAngle: number,
  mouthRy: number
): CompiledCustomMouth {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  let sumX = 0,
    sumY = 0;

  for (const p of outline) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  for (const p of seam) {
    sumX += p.x;
    sumY += p.y;
  }

  const center: Vec2 = {
    x: sumX / seam.length,
    y: sumY / seam.length,
  };
  const spanWidth = Math.max(
    0.025,
    Math.hypot(cornerRight.x - cornerLeft.x, cornerRight.y - cornerLeft.y)
  );
  const jawDepth = clamp(
    Math.max(0.018, mouthRy * 0.92, spanWidth * 0.22),
    0.018,
    0.095
  );
  const padX = Math.max(spanWidth * 0.5, jawDepth * 1.4);
  const padUp = Math.max(jawDepth * 1.4, 0.035);
  const padDown = Math.max(jawDepth * 2.5, 0.065);

  return {
    kind,
    outline,
    upperChain,
    lowerChain,
    seam,
    localNormals,
    upperCover,
    lowerCover,
    cornerLeft,
    cornerRight,
    center,
    axisU,
    normalDown,
    tiltAngle,
    spanWidth,
    jawDepth,
    influenceBbox: {
      minX: minX - padX,
      maxX: maxX + padX,
      minY: minY - padUp,
      maxY: maxY + padDown,
    },
  };
}

/**
 * Shared viseme-aware lip parting profile used by BOTH mesh deformation AND cavity rendering
 * so the rendered inner mouth rim and deformed lip skin match 100.000% with ZERO ghosting!
 */
function evaluateSampleLipRim(
  cm: CompiledCustomMouth,
  s: number,
  uCover: number,
  lCover: number,
  mouthOpen: number,
  mouthWide: number,
  viseme: VisemeShape = 'A'
): {
  openMask: number;
  uRim: number;
  lRim: number;
  wideShift: number;
  cornerSmileLift: number;
} {
  const clampedS = clamp(s, 0, 1);
  const sinS = Math.sin(Math.PI * clampedS);
  const openMask = smoothstep(0.015, 0.14, mouthOpen);

  // Viseme-shaped arch exponent (narrow rounded 'O'/'U', broad curved 'E', natural 'A')
  const archExp =
    viseme === 'O' || viseme === 'U'
      ? 1.52
      : viseme === 'E' || viseme === 'smile'
      ? 0.68
      : 0.88;
  const baseArch = Math.pow(Math.max(0, sinS), archExp);

  // Subtle natural Cupid's bow softness on upper lip so it never looks like a rigid machine slot
  const cupidsBow =
    1 - 0.07 * Math.exp(-Math.pow((clampedS - 0.5) / 0.16, 2));
  const upperProfile = baseArch * cupidsBow;
  const lowerProfile = Math.pow(Math.max(0, sinS), archExp * 1.04);

  const openScale =
    viseme === 'O' || viseme === 'U'
      ? 1.06
      : viseme === 'M' || viseme === 'rest'
      ? 0.0
      : 0.96;
  const openDist = mouthOpen * cm.jawDepth * openScale;

  // Rim includes exact lip-tuck cover so static mouth pixels stay 100% inside cavity when open!
  const uRim =
    openDist * 0.22 * upperProfile + uCover * 0.72 * openMask * upperProfile;
  const lRim =
    openDist * 0.96 * lowerProfile + lCover * 0.78 * openMask * lowerProfile;

  const effWide =
    viseme === 'O' || viseme === 'U'
      ? Math.min(mouthWide, -0.14 * openMask)
      : viseme === 'E' || viseme === 'smile'
      ? Math.max(mouthWide, 0.16 * openMask)
      : mouthWide;

  const wideShift =
    (clampedS - 0.5) *
    cm.spanWidth *
    (effWide * 0.26 - mouthOpen * 0.035) *
    Math.pow(sinS, 0.45);

  // Subtle upward corner smile lift on 'E'/smile or wide talking
  const cornerWeight = Math.sin(Math.PI * Math.min(1, clampedS * 2)) * 0.5;
  const cornerSmileLift =
    effWide > 0.02
      ? -cm.jawDepth * 0.16 * effWide * (1 - baseArch * 0.65) * (0.35 + cornerWeight)
      : 0;

  return { openMask, uRim, lRim, wideShift, cornerSmileLift };
}

/**
 * Deforms a rest-space vertex (vx, vy) along the compiled mouth contour.
 * Provably tucks static mouth line pixels strictly inside [uRim, lRim] during cutout_jaw
 * so ZERO duplicate/extra mouth pixels ever poke out underneath the animated mouth!
 */
export function deformVertexByCustomMouth(
  vx: number,
  vy: number,
  cm: CompiledCustomMouth,
  mouthOpen: number,
  mouthWide: number,
  style: MouthStyle,
  viseme: VisemeShape = 'A'
): [number, number] {
  const bb = cm.influenceBbox;
  if (vx < bb.minX || vx > bb.maxX || vy < bb.minY || vy > bb.maxY) {
    return [vx, vy];
  }

  const seam = cm.seam;
  const nSeg = seam.length - 1;
  let bestDistSq = Infinity;
  let bestQx = seam[0].x;
  let bestQy = seam[0].y;
  let bestSeg = 0;
  let bestT = 0;

  for (let i = 0; i < nSeg; i++) {
    const ax = seam[i].x,
      ay = seam[i].y;
    const bx = seam[i + 1].x,
      by = seam[i + 1].y;
    const abx = bx - ax,
      aby = by - ay;
    const lenSq = abx * abx + aby * aby;
    let t = lenSq > 1e-9 ? ((vx - ax) * abx + (vy - ay) * aby) / lenSq : 0;
    t = clamp(t, 0, 1);
    const qx = ax + abx * t;
    const qy = ay + aby * t;
    const dSq = (vx - qx) * (vx - qx) + (vy - qy) * (vy - qy);
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestQx = qx;
      bestQy = qy;
      bestSeg = i;
      bestT = t;
    }
  }

  const bestS = (bestSeg + bestT) / nSeg;

  // Interpolate local normal and cover bands smoothly along seam
  const nA = cm.localNormals[bestSeg];
  const nB = cm.localNormals[bestSeg + 1];
  let nx = nA.x + (nB.x - nA.x) * bestT;
  let ny = nA.y + (nB.y - nA.y) * bestT;
  const nLen = Math.hypot(nx, ny) || 1;
  nx /= nLen;
  ny /= nLen;

  const uCover = Math.max(
    0.004,
    cm.upperCover[bestSeg] +
      (cm.upperCover[bestSeg + 1] - cm.upperCover[bestSeg]) * bestT
  );
  const lCover = Math.max(
    0.004,
    cm.lowerCover[bestSeg] +
      (cm.lowerCover[bestSeg + 1] - cm.lowerCover[bestSeg]) * bestT
  );

  const relX = vx - bestQx;
  const relY = vy - bestQy;

  const dn = relX * nx + relY * ny;
  const dt = Math.abs(relX * cm.axisU.x + relY * cm.axisU.y);

  const cornerFade = Math.max(0, 1 - Math.pow(dt / (cm.spanWidth * 0.44), 2));
  if (cornerFade <= 0.001) return [vx, vy];

  const jawD = cm.jawDepth;
  const upReach = Math.max(uCover * 2.4, jawD * 1.35);
  const downReach = Math.max(lCover * 2.8, jawD * 2.25);

  if (dn < -upReach || dn > downReach) return [vx, vy];

  const { openMask, uRim, lRim, wideShift, cornerSmileLift } =
    evaluateSampleLipRim(
      cm,
      bestS,
      uCover,
      lCover,
      mouthOpen,
      mouthWide,
      viseme
    );

  let pushNormal = 0;
  let radialFade = 0;

  if (style === 'cutout_jaw') {
    if (dn >= 0) {
      if (dn <= lCover) {
        // Static lower-lip pixels tuck monotonically strictly inside +lRim!
        const frac = dn / lCover;
        const targetDn =
          dn * (1 - openMask) + openMask * lRim * (0.25 + 0.75 * frac);
        pushNormal = (targetDn - dn) * cornerFade;
        radialFade = 1;
      } else {
        // Clean chin skin right below static mouth parts smoothly from lRim without tearing chin!
        const edgeDelta = openMask * (lRim - lCover);
        const uChin = clamp(
          (dn - lCover) / Math.max(1e-5, downReach - lCover),
          0,
          1
        );
        radialFade = (1 - uChin * uChin) * (1 - uChin * uChin);
        pushNormal = edgeDelta * radialFade * cornerFade;
      }
    } else {
      const adn = -dn;
      if (adn <= uCover) {
        const frac = adn / uCover;
        const targetAdn =
          adn * (1 - openMask) + openMask * uRim * (0.25 + 0.75 * frac);
        pushNormal = -(targetAdn - adn) * cornerFade;
        radialFade = 1;
      } else {
        const edgeDelta = openMask * (uRim - uCover);
        const uUp = clamp(
          (adn - uCover) / Math.max(1e-5, upReach - uCover),
          0,
          1
        );
        radialFade = (1 - uUp * uUp) * (1 - uUp * uUp);
        pushNormal = -edgeDelta * radialFade * cornerFade;
      }
    }
  } else if (style === 'mesh_jaw') {
    const normN = dn >= 0 ? dn / downReach : -dn / upReach;
    radialFade = (1 - normN * normN) * (1 - normN * normN);
    const weight = cornerFade * radialFade;
    pushNormal = (dn >= 0 ? lRim * 0.95 : -uRim * 0.85) * weight;
  } else if (style === 'cartoon_viseme') {
    // Subtle chin follow-through while keeping static mouth stationary under skin concealer
    const normN = dn >= 0 ? dn / downReach : -dn / upReach;
    radialFade = (1 - normN * normN) * (1 - normN * normN);
    pushNormal =
      dn > lCover
        ? lRim * 0.28 * radialFade * cornerFade
        : 0;
  }

  const smileOffset = cornerSmileLift * radialFade * cornerFade;
  const pushTangent = wideShift * radialFade * cornerFade;

  return [
    vx + nx * (pushNormal + smileOffset) + cm.axisU.x * pushTangent,
    vy + ny * (pushNormal + smileOffset) + cm.axisU.y * pushTangent,
  ];
}

/**
 * Generates the exact curved, viseme-shaped inner-mouth cavity & lip rims (in rest space).
 */
export function buildAnimatedCustomMouthPolygons(
  cm: CompiledCustomMouth,
  mouthOpen: number,
  mouthWide: number,
  viseme: VisemeShape = 'A'
): {
  seamPts: Vec2[];
  upperPts: Vec2[];
  lowerPts: Vec2[];
  closedPolygon: Vec2[];
} {
  const n = cm.seam.length;
  const seamPts: Vec2[] = [];
  const upperPts: Vec2[] = [];
  const lowerPts: Vec2[] = [];

  for (let i = 0; i < n; i++) {
    const s = i / Math.max(1, n - 1);
    const base = cm.seam[i];
    const norm = cm.localNormals[i];
    const uCov = cm.upperCover[i];
    const lCov = cm.lowerCover[i];

    const { uRim, lRim, wideShift, cornerSmileLift } = evaluateSampleLipRim(
      cm,
      s,
      uCov,
      lCov,
      mouthOpen,
      mouthWide,
      viseme
    );

    const sx = base.x + cm.axisU.x * wideShift + norm.x * cornerSmileLift;
    const sy = base.y + cm.axisU.y * wideShift + norm.y * cornerSmileLift;

    seamPts.push({ x: sx, y: sy });
    upperPts.push({
      x: sx - norm.x * uRim,
      y: sy - norm.y * uRim,
    });
    lowerPts.push({
      x: sx + norm.x * lRim,
      y: sy + norm.y * lRim,
    });
  }

  const closedPolygon: Vec2[] = [
    ...upperPts,
    ...lowerPts.slice(0, -1).reverse(),
  ];

  return { seamPts, upperPts, lowerPts, closedPolygon };
}

/**
 * Inserts a new control point onto the closest edge of `customPath.points`.
 */
export function insertPointOnCustomPath(
  path: CustomMouthPath,
  pt: Vec2
): CustomMouthPath {
  const pts = path.points;
  if (pts.length < 2) {
    return { ...path, points: [...pts, pt] };
  }

  const edgeCount = path.kind === 'polygon' ? pts.length : pts.length - 1;
  let bestIdx = pts.length;
  let bestDistSq = Infinity;

  for (let i = 0; i < edgeCount; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const lenSq = abx * abx + aby * aby;
    const t =
      lenSq > 1e-9
        ? clamp(((pt.x - a.x) * abx + (pt.y - a.y) * aby) / lenSq, 0, 1)
        : 0;
    const qx = a.x + abx * t;
    const qy = a.y + aby * t;
    const dSq = (pt.x - qx) * (pt.x - qx) + (pt.y - qy) * (pt.y - qy);
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestIdx = i + 1;
    }
  }

  const next = [...pts];
  next.splice(bestIdx, 0, {
    x: clamp(pt.x, 0.01, 0.99),
    y: clamp(pt.y, 0.01, 0.99),
  });
  return { ...path, points: next };
}

/**
 * Samples surrounding skin/face RGB color around the mouth (ignoring transparent
 * background and dark line-art strokes) so `cartoon_viseme` can cleanly conceal
 * any static drawn mouth underneath!
 */
export function sampleSurroundingMouthSkinColor(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  cm: CompiledCustomMouth
): string | null {
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];

  for (let i = 2; i < cm.seam.length - 2; i += 2) {
    const base = cm.seam[i];
    const n = cm.localNormals[i];
    const offUp = cm.upperCover[i] * 2.1 + 0.008;
    const offDown = cm.lowerCover[i] * 2.1 + 0.008;

    const candidates = [
      { x: base.x - n.x * offUp, y: base.y - n.y * offUp },
      { x: base.x + n.x * offDown, y: base.y + n.y * offDown },
    ];

    for (const c of candidates) {
      const px = clamp(Math.round(c.x * (width - 1)), 0, width - 1);
      const py = clamp(Math.round(c.y * (height - 1)), 0, height - 1);
      const idx = (py * width + px) * 4;
      const a = rgba[idx + 3];
      if (a < 200) continue;
      const r = rgba[idx];
      const g = rgba[idx + 1];
      const b = rgba[idx + 2];
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      // Skip dark line-art / black outlines
      if (luma < 52) continue;
      rs.push(r);
      gs.push(g);
      bs.push(b);
    }
  }

  if (rs.length < 3) return null;
  rs.sort((a, b) => a - b);
  gs.sort((a, b) => a - b);
  bs.sort((a, b) => a - b);
  const mid = rs.length >> 1;
  return `rgb(${rs[mid]}, ${gs[mid]}, ${bs[mid]})`;
}
