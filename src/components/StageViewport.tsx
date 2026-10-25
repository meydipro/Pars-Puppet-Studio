import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  Crosshair,
  Eye,
  EyeOff,
  Focus,
  Grid,
  PenTool,
  Play,
  RotateCcw,
  Sparkles,
  Trash2,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  compileCustomMouth,
  compileMouthGeometry,
  insertPointOnCustomPath,
} from '../engine/mouthPenGeometry';
import {
  CharacterRect,
  computeCharacterRect,
  PuppetMeshRenderer,
  renderSceneFrame,
} from '../engine/renderer';
import { deformPuppetMesh, evaluatePuppetPose } from '../engine/rigAndAnimator';
import {
  AnimationSettings,
  CustomMouthPath,
  EvaluatedPose,
  KeyframePoint,
  PuppetMesh,
  PuppetRig,
  RecordedSample,
  StageSettings,
  Vec2,
  ViewportToolMode,
} from '../engine/types';

interface StageViewportProps {
  imgW: number;
  imgH: number;
  meshRenderer: PuppetMeshRenderer;
  mesh: PuppetMesh;
  rig: PuppetRig;
  animSettings: AnimationSettings;
  stageSettings: StageSettings;
  toolMode: ViewportToolMode;
  onChangeToolMode: (mode: ViewportToolMode) => void;

  normTime: number;
  keyframes: KeyframePoint[];
  recordedSamples: RecordedSample[];
  liveJointOffsets: Record<string, Vec2>;
  onUpdateLiveLiveMouthPreview?: (open: number | null) => void;
  onUpdateLiveJointOffset: (jointId: string, offset: Vec2) => void;
  onFinishLiveJointDrag?: () => void;
  liveMouthOverride: number | null;

  selectedJointId: string | null;
  onSelectJoint: (jointId: string | null) => void;
  onPreviewRigDraft: (draftRig: PuppetRig) => void;
  onCommitRigDraft: (finalRig: PuppetRig) => void;
  onAddCustomPinAt: (normPos: Vec2) => void;
  onDropImageFile: (file: File) => void;
  mouthSkinColor?: string | null;
}

function applyCustomMouthToRig(
  baseRig: PuppetRig,
  customPath: CustomMouthPath | null
): PuppetRig {
  const nextMouth = {
    ...baseRig.mouth,
    customPath,
  };
  if (customPath) {
    const compiled = compileCustomMouth(nextMouth);
    if (compiled) {
      nextMouth.center = { ...compiled.center };
      nextMouth.rx = Math.max(0.025, Math.min(0.28, compiled.spanWidth * 0.5));
    }
  }
  return {
    ...baseRig,
    mouth: nextMouth,
  };
}

export const StageViewport: React.FC<StageViewportProps> = ({
  imgW,
  imgH,
  meshRenderer,
  mesh,
  rig,
  animSettings,
  stageSettings,
  toolMode,
  onChangeToolMode,
  normTime,
  keyframes,
  recordedSamples,
  liveJointOffsets,
  onUpdateLiveJointOffset,
  onFinishLiveJointDrag,
  liveMouthOverride,
  selectedJointId,
  onSelectJoint,
  onPreviewRigDraft,
  onCommitRigDraft,
  onAddCustomPinAt,
  onDropImageFile,
  mouthSkinColor = null,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number }>({
    w: 680,
    h: 580,
  });
  const [showWireframe, setShowWireframe] = useState(false);
  const [hideGizmos, setHideGizmos] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [isDragOverFile, setIsDragOverFile] = useState(false);

  // Viewport Zoom & Pan Camera (for precise Pen drawing on small/uneven mouths!)
  const [camera, setCamera] = useState<{
    zoom: number;
    panX: number;
    panY: number;
  }>({ zoom: 1, panX: 0, panY: 0 });

  // Pen Mouth Tool Local State (defaults to 'seam' = curved mouth line so it sits right on the lips!)
  const [penDraftPoints, setPenDraftPoints] = useState<Vec2[]>([]);
  const [penTargetKind, setPenTargetKind] = useState<'seam' | 'polygon'>(
    rig.mouth.customPath?.kind ?? 'seam'
  );
  const [penCursorNorm, setPenCursorNorm] = useState<Vec2 | null>(null);
  const [hoveredPenVertIdx, setHoveredPenVertIdx] = useState<number | null>(
    null
  );
  const [penSmoothPref, setPenSmoothPref] = useState<boolean>(
    rig.mouth.customPath?.smooth ?? true
  );
  const [penTestMouthOpen, setPenTestMouthOpen] = useState<boolean>(false);

  // Sync smooth & kind preference when character/rig changes externally
  useEffect(() => {
    if (rig.mouth.customPath) {
      setPenSmoothPref(rig.mouth.customPath.smooth);
      setPenTargetKind(rig.mouth.customPath.kind);
    }
  }, [rig.mouth.customPath]);

  // Clear unfinished draft points when switching out of pen_mouth mode
  useEffect(() => {
    if (toolMode !== 'pen_mouth') {
      setPenDraftPoints([]);
      setPenCursorNorm(null);
      setHoveredPenVertIdx(null);
      setPenTestMouthOpen(false);
    }
  }, [toolMode]);

  // Ref state for active pointer drag (Animate, Setup Rig, Pen Vertex/Whole-Path, or Camera Pan)
  const dragStateRef = useRef<{
    kind:
      | 'gizmo'
      | 'pen_vertex'
      | 'pen_translate_all'
      | 'pen_freehand'
      | 'camera_pan';
    targetId: string;
    penVertIdx?: number;
    startClientX: number;
    startClientY: number;
    startCamPanX: number;
    startCamPanY: number;
    startNormMouse: Vec2;
    initialJointPos: Vec2;
    initialLiveOffset: Vec2;
    initialRig: PuppetRig;
    latestDraftRig: PuppetRig | null;
  } | null>(null);

  const latestPoseRef = useRef<EvaluatedPose | null>(null);
  const latestCharRectRef = useRef<CharacterRect>({
    x: 0,
    y: 0,
    w: 500,
    h: 500,
  });

  // Track responsive container dimensions
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      const w = Math.max(320, Math.min(960, Math.round(rect.width)));
      const h = Math.max(300, Math.min(860, Math.round(rect.height)));
      setCanvasSize((prev) =>
        Math.abs(prev.w - w) > 2 || Math.abs(prev.h - h) > 2 ? { w, h } : prev
      );
    };

    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Commit helper for finishing a Pen draft path
  const commitPenDraft = useCallback(
    (kind: 'polygon' | 'seam', ptsOverride?: Vec2[]) => {
      const pts = ptsOverride ?? penDraftPoints;
      const minCount = kind === 'polygon' ? 3 : 2;
      if (pts.length < minCount) return;

      const customPath: CustomMouthPath = {
        points: pts.map((p) => ({
          x: Math.max(0.01, Math.min(0.99, p.x)),
          y: Math.max(0.01, Math.min(0.99, p.y)),
        })),
        kind,
        smooth: penSmoothPref,
      };
      const updatedRig = applyCustomMouthToRig(rig, customPath);
      setPenDraftPoints([]);
      onCommitRigDraft(updatedRig);
    },
    [penDraftPoints, penSmoothPref, rig, onCommitRigDraft]
  );

  // Keyboard shortcuts specific to Pen Mouth mode (Enter, Backspace, Escape)
  useEffect(() => {
    if (toolMode !== 'pen_mouth') return;
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'Enter' && penDraftPoints.length >= 2) {
        e.preventDefault();
        const chosenKind =
          penTargetKind === 'polygon' && penDraftPoints.length >= 3
            ? 'polygon'
            : 'seam';
        commitPenDraft(chosenKind);
      } else if (e.key === 'Backspace' && penDraftPoints.length > 0) {
        e.preventDefault();
        setPenDraftPoints((prev) => prev.slice(0, -1));
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (penDraftPoints.length > 0) {
          setPenDraftPoints([]);
        } else {
          onChangeToolMode('animate');
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toolMode, penDraftPoints, penTargetKind, commitPenDraft, onChangeToolMode]);

  // Zoom directly onto the character's mouth for surgical Pen accuracy!
  const focusZoomOnMouth = useCallback(() => {
    const hasBubble =
      animSettings.showSpeechBubble &&
      animSettings.dialogueText.trim().length > 0;
    const baseRect = computeCharacterRect(
      canvasSize.w,
      canvasSize.h,
      imgW,
      imgH,
      stageSettings.characterScale,
      hasBubble
    );
    const compiled = compileCustomMouth(rig.mouth);
    const mCenter = compiled ? compiled.center : rig.mouth.center;
    const targetZoom = 2.65;
    const mouthStageX = baseRect.x + mCenter.x * baseRect.w;
    const mouthStageY = baseRect.y + mCenter.y * baseRect.h;

    setCamera({
      zoom: targetZoom,
      panX: -(mouthStageX - canvasSize.w * 0.5) * targetZoom,
      panY: -(mouthStageY - canvasSize.h * 0.5) * targetZoom,
    });
  }, [
    animSettings.showSpeechBubble,
    animSettings.dialogueText,
    canvasSize.w,
    canvasSize.h,
    imgW,
    imgH,
    stageSettings.characterScale,
    rig.mouth,
  ]);

  const resetCamera = useCallback(() => {
    setCamera({ zoom: 1, panX: 0, panY: 0 });
  }, []);

  const adjustZoom = useCallback((deltaFactor: number) => {
    setCamera((prev) => {
      const nextZoom = Math.max(1, Math.min(4, prev.zoom * deltaFactor));
      if (nextZoom <= 1.01) return { zoom: 1, panX: 0, panY: 0 };
      const ratio = nextZoom / prev.zoom;
      return {
        zoom: nextZoom,
        panX: prev.panX * ratio,
        panY: prev.panY * ratio,
      };
    });
  }, []);

  // Local rAF clock so "تست باز شدن دهان" animates smoothly even when global timeline is paused!
  const [localPreviewTick, setLocalPreviewTick] = useState(0);
  useEffect(() => {
    if (toolMode !== 'pen_mouth' || !penTestMouthOpen) return;
    let raf = 0;
    const loop = () => {
      setLocalPreviewTick((t) => (t + 1) % 100000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [toolMode, penTestMouthOpen]);

  // Render frame whenever animation time, pose, mesh, Pen points, or camera update
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const isStaticSetupPose =
      toolMode === 'setup_rig' || toolMode === 'pen_mouth';

    const nowMs = performance.now();
    const testOpenAmount =
      toolMode === 'pen_mouth' && penTestMouthOpen
        ? 0.04 + 0.86 * (0.5 - 0.5 * Math.cos(nowMs * 0.0055))
        : 0;
    const testWideWave =
      toolMode === 'pen_mouth' && penTestMouthOpen
        ? Math.sin(nowMs * 0.0028) * 0.2
        : 0;

    const pose: EvaluatedPose = isStaticSetupPose
      ? {
          worldJoints: Object.fromEntries(
            rig.joints.map((j) => [j.id, j.rest])
          ),
          worldRotations: Object.fromEntries(rig.joints.map((j) => [j.id, 0])),
          worldScales: Object.fromEntries(
            rig.joints.map((j) => [j.id, { x: 1, y: 1 }])
          ),
          mouthOpen: testOpenAmount,
          mouthWide: testWideWave,
          viseme:
            testOpenAmount > 0.55
              ? testWideWave < -0.06
                ? 'O'
                : 'A'
              : testOpenAmount > 0.2
              ? 'E'
              : 'smile',
          browLift: 0,
          groundLift: 0,
        }
      : evaluatePuppetPose(
          rig,
          animSettings,
          normTime,
          keyframes,
          recordedSamples,
          liveJointOffsets,
          liveMouthOverride
        );

    latestPoseRef.current = pose;

    if (isStaticSetupPose && testOpenAmount <= 0.001) {
      mesh.deformedPositions.set(mesh.restPositions);
    } else {
      deformPuppetMesh(mesh, rig, pose, animSettings);
    }

    const rect = renderSceneFrame({
      ctx,
      stageW: canvasSize.w,
      stageH: canvasSize.h,
      imgW,
      imgH,
      meshRenderer,
      mesh,
      rig,
      pose,
      animSettings,
      stageSettings,
      exportMode: hideGizmos && toolMode === 'animate' && !showWireframe,
      toolMode,
      showWireframe,
      hoveredJointId: hoveredId,
      selectedJointId,
      penDraftPoints,
      penCursorNorm,
      hoveredPenVertIdx,
      penTargetKind,
      mouthSkinColor,
      viewportCamera: camera,
    });

    latestCharRectRef.current = rect;
  }, [
    canvasSize,
    imgW,
    imgH,
    meshRenderer,
    mesh,
    rig,
    animSettings,
    stageSettings,
    toolMode,
    normTime,
    keyframes,
    recordedSamples,
    liveJointOffsets,
    liveMouthOverride,
    showWireframe,
    hideGizmos,
    hoveredId,
    selectedJointId,
    penDraftPoints,
    penCursorNorm,
    hoveredPenVertIdx,
    penTargetKind,
    mouthSkinColor,
    penTestMouthOpen,
    localPreviewTick,
    camera,
  ]);

  const clientToStage = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas)
      return {
        sx: 0,
        sy: 0,
        nx: 0.5,
        ny: 0.5,
        cr: latestCharRectRef.current,
      };
    const r = canvas.getBoundingClientRect();
    const sx = ((clientX - r.left) / Math.max(1, r.width)) * canvas.width;
    const sy = ((clientY - r.top) / Math.max(1, r.height)) * canvas.height;
    const cr = latestCharRectRef.current;
    const nx = (sx - cr.x) / Math.max(1, cr.w);
    const ny = (sy - cr.y) / Math.max(1, cr.h);
    return { sx, sy, nx, ny, cr };
  }, []);

  const hitTestPenVertices = useCallback(
    (
      sx: number,
      sy: number
    ): {
      vertIdx: number | null;
      edgeHitPt: Vec2 | null;
      insideMouth: boolean;
    } => {
      const custom = rig.mouth.customPath;
      const cr = latestCharRectRef.current;
      if (!custom || custom.points.length === 0) {
        return { vertIdx: null, edgeHitPt: null, insideMouth: false };
      }

      // 1. Check control vertices
      let bestIdx: number | null = null;
      let bestDist = 13;
      for (let i = 0; i < custom.points.length; i++) {
        const px = cr.x + custom.points[i].x * cr.w;
        const py = cr.y + custom.points[i].y * cr.h;
        const d = Math.hypot(sx - px, sy - py);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      if (bestIdx !== null) {
        return { vertIdx: bestIdx, edgeHitPt: null, insideMouth: false };
      }

      // 2. Check segment proximity for inserting a new Pen point
      const edgeCount =
        custom.kind === 'polygon'
          ? custom.points.length
          : custom.points.length - 1;
      for (let i = 0; i < edgeCount; i++) {
        const a = custom.points[i];
        const b = custom.points[(i + 1) % custom.points.length];
        const ax = cr.x + a.x * cr.w;
        const ay = cr.y + a.y * cr.h;
        const bx = cr.x + b.x * cr.w;
        const by = cr.y + b.y * cr.h;
        const abx = bx - ax;
        const aby = by - ay;
        const lenSq = abx * abx + aby * aby;
        const t =
          lenSq > 1e-6
            ? Math.max(
                0,
                Math.min(1, ((sx - ax) * abx + (sy - ay) * aby) / lenSq)
              )
            : 0;
        const qx = ax + abx * t;
        const qy = ay + aby * t;
        if (Math.hypot(sx - qx, sy - qy) <= 9) {
          return {
            vertIdx: null,
            edgeHitPt: {
              x: (qx - cr.x) / Math.max(1, cr.w),
              y: (qy - cr.y) / Math.max(1, cr.h),
            },
            insideMouth: false,
          };
        }
      }

      // 3. Point-in-polygon check for dragging the whole custom mouth
      let inside = false;
      const compiled = compileCustomMouth(rig.mouth);
      if (compiled && compiled.outline.length >= 3) {
        const nx = (sx - cr.x) / Math.max(1, cr.w);
        const ny = (sy - cr.y) / Math.max(1, cr.h);
        const poly = compiled.outline;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const xi = poly[i].x,
            yi = poly[i].y;
          const xj = poly[j].x,
            yj = poly[j].y;
          const intersect =
            yi > ny !== yj > ny &&
            nx < ((xj - xi) * (ny - yi)) / (yj - yi + 1e-9) + xi;
          if (intersect) inside = !inside;
        }
      }

      return { vertIdx: null, edgeHitPt: null, insideMouth: inside };
    },
    [rig.mouth]
  );

  const hitTestGizmos = useCallback(
    (sx: number, sy: number): string | null => {
      const cr = latestCharRectRef.current;
      const pose = latestPoseRef.current;
      const isSetup = toolMode === 'setup_rig';

      // 1. In setup mode, check mouth resize knob & mouth region first
      if (isSetup && animSettings.mouthStyle !== 'none') {
        const compiled = compileCustomMouth(rig.mouth);
        if (compiled) {
          const mcx = cr.x + compiled.center.x * cr.w;
          const mcy = cr.y + compiled.center.y * cr.h;
          const mrx = Math.max(16, compiled.spanWidth * 0.5 * cr.w);
          const mry = Math.max(14, compiled.jawDepth * cr.h);
          const dx = (sx - mcx) / mrx;
          const dy = (sy - mcy) / mry;
          if (dx * dx + dy * dy <= 1.2) {
            return '__mouth__';
          }
        } else {
          const cmDef = compileMouthGeometry(rig.mouth);
          const mcx = cr.x + rig.mouth.center.x * cr.w;
          const mcy = cr.y + rig.mouth.center.y * cr.h;
          const mrx = rig.mouth.rx * cr.w;
          const mry = rig.mouth.ry * cr.h;

          // Right corner width resize handle
          const rightEnd = cmDef.seam[cmDef.seam.length - 1];
          if (
            Math.hypot(sx - (cr.x + rightEnd.x * cr.w), sy - (cr.y + rightEnd.y * cr.h)) <=
            12
          ) {
            return '__mouth_resize__';
          }

          // Middle smile/arch bend handle
          const midPt = cmDef.seam[cmDef.seam.length >> 1];
          if (
            Math.hypot(sx - (cr.x + midPt.x * cr.w), sy - (cr.y + midPt.y * cr.h)) <=
            11
          ) {
            return '__mouth_arch__';
          }

          const dx = (sx - mcx) / Math.max(12, mrx);
          const dy = (sy - mcy) / Math.max(10, mry * 1.3);
          if (dx * dx + dy * dy <= 1.15) {
            return '__mouth__';
          }
        }
      }

      // 2. Check joints (topmost/leaves first)
      let bestId: string | null = null;
      let bestDist = 18;

      for (let i = rig.joints.length - 1; i >= 0; i--) {
        const j = rig.joints[i];
        const jNorm = isSetup ? j.rest : pose?.worldJoints[j.id] || j.rest;
        const jx = cr.x + jNorm.x * cr.w;
        const jy = cr.y + jNorm.y * cr.h;
        const d = Math.hypot(sx - jx, sy - jy);
        if (d < bestDist) {
          bestDist = d;
          bestId = j.id;
        }
      }

      return bestId;
    },
    [toolMode, animSettings.mouthStyle, rig]
  );

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (e.ctrlKey || e.metaKey || toolMode === 'pen_mouth') {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.16 : 1 / 1.16;
      adjustZoom(factor);
    }
  };

  const handleContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (toolMode !== 'pen_mouth') return;
    e.preventDefault();

    // Right-click while drafting removes last placed point
    if (penDraftPoints.length > 0) {
      setPenDraftPoints((prev) => prev.slice(0, -1));
      return;
    }

    // Right-click on an existing Pen vertex deletes it (if above min vertex count)
    const custom = rig.mouth.customPath;
    if (!custom) return;
    const { sx, sy } = clientToStage(e.clientX, e.clientY);
    const { vertIdx } = hitTestPenVertices(sx, sy);
    const minPts = custom.kind === 'polygon' ? 3 : 2;
    if (vertIdx !== null && custom.points.length > minPts) {
      const nextPts = custom.points.filter((_, idx) => idx !== vertIdx);
      onCommitRigDraft(
        applyCustomMouthToRig(rig, { ...custom, points: nextPts })
      );
      setHoveredPenVertIdx(null);
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Middle-click or Alt+Left-click -> Smooth Camera Pan in any mode!
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragStateRef.current = {
        kind: 'camera_pan',
        targetId: '__camera__',
        startClientX: e.clientX,
        startClientY: e.clientY,
        startCamPanX: camera.panX,
        startCamPanY: camera.panY,
        startNormMouse: { x: 0, y: 0 },
        initialJointPos: { x: 0, y: 0 },
        initialLiveOffset: { x: 0, y: 0 },
        initialRig: rig,
        latestDraftRig: null,
      };
      return;
    }

    if (e.button !== 0) return;
    const { sx, sy, nx, ny, cr } = clientToStage(e.clientX, e.clientY);

    // =========================================================================
    // PEN MOUTH MODE INTERACTION
    // =========================================================================
    if (toolMode === 'pen_mouth') {
      const clampedPt: Vec2 = {
        x: Math.max(0.01, Math.min(0.99, nx)),
        y: Math.max(0.01, Math.min(0.99, ny)),
      };

      // Case 1: Editing an existing CustomMouthPath (when not actively drafting a new one)
      if (penDraftPoints.length === 0 && rig.mouth.customPath) {
        const { vertIdx, edgeHitPt, insideMouth } = hitTestPenVertices(sx, sy);

        if (vertIdx !== null) {
          e.currentTarget.setPointerCapture(e.pointerId);
          dragStateRef.current = {
            kind: 'pen_vertex',
            targetId: '__pen_vert__',
            penVertIdx: vertIdx,
            startClientX: e.clientX,
            startClientY: e.clientY,
            startCamPanX: camera.panX,
            startCamPanY: camera.panY,
            startNormMouse: clampedPt,
            initialJointPos: { ...rig.mouth.customPath.points[vertIdx] },
            initialLiveOffset: { x: 0, y: 0 },
            initialRig: rig,
            latestDraftRig: null,
          };
          return;
        }

        if (edgeHitPt) {
          // Insert a new Pen point on this segment & begin dragging it right away!
          const updatedPath = insertPointOnCustomPath(
            rig.mouth.customPath,
            edgeHitPt
          );
          const insertedIdx = updatedPath.points.findIndex(
            (p) =>
              Math.hypot(p.x - edgeHitPt.x, p.y - edgeHitPt.y) < 1e-3
          );
          const nextRig = applyCustomMouthToRig(rig, updatedPath);
          onPreviewRigDraft(nextRig);

          if (insertedIdx >= 0) {
            e.currentTarget.setPointerCapture(e.pointerId);
            dragStateRef.current = {
              kind: 'pen_vertex',
              targetId: '__pen_vert__',
              penVertIdx: insertedIdx,
              startClientX: e.clientX,
              startClientY: e.clientY,
              startCamPanX: camera.panX,
              startCamPanY: camera.panY,
              startNormMouse: edgeHitPt,
              initialJointPos: { ...updatedPath.points[insertedIdx] },
              initialLiveOffset: { x: 0, y: 0 },
              initialRig: nextRig,
              latestDraftRig: nextRig,
            };
          } else {
            onCommitRigDraft(nextRig);
          }
          return;
        }

        if (insideMouth) {
          e.currentTarget.setPointerCapture(e.pointerId);
          dragStateRef.current = {
            kind: 'pen_translate_all',
            targetId: '__pen_all__',
            startClientX: e.clientX,
            startClientY: e.clientY,
            startCamPanX: camera.panX,
            startCamPanY: camera.panY,
            startNormMouse: clampedPt,
            initialJointPos: { ...rig.mouth.center },
            initialLiveOffset: { x: 0, y: 0 },
            initialRig: rig,
            latestDraftRig: null,
          };
          return;
        }

        // Clicking outside existing custom mouth leaves it intact unless user clicks "رسم مجدد"
        return;
      }

      // Case 2: Placing / Drawing new Pen Draft Points!
      if (nx < 0.005 || nx > 0.995 || ny < 0.005 || ny > 0.995) return;

      // Check if clicking near Start Point P0 to close polygon!
      if (penDraftPoints.length >= 3) {
        const p0x = cr.x + penDraftPoints[0].x * cr.w;
        const p0y = cr.y + penDraftPoints[0].y * cr.h;
        if (Math.hypot(sx - p0x, sy - p0y) <= 14) {
          commitPenDraft('polygon');
          return;
        }
      }

      // Double-click finishes the path immediately (respects penTargetKind: 'seam' curved mouth line by default!)
      if (e.detail >= 2 && penDraftPoints.length >= 2) {
        const chosenKind =
          penTargetKind === 'polygon' && penDraftPoints.length >= 3
            ? 'polygon'
            : 'seam';
        commitPenDraft(chosenKind);
        return;
      }

      // Shift + Drag = Smooth Freehand Pen Tracing!
      if (e.shiftKey) {
        e.currentTarget.setPointerCapture(e.pointerId);
        setPenDraftPoints((prev) => [...prev, clampedPt]);
        dragStateRef.current = {
          kind: 'pen_freehand',
          targetId: '__pen_freehand__',
          startClientX: e.clientX,
          startClientY: e.clientY,
          startCamPanX: camera.panX,
          startCamPanY: camera.panY,
          startNormMouse: clampedPt,
          initialJointPos: clampedPt,
          initialLiveOffset: { x: 0, y: 0 },
          initialRig: rig,
          latestDraftRig: null,
        };
        return;
      }

      // Standard Pen Point Click!
      setPenDraftPoints((prev) => [...prev, clampedPt]);
      return;
    }

    // =========================================================================
    // STANDARD ANIMATE & SETUP_RIG INTERACTION
    // =========================================================================
    const hit = hitTestGizmos(sx, sy);

    if (hit) {
      e.currentTarget.setPointerCapture(e.pointerId);
      if (
        hit !== '__mouth__' &&
        hit !== '__mouth_resize__' &&
        hit !== '__mouth_arch__'
      ) {
        onSelectJoint(hit);
      }

      const joint = rig.joints.find((j) => j.id === hit);
      dragStateRef.current = {
        kind: 'gizmo',
        targetId: hit,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startCamPanX: camera.panX,
        startCamPanY: camera.panY,
        startNormMouse: { x: nx, y: ny },
        initialJointPos: joint ? { ...joint.rest } : { ...rig.mouth.center },
        initialLiveOffset: liveJointOffsets[hit]
          ? { ...liveJointOffsets[hit] }
          : { x: 0, y: 0 },
        initialRig: rig,
        latestDraftRig: null,
      };
      return;
    }

    // Clicked empty area in customPins + setup_rig -> add new pin!
    if (
      toolMode === 'setup_rig' &&
      rig.mode === 'customPins' &&
      nx >= 0.03 &&
      nx <= 0.97 &&
      ny >= 0.03 &&
      ny <= 0.97
    ) {
      onAddCustomPinAt({ x: nx, y: ny });
      return;
    }

    onSelectJoint(null);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { sx, sy, nx, ny, cr } = clientToStage(e.clientX, e.clientY);
    const drag = dragStateRef.current;

    // Camera Panning
    if (drag?.kind === 'camera_pan') {
      const canvas = canvasRef.current;
      const r = canvas?.getBoundingClientRect();
      const scaleX = r ? canvas!.width / Math.max(1, r.width) : 1;
      const scaleY = r ? canvas!.height / Math.max(1, r.height) : 1;
      setCamera((prev) => ({
        ...prev,
        panX: drag.startCamPanX + (e.clientX - drag.startClientX) * scaleX,
        panY: drag.startCamPanY + (e.clientY - drag.startClientY) * scaleY,
      }));
      return;
    }

    if (toolMode === 'pen_mouth') {
      setPenCursorNorm({ x: nx, y: ny });

      if (drag?.kind === 'pen_freehand') {
        const clampedPt = {
          x: Math.max(0.01, Math.min(0.99, nx)),
          y: Math.max(0.01, Math.min(0.99, ny)),
        };
        setPenDraftPoints((prev) => {
          if (prev.length === 0) return [clampedPt];
          const last = prev[prev.length - 1];
          const pxDist = Math.hypot(
            (clampedPt.x - last.x) * cr.w,
            (clampedPt.y - last.y) * cr.h
          );
          return pxDist >= 13 ? [...prev, clampedPt] : prev;
        });
        return;
      }

      if (
        drag?.kind === 'pen_vertex' &&
        drag.penVertIdx !== undefined &&
        drag.initialRig.mouth.customPath
      ) {
        const dnx = nx - drag.startNormMouse.x;
        const dny = ny - drag.startNormMouse.y;
        const nextPts = drag.initialRig.mouth.customPath.points.map((p, idx) =>
          idx === drag.penVertIdx
            ? {
                x: Math.max(0.01, Math.min(0.99, drag.initialJointPos.x + dnx)),
                y: Math.max(0.01, Math.min(0.99, drag.initialJointPos.y + dny)),
              }
            : p
        );
        const nextRig = applyCustomMouthToRig(drag.initialRig, {
          ...drag.initialRig.mouth.customPath,
          points: nextPts,
        });
        drag.latestDraftRig = nextRig;
        onPreviewRigDraft(nextRig);
        return;
      }

      if (
        drag?.kind === 'pen_translate_all' &&
        drag.initialRig.mouth.customPath
      ) {
        const dnx = nx - drag.startNormMouse.x;
        const dny = ny - drag.startNormMouse.y;
        const nextPts = drag.initialRig.mouth.customPath.points.map((p) => ({
          x: Math.max(0.01, Math.min(0.99, p.x + dnx)),
          y: Math.max(0.01, Math.min(0.99, p.y + dny)),
        }));
        const nextRig = applyCustomMouthToRig(drag.initialRig, {
          ...drag.initialRig.mouth.customPath,
          points: nextPts,
        });
        drag.latestDraftRig = nextRig;
        onPreviewRigDraft(nextRig);
        return;
      }

      // Hover state for Pen vertices
      if (penDraftPoints.length === 0 && rig.mouth.customPath) {
        const { vertIdx } = hitTestPenVertices(sx, sy);
        if (vertIdx !== hoveredPenVertIdx) setHoveredPenVertIdx(vertIdx);
      } else if (hoveredPenVertIdx !== null) {
        setHoveredPenVertIdx(null);
      }
      return;
    }

    if (!drag) {
      const hit = hitTestGizmos(sx, sy);
      if (hit !== hoveredId) setHoveredId(hit);
      return;
    }

    const dnx = nx - drag.startNormMouse.x;
    const dny = ny - drag.startNormMouse.y;

    if (toolMode === 'setup_rig') {
      const clamp01 = (v: number) => Math.max(0.03, Math.min(0.97, v));

      if (drag.targetId === '__mouth__') {
        const baseCustom = drag.initialRig.mouth.customPath;
        const nextRig: PuppetRig = baseCustom
          ? applyCustomMouthToRig(drag.initialRig, {
              ...baseCustom,
              points: baseCustom.points.map((p) => ({
                x: clamp01(p.x + dnx),
                y: clamp01(p.y + dny),
              })),
            })
          : {
              ...drag.initialRig,
              mouth: {
                ...drag.initialRig.mouth,
                center: {
                  x: clamp01(drag.initialJointPos.x + dnx),
                  y: clamp01(drag.initialJointPos.y + dny),
                },
              },
            };
        drag.latestDraftRig = nextRig;
        onPreviewRigDraft(nextRig);
      } else if (drag.targetId === '__mouth_resize__') {
        const mCenter = drag.initialRig.mouth.center;
        const newRx = Math.max(0.025, Math.min(0.26, Math.abs(nx - mCenter.x)));
        const newRy = Math.max(
          0.018,
          Math.min(0.18, drag.initialRig.mouth.ry + dny * 0.7)
        );
        const nextRig: PuppetRig = {
          ...drag.initialRig,
          mouth: {
            ...drag.initialRig.mouth,
            rx: newRx,
            ry: newRy,
          },
        };
        drag.latestDraftRig = nextRig;
        onPreviewRigDraft(nextRig);
      } else if (drag.targetId === '__mouth_arch__') {
        const baseArch = drag.initialRig.mouth.arch ?? 0.16;
        const mrx = Math.max(0.025, drag.initialRig.mouth.rx);
        const nextArch = Math.max(
          -0.8,
          Math.min(0.8, baseArch + dny / (mrx * 0.65))
        );
        const nextRig: PuppetRig = {
          ...drag.initialRig,
          mouth: {
            ...drag.initialRig.mouth,
            arch: nextArch,
          },
        };
        drag.latestDraftRig = nextRig;
        onPreviewRigDraft(nextRig);
      } else {
        const nextJoints = drag.initialRig.joints.map((j) =>
          j.id === drag.targetId
            ? {
                ...j,
                rest: {
                  x: clamp01(drag.initialJointPos.x + dnx),
                  y: clamp01(drag.initialJointPos.y + dny),
                },
              }
            : j
        );
        const nextRig: PuppetRig = { ...drag.initialRig, joints: nextJoints };
        drag.latestDraftRig = nextRig;
        onPreviewRigDraft(nextRig);
      }
    } else {
      // Animate Mode: Live drag offset!
      if (
        drag.targetId !== '__mouth__' &&
        drag.targetId !== '__mouth_resize__' &&
        drag.targetId !== '__mouth_arch__'
      ) {
        onUpdateLiveJointOffset(drag.targetId, {
          x: Math.max(-0.45, Math.min(0.45, drag.initialLiveOffset.x + dnx)),
          y: Math.max(-0.45, Math.min(0.45, drag.initialLiveOffset.y + dny)),
        });
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragStateRef.current;
    if (!drag) return;

    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }

    if (
      (drag.kind === 'pen_vertex' ||
        drag.kind === 'pen_translate_all' ||
        (drag.kind === 'gizmo' && toolMode === 'setup_rig')) &&
      drag.latestDraftRig
    ) {
      onCommitRigDraft(drag.latestDraftRig);
    } else if (
      drag.kind === 'gizmo' &&
      toolMode === 'animate' &&
      onFinishLiveJointDrag
    ) {
      onFinishLiveJointDrag();
    }

    dragStateRef.current = null;
  };

  const handleToggleSmoothPen = () => {
    const nextSmooth = !penSmoothPref;
    setPenSmoothPref(nextSmooth);
    if (rig.mouth.customPath) {
      onCommitRigDraft(
        applyCustomMouthToRig(rig, {
          ...rig.mouth.customPath,
          smooth: nextSmooth,
        })
      );
    }
  };

  const handleTogglePenKind = () => {
    const nextKind: 'seam' | 'polygon' =
      penTargetKind === 'seam' ? 'polygon' : 'seam';
    setPenTargetKind(nextKind);
    if (rig.mouth.customPath && rig.mouth.customPath.points.length >= 3) {
      onCommitRigDraft(
        applyCustomMouthToRig(rig, {
          ...rig.mouth.customPath,
          kind: nextKind,
        })
      );
    }
  };

  const handleStartFreshPenDraw = () => {
    setPenDraftPoints([]);
    setPenTestMouthOpen(false);
    if (rig.mouth.customPath) {
      onCommitRigDraft(applyCustomMouthToRig(rig, null));
    }
  };

  const handleResetToOvalMouth = () => {
    setPenDraftPoints([]);
    setPenTestMouthOpen(false);
    onCommitRigDraft(applyCustomMouthToRig(rig, null));
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOverFile(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      onDropImageFile(file);
    }
  };

  const hasCustomMouth = Boolean(rig.mouth.customPath);

  return (
    <div
      ref={containerRef}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOverFile(true);
      }}
      onDragLeave={() => setIsDragOverFile(false)}
      onDrop={handleDrop}
      className="relative flex-1 min-h-[300px] bg-checkerboard flex items-center justify-center overflow-hidden select-none"
    >
      {/* Top Floating Viewport Mode Pill + Zoom/View Controls */}
      <div className="absolute top-2.5 inset-x-3 flex flex-col gap-2 pointer-events-none z-10">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="pointer-events-auto inline-flex items-center bg-studio-900/92 backdrop-blur-md border border-studio-700/90 rounded-xl p-1 shadow-xl">
            <button
              type="button"
              onClick={() => onChangeToolMode('animate')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
                toolMode === 'animate'
                  ? 'bg-indigo-500 text-white shadow'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Play className="w-3.5 h-3.5" />
              <span>انیمیشن و حرکت</span>
            </button>

            <button
              type="button"
              onClick={() => onChangeToolMode('setup_rig')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
                toolMode === 'setup_rig'
                  ? 'bg-sky-400 text-slate-950 shadow'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Crosshair className="w-3.5 h-3.5" />
              <span>تنظیم پین‌ها</span>
            </button>

            <button
              type="button"
              onClick={() => onChangeToolMode('pen_mouth')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
                toolMode === 'pen_mouth'
                  ? 'bg-fuchsia-500 text-white shadow'
                  : 'text-fuchsia-200 hover:text-white hover:bg-fuchsia-500/15'
              }`}
              title="ترسیم دستی محدوده دهان کج، منحنی یا ناهموار با ابزار Pen"
            >
              <PenTool className="w-3.5 h-3.5" />
              <span>ابزار Pen دهان</span>
              {hasCustomMouth && (
                <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-sm" />
              )}
            </button>
          </div>

          {/* Zoom + Wireframe + Clean View Toggles */}
          <div className="pointer-events-auto inline-flex items-center gap-1 bg-studio-900/92 backdrop-blur-md border border-studio-700/90 rounded-xl p-1 shadow-xl">
            <button
              type="button"
              onClick={focusZoomOnMouth}
              className="px-2 py-1.5 rounded-lg text-[11px] font-semibold flex items-center gap-1 text-fuchsia-200 hover:bg-fuchsia-500/20 transition"
              title="زوم دقیق روی دهان کاراکتر برای رسم راحت با Pen"
            >
              <Focus className="w-3.5 h-3.5" />
              <span className="hidden md:inline">زوم دهان</span>
            </button>

            <button
              type="button"
              onClick={() => adjustZoom(1 / 1.25)}
              disabled={camera.zoom <= 1.01}
              className="p-1.5 rounded-lg text-slate-300 hover:text-white disabled:opacity-35"
              title="کوچک‌نمایی"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={resetCamera}
              className={`px-1.5 py-1 rounded text-[10px] font-mono font-bold transition ${
                camera.zoom > 1.02
                  ? 'bg-amber-500/20 text-amber-200 border border-amber-400/40'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="بازنشانی بزرگ‌نمایی به ۱۰۰٪"
            >
              {Math.round(camera.zoom * 100)}%
            </button>

            <button
              type="button"
              onClick={() => adjustZoom(1.25)}
              disabled={camera.zoom >= 3.95}
              className="p-1.5 rounded-lg text-slate-300 hover:text-white disabled:opacity-35"
              title="بزرگ‌نمایی"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>

            <div className="w-px h-4 bg-studio-700 mx-0.5" />

            <button
              type="button"
              onClick={() => setShowWireframe((v) => !v)}
              className={`px-2 py-1.5 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition ${
                showWireframe
                  ? 'bg-indigo-500/25 text-indigo-200 border border-indigo-400/50'
                  : 'text-slate-300 hover:text-white'
              }`}
              title="نمایش شبکه مثلث‌بندی تغییرشکل (Delaunay Mesh)"
            >
              <Grid className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">مش</span>
            </button>

            <button
              type="button"
              onClick={() => setHideGizmos((v) => !v)}
              className={`px-2 py-1.5 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition ${
                hideGizmos
                  ? 'bg-emerald-500/25 text-emerald-200 border border-emerald-400/50'
                  : 'text-slate-300 hover:text-white'
              }`}
              title="مخفی کردن پین‌ها برای مشاهده خروجی تمیز"
            >
              {hideGizmos ? (
                <EyeOff className="w-3.5 h-3.5" />
              ) : (
                <Eye className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>

        {/* Dedicated Contextual Pen Mouth Toolbar */}
        {toolMode === 'pen_mouth' && (
          <div className="pointer-events-auto self-start flex flex-wrap items-center gap-1.5 bg-studio-950/92 backdrop-blur-md border border-fuchsia-500/45 rounded-xl px-2.5 py-1.5 shadow-2xl">
            <span className="text-[11px] font-extrabold text-fuchsia-300 flex items-center gap-1 pl-1.5 border-l border-studio-700">
              <PenTool className="w-3.5 h-3.5" />
              <span>Pen محدوده دهان:</span>
            </span>

            {penDraftPoints.length > 0 ? (
              <>
                <span className="text-[11px] text-sky-300 font-semibold px-1.5">
                  {penDraftPoints.length} نقطه
                </span>

                <button
                  type="button"
                  disabled={penDraftPoints.length < 2}
                  onClick={() => commitPenDraft('seam')}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white flex items-center gap-1 transition"
                  title="ثبت خط منحنی دقیقاً روی شکاف لب کاراکتر (دوبار کلیک یا Enter)"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>〰 ثبت خط لب منحنی</span>
                </button>

                <button
                  type="button"
                  disabled={penDraftPoints.length < 3}
                  onClick={() => commitPenDraft('polygon')}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white flex items-center gap-1 transition"
                  title="بستن حلقه کامل دور لب بالا و پایین (یا کلیک روی نقطه سبز شروع)"
                >
                  <span>⬠ بستن حلقه دور لب</span>
                </button>

                <button
                  type="button"
                  onClick={() => setPenDraftPoints((p) => p.slice(0, -1))}
                  className="px-2 py-1 rounded-lg text-[11px] bg-studio-800 hover:bg-studio-700 text-slate-200 flex items-center gap-1"
                  title="حذف آخرین نقطه (Backspace / کلیک راست)"
                >
                  <Undo2 className="w-3 h-3" />
                  <span>حذف نقطه آخر</span>
                </button>

                <button
                  type="button"
                  onClick={() => setPenDraftPoints([])}
                  className="px-2 py-1 rounded-lg text-[11px] bg-rose-500/20 hover:bg-rose-500/35 text-rose-200"
                >
                  انصراف
                </button>
              </>
            ) : hasCustomMouth ? (
              <>
                <button
                  type="button"
                  onClick={handleStartFreshPenDraw}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-fuchsia-600 hover:bg-fuchsia-500 text-white flex items-center gap-1 transition"
                >
                  <PenTool className="w-3 h-3" />
                  <span>رسم مجدد دهان</span>
                </button>

                {rig.mouth.customPath && rig.mouth.customPath.points.length >= 3 && (
                  <button
                    type="button"
                    onClick={handleTogglePenKind}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 border transition ${
                      rig.mouth.customPath.kind === 'seam'
                        ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-200'
                        : 'bg-violet-500/20 border-violet-400/50 text-violet-200'
                    }`}
                    title="تغییر نوع مسیر بین «خط لب منحنی باز» و «حلقه بسته دور لب»"
                  >
                    <span>
                      {rig.mouth.customPath.kind === 'seam'
                        ? '〰 نوع: خط لب منحنی'
                        : '⬠ نوع: حلقه دور لب'}
                    </span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleToggleSmoothPen}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 border transition ${
                    penSmoothPref
                      ? 'bg-sky-500/20 border-sky-400/50 text-sky-200'
                      : 'bg-amber-500/20 border-amber-400/50 text-amber-200'
                  }`}
                  title="تغییر بین لب‌های منحنی نرم (Spline) یا گوشه‌دار تیز/دندانه‌دار"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>{penSmoothPref ? 'منحنی نرم' : 'گوشه‌دار تیز'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setPenTestMouthOpen((v) => !v)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition ${
                    penTestMouthOpen
                      ? 'bg-emerald-500 text-slate-950 shadow'
                      : 'bg-studio-800 hover:bg-studio-700 text-emerald-300 border border-emerald-500/30'
                  }`}
                >
                  {penTestMouthOpen ? '⏸ توقف تست دهان' : '▶ تست باز شدن دهان'}
                </button>

                <button
                  type="button"
                  onClick={handleResetToOvalMouth}
                  className="px-2 py-1 rounded-lg text-[11px] bg-studio-800 hover:bg-rose-500/25 text-slate-300 hover:text-rose-200 flex items-center gap-1 transition"
                  title="حذف مسیر Pen و بازگشت به کمان دهان پیش‌فرض"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>کمان پیش‌فرض</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleTogglePenKind}
                  className={`px-2 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 border transition ${
                    penTargetKind === 'seam'
                      ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-200'
                      : 'bg-violet-500/20 border-violet-400/50 text-violet-200'
                  }`}
                  title="انتخاب بین رسم «خط لب منحنی (از چپ به راست)» یا «حلقه بسته دور لب»"
                >
                  <span>
                    {penTargetKind === 'seam'
                      ? '〰 رسم: خط لب منحنی'
                      : '⬠ رسم: حلقه دور لب'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handleToggleSmoothPen}
                  className={`px-2 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 border transition ${
                    penSmoothPref
                      ? 'bg-sky-500/20 border-sky-400/50 text-sky-200'
                      : 'bg-amber-500/20 border-amber-400/50 text-amber-200'
                  }`}
                >
                  <Sparkles className="w-3 h-3" />
                  <span>
                    {penSmoothPref ? 'حالت: منحنی نرم' : 'حالت: گوشه‌دار تیز'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={focusZoomOnMouth}
                  className="px-2 py-1 rounded-lg text-[11px] bg-fuchsia-500/20 hover:bg-fuchsia-500/30 text-fuchsia-200 flex items-center gap-1"
                >
                  <Focus className="w-3 h-3" />
                  <span>بزرگ‌نمایی روی دهان</span>
                </button>

                <span className="text-[11px] text-slate-300 pr-1">
                  از گوشه چپ تا راست روی خط دهان چند نقطه بگذارید و دوبار کلیک یا Enter بزنید
                </span>
              </>
            )}

            {camera.zoom > 1.02 && (
              <button
                type="button"
                onClick={resetCamera}
                className="px-2 py-1 rounded-lg text-[11px] bg-studio-800 hover:bg-studio-700 text-amber-200 flex items-center gap-1"
                title="نمای کلی کاراکتر (۱۰۰٪)"
              >
                <RotateCcw className="w-3 h-3" />
                <span>نمای کامل</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Bottom Subtle Helper Hint */}
      <div className="pointer-events-none absolute bottom-2.5 inset-x-4 flex justify-center z-10">
        <div className="px-3 py-1 rounded-full bg-studio-950/85 backdrop-blur border border-studio-700/70 text-[11px] text-slate-300 shadow">
          {toolMode === 'pen_mouth'
            ? hasCustomMouth && penDraftPoints.length === 0
              ? '✒️ نقاط مربعی را دقیق روی خط لب تنظیم کنید | کلیک روی خط = افزودن نقطه | کلیک‌راست = حذف نقطه | ▶ تست باز شدن دهان را بزنید'
              : '✒️ از گوشه چپ تا راست دقیقاً روی خط لب نقطه بگذارید و Enter یا دوبار کلیک بزنید (یا روی نقطه سبز اول ببندید | چرخ ماوس = زوم)'
            : toolMode === 'setup_rig'
            ? '💡 دایره آبی وسط دهان را بالا/پایین بکشید تا انحنای خط لب تنظیم شود، یا «ابزار Pen دهان» را بزنید!'
            : '💡 پین‌های مهاری اضافه باعث کنترل نرم انیمیشن شده‌اند | دست، سر یا تنه را با ماوس بکشید یا Space را نگه دارید'}
        </div>
      </div>

      {/* Main Interactive Stage Canvas */}
      <canvas
        ref={canvasRef}
        width={canvasSize.w}
        height={canvasSize.h}
        onWheel={handleWheel}
        onContextMenu={handleContextMenu}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={() => setPenCursorNorm(null)}
        className={`max-w-full max-h-full touch-none ${
          toolMode === 'pen_mouth'
            ? hoveredPenVertIdx !== null
              ? 'cursor-move'
              : 'cursor-crosshair'
            : hoveredId
            ? hoveredId === '__mouth_resize__'
              ? 'cursor-ew-resize'
              : hoveredId === '__mouth_arch__'
              ? 'cursor-ns-resize'
              : 'cursor-grab active:cursor-grabbing'
            : toolMode === 'setup_rig' && rig.mode === 'customPins'
            ? 'cursor-crosshair'
            : 'cursor-default'
        }`}
      />

      {/* Drag & Drop File Overlay */}
      {isDragOverFile && (
        <div className="absolute inset-3 rounded-2xl bg-indigo-950/85 backdrop-blur-md border-2 border-dashed border-indigo-400 flex flex-col items-center justify-center gap-3 z-30 pointer-events-none">
          <div className="w-14 h-14 rounded-2xl bg-indigo-500/30 flex items-center justify-center">
            <Upload className="w-7 h-7 text-indigo-200 animate-bounce" />
          </div>
          <p className="text-base font-extrabold text-white">
            فایل تصویر را اینجا رها کنید
          </p>
          <p className="text-xs text-indigo-200">
            کاراکتر به‌صورت خودکار مش‌بندی و آماده انیمیشن می‌شود
          </p>
        </div>
      )}
    </div>
  );
};
