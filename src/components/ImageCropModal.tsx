import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Crop,
  FlipHorizontal,
  FlipVertical,
  Maximize2,
  RotateCcw,
  RotateCw,
  Sparkles,
  X,
} from 'lucide-react';
import {
  bufferToDataUrl,
  computeSmartSubjectCrop,
  ProcessedImageBuffer,
  transformImageOrientation,
} from '../engine/imageProcessor';
import { CropRect, ImageTransformSpec } from '../engine/types';

interface ImageCropModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceImage: ProcessedImageBuffer;
  initialSpec: ImageTransformSpec;
  onApplyCrop: (spec: ImageTransformSpec, croppedBuffer: ProcessedImageBuffer) => void;
  onResetCrop: () => void;
}

type HandleType =
  | 'move'
  | 'nw'
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w';

interface AspectOption {
  id: string;
  label: string;
  ratio: number | null; // width / height in pixels
}

const ASPECT_OPTIONS: AspectOption[] = [
  { id: 'free', label: 'آزاد', ratio: null },
  { id: '1:1', label: '۱:۱ مربع', ratio: 1 },
  { id: '3:4', label: '۳:۴ پرتره', ratio: 3 / 4 },
  { id: '4:5', label: '۴:۵ عمودی', ratio: 4 / 5 },
  { id: '9:16', label: '۹:۱۶ استوری', ratio: 9 / 16 },
  { id: '16:9', label: '۱۶:۹ افقی', ratio: 16 / 9 },
];

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export const ImageCropModal: React.FC<ImageCropModalProps> = ({
  isOpen,
  onClose,
  sourceImage,
  initialSpec,
  onApplyCrop,
  onResetCrop,
}) => {
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(
    initialSpec.rotation
  );
  const [flipH, setFlipH] = useState<boolean>(initialSpec.flipH);
  const [flipV, setFlipV] = useState<boolean>(initialSpec.flipV);
  const [crop, setCrop] = useState<CropRect>(initialSpec.crop);
  const [aspectId, setAspectId] = useState<string>('free');

  const stageWrapRef = useRef<HTMLDivElement | null>(null);
  const imgBoxRef = useRef<HTMLDivElement | null>(null);

  const dragRef = useRef<{
    handle: HandleType;
    startClientX: number;
    startClientY: number;
    startCrop: CropRect;
    boxW: number;
    boxH: number;
  } | null>(null);

  // Sync when modal opens
  useEffect(() => {
    if (isOpen) {
      setRotation(initialSpec.rotation);
      setFlipH(initialSpec.flipH);
      setFlipV(initialSpec.flipV);
      setCrop(initialSpec.crop);
      setAspectId('free');
    }
  }, [isOpen, initialSpec]);

  // Compute oriented preview buffer & DataURL
  const orientedBuffer = useMemo(() => {
    if (!isOpen) return sourceImage;
    return transformImageOrientation(sourceImage, rotation, flipH, flipV);
  }, [isOpen, sourceImage, rotation, flipH, flipV]);

  const previewUrl = useMemo(() => {
    if (!isOpen) return '';
    return bufferToDataUrl(orientedBuffer);
  }, [isOpen, orientedBuffer]);

  if (!isOpen) return null;

  const selectedAspectRatio =
    ASPECT_OPTIONS.find((a) => a.id === aspectId)?.ratio ?? null;

  // Enforce a pixel aspect ratio centered on current crop
  const applyAspectRatio = (targetPixelRatio: number | null, base = crop) => {
    if (!targetPixelRatio) return;
    // Normalized w/h ratio needed so (w * imgW) / (h * imgH) === targetPixelRatio
    const normRatio =
      targetPixelRatio * (orientedBuffer.height / Math.max(1, orientedBuffer.width));

    const cx = base.x + base.w * 0.5;
    const cy = base.y + base.h * 0.5;

    let nw = base.w;
    let nh = nw / normRatio;
    if (nh > 0.96) {
      nh = 0.92;
      nw = nh * normRatio;
    }
    if (nw > 0.96) {
      nw = 0.92;
      nh = nw / normRatio;
    }
    nw = clamp(nw, 0.08, 1);
    nh = clamp(nh, 0.08, 1);

    const nx = clamp(cx - nw * 0.5, 0, 1 - nw);
    const ny = clamp(cy - nh * 0.5, 0, 1 - nh);
    setCrop({ x: nx, y: ny, w: nw, h: nh });
  };

  const handleSelectAspect = (opt: AspectOption) => {
    setAspectId(opt.id);
    if (opt.ratio) {
      applyAspectRatio(opt.ratio);
    }
  };

  const handleSmartTrim = () => {
    const smart = computeSmartSubjectCrop(orientedBuffer, 0.035);
    setAspectId('free');
    setCrop(smart);
  };

  const handleRotate = (delta: 90 | -90) => {
    const next = (((rotation + delta) % 360) + 360) % 360 as 0 | 90 | 180 | 270;
    setRotation(next);
    setAspectId('free');
    setCrop({ x: 0.05, y: 0.05, w: 0.9, h: 0.9 });
  };

  const startHandleDrag = (
    handle: HandleType,
    e: React.PointerEvent<HTMLElement>
  ) => {
    e.stopPropagation();
    const box = imgBoxRef.current?.getBoundingClientRect();
    if (!box || box.width < 10 || box.height < 10) return;

    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      handle,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startCrop: { ...crop },
      boxW: box.width,
      boxH: box.height,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;

    const dx = (e.clientX - drag.startClientX) / drag.boxW;
    const dy = (e.clientY - drag.startClientY) / drag.boxH;
    const MIN_S = 0.06;
    const s = drag.startCrop;

    if (drag.handle === 'move') {
      setCrop({
        x: clamp(s.x + dx, 0, 1 - s.w),
        y: clamp(s.y + dy, 0, 1 - s.h),
        w: s.w,
        h: s.h,
      });
      return;
    }

    let x0 = s.x;
    let y0 = s.y;
    let x1 = s.x + s.w;
    let y1 = s.y + s.h;

    if (drag.handle.includes('w')) x0 = clamp(s.x + dx, 0, x1 - MIN_S);
    if (drag.handle.includes('e')) x1 = clamp(s.x + s.w + dx, x0 + MIN_S, 1);
    if (drag.handle.includes('n')) y0 = clamp(s.y + dy, 0, y1 - MIN_S);
    if (drag.handle.includes('s')) y1 = clamp(s.y + s.h + dy, y0 + MIN_S, 1);

    let nw = x1 - x0;
    let nh = y1 - y0;

    if (selectedAspectRatio) {
      const normRatio =
        selectedAspectRatio *
        (orientedBuffer.height / Math.max(1, orientedBuffer.width));
      if (drag.handle === 'n' || drag.handle === 's') {
        nw = clamp(nh * normRatio, MIN_S, 1);
        const cx = (x0 + x1) * 0.5;
        x0 = clamp(cx - nw * 0.5, 0, 1 - nw);
      } else {
        nh = clamp(nw / normRatio, MIN_S, 1);
        if (nh + y0 > 1) {
          nh = 1 - y0;
          nw = clamp(nh * normRatio, MIN_S, 1 - x0);
        }
        if (drag.handle.includes('n')) {
          y0 = clamp(y1 - nh, 0, 1 - nh);
        }
      }
    }

    setCrop({
      x: clamp(x0, 0, 1 - nw),
      y: clamp(y0, 0, 1 - nh),
      w: nw,
      h: nh,
    });
  };

  const handlePointerUp = () => {
    dragRef.current = null;
  };

  const outPxW = Math.max(1, Math.round(crop.w * orientedBuffer.width));
  const outPxH = Math.max(1, Math.round(crop.h * orientedBuffer.height));

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
      <div className="w-full max-w-4xl rounded-2xl bg-studio-900 border border-studio-700 shadow-2xl flex flex-col max-h-[94vh] overflow-hidden">
        {/* Header */}
        <div className="px-4 sm:px-5 py-3 border-b border-studio-700/80 bg-studio-950/70 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Crop className="w-5 h-5 text-indigo-400" />
            <div>
              <h2 className="text-sm sm:text-base font-extrabold text-white">
                برش، چرخش و کراپ دقیق تصویر کاراکتر
              </h2>
              <p className="text-[11px] text-slate-400 hidden sm:block">
                کادر دور کاراکتر را تنظیم کنید تا مش‌بندی و اسکلت دقیقاً روی سوژه اعمال شود
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-studio-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Interactive Crop Stage */}
        <div
          ref={stageWrapRef}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="flex-1 min-h-[280px] sm:min-h-[380px] bg-studio-950 flex items-center justify-center p-4 sm:p-6 overflow-hidden select-none touch-none"
        >
          <div
            ref={imgBoxRef}
            className="relative inline-block max-w-full max-h-[52vh] bg-checkerboard rounded-lg shadow-2xl border border-studio-700"
          >
            <img
              src={previewUrl}
              alt="پیش‌نمایش کراپ"
              draggable={false}
              className="block max-w-full max-h-[52vh] w-auto h-auto object-contain pointer-events-none select-none"
            />

            {/* 4-Side Darkened Mask Outside Crop Rect */}
            <div
              className="absolute inset-x-0 top-0 bg-black/65 pointer-events-none"
              style={{ height: `${crop.y * 100}%` }}
            />
            <div
              className="absolute inset-x-0 bottom-0 bg-black/65 pointer-events-none"
              style={{ height: `${Math.max(0, (1 - crop.y - crop.h) * 100)}%` }}
            />
            <div
              className="absolute left-0 bg-black/65 pointer-events-none"
              style={{
                top: `${crop.y * 100}%`,
                height: `${crop.h * 100}%`,
                width: `${crop.x * 100}%`,
              }}
            />
            <div
              className="absolute right-0 bg-black/65 pointer-events-none"
              style={{
                top: `${crop.y * 100}%`,
                height: `${crop.h * 100}%`,
                width: `${Math.max(0, (1 - crop.x - crop.w) * 100)}%`,
              }}
            />

            {/* Active Draggable Crop Box */}
            <div
              onPointerDown={(e) => startHandleDrag('move', e)}
              style={{
                left: `${crop.x * 100}%`,
                top: `${crop.y * 100}%`,
                width: `${crop.w * 100}%`,
                height: `${crop.h * 100}%`,
              }}
              className="absolute border-2 border-indigo-400 shadow-[0_0_0_1px_rgba(255,255,255,0.45)] cursor-move"
            >
              {/* Rule of Thirds Grid */}
              <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none">
                <div className="border-r border-b border-white/25" />
                <div className="border-r border-b border-white/25" />
                <div className="border-b border-white/25" />
                <div className="border-r border-b border-white/25" />
                <div className="border-r border-b border-white/25" />
                <div className="border-b border-white/25" />
                <div className="border-r border-white/25" />
                <div className="border-r border-white/25" />
                <div />
              </div>

              {/* Dimensions Pill */}
              <div
                dir="ltr"
                className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded bg-indigo-600 text-[10px] font-mono font-bold text-white whitespace-nowrap shadow"
              >
                {outPxW} × {outPxH} px
              </div>

              {/* 8 Resize Handles */}
              {(
                [
                  { h: 'nw', cls: '-top-2 -left-2 cursor-nwse-resize' },
                  { h: 'n', cls: '-top-2 left-1/2 -translate-x-1/2 cursor-ns-resize' },
                  { h: 'ne', cls: '-top-2 -right-2 cursor-nesw-resize' },
                  { h: 'e', cls: 'top-1/2 -right-2 -translate-y-1/2 cursor-ew-resize' },
                  { h: 'se', cls: '-bottom-2 -right-2 cursor-nwse-resize' },
                  { h: 's', cls: '-bottom-2 left-1/2 -translate-x-1/2 cursor-ns-resize' },
                  { h: 'sw', cls: '-bottom-2 -left-2 cursor-nesw-resize' },
                  { h: 'w', cls: 'top-1/2 -left-2 -translate-y-1/2 cursor-ew-resize' },
                ] as Array<{ h: HandleType; cls: string }>
              ).map(({ h, cls }) => (
                <div
                  key={h}
                  onPointerDown={(e) => startHandleDrag(h, e)}
                  className={`absolute w-4 h-4 rounded-full bg-white border-2 border-indigo-600 shadow-md hover:scale-125 transition-transform ${cls}`}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Bottom Controls Toolbar */}
        <div className="p-4 border-t border-studio-700/80 bg-studio-900 space-y-3">
          {/* Aspect Ratio + Transform Row */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* Aspect Presets */}
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[11px] text-slate-400 ml-1">نسبت برش:</span>
              {ASPECT_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleSelectAspect(opt)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition ${
                    aspectId === opt.id
                      ? 'bg-indigo-500 text-white border-indigo-400'
                      : 'bg-studio-850 text-slate-300 border-studio-700 hover:bg-studio-800'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Smart Trim + Rotate & Flip */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={handleSmartTrim}
                className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200 border border-emerald-500/35 flex items-center gap-1 transition"
                title="تشخیص خودکار محدوده کاراکتر و حذف حاشیه‌های اضافه"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>کراپ هوشمند دور سوژه</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setAspectId('free');
                  setCrop({ x: 0, y: 0, w: 1, h: 1 });
                }}
                className="p-1.5 rounded-lg bg-studio-850 hover:bg-studio-800 text-slate-300 border border-studio-700"
                title="انتخاب کل کادر"
              >
                <Maximize2 className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => handleRotate(-90)}
                className="p-1.5 rounded-lg bg-studio-850 hover:bg-studio-800 text-slate-300 border border-studio-700"
                title="چرخش ۹۰ درجه به چپ"
              >
                <RotateCcw className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => handleRotate(90)}
                className="p-1.5 rounded-lg bg-studio-850 hover:bg-studio-800 text-slate-300 border border-studio-700"
                title="چرخش ۹۰ درجه به راست"
              >
                <RotateCw className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => setFlipH((v) => !v)}
                className={`p-1.5 rounded-lg border transition ${
                  flipH
                    ? 'bg-indigo-500/25 border-indigo-400 text-indigo-200'
                    : 'bg-studio-850 hover:bg-studio-800 text-slate-300 border-studio-700'
                }`}
                title="قرینه افقی (آینه‌ای)"
              >
                <FlipHorizontal className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => setFlipV((v) => !v)}
                className={`p-1.5 rounded-lg border transition ${
                  flipV
                    ? 'bg-indigo-500/25 border-indigo-400 text-indigo-200'
                    : 'bg-studio-850 hover:bg-studio-800 text-slate-300 border-studio-700'
                }`}
                title="قرینه عمودی"
              >
                <FlipVertical className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Action Footer */}
          <div className="flex items-center justify-between pt-2 border-t border-studio-800">
            <button
              type="button"
              onClick={() => {
                onResetCrop();
                onClose();
              }}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-amber-300 hover:bg-amber-500/10 border border-amber-500/30 transition"
            >
              بازنشانی به تصویر کامل اصلی
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-studio-800 hover:bg-studio-700 text-slate-300 transition"
              >
                انصراف
              </button>
              <button
                type="button"
                onClick={() => {
                  onApplyCrop(
                    { rotation, flipH, flipV, crop },
                    orientedBuffer
                  );
                  onClose();
                }}
                className="px-4 py-2 rounded-xl text-xs sm:text-sm font-extrabold bg-gradient-to-l from-indigo-500 to-fuchsia-500 hover:from-indigo-400 hover:to-fuchsia-400 text-white shadow-lg shadow-indigo-500/25 flex items-center gap-1.5 transition"
              >
                <Check className="w-4 h-4" />
                <span>اعمال کراپ روی کاراکتر</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
