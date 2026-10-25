import React, { useState } from 'react';
import {
  Crop,
  Crosshair,
  Eraser,
  Image as ImageIcon,
  Layers,
  PenTool,
  Pin,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
  UserCheck,
  Wand2,
} from 'lucide-react';
import { SAMPLE_CHARACTERS, SampleCharacterMeta } from '../engine/sampleCharacters';
import {
  BackgroundStyle,
  PuppetRig,
  RigMode,
  StageSettings,
  ViewportToolMode,
} from '../engine/types';

interface CharacterRigPanelProps {
  activeSampleId: string | null;
  sampleThumbnails: Record<string, string>;
  hasTransparency: boolean;
  bgRemovedActive: boolean;
  bgTolerance: number;
  onChangeBgTolerance: (val: number) => void;
  onApplyRemoveBg: () => void;
  onRestoreOriginalImage: () => void;
  onSelectSample: (sample: SampleCharacterMeta) => void;
  onUploadFile: (file: File) => void;
  onOpenCropModal: () => void;
  isCropActive: boolean;
  onResetCrop: () => void;

  rig: PuppetRig;
  onChangeRigMode: (mode: RigMode) => void;
  onAutoResetRig: () => void;
  toolMode: ViewportToolMode;
  onChangeToolMode: (mode: ViewportToolMode) => void;
  selectedJointId: string | null;
  onToggleJointPinned: (jointId: string) => void;
  onDeleteCustomJoint: (jointId: string) => void;
  onUpdateMouthSize: (rx: number, ry: number) => void;
  onUpdateMouthParts: (patch: {
    showTongue?: boolean;
    showTeeth?: boolean;
    arch?: number;
  }) => void;

  stageSettings: StageSettings;
  onUpdateStageSettings: (patch: Partial<StageSettings>) => void;
}

export const CharacterRigPanel: React.FC<CharacterRigPanelProps> = ({
  activeSampleId,
  sampleThumbnails,
  hasTransparency,
  bgRemovedActive,
  bgTolerance,
  onChangeBgTolerance,
  onApplyRemoveBg,
  onRestoreOriginalImage,
  onSelectSample,
  onUploadFile,
  onOpenCropModal,
  isCropActive,
  onResetCrop,
  rig,
  onChangeRigMode,
  onAutoResetRig,
  toolMode,
  onChangeToolMode,
  selectedJointId,
  onToggleJointPinned,
  onDeleteCustomJoint,
  onUpdateMouthSize,
  onUpdateMouthParts,
  stageSettings,
  onUpdateStageSettings,
}) => {
  const [activeTab, setActiveTab] = useState<'character' | 'rig' | 'stage'>('character');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onUploadFile(file);
      e.target.value = '';
    }
  };

  const selectedJoint = rig.joints.find((j) => j.id === selectedJointId) || null;

  return (
    <aside className="w-full lg:w-80 shrink-0 bg-studio-900 border-b lg:border-b-0 lg:border-l border-studio-700/80 flex flex-col overflow-hidden">
      {/* Sub-navigation Tabs */}
      <div className="grid grid-cols-3 border-b border-studio-700/80 bg-studio-950/50 p-1 gap-1 shrink-0">
        <button
          type="button"
          onClick={() => setActiveTab('character')}
          className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition ${
            activeTab === 'character'
              ? 'bg-indigo-500/20 text-indigo-200 border border-indigo-500/40'
              : 'text-slate-400 hover:text-slate-200 hover:bg-studio-800/60'
          }`}
        >
          <ImageIcon className="w-3.5 h-3.5" />
          <span>کاراکتر</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('rig')}
          className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition ${
            activeTab === 'rig'
              ? 'bg-indigo-500/20 text-indigo-200 border border-indigo-500/40'
              : 'text-slate-400 hover:text-slate-200 hover:bg-studio-800/60'
          }`}
        >
          <Crosshair className="w-3.5 h-3.5" />
          <span>مفاصل و دهان</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('stage')}
          className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition ${
            activeTab === 'stage'
              ? 'bg-indigo-500/20 text-indigo-200 border border-indigo-500/40'
              : 'text-slate-400 hover:text-slate-200 hover:bg-studio-800/60'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>پس‌زمینه</span>
        </button>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-4">
        {activeTab === 'character' && (
          <>
            {/* Upload Box */}
            <label className="group relative flex flex-col items-center justify-center p-4 rounded-xl border-2 border-dashed border-indigo-500/40 hover:border-indigo-400 bg-indigo-500/5 hover:bg-indigo-500/10 cursor-pointer transition-all text-center">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
                onChange={handleFileChange}
                className="sr-only"
              />
              <div className="w-10 h-10 rounded-full bg-indigo-500/20 group-hover:bg-indigo-500/30 flex items-center justify-center mb-2 transition">
                <Upload className="w-5 h-5 text-indigo-300" />
              </div>
              <span className="text-xs font-bold text-slate-100">
                آپلود عکس کاراکتر شما
              </span>
              <span className="text-[11px] text-slate-400 mt-1">
                PNG شفاف، JPG یا WebP (یا رها کردن روی صفحه / Ctrl+V)
              </span>
            </label>

            {/* Image Crop & Rotate Card */}
            <div className="rounded-xl bg-studio-850 border border-studio-700/80 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Crop className="w-3.5 h-3.5 text-sky-400" />
                  برش، کراپ و چرخش تصویر
                </span>
                {isCropActive && (
                  <button
                    type="button"
                    onClick={onResetCrop}
                    className="text-[11px] text-amber-300 hover:text-amber-200 flex items-center gap-1"
                  >
                    <RotateCcw className="w-3 h-3" />
                    لغو کراپ
                  </button>
                )}
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                کادر دلخواه یا کراپ هوشمند دور کاراکتر، چرخش ۹۰ درجه و قرینه کردن عکس.
              </p>
              <button
                type="button"
                onClick={onOpenCropModal}
                className="w-full py-2 px-3 rounded-lg text-xs font-semibold bg-sky-500/15 hover:bg-sky-500/25 text-sky-200 border border-sky-500/35 flex items-center justify-center gap-1.5 transition"
              >
                <Crop className="w-3.5 h-3.5" />
                <span>
                  {isCropActive ? 'ویرایش مجدد کراپ تصویر' : 'باز کردن ابزار کراپ تصویر'}
                </span>
              </button>
            </div>

            {/* Smart Background Remover Card */}
            <div className="rounded-xl bg-studio-850 border border-studio-700/80 p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Wand2 className="w-3.5 h-3.5 text-emerald-400" />
                  برش هوشمند پس‌زمینه عکس
                </span>
                {bgRemovedActive && (
                  <button
                    type="button"
                    onClick={onRestoreOriginalImage}
                    className="text-[11px] text-amber-300 hover:text-amber-200 flex items-center gap-1"
                  >
                    <RotateCcw className="w-3 h-3" />
                    عکس اصلی
                  </button>
                )}
              </div>

              {!hasTransparency && !bgRemovedActive && (
                <p className="text-[11px] leading-relaxed text-amber-200/90 bg-amber-500/10 border border-amber-500/25 rounded-lg px-2.5 py-1.5">
                  این تصویر پس‌زمینه یکدست دارد. برای حرکت تمیز دست‌وپا، دکمه حذف پس‌زمینه را بزنید:
                </p>
              )}

              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span>حساسیت تشخیص رنگ حاشیه</span>
                  <span className="font-mono text-slate-200">{bgTolerance}</span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={95}
                  value={bgTolerance}
                  onChange={(e) => onChangeBgTolerance(Number(e.target.value))}
                  className="w-full"
                />
              </div>

              <button
                type="button"
                onClick={onApplyRemoveBg}
                className="w-full py-2 px-3 rounded-lg text-xs font-semibold bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200 border border-emerald-500/35 flex items-center justify-center gap-1.5 transition"
              >
                <Eraser className="w-3.5 h-3.5" />
                <span>
                  {bgRemovedActive ? 'به‌روزرسانی حذف پس‌زمینه' : 'حذف خودکار پس‌زمینه سفید/تک‌رنگ'}
                </span>
              </button>
            </div>

            {/* Custom Pen Mouth & Smile Curve Quick Card */}
            <div className="rounded-xl bg-studio-850 border border-fuchsia-500/30 p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-fuchsia-200 flex items-center gap-1.5">
                  <PenTool className="w-3.5 h-3.5 text-fuchsia-400" />
                  تنظیم خط دهان منحنی و ابزار Pen
                </span>
                {rig.mouth.customPath ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-semibold">
                    Pen فعال ✓
                  </span>
                ) : (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 font-semibold">
                    کمان طبیعی
                  </span>
                )}
              </div>

              {!rig.mouth.customPath && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] text-slate-300">
                    <span>انحنای خط لب (لبخند / اخم)</span>
                    <span className="font-mono text-sky-300">
                      {Math.round((rig.mouth.arch ?? 0.16) * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={-80}
                    max={80}
                    step={2}
                    value={Math.round((rig.mouth.arch ?? 0.16) * 100)}
                    onChange={(e) =>
                      onUpdateMouthParts({ arch: Number(e.target.value) / 100 })
                    }
                    className="w-full"
                  />
                </div>
              )}

              <p className="text-[11px] text-slate-400 leading-relaxed">
                برای دهان‌های کج یا نامتقارن، با ابزار Pen از گوشه چپ تا راست دقیقاً روی خط لب نقطه بگذارید.
              </p>
              <button
                type="button"
                onClick={() =>
                  onChangeToolMode(
                    toolMode === 'pen_mouth' ? 'animate' : 'pen_mouth'
                  )
                }
                className={`w-full py-2 px-3 rounded-lg text-xs font-bold border flex items-center justify-center gap-1.5 transition ${
                  toolMode === 'pen_mouth'
                    ? 'bg-fuchsia-500 text-white border-fuchsia-300 shadow'
                    : 'bg-fuchsia-500/15 hover:bg-fuchsia-500/25 text-fuchsia-200 border-fuchsia-500/35'
                }`}
              >
                <PenTool className="w-3.5 h-3.5" />
                <span>
                  {toolMode === 'pen_mouth'
                    ? 'پایان رسم Pen و پخش انیمیشن'
                    : rig.mouth.customPath
                    ? 'ویرایش خط دهان با ابزار Pen'
                    : 'رسم دقیق خط دهان با ابزار Pen'}
                </span>
              </button>
            </div>

            {/* Ready Sample Characters */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300">
                  کاراکترهای نمونه آماده تست
                </span>
                <span className="text-[10px] text-slate-500">شفاف و ریگ‌شده</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {SAMPLE_CHARACTERS.map((sc) => {
                  const active = activeSampleId === sc.id;
                  return (
                    <button
                      key={sc.id}
                      type="button"
                      onClick={() => onSelectSample(sc)}
                      className={`group rounded-xl p-2 border text-right transition-all flex items-center gap-2 ${
                        active
                          ? 'bg-indigo-500/15 border-indigo-400 shadow-sm'
                          : 'bg-studio-850 hover:bg-studio-800 border-studio-700/80'
                      }`}
                    >
                      <div className="w-11 h-11 rounded-lg bg-checkerboard shrink-0 overflow-hidden flex items-center justify-center border border-studio-700">
                        {sampleThumbnails[sc.id] ? (
                          <img
                            src={sampleThumbnails[sc.id]}
                            alt={sc.nameFa}
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <UserCheck className="w-5 h-5 text-slate-400" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-slate-100 truncate">
                          {sc.nameFa}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          {sc.tagFa}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {activeTab === 'rig' && (
          <>
            {/* Setup Mode Quick Switch */}
            <div className="rounded-xl bg-studio-850 border border-studio-700/80 p-3 space-y-2.5">
              <div className="text-xs font-bold text-slate-200">
                حالت کار روی بوم
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={() => onChangeToolMode('animate')}
                  className={`py-2 px-1.5 rounded-lg text-[11px] font-semibold border transition ${
                    toolMode === 'animate'
                      ? 'bg-indigo-500 text-white border-indigo-400'
                      : 'bg-studio-900 text-slate-300 border-studio-700 hover:bg-studio-800'
                  }`}
                >
                  انیمیشن
                </button>
                <button
                  type="button"
                  onClick={() => onChangeToolMode('setup_rig')}
                  className={`py-2 px-1.5 rounded-lg text-[11px] font-semibold border transition ${
                    toolMode === 'setup_rig'
                      ? 'bg-sky-500 text-slate-950 border-sky-300 font-bold'
                      : 'bg-studio-900 text-slate-300 border-studio-700 hover:bg-studio-800'
                  }`}
                >
                  پین و دهان
                </button>
                <button
                  type="button"
                  onClick={() => onChangeToolMode('pen_mouth')}
                  className={`py-2 px-1.5 rounded-lg text-[11px] font-semibold border transition ${
                    toolMode === 'pen_mouth'
                      ? 'bg-fuchsia-500 text-white border-fuchsia-300 font-bold'
                      : 'bg-studio-900 text-fuchsia-200 border-fuchsia-500/35 hover:bg-fuchsia-500/15'
                  }`}
                >
                  Pen دهان
                </button>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                {toolMode === 'pen_mouth'
                  ? 'دور دهان کج یا ناهموار کاراکتر نقطه بگذارید و روی نقطه سبز اول ببندید تا فک دقیقاً طبق شکل لب باز شود!'
                  : toolMode === 'setup_rig'
                  ? 'در این حالت دهان یا پین‌ها را روی دست و سر و پا قرار دهید.'
                  : 'در این حالت انیمیشن پخش می‌شود و می‌توانید با ماوس دست و سر کاراکتر را زنده حرکت دهید!'}
              </p>
            </div>

            {/* Rig Mode Selector */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <span>نوع اسکلت پاپت</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-200 font-semibold">
                    {rig.joints.length} پین فعال
                  </span>
                </span>
                <button
                  type="button"
                  onClick={onAutoResetRig}
                  className="text-[11px] text-indigo-300 hover:text-indigo-200 flex items-center gap-1"
                >
                  <RotateCcw className="w-3 h-3" />
                  جای‌گذاری خودکار
                </button>
              </div>

              <div className="space-y-1.5">
                {(
                  [
                    {
                      id: 'fullBody',
                      title: 'اسکلت کامل بدن (۱۸ پین کنترل‌شده)',
                      desc: 'دارای آرنج، زانو، شانه، پا و مهار سر برای حرکت کاملاً طبیعی',
                    },
                    {
                      id: 'portrait',
                      title: 'چهره و نیم‌تنه (۱۴ پین مهاری پرتره)',
                      desc: 'دارای قفل دنده و پایین کادر + شقیقه و پیشانی بدون کشیدگی چهره',
                    },
                    {
                      id: 'customPins',
                      title: 'پین‌گذاری آزاد عروسکی (۱۲ پین پایه + آزاد)',
                      desc: 'پین‌های پایه مهاری + امکان افزودن پین دلخواه با کلیک روی عکس',
                    },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onChangeRigMode(item.id)}
                    className={`w-full text-right p-2.5 rounded-xl border transition ${
                      rig.mode === item.id
                        ? 'bg-indigo-500/15 border-indigo-400 text-white'
                        : 'bg-studio-850 border-studio-700/80 text-slate-300 hover:bg-studio-800'
                    }`}
                  >
                    <div className="text-xs font-bold">{item.title}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">{item.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Mouth Gizmo Fine Controls */}
            <div className="rounded-xl bg-studio-850 border border-studio-700/80 p-3 space-y-3">
              <div className="flex items-center justify-between gap-1">
                <span className="text-xs font-bold text-rose-300">
                  تنظیم ناحیه دهان و فک
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      onChangeToolMode(
                        toolMode === 'pen_mouth' ? 'animate' : 'pen_mouth'
                      )
                    }
                    className={`text-[11px] px-2 py-0.5 rounded border flex items-center gap-1 ${
                      toolMode === 'pen_mouth'
                        ? 'bg-fuchsia-500 text-white border-fuchsia-300 font-bold'
                        : 'bg-fuchsia-500/15 text-fuchsia-200 border-fuchsia-500/35 hover:bg-fuchsia-500/25'
                    }`}
                  >
                    <PenTool className="w-3 h-3" />
                    <span>ابزار Pen</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onChangeToolMode(
                        toolMode === 'setup_rig' ? 'animate' : 'setup_rig'
                      )
                    }
                    className="text-[11px] px-2 py-0.5 rounded bg-rose-500/15 text-rose-200 border border-rose-500/30"
                  >
                    {toolMode === 'setup_rig' ? 'تایید' : 'جابجایی'}
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span>پهنای دهان</span>
                  <span>{Math.round(rig.mouth.rx * 200)}%</span>
                </div>
                <input
                  type="range"
                  min={3}
                  max={22}
                  step={0.5}
                  value={rig.mouth.rx * 100}
                  onChange={(e) =>
                    onUpdateMouthSize(Number(e.target.value) / 100, rig.mouth.ry)
                  }
                  className="w-full"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span>ارتفاع بازشدگی فک</span>
                  <span>{Math.round(rig.mouth.ry * 200)}%</span>
                </div>
                <input
                  type="range"
                  min={2}
                  max={15}
                  step={0.5}
                  value={rig.mouth.ry * 100}
                  onChange={(e) =>
                    onUpdateMouthSize(rig.mouth.rx, Number(e.target.value) / 100)
                  }
                  className="w-full"
                />
              </div>

              {!rig.mouth.customPath && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] text-slate-400">
                    <span>انحنای خط لب (لبخند / اخم)</span>
                    <span className="font-mono text-sky-300">
                      {Math.round((rig.mouth.arch ?? 0.16) * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={-80}
                    max={80}
                    step={2}
                    value={Math.round((rig.mouth.arch ?? 0.16) * 100)}
                    onChange={(e) =>
                      onUpdateMouthParts({
                        arch: Number(e.target.value) / 100,
                      })
                    }
                    className="w-full"
                  />
                </div>
              )}

              <div className="flex items-center gap-3 pt-1">
                <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rig.mouth.showTeeth}
                    onChange={(e) =>
                      onUpdateMouthParts({ showTeeth: e.target.checked })
                    }
                    className="rounded border-studio-600 bg-studio-900 text-indigo-500"
                  />
                  <span>نمایش دندان</span>
                </label>

                <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rig.mouth.showTongue}
                    onChange={(e) =>
                      onUpdateMouthParts({ showTongue: e.target.checked })
                    }
                    className="rounded border-studio-600 bg-studio-900 text-indigo-500"
                  />
                  <span>نمایش زبان</span>
                </label>
              </div>
            </div>

            {/* Selected Pin Inspector */}
            {selectedJoint && (
              <div className="rounded-xl bg-studio-850 border border-indigo-500/35 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-indigo-200">
                    پین انتخاب‌شده: {selectedJoint.nameFa}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onToggleJointPinned(selectedJoint.id)}
                    className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-semibold border flex items-center justify-center gap-1 transition ${
                      selectedJoint.pinned
                        ? 'bg-rose-500/20 border-rose-500/40 text-rose-200'
                        : 'bg-studio-900 border-studio-700 text-slate-300 hover:bg-studio-800'
                    }`}
                  >
                    <Pin className="w-3.5 h-3.5" />
                    <span>{selectedJoint.pinned ? 'پین میخ‌شده (ثابت)' : 'تبدیل به پین ثابت'}</span>
                  </button>

                  {rig.mode === 'customPins' && rig.joints.length > 2 && (
                    <button
                      type="button"
                      onClick={() => onDeleteCustomJoint(selectedJoint.id)}
                      className="p-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30"
                      title="حذف این پین"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            )}

            {rig.mode === 'customPins' && toolMode === 'setup_rig' && (
              <div className="rounded-lg bg-sky-500/10 border border-sky-500/30 p-2.5 text-[11px] text-sky-200 flex items-start gap-2">
                <Plus className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  روی هر بخش از عکس در صفحه کلیک کنید تا پین جدید اضافه شود. برای ثابت کردن پایه کاراکتر، گزینه «پین ثابت» را فعال کنید.
                </span>
              </div>
            )}
          </>
        )}

        {activeTab === 'stage' && (
          <>
            {/* Background Style */}
            <div className="space-y-2">
              <div className="text-xs font-bold text-slate-200">
                پس‌زمینه صحنه و گیف
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { id: 'transparent', label: 'شفاف (استیکر GIF)' },
                    { id: 'solid', label: 'تک‌رنگ دلخواه' },
                    { id: 'gradient_indigo', label: 'گرادیان شب بنفش' },
                    { id: 'gradient_sunset', label: 'گرادیان غروب' },
                    { id: 'gradient_mint', label: 'گرادیان روشن نعنایی' },
                    { id: 'green_screen', label: 'پرده سبز (کروماکی)' },
                  ] as Array<{ id: BackgroundStyle; label: string }>
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() =>
                      onUpdateStageSettings({ backgroundStyle: item.id })
                    }
                    className={`p-2.5 rounded-xl text-xs font-semibold border text-right transition ${
                      stageSettings.backgroundStyle === item.id
                        ? 'bg-indigo-500/20 border-indigo-400 text-white'
                        : 'bg-studio-850 border-studio-700/80 text-slate-300 hover:bg-studio-800'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {stageSettings.backgroundStyle === 'solid' && (
                <div className="flex items-center justify-between pt-2">
                  <span className="text-xs text-slate-300">انتخاب رنگ پس‌زمینه:</span>
                  <input
                    type="color"
                    value={stageSettings.solidColor}
                    onChange={(e) =>
                      onUpdateStageSettings({ solidColor: e.target.value })
                    }
                    className="w-10 h-8 rounded cursor-pointer bg-transparent border-0"
                  />
                </div>
              )}
            </div>

            {/* Sticker White Outline */}
            <div className="rounded-xl bg-studio-850 border border-studio-700/80 p-3 space-y-3">
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <div className="text-xs font-bold text-slate-200">
                    حاشیه دور کاراکتر (استیکری)
                  </div>
                  <div className="text-[10px] text-slate-400">
                    عالی برای گیف‌های شفاف تلگرام و واتساپ
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={stageSettings.stickerOutline}
                  onChange={(e) =>
                    onUpdateStageSettings({ stickerOutline: e.target.checked })
                  }
                  className="w-4 h-4 rounded text-indigo-500"
                />
              </label>

              {stageSettings.stickerOutline && (
                <div className="space-y-2.5 pt-1 border-t border-studio-700/70">
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>ضخامت خط دور</span>
                      <span>{stageSettings.stickerWidth}px</span>
                    </div>
                    <input
                      type="range"
                      min={2}
                      max={14}
                      value={stageSettings.stickerWidth}
                      onChange={(e) =>
                        onUpdateStageSettings({
                          stickerWidth: Number(e.target.value),
                        })
                      }
                      className="w-full"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-slate-400">رنگ حاشیه:</span>
                    <input
                      type="color"
                      value={stageSettings.stickerColor}
                      onChange={(e) =>
                        onUpdateStageSettings({ stickerColor: e.target.value })
                      }
                      className="w-8 h-6 rounded cursor-pointer bg-transparent"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Character Scale & Ground Shadow */}
            <div className="rounded-xl bg-studio-850 border border-studio-700/80 p-3 space-y-3">
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-slate-300">
                  <span>اندازه کاراکتر در کادر</span>
                  <span>{Math.round(stageSettings.characterScale * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={50}
                  max={115}
                  value={Math.round(stageSettings.characterScale * 100)}
                  onChange={(e) =>
                    onUpdateStageSettings({
                      characterScale: Number(e.target.value) / 100,
                    })
                  }
                  className="w-full"
                />
              </div>

              <label className="flex items-center justify-between cursor-pointer pt-1">
                <span className="text-xs text-slate-300">سایه پویا زیر کاراکتر</span>
                <input
                  type="checkbox"
                  checked={stageSettings.groundShadow}
                  onChange={(e) =>
                    onUpdateStageSettings({ groundShadow: e.target.checked })
                  }
                  className="w-4 h-4 rounded text-indigo-500"
                />
              </label>
            </div>
          </>
        )}
      </div>
    </aside>
  );
};
