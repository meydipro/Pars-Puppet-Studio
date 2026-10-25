export type RigMode = 'fullBody' | 'portrait' | 'customPins';

export type MouthStyle =
  | 'mesh_jaw'
  | 'cutout_jaw'
  | 'cartoon_viseme'
  | 'none';

export type PresetAnimationId =
  | 'talk_natural'
  | 'talk_excited'
  | 'laugh'
  | 'wave_hello'
  | 'happy_jump'
  | 'dance_groove'
  | 'walk_cycle'
  | 'run_cycle'
  | 'idle_breathe'
  | 'surprised'
  | 'nod_yes'
  | 'shake_no'
  | 'custom_only';

export type PresetCategory = 'all' | 'talking' | 'action' | 'reaction';

export interface PresetDefinition {
  id: PresetAnimationId;
  nameFa: string;
  subtitleFa: string;
  category: Exclude<PresetCategory, 'all'>;
  defaultDuration: number; // seconds
  involvesTalking: boolean;
  badgeColor: string;
}

/**
 * Coordinates in normalized character image space:
 * x in [0..1] (left to right of character image)
 * y in [0..1] (top to bottom of character image)
 */
export interface Vec2 {
  x: number;
  y: number;
}

export interface PuppetJoint {
  id: string;
  nameFa: string;
  parentId: string | null;
  /** Rest position in normalized image coordinates [0..1] */
  rest: Vec2;
  /** Whether this joint acts as a fixed anchor in custom pin mode */
  pinned?: boolean;
  /** Relative influence radius / weight boost */
  stiffness?: number;
  color: string;
}

export interface CustomMouthPath {
  /** User-drawn control points in normalized character rest coordinates [0..1] */
  points: Vec2[];
  /**
   * 'polygon': closed perimeter around an uneven mouth (>= 3 pts)
   * 'seam': open uneven lip-parting line from corner to corner (>= 2 pts)
   */
  kind: 'polygon' | 'seam';
  /** Smooth control points with Catmull-Rom spline vs sharp corners */
  smooth: boolean;
}

export interface MouthGizmo {
  /** Center in normalized image coordinates [0..1] */
  center: Vec2;
  /** Horizontal half-width in normalized image coordinates */
  rx: number;
  /** Vertical half-height in normalized image coordinates */
  ry: number;
  /** Natural smile/frown curvature for default mouth [-0.8..+0.8], positive = smile */
  arch?: number;
  /** Interior mouth darkness color */
  interiorColor: string;
  /** Show cute tongue inside cutout/cartoon mouth */
  showTongue: boolean;
  /** Show upper teeth bar inside cutout/cartoon mouth */
  showTeeth: boolean;
  /** Optional custom Pen-drawn mouth contour for uneven/tilted/curved mouths */
  customPath?: CustomMouthPath | null;
}

export interface PuppetRig {
  mode: RigMode;
  joints: PuppetJoint[];
  mouth: MouthGizmo;
}

export interface JointPoseDelta {
  /** Offset in normalized character space (dx, dy) */
  dx: number;
  dy: number;
  /** Additional local rotation in radians */
  rot: number;
  /** Local scale multiplier (1 = neutral) */
  sx?: number;
  sy?: number;
}

export type VisemeShape = 'rest' | 'A' | 'E' | 'O' | 'U' | 'M' | 'smile';

export interface EvaluatedPose {
  /** World animated positions of each joint in normalized image coords [0..1] */
  worldJoints: Record<string, Vec2>;
  /** World rotation of each joint in radians */
  worldRotations: Record<string, number>;
  /** World scale of each joint */
  worldScales: Record<string, Vec2>;
  /** Mouth openness [0..1.5] */
  mouthOpen: number;
  /** Mouth width stretch [-0.4..0.5] (positive = wide smile/E, negative = round O/U) */
  mouthWide: number;
  /** Current discrete/blended viseme hint */
  viseme: VisemeShape;
  /** Subtle brow/eye bounce [-1..1] */
  browLift: number;
  /** Overall character vertical jump offset (for ground shadow scaling) */
  groundLift: number;
}

export interface KeyframePoint {
  id: string;
  /** Normalized time in [0..1] of clip duration */
  t: number;
  /** Joint overrides (delta from rest or procedural base) */
  jointOffsets: Record<string, Vec2>;
  /** Optional mouth open override [0..1.2] */
  mouthOpen?: number;
}

export interface RecordedSample {
  t: number; // [0..1]
  jointOffsets: Record<string, Vec2>;
  mouthOpen?: number;
}

export interface AnimationSettings {
  presetId: PresetAnimationId;
  duration: number; // seconds, e.g., 2.4
  fps: number; // 12, 15, 20, 24, 30
  speed: number; // 0.25 .. 2.5
  bodyIntensity: number; // 0 .. 2.0
  mouthIntensity: number; // 0 .. 2.0
  springiness: number; // 0 .. 2.0 (squash & stretch)
  talkOverlay: boolean; // Layer talking onto non-talking presets
  mouthStyle: MouthStyle;
  dialogueText: string;
  showSpeechBubble: boolean;
  speechBubblePos: 'top-right' | 'top-left';
  pingPong: boolean; // Boomerang playback/export
}

export type BackgroundStyle =
  | 'transparent'
  | 'solid'
  | 'gradient_indigo'
  | 'gradient_sunset'
  | 'gradient_mint'
  | 'green_screen';

export interface StageSettings {
  backgroundStyle: BackgroundStyle;
  solidColor: string;
  groundShadow: boolean;
  stickerOutline: boolean;
  stickerColor: string;
  stickerWidth: number; // px in source image space (e.g., 6)
  characterScale: number; // 0.5 .. 1.4
}

export interface PuppetMesh {
  /** Number of vertices */
  vertexCount: number;
  /** Rest positions [x0, y0, x1, y1, ...] in normalized [0..1] coords */
  restPositions: Float32Array;
  /** Deformed positions [x0, y0, x1, y1, ...] updated per frame */
  deformedPositions: Float32Array;
  /** Texture UVs [u0, v0, u1, v1, ...] in [0..1] */
  uvs: Float32Array;
  /** Triangle vertex indices (length = triangleCount * 3) */
  indices: Uint16Array;
  /** Top 4 bone indices per vertex (length = vertexCount * 4) */
  boneIndices: Uint8Array;
  /** Top 4 bone weights per vertex, normalized sum=1 (length = vertexCount * 4) */
  boneWeights: Float32Array;
  /** Head joint index in rig.joints (for local-space mouth warp) */
  headBoneIndex: number;
}

export type ViewportToolMode = 'animate' | 'setup_rig' | 'pen_mouth';

/**
 * Normalized crop rectangle in [0..1] of the oriented source image.
 */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ImageTransformSpec {
  rotation: 0 | 90 | 180 | 270;
  flipH: boolean;
  flipV: boolean;
  crop: CropRect;
}

export interface GifExportOptions {
  width: number;
  height: number;
  fps: number;
  transparent: boolean;
  dither: boolean;
  pingPong: boolean;
  repeat: number; // 0 = forever, -1 = once
}
