import React from 'react';
import {
  Crop,
  Download,
  RotateCcw,
  Sparkles,
  Undo2,
  Redo2,
  Upload,
  Wand2,
} from 'lucide-react';

interface HeaderBarProps {
  onUploadClick: () => void;
  onOpenCropModal: () => void;
  isCropActive: boolean;
  onQuickRemoveBg: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onResetAll: () => void;
  onOpenExportModal: () => void;
  hasCustomEdits: boolean;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  onUploadClick,
  onOpenCropModal,
  isCropActive,
  onQuickRemoveBg,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onResetAll,
  onOpenExportModal,
  hasCustomEdits,
}) => {
  return (
    <header className="h-14 shrink-0 border-b border-studio-700/80 bg-studio-900/95 backdrop-blur-md px-3 sm:px-5 flex items-center justify-between gap-2 z-20">
      {/* Brand */}
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-indigo-500/25 shrink-0">
          <Sparkles className="w-5 h-5 text-white" />
        </div>
        <div className="truncate">
          <div className="flex items-center gap-2">
            <h1 className="text-sm sm:text-base font-extrabold tracking-tight text-white truncate">
              پاپت‌استودیو
            </h1>
            <span className="hidden md:inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
              موتور مش دوبعدی + خروجی GIF
            </span>
          </div>
          <p className="hidden sm:block text-[11px] text-slate-400 truncate">
            ساخت انیمیشن عروسکی، حرف زدن کاراکتر و خروجی گیف بهینه از هر عکس
          </p>
        </div>
      </div>

      {/* Center / Action Controls */}
      <div className="flex items-center gap-1.5 sm:gap-2">
        <button
          type="button"
          onClick={onUploadClick}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-studio-800 hover:bg-studio-700 text-slate-100 border border-studio-600/80 transition-colors"
          title="آپلود تصویر کاراکتر (PNG, JPG, WebP)"
        >
          <Upload className="w-3.5 h-3.5 text-indigo-400" />
          <span>آپلود عکس</span>
        </button>

        <button
          type="button"
          onClick={onOpenCropModal}
          className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
            isCropActive
              ? 'bg-sky-500/20 border-sky-400/60 text-sky-200 hover:bg-sky-500/30'
              : 'bg-studio-800 hover:bg-studio-700 text-sky-300 border-sky-500/30'
          }`}
          title="برش، کراپ، چرخش و قرینه کردن تصویر کاراکتر"
        >
          <Crop className="w-3.5 h-3.5" />
          <span>کراپ عکس</span>
        </button>

        <button
          type="button"
          onClick={onQuickRemoveBg}
          className="hidden lg:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-studio-800/80 hover:bg-studio-700 text-emerald-300 border border-emerald-500/25 transition-colors"
          title="حذف هوشمند پس‌زمینه یکدست عکس"
        >
          <Wand2 className="w-3.5 h-3.5" />
          <span>حذف پس‌زمینه</span>
        </button>

        <div className="hidden sm:flex items-center bg-studio-850 rounded-lg border border-studio-700/80 p-0.5">
          <button
            type="button"
            disabled={!canUndo}
            onClick={onUndo}
            className="p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-studio-700 disabled:opacity-35 disabled:pointer-events-none transition"
            title="بازگشت (Ctrl+Z)"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            disabled={!canRedo}
            onClick={onRedo}
            className="p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-studio-700 disabled:opacity-35 disabled:pointer-events-none transition"
            title="انجام مجدد (Ctrl+Y)"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>

        <button
          type="button"
          onClick={onResetAll}
          className={`p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg text-xs font-medium border transition-colors inline-flex items-center gap-1 ${
            hasCustomEdits
              ? 'bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20'
              : 'bg-studio-800/60 border-studio-700 text-slate-400 hover:text-slate-200 hover:bg-studio-700'
          }`}
          title="ریست ژست و تغییرات دستی"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span className="hidden xl:inline">ریست حالت</span>
        </button>

        <button
          type="button"
          onClick={onOpenExportModal}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-bold bg-gradient-to-l from-indigo-500 via-violet-500 to-fuchsia-500 hover:from-indigo-400 hover:to-fuchsia-400 text-white shadow-md shadow-indigo-500/25 transition-all active:scale-95"
        >
          <Download className="w-4 h-4" />
          <span>خروجی گیف (GIF)</span>
        </button>
      </div>
    </header>
  );
};
