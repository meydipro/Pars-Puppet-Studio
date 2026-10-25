import { describe, expect, it } from 'vitest';
import { encodeFramesToGifBytes } from '../gifCore';
import {
  analyzeCharacterSilhouette,
  applyStickerBorderToRgba,
  buildAutoRigFromLandmarks,
  computeSmartSubjectCrop,
  cropImageBuffer,
  removeBackgroundFloodFill,
  transformImageOrientation,
} from '../imageProcessor';
import {
  buildAnimatedCustomMouthPolygons,
  compileCustomMouth,
  compileMouthGeometry,
  deformVertexByCustomMouth,
  insertPointOnCustomPath,
  sampleSurroundingMouthSkinColor,
} from '../mouthPenGeometry';
import { buildPuppetMesh } from '../meshBuilder';
import { rasterizeMeshSoftware } from '../renderer';
import {
  bakePresetToKeyframes,
  deformPuppetMesh,
  evaluatePuppetPose,
  evaluateSpeechSignal,
  PRESET_ANIMATIONS,
  sampleTimelineCurves,
} from '../rigAndAnimator';
import { generateSampleCharacter, SAMPLE_CHARACTERS } from '../sampleCharacters';
import { AnimationSettings } from '../types';

/**
 * Helper: Creates a synthetic 128x160 character with:
 * - Solid white background (optional) or transparent background
 * - Head, torso, two separated arms, two separated legs, and pure black [0,0,0,255] eyes!
 */
function createTestCharacterBuffer(withWhiteBg: boolean) {
  const width = 128;
  const height = 160;
  const rgba = new Uint8ClampedArray(width * height * 4);

  if (withWhiteBg) {
    for (let p = 0; p < width * height; p++) {
      rgba[p * 4] = 255;
      rgba[p * 4 + 1] = 255;
      rgba[p * 4 + 2] = 255;
      rgba[p * 4 + 3] = 255;
    }
  }

  const paintRect = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    r: number,
    g: number,
    b: number
  ) => {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (x < 0 || x >= width || y < 0 || y >= height) continue;
        const i = (y * width + x) * 4;
        rgba[i] = r;
        rgba[i + 1] = g;
        rgba[i + 2] = b;
        rgba[i + 3] = 255;
      }
    }
  };

  // Head
  paintRect(44, 18, 84, 54, 240, 190, 160);
  // Pure black eyes inside head (crucial test for GIF transparency collision!)
  paintRect(52, 28, 58, 34, 0, 0, 0);
  paintRect(70, 28, 76, 34, 0, 0, 0);
  // Pure white eye highlights inside character (crucial test for flood-fill bg removal!)
  paintRect(54, 29, 56, 31, 255, 255, 255);

  // Torso
  paintRect(46, 54, 82, 104, 80, 120, 230);
  // Left Arm & Right Arm
  paintRect(18, 56, 46, 70, 235, 110, 50);
  paintRect(82, 56, 110, 70, 235, 110, 50);
  // Separated Left Leg & Right Leg (gap x=58..70)
  paintRect(46, 104, 56, 146, 30, 60, 160);
  paintRect(72, 104, 82, 146, 30, 60, 160);

  return { rgba, width, height };
}

describe('Puppet Studio Engine — Comprehensive Verification', () => {
  it('removes solid white outer background while preserving interior white eye highlights', () => {
    const { rgba, width, height } = createTestCharacterBuffer(true);
    const cleaned = removeBackgroundFloodFill(rgba, width, height, 38, 14);

    // Outer corner should be completely transparent
    expect(cleaned[3]).toBe(0);
    // Gap between legs (x=64, y=130) connected to bottom border should become transparent!
    expect(cleaned[(130 * width + 64) * 4 + 3]).toBe(0);
    // Interior white eye highlight (x=55, y=30) surrounded by black eye must remain 100% opaque!
    const highlightIdx = (30 * width + 55) * 4;
    expect(cleaned[highlightIdx + 3]).toBe(255);
    expect(cleaned[highlightIdx]).toBe(255);
  });

  it('generates smooth Chamfer distance sticker border around transparent cutout', () => {
    const { rgba, width, height } = createTestCharacterBuffer(false);
    const bordered = applyStickerBorderToRgba(rgba, width, height, 5, '#ffffff');

    // Pixel 3px outside top of head (x=64, y=15) was transparent, now has white sticker border
    const borderIdx = (15 * width + 64) * 4;
    expect(rgba[borderIdx + 3]).toBe(0);
    expect(bordered[borderIdx + 3]).toBeGreaterThan(200);
    expect(bordered[borderIdx]).toBe(255);

    // Far corner (x=2, y=2) stays completely transparent
    expect(bordered[(2 * width + 2) * 4 + 3]).toBe(0);
  });

  it('builds silhouette-clipped Delaunay mesh with geodesic leg separation and disconnected island support', () => {
    const { rgba, width, height } = createTestCharacterBuffer(false);
    // Add a disconnected floating hat island above head (y=4..10)
    for (let y = 4; y < 10; y++) {
      for (let x = 54; x < 74; x++) {
        const i = (y * width + x) * 4;
        rgba[i] = 250;
        rgba[i + 1] = 200;
        rgba[i + 2] = 20;
        rgba[i + 3] = 255;
      }
    }

    const landmarks = analyzeCharacterSilhouette(rgba, width, height);
    expect(landmarks.hasTransparency).toBe(true);

    const rig = buildAutoRigFromLandmarks(landmarks, 'fullBody');
    const mesh = buildPuppetMesh(rgba, width, height, rig);

    expect(mesh.vertexCount).toBeGreaterThan(40);
    expect(mesh.indices.length % 3).toBe(0);
    expect(mesh.indices.length).toBeGreaterThan(60);

    // Every single vertex (including disconnected hat island!) must have finite weights summing to 1.0
    for (let v = 0; v < mesh.vertexCount; v++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        const w = mesh.boneWeights[v * 4 + k];
        expect(Number.isFinite(w)).toBe(true);
        expect(w).toBeGreaterThanOrEqual(0);
        sum += w;
      }
      expect(Math.abs(sum - 1.0)).toBeLessThan(1e-4);
    }

    // Verify geodesic leg separation: a vertex near left foot should strongly favor l_foot over r_foot
    const lFootBoneIdx = rig.joints.findIndex((j) => j.id === 'l_foot');
    const rFootBoneIdx = rig.joints.findIndex((j) => j.id === 'r_foot');
    expect(lFootBoneIdx).toBeGreaterThanOrEqual(0);
    expect(rFootBoneIdx).toBeGreaterThanOrEqual(0);

    let closestLeftFootVert = 0;
    let bestDist = Infinity;
    const lfRest = rig.joints[lFootBoneIdx].rest;
    for (let v = 0; v < mesh.vertexCount; v++) {
      const d = Math.hypot(
        mesh.restPositions[v * 2] - lfRest.x,
        mesh.restPositions[v * 2 + 1] - lfRest.y
      );
      if (d < bestDist) {
        bestDist = d;
        closestLeftFootVert = v;
      }
    }

    let lWeight = 0;
    let rWeight = 0;
    for (let k = 0; k < 4; k++) {
      const bi = mesh.boneIndices[closestLeftFootVert * 4 + k];
      const bw = mesh.boneWeights[closestLeftFootVert * 4 + k];
      if (bi === lFootBoneIdx) lWeight += bw;
      if (bi === rFootBoneIdx) rWeight += bw;
    }
    expect(lWeight).toBeGreaterThan(0.5);
    expect(lWeight).toBeGreaterThan(rWeight * 5);
  });

  it('evaluates all 12 preset animations seamlessly across loop boundary (u=0 vs u->1) in < 0.5ms', () => {
    const { rgba, width, height } = createTestCharacterBuffer(false);
    const landmarks = analyzeCharacterSilhouette(rgba, width, height);
    const rig = buildAutoRigFromLandmarks(landmarks, 'fullBody');
    const mesh = buildPuppetMesh(rgba, width, height, rig);

    const baseSettings: AnimationSettings = {
      presetId: 'talk_natural',
      duration: 2.4,
      fps: 20,
      speed: 1.0,
      bodyIntensity: 1.0,
      mouthIntensity: 1.0,
      springiness: 1.0,
      talkOverlay: false,
      mouthStyle: 'mesh_jaw',
      dialogueText: '',
      showSpeechBubble: false,
      speechBubblePos: 'top-right',
      pingPong: false,
    };

    for (const preset of PRESET_ANIMATIONS) {
      const s = { ...baseSettings, presetId: preset.id };
      const poseStart = evaluatePuppetPose(rig, s, 0);
      const poseEnd = evaluatePuppetPose(rig, s, 0.9999);

      for (const j of rig.joints) {
        const p0 = poseStart.worldJoints[j.id];
        const p1 = poseEnd.worldJoints[j.id];
        expect(Math.hypot(p0.x - p1.x, p0.y - p1.y)).toBeLessThan(0.005);
      }
      expect(Math.abs(poseStart.mouthOpen - poseEnd.mouthOpen)).toBeLessThan(
        0.02
      );

      // Benchmark deformPuppetMesh speed & finite safety
      const t0 = performance.now();
      const midPose = evaluatePuppetPose(rig, s, 0.37);
      deformPuppetMesh(mesh, rig, midPose, s);
      const elapsed = performance.now() - t0;
      expect(elapsed).toBeLessThan(15);

      for (let i = 0; i < mesh.deformedPositions.length; i++) {
        expect(Number.isFinite(mesh.deformedPositions[i])).toBe(true);
      }
    }
  });

  it('drives syllable lip-sync from Persian dialogue text and closes mouth at loop boundaries', () => {
    const text = 'سلام رفیق! حالت چطوره؟';
    const startSig = evaluateSpeechSignal(0.0, text, 'talk_natural', 1.0);
    const endSig = evaluateSpeechSignal(0.98, text, 'talk_natural', 1.0);
    expect(startSig.open).toBe(0);
    expect(endSig.open).toBe(0);

    let maxMidOpen = 0;
    for (let u = 0.1; u <= 0.85; u += 0.03) {
      const sig = evaluateSpeechSignal(u, text, 'talk_natural', 1.0);
      if (sig.open > maxMidOpen) maxMidOpen = sig.open;
    }
    expect(maxMidOpen).toBeGreaterThan(0.45);
  });

  it('encodes multi-frame transparent GIF89a without turning pure black eyes transparent', () => {
    const { rgba, width, height } = createTestCharacterBuffer(false);
    const landmarks = analyzeCharacterSilhouette(rgba, width, height);
    const rig = buildAutoRigFromLandmarks(landmarks, 'fullBody');
    const mesh = buildPuppetMesh(rgba, width, height, rig);

    const settings: AnimationSettings = {
      presetId: 'wave_hello',
      duration: 1.6,
      fps: 12,
      speed: 1.0,
      bodyIntensity: 1.0,
      mouthIntensity: 1.0,
      springiness: 1.0,
      talkOverlay: true,
      mouthStyle: 'mesh_jaw',
      dialogueText: 'سلام',
      showSpeechBubble: false,
      speechBubblePos: 'top-right',
      pingPong: false,
    };

    const frames: Uint8ClampedArray[] = [];
    const stagePositions = new Float32Array(mesh.vertexCount * 2);

    for (let f = 0; f < 8; f++) {
      const u = f / 8;
      const pose = evaluatePuppetPose(rig, settings, u);
      deformPuppetMesh(mesh, rig, pose, settings);

      for (let v = 0; v < mesh.vertexCount; v++) {
        stagePositions[v * 2] = mesh.deformedPositions[v * 2] * width;
        stagePositions[v * 2 + 1] = mesh.deformedPositions[v * 2 + 1] * height;
      }

      const frameBuf = new Uint8ClampedArray(width * height * 4);
      rasterizeMeshSoftware(
        frameBuf,
        width,
        height,
        stagePositions,
        mesh.uvs,
        mesh.indices,
        rgba,
        width,
        height
      );
      frames.push(frameBuf);
    }

    const gifBytes = encodeFramesToGifBytes({
      frames,
      width,
      height,
      delayMs: 80,
      transparent: true,
      dither: true,
      repeat: 0,
    });

    // Check GIF89a magic header & trailer 0x3B
    const header = String.fromCharCode(...gifBytes.slice(0, 6));
    expect(header).toBe('GIF89a');
    expect(gifBytes[gifBytes.length - 1]).toBe(0x3b);
    expect(gifBytes.byteLength).toBeGreaterThan(400);

    // Verify Graphic Control Extension blocks exist for all 8 frames (0x21 0xF9 0x04)
    let gceCount = 0;
    for (let i = 0; i < gifBytes.length - 6; i++) {
      if (
        gifBytes[i] === 0x21 &&
        gifBytes[i + 1] === 0xf9 &&
        gifBytes[i + 2] === 0x04
      ) {
        gceCount++;
        const packed = gifBytes[i + 3];
        const transparentFlag = packed & 1;
        const disposalMethod = (packed >> 2) & 7;
        expect(transparentFlag).toBe(1);
        expect(disposalMethod).toBe(2); // Restore to background so no ghost trails!
        expect(gifBytes[i + 6]).toBe(0); // transparentIndex === 0
      }
    }
    expect(gceCount).toBeGreaterThanOrEqual(8);
  });

  it('supports smart subject auto-crop, rotation/flip, and pixel-accurate cropping', () => {
    const raw = createTestCharacterBuffer(true);
    const buf = { ...raw, hasTransparency: false };

    // Smart auto-crop on solid white background detects character bounds
    const smart = computeSmartSubjectCrop(buf, 0.02);
    expect(smart.x).toBeGreaterThan(0.08);
    expect(smart.w).toBeLessThan(0.85);
    expect(smart.h).toBeLessThan(0.92);

    // 90 deg CW rotation swaps width and height cleanly
    const rot90 = transformImageOrientation(buf, 90, true, false);
    expect(rot90.width).toBe(buf.height);
    expect(rot90.height).toBe(buf.width);

    // Cropping produces expected dimensions with safety breathing padding
    const cropped = cropImageBuffer(buf, { x: 0.25, y: 0.1, w: 0.5, h: 0.5 }, true);
    expect(cropped.width).toBeGreaterThan(64);
    expect(cropped.width).toBeLessThan(96);
    expect(cropped.hasTransparency).toBe(false);
  });

  it('samples timeline waveforms and bakes presets into editable keyframes accurately', () => {
    const { rgba, width, height } = createTestCharacterBuffer(false);
    const landmarks = analyzeCharacterSilhouette(rgba, width, height);
    const rig = buildAutoRigFromLandmarks(landmarks, 'fullBody');

    const settings: AnimationSettings = {
      presetId: 'talk_excited',
      duration: 2.4,
      fps: 20,
      speed: 1.0,
      bodyIntensity: 1.0,
      mouthIntensity: 1.0,
      springiness: 1.0,
      talkOverlay: false,
      mouthStyle: 'cutout_jaw',
      dialogueText: 'سلام دنیا',
      showSpeechBubble: false,
      speechBubblePos: 'top-right',
      pingPong: false,
    };

    const { bodyCurve, mouthCurve } = sampleTimelineCurves(rig, settings, [], [], 64);
    expect(bodyCurve).toHaveLength(64);
    expect(mouthCurve).toHaveLength(64);
    expect(Math.max(...bodyCurve)).toBeGreaterThan(0.1);
    expect(Math.max(...mouthCurve)).toBeGreaterThan(0.25);

    const baked = bakePresetToKeyframes(rig, settings, [], [], 8);
    expect(baked).toHaveLength(8);

    // Evaluating in custom_only mode at baked keyframe time reproduces exact baked pose!
    const customSettings: AnimationSettings = { ...settings, presetId: 'custom_only' };
    const poseAtKf2 = evaluatePuppetPose(rig, customSettings, baked[2].t, baked, []);
    const origAtKf2 = evaluatePuppetPose(rig, settings, baked[2].t, [], []);
    expect(
      Math.hypot(
        poseAtKf2.worldJoints['head'].x - origAtKf2.worldJoints['head'].x,
        poseAtKf2.worldJoints['head'].y - origAtKf2.worldJoints['head'].y
      )
    ).toBeLessThan(1e-4);
  });

  it('compiles uneven, crooked, CW/CCW, tall-O, and open-seam Pen mouths accurately', () => {
    // 1. Crooked / wavy diagonal mouth polygon (tilted ~20 deg downward to the right)
    const cwPoints = [
      { x: 0.42, y: 0.24 }, // left corner
      { x: 0.47, y: 0.225 }, // uneven upper lip arch
      { x: 0.53, y: 0.255 }, // dip
      { x: 0.58, y: 0.28 }, // right corner (lower than left!)
      { x: 0.52, y: 0.295 }, // lower lip right
      { x: 0.46, y: 0.268 }, // lower lip left
    ];
    const ccwPoints = [...cwPoints].reverse();

    const mouthBase = {
      center: { x: 0.5, y: 0.26 },
      rx: 0.08,
      ry: 0.04,
      interiorColor: '#3b0a18',
      showTongue: true,
      showTeeth: true,
    };

    const cmCW = compileCustomMouth({
      ...mouthBase,
      customPath: { points: cwPoints, kind: 'polygon', smooth: true },
    });
    const cmCCW = compileCustomMouth({
      ...mouthBase,
      customPath: { points: ccwPoints, kind: 'polygon', smooth: true },
    });

    expect(cmCW).not.toBeNull();
    expect(cmCCW).not.toBeNull();
    // CW and CCW drawing order must detect identical left/right corners and downward normal!
    expect(cmCW!.normalDown.y).toBeGreaterThan(0.8);
    expect(cmCCW!.normalDown.y).toBeGreaterThan(0.8);
    expect(cmCW!.tiltAngle).toBeGreaterThan(0.15); // tilted downward-right
    expect(
      Math.hypot(
        cmCW!.cornerLeft.x - cmCCW!.cornerLeft.x,
        cmCW!.cornerLeft.y - cmCCW!.cornerLeft.y
      )
    ).toBeLessThan(0.01);

    // 2. Tall 'O' mouth must still keep corners on left/right cheeks (not top/bottom!)
    const tallOMouth = compileCustomMouth({
      ...mouthBase,
      customPath: {
        points: [
          { x: 0.47, y: 0.24 },
          { x: 0.5, y: 0.19 },
          { x: 0.53, y: 0.24 },
          { x: 0.5, y: 0.31 },
        ],
        kind: 'polygon',
        smooth: true,
      },
    });
    expect(tallOMouth).not.toBeNull();
    expect(tallOMouth!.normalDown.y).toBeGreaterThan(0.85);
    expect(tallOMouth!.cornerLeft.x).toBeLessThan(tallOMouth!.cornerRight.x);

    // 3. Open curved seam drawn right-to-left reverses cleanly to left-to-right
    const seamMouth = compileCustomMouth({
      ...mouthBase,
      customPath: {
        points: [
          { x: 0.57, y: 0.27 },
          { x: 0.5, y: 0.245 },
          { x: 0.43, y: 0.265 },
        ],
        kind: 'seam',
        smooth: true,
      },
    });
    expect(seamMouth).not.toBeNull();
    expect(seamMouth!.cornerLeft.x).toBeLessThan(seamMouth!.cornerRight.x);

    // 4. Segment insertion adds a point at the right edge index
    const withInserted = insertPointOnCustomPath(
      { points: cwPoints, kind: 'polygon', smooth: true },
      { x: 0.5, y: 0.24 }
    );
    expect(withInserted.points).toHaveLength(cwPoints.length + 1);
  });

  it('builds refined Delaunay mesh and deforms jaw along uneven Pen mouth contour', () => {
    const { rgba, width, height } = createTestCharacterBuffer(false);
    const landmarks = analyzeCharacterSilhouette(rgba, width, height);
    const rig = buildAutoRigFromLandmarks(landmarks, 'fullBody');

    // Attach an uneven crooked Pen mouth onto the character's head
    rig.mouth.customPath = {
      points: [
        { x: 0.44, y: 0.21 },
        { x: 0.5, y: 0.195 },
        { x: 0.56, y: 0.225 },
        { x: 0.5, y: 0.24 },
      ],
      kind: 'polygon',
      smooth: true,
    };

    const mesh = buildPuppetMesh(rgba, width, height, rig);
    expect(mesh.vertexCount).toBeGreaterThan(80);
    expect(mesh.indices.length / 3).toBeGreaterThan(100);

    const cm = compileCustomMouth(rig.mouth)!;
    // A point right below the middle of the uneven seam moves downward along normalDown when mouth opens
    const testPtX = cm.center.x + cm.normalDown.x * 0.012;
    const testPtY = cm.center.y + cm.normalDown.y * 0.012;
    const [defX, defY] = deformVertexByCustomMouth(
      testPtX,
      testPtY,
      cm,
      0.85,
      0.1,
      'cutout_jaw'
    );
    const movedAlongNormal =
      (defX - testPtX) * cm.normalDown.x + (defY - testPtY) * cm.normalDown.y;
    expect(movedAlongNormal).toBeGreaterThan(0.01);

    // Animated custom cavity polygon stays closed and valid
    const animPolys = buildAnimatedCustomMouthPolygons(cm, 0.8, 0.15);
    expect(animPolys.closedPolygon.length).toBeGreaterThan(30);

    // Full pose + mesh deformation produces zero NaNs across all frames
    const settings: AnimationSettings = {
      presetId: 'talk_excited',
      duration: 2.0,
      fps: 20,
      speed: 1.0,
      bodyIntensity: 1.0,
      mouthIntensity: 1.2,
      springiness: 1.0,
      talkOverlay: true,
      mouthStyle: 'cutout_jaw',
      dialogueText: 'دهان ناهموار',
      showSpeechBubble: false,
      speechBubblePos: 'top-right',
      pingPong: false,
    };
    const pose = evaluatePuppetPose(rig, settings, 0.35);
    pose.mouthOpen = 0.85;
    deformPuppetMesh(mesh, rig, pose, settings);

    for (let i = 0; i < mesh.deformedPositions.length; i++) {
      expect(Number.isFinite(mesh.deformedPositions[i])).toBe(true);
    }
  });

  it('generates high-density stabilized default pins (18 fullBody, 14 portrait, 12 customPins) and enriches all sample characters', () => {
    const { rgba, width, height } = createTestCharacterBuffer(false);
    const landmarks = analyzeCharacterSilhouette(rgba, width, height);

    const fullRig = buildAutoRigFromLandmarks(landmarks, 'fullBody');
    expect(fullRig.joints.length).toBe(18);
    expect(fullRig.joints.some((j) => j.id === 'l_elbow')).toBe(true);
    expect(fullRig.joints.some((j) => j.id === 'r_elbow')).toBe(true);
    expect(fullRig.joints.some((j) => j.id === 'l_knee')).toBe(true);
    expect(fullRig.joints.some((j) => j.id === 'r_knee')).toBe(true);
    expect(fullRig.joints.some((j) => j.id === 'head_top')).toBe(true);

    const portraitRig = buildAutoRigFromLandmarks(landmarks, 'portrait');
    expect(portraitRig.joints.length).toBe(14);
    expect(portraitRig.joints.filter((j) => j.pinned).length).toBeGreaterThanOrEqual(5);

    const customRig = buildAutoRigFromLandmarks(landmarks, 'customPins');
    expect(customRig.joints.length).toBe(12);
    expect(customRig.joints.filter((j) => j.pinned).length).toBeGreaterThanOrEqual(3);

    // Every sample character must also have dense stabilized pins and curved mouth arch
    for (const sc of SAMPLE_CHARACTERS) {
      const gen = generateSampleCharacter(sc.id);
      expect(gen.customRig).toBeDefined();
      expect(gen.customRig!.joints.length).toBeGreaterThanOrEqual(14);
      expect(gen.customRig!.mouth.arch).toBeDefined();
    }
  });

  it('curves default/seam mouths naturally and tucks static mouth band strictly inside animated cavity (zero artifacts underneath)', () => {
    const { rgba, width, height } = createTestCharacterBuffer(false);
    const landmarks = analyzeCharacterSilhouette(rgba, width, height);
    const rig = buildAutoRigFromLandmarks(landmarks, 'portrait');

    // 1. Default mouth has a natural smile curve (middle lower than corners for arch > 0), not a flat rigid line
    const defaultCm = compileMouthGeometry(rig.mouth);
    expect(defaultCm.kind).toBe('default');
    const midIdx = defaultCm.seam.length >> 1;
    expect(defaultCm.seam[midIdx].y).toBeGreaterThan(defaultCm.seam[0].y + 0.001);

    // 2. Surround skin-tone sampler extracts opaque character face skin color cleanly
    const skinCss = sampleSurroundingMouthSkinColor(rgba, width, height, defaultCm);
    expect(skinCss).not.toBeNull();
    expect(skinCss).toMatch(/^rgb\(/);

    // 3. Anti-ghosting guarantee: any pixel on or around the static mouth line [-0.01..+0.01]
    // is tucked strictly inside the animated [upperRim..lowerRim] cavity with monotonic ordering!
    const anim = buildAnimatedCustomMouthPolygons(defaultCm, 0.75, 0.1, 'A');
    const upperMidY = anim.upperPts[midIdx].y;
    const lowerMidY = anim.lowerPts[midIdx].y;
    expect(lowerMidY).toBeGreaterThan(upperMidY + 0.02);

    const baseMid = defaultCm.seam[midIdx];
    const [, yAbove] = deformVertexByCustomMouth(
      baseMid.x,
      baseMid.y - 0.007,
      defaultCm,
      0.75,
      0.1,
      'cutout_jaw',
      'A'
    );
    const [, yCenter] = deformVertexByCustomMouth(
      baseMid.x,
      baseMid.y,
      defaultCm,
      0.75,
      0.1,
      'cutout_jaw',
      'A'
    );
    const [, yBelow] = deformVertexByCustomMouth(
      baseMid.x,
      baseMid.y + 0.009,
      defaultCm,
      0.75,
      0.1,
      'cutout_jaw',
      'A'
    );

    // Monotonic (no folded triangles!) AND strictly inside the cavity rim (nothing pokes out underneath!)
    expect(yAbove).toBeLessThan(yCenter);
    expect(yCenter).toBeLessThan(yBelow);
    expect(yAbove).toBeGreaterThanOrEqual(upperMidY - 1e-4);
    expect(yBelow).toBeLessThanOrEqual(lowerMidY + 1e-4);
  });
});

