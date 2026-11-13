import { EvaluatedPose, PuppetRig, Vec2 } from './types';

export type PartMotion = 'none' | 'swing' | 'bounce' | 'pulse' | 'flutter';
export interface ImagePart {
  id: string;
  name: string;
  points: Vec2[];
  jointId: string;
  motion: PartMotion;
  intensity: number;
}
export interface PreparedPart {
  part: ImagePart;
  canvas: HTMLCanvasElement;
}

/** Even-odd polygon test in normalized image coordinates. */
export function pointInPolygon(x: number, y: number, points: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Assign each pixel to at most one part (the first drawn part wins). */
export function splitPartPixels(rgba: Uint8ClampedArray, width: number, height: number, parts: ImagePart[]) {
  const base = new Uint8ClampedArray(rgba);
  const layers = parts.map(() => new Uint8ClampedArray(rgba.length));
  const bounds = parts.map(p => ({
    minX: Math.max(0, Math.floor(Math.min(...p.points.map(v => v.x)) * width)),
    maxX: Math.min(width - 1, Math.ceil(Math.max(...p.points.map(v => v.x)) * width)),
    minY: Math.max(0, Math.floor(Math.min(...p.points.map(v => v.y)) * height)),
    maxY: Math.min(height - 1, Math.ceil(Math.max(...p.points.map(v => v.y)) * height)),
  }));
  parts.forEach((part, index) => {
    if (part.points.length < 3) return;
    const b = bounds[index];
    for (let y = b.minY; y <= b.maxY; y++) for (let x = b.minX; x <= b.maxX; x++) {
      const i = (y * width + x) * 4;
      if (base[i + 3] && pointInPolygon((x + .5) / width, (y + .5) / height, part.points)) {
        layers[index].set(rgba.subarray(i, i + 4), i);
        base[i + 3] = 0;
      }
    }
  });
  return { base, layers };
}

export function prepareParts(rgba: Uint8ClampedArray, width: number, height: number, parts: ImagePart[]) {
  if (!parts.length) return { base: rgba, layers: [] as PreparedPart[] };
  const split = splitPartPixels(rgba, width, height, parts);
  return {
    base: split.base,
    layers: parts.map((part, i) => {
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable');
      ctx.putImageData(new ImageData(split.layers[i], width, height), 0, 0);
      return { part, canvas };
    }),
  };
}

export function partMotionAt(motion: PartMotion, u: number, intensity: number) {
  const s = Math.sin(2 * Math.PI * u), c = 1 - Math.cos(2 * Math.PI * u);
  const amount = Math.max(0, Math.min(2, intensity));
  switch (motion) {
    case 'swing': return { rotation: s * .35 * amount, x: 0, y: 0, scale: 1 };
    case 'bounce': return { rotation: 0, x: 0, y: -.025 * c * amount, scale: 1 };
    case 'pulse': return { rotation: 0, x: 0, y: 0, scale: 1 + .07 * c * amount };
    case 'flutter': return { rotation: Math.sin(4 * Math.PI * u) * .22 * amount, x: .012 * s * amount, y: 0, scale: 1 };
    default: return { rotation: 0, x: 0, y: 0, scale: 1 };
  }
}

/** Draw rigid pieces over the mesh; binding follows the same evaluated pose as the body. */
export function drawImageParts(ctx: CanvasRenderingContext2D, rect: {x:number;y:number;w:number;h:number}, layers: PreparedPart[], rig: PuppetRig, pose: EvaluatedPose, u: number) {
  for (const { part, canvas } of layers) {
    const joint = rig.joints.find(j => j.id === part.jointId);
    const center = part.points.reduce((sum, p) => ({ x: sum.x + p.x / part.points.length, y: sum.y + p.y / part.points.length }), {x: 0, y: 0});
    const pivot = joint?.rest || center;
    const animated = joint ? pose.worldJoints[joint.id] || pivot : pivot;
    const rotation = joint ? pose.worldRotations[joint.id] || 0 : 0;
    const scale = joint ? pose.worldScales[joint.id] || {x: 1, y: 1} : {x: 1, y: 1};
    const motion = partMotionAt(part.motion, u, part.intensity);
    ctx.save();
    ctx.translate(rect.x + (animated.x + motion.x) * rect.w, rect.y + (animated.y + motion.y) * rect.h);
    // Match the mesh skinning transform, which rotates in normalized image space.
    ctx.scale(rect.w, rect.h);
    ctx.rotate(rotation + motion.rotation);
    ctx.scale(scale.x * motion.scale, scale.y * motion.scale);
    ctx.drawImage(canvas, -pivot.x, -pivot.y, 1, 1);
    ctx.restore();
  }
}
