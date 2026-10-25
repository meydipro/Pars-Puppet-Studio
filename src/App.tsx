import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AnimationPresetsPanel } from './components/AnimationPresetsPanel';
import { CharacterRigPanel } from './components/CharacterRigPanel';
import { GifExportModal } from './components/GifExportModal';
import { HeaderBar } from './components/HeaderBar';
import { ImageCropModal } from './components/ImageCropModal';
import { StageViewport } from './components/StageViewport';
import { TimelineBar } from './components/TimelineBar';
import {
  analyzeCharacterSilhouette,
  applyStickerBorderToRgba,
  buildAutoRigFromLandmarks,
  cropImageBuffer,
  loadBrowserImageToBuffer,
  ProcessedImageBuffer,
  removeBackgroundFloodFill,
} from './engine/imageProcessor';
import { buildPuppetMesh } from './engine/meshBuilder';
import {
  compileMouthGeometry,
  sampleSurroundingMouthSkinColor,
} from './engine/mouthPenGeometry';
import { PuppetMeshRenderer } from './engine/renderer';
import {
  bakePresetToKeyframes,
  PRESET_ANIMATIONS,
} from './engine/rigAndAnimator';
import {
  generateSampleCharacter,
  SAMPLE_CHARACTERS,
  SampleCharacterMeta,
} from './engine/sampleCharacters';
import {
  AnimationSettings,
  ImageTransformSpec,
  KeyframePoint,
  PresetAnimationId,
  PuppetRig,
  RecordedSample,
  RigMode,
  StageSettings,
  Vec2,
  ViewportToolMode,
} from './engine/types';

interface HistorySnapshot {
  rig: PuppetRig;
  keyframes: KeyframePoint[];
  recordedSamples: RecordedSample[];
}

const DEFAULT_CROP_SPEC: ImageTransformSpec = {
  rotation: 0,
  flipH: false,
  flipV: false,
  crop: { x: 0, y: 0, w: 1, h: 1 },
};

export const App: React.FC = () => {
  // Generate sample thumbnails & initial default character once
  const initialData = useMemo(() => {
    const thumbs: Record<string, string> = {};
    let defaultSample = generateSampleCharacter('arash_boy');
    for (const sc of SAMPLE_CHARACTERS) {
      const gen = generateSampleCharacter(sc.id);
      thumbs[sc.id] = gen.thumbnailDataUrl;
      if (sc.id === 'arash_boy') {
        defaultSample = gen;
      }
    }
    const landmarks = analyzeCharacterSilhouette(
      defaultSample.image.rgba,
      defaultSample.image.width,
      defaultSample.image.height
    );
    const rig =
      defaultSample.customRig || buildAutoRigFromLandmarks(landmarks, 'fullBody');
    return { thumbs, defaultImage: defaultSample.image, defaultRig: rig };
  }, []);

  const [sampleThumbnails] = useState<Record<string, string>>(
    initialData.thumbs
  );
  const [activeSampleId, setActiveSampleId] = useState<string | null>(
    'arash_boy'
  );

  // `originalSourceImage` keeps the full uncropped image so cropping is non-destructive
  const [originalSourceImage, setOriginalSourceImage] =
    useState<ProcessedImageBuffer>(initialData.defaultImage);
  const [rawImage, setRawImage] = useState<ProcessedImageBuffer>(
    initialData.defaultImage
  );
  const [cropSpec, setCropSpec] =
    useState<ImageTransformSpec>(DEFAULT_CROP_SPEC);
  const [isCropModalOpen, setIsCropModalOpen] = useState(false);

  const isCropActive =
    cropSpec.rotation !== 0 ||
    cropSpec.flipH ||
    cropSpec.flipV ||
    cropSpec.crop.x > 0.005 ||
    cropSpec.crop.y > 0.005 ||
    cropSpec.crop.w < 0.99 ||
    cropSpec.crop.h < 0.99;

  // Background removal state
  const [bgRemovedActive, setBgRemovedActive] = useState(false);
  const [bgTolerance, setBgTolerance] = useState(38);

  // Rig & Undo/Redo state
  const [committedRig, setCommittedRig] = useState<PuppetRig>(
    initialData.defaultRig
  );
  const [draftRig, setDraftRig] = useState<PuppetRig | null>(null);
  const activeRig = draftRig || committedRig;

  const [keyframes, setKeyframes] = useState<KeyframePoint[]>([]);
  const [selectedKeyframeId, setSelectedKeyframeId] = useState<string | null>(
    null
  );
  const [recordedSamples, setRecordedSamples] = useState<RecordedSample[]>([]);

  const [historyPast, setHistoryPast] = useState<HistorySnapshot[]>([]);
  const [historyFuture, setHistoryFuture] = useState<HistorySnapshot[]>([]);

  const pushHistory = useCallback(
    (snap?: HistorySnapshot) => {
      const entry = snap || {
        rig: committedRig,
        keyframes,
        recordedSamples,
      };
      setHistoryPast((prev) => [...prev.slice(-24), entry]);
      setHistoryFuture([]);
    },
    [committedRig, keyframes, recordedSamples]
  );

  // Tool & Selection state
  const [toolMode, setToolMode] = useState<ViewportToolMode>('animate');
  const [selectedJointId, setSelectedJointId] = useState<string | null>(null);

  // Animation & Stage settings
  const [animSettings, setAnimSettings] = useState<AnimationSettings>({
    presetId: 'talk_excited',
    duration: 2.4,
    fps: 20,
    speed: 1.0,
    bodyIntensity: 1.0,
    mouthIntensity: 1.05,
    springiness: 1.0,
    talkOverlay: false,
    mouthStyle: 'cutout_jaw',
    dialogueText: '',
    showSpeechBubble: true,
    speechBubblePos: 'top-right',
    pingPong: false,
  });

  const [stageSettings, setStageSettings] = useState<StageSettings>({
    backgroundStyle: 'transparent',
    solidColor: '#1e293b',
    groundShadow: true,
    stickerOutline: false,
    stickerColor: '#ffffff',
    stickerWidth: 6,
    characterScale: 0.86,
    characterOffsetX: 0,
    characterOffsetY: 0,
  });

  // Playback & Live Puppeteering state
  const [isPlaying, setIsPlaying] = useState(true);
  const [normTime, setNormTime] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [liveJointOffsets, setLiveJointOffsets] = useState<
    Record<string, Vec2>
  >({});
  const [isLiveTalkHeld, setIsLiveTalkHeld] = useState(false);

  // Microphone Lip-Sync state
  const [micActive, setMicActive] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [micMouthLevel, setMicMouthLevel] = useState<number | null>(null);
  const audioCleanupRef = useRef<(() => void) | null>(null);

  // Export Modal & Hidden File Input
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const hiddenFileInputRef = useRef<HTMLInputElement | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
  }, []);

  useEffect(() => {
    if (!toastMessage) return;
    const t = setTimeout(() => setToastMessage(null), 3200);
    return () => clearTimeout(t);
  }, [toastMessage]);

  // Step 1: Apply Smart Background Removal if toggled
  const cutoutBuffer = useMemo(() => {
    if (!bgRemovedActive) return rawImage;
    const cleaned = removeBackgroundFloodFill(
      rawImage.rgba,
      rawImage.width,
      rawImage.height,
      bgTolerance,
      18
    );
    return {
      rgba: cleaned,
      width: rawImage.width,
      height: rawImage.height,
      hasTransparency: true,
    };
  }, [rawImage, bgRemovedActive, bgTolerance]);

  // Step 2: Apply Optional Sticker Outline
  const finalImageBuffer = useMemo(() => {
    if (!stageSettings.stickerOutline) return cutoutBuffer;
    const bordered = applyStickerBorderToRgba(
      cutoutBuffer.rgba,
      cutoutBuffer.width,
      cutoutBuffer.height,
      stageSettings.stickerWidth,
      stageSettings.stickerColor
    );
    return {
      ...cutoutBuffer,
      rgba: bordered,
    };
  }, [
    cutoutBuffer,
    stageSettings.stickerOutline,
    stageSettings.stickerWidth,
    stageSettings.stickerColor,
  ]);

  // Step 2b: Sample surrounding face skin color for clean static-mouth concealment
  const mouthSkinColor = useMemo(() => {
    return sampleSurroundingMouthSkinColor(
      finalImageBuffer.rgba,
      finalImageBuffer.width,
      finalImageBuffer.height,
      compileMouthGeometry(activeRig.mouth)
    );
  }, [finalImageBuffer, activeRig.mouth]);

  // Step 3: Build Deformable Delaunay Geodesic Mesh
  const mesh = useMemo(() => {
    return buildPuppetMesh(
      finalImageBuffer.rgba,
      finalImageBuffer.width,
      finalImageBuffer.height,
      committedRig
    );
  }, [finalImageBuffer, committedRig]);

  // Step 4: Singleton WebGL/Software Mesh Renderer
  const meshRendererRef = useRef<PuppetMeshRenderer | null>(null);
  if (!meshRendererRef.current) {
    meshRendererRef.current = new PuppetMeshRenderer();
  }

  useEffect(() => {
    meshRendererRef.current?.setTexture(
      finalImageBuffer.rgba,
      finalImageBuffer.width,
      finalImageBuffer.height
    );
  }, [finalImageBuffer]);

  // Combined live mouth override (Push-to-talk Spacebar OR Live Microphone)
  const effectiveLiveMouth: number | null = useMemo(() => {
    if (isLiveTalkHeld) {
      const wave = 0.65 + 0.35 * Math.sin(normTime * Math.PI * 16);
      return wave;
    }
    if (micActive && micMouthLevel !== null) {
      return micMouthLevel;
    }
    return null;
  }, [isLiveTalkHeld, micActive, micMouthLevel, normTime]);

  // Refs for smooth 60fps animation & live recording without re-subscribing RAF
  const animSettingsRef = useRef(animSettings);
  animSettingsRef.current = animSettings;
  const isRecordingRef = useRef(isRecording);
  isRecordingRef.current = isRecording;
  const liveOffsetsRef = useRef(liveJointOffsets);
  liveOffsetsRef.current = liveJointOffsets;
  const liveMouthRef = useRef(effectiveLiveMouth);
  liveMouthRef.current = effectiveLiveMouth;
  const recordBucketsRef = useRef<Map<number, RecordedSample>>(new Map());

  // 60 FPS Playback Loop
  useEffect(() => {
    if (
      !isPlaying ||
      toolMode === 'setup_rig' ||
      toolMode === 'pen_mouth' ||
      isExportModalOpen ||
      isCropModalOpen
    ) {
      return;
    }

    let rafId = 0;
    let lastTs = performance.now();
    let phase = normTime;

    const tick = (now: number) => {
      const dt = Math.min(0.06, Math.max(0, (now - lastTs) / 1000));
      lastTs = now;

      const s = animSettingsRef.current;
      const effDur = Math.max(0.35, s.duration / Math.max(0.2, s.speed));
      const cycleSpan = s.pingPong ? 2.0 : 1.0;
      phase = (phase + dt / effDur) % cycleSpan;

      const nextU = s.pingPong && phase > 1.0 ? 2.0 - phase : phase;
      setNormTime(nextU);

      if (isRecordingRef.current) {
        const BUCKETS = 64;
        const b = Math.min(BUCKETS - 1, Math.floor(nextU * BUCKETS));
        const offsetsCopy: Record<string, Vec2> = {};
        for (const [k, v] of Object.entries(liveOffsetsRef.current)) {
          offsetsCopy[k] = { x: v.x, y: v.y };
        }
        recordBucketsRef.current.set(b, {
          t: b / BUCKETS,
          jointOffsets: offsetsCopy,
          mouthOpen:
            liveMouthRef.current !== null ? liveMouthRef.current : undefined,
        });
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, toolMode, isExportModalOpen, isCropModalOpen]);

  // Finalize recorded buckets into `recordedSamples` when stopping recording
  const handleToggleRecording = useCallback(() => {
    if (isRecording) {
      setIsRecording(false);
      const collected = Array.from(recordBucketsRef.current.values()).sort(
        (a, b) => a.t - b.t
      );
      if (collected.length > 0) {
        pushHistory();
        setRecordedSamples(collected);
        showToast('حرکت زنده شما روی تایم‌لاین ذخیره شد!');
      }
      recordBucketsRef.current.clear();
    } else {
      recordBucketsRef.current.clear();
      setToolMode('animate');
      setIsPlaying(true);
      setIsRecording(true);
      showToast('ضبط فعال شد: مفاصل را با ماوس حرکت دهید یا Space را نگه دارید!');
    }
  }, [isRecording, pushHistory, showToast]);

  // Load Uploaded Image File
  const handleLoadUploadedFile = useCallback(
    async (file: File) => {
      try {
        const loaded = await loadBrowserImageToBuffer(file, 720);
        const landmarks = analyzeCharacterSilhouette(
          loaded.rgba,
          loaded.width,
          loaded.height
        );
        const autoRig = buildAutoRigFromLandmarks(
          landmarks,
          landmarks.suggestedMode
        );

        setActiveSampleId(null);
        setBgRemovedActive(false);
        setOriginalSourceImage(loaded);
        setRawImage(loaded);
        setCropSpec(DEFAULT_CROP_SPEC);
        setDraftRig(null);
        setCommittedRig(autoRig);
        setKeyframes([]);
        setSelectedKeyframeId(null);
        setRecordedSamples([]);
        setLiveJointOffsets({});
        setHistoryPast([]);
        setHistoryFuture([]);
        setSelectedJointId(null);

        if (!loaded.hasTransparency) {
          showToast(
            'عکس بارگذاری شد! می‌توانید با «کراپ عکس» یا «حذف پس‌زمینه» سوژه را دقیق ببرید.'
          );
        } else {
          showToast('کاراکتر شفاف با موفقیت مش‌بندی و آماده انیمیشن شد!');
        }
      } catch (err) {
        showToast(
          err instanceof Error ? err.message : 'خطا در خواندن فایل تصویر'
        );
      }
    },
    [showToast]
  );

  // Apply Crop & Orientation from Crop Modal
  const handleApplyCrop = useCallback(
    (spec: ImageTransformSpec, orientedBuffer: ProcessedImageBuffer) => {
      const cropped = cropImageBuffer(orientedBuffer, spec.crop, true);
      const effectivePixels = bgRemovedActive
        ? removeBackgroundFloodFill(
            cropped.rgba,
            cropped.width,
            cropped.height,
            bgTolerance,
            18
          )
        : cropped.rgba;

      const landmarks = analyzeCharacterSilhouette(
        effectivePixels,
        cropped.width,
        cropped.height
      );

      setCropSpec(spec);
      setRawImage(cropped);
      setDraftRig(null);
      setCommittedRig((prev) =>
        buildAutoRigFromLandmarks(
          landmarks,
          prev.mode === 'customPins' ? 'customPins' : landmarks.suggestedMode
        )
      );
      setKeyframes([]);
      setSelectedKeyframeId(null);
      setRecordedSamples([]);
      setLiveJointOffsets({});
      showToast('کراپ تصویر اعمال شد و اسکلت کاراکتر روی کادر جدید تنظیم گردید!');
    },
    [bgRemovedActive, bgTolerance, showToast]
  );

  const handleResetCrop = useCallback(() => {
    const landmarks = analyzeCharacterSilhouette(
      originalSourceImage.rgba,
      originalSourceImage.width,
      originalSourceImage.height
    );
    setCropSpec(DEFAULT_CROP_SPEC);
    setRawImage(originalSourceImage);
    setDraftRig(null);
    setCommittedRig((prev) => buildAutoRigFromLandmarks(landmarks, prev.mode));
    setLiveJointOffsets({});
    showToast('کراپ لغو شد و تصویر کامل اصلی بازگردانی گردید.');
  }, [originalSourceImage, showToast]);

  // Select Ready Sample Character
  const handleSelectSample = useCallback((sample: SampleCharacterMeta) => {
    const generated = generateSampleCharacter(sample.id);
    const landmarks = analyzeCharacterSilhouette(
      generated.image.rgba,
      generated.image.width,
      generated.image.height
    );
    const nextRig =
      generated.customRig ||
      buildAutoRigFromLandmarks(landmarks, landmarks.suggestedMode);

    setActiveSampleId(sample.id);
    setBgRemovedActive(false);
    setOriginalSourceImage(generated.image);
    setRawImage(generated.image);
    setCropSpec(DEFAULT_CROP_SPEC);
    setDraftRig(null);
    setCommittedRig(nextRig);
    setKeyframes([]);
    setSelectedKeyframeId(null);
    setRecordedSamples([]);
    setLiveJointOffsets({});
    setHistoryPast([]);
    setHistoryFuture([]);
    setSelectedJointId(null);
    setToolMode('animate');
    setAnimSettings((prev) => ({
      ...prev,
      presetId: sample.recommendedPreset,
      duration:
        PRESET_ANIMATIONS.find((p) => p.id === sample.recommendedPreset)
          ?.defaultDuration || 2.4,
    }));
  }, []);

  // Smart Background Removal Actions
  const handleApplyRemoveBg = useCallback(() => {
    const cleaned = removeBackgroundFloodFill(
      rawImage.rgba,
      rawImage.width,
      rawImage.height,
      bgTolerance,
      18
    );
    const landmarks = analyzeCharacterSilhouette(
      cleaned,
      rawImage.width,
      rawImage.height
    );
    setBgRemovedActive(true);
    setCommittedRig((prev) => buildAutoRigFromLandmarks(landmarks, prev.mode));
    showToast('پس‌زمینه عکس حذف شد و شبکه مش دور کاراکتر بازسازی گردید.');
  }, [rawImage, bgTolerance, showToast]);

  const handleRestoreOriginalImage = useCallback(() => {
    setBgRemovedActive(false);
    showToast('تصویر بدون حذف پس‌زمینه بازگردانی شد.');
  }, [showToast]);

  // Rig Mode & Setup Editing
  const handleChangeRigMode = useCallback(
    (mode: RigMode) => {
      pushHistory();
      const landmarks = analyzeCharacterSilhouette(
        cutoutBuffer.rgba,
        cutoutBuffer.width,
        cutoutBuffer.height
      );
      const nextRig = buildAutoRigFromLandmarks(landmarks, mode);
      setDraftRig(null);
      setCommittedRig(nextRig);
      setLiveJointOffsets({});
      setSelectedJointId(null);
      if (mode === 'customPins') {
        setToolMode('setup_rig');
      }
    },
    [cutoutBuffer, pushHistory]
  );

  const handleAutoResetRig = useCallback(() => {
    pushHistory();
    const landmarks = analyzeCharacterSilhouette(
      cutoutBuffer.rgba,
      cutoutBuffer.width,
      cutoutBuffer.height
    );
    setDraftRig(null);
    setCommittedRig(buildAutoRigFromLandmarks(landmarks, committedRig.mode));
    showToast('جایگاه مفاصل و دهان به‌صورت خودکار بازتنظیم شد.');
  }, [cutoutBuffer, committedRig.mode, pushHistory, showToast]);

  const handleCommitRigDraft = useCallback(
    (finalRig: PuppetRig) => {
      const hadCustom = Boolean(committedRig.mouth.customPath);
      const hasCustomNow = Boolean(finalRig.mouth.customPath);

      // Clear any leftover live deformation offsets on pins whose rest position was moved!
      const movedIds = new Set<string>();
      for (const j of finalRig.joints) {
        const prevJ = committedRig.joints.find((p) => p.id === j.id);
        if (
          prevJ &&
          (Math.abs(prevJ.rest.x - j.rest.x) > 1e-4 ||
            Math.abs(prevJ.rest.y - j.rest.y) > 1e-4)
        ) {
          movedIds.add(j.id);
        }
      }
      if (movedIds.size > 0) {
        setLiveJointOffsets((prev) => {
          let changed = false;
          const next = { ...prev };
          for (const id of movedIds) {
            if (id in next) {
              delete next[id];
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      }

      pushHistory();
      setDraftRig(null);
      setCommittedRig(finalRig);
      if (!hadCustom && hasCustomNow) {
        showToast(
          'محدوده دهان سفارشی با ابزار Pen ثبت شد! می‌توانید «تست باز شدن دهان» یا پخش انیمیشن را بزنید.'
        );
      }
    },
    [committedRig, pushHistory, showToast]
  );

  const handleAddCustomPinAt = useCallback(
    (normPos: Vec2) => {
      pushHistory();
      const id = `pin_${Date.now().toString(36)}`;
      const rootJoint = committedRig.joints[0];
      const nextJoints = [
        ...committedRig.joints,
        {
          id,
          nameFa: `پین ${committedRig.joints.length + 1}`,
          parentId: rootJoint ? rootJoint.id : null,
          rest: normPos,
          pinned: false,
          color: '#38bdf8',
        },
      ];
      setCommittedRig({ ...committedRig, joints: nextJoints });
      setSelectedJointId(id);
    },
    [committedRig, pushHistory]
  );

  const handleToggleJointPinned = useCallback(
    (jointId: string) => {
      pushHistory();
      setCommittedRig((prev) => ({
        ...prev,
        joints: prev.joints.map((j) =>
          j.id === jointId ? { ...j, pinned: !j.pinned } : j
        ),
      }));
    },
    [pushHistory]
  );

  const handleDeleteCustomJoint = useCallback(
    (jointId: string) => {
      pushHistory();
      setCommittedRig((prev) => {
        const remaining = prev.joints.filter((j) => j.id !== jointId);
        const fallbackParent = remaining[0]?.id || null;
        return {
          ...prev,
          joints: remaining.map((j, idx) =>
            idx === 0
              ? { ...j, parentId: null }
              : j.parentId === jointId
              ? { ...j, parentId: fallbackParent }
              : j
          ),
        };
      });
      setSelectedJointId(null);
    },
    [pushHistory]
  );

  const handleUpdateMouthSize = useCallback((rx: number, ry: number) => {
    setCommittedRig((prev) => ({
      ...prev,
      mouth: { ...prev.mouth, rx, ry },
    }));
  }, []);

  const handleUpdateMouthParts = useCallback(
    (patch: { showTongue?: boolean; showTeeth?: boolean; arch?: number }) => {
      setCommittedRig((prev) => ({
        ...prev,
        mouth: { ...prev.mouth, ...patch },
      }));
    },
    []
  );

  // Preset & Timeline Keyframe Actions
  const handleSelectPreset = useCallback((presetId: PresetAnimationId) => {
    const meta = PRESET_ANIMATIONS.find((p) => p.id === presetId);
    setAnimSettings((prev) => ({
      ...prev,
      presetId,
      duration: meta ? meta.defaultDuration : prev.duration,
    }));
    setToolMode('animate');
    setIsPlaying(true);
  }, []);

  const handleAddKeyframeAtTime = useCallback(
    (targetTime: number) => {
      pushHistory();
      const tRounded = Math.max(
        0,
        Math.min(0.995, Math.round(targetTime * 1000) / 1000)
      );
      const newId = `kf_${Date.now().toString(36)}`;
      const offsetsCopy: Record<string, Vec2> = {};
      for (const j of committedRig.joints) {
        offsetsCopy[j.id] = liveJointOffsets[j.id]
          ? { ...liveJointOffsets[j.id] }
          : { x: 0, y: 0 };
      }

      setKeyframes((prev) => {
        const existingAtT = prev.find((k) => Math.abs(k.t - tRounded) < 0.015);
        if (existingAtT) {
          const merged: Record<string, Vec2> = { ...existingAtT.jointOffsets };
          for (const [jid, off] of Object.entries(offsetsCopy)) {
            merged[jid] = {
              x: (merged[jid]?.x ?? 0) + off.x,
              y: (merged[jid]?.y ?? 0) + off.y,
            };
          }
          setSelectedKeyframeId(existingAtT.id);
          return prev.map((k) =>
            k.id === existingAtT.id ? { ...k, jointOffsets: merged } : k
          );
        }

        setSelectedKeyframeId(newId);
        return [
          ...prev,
          {
            id: newId,
            t: tRounded,
            jointOffsets: offsetsCopy,
            mouthOpen:
              effectiveLiveMouth !== null ? effectiveLiveMouth : undefined,
          },
        ];
      });

      setLiveJointOffsets({});
      setIsPlaying(false);
      setNormTime(tRounded);
      showToast(
        `کی‌فریم در زمان ${(tRounded * (animSettings.duration / animSettings.speed)).toFixed(2)}s ثبت شد — مفاصل را روی صحنه جابجا کنید!`
      );
    },
    [
      committedRig.joints,
      liveJointOffsets,
      effectiveLiveMouth,
      animSettings.duration,
      animSettings.speed,
      pushHistory,
      showToast,
    ]
  );

  // Automatically absorb live joint drags into the selected keyframe when parked on it!
  const handleFinishLiveJointDrag = useCallback(() => {
    if (!selectedKeyframeId || isPlaying) return;
    const kf = keyframes.find((k) => k.id === selectedKeyframeId);
    if (!kf || Math.abs(kf.t - normTime) > 0.025) return;

    const entries = Object.entries(liveJointOffsets);
    if (entries.length === 0) return;

    pushHistory();
    setKeyframes((prev) =>
      prev.map((item) => {
        if (item.id !== selectedKeyframeId) return item;
        const merged: Record<string, Vec2> = { ...item.jointOffsets };
        for (const [jid, delta] of entries) {
          merged[jid] = {
            x: (merged[jid]?.x ?? 0) + delta.x,
            y: (merged[jid]?.y ?? 0) + delta.y,
          };
        }
        return { ...item, jointOffsets: merged };
      })
    );
    setLiveJointOffsets({});
  }, [selectedKeyframeId, isPlaying, keyframes, normTime, liveJointOffsets, pushHistory]);

  const handleMoveKeyframeTime = useCallback((id: string, newT: number) => {
    const clamped = Math.max(0, Math.min(0.995, Math.round(newT * 1000) / 1000));
    setKeyframes((prev) =>
      prev.map((k) => (k.id === id ? { ...k, t: clamped } : k))
    );
  }, []);

  const handleDeleteKeyframe = useCallback(
    (id: string) => {
      pushHistory();
      setKeyframes((prev) => prev.filter((k) => k.id !== id));
      if (selectedKeyframeId === id) {
        setSelectedKeyframeId(null);
      }
      showToast('کی‌فریم انتخاب‌شده حذف شد.');
    },
    [selectedKeyframeId, pushHistory, showToast]
  );

  const handleBakePresetToKeyframes = useCallback(() => {
    pushHistory();
    const baked = bakePresetToKeyframes(
      committedRig,
      animSettings,
      keyframes,
      recordedSamples,
      8
    );
    setKeyframes(baked);
    setRecordedSamples([]);
    setLiveJointOffsets({});
    setSelectedKeyframeId(baked[0]?.id || null);
    setAnimSettings((prev) => ({ ...prev, presetId: 'custom_only' }));
    setIsPlaying(false);
    setNormTime(0);
    showToast(
      'انیمیشن به ۸ کی‌فریم روی تایم‌لاین تبدیل شد! روی هر لوزی کلیک کنید و ژست یا زمانش را تغییر دهید.'
    );
  }, [committedRig, animSettings, keyframes, recordedSamples, pushHistory, showToast]);

  const handleClearCustomMotion = useCallback(() => {
    pushHistory();
    setKeyframes([]);
    setSelectedKeyframeId(null);
    setRecordedSamples([]);
    setLiveJointOffsets({});
    showToast('کی‌فریم‌ها و حرکات دستی پاک شدند.');
  }, [pushHistory, showToast]);

  const handleResetAllPose = useCallback(() => {
    setLiveJointOffsets({});
    setKeyframes([]);
    setSelectedKeyframeId(null);
    setRecordedSamples([]);
    setIsRecording(false);
    showToast('ژست کاراکتر به حالت استاندارد بازگشت.');
  }, [showToast]);

  // Undo / Redo
  const handleUndo = useCallback(() => {
    if (historyPast.length === 0) return;
    const prev = historyPast[historyPast.length - 1];
    setHistoryFuture((f) => [
      { rig: committedRig, keyframes, recordedSamples },
      ...f,
    ]);
    setHistoryPast((p) => p.slice(0, -1));
    setDraftRig(null);
    setCommittedRig(prev.rig);
    setKeyframes(prev.keyframes);
    setRecordedSamples(prev.recordedSamples);
    setSelectedKeyframeId(null);
  }, [historyPast, committedRig, keyframes, recordedSamples]);

  const handleRedo = useCallback(() => {
    if (historyFuture.length === 0) return;
    const next = historyFuture[0];
    setHistoryPast((p) => [
      ...p,
      { rig: committedRig, keyframes, recordedSamples },
    ]);
    setHistoryFuture((f) => f.slice(1));
    setDraftRig(null);
    setCommittedRig(next.rig);
    setKeyframes(next.keyframes);
    setRecordedSamples(next.recordedSamples);
    setSelectedKeyframeId(null);
  }, [historyFuture, committedRig, keyframes, recordedSamples]);

  // Microphone Live Lip-Sync Toggle
  const handleToggleMic = useCallback(async () => {
    if (micActive) {
      audioCleanupRef.current?.();
      audioCleanupRef.current = null;
      setMicActive(false);
      setMicMouthLevel(null);
      return;
    }

    setMicError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('مرورگر فعلی دسترسی به میکروفون را پشتیبانی نمی‌کند.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.65;
      source.connect(analyser);

      const timeData = new Uint8Array(analyser.fftSize);
      let active = true;
      let raf = 0;

      const sampleMic = () => {
        if (!active) return;
        analyser.getByteTimeDomainData(timeData);
        let sumSq = 0;
        for (let i = 0; i < timeData.length; i++) {
          const norm = (timeData[i] - 128) / 128;
          sumSq += norm * norm;
        }
        const rms = Math.sqrt(sumSq / timeData.length);
        const level = rms < 0.018 ? 0 : Math.min(1.35, (rms - 0.018) * 9.5);
        setMicMouthLevel(level);
        raf = requestAnimationFrame(sampleMic);
      };

      raf = requestAnimationFrame(sampleMic);
      setMicActive(true);

      audioCleanupRef.current = () => {
        active = false;
        cancelAnimationFrame(raf);
        stream.getTracks().forEach((tr) => tr.stop());
        audioCtx.close().catch(() => {});
      };
    } catch {
      setMicError('دسترسی به میکروفون مجاز نشد یا میکروفونی یافت نشد.');
      setMicActive(false);
    }
  }, [micActive]);

  useEffect(() => {
    return () => {
      audioCleanupRef.current?.();
    };
  }, []);

  // Global Keyboard Shortcuts (Space push-to-talk, Delete keyframe, Undo/Redo, Paste Image)
  useEffect(() => {
    const isTypingInField = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        el.isContentEditable
      );
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingInField(e.target)) return;

      if (e.code === 'Space') {
        e.preventDefault();
        setIsLiveTalkHeld(true);
      } else if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        selectedKeyframeId &&
        toolMode !== 'pen_mouth'
      ) {
        e.preventDefault();
        handleDeleteKeyframe(selectedKeyframeId);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsLiveTalkHeld(false);
      }
    };

    const onPaste = (e: ClipboardEvent) => {
      if (isTypingInField(e.target)) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const blob = items[i].getAsFile();
          if (blob) {
            e.preventDefault();
            handleLoadUploadedFile(blob);
            break;
          }
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('paste', onPaste);
    };
  }, [
    handleUndo,
    handleRedo,
    handleLoadUploadedFile,
    selectedKeyframeId,
    handleDeleteKeyframe,
    toolMode,
  ]);

  const hasCustomEdits =
    Object.keys(liveJointOffsets).length > 0 ||
    keyframes.length > 0 ||
    recordedSamples.length > 0;

  return (
    <div className="min-h-screen lg:h-screen flex flex-col bg-studio-950 text-slate-100 lg:overflow-hidden">
      {/* Hidden Global File Picker */}
      <input
        ref={hiddenFileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            handleLoadUploadedFile(f);
            e.target.value = '';
          }
        }}
        className="sr-only"
      />

      {/* Top Studio Header */}
      <HeaderBar
        onUploadClick={() => hiddenFileInputRef.current?.click()}
        onOpenCropModal={() => setIsCropModalOpen(true)}
        isCropActive={isCropActive}
        onQuickRemoveBg={handleApplyRemoveBg}
        canUndo={historyPast.length > 0}
        canRedo={historyFuture.length > 0}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onResetAll={handleResetAllPose}
        onOpenExportModal={() => setIsExportModalOpen(true)}
        hasCustomEdits={hasCustomEdits}
      />

      {/* Main 3-Column Studio Workspace */}
      <main className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-y-auto lg:overflow-hidden">
        {/* Right Column (in RTL): Upload, Crop, Cutout, Rig & Stage */}
        <CharacterRigPanel
          activeSampleId={activeSampleId}
          sampleThumbnails={sampleThumbnails}
          hasTransparency={cutoutBuffer.hasTransparency}
          bgRemovedActive={bgRemovedActive}
          bgTolerance={bgTolerance}
          onChangeBgTolerance={setBgTolerance}
          onApplyRemoveBg={handleApplyRemoveBg}
          onRestoreOriginalImage={handleRestoreOriginalImage}
          onSelectSample={handleSelectSample}
          onUploadFile={handleLoadUploadedFile}
          onOpenCropModal={() => setIsCropModalOpen(true)}
          isCropActive={isCropActive}
          onResetCrop={handleResetCrop}
          rig={activeRig}
          onChangeRigMode={handleChangeRigMode}
          onAutoResetRig={handleAutoResetRig}
          toolMode={toolMode}
          onChangeToolMode={setToolMode}
          selectedJointId={selectedJointId}
          onToggleJointPinned={handleToggleJointPinned}
          onDeleteCustomJoint={handleDeleteCustomJoint}
          onUpdateMouthSize={handleUpdateMouthSize}
          onUpdateMouthParts={handleUpdateMouthParts}
          stageSettings={stageSettings}
          onUpdateStageSettings={(patch) =>
            setStageSettings((prev) => ({ ...prev, ...patch }))
          }
        />

        {/* Center Column: Interactive 60 FPS Stage + Multi-Track Visual Timeline */}
        <section className="flex-1 flex flex-col min-w-0 min-h-[480px] lg:min-h-0">
          <StageViewport
            imgW={finalImageBuffer.width}
            imgH={finalImageBuffer.height}
            meshRenderer={meshRendererRef.current}
            mesh={mesh}
            rig={activeRig}
            animSettings={animSettings}
            stageSettings={stageSettings}
            onUpdateStageSettings={(patch) =>
              setStageSettings((prev) => ({ ...prev, ...patch }))
            }
            toolMode={toolMode}
            onChangeToolMode={setToolMode}
            normTime={normTime}
            keyframes={keyframes}
            recordedSamples={recordedSamples}
            liveJointOffsets={liveJointOffsets}
            onUpdateLiveJointOffset={(jid, off) =>
              setLiveJointOffsets((prev) => ({ ...prev, [jid]: off }))
            }
            onClearLiveJointOffsets={() => setLiveJointOffsets({})}
            onFinishLiveJointDrag={handleFinishLiveJointDrag}
            liveMouthOverride={effectiveLiveMouth}
            selectedJointId={selectedJointId}
            onSelectJoint={setSelectedJointId}
            onToggleJointPinned={handleToggleJointPinned}
            onDeleteCustomJoint={handleDeleteCustomJoint}
            onAutoResetRig={handleAutoResetRig}
            onPreviewRigDraft={setDraftRig}
            onCommitRigDraft={handleCommitRigDraft}
            onAddCustomPinAt={handleAddCustomPinAt}
            onDropImageFile={handleLoadUploadedFile}
            mouthSkinColor={mouthSkinColor}
          />

          <TimelineBar
            rig={activeRig}
            isPlaying={isPlaying}
            onTogglePlay={() => {
              if (toolMode === 'setup_rig' || toolMode === 'pen_mouth') {
                setToolMode('animate');
                setIsPlaying(true);
                return;
              }
              setIsPlaying((p) => !p);
            }}
            normTime={normTime}
            onSeekNormTime={(u) => {
              setIsPlaying(false);
              setLiveJointOffsets({});
              setNormTime(u);
            }}
            animSettings={animSettings}
            onUpdateAnimSettings={(patch) =>
              setAnimSettings((prev) => ({ ...prev, ...patch }))
            }
            isRecording={isRecording}
            onToggleRecording={handleToggleRecording}
            keyframes={keyframes}
            selectedKeyframeId={selectedKeyframeId}
            onSelectKeyframe={(id) => {
              setSelectedKeyframeId(id);
              setLiveJointOffsets({});
            }}
            onMoveKeyframeTime={handleMoveKeyframeTime}
            onDeleteKeyframe={handleDeleteKeyframe}
            onAddKeyframeAtTime={handleAddKeyframeAtTime}
            onBakePresetToKeyframes={handleBakePresetToKeyframes}
            recordedSamples={recordedSamples}
            onClearCustomMotion={handleClearCustomMotion}
            isLiveTalkHeld={isLiveTalkHeld}
            onLiveTalkStart={() => setIsLiveTalkHeld(true)}
            onLiveTalkEnd={() => setIsLiveTalkHeld(false)}
          />
        </section>

        {/* Left Column (in RTL): Ready Presets, Talking & Motion Controls */}
        <AnimationPresetsPanel
          animSettings={animSettings}
          onSelectPreset={handleSelectPreset}
          onUpdateAnimSettings={(patch) =>
            setAnimSettings((prev) => ({ ...prev, ...patch }))
          }
          micActive={micActive}
          micError={micError}
          onToggleMic={handleToggleMic}
          toolMode={toolMode}
          onToggleMouthSetupMode={() =>
            setToolMode((m) => (m === 'setup_rig' ? 'animate' : 'setup_rig'))
          }
          onTogglePenMouthMode={() =>
            setToolMode((m) => (m === 'pen_mouth' ? 'animate' : 'pen_mouth'))
          }
          hasCustomMouth={Boolean(activeRig.mouth.customPath)}
        />
      </main>

      {/* Interactive Image Crop & Rotate Modal */}
      <ImageCropModal
        isOpen={isCropModalOpen}
        onClose={() => setIsCropModalOpen(false)}
        sourceImage={originalSourceImage}
        initialSpec={cropSpec}
        onApplyCrop={handleApplyCrop}
        onResetCrop={handleResetCrop}
      />

      {/* GIF Export Studio Modal */}
      <GifExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        rgba={finalImageBuffer.rgba}
        imgW={finalImageBuffer.width}
        imgH={finalImageBuffer.height}
        mesh={mesh}
        rig={committedRig}
        animSettings={animSettings}
        stageSettings={stageSettings}
        keyframes={keyframes}
        recordedSamples={recordedSamples}
      />

      {/* Non-intrusive Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-48 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-indigo-950/95 border border-indigo-400/50 text-xs font-semibold text-indigo-100 shadow-xl backdrop-blur">
          {toastMessage}
        </div>
      )}
    </div>
  );
};

export default App;
