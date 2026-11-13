import React, { useEffect, useRef, useState } from 'react';
import { ImagePart, PartMotion } from '../engine/parts';
import { ProcessedImageBuffer } from '../engine/imageProcessor';
import { PuppetRig, Vec2 } from '../engine/types';

interface Props {
  image: ProcessedImageBuffer;
  rig: PuppetRig;
  parts: ImagePart[];
  onChange: (parts: ImagePart[]) => void;
  onClose: () => void;
}
const motions: [PartMotion, string][] = [['none', 'بدون حرکت مستقل'], ['swing', 'تاب خوردن'], ['bounce', 'بالا و پایین'], ['pulse', 'تپش'], ['flutter', 'لرزش سریع']];

export const PartsEditor: React.FC<Props> = ({ image, rig, parts, onChange, onClose }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [points, setPoints] = useState<Vec2[]>([]);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string | null>(parts[0]?.id || null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = image.width; canvas.height = image.height;
    canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height), 0, 0);
  }, [image]);
  const active = parts.find(p => p.id === selected);
  const update = (patch: Partial<ImagePart>) => onChange(parts.map(p => p.id === selected ? { ...p, ...patch } : p));
  const add = () => {
    if (points.length < 3 || parts.length >= 12) return;
    const part: ImagePart = { id: `part-${Date.now()}-${Math.random().toString(36).slice(2)}`, name: name.trim() || `جزء ${parts.length + 1}`, points, jointId: '', motion: 'swing', intensity: 1 };
    onChange([...parts, part]); setSelected(part.id); setPoints([]); setName('');
  };
  return <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label="جداسازی اجزای تصویر">
    <div className="bg-studio-900 border border-studio-700 rounded-2xl w-full max-w-5xl max-h-[95vh] overflow-y-auto p-4 space-y-3" dir="rtl">
      <div className="flex justify-between items-center"><h2 className="font-bold">جداسازی و انیمیشن اجزا</h2><button type="button" onClick={onClose} className="px-3 py-1 rounded bg-studio-700">بستن و بازگشت</button></div>
      <p className="text-xs text-slate-300">روی تصویر دور هر جزء حداقل سه نقطه بگذارید و «ساخت جزء» را بزنید. ابتدا کراپ و حذف پس‌زمینه را انجام دهید. اجزا دستی و بدون بازسازی ناحیهٔ پنهان جدا می‌شوند؛ هم‌پوشانی به جزء اول تعلق دارد. از انتخاب دهان متحرک خودداری کنید.</p>
      <div className="grid md:grid-cols-[minmax(0,1fr)_260px] gap-4">
        <div className="space-y-2">
          <div className="relative inline-block max-w-full bg-studio-950 border border-studio-700 leading-none" style={{width: image.width}}>
            <canvas ref={canvasRef} className="block w-full h-auto" />
            <svg className="absolute inset-0 w-full h-full cursor-crosshair" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label="انتخاب نقاط مرز جزء" onClick={e => { const r = e.currentTarget.getBoundingClientRect(); setPoints([...points, { x: Math.max(0, Math.min(1, (e.clientX-r.left)/r.width)), y: Math.max(0, Math.min(1, (e.clientY-r.top)/r.height)) }]); }}>
              {parts.map(p => <polygon key={p.id} points={p.points.map(v => `${v.x*1000},${v.y*1000}`).join(' ')} fill={p.id === selected ? '#818cf855' : '#22d3ee33'} stroke="#a5b4fc" strokeWidth="3" vectorEffect="non-scaling-stroke" />)}
              <polyline points={points.map(v => `${v.x*1000},${v.y*1000}`).join(' ')} fill="#fbbf2433" stroke="#fbbf24" strokeWidth="3" vectorEffect="non-scaling-stroke" />
              {points.map((p,i) => <circle key={i} cx={p.x*1000} cy={p.y*1000} r="7" fill="#fbbf24" />)}
            </svg>
          </div>
          <div className="flex flex-wrap gap-2 text-xs"><input value={name} onChange={e => setName(e.target.value)} placeholder="نام جزء (اختیاری)" className="bg-studio-950 border border-studio-700 rounded p-2" /><button type="button" disabled={points.length < 3 || parts.length >= 12} onClick={add} className="bg-indigo-600 disabled:opacity-40 rounded px-3">ساخت جزء ({points.length} نقطه)</button><button type="button" disabled={!points.length} onClick={() => setPoints(points.slice(0,-1))} className="bg-studio-700 rounded px-3 disabled:opacity-40">حذف نقطه آخر</button><button type="button" onClick={() => setPoints([])} className="bg-studio-700 rounded px-3">پاک کردن نقاط</button></div>
        </div>
        <div className="space-y-3 text-xs">
          <div className="font-bold">اجزای جداشده ({parts.length}/۱۲)</div>
          {parts.map(p => <button type="button" key={p.id} onClick={() => setSelected(p.id)} className={`block w-full text-right p-2 rounded ${p.id === selected ? 'bg-indigo-600' : 'bg-studio-800'}`}>{p.name}</button>)}
          {active && <div className="space-y-3 border border-studio-700 p-3 rounded-lg">
            <label className="block">نام جزء<input aria-label="نام جزء انتخاب‌شده" value={active.name} onChange={e => update({name:e.target.value})} className="block w-full mt-1 rounded bg-studio-950 p-2" /></label>
            <label className="block">اتصال به مفصل<select value={active.jointId} onChange={e => update({jointId:e.target.value})} className="block w-full mt-1 rounded bg-studio-950 p-2"><option value="">مستقل (مرکز جزء)</option>{active.jointId && !rig.joints.some(j => j.id === active.jointId) && <option value={active.jointId}>مفصل حذف شده (مستقل)</option>}{rig.joints.map(j => <option value={j.id} key={j.id}>{j.nameFa}</option>)}</select></label>
            <label className="block">انیمیشن آماده<select value={active.motion} onChange={e => update({motion:e.target.value as PartMotion})} className="block w-full mt-1 rounded bg-studio-950 p-2">{motions.map(([id,label]) => <option value={id} key={id}>{label}</option>)}</select></label>
            <label className="block">شدت حرکت: {active.intensity.toFixed(1)}<input type="range" min="0" max="2" step="0.1" value={active.intensity} onChange={e => update({intensity:Number(e.target.value)})} className="block w-full" /></label>
            <button type="button" onClick={() => { onChange(parts.filter(p => p.id !== active.id)); setSelected(null); }} className="bg-red-900/70 rounded p-2 w-full">حذف جزء و بازگرداندن تصویر</button>
          </div>}
          <p className="text-slate-400">حرکت اجزا با زمان تایم‌لاین و خروجی GIF هماهنگ است. اتصال به مفصل با حرکت و کلیدفریم‌های بدن همراه می‌شود. با تغییر کراپ یا تصویر، اجزا پاک می‌شوند. ویرایش اجزا تاریخچهٔ Undo جداگانه ندارد؛ برای بازگرداندن تصویر، جزء را حذف کنید.</p>
        </div>
      </div>
    </div>
  </div>;
};
