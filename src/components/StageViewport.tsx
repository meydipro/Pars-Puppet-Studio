import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  Crosshair,
  Eye,
  EyeOff,
  Focus,
  Grid,
  Hand,
  Lock,
  Move,
  PenTool,
  Pin,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Undo2,
  Unlock,
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
  onUpdateStageSettings: (patch: Partial<StageSettings>) => void;
  toolMode: ViewportToolMode;
  onChangeToolMode: (mode: ViewportToolMode) => void;

  normTime: number;
  keyframes: KeyframePoint[];
  recordedSamples: RecordedSample[];
  liveJointOffsets: Record<string, Vec2>;
  onUpdateLiveLiveMouthPreview?: (open: number | null) => void;
  onUpdateLiveJointOffset: (jointId: string, offset: Vec2) => void;
  onClearLiveJointOffsets: () => void;
  onFinishLiveJointDrag?: () => void;
  liveMouthOverride: number | null;

  selectedJointId: string | null;
  onSelectJoint: (jointId: string | null) => void;
  onToggleJointPinned: (jointId: string) => void;
  onDeleteCustomJoint: (jointId: string) => void;
  onAutoResetRig: () => void;
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

function collectSubtreeJointIds(rig: PuppetRig, rootId: string): Set<string> {
  const set = new Set<string>([rootId]);
  let added = true;
  while (added) {
    added = false;
    for (const j of rig.joints) {
      if (j.parentId && set.has(j.parentId) && !set.has(j.id)) {
        set.add(j.id);
        added = true;
      }
    }
  }
  return set;
}

export const StageViewport: React.FC<StageViewportProps> = ({
  imgW,
  imgH,
  meshRenderer,
  mesh,
  rig,
  animSettings,
  stageSettings,
  onUpdateStageSettings,
  toolMode,
  onChangeToolMode,
  normTime,
  keyframes,
  recordedSamples,
  liveJointOffsets,
  onUpdateLiveJointOffset,
  onClearLiveJointOffsets,
  onFinishLiveJointDrag,
  liveMouthOverride,
  selectedJointId,
  onSelectJoint,
  onToggleJointPinned,
  onDeleteCustomJoint,
  onAutoResetRig,
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

  // Interactive Mouse Pan / Hand Mode + Pan Target ('auto' | 'frame' | 'camera')
  const [isPanMode, setIsPanMode] = useState(false);
  const [panTarget, setPanTarget] = useState<'auto' | 'frame' | 'camera'>('auto');
  const [isActivelyPanning, setIsActivelyPanning] = useState(false);

  // Pin Setup Sub-Options (Move pins without altering body!)
  const [clickToAddPin, setClickToAddPin] = useState(false);
  const [movePinSubtree, setMovePinSubtree] = useState(false);
  const [isRebindingPinInAnimate, setIsRebindingPinInAnimate] = useState(false);

  // Viewport Zoom & Pan Camera (0.5x .. 5.0x)
  const [camera, setCamera] = useState<{
    zoom: number;
    panX: number;
    panY: number;
  }>({ zoom: 1, panX: 0, panY: 0 });

  // Pen Mouth Tool Local State
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

  useEffect(() => {
    if (rig.mouth.customPath) {
      setPenSmoothPref(rig.mouth.customPath.smooth);
      setPenTargetKind(rig.mouth.customPath.kind);
    }
  }, [rig.mouth.customPath]);

  useEffect(() => {
    if (toolMode !== 'pen_mouth') {
      setPenDraftPoints([]);
      setPenCursorNorm(null);
      setHoveredPenVertIdx(null);
      setPenTestMouthOpen(false);
    }
  }, [toolMode]);

  // Ref state for active pointer drag
  const dragStateRef = useRef<{
    kind:
      | 'gizmo'
      | 'gizmo_rebind'
      | 'pen_vertex'
      | 'pen_translate_all'
      | 'pen_freehand'
      | 'stage_pan';
    targetId: string;
    penVertIdx?: number;
    moveSubtree?: boolean;
    panAffectsFrame?: boolean;
    hasMoved?: boolean;
    pendingEmptyClickPos?: Vec2 | null;
    startClientX: number;
    startClientY: number;
    startCamPanX: number;
    startCamPanY: number;
    startCharOffsetX: number;
    startCharOffsetY: number;
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

  // Global keyboard shortcuts (H = toggle Hand/Pan, Pen shortcuts)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if ((e.key === 'h' || e.key === 'H' || e.key === 'آ') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setIsPanMode((v) => !v);
        return;
      }

      if (toolMode !== 'pen_mouth') return;

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
        if (isPanMode) {
          setIsPanMode(false);
        } else if (penDraftPoints.length > 0) {
          setPenDraftPoints([]);
        } else {
          onChangeToolMode('animate');
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toolMode, penDraftPoints, penTargetKind, isPanMode, commitPenDraft, onChangeToolMode]);

  const computeCurrentBaseRect = useCallback(() => {
    const hasBubble =
      animSettings.showSpeechBubble &&
      animSettings.dialogueText.trim().length > 0;
    return computeCharacterRect(
      canvasSize.w,
      canvasSize.h,
      imgW,
      imgH,
      stageSettings.characterScale,
      hasBubble,
      stageSettings.characterOffsetX ?? 0,
      stageSettings.characterOffsetY ?? 0
    );
  }, [
    animSettings.showSpeechBubble,
    animSettings.dialogueText,
    canvasSize.w,
    canvasSize.h,
    imgW,
    imgH,
    stageSettings.characterScale,
    stageSettings.characterOffsetX,
    stageSettings.characterOffsetY,
  ]);

  // Focus & zoom straight onto the character's head (great if head jumped/went near top!)
  const focusZoomOnHead = useCallback(() => {
    const baseRect = computeCurrentBaseRect();
    const headJoint =
      rig.joints.find((j) => j.id === 'head') || rig.joints[0];
    const headCenter = headJoint ? headJoint.rest : { x: 0.5, y: 0.22 };
    const targetZoom = 1.9;
    const headStageX = baseRect.x + headCenter.x * baseRect.w;
    const headStageY = baseRect.y + headCenter.y * baseRect.h;

    setCamera({
      zoom: targetZoom,
      panX: -(headStageX - canvasSize.w * 0.5) * targetZoom,
      panY: -(headStageY - canvasSize.h * 0.5) * targetZoom,
    });
  }, [computeCurrentBaseRect, rig.joints, canvasSize.w, canvasSize.h]);

  // Zoom directly onto the character's mouth for surgical Pen accuracy!
  const focusZoomOnMouth = useCallback(() => {
    const baseRect = computeCurrentBaseRect();
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
  }, [computeCurrentBaseRect, rig.mouth, canvasSize.w, canvasSize.h]);

  const resetCameraAndFraming = useCallback(() => {
    setCamera({ zoom: 1, panX: 0, panY: 0 });
    if (
      (stageSettings.characterOffsetX ?? 0) !== 0 ||
      (stageSettings.characterOffsetY ?? 0) !== 0
    ) {
      onUpdateStageSettings({ characterOffsetX: 0, characterOffsetY: 0 });
    }
  }, [
    stageSettings.characterOffsetX,
    stageSettings.characterOffsetY,
    onUpdateStageSettings,
  ]);

  // Zoom around optional stage point (anchorX, anchorY) so cursor target stays fixed!
  const adjustZoom = useCallback(
    (deltaFactor: number, anchorStagePt?: { x: number; y: number }) => {
      setCamera((prev) => {
        const nextZoom = Math.max(0.5, Math.min(5.0, prev.zoom * deltaFactor));
        const ratio = nextZoom / prev.zoom;
        const cx = canvasSize.w * 0.5;
        const cy = canvasSize.h * 0.5;
        const ax = anchorStagePt ? anchorStagePt.x : cx;
        const ay = anchorStagePt ? anchorStagePt.y : cy;

        return {
          zoom: nextZoom,
          panX: (ax - cx) * (1 - ratio) + prev.panX * ratio,
          panY: (ay - cy) * (1 - ratio) + prev.panY * ratio,
        };
      });
    },
    [canvasSize.w, canvasSize.h]
  );

  // Non-passive mouse wheel zoom centered directly on the cursor!
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onNativeWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const sx = ((e.clientX - r.left) / Math.max(1, r.width)) * canvas.width;
      const sy = ((e.clientY - r.top) / Math.max(1, r.height)) * canvas.height;
      const factor = e.deltaY < 0 ? 1.14 : 1 / 1.14;
      adjustZoom(factor, { x: sx, y: sy });
    };
    canvas.addEventListener('wheel', onNativeWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onNativeWheel);
  }, [adjustZoom]);

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

  // Render frame whenever animation time, pose, mesh, Pen points, framing, or camera update
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const isStaticSetupPose =
      toolMode === 'setup_rig' ||
      toolMode === 'pen_mouth' ||
      isRebindingPinInAnimate;

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

    const effectiveToolForGizmos: ViewportToolMode = isRebindingPinInAnimate
      ? 'setup_rig'
      : toolMode;

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
      exportMode:
        hideGizmos &&
        toolMode === 'animate' &&
        !isRebindingPinInAnimate &&
        !showWireframe,
      toolMode: effectiveToolForGizmos,
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
    isRebindingPinInAnimate,
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

        const vx = bx - ax;
        const vy = by - ay;
        const lenSq = vx * vx + vy * vy;
        const t =
          lenSq > 1e-4
            ? Math.max(0.08, Math.min(0.92, ((sx - ax) * vx + (sy - ay) * vy) / lenSq))
            : 0.5;
        const projX = ax + vx * t;
        const projY = ay + vy * t;
        const d = Math.hypot(sx - projX, sy - projY);
        if (d <= 9.5) {
          return {
            vertIdx: null,
            edgeHitPt: {
              x: Math.max(0.01, Math.min(0.99, (projX - cr.x) / Math.max(1, cr.w))),
              y: Math.max(0.01, Math.min(0.99, (projY - cr.y) / Math.max(1, cr.h))),
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

      // 1. Check joints FIRST if closer than 15px, then mouth controls in setup mode
      let bestId: string | null = null;
      let bestDist = 17;

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

      if (isSetup && animSettings.mouthStyle !== 'none') {
        const compiled = compileCustomMouth(rig.mouth);
        if (compiled) {
          if (!bestId) {
            const mcx = cr.x + compiled.center.x * cr.w;
            const mcy = cr.y + compiled.center.y * cr.h;
            const mrx = Math.max(16, compiled.spanWidth * 0.5 * cr.w);
            const mry = Math.max(14, compiled.jawDepth * cr.h);
            const dx = (sx - mcx) / mrx;
            const dy = (sy - mcy) / mry;
            if (dx * dx + dy * dy <= 1.2) {
              return '__mouth__';
            }
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
            Math.hypot(
              sx - (cr.x + rightEnd.x * cr.w),
              sy - (cr.y + rightEnd.y * cr.h)
            ) <= 12
          ) {
            return '__mouth_resize__';
          }

          // Middle smile/arch bend handle
          const midPt = cmDef.seam[cmDef.seam.length >> 1];
          if (
            Math.hypot(
              sx - (cr.x + midPt.x * cr.w),
              sy - (cr.y + midPt.y * cr.h)
            ) <= 11
          ) {
            return '__mouth_arch__';
          }

          if (!bestId) {
            const dx = (sx - mcx) / Math.max(12, mrx);
            const dy = (sy - mcy) / Math.max(10, mry * 1.3);
            if (dx * dx + dy * dy <= 1.15) {
              return '__mouth__';
            }
          }
        }
      }

      return bestId;
    },
    [toolMode, animSettings.mouthStyle, rig]
  );

  // Start a mouse pan gesture (either frame offset or camera pan)
  const beginStagePanDrag = (
    e: React.PointerEvent<HTMLCanvasElement>,
    pendingEmptyClickPos: Vec2 | null = null
  ) => {
    const affectsFrame =
      panTarget === 'frame' ||
      (panTarget === 'auto' && Math.abs(camera.zoom - 1) <= 0.03);
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStateRef.current = {
      kind: 'stage_pan',
      targetId: '__stage_pan__',
      panAffectsFrame: affectsFrame,
      hasMoved: false,
      pendingEmptyClickPos,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startCamPanX: camera.panX,
      startCamPanY: camera.panY,
      startCharOffsetX: stageSettings.characterOffsetX ?? 0,
      startCharOffsetY: stageSettings.characterOffsetY ?? 0,
      startNormMouse: { x: 0, y: 0 },
      initialJointPos: { x: 0, y: 0 },
      initialLiveOffset: { x: 0, y: 0 },
      initialRig: rig,
      latestDraftRig: null,
    };
  };

  const handleContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (toolMode !== 'pen_mouth' || isPanMode) return;
    e.preventDefault();

    if (penDraftPoints.length > 0) {
      setPenDraftPoints((prev) => prev.slice(0, -1));
      return;
    }

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
    // 1. Dedicated Hand Mode, Middle-click, or Alt+Left-click -> Immediate Mouse Pan anywhere!
    if (
      e.button === 1 ||
      (e.button === 0 && (isPanMode || e.altKey))
    ) {
      e.preventDefault();
      setIsActivelyPanning(true);
      beginStagePanDrag(e, null);
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

      // Case 1: Editing an existing CustomMouthPath
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
            startCharOffsetX: stageSettings.characterOffsetX ?? 0,
            startCharOffsetY: stageSettings.characterOffsetY ?? 0,
            startNormMouse: clampedPt,
            initialJointPos: { ...rig.mouth.customPath.points[vertIdx] },
            initialLiveOffset: { x: 0, y: 0 },
            initialRig: rig,
            latestDraftRig: null,
          };
          return;
        }

        if (edgeHitPt) {
          const updatedPath = insertPointOnCustomPath(
            rig.mouth.customPath,
            edgeHitPt
          );
          const insertedIdx = updatedPath.points.findIndex(
            (p) => Math.hypot(p.x - edgeHitPt.x, p.y - edgeHitPt.y) < 1e-3
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
              startCharOffsetX: stageSettings.characterOffsetX ?? 0,
              startCharOffsetY: stageSettings.characterOffsetY ?? 0,
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
            startCharOffsetX: stageSettings.characterOffsetX ?? 0,
            startCharOffsetY: stageSettings.characterOffsetY ?? 0,
            startNormMouse: clampedPt,
            initialJointPos: { ...rig.mouth.center },
            initialLiveOffset: { x: 0, y: 0 },
            initialRig: rig,
            latestDraftRig: null,
          };
          return;
        }

        // Dragging outside the mouth in edit mode pans the photo smoothly!
        beginStagePanDrag(e, null);
        return;
      }

      // Case 2: Placing / Drawing new Pen Draft Points!
      if (nx < 0.005 || nx > 0.995 || ny < 0.005 || ny > 0.995) {
        beginStagePanDrag(e, null);
        return;
      }

      if (penDraftPoints.length >= 3) {
        const p0x = cr.x + penDraftPoints[0].x * cr.w;
        const p0y = cr.y + penDraftPoints[0].y * cr.h;
        if (Math.hypot(sx - p0x, sy - p0y) <= 14) {
          commitPenDraft('polygon');
          return;
        }
      }

      if (e.detail >= 2 && penDraftPoints.length >= 2) {
        const chosenKind =
          penTargetKind === 'polygon' && penDraftPoints.length >= 3
            ? 'polygon'
            : 'seam';
        commitPenDraft(chosenKind);
        return;
      }

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
          startCharOffsetX: stageSettings.characterOffsetX ?? 0,
          startCharOffsetY: stageSettings.characterOffsetY ?? 0,
          startNormMouse: clampedPt,
          initialJointPos: clampedPt,
          initialLiveOffset: { x: 0, y: 0 },
          initialRig: rig,
          latestDraftRig: null,
        };
        return;
      }

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
      // Shift+Drag in Animate Mode ALSO moves the pin WITHOUT distorting the body!
      const isRebindInAnimate =
        toolMode === 'animate' &&
        e.shiftKey &&
        Boolean(joint);
      if (isRebindInAnimate) {
        setIsRebindingPinInAnimate(true);
      }

      dragStateRef.current = {
        kind: isRebindInAnimate ? 'gizmo_rebind' : 'gizmo',
        targetId: hit,
        moveSubtree: movePinSubtree || e.ctrlKey || e.metaKey,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startCamPanX: camera.panX,
        startCamPanY: camera.panY,
        startCharOffsetX: stageSettings.characterOffsetX ?? 0,
        startCharOffsetY: stageSettings.characterOffsetY ?? 0,
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

    // Clicked/dragged on non-pin area -> Dragging >= 4px pans the image/character smoothly!
    // Clicking without dragging (< 4px) adds a pin (if clickToAddPin or customPins) or deselects!
    const shouldAddPinOnClick =
      toolMode === 'setup_rig' &&
      (rig.mode === 'customPins' || clickToAddPin) &&
      nx >= 0.02 &&
      nx <= 0.98 &&
      ny >= 0.02 &&
      ny <= 0.98;

    beginStagePanDrag(e, shouldAddPinOnClick ? { x: nx, y: ny } : null);
  };

  const applyPinRestDrag = (
    drag: NonNullable<typeof dragStateRef.current>,
    dnx: number,
    dny: number
  ): PuppetRig => {
    const clampCoord = (v: number) => Math.max(0.02, Math.min(0.98, v));
    const subtreeIds = drag.moveSubtree
      ? collectSubtreeJointIds(drag.initialRig, drag.targetId)
      : new Set<string>([drag.targetId]);

    const nextJoints = drag.initialRig.joints.map((j) =>
      subtreeIds.has(j.id)
        ? {
            ...j,
            rest: {
              x: clampCoord(j.rest.x + dnx),
              y: clampCoord(j.rest.y + dny),
            },
          }
        : j
    );
    return { ...drag.initialRig, joints: nextJoints };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { sx, sy, nx, ny, cr } = clientToStage(e.clientX, e.clientY);
    const drag = dragStateRef.current;

    // Stage / Photo Mouse Panning
    if (drag?.kind === 'stage_pan') {
      const movePx = Math.hypot(
        e.clientX - drag.startClientX,
        e.clientY - drag.startClientY
      );
      if (!drag.hasMoved && movePx < 4 && !isPanMode) {
        return;
      }
      if (!drag.hasMoved) {
        drag.hasMoved = true;
        setIsActivelyPanning(true);
      }

      const canvas = canvasRef.current;
      const r = canvas?.getBoundingClientRect();
      const scaleX = r ? canvas!.width / Math.max(1, r.width) : 1;
      const scaleY = r ? canvas!.height / Math.max(1, r.height) : 1;
      const dxStage = (e.clientX - drag.startClientX) * scaleX;
      const dyStage = (e.clientY - drag.startClientY) * scaleY;

      if (drag.panAffectsFrame) {
        const nextOffX = Math.max(
          -0.85,
          Math.min(0.85, drag.startCharOffsetX + dxStage / Math.max(1, canvasSize.w))
        );
        const nextOffY = Math.max(
          -0.85,
          Math.min(0.85, drag.startCharOffsetY + dyStage / Math.max(1, canvasSize.h))
        );
        onUpdateStageSettings({
          characterOffsetX: nextOffX,
          characterOffsetY: nextOffY,
        });
      } else {
        setCamera((prev) => ({
          ...prev,
          panX: drag.startCamPanX + dxStage,
          panY: drag.startCamPanY + dyStage,
        }));
      }
      return;
    }

    if (toolMode === 'pen_mouth' && !isPanMode) {
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

      if (penDraftPoints.length === 0 && rig.mouth.customPath) {
        const { vertIdx } = hitTestPenVertices(sx, sy);
        if (vertIdx !== hoveredPenVertIdx) setHoveredPenVertIdx(vertIdx);
      } else if (hoveredPenVertIdx !== null) {
        setHoveredPenVertIdx(null);
      }
      return;
    }

    if (!drag) {
      if (isPanMode) {
        if (hoveredId !== null) setHoveredId(null);
        return;
      }
      const hit = hitTestGizmos(sx, sy);
      if (hit !== hoveredId) setHoveredId(hit);
      return;
    }

    const dnx = nx - drag.startNormMouse.x;
    const dny = ny - drag.startNormMouse.y;

    // Shift+Drag in Animate Mode OR normal Drag in Setup Rig Mode -> Moves Pin WITHOUT altering body!
    if (drag.kind === 'gizmo_rebind') {
      const nextRig = applyPinRestDrag(drag, dnx, dny);
      drag.latestDraftRig = nextRig;
      onPreviewRigDraft(nextRig);
      return;
    }

    if (toolMode === 'setup_rig') {
      const clamp01 = (v: number) => Math.max(0.02, Math.min(0.98, v));

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
        const nextRig = applyPinRestDrag(drag, dnx, dny);
        drag.latestDraftRig = nextRig;
        onPreviewRigDraft(nextRig);
      }
    } else {
      // Animate Mode: Live puppeteering drag offset!
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

    setIsActivelyPanning(false);

    if (drag.kind === 'stage_pan') {
      if (!drag.hasMoved && !isPanMode) {
        if (drag.pendingEmptyClickPos) {
          onAddCustomPinAt(drag.pendingEmptyClickPos);
        } else if (toolMode !== 'pen_mouth') {
          onSelectJoint(null);
        }
      }
      dragStateRef.current = null;
      return;
    }

    if (drag.kind === 'gizmo_rebind') {
      setIsRebindingPinInAnimate(false);
      if (drag.latestDraftRig) {
        onCommitRigDraft(drag.latestDraftRig);
      }
      dragStateRef.current = null;
      return;
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
  const hasManualBodyWarp = Object.keys(liveJointOffsets).length > 0;
  const hasFramingOrCameraShift =
    Math.abs(camera.zoom - 1) > 0.02 ||
    Math.abs(camera.panX) > 2 ||
    Math.abs(camera.panY) > 2 ||
    Math.abs(stageSettings.characterOffsetX ?? 0) > 0.005 ||
    Math.abs(stageSettings.characterOffsetY ?? 0) > 0.005;

  const selectedJointObj = selectedJointId
    ? rig.joints.find((j) => j.id === selectedJointId) || null
    : null;

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
      {/* Top Floating Viewport Mode Pill + Hand Pan + Zoom/View Controls */}
      <div className="absolute top-2.5 inset-x-3 flex flex-col gap-2 pointer-events-none z-10">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="pointer-events-auto inline-flex flex-wrap items-center gap-0.5 bg-studio-900/92 backdrop-blur-md border border-studio-700/90 rounded-xl p-1 shadow-xl">
            <button
              type="button"
              onClick={() => {
                setIsPanMode(false);
                onChangeToolMode('animate');
              }}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
                toolMode === 'animate' && !isPanMode
                  ? 'bg-indigo-500 text-white shadow'
                  : 'text-slate-300 hover:text-white'
              }`}
              title="پخش انیمیشن و حرکت دادن زنده اندام‌ها"
            >
              <Play className="w-3.5 h-3.5" />
              <span>انیمیشن</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setIsPanMode(false);
                onChangeToolMode('setup_rig');
              }}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
                toolMode === 'setup_rig' && !isPanMode
                  ? 'bg-sky-400 text-slate-950 shadow'
                  : 'text-sky-200 hover:text-white hover:bg-sky-500/15'
              }`}
              title="جابه‌جایی پین‌ها روی بدن بدون هیچ‌گونه کشیدگی یا دستکاری تصویر کاراکتر"
            >
              <Crosshair className="w-3.5 h-3.5" />
              <span>جابه‌جایی پین (بدون تغییر بدن)</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setIsPanMode(false);
                onChangeToolMode('pen_mouth');
              }}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
                toolMode === 'pen_mouth' && !isPanMode
                  ? 'bg-fuchsia-500 text-white shadow'
                  : 'text-fuchsia-200 hover:text-white hover:bg-fuchsia-500/15'
              }`}
              title="ترسیم دستی محدوده دهان کج، منحنی یا ناهموار با ابزار Pen"
            >
              <PenTool className="w-3.5 h-3.5" />
              <span>Pen دهان</span>
              {hasCustomMouth && (
                <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-sm" />
              )}
            </button>

            <div className="w-px h-4 bg-studio-700 mx-0.5" />

            <button
              type="button"
              onClick={() => setIsPanMode((v) => !v)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
                isPanMode
                  ? 'bg-amber-400 text-slate-950 shadow'
                  : 'text-amber-200 hover:text-white hover:bg-amber-500/15'
              }`}
              title="حرکت دادن عکس و سوژه با ماوس (وقتی سر از کادر بیرون زد، بکشید پایین!) — میان‌بر: کلید H"
            >
              <Hand className="w-3.5 h-3.5" />
              <span>حرکت روی عکس</span>
            </button>
          </div>

          {/* Zoom + Head/Mouth Focus + Wireframe + Clean View Toggles */}
          <div className="pointer-events-auto inline-flex items-center gap-1 bg-studio-900/92 backdrop-blur-md border border-studio-700/90 rounded-xl p-1 shadow-xl">
            {hasManualBodyWarp && toolMode === 'animate' && (
              <button
                type="button"
                onClick={onClearLiveJointOffsets}
                className="px-2 py-1.5 rounded-lg text-[11px] font-bold bg-amber-500/20 hover:bg-amber-500/35 text-amber-200 border border-amber-400/40 flex items-center gap-1 transition"
                title="بازگرداندن بدن به فرم اصلی بدون کشیدگی دستی"
              >
                <RotateCcw className="w-3 h-3" />
                <span>صاف کردن بدن</span>
              </button>
            )}

            <button
              type="button"
              onClick={focusZoomOnHead}
              className="px-2 py-1.5 rounded-lg text-[11px] font-semibold flex items-center gap-1 text-sky-200 hover:bg-sky-500/20 transition"
              title="آوردن سر و صورت کاراکتر به وسط صفحه"
            >
              <Focus className="w-3.5 h-3.5" />
              <span className="hidden md:inline">زوم سر</span>
            </button>

            <button
              type="button"
              onClick={focusZoomOnMouth}
              className="px-2 py-1.5 rounded-lg text-[11px] font-semibold flex items-center gap-1 text-fuchsia-200 hover:bg-fuchsia-500/20 transition"
              title="زوم دقیق روی دهان کاراکتر"
            >
              <Focus className="w-3.5 h-3.5" />
              <span className="hidden md:inline">زوم دهان</span>
            </button>

            <button
              type="button"
              onClick={() => adjustZoom(1 / 1.22)}
              disabled={camera.zoom <= 0.52}
              className="p-1.5 rounded-lg text-slate-300 hover:text-white disabled:opacity-35"
              title="کوچک‌نمایی (تا ۵۰٪)"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={resetCameraAndFraming}
              className={`px-1.5 py-1 rounded text-[10px] font-mono font-bold transition ${
                hasFramingOrCameraShift
                  ? 'bg-amber-500/20 text-amber-200 border border-amber-400/40'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="وسط‌چین کردن سوژه و بازنشانی بزرگ‌نمایی به ۱۰۰٪"
            >
              {Math.round(camera.zoom * 100)}%
            </button>

            <button
              type="button"
              onClick={() => adjustZoom(1.22)}
              disabled={camera.zoom >= 4.9}
              className="p-1.5 rounded-lg text-slate-300 hover:text-white disabled:opacity-35"
              title="بزرگ‌نمایی (تا ۵۰۰٪)"
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

        {/* Contextual Toolbar 1: Hand / Mouse Pan Mode */}
        {isPanMode && (
          <div className="pointer-events-auto self-start flex flex-wrap items-center gap-1.5 bg-studio-950/92 backdrop-blur-md border border-amber-400/50 rounded-xl px-2.5 py-1.5 shadow-2xl">
            <span className="text-[11px] font-extrabold text-amber-300 flex items-center gap-1 pl-1.5 border-l border-studio-700">
              <Hand className="w-3.5 h-3.5" />
              <span>حرکت با ماوس فعال است:</span>
            </span>

            <button
              type="button"
              onClick={() => setPanTarget('auto')}
              className={`px-2 py-1 rounded-lg text-[11px] font-semibold border transition ${
                panTarget === 'auto'
                  ? 'bg-amber-400/25 border-amber-300/60 text-amber-100'
                  : 'bg-studio-800 border-studio-700 text-slate-300 hover:text-white'
              }`}
            >
              هوشمند
            </button>

            <button
              type="button"
              onClick={() => setPanTarget('frame')}
              className={`px-2 py-1 rounded-lg text-[11px] font-semibold border transition ${
                panTarget === 'frame'
                  ? 'bg-emerald-500/25 border-emerald-400/60 text-emerald-100'
                  : 'bg-studio-800 border-studio-700 text-slate-300 hover:text-white'
              }`}
              title="جابه‌جایی جای خودِ کاراکتر داخل کادر خروجی انیمیشن و GIF (وقتی سر در پرش یا اسکیل بالا بیرون می‌زند)"
            >
              <Move className="w-3 h-3 inline ml-1" />
              جابه‌جایی سوژه در کادر خروجی
            </button>

            <button
              type="button"
              onClick={() => setPanTarget('camera')}
              className={`px-2 py-1 rounded-lg text-[11px] font-semibold border transition ${
                panTarget === 'camera'
                  ? 'bg-sky-500/25 border-sky-400/60 text-sky-100'
                  : 'bg-studio-800 border-studio-700 text-slate-300 hover:text-white'
              }`}
              title="جابه‌جایی دوربین دید بدون تغییر کادر خروجی GIF"
            >
              جابه‌جایی دید بوم
            </button>

            {hasFramingOrCameraShift && (
              <button
                type="button"
                onClick={resetCameraAndFraming}
                className="px-2 py-1 rounded-lg text-[11px] bg-studio-800 hover:bg-studio-700 text-amber-200 flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" />
                <span>وسط‌چین کادر</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsPanMode(false)}
              className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              ادامه تنظیم روی سوژه ✓
            </button>
          </div>
        )}

        {/* Contextual Toolbar 2: Reposition Pins Without Altering Body (setup_rig) */}
        {!isPanMode && toolMode === 'setup_rig' && (
          <div className="pointer-events-auto self-start flex flex-wrap items-center gap-1.5 bg-studio-950/92 backdrop-blur-md border border-sky-400/45 rounded-xl px-2.5 py-1.5 shadow-2xl">
            <span className="text-[11px] font-extrabold text-emerald-300 flex items-center gap-1 pl-1.5 border-l border-studio-700">
              <Lock className="w-3.5 h-3.5" />
              <span>بدن قفل است (بدون دستکاری تصویر):</span>
            </span>

            <button
              type="button"
              onClick={() => setMovePinSubtree((v) => !v)}
              className={`px-2 py-1 rounded-lg text-[11px] font-semibold border transition ${
                !movePinSubtree
                  ? 'bg-sky-500/25 border-sky-400/60 text-sky-100'
                  : 'bg-violet-500/25 border-violet-400/60 text-violet-100'
              }`}
              title="انتخاب بین جابه‌جایی فقط همان پین، یا پین به‌همراه زیرمجموعه‌اش (Ctrl)"
            >
              {movePinSubtree ? 'جابه‌جایی: با زیرمجموعه' : 'جابه‌جایی: تکی (فقط همان پین)'}
            </button>

            <button
              type="button"
              onClick={() => setClickToAddPin((v) => !v)}
              className={`px-2 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 border transition ${
                clickToAddPin || rig.mode === 'customPins'
                  ? 'bg-emerald-500/25 border-emerald-400/60 text-emerald-100'
                  : 'bg-studio-800 border-studio-700 text-slate-300 hover:text-white'
              }`}
              title="با فعال بودن این گزینه، کلیک روی هر جای بدن یک پین جدید اضافه می‌کند"
            >
              <Plus className="w-3 h-3" />
              <span>افزودن پین با کلیک</span>
            </button>

            {selectedJointObj && (
              <>
                <div className="w-px h-4 bg-studio-700 mx-0.5" />
                <span className="text-[11px] font-bold text-sky-200 px-1">
                  «{selectedJointObj.nameFa}»
                </span>
                <button
                  type="button"
                  onClick={() => onToggleJointPinned(selectedJointObj.id)}
                  className={`px-2 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 border transition ${
                    selectedJointObj.pinned
                      ? 'bg-amber-500/25 border-amber-400/60 text-amber-200'
                      : 'bg-studio-800 border-studio-700 text-slate-300 hover:text-white'
                  }`}
                  title="پین قفل‌شده (نگهدارنده) آن بخش از بدن را سر جایش میخکوب می‌کند"
                >
                  {selectedJointObj.pinned ? (
                    <>
                      <Pin className="w-3 h-3" />
                      <span>ثابت‌شده (نگهدارنده)</span>
                    </>
                  ) : (
                    <>
                      <Unlock className="w-3 h-3" />
                      <span>قفل کردن این پین</span>
                    </>
                  )}
                </button>

                {rig.joints.length > 3 && (
                  <button
                    type="button"
                    onClick={() => onDeleteCustomJoint(selectedJointObj.id)}
                    className="px-2 py-1 rounded-lg text-[11px] bg-rose-500/20 hover:bg-rose-500/35 text-rose-200 flex items-center gap-1 transition"
                    title="حذف این پین از روی بدن"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>حذف</span>
                  </button>
                )}
              </>
            )}

            <button
              type="button"
              onClick={onAutoResetRig}
              className="px-2 py-1 rounded-lg text-[11px] bg-studio-800 hover:bg-studio-700 text-slate-300 flex items-center gap-1 transition"
              title="چیدمان مجدد خودکار پین‌ها روی بدن"
            >
              <RotateCcw className="w-3 h-3" />
              <span>چیدمان خودکار</span>
            </button>
          </div>
        )}

        {/* Contextual Toolbar 3: Dedicated Pen Mouth Toolbar */}
        {!isPanMode && toolMode === 'pen_mouth' && (
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

            {hasFramingOrCameraShift && (
              <button
                type="button"
                onClick={resetCameraAndFraming}
                className="px-2 py-1 rounded-lg text-[11px] bg-studio-800 hover:bg-studio-700 text-amber-200 flex items-center gap-1"
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
          {isPanMode
            ? '✋ روی عکس کلیک کنید و به پایین/بالا یا چپ/راست بکشید تا سر و بدن دقیق داخل کادر قرار بگیرد (چرخ ماوس = زوم)'
            : toolMode === 'pen_mouth'
            ? hasCustomMouth && penDraftPoints.length === 0
              ? '✒️ نقاط مربعی را روی خط لب تنظیم کنید | کشیدن بیرون دهان = حرکت روی عکس | دکمه «حرکت روی عکس» برای جابه‌جایی آزاد'
              : '✒️ روی خط لب نقطه بگذارید و Enter بزنید | اگر سر بیرون کادر است دکمه «حرکت روی عکس» (یا Alt+کشیدن) را بزنید'
            : toolMode === 'setup_rig'
            ? '📌 پین‌ها را بدون هیچ تغییری در بدن جابه‌جا کنید! | کشیدن فضای خالی با ماوس = حرکت دادن عکس به پایین/بالا | چرخ ماوس = زوم'
            : '💡 کشیدن فضای خالی با ماوس = جابه‌جایی عکس | برای تغییر جای پین بدون دستکاری بدن «جابه‌جایی پین» را بزنید (یا Shift+کشیدن پین)'}
        </div>
      </div>

      {/* Main Interactive Stage Canvas */}
      <canvas
        ref={canvasRef}
        width={canvasSize.w}
        height={canvasSize.h}
        onContextMenu={handleContextMenu}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={() => setPenCursorNorm(null)}
        className={`max-w-full max-h-full touch-none ${
          isActivelyPanning
            ? 'cursor-grabbing'
            : isPanMode
            ? 'cursor-grab'
            : toolMode === 'pen_mouth'
            ? hoveredPenVertIdx !== null
              ? 'cursor-move'
              : 'cursor-crosshair'
            : hoveredId
            ? hoveredId === '__mouth_resize__'
              ? 'cursor-ew-resize'
              : hoveredId === '__mouth_arch__'
              ? 'cursor-ns-resize'
              : 'cursor-grab active:cursor-grabbing'
            : toolMode === 'setup_rig' &&
              (rig.mode === 'customPins' || clickToAddPin)
            ? 'cursor-crosshair'
            : 'cursor-grab'
        }`}
      />

      {/* Drag & Drop File Overlay */}
      {isDragOverFile && (
        <div className="absolute inset-3 rounded-2xl bg-indigo-950/85 border-2 border-dashed border-indigo-400 flex flex-col items-center justify-center gap-3 z-20 pointer-events-none">
          <Upload className="w-12 h-12 text-indigo-300 animate-bounce" />
          <p className="text-base font-bold text-white">
            تصویر کاراکتر خود را اینجا رها کنید
          </p>
          <p className="text-xs text-indigo-200">
            پشتیبانی از PNG شفاف، JPG، WebP و SVG
          </p>
        </div>
      )}
    </div>
  );
};
