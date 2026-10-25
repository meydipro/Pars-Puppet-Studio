import {
  analyzeCharacterSilhouette,
  buildAutoRigFromLandmarks,
  ProcessedImageBuffer,
} from './imageProcessor';
import { PuppetRig } from './types';

export interface SampleCharacterMeta {
  id: string;
  nameFa: string;
  tagFa: string;
  accent: string;
  recommendedPreset: 'talk_natural' | 'wave_hello' | 'dance_groove' | 'talk_excited';
}

export const SAMPLE_CHARACTERS: SampleCharacterMeta[] = [
  {
    id: 'arash_boy',
    nameFa: 'آرش (کارتونی)',
    tagFa: 'تمام‌قد',
    accent: '#f97316',
    recommendedPreset: 'talk_excited',
  },
  {
    id: 'robo_buddy',
    nameFa: 'ربات سخنگو',
    tagFa: 'تمام‌قد',
    accent: '#38bdf8',
    recommendedPreset: 'wave_hello',
  },
  {
    id: 'pishi_cat',
    nameFa: 'پیشی بامزه',
    tagFa: 'عروسکی',
    accent: '#fbbf24',
    recommendedPreset: 'dance_groove',
  },
  {
    id: 'sara_portrait',
    nameFa: 'پرتره آواتار',
    tagFa: 'نیم‌تنه',
    accent: '#c084fc',
    recommendedPreset: 'talk_natural',
  },
];

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

export function generateSampleCharacter(id: string): {
  image: ProcessedImageBuffer;
  customRig?: PuppetRig;
  thumbnailDataUrl: string;
} {
  const W = 520;
  const H = 600;

  if (typeof document === 'undefined') {
    // Pure Node/test fallback buffer + enriched rig
    const rgba = new Uint8ClampedArray(W * H * 4);
    for (let y = 80; y < 520; y++) {
      for (let x = 140; x < 380; x++) {
        const i = (y * W + x) * 4;
        rgba[i] = 99;
        rgba[i + 1] = 102;
        rgba[i + 2] = 241;
        rgba[i + 3] = 255;
      }
    }
    const lm = analyzeCharacterSilhouette(rgba, W, H);
    const fallbackRig = buildAutoRigFromLandmarks(
      lm,
      id === 'sara_portrait' ? 'portrait' : 'fullBody'
    );
    return {
      image: { rgba, width: W, height: H, hasTransparency: true },
      thumbnailDataUrl: '',
      customRig: fallbackRig,
    };
  }

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.clearRect(0, 0, W, H);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (id === 'robo_buddy') {
    // Antenna
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(260, 95);
    ctx.lineTo(260, 52);
    ctx.stroke();
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(260, 46, 13, 0, Math.PI * 2);
    ctx.fill();

    // Legs (with wide gap so geodesic skinning separates them cleanly!)
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 26;
    ctx.beginPath();
    ctx.moveTo(222, 395);
    ctx.lineTo(212, 515);
    ctx.moveTo(298, 395);
    ctx.lineTo(308, 515);
    ctx.stroke();

    // Boots
    ctx.fillStyle = '#0ea5e9';
    roundRect(ctx, 180, 505, 58, 34, 15);
    ctx.fill();
    roundRect(ctx, 282, 505, 58, 34, 15);
    ctx.fill();

    // Arms (outstretched slightly so waving looks super clean)
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 24;
    ctx.beginPath();
    ctx.moveTo(188, 265);
    ctx.quadraticCurveTo(132, 285, 102, 245);
    ctx.moveTo(332, 265);
    ctx.quadraticCurveTo(388, 285, 418, 245);
    ctx.stroke();

    // Robot Claws/Hands
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(98, 240, 20, 0, Math.PI * 2);
    ctx.arc(422, 240, 20, 0, Math.PI * 2);
    ctx.fill();

    // Neck
    ctx.fillStyle = '#475569';
    roundRect(ctx, 242, 212, 36, 34, 8);
    ctx.fill();

    // Torso
    const bodyGrad = ctx.createLinearGradient(180, 240, 340, 410);
    bodyGrad.addColorStop(0, '#1e293b');
    bodyGrad.addColorStop(1, '#0f172a');
    ctx.fillStyle = bodyGrad;
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 6;
    roundRect(ctx, 184, 240, 152, 165, 28);
    ctx.fill();
    ctx.stroke();

    // Chest Core
    ctx.fillStyle = '#0284c7';
    roundRect(ctx, 214, 275, 92, 68, 16);
    ctx.fill();
    ctx.fillStyle = '#7dd3fc';
    ctx.beginPath();
    ctx.arc(260, 309, 18, 0, Math.PI * 2);
    ctx.fill();

    // Head
    const headGrad = ctx.createLinearGradient(170, 88, 350, 220);
    headGrad.addColorStop(0, '#334155');
    headGrad.addColorStop(1, '#1e293b');
    ctx.fillStyle = headGrad;
    ctx.strokeStyle = '#7dd3fc';
    ctx.lineWidth = 6;
    roundRect(ctx, 172, 92, 176, 126, 34);
    ctx.fill();
    ctx.stroke();

    // Face Visor
    ctx.fillStyle = '#090d16';
    roundRect(ctx, 192, 112, 136, 86, 20);
    ctx.fill();

    // Glowing Eyes
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(230, 144, 14, 0, Math.PI * 2);
    ctx.arc(290, 144, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e0f2fe';
    ctx.beginPath();
    ctx.arc(234, 140, 5, 0, Math.PI * 2);
    ctx.arc(294, 140, 5, 0, Math.PI * 2);
    ctx.fill();

    // Smile line on visor
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(236, 176);
    ctx.quadraticCurveTo(260, 188, 284, 176);
    ctx.stroke();

    const customRig: PuppetRig = {
      mode: 'fullBody',
      joints: [
        { id: 'hips', nameFa: 'لگن', parentId: null, rest: { x: 260 / W, y: 385 / H }, color: '#facc15' },
        { id: 'chest', nameFa: 'سینه', parentId: 'hips', rest: { x: 260 / W, y: 295 / H }, color: '#38bdf8' },
        { id: 'neck', nameFa: 'گردن', parentId: 'chest', rest: { x: 260 / W, y: 228 / H }, color: '#818cf8' },
        { id: 'head', nameFa: 'سر', parentId: 'neck', rest: { x: 260 / W, y: 150 / H }, color: '#c084fc' },
        { id: 'l_shoulder', nameFa: 'شانه چپ', parentId: 'chest', rest: { x: 190 / W, y: 265 / H }, color: '#34d399' },
        { id: 'l_hand', nameFa: 'دست چپ', parentId: 'l_shoulder', rest: { x: 98 / W, y: 240 / H }, color: '#10b981' },
        { id: 'r_shoulder', nameFa: 'شانه راست', parentId: 'chest', rest: { x: 330 / W, y: 265 / H }, color: '#fb923c' },
        { id: 'r_hand', nameFa: 'دست راست', parentId: 'r_shoulder', rest: { x: 422 / W, y: 240 / H }, color: '#f97316' },
        { id: 'l_foot', nameFa: 'پای چپ', parentId: 'hips', rest: { x: 210 / W, y: 518 / H }, color: '#2dd4bf' },
        { id: 'r_foot', nameFa: 'پای راست', parentId: 'hips', rest: { x: 310 / W, y: 518 / H }, color: '#f472b6' },
      ],
      mouth: {
        center: { x: 260 / W, y: 177 / H },
        rx: 0.065,
        ry: 0.032,
        interiorColor: '#083344',
        showTongue: false,
        showTeeth: false,
      },
    };

    const imgData = ctx.getImageData(0, 0, W, H);
    return {
      image: { rgba: imgData.data, width: W, height: H, hasTransparency: true },
      customRig: enrichSampleRig(customRig),
      thumbnailDataUrl: canvas.toDataURL('image/png'),
    };
  }

  if (id === 'pishi_cat') {
    // Tail (attached to hip right)
    ctx.strokeStyle = '#ea580c';
    ctx.lineWidth = 22;
    ctx.beginPath();
    ctx.moveTo(315, 395);
    ctx.bezierCurveTo(395, 395, 415, 315, 385, 290);
    ctx.stroke();

    // Legs
    ctx.strokeStyle = '#f97316';
    ctx.lineWidth = 32;
    ctx.beginPath();
    ctx.moveTo(222, 405);
    ctx.lineTo(214, 515);
    ctx.moveTo(298, 405);
    ctx.lineTo(306, 515);
    ctx.stroke();

    // White Paws (feet)
    ctx.fillStyle = '#fff7ed';
    ctx.beginPath();
    ctx.ellipse(210, 522, 26, 16, 0, 0, Math.PI * 2);
    ctx.ellipse(310, 522, 26, 16, 0, 0, Math.PI * 2);
    ctx.fill();

    // Arms
    ctx.strokeStyle = '#f97316';
    ctx.lineWidth = 28;
    ctx.beginPath();
    ctx.moveTo(195, 285);
    ctx.quadraticCurveTo(135, 305, 112, 262);
    ctx.moveTo(325, 285);
    ctx.quadraticCurveTo(385, 305, 408, 262);
    ctx.stroke();

    ctx.fillStyle = '#fff7ed';
    ctx.beginPath();
    ctx.arc(110, 258, 17, 0, Math.PI * 2);
    ctx.arc(410, 258, 17, 0, Math.PI * 2);
    ctx.fill();

    // Chubby Cat Body
    ctx.fillStyle = '#fb923c';
    ctx.beginPath();
    ctx.ellipse(260, 340, 76, 88, 0, 0, Math.PI * 2);
    ctx.fill();

    // Cream Belly
    ctx.fillStyle = '#ffedd5';
    ctx.beginPath();
    ctx.ellipse(260, 348, 48, 60, 0, 0, Math.PI * 2);
    ctx.fill();

    // Ears
    ctx.fillStyle = '#ea580c';
    ctx.beginPath();
    ctx.moveTo(182, 148);
    ctx.lineTo(192, 68);
    ctx.lineTo(240, 112);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(338, 148);
    ctx.lineTo(328, 68);
    ctx.lineTo(280, 112);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#fda4af';
    ctx.beginPath();
    ctx.moveTo(193, 138);
    ctx.lineTo(199, 86);
    ctx.lineTo(230, 116);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(327, 138);
    ctx.lineTo(321, 86);
    ctx.lineTo(290, 116);
    ctx.closePath();
    ctx.fill();

    // Cat Head
    ctx.fillStyle = '#fb923c';
    ctx.beginPath();
    ctx.ellipse(260, 175, 86, 74, 0, 0, Math.PI * 2);
    ctx.fill();

    // Muzzle patch
    ctx.fillStyle = '#fff7ed';
    ctx.beginPath();
    ctx.ellipse(260, 198, 44, 30, 0, 0, Math.PI * 2);
    ctx.fill();

    // Eyes
    ctx.fillStyle = '#1e1b4b';
    ctx.beginPath();
    ctx.arc(224, 162, 14, 0, Math.PI * 2);
    ctx.arc(296, 162, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(228, 157, 5, 0, Math.PI * 2);
    ctx.arc(300, 157, 5, 0, Math.PI * 2);
    ctx.fill();

    // Pink Nose & Cat Mouth
    ctx.fillStyle = '#f43f5e';
    ctx.beginPath();
    ctx.moveTo(252, 184);
    ctx.lineTo(268, 184);
    ctx.lineTo(260, 194);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#7c2d12';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(260, 194);
    ctx.quadraticCurveTo(248, 209, 238, 202);
    ctx.moveTo(260, 194);
    ctx.quadraticCurveTo(272, 209, 282, 202);
    ctx.stroke();

    // Whiskers
    ctx.strokeStyle = '#9a3412';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(195, 186);
    ctx.lineTo(155, 180);
    ctx.moveTo(195, 196);
    ctx.lineTo(154, 200);
    ctx.moveTo(325, 186);
    ctx.lineTo(365, 180);
    ctx.moveTo(325, 196);
    ctx.lineTo(366, 200);
    ctx.stroke();

    const customRig: PuppetRig = {
      mode: 'fullBody',
      joints: [
        { id: 'hips', nameFa: 'لگن', parentId: null, rest: { x: 260 / W, y: 392 / H }, color: '#facc15' },
        { id: 'chest', nameFa: 'سینه', parentId: 'hips', rest: { x: 260 / W, y: 305 / H }, color: '#38bdf8' },
        { id: 'neck', nameFa: 'گردن', parentId: 'chest', rest: { x: 260 / W, y: 242 / H }, color: '#818cf8' },
        { id: 'head', nameFa: 'سر', parentId: 'neck', rest: { x: 260 / W, y: 168 / H }, color: '#c084fc' },
        { id: 'l_shoulder', nameFa: 'شانه چپ', parentId: 'chest', rest: { x: 195 / W, y: 285 / H }, color: '#34d399' },
        { id: 'l_hand', nameFa: 'پنجه چپ', parentId: 'l_shoulder', rest: { x: 110 / W, y: 258 / H }, color: '#10b981' },
        { id: 'r_shoulder', nameFa: 'شانه راست', parentId: 'chest', rest: { x: 325 / W, y: 285 / H }, color: '#fb923c' },
        { id: 'r_hand', nameFa: 'پنجه راست', parentId: 'r_shoulder', rest: { x: 410 / W, y: 258 / H }, color: '#f97316' },
        { id: 'l_foot', nameFa: 'پای چپ', parentId: 'hips', rest: { x: 212 / W, y: 520 / H }, color: '#2dd4bf' },
        { id: 'r_foot', nameFa: 'پای راست', parentId: 'hips', rest: { x: 308 / W, y: 520 / H }, color: '#f472b6' },
      ],
      mouth: {
        center: { x: 260 / W, y: 204 / H },
        rx: 0.055,
        ry: 0.03,
        interiorColor: '#4c0519',
        showTongue: true,
        showTeeth: false,
      },
    };

    const imgData = ctx.getImageData(0, 0, W, H);
    return {
      image: { rgba: imgData.data, width: W, height: H, hasTransparency: true },
      customRig: enrichSampleRig(customRig),
      thumbnailDataUrl: canvas.toDataURL('image/png'),
    };
  }

  if (id === 'sara_portrait') {
    // Back Hair
    ctx.fillStyle = '#312e81';
    ctx.beginPath();
    ctx.ellipse(260, 275, 138, 175, 0, 0, Math.PI * 2);
    ctx.fill();

    // Shoulders / Bust Sweater
    const sweaterGrad = ctx.createLinearGradient(120, 390, 400, 550);
    sweaterGrad.addColorStop(0, '#a855f7');
    sweaterGrad.addColorStop(1, '#6366f1');
    ctx.fillStyle = sweaterGrad;
    ctx.beginPath();
    ctx.moveTo(108, 545);
    ctx.quadraticCurveTo(122, 405, 222, 398);
    ctx.lineTo(298, 398);
    ctx.quadraticCurveTo(398, 405, 412, 545);
    ctx.closePath();
    ctx.fill();

    // Neck
    ctx.fillStyle = '#f6c9a8';
    roundRect(ctx, 230, 338, 60, 78, 22);
    ctx.fill();

    // Collar shadow
    ctx.fillStyle = '#e5b28f';
    ctx.beginPath();
    ctx.ellipse(260, 355, 30, 16, 0, 0, Math.PI);
    ctx.fill();

    // Face
    ctx.fillStyle = '#fcd5b5';
    ctx.beginPath();
    ctx.ellipse(260, 245, 96, 114, 0, 0, Math.PI * 2);
    ctx.fill();

    // Rosy Cheeks
    ctx.fillStyle = 'rgba(244, 114, 182, 0.35)';
    ctx.beginPath();
    ctx.ellipse(202, 268, 20, 12, 0, 0, Math.PI * 2);
    ctx.ellipse(318, 268, 20, 12, 0, 0, Math.PI * 2);
    ctx.fill();

    // Eyes
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(222, 232, 19, 14, 0, 0, Math.PI * 2);
    ctx.ellipse(298, 232, 19, 14, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#1e1b4b';
    ctx.beginPath();
    ctx.arc(222, 232, 10, 0, Math.PI * 2);
    ctx.arc(298, 232, 10, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(225, 228, 3.5, 0, Math.PI * 2);
    ctx.arc(301, 228, 3.5, 0, Math.PI * 2);
    ctx.fill();

    // Eyebrows
    ctx.strokeStyle = '#1e1b4b';
    ctx.lineWidth = 5.5;
    ctx.beginPath();
    ctx.moveTo(202, 206);
    ctx.quadraticCurveTo(222, 198, 240, 205);
    ctx.moveTo(280, 205);
    ctx.quadraticCurveTo(298, 198, 318, 206);
    ctx.stroke();

    // Nose
    ctx.strokeStyle = '#d99b78';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(260, 240);
    ctx.quadraticCurveTo(252, 266, 264, 270);
    ctx.stroke();

    // Lips
    ctx.fillStyle = '#e11d48';
    ctx.beginPath();
    ctx.ellipse(260, 302, 24, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#9f1239';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(237, 302);
    ctx.quadraticCurveTo(260, 306, 283, 302);
    ctx.stroke();

    // Front Hair Bangs
    ctx.fillStyle = '#4338ca';
    ctx.beginPath();
    ctx.moveTo(160, 225);
    ctx.quadraticCurveTo(175, 118, 265, 122);
    ctx.quadraticCurveTo(352, 124, 360, 228);
    ctx.quadraticCurveTo(315, 168, 268, 178);
    ctx.quadraticCurveTo(212, 162, 160, 225);
    ctx.closePath();
    ctx.fill();

    const customRig: PuppetRig = {
      mode: 'portrait',
      joints: [
        { id: 'hips', nameFa: 'پایه تنه', parentId: null, rest: { x: 260 / W, y: 515 / H }, pinned: true, color: '#94a3b8' },
        { id: 'chest', nameFa: 'گردن و سینه', parentId: 'hips', rest: { x: 260 / W, y: 390 / H }, color: '#38bdf8' },
        { id: 'head', nameFa: 'سر و چهره', parentId: 'chest', rest: { x: 260 / W, y: 245 / H }, color: '#a855f7' },
        { id: 'head_top', nameFa: 'بالای سر', parentId: 'head', rest: { x: 260 / W, y: 140 / H }, color: '#c084fc' },
        { id: 'l_shoulder', nameFa: 'شانه چپ', parentId: 'chest', rest: { x: 155 / W, y: 475 / H }, color: '#34d399' },
        { id: 'r_shoulder', nameFa: 'شانه راست', parentId: 'chest', rest: { x: 365 / W, y: 475 / H }, color: '#fb923c' },
      ],
      mouth: {
        center: { x: 260 / W, y: 302 / H },
        rx: 0.068,
        ry: 0.036,
        interiorColor: '#4c0519',
        showTongue: true,
        showTeeth: true,
      },
    };

    const imgData = ctx.getImageData(0, 0, W, H);
    return {
      image: { rgba: imgData.data, width: W, height: H, hasTransparency: true },
      customRig: enrichSampleRig(customRig),
      thumbnailDataUrl: canvas.toDataURL('image/png'),
    };
  }

  // Default: 'arash_boy' (Full-body friendly cartoon character)
  // Jeans Legs (clearly separated)
  ctx.strokeStyle = '#1d4ed8';
  ctx.lineWidth = 30;
  ctx.beginPath();
  ctx.moveTo(228, 392);
  ctx.lineTo(214, 516);
  ctx.moveTo(292, 392);
  ctx.lineTo(306, 516);
  ctx.stroke();

  // Sneakers
  ctx.fillStyle = '#f8fafc';
  roundRect(ctx, 180, 508, 56, 30, 14);
  ctx.fill();
  roundRect(ctx, 284, 508, 56, 30, 14);
  ctx.fill();
  ctx.fillStyle = '#ef4444';
  roundRect(ctx, 184, 524, 48, 10, 5);
  ctx.fill();
  roundRect(ctx, 288, 524, 48, 10, 5);
  ctx.fill();

  // Hoodie Sleeves (Arms spread out comfortably)
  ctx.strokeStyle = '#f97316';
  ctx.lineWidth = 28;
  ctx.beginPath();
  ctx.moveTo(198, 266);
  ctx.quadraticCurveTo(140, 286, 104, 244);
  ctx.moveTo(322, 266);
  ctx.quadraticCurveTo(380, 286, 416, 244);
  ctx.stroke();

  // Hands
  ctx.fillStyle = '#fcd5b5';
  ctx.beginPath();
  ctx.arc(98, 238, 18, 0, Math.PI * 2);
  ctx.arc(422, 238, 18, 0, Math.PI * 2);
  ctx.fill();

  // Hoodie Torso
  const hoodieGrad = ctx.createLinearGradient(190, 240, 330, 405);
  hoodieGrad.addColorStop(0, '#fb923c');
  hoodieGrad.addColorStop(1, '#ea580c');
  ctx.fillStyle = hoodieGrad;
  roundRect(ctx, 192, 242, 136, 160, 28);
  ctx.fill();

  // Hoodie Pocket & Strings
  ctx.fillStyle = '#c2410c';
  roundRect(ctx, 214, 338, 92, 44, 14);
  ctx.fill();
  ctx.strokeStyle = '#fff7ed';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(246, 250);
  ctx.lineTo(246, 294);
  ctx.moveTo(274, 250);
  ctx.lineTo(274, 294);
  ctx.stroke();

  // Neck
  ctx.fillStyle = '#f5c29b';
  roundRect(ctx, 242, 212, 36, 38, 12);
  ctx.fill();

  // Ears
  ctx.fillStyle = '#f5c29b';
  ctx.beginPath();
  ctx.arc(186, 162, 14, 0, Math.PI * 2);
  ctx.arc(334, 162, 14, 0, Math.PI * 2);
  ctx.fill();

  // Head
  ctx.fillStyle = '#fcd5b5';
  ctx.beginPath();
  ctx.ellipse(260, 155, 74, 80, 0, 0, Math.PI * 2);
  ctx.fill();

  // Stylish Hair
  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.moveTo(184, 150);
  ctx.quadraticCurveTo(182, 68, 262, 64);
  ctx.quadraticCurveTo(346, 66, 336, 150);
  ctx.quadraticCurveTo(304, 108, 260, 114);
  ctx.quadraticCurveTo(214, 106, 184, 150);
  ctx.closePath();
  ctx.fill();

  // Eyes
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(232, 150, 14, 15, 0, 0, Math.PI * 2);
  ctx.ellipse(288, 150, 14, 15, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.arc(232, 151, 8, 0, Math.PI * 2);
  ctx.arc(288, 151, 8, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(235, 147, 3, 0, Math.PI * 2);
  ctx.arc(291, 147, 3, 0, Math.PI * 2);
  ctx.fill();

  // Eyebrows
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(216, 128);
  ctx.quadraticCurveTo(232, 121, 246, 127);
  ctx.moveTo(274, 127);
  ctx.quadraticCurveTo(288, 121, 304, 128);
  ctx.stroke();

  // Friendly Smile
  ctx.fillStyle = '#be123c';
  ctx.beginPath();
  ctx.ellipse(260, 195, 18, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  const customRig: PuppetRig = {
    mode: 'fullBody',
    joints: [
      { id: 'hips', nameFa: 'لگن', parentId: null, rest: { x: 260 / W, y: 386 / H }, color: '#facc15' },
      { id: 'chest', nameFa: 'قفسه سینه', parentId: 'hips', rest: { x: 260 / W, y: 298 / H }, color: '#38bdf8' },
      { id: 'neck', nameFa: 'گردن', parentId: 'chest', rest: { x: 260 / W, y: 230 / H }, color: '#818cf8' },
      { id: 'head', nameFa: 'سر', parentId: 'neck', rest: { x: 260 / W, y: 155 / H }, color: '#c084fc' },
      { id: 'l_shoulder', nameFa: 'شانه چپ', parentId: 'chest', rest: { x: 198 / W, y: 266 / H }, color: '#34d399' },
      { id: 'l_hand', nameFa: 'دست چپ', parentId: 'l_shoulder', rest: { x: 98 / W, y: 238 / H }, color: '#10b981' },
      { id: 'r_shoulder', nameFa: 'شانه راست', parentId: 'chest', rest: { x: 322 / W, y: 266 / H }, color: '#fb923c' },
      { id: 'r_hand', nameFa: 'دست راست', parentId: 'r_shoulder', rest: { x: 422 / W, y: 238 / H }, color: '#f97316' },
      { id: 'l_foot', nameFa: 'پای چپ', parentId: 'hips', rest: { x: 212 / W, y: 520 / H }, color: '#2dd4bf' },
      { id: 'r_foot', nameFa: 'پای راست', parentId: 'hips', rest: { x: 308 / W, y: 520 / H }, color: '#f472b6' },
    ],
    mouth: {
      center: { x: 260 / W, y: 195 / H },
      rx: 0.055,
      ry: 0.028,
      interiorColor: '#4c0519',
      showTongue: true,
      showTeeth: true,
    },
  };

  const imgData = ctx.getImageData(0, 0, W, H);
  return {
    image: { rgba: imgData.data, width: W, height: H, hasTransparency: true },
    customRig: enrichSampleRig(customRig),
    thumbnailDataUrl: canvas.toDataURL('image/png'),
  };
}

/**
 * Enriches base sample rigs with intermediate anatomical & stabilizer pins
 * (waist, elbows, knees, head crown/temples, portrait base anchors)
 * so sample characters have 18 (fullBody) or 14 (portrait) controlled pins too!
 */
function enrichSampleRig(rig: PuppetRig): PuppetRig {
  const byId = new Map(rig.joints.map((j) => [j.id, j]));
  const mid = (aId: string, bId: string, t = 0.5) => {
    const a = byId.get(aId)?.rest || { x: 0.5, y: 0.5 };
    const b = byId.get(bId)?.rest || { x: 0.5, y: 0.5 };
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };

  if (rig.mode === 'portrait') {
    const hips = byId.get('hips')!;
    const chest = byId.get('chest')!;
    const head = byId.get('head')!;
    const headTop = byId.get('head_top')!;
    const lSh = byId.get('l_shoulder')!;
    const rSh = byId.get('r_shoulder')!;

    return {
      ...rig,
      mouth: { arch: 0.2, ...rig.mouth },
      joints: [
        { ...hips, pinned: true, stiffness: 1.25 },
        {
          id: 'base_l',
          nameFa: 'لنگر پایین چپ',
          parentId: 'hips',
          rest: { x: lSh.rest.x, y: hips.rest.y },
          pinned: true,
          stiffness: 1.25,
          color: '#94a3b8',
        },
        {
          id: 'base_r',
          nameFa: 'لنگر پایین راست',
          parentId: 'hips',
          rest: { x: rSh.rest.x, y: hips.rest.y },
          pinned: true,
          stiffness: 1.25,
          color: '#94a3b8',
        },
        {
          id: 'rib_l',
          nameFa: 'پهلوی چپ',
          parentId: 'hips',
          rest: { x: lSh.rest.x - 0.03, y: (lSh.rest.y + hips.rest.y) * 0.5 },
          pinned: true,
          stiffness: 1.15,
          color: '#64748b',
        },
        {
          id: 'rib_r',
          nameFa: 'پهلوی راست',
          parentId: 'hips',
          rest: { x: rSh.rest.x + 0.03, y: (rSh.rest.y + hips.rest.y) * 0.5 },
          pinned: true,
          stiffness: 1.15,
          color: '#64748b',
        },
        { ...chest, stiffness: 1.15 },
        lSh,
        rSh,
        {
          id: 'neck',
          nameFa: 'گردن',
          parentId: 'chest',
          rest: mid('chest', 'head', 0.45),
          color: '#818cf8',
        },
        { ...head, parentId: 'neck', stiffness: 1.25 },
        { ...headTop, stiffness: 1.2 },
        {
          id: 'forehead',
          nameFa: 'پیشانی',
          parentId: 'head',
          rest: mid('head', 'head_top', 0.52),
          stiffness: 1.2,
          color: '#d8b4fe',
        },
        {
          id: 'l_temple',
          nameFa: 'گیجگاه چپ',
          parentId: 'head',
          rest: { x: head.rest.x - 0.11, y: head.rest.y },
          stiffness: 1.2,
          color: '#e879f9',
        },
        {
          id: 'r_temple',
          nameFa: 'گیجگاه راست',
          parentId: 'head',
          rest: { x: head.rest.x + 0.11, y: head.rest.y },
          stiffness: 1.2,
          color: '#e879f9',
        },
      ],
    };
  }

  // Full Body 18-Pin Enrichment
  const hips = byId.get('hips')!;
  const chest = byId.get('chest')!;
  const neck = byId.get('neck')!;
  const head = byId.get('head')!;
  const lSh = byId.get('l_shoulder')!;
  const lHand = byId.get('l_hand')!;
  const rSh = byId.get('r_shoulder')!;
  const rHand = byId.get('r_hand')!;
  const lFoot = byId.get('l_foot')!;
  const rFoot = byId.get('r_foot')!;

  return {
    ...rig,
    mouth: { arch: 0.2, ...rig.mouth },
    joints: [
      { ...hips, stiffness: 1.15 },
      {
        id: 'waist',
        nameFa: 'کمر و شکم',
        parentId: 'hips',
        rest: mid('hips', 'chest', 0.5),
        stiffness: 1.1,
        color: '#fde047',
      },
      { ...chest, parentId: 'waist', stiffness: 1.15 },
      neck,
      { ...head, stiffness: 1.25 },
      {
        id: 'head_top',
        nameFa: 'تاج سر',
        parentId: 'head',
        rest: { x: head.rest.x, y: Math.max(0.06, head.rest.y - 0.085) },
        stiffness: 1.2,
        color: '#d8b4fe',
      },
      {
        id: 'l_temple',
        nameFa: 'گیجگاه چپ',
        parentId: 'head',
        rest: { x: head.rest.x - 0.085, y: head.rest.y },
        stiffness: 1.2,
        color: '#e879f9',
      },
      {
        id: 'r_temple',
        nameFa: 'گیجگاه راست',
        parentId: 'head',
        rest: { x: head.rest.x + 0.085, y: head.rest.y },
        stiffness: 1.2,
        color: '#e879f9',
      },
      lSh,
      {
        id: 'l_elbow',
        nameFa: 'آرنج چپ',
        parentId: 'l_shoulder',
        rest: {
          x: (lSh.rest.x + lHand.rest.x) * 0.5,
          y: (lSh.rest.y + lHand.rest.y) * 0.5 + 0.025,
        },
        color: '#6ee7b7',
      },
      { ...lHand, parentId: 'l_elbow' },
      rSh,
      {
        id: 'r_elbow',
        nameFa: 'آرنج راست',
        parentId: 'r_shoulder',
        rest: {
          x: (rSh.rest.x + rHand.rest.x) * 0.5,
          y: (rSh.rest.y + rHand.rest.y) * 0.5 + 0.025,
        },
        color: '#fdba74',
      },
      { ...rHand, parentId: 'r_elbow' },
      {
        id: 'l_knee',
        nameFa: 'زانوی چپ',
        parentId: 'hips',
        rest: {
          x: hips.rest.x * 0.3 + lFoot.rest.x * 0.7,
          y: (hips.rest.y + lFoot.rest.y) * 0.5,
        },
        color: '#5eead4',
      },
      { ...lFoot, parentId: 'l_knee' },
      {
        id: 'r_knee',
        nameFa: 'زانوی راست',
        parentId: 'hips',
        rest: {
          x: hips.rest.x * 0.3 + rFoot.rest.x * 0.7,
          y: (hips.rest.y + rFoot.rest.y) * 0.5,
        },
        color: '#f9a8d4',
      },
      { ...rFoot, parentId: 'r_knee' },
    ],
  };
}
