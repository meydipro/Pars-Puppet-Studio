import React, { useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Circle,
  Film,
  Pause,
  Play,
  Plus,
  Repeat,
  SkipBack,
  StepBack,
  StepForward,
  Trash2,
  Wand2,
} from 'lucide-react';
import {
  PRESET_ANIMATIONS,
  sampleTimelineCurves,
} from '../engine/rigAndAnimator';
import {
  AnimationSettings,
  KeyframePoint,
  PuppetRig,
  RecordedSample,
} from '../engine/types';

interface TimelineBarProps {
  rig: PuppetRig;
  isPlaying: boolean;
  onTogglePlay: () => void;
  normTime: number; // [0..1]
  onSeekNormTime: (u: number) => void;
  animSettings: AnimationSettings;
  onUpdateAnimSettings: (patch: Partial<AnimationSettings>) => void;

  isRecording: boolean;
  onToggleRecording: () => void;
  keyframes: KeyframePoint[];
  selectedKeyframeId: string | null;
  onSelectKeyframe: (id: string | null) => void;
  onMoveKeyframeTime: (id: string, newT: number) => void;
  onDeleteKeyframe: (id: string) => void;
  onAddKeyframeAtTime: (t: number) => void;
  onBakePresetToKeyframes: () => void;

  recordedSamples: RecordedSample[];
  onClearCustomMotion: () => void;

  isLiveTalkHeld: boolean;
  onLiveTalkStart: () => void;
  onLiveTalkEnd: () => void;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function buildSvgAreaPath(values: number[], height = 28): string {
  if (values.length === 0) return '';
  const n = values.length;
  let d = `M 0 ${height}`;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 1000;
    const y = height - clamp(values[i], 0, 1) * (height - 4) - 2;
    d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  d += ` L 1000 ${height} Z`;
  return d;
}

function buildSvgStrokePath(values: number[], height = 28): string {
  if (values.length === 0) return '';
  const n = values.length;
  let d = '';
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 1000;
    const y = height - clamp(values[i], 0, 1) * (height - 4) - 2;
    d += `${i === 0 ? 'M' : ' L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
}

export const TimelineBar: React.FC<TimelineBarProps> = ({
  rig,
  isPlaying,
  onTogglePlay,
  normTime,
  onSeekNormTime,
  animSettings,
  onUpdateAnimSettings,
  isRecording,
  onToggleRecording,
  keyframes,
  selectedKeyframeId,
  onSelectKeyframe,
  onMoveKeyframeTime,
  onDeleteKeyframe,
  onAddKeyframeAtTime,
  onBakePresetToKeyframes,
  recordedSamples,
  onClearCustomMotion,
  isLiveTalkHeld,
  onLiveTalkStart,
  onLiveTalkEnd,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const trackAreaRef = useRef<HTMLDivElement | null>(null);

  const scrubStateRef = useRef<{
    mode: 'playhead' | 'keyframe';
    keyframeId?: string;
  } | null>(null);

  const effectiveDuration = Math.max(
    0.35,
    animSettings.duration / Math.max(0.2, animSettings.speed)
  );
  const totalFrames = Math.max(6, Math.round(effectiveDuration * animSettings.fps));
  const currentFrame = Math.min(
    totalFrames,
    Math.floor(normTime * totalFrames) + 1
  );
  const currentSec = normTime * effectiveDuration;

  const presetMeta = PRESET_ANIMATIONS.find(
    (p) => p.id === animSettings.presetId
  );

  // Sample real-time body & mouth curves for visual timeline tracks
  const { bodyCurve, mouthCurve } = useMemo(
    () =>
      sampleTimelineCurves(
        rig,
        animSettings,
        keyframes,
        recordedSamples,
        64
      ),
    [rig, animSettings, keyframes, recordedSamples]
  );

  const bodyAreaD = useMemo(() => buildSvgAreaPath(bodyCurve, 28), [bodyCurve]);
  const bodyLineD = useMemo(
    () => buildSvgStrokePath(bodyCurve, 28),
    [bodyCurve]
  );
  const mouthAreaD = useMemo(
    () => buildSvgAreaPath(mouthCurve, 28),
    [mouthCurve]
  );
  const mouthLineD = useMemo(
    () => buildSvgStrokePath(mouthCurve, 28),
    [mouthCurve]
  );

  const clientXToNormT = (clientX: number): number => {
    const el = trackAreaRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 0.999);
  };

  const handleTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubStateRef.current = { mode: 'playhead' };
    onSeekNormTime(clientXToNormT(e.clientX));
  };

  const handleTrackPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = scrubStateRef.current;
    if (!st) return;
    const u = clientXToNormT(e.clientX);
    if (st.mode === 'playhead') {
      onSeekNormTime(u);
    } else if (st.mode === 'keyframe' && st.keyframeId) {
      onMoveKeyframeTime(st.keyframeId, u);
      onSeekNormTime(u);
    }
  };

  const handleTrackPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (scrubStateRef.current) {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      scrubStateRef.current = null;
    }
  };

  const stepFrame = (delta: number) => {
    const nextF =
      (((currentFrame - 1 + delta) % totalFrames) + totalFrames) % totalFrames;
    onSeekNormTime(nextF / totalFrames);
  };

  // Generate ruler tick marks (8 intervals = 9 labels across 0%..100%)
  const rulerTicks = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1.0];

  const sortedKeyframes = useMemo(
    () => [...keyframes].sort((a, b) => a.t - b.t),
    [keyframes]
  );

  return (
    <section className="shrink-0 bg-studio-900 border-t-2 border-indigo-500/35 select-none flex flex-col z-20 shadow-[0_-8px_24px_rgba(0,0,0,0.45)]">
      {/* Top Transport & Keyframe Action Bar */}
      <div className="px-3 py-2 bg-studio-950/80 border-b border-studio-700/80 flex flex-wrap items-center justify-between gap-2">
        {/* Right Side (in RTL): Title + Transport + Frame/Time Counter */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setIsExpanded((v) => !v)}
            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-200 border border-indigo-500/30 text-xs font-extrabold transition"
            title={isExpanded ? 'جمع کردن لایه‌های تایم‌لاین' : 'باز کردن لایه‌های تایم‌لاین'}
          >
            <Film className="w-3.5 h-3.5 text-indigo-400" />
            <span>تایم‌لاین</span>
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronUp className="w-3.5 h-3.5" />
            )}
          </button>

          {/* Transport Group (LTR ordering inside media buttons for standard player arrows) */}
          <div
            dir="ltr"
            className="inline-flex items-center bg-studio-900 rounded-xl border border-studio-700 p-0.5 gap-0.5"
          >
            <button
              type="button"
              onClick={() => onSeekNormTime(0)}
              className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-studio-800 transition"
              title="رفتن به ابتدای تایم‌لاین (فریم ۱)"
            >
              <SkipBack className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => stepFrame(-1)}
              className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-studio-800 transition"
              title="یک فریم عقب‌تر"
            >
              <StepBack className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onTogglePlay}
              className="w-8 h-8 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white flex items-center justify-center shadow shadow-indigo-500/30 transition"
              title={isPlaying ? 'توقف پخش' : 'پخش انیمیشن'}
            >
              {isPlaying ? (
                <Pause className="w-4 h-4 fill-current" />
              ) : (
                <Play className="w-4 h-4 fill-current ml-0.5" />
              )}
            </button>
            <button
              type="button"
              onClick={() => stepFrame(1)}
              className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-studio-800 transition"
              title="یک فریم جلوتر"
            >
              <StepForward className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Frame & Timecode Readout */}
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-studio-900 border border-studio-700 text-[11px]">
            <span className="font-bold text-amber-300">
              فریم {currentFrame} از {totalFrames}
            </span>
            <span className="text-studio-600">|</span>
            <span dir="ltr" className="font-mono text-slate-200">
              {currentSec.toFixed(2)}s / {effectiveDuration.toFixed(2)}s
            </span>
          </div>

          {/* Live Record & Push-to-Talk */}
          <button
            type="button"
            onClick={onToggleRecording}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition ${
              isRecording
                ? 'bg-rose-500 text-white border-rose-400 animate-pulse shadow shadow-rose-500/30'
                : 'bg-studio-850 hover:bg-studio-800 text-rose-300 border-rose-500/30'
            }`}
            title="ضبط زنده حرکات ماوس و دهان روی لایه ضبط تایم‌لاین"
          >
            <Circle className="w-3 h-3 fill-current" />
            <span>{isRecording ? 'توقف ضبط' : 'ضبط زنده'}</span>
          </button>

          <button
            type="button"
            onMouseDown={onLiveTalkStart}
            onMouseUp={onLiveTalkEnd}
            onMouseLeave={onLiveTalkEnd}
            onTouchStart={(e) => {
              e.preventDefault();
              onLiveTalkStart();
            }}
            onTouchEnd={onLiveTalkEnd}
            className={`hidden sm:inline-flex px-2.5 py-1.5 rounded-lg text-xs font-semibold border select-none transition ${
              isLiveTalkHeld
                ? 'bg-fuchsia-500 text-white border-fuchsia-300 scale-95'
                : 'bg-studio-850 hover:bg-studio-800 text-fuchsia-200 border-fuchsia-500/30'
            }`}
          >
            🗣️ صحبت دستی (Space)
          </button>
        </div>

        {/* Left Side (in RTL): Keyframe Editing + FPS + Duration */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => onAddKeyframeAtTime(normTime)}
            className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 border border-amber-500/35 flex items-center gap-1 transition"
            title="ثبت ژست فعلی کاراکتر به عنوان کی‌فریم در این لحظه"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>ثبت کی‌فریم</span>
          </button>

          {animSettings.presetId !== 'custom_only' && (
            <button
              type="button"
              onClick={onBakePresetToKeyframes}
              className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-sky-500/15 hover:bg-sky-500/25 text-sky-200 border border-sky-500/35 flex items-center gap-1 transition"
              title="تبدیل انیمیشن آماده فعلی به ۸ کی‌فریم قابل جابجایی روی تایم‌لاین"
            >
              <Wand2 className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">تبدیل به کی‌فریم قابل ویرایش</span>
              <span className="xl:hidden">تبدیل به کی‌فریم</span>
            </button>
          )}

          {selectedKeyframeId && (
            <button
              type="button"
              onClick={() => onDeleteKeyframe(selectedKeyframeId)}
              className="px-2 py-1.5 rounded-lg text-[11px] font-semibold bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/40 flex items-center gap-1 transition"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>حذف کی‌فریم</span>
            </button>
          )}

          {(keyframes.length > 0 || recordedSamples.length > 0) && (
            <button
              type="button"
              onClick={onClearCustomMotion}
              className="px-2 py-1.5 rounded-lg text-[11px] font-medium bg-studio-850 hover:bg-rose-500/15 text-slate-300 hover:text-rose-200 border border-studio-700 transition"
              title="پاک‌سازی تمام کی‌فریم‌ها و ضبط‌های دستی"
            >
              پاک‌سازی همه
            </button>
          )}

          <button
            type="button"
            onClick={() =>
              onUpdateAnimSettings({ pingPong: !animSettings.pingPong })
            }
            className={`px-2 py-1.5 rounded-lg text-[11px] font-semibold border flex items-center gap-1 transition ${
              animSettings.pingPong
                ? 'bg-indigo-500/25 border-indigo-400 text-indigo-200'
                : 'bg-studio-850 border-studio-700 text-slate-400 hover:text-slate-200'
            }`}
            title="پخش رفت‌وبرگشت (بومرنگ)"
          >
            <Repeat className="w-3.5 h-3.5" />
          </button>

          <select
            value={animSettings.fps}
            onChange={(e) =>
              onUpdateAnimSettings({ fps: Number(e.target.value) })
            }
            className="rounded-lg bg-studio-900 border border-studio-700 text-[11px] font-mono text-slate-200 px-1.5 py-1.5 focus:outline-none"
            title="نرخ فریم تایم‌لاین"
          >
            <option value={12}>12 FPS</option>
            <option value={15}>15 FPS</option>
            <option value={20}>20 FPS</option>
            <option value={24}>24 FPS</option>
            <option value={30}>30 FPS</option>
          </select>

          <select
            value={animSettings.duration}
            onChange={(e) =>
              onUpdateAnimSettings({ duration: Number(e.target.value) })
            }
            className="rounded-lg bg-studio-900 border border-studio-700 text-[11px] text-slate-200 px-2 py-1.5 focus:outline-none"
            title="مدت زمان کل چرخه"
          >
            <option value={1.2}>۱.۲ ثانیه</option>
            <option value={1.8}>۱.۸ ثانیه</option>
            <option value={2.4}>۲.۴ ثانیه</option>
            <option value={3.2}>۳.۲ ثانیه</option>
            <option value={4.5}>۴.۵ ثانیه</option>
            <option value={6.0}>۶.۰ ثانیه</option>
          </select>
        </div>
      </div>

      {/* Multi-Track Sequencer Grid */}
      {isExpanded ? (
        <div
          dir="ltr"
          className="flex items-stretch bg-studio-950/90 overflow-hidden"
        >
          {/* Left Track Headers Column */}
          <div className="w-36 sm:w-44 shrink-0 border-r border-studio-700/90 bg-studio-900/95 flex flex-col text-right" dir="rtl">
            {/* Ruler corner */}
            <div className="h-7 px-2.5 border-b border-studio-700/80 flex items-center justify-between text-[10px] font-bold text-slate-400 bg-studio-950">
              <span>لایه‌های زمان‌بندی</span>
              <span className="font-mono text-indigo-400">0s → End</span>
            </div>

            {/* Track 1 Label: Body Motion */}
            <div className="h-8 px-2.5 border-b border-studio-800 flex items-center justify-between text-[11px]">
              <span className="font-semibold text-indigo-200 truncate">
                🎬 حرکت اسکلت
              </span>
              <span className="text-[9px] text-slate-400 truncate max-w-[68px]">
                {presetMeta ? presetMeta.nameFa : 'دستی'}
              </span>
            </div>

            {/* Track 2 Label: Mouth / Lip-sync */}
            <div className="h-8 px-2.5 border-b border-studio-800 flex items-center justify-between text-[11px]">
              <span className="font-semibold text-fuchsia-200 truncate">
                👄 دهان و صدا
              </span>
              <span className="text-[9px] text-slate-400">
                {animSettings.mouthStyle === 'none' ? 'خاموش' : 'فعال'}
              </span>
            </div>

            {/* Track 3 Label: Joint Keyframes */}
            <div className="h-9 px-2.5 border-b border-studio-800 flex items-center justify-between text-[11px]">
              <span className="font-semibold text-amber-200 truncate">
                💎 کی‌فریم دستی
              </span>
              <span className="text-[10px] font-mono px-1.5 rounded bg-amber-500/15 text-amber-300">
                {keyframes.length}
              </span>
            </div>

            {/* Track 4 Label: Live Recorded Motion */}
            <div className="h-7 px-2.5 flex items-center justify-between text-[11px]">
              <span className="font-semibold text-rose-200 truncate">
                🔴 ضبط زنده
              </span>
              <span className="text-[9px] text-slate-400">
                {recordedSamples.length > 0 ? 'ضبط‌شده' : 'خالی'}
              </span>
            </div>
          </div>

          {/* Right Interactive Scrubbable Tracks Canvas */}
          <div
            ref={trackAreaRef}
            onPointerDown={handleTrackPointerDown}
            onPointerMove={handleTrackPointerMove}
            onPointerUp={handleTrackPointerUp}
            onPointerCancel={handleTrackPointerUp}
            className="relative flex-1 min-w-0 cursor-pointer touch-none"
          >
            {/* Vertical Grid Lines */}
            <div className="pointer-events-none absolute inset-0">
              {rulerTicks.map((t, idx) => (
                <div
                  key={idx}
                  style={{ left: `${t * 100}%` }}
                  className={`absolute inset-y-0 border-l ${
                    idx % 2 === 0
                      ? 'border-studio-700/65'
                      : 'border-studio-800/60'
                  }`}
                />
              ))}
            </div>

            {/* Row 0: Time & Frame Ruler */}
            <div className="relative h-7 border-b border-studio-700/80 bg-studio-950/95 overflow-hidden">
              {rulerTicks.map((t, idx) => {
                const sec = (t * effectiveDuration).toFixed(1);
                const fNum = Math.round(t * totalFrames);
                const alignCls =
                  idx === 0
                    ? 'translate-x-1'
                    : idx === rulerTicks.length - 1
                    ? '-translate-x-full -ml-1'
                    : '-translate-x-1/2';
                return (
                  <div
                    key={idx}
                    style={{ left: `${t * 100}%` }}
                    className={`absolute top-1 ${alignCls} flex items-center gap-1 text-[10px] font-mono pointer-events-none`}
                  >
                    <span className="text-slate-300 font-semibold">{sec}s</span>
                    {idx % 2 === 0 && (
                      <span className="hidden sm:inline text-[9px] text-slate-500">
                        (F{fNum})
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Row 1: Body Motion Curve Track */}
            <div className="relative h-8 border-b border-studio-800/90 bg-indigo-950/15 overflow-hidden">
              <svg
                viewBox="0 0 1000 28"
                preserveAspectRatio="none"
                className="w-full h-full pointer-events-none"
              >
                <path d={bodyAreaD} fill="rgba(99, 102, 241, 0.26)" />
                <path
                  d={bodyLineD}
                  fill="none"
                  stroke="#818cf8"
                  strokeWidth="2"
                />
              </svg>
            </div>

            {/* Row 2: Mouth Lip-Sync Waveform Track */}
            <div className="relative h-8 border-b border-studio-800/90 bg-fuchsia-950/15 overflow-hidden">
              <svg
                viewBox="0 0 1000 28"
                preserveAspectRatio="none"
                className="w-full h-full pointer-events-none"
              >
                <path d={mouthAreaD} fill="rgba(232, 121, 249, 0.28)" />
                <path
                  d={mouthLineD}
                  fill="none"
                  stroke="#e879f9"
                  strokeWidth="2"
                />
              </svg>
            </div>

            {/* Row 3: Interactive Draggable Keyframes Track */}
            <div
              onDoubleClick={(e) => {
                e.stopPropagation();
                const u = clientXToNormT(e.clientX);
                onAddKeyframeAtTime(u);
              }}
              className="relative h-9 border-b border-studio-800/90 bg-amber-950/10 flex items-center"
              title="دوبار کلیک کنید تا در همین نقطه کی‌فریم جدید ساخته شود"
            >
              {sortedKeyframes.length === 0 && (
                <span
                  dir="rtl"
                  className="pointer-events-none mx-auto text-[10px] text-slate-500"
                >
                  دوبار کلیک روی این نوار یا زدن «+ ثبت کی‌فریم» برای افزودن نقطه حرکتی جدید
                </span>
              )}

              {/* Connecting span bar between keyframes */}
              {sortedKeyframes.length >= 2 && (
                <div
                  style={{
                    left: `${sortedKeyframes[0].t * 100}%`,
                    width: `${
                      (sortedKeyframes[sortedKeyframes.length - 1].t -
                        sortedKeyframes[0].t) *
                      100
                    }%`,
                  }}
                  className="pointer-events-none absolute h-1.5 rounded-full bg-amber-400/25 border-y border-amber-400/40"
                />
              )}

              {/* Draggable Keyframe Diamonds */}
              {sortedKeyframes.map((kf) => {
                const isSel = selectedKeyframeId === kf.id;
                return (
                  <button
                    key={kf.id}
                    type="button"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      const trackEl = trackAreaRef.current;
                      if (trackEl) {
                        trackEl.setPointerCapture(e.pointerId);
                      }
                      onSelectKeyframe(kf.id);
                      onSeekNormTime(kf.t);
                      scrubStateRef.current = {
                        mode: 'keyframe',
                        keyframeId: kf.id,
                      };
                    }}
                    style={{ left: `${kf.t * 100}%` }}
                    className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 rotate-45 transition-transform z-20 ${
                      isSel
                        ? 'bg-amber-300 border-2 border-white scale-125 shadow-[0_0_10px_rgba(251,191,36,0.9)]'
                        : 'bg-amber-500 hover:bg-amber-300 border border-slate-950 hover:scale-110'
                    }`}
                    title={`کی‌فریم در ${(kf.t * effectiveDuration).toFixed(2)}s — برای تغییر زمان بکشید`}
                  />
                );
              })}
            </div>

            {/* Row 4: Live Recorded Motion Track */}
            <div className="relative h-7 bg-rose-950/10 flex items-center overflow-hidden">
              {isRecording ? (
                <div
                  style={{ width: `${normTime * 100}%` }}
                  className="h-3.5 bg-rose-500/50 border-r-2 border-rose-300 animate-pulse"
                />
              ) : recordedSamples.length > 0 ? (
                <div className="inset-x-1 absolute h-3.5 rounded bg-gradient-to-r from-rose-500/35 via-fuchsia-500/35 to-rose-500/35 border border-rose-400/40 flex items-center justify-center">
                  <span className="text-[9px] font-semibold text-rose-200">
                    حرکت ضبط‌شده زنده فعال ({recordedSamples.length} نمونه)
                  </span>
                </div>
              ) : (
                <span
                  dir="rtl"
                  className="pointer-events-none mx-auto text-[10px] text-slate-600"
                >
                  آماده ضبط زنده حرکات ماوس و صحبت
                </span>
              )}
            </div>

            {/* Full-Height Glowing Vertical Playhead */}
            <div
              style={{ left: `${normTime * 100}%` }}
              className="pointer-events-none absolute inset-y-0 z-30 -translate-x-1/2 flex flex-col items-center"
            >
              {/* Playhead Cap */}
              <div className="px-1.5 h-4 rounded-b bg-cyan-400 text-slate-950 text-[9px] font-mono font-extrabold flex items-center justify-center shadow-md whitespace-nowrap">
                F{currentFrame}
              </div>
              {/* Playhead Line */}
              <div className="w-0.5 flex-1 bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.85)]" />
            </div>
          </div>
        </div>
      ) : (
        /* Compact Scrubber Mode (when collapsed) */
        <div className="px-4 py-1.5 bg-studio-950 flex items-center" dir="ltr">
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round(normTime * 1000)}
            onChange={(e) => onSeekNormTime(Number(e.target.value) / 1000)}
            className="w-full"
          />
        </div>
      )}
    </section>
  );
};
