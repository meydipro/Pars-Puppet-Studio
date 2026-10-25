import React, { useState } from 'react';
import {
  Crosshair,
  MessageSquare,
  Mic,
  MicOff,
  PenTool,
  Sliders,
  Sparkles,
  Volume2,
} from 'lucide-react';
import { PRESET_ANIMATIONS } from '../engine/rigAndAnimator';
import {
  AnimationSettings,
  MouthStyle,
  PresetAnimationId,
  PresetCategory,
  ViewportToolMode,
} from '../engine/types';

interface AnimationPresetsPanelProps {
  animSettings: AnimationSettings;
  onSelectPreset: (presetId: PresetAnimationId) => void;
  onUpdateAnimSettings: (patch: Partial<AnimationSettings>) => void;
  micActive: boolean;
  micError: string | null;
  onToggleMic: () => void;
  toolMode: ViewportToolMode;
  onToggleMouthSetupMode: () => void;
  onTogglePenMouthMode: () => void;
  hasCustomMouth: boolean;
}

export const AnimationPresetsPanel: React.FC<AnimationPresetsPanelProps> = ({
  animSettings,
  onSelectPreset,
  onUpdateAnimSettings,
  micActive,
  micError,
  onToggleMic,
  toolMode,
  onToggleMouthSetupMode,
  onTogglePenMouthMode,
  hasCustomMouth,
}) => {
  const [category, setCategory] = useState<PresetCategory>('all');

  const filteredPresets =
    category === 'all'
      ? PRESET_ANIMATIONS
      : PRESET_ANIMATIONS.filter((p) => p.category === category);

  return (
    <aside className="w-full lg:w-80 shrink-0 bg-studio-900 border-t lg:border-t-0 lg:border-r border-studio-700/80 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-3.5 py-2.5 border-b border-studio-700/80 bg-studio-950/50 flex items-center justify-between shrink-0">
        <span className="text-xs font-extrabold text-slate-100 flex items-center gap-1.5">
          <Sparkles className="w-4 h-4 text-indigo-400" />
          انیمیشن‌های آماده و حرف زدن
        </span>
        <span className="text-[10px] text-slate-400">
          {PRESET_ANIMATIONS.length} حالت
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-3.5 space-y-4">
        {/* Category Filter Pills */}
        <div className="grid grid-cols-4 gap-1 bg-studio-950 p-1 rounded-xl border border-studio-700/70">
          {(
            [
              { id: 'all', label: 'همه' },
              { id: 'talking', label: 'حرف زدن' },
              { id: 'action', label: 'حرکتی' },
              { id: 'reaction', label: 'واکنشی' },
            ] as Array<{ id: PresetCategory; label: string }>
          ).map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setCategory(cat.id)}
              className={`py-1.5 rounded-lg text-[11px] font-semibold transition ${
                category === cat.id
                  ? 'bg-indigo-500 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Presets Grid */}
        <div className="grid grid-cols-2 gap-2">
          {filteredPresets.map((preset) => {
            const active = animSettings.presetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => onSelectPreset(preset.id)}
                className={`p-2.5 rounded-xl border text-right transition-all flex flex-col justify-between ${
                  active
                    ? 'bg-indigo-500/20 border-indigo-400 shadow-sm shadow-indigo-500/15'
                    : 'bg-studio-850 hover:bg-studio-800 border-studio-700/80'
                }`}
              >
                <div className="flex items-center justify-between gap-1 mb-1">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: preset.badgeColor }}
                  />
                  {preset.involvesTalking && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-fuchsia-500/15 text-fuchsia-300 border border-fuchsia-500/25">
                      گفتگو
                    </span>
                  )}
                </div>
                <div className="text-xs font-bold text-slate-100 leading-snug">
                  {preset.nameFa}
                </div>
                <div className="text-[10px] text-slate-400 mt-1 leading-tight line-clamp-2">
                  {preset.subtitleFa}
                </div>
              </button>
            );
          })}

          {/* Pure Custom Animation Mode */}
          <button
            type="button"
            onClick={() => onSelectPreset('custom_only')}
            className={`p-2.5 rounded-xl border text-right transition-all flex flex-col justify-between ${
              animSettings.presetId === 'custom_only'
                ? 'bg-amber-500/20 border-amber-400'
                : 'bg-studio-850 hover:bg-studio-800 border-studio-700/80'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">
                دستی
              </span>
            </div>
            <div className="text-xs font-bold text-slate-100">فقط دستی / ضبط</div>
            <div className="text-[10px] text-slate-400 mt-1 leading-tight">
              ساخت انیمیشن کاملاً شخصی با ماوس یا کی‌فریم
            </div>
          </button>
        </div>

        {/* Talking & Lip-Sync Controls */}
        <div className="rounded-xl bg-studio-850 border border-studio-700/80 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-fuchsia-200 flex items-center gap-1.5">
              <Volume2 className="w-3.5 h-3.5 text-fuchsia-400" />
              تنظیمات حرف زدن و دهان
            </span>
            <button
              type="button"
              onClick={onToggleMic}
              className={`px-2 py-1 rounded-lg text-[10px] font-semibold flex items-center gap-1 border transition ${
                micActive
                  ? 'bg-rose-500/25 border-rose-400 text-rose-200 animate-pulse'
                  : 'bg-studio-900 border-studio-700 text-slate-300 hover:bg-studio-800'
              }`}
              title="حرکت زنده دهان با صدای میکروفون شما"
            >
              {micActive ? (
                <>
                  <Mic className="w-3 h-3 text-rose-400" />
                  <span>میکروفون فعال</span>
                </>
              ) : (
                <>
                  <MicOff className="w-3 h-3" />
                  <span>لب‌خوانی با صدا</span>
                </>
              )}
            </button>
          </div>

          {micError && (
            <div className="text-[10px] text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-lg px-2 py-1">
              {micError}
            </div>
          )}

          {/* Mouth Style */}
          <div className="space-y-1">
            <span className="text-[11px] text-slate-400 block">
              سبک متحرک‌سازی دهان روی عکس:
            </span>
            <select
              value={animSettings.mouthStyle}
              onChange={(e) =>
                onUpdateAnimSettings({ mouthStyle: e.target.value as MouthStyle })
              }
              className="w-full rounded-lg bg-studio-900 border border-studio-700 text-xs text-slate-100 px-2.5 py-2 focus:outline-none focus:border-indigo-400"
            >
              <option value="cutout_jaw">
                فک لولایی + دهان باز داخلی (واضح روی هر عکس)
              </option>
              <option value="mesh_jaw">
                نرمش طبیعی فک و لب خود عکس (بدون ترسیم دهان)
              </option>
              <option value="cartoon_viseme">
                دهان کارتونی متحرک (مناسب استیکر و اشیاء)
              </option>
              <option value="none">غیرفعال (فقط حرکت بدن و سر)</option>
            </select>
          </div>

          {animSettings.mouthStyle !== 'none' && (
            <div className="space-y-1.5">
              <button
                type="button"
                onClick={onTogglePenMouthMode}
                className={`w-full py-2 px-2.5 rounded-lg text-[11px] font-bold border flex items-center justify-center gap-1.5 transition ${
                  toolMode === 'pen_mouth'
                    ? 'bg-fuchsia-500 text-white border-fuchsia-300 shadow'
                    : 'bg-fuchsia-500/15 hover:bg-fuchsia-500/25 text-fuchsia-200 border-fuchsia-500/35'
                }`}
              >
                <PenTool className="w-3.5 h-3.5" />
                <span>
                  {toolMode === 'pen_mouth'
                    ? 'پایان ابزار Pen و پخش انیمیشن'
                    : hasCustomMouth
                    ? 'ویرایش دهان ناهموار با ابزار Pen ✓'
                    : 'ابزار Pen (رسم دستی دهان کج/ناهموار)'}
                </span>
              </button>

              <button
                type="button"
                onClick={onToggleMouthSetupMode}
                className={`w-full py-1.5 px-2.5 rounded-lg text-[11px] font-semibold border flex items-center justify-center gap-1.5 transition ${
                  toolMode === 'setup_rig'
                    ? 'bg-sky-500 text-slate-950 border-sky-300 font-bold'
                    : 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-200 border-rose-500/30'
                }`}
              >
                <Crosshair className="w-3.5 h-3.5" />
                <span>
                  {toolMode === 'setup_rig'
                    ? 'تایید مکان دهان و پخش انیمیشن'
                    : 'جابجایی کلی دهان و پین‌ها'}
                </span>
              </button>
            </div>
          )}

          {/* Combine Talking with any body animation */}
          <label className="flex items-center justify-between cursor-pointer pt-0.5">
            <span className="text-[11px] text-slate-300">
              ترکیب حرف زدن روی هر انیمیشن حرکتی
            </span>
            <input
              type="checkbox"
              checked={animSettings.talkOverlay}
              onChange={(e) =>
                onUpdateAnimSettings({ talkOverlay: e.target.checked })
              }
              className="w-4 h-4 rounded text-indigo-500"
            />
          </label>

          {/* Optional Dialogue Text + Comic Bubble */}
          <div className="space-y-2 pt-1.5 border-t border-studio-700/70">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-300 flex items-center gap-1">
                <MessageSquare className="w-3 h-3 text-indigo-400" />
                متن دیالوگ (تنظیم ریتم لب‌خوانی):
              </span>
            </div>
            <input
              type="text"
              dir="rtl"
              placeholder="مثلاً: سلام بچه‌ها! چطورید؟"
              value={animSettings.dialogueText}
              onChange={(e) =>
                onUpdateAnimSettings({ dialogueText: e.target.value })
              }
              className="w-full rounded-lg bg-studio-900 border border-studio-700 text-xs text-slate-100 placeholder:text-slate-500 px-2.5 py-1.5 focus:outline-none focus:border-indigo-400"
            />

            {animSettings.dialogueText.trim().length > 0 && (
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={animSettings.showSpeechBubble}
                    onChange={(e) =>
                      onUpdateAnimSettings({
                        showSpeechBubble: e.target.checked,
                      })
                    }
                    className="rounded text-indigo-500"
                  />
                  <span>نمایش حباب کمیک در گیف</span>
                </label>

                {animSettings.showSpeechBubble && (
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateAnimSettings({
                        speechBubblePos:
                          animSettings.speechBubblePos === 'top-right'
                            ? 'top-left'
                            : 'top-right',
                      })
                    }
                    className="text-[10px] px-2 py-0.5 rounded bg-studio-900 border border-studio-700 text-indigo-300"
                  >
                    {animSettings.speechBubblePos === 'top-right'
                      ? 'سمت راست'
                      : 'سمت چپ'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Fine Motion Sliders */}
        <div className="rounded-xl bg-studio-850 border border-studio-700/80 p-3 space-y-3">
          <div className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
            <Sliders className="w-3.5 h-3.5 text-sky-400" />
            تنظیم دقیق سرعت و شدت حرکت
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-[11px] text-slate-400">
              <span>سرعت انیمیشن</span>
              <span className="font-mono text-slate-200">
                {animSettings.speed.toFixed(2)}x
              </span>
            </div>
            <input
              type="range"
              min={0.25}
              max={2.5}
              step={0.05}
              value={animSettings.speed}
              onChange={(e) =>
                onUpdateAnimSettings({ speed: Number(e.target.value) })
              }
              className="w-full"
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-[11px] text-slate-400">
              <span>شدت حرکات بدن و سر</span>
              <span className="font-mono text-slate-200">
                {Math.round(animSettings.bodyIntensity * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={200}
              step={5}
              value={Math.round(animSettings.bodyIntensity * 100)}
              onChange={(e) =>
                onUpdateAnimSettings({
                  bodyIntensity: Number(e.target.value) / 100,
                })
              }
              className="w-full"
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-[11px] text-slate-400">
              <span>میزان باز شدن دهان</span>
              <span className="font-mono text-slate-200">
                {Math.round(animSettings.mouthIntensity * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={200}
              step={5}
              value={Math.round(animSettings.mouthIntensity * 100)}
              onChange={(e) =>
                onUpdateAnimSettings({
                  mouthIntensity: Number(e.target.value) / 100,
                })
              }
              className="w-full"
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-[11px] text-slate-400">
              <span>نرمی و فنریت (Squash & Stretch)</span>
              <span className="font-mono text-slate-200">
                {Math.round(animSettings.springiness * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={200}
              step={5}
              value={Math.round(animSettings.springiness * 100)}
              onChange={(e) =>
                onUpdateAnimSettings({
                  springiness: Number(e.target.value) / 100,
                })
              }
              className="w-full"
            />
          </div>
        </div>
      </div>
    </aside>
  );
};
