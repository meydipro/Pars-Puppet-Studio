import { GIFEncoder, quantize, applyPalette } from 'gifenc';

export interface EncodeGifInput {
  frames: Uint8ClampedArray[];
  width: number;
  height: number;
  delayMs: number;
  transparent: boolean;
  dither: boolean;
  repeat: number; // 0 = forever, -1 = once
  onProgress?: (fraction: number) => void;
}

// 4x4 Bayer ordered dither matrix normalized to [-0.5 .. +0.5]
const BAYER_4X4 = [
  -7 / 16,  1 / 16, -5 / 16,  3 / 16,
   5 / 16, -3 / 16,  7 / 16, -1 / 16,
  -4 / 16,  4 / 16, -6 / 16,  2 / 16,
   8 / 16,  0 / 16,  6 / 16, -2 / 16,
];

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

/**
 * Pure, spec-compliant GIF89a multi-frame encoder.
 * - Preserves black outlines/eyes even on transparent GIFs by reserving index 0 strictly
 *   for alpha < 128 and mapping opaque pixels strictly to indices 1..N.
 * - Matches LZW `colorDepth` strictly to Global Color Table bit size for universal compatibility
 *   (Telegram, WhatsApp, Discord, Safari, Chrome, Firefox).
 */
export function encodeFramesToGifBytes(input: EncodeGifInput): Uint8Array {
  const {
    frames,
    width,
    height,
    delayMs,
    transparent,
    dither,
    repeat,
    onProgress,
  } = input;

  if (frames.length === 0 || width <= 0 || height <= 0) {
    throw new Error('هیچ فریمی برای ساخت گیف وجود ندارد.');
  }

  const pixelCount = width * height;
  const sampleFrameIndices: number[] = [];
  const sampleSteps = Math.min(frames.length, 6);
  for (let s = 0; s < sampleSteps; s++) {
    const idx = Math.min(
      frames.length - 1,
      Math.floor((s / Math.max(1, sampleSteps - 1)) * (frames.length - 1))
    );
    if (!sampleFrameIndices.includes(idx)) {
      sampleFrameIndices.push(idx);
    }
  }

  // Collect representative opaque pixels across key animation frames
  const maxSamples = 90000;
  const stride = Math.max(
    1,
    Math.floor((pixelCount * sampleFrameIndices.length) / maxSamples)
  );
  const opaqueSamples: number[] = [];

  for (const fIdx of sampleFrameIndices) {
    const buf = frames[fIdx];
    for (let p = 0; p < pixelCount; p += stride) {
      const i4 = p * 4;
      const a = buf[i4 + 3];
      if (!transparent || a >= 128) {
        opaqueSamples.push(buf[i4], buf[i4 + 1], buf[i4 + 2], 255);
      }
    }
  }

  if (opaqueSamples.length === 0) {
    opaqueSamples.push(255, 255, 255, 255);
  }

  const sampleArray = new Uint8Array(opaqueSamples);
  const maxOpaqueColors = transparent ? 255 : 256;
  const opaquePalette: number[][] = quantize(sampleArray, maxOpaqueColors, {
    format: 'rgb565',
  });

  if (opaquePalette.length === 0) {
    opaquePalette.push([255, 255, 255]);
  }

  const fullPalette: number[][] = transparent
    ? [[0, 0, 0], ...opaquePalette]
    : opaquePalette;

  // Match GIF89a LZW minCodeSize strictly with GCT bit size (2..8)
  const gctBits = Math.max(
    2,
    Math.min(8, Math.ceil(Math.log2(Math.max(2, fullPalette.length))))
  );

  // Pad palette explicitly to 2^gctBits
  const targetLen = 1 << gctBits;
  while (fullPalette.length < targetLen) {
    fullPalette.push([0, 0, 0]);
  }

  const gif = GIFEncoder({ initialCapacity: Math.max(65536, pixelCount * 2) });
  const ditherBuf = dither ? new Uint8ClampedArray(pixelCount * 4) : null;

  for (let f = 0; f < frames.length; f++) {
    const rawRgba = frames[f];
    let workRgba = rawRgba;

    if (dither && ditherBuf) {
      workRgba = ditherBuf;
      const strength = 9;
      for (let y = 0; y < height; y++) {
        const bRow = (y & 3) << 2;
        const rowOff = y * width;
        for (let x = 0; x < width; x++) {
          const p = rowOff + x;
          const i4 = p * 4;
          const a = rawRgba[i4 + 3];
          if (transparent && a < 128) {
            workRgba[i4] = 0;
            workRgba[i4 + 1] = 0;
            workRgba[i4 + 2] = 0;
            workRgba[i4 + 3] = 0;
          } else {
            const offset = BAYER_4X4[bRow + (x & 3)] * strength;
            workRgba[i4] = clampByte(rawRgba[i4] + offset);
            workRgba[i4 + 1] = clampByte(rawRgba[i4 + 1] + offset);
            workRgba[i4 + 2] = clampByte(rawRgba[i4 + 2] + offset);
            workRgba[i4 + 3] = 255;
          }
        }
      }
    }

    const mappedOpaque = applyPalette(workRgba, opaquePalette, 'rgb565');
    let finalIndex: Uint8Array;

    if (transparent) {
      finalIndex = new Uint8Array(pixelCount);
      for (let p = 0; p < pixelCount; p++) {
        if (rawRgba[p * 4 + 3] < 128) {
          finalIndex[p] = 0;
        } else {
          finalIndex[p] = mappedOpaque[p] + 1;
        }
      }
    } else {
      finalIndex = mappedOpaque;
    }

    gif.writeFrame(finalIndex, width, height, {
      palette: f === 0 ? fullPalette : undefined,
      colorDepth: gctBits,
      delay: Math.max(20, Math.round(delayMs)),
      transparent,
      transparentIndex: 0,
      dispose: transparent ? 2 : 1,
      repeat: f === 0 ? repeat : undefined,
    });

    if (onProgress) {
      onProgress((f + 1) / frames.length);
    }
  }

  gif.finish();
  return gif.bytes();
}
