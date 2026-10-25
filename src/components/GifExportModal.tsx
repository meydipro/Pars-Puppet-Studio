import React, { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Download,
  Film,
  Loader2,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react';
import { GifExportResult, renderAndExportGif } from '../engine/gifExporter';
import {
  AnimationSettings,
  KeyframePoint,
  PuppetMesh,
  PuppetRig,
  RecordedSample,
  StageSettings,
} from '../engine/types';

interface GifExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  rgba: Uint8ClampedArray;
  imgW: number;
  imgH: number;
  mesh: PuppetMesh;
  rig: PuppetRig;
  animSettings: AnimationSettings;
  stageSettings: StageSettings;
  keyframes: KeyframePoint[];
  recordedSamples: RecordedSample[];
}

type AspectPreset = '1:1' | '4:5' | '16:9' | 'auto';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const GifExportModal: React.FC<GifExportModalProps> = ({
  isOpen,
  onClose,
  rgba,
  imgW,
  imgH,
  mesh,
  rig,
  animSettings,
  stageSettings,
  keyframes,
  recordedSamples,
}) => {
  const [baseRes, setBaseRes] = useState<360 | 512 | 720>(512);
  const [aspect, setAspect] = useState<AspectPreset>('1:1');
  const [fps, setFps] = useState<number>(20);
  const [transparent, setTransparent] = useState<boolean>(
    stageSettings.backgroundStyle === 'transparent'
  );
  const [dither, setDither] = useState<boolean>(false);
  const [pingPong, setPingPong] = useState<boolean>(animSettings.pingPong);

  const [isGenerating, setIsGenerating] = useState(false);
  const [phase, setPhase] = useState<'rendering' | 'encoding'>('rendering');
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<GifExportResult | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  // Sync transparent default when modal opens
  useEffect(() => {
    if (isOpen) {
      setTransparent(stageSettings.backgroundStyle === 'transparent');
      setPingPong(animSettings.pingPong);
      setErrorMsg(null);
    } else {
      abortRef.current?.abort();
    }
  }, [isOpen, stageSettings.backgroundStyle, animSettings.pingPong]);

  // Cleanup blob URL on unmount or re-render
  useEffect(() => {
    return () => {
      if (result?.url) {
        URL.revokeObjectURL(result.url);
      }
    };
  }, [result]);

  if (!isOpen) return null;

  // Calculate exact pixel dimensions
  let outW: number = baseRes;
  let outH: number = baseRes;
  if (aspect === '4:5') {
    outW = Math.round(baseRes * 0.8);
    outH = baseRes;
  } else if (aspect === '16:9') {
    outW = baseRes;
    outH = Math.round((baseRes * 9) / 16);
  } else if (aspect === 'auto') {
    const ratio = imgW / Math.max(1, imgH);
    if (ratio >= 1) {
      outW = baseRes;
      outH = Math.max(160, Math.round(baseRes / ratio));
    } else {
      outH = baseRes;
      outW = Math.max(160, Math.round(baseRes * ratio));
    }
  }
  // Ensure even dimensions
  outW = outW - (outW % 2);
  outH = outH - (outH % 2);

  const effectiveDuration =
    animSettings.duration / Math.max(0.2, animSettings.speed);
  const baseFrames = Math.max(6, Math.round(effectiveDuration * fps));
  const estFrames = pingPong ? baseFrames * 2 - 2 : baseFrames;

  const handleGenerate = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (result?.url) {
      URL.revokeObjectURL(result.url);
      setResult(null);
    }

    setIsGenerating(true);
    setErrorMsg(null);
    setPhase('rendering');
    setProgress(0);

    try {
      const exported = await renderAndExportGif({
        rgba,
        imgW,
        imgH,
        mesh,
        rig,
        animSettings,
        stageSettings,
        keyframes,
        recordedSamples,
        options: {
          width: outW,
          height: outH,
          fps,
          transparent,
          dither,
          pingPong,
          repeat: 0,
        },
        onProgress: (pPhase, frac) => {
          setPhase(pPhase);
          setProgress(frac);
        },
        signal: controller.signal,
      });

      setResult(exported);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // User canceled
      } else {
        setErrorMsg(
          err instanceof Error ? err.message : 'خطای پیش‌بینی‌نشده در تولید گیف'
        );
      }
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5">
      <div className="w-full max-w-2xl rounded-2xl bg-studio-900 border border-studio-700 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="px-5 py-3.5 border-b border-studio-700/80 flex items-center justify-between bg-studio-950/60">
          <div className="flex items-center gap-2">
            <Film className="w-5 h-5 text-indigo-400" />
            <h2 className="text-sm sm:text-base font-extrabold text-white">
              ساخت و دانلود خروجی گیف (GIF) بهینه
            </h2>
          </div>
          <button
            type="button"
            onClick={() => {
              abortRef.current?.abort();
              onClose();
            }}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-studio-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Right Column: Export Settings */}
          <div className="space-y-4">
            {/* Resolution */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-200 block">
                کیفیت و ابعاد خروجی:
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    { val: 360, label: '۳۶۰p', sub: 'استیکر سبک' },
                    { val: 512, label: '۵۱۲p', sub: 'استاندارد' },
                    { val: 720, label: '۷۲۰p', sub: 'کیفیت HD' },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.val}
                    type="button"
                    disabled={isGenerating}
                    onClick={() => setBaseRes(item.val)}
                    className={`p-2 rounded-xl border text-center transition ${
                      baseRes === item.val
                        ? 'bg-indigo-500/20 border-indigo-400 text-white'
                        : 'bg-studio-850 border-studio-700 text-slate-300 hover:bg-studio-800'
                    }`}
                  >
                    <div className="text-xs font-bold">{item.label}</div>
                    <div className="text-[10px] text-slate-400">{item.sub}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Aspect Ratio */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-200 block">
                نسبت تصویر کادر:
              </label>
              <div className="grid grid-cols-4 gap-1.5">
                {(
                  [
                    { id: '1:1', label: '۱:۱ مربع' },
                    { id: '4:5', label: '۴:۵ عمودی' },
                    { id: '16:9', label: '۱۶:۹ افقی' },
                    { id: 'auto', label: 'خودکار' },
                  ] as Array<{ id: AspectPreset; label: string }>
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    disabled={isGenerating}
                    onClick={() => setAspect(item.id)}
                    className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold border transition ${
                      aspect === item.id
                        ? 'bg-indigo-500/20 border-indigo-400 text-white'
                        : 'bg-studio-850 border-studio-700 text-slate-300 hover:bg-studio-800'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Frame Rate */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-200 block">
                نرخ فریم (نرمی حرکت در برابر حجم فایل):
              </label>
              <div className="grid grid-cols-4 gap-1.5">
                {[12, 15, 20, 25].map((val) => (
                  <button
                    key={val}
                    type="button"
                    disabled={isGenerating}
                    onClick={() => setFps(val)}
                    className={`py-1.5 rounded-lg text-xs font-mono font-semibold border transition ${
                      fps === val
                        ? 'bg-indigo-500/20 border-indigo-400 text-white'
                        : 'bg-studio-850 border-studio-700 text-slate-300 hover:bg-studio-800'
                    }`}
                  >
                    {val} FPS
                  </button>
                ))}
              </div>
            </div>

            {/* Options Switches */}
            <div className="rounded-xl bg-studio-850 border border-studio-700/80 p-3 space-y-2.5">
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <div className="text-xs font-semibold text-slate-200">
                    پس‌زمینه شفاف (Transparent GIF)
                  </div>
                  <div className="text-[10px] text-slate-400">
                    حفظ کامل رنگ‌های تیره کاراکتر بدون هاله سیاه
                  </div>
                </div>
                <input
                  type="checkbox"
                  disabled={isGenerating}
                  checked={transparent}
                  onChange={(e) => setTransparent(e.target.checked)}
                  className="w-4 h-4 rounded text-indigo-500"
                />
              </label>

              <label className="flex items-center justify-between cursor-pointer pt-1 border-t border-studio-700/60">
                <div>
                  <div className="text-xs font-semibold text-slate-200">
                    حلقه رفت‌وبرگشت (حالت بومرنگ)
                  </div>
                  <div className="text-[10px] text-slate-400">
                    چرخه کاملاً پیوسته برای حرکات غیرحلقه‌ای
                  </div>
                </div>
                <input
                  type="checkbox"
                  disabled={isGenerating}
                  checked={pingPong}
                  onChange={(e) => setPingPong(e.target.checked)}
                  className="w-4 h-4 rounded text-indigo-500"
                />
              </label>

              <label className="flex items-center justify-between cursor-pointer pt-1 border-t border-studio-700/60">
                <div>
                  <div className="text-xs font-semibold text-slate-200">
                    دیترینگ نرم رنگ‌ها (مناسب عکس واقعی)
                  </div>
                  <div className="text-[10px] text-slate-400">
                    جلوگیری از پله‌پله شدن سایه‌روشن صورت
                  </div>
                </div>
                <input
                  type="checkbox"
                  disabled={isGenerating}
                  checked={dither}
                  onChange={(e) => setDither(e.target.checked)}
                  className="w-4 h-4 rounded text-indigo-500"
                />
              </label>
            </div>

            {/* Spec Summary */}
            <div className="flex items-center justify-between text-[11px] text-slate-400 bg-studio-950/70 rounded-lg px-3 py-2 border border-studio-800">
              <span>
                ابعاد نهایی: <strong className="text-slate-200 font-mono">{outW}×{outH}</strong>
              </span>
              <span>
                تعداد فریم: <strong className="text-slate-200 font-mono">{estFrames}</strong>
              </span>
            </div>

            {/* Generate Action Button */}
            <button
              type="button"
              disabled={isGenerating}
              onClick={handleGenerate}
              className="w-full py-2.5 px-4 rounded-xl text-sm font-extrabold bg-gradient-to-l from-indigo-500 via-violet-500 to-fuchsia-500 hover:from-indigo-400 hover:to-fuchsia-400 disabled:opacity-60 text-white shadow-lg shadow-indigo-500/25 flex items-center justify-center gap-2 transition"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>
                    {phase === 'rendering'
                      ? `در حال رندر فریم‌ها (${Math.round(progress * 100)}%)`
                      : `در حال فشرده‌سازی گیف (${Math.round(progress * 100)}%)`}
                  </span>
                </>
              ) : result ? (
                <>
                  <RefreshCw className="w-4 h-4" />
                  <span>ساخت مجدد گیف با تنظیمات جدید</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>شروع رندر و ساخت فایل GIF</span>
                </>
              )}
            </button>
          </div>

          {/* Left Column: Preview & Download */}
          <div className="flex flex-col rounded-xl bg-studio-950 border border-studio-700/80 p-3.5 justify-between min-h-[280px]">
            <div className="flex-1 rounded-lg bg-checkerboard border border-studio-800 flex flex-col items-center justify-center overflow-hidden relative p-2">
              {isGenerating ? (
                <div className="w-full max-w-[220px] space-y-3 text-center">
                  <Loader2 className="w-9 h-9 text-indigo-400 animate-spin mx-auto" />
                  <div className="text-xs font-bold text-slate-200">
                    {phase === 'rendering'
                      ? 'مرحله ۱ از ۲: رندر مش و انیمیشن...'
                      : 'مرحله ۲ از ۲: رمزنگاری بهینه GIF89a...'}
                  </div>
                  <div className="w-full h-2.5 rounded-full bg-studio-800 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-l from-indigo-500 to-fuchsia-500 transition-all duration-150"
                      style={{
                        width: `${Math.round(
                          (phase === 'rendering'
                            ? progress * 0.55
                            : 0.55 + progress * 0.45) * 100
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              ) : result ? (
                <img
                  src={result.url}
                  alt="پیش‌نمایش گیف نهایی"
                  className="max-w-full max-h-[260px] object-contain rounded"
                />
              ) : (
                <div className="text-center space-y-2 px-4">
                  <Film className="w-10 h-10 text-slate-600 mx-auto" />
                  <p className="text-xs text-slate-400 leading-relaxed">
                    روی دکمه «شروع رندر و ساخت فایل GIF» بزنید تا پیش‌نمایش واقعی گیف اینجا نمایش داده شود.
                  </p>
                </div>
              )}
            </div>

            {errorMsg && (
              <div className="mt-3 p-2.5 rounded-lg bg-rose-500/15 border border-rose-500/35 text-xs text-rose-200">
                {errorMsg}
              </div>
            )}

            {result && !isGenerating && (
              <div className="mt-3 space-y-2.5">
                <div className="flex items-center justify-between text-xs bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-1.5 text-emerald-200">
                  <span className="flex items-center gap-1 font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    آماده دانلود ({result.frameCount} فریم)
                  </span>
                  <span className="font-mono font-bold">
                    {formatBytes(result.byteLength)}
                  </span>
                </div>

                <a
                  href={result.url}
                  download={`puppet-${animSettings.presetId}-${result.width}x${result.height}.gif`}
                  className="w-full py-2.5 px-4 rounded-xl text-sm font-extrabold bg-emerald-500 hover:bg-emerald-400 text-slate-950 flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 transition"
                >
                  <Download className="w-4 h-4" />
                  <span>دانلود فایل گیف (.GIF)</span>
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
