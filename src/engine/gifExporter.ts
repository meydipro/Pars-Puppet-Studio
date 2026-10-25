import { encodeFramesToGifBytes } from './gifCore';
import type { GifWorkerRequest, GifWorkerResponse } from './gif.worker';
import {
  compileMouthGeometry,
  sampleSurroundingMouthSkinColor,
} from './mouthPenGeometry';
import { PuppetMeshRenderer, renderSceneFrame } from './renderer';
import { deformPuppetMesh, evaluatePuppetPose } from './rigAndAnimator';
import {
  AnimationSettings,
  GifExportOptions,
  KeyframePoint,
  PuppetMesh,
  PuppetRig,
  RecordedSample,
  StageSettings,
} from './types';

export interface GifExportResult {
  blob: Blob;
  url: string;
  byteLength: number;
  frameCount: number;
  width: number;
  height: number;
}

export async function renderAndExportGif(params: {
  rgba: Uint8ClampedArray;
  imgW: number;
  imgH: number;
  mesh: PuppetMesh;
  rig: PuppetRig;
  animSettings: AnimationSettings;
  stageSettings: StageSettings;
  keyframes: KeyframePoint[];
  recordedSamples: RecordedSample[];
  options: GifExportOptions;
  onProgress: (phase: 'rendering' | 'encoding', progress0to1: number) => void;
  signal?: AbortSignal;
}): Promise<GifExportResult> {
  const {
    rgba,
    imgW,
    imgH,
    mesh,
    rig,
    animSettings,
    stageSettings,
    keyframes,
    recordedSamples,
    options,
    onProgress,
    signal,
  } = params;

  const width = Math.max(64, Math.round(options.width));
  const height = Math.max(64, Math.round(options.height));
  const fps = Math.max(6, Math.min(50, options.fps));

  const effectiveDuration = Math.max(
    0.4,
    animSettings.duration / Math.max(0.2, animSettings.speed)
  );
  const baseFrames = Math.max(6, Math.round(effectiveDuration * fps));

  // Build dedicated offscreen renderer & canvas so live viewport is never disturbed
  const exportRenderer = new PuppetMeshRenderer();
  exportRenderer.setTexture(rgba, imgW, imgH);

  // Clone mesh deformedPositions so live viewport doesn't flicker during export
  const exportMesh: PuppetMesh = {
    ...mesh,
    deformedPositions: new Float32Array(mesh.restPositions),
  };

  const exportStageSettings: StageSettings = options.transparent
    ? { ...stageSettings, backgroundStyle: 'transparent' }
    : stageSettings.backgroundStyle === 'transparent'
    ? { ...stageSettings, backgroundStyle: 'solid' }
    : stageSettings;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('عدم دسترسی به بوم گرافیکی مرورگر برای خروجی گیف.');
  }

  const mouthSkinColor = sampleSurroundingMouthSkinColor(
    rgba,
    imgW,
    imgH,
    compileMouthGeometry(rig.mouth)
  );

  const forwardBuffers: ArrayBuffer[] = [];

  for (let i = 0; i < baseFrames; i++) {
    if (signal?.aborted) {
      throw new DOMException('ساخت گیف لغو شد.', 'AbortError');
    }

    const u = i / baseFrames;
    const pose = evaluatePuppetPose(
      rig,
      animSettings,
      u,
      keyframes,
      recordedSamples
    );
    deformPuppetMesh(exportMesh, rig, pose, animSettings);

    renderSceneFrame({
      ctx,
      stageW: width,
      stageH: height,
      imgW,
      imgH,
      meshRenderer: exportRenderer,
      mesh: exportMesh,
      rig,
      pose,
      animSettings,
      stageSettings: exportStageSettings,
      mouthSkinColor,
      exportMode: true,
    });

    const frameData = ctx.getImageData(0, 0, width, height);
    // Copy exact buffer for zero-copy transfer
    forwardBuffers.push(frameData.data.slice().buffer);

    onProgress('rendering', (i + 1) / baseFrames);

    // Yield every 4 frames so UI stays responsive at 60fps
    if (i % 4 === 3) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  // Optional Ping-Pong (Boomerang) loop frames
  const allBuffers: ArrayBuffer[] = [...forwardBuffers];
  if (options.pingPong && forwardBuffers.length > 2) {
    for (let i = forwardBuffers.length - 2; i >= 1; i--) {
      allBuffers.push(forwardBuffers[i].slice(0));
    }
  }

  const delayMs = Math.max(20, Math.round(1000 / fps));

  // Encode in Web Worker for non-blocking multi-core speed, with graceful fallback
  const gifBytes = await encodeWithWorkerOrFallback({
    buffers: allBuffers,
    width,
    height,
    delayMs,
    transparent: options.transparent,
    dither: options.dither,
    repeat: options.repeat,
    onProgress: (frac) => onProgress('encoding', frac),
    signal,
  });

  const blob = new Blob([gifBytes.buffer as ArrayBuffer], { type: 'image/gif' });
  const url = URL.createObjectURL(blob);

  return {
    blob,
    url,
    byteLength: gifBytes.byteLength,
    frameCount: allBuffers.length,
    width,
    height,
  };
}

async function encodeWithWorkerOrFallback(params: {
  buffers: ArrayBuffer[];
  width: number;
  height: number;
  delayMs: number;
  transparent: boolean;
  dither: boolean;
  repeat: number;
  onProgress: (frac: number) => void;
  signal?: AbortSignal;
}): Promise<Uint8Array> {
  const {
    buffers,
    width,
    height,
    delayMs,
    transparent,
    dither,
    repeat,
    onProgress,
    signal,
  } = params;

  if (typeof Worker !== 'undefined') {
    try {
      return await new Promise<Uint8Array>((resolve, reject) => {
        const worker = new Worker(
          new URL('./gif.worker.ts', import.meta.url),
          { type: 'module' }
        );

        const onAbort = () => {
          worker.terminate();
          reject(new DOMException('ساخت گیف لغو شد.', 'AbortError'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });

        worker.onmessage = (ev: MessageEvent<GifWorkerResponse>) => {
          const msg = ev.data;
          if (msg.type === 'progress') {
            onProgress(msg.fraction);
          } else if (msg.type === 'done') {
            signal?.removeEventListener('abort', onAbort);
            worker.terminate();
            resolve(new Uint8Array(msg.gifBuffer));
          } else if (msg.type === 'error') {
            signal?.removeEventListener('abort', onAbort);
            worker.terminate();
            reject(new Error(msg.message));
          }
        };

        worker.onerror = () => {
          signal?.removeEventListener('abort', onAbort);
          worker.terminate();
          // Fallback to main thread if worker script fails in restricted sandbox
          try {
            const frames = buffers.map((ab) => new Uint8ClampedArray(ab));
            const res = encodeFramesToGifBytes({
              frames,
              width,
              height,
              delayMs,
              transparent,
              dither,
              repeat,
              onProgress,
            });
            resolve(res);
          } catch (e) {
            reject(e);
          }
        };

        // Keep shallow copy only if fallback needed; transfer copies for speed
        const transferables = buffers.map((b) => b.slice(0));
        const req: GifWorkerRequest = {
          buffers: transferables,
          width,
          height,
          delayMs,
          transparent,
          dither,
          repeat,
        };
        worker.postMessage(req, transferables);
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      // Fall through to synchronous fallback
    }
  }

  const frames = buffers.map((ab) => new Uint8ClampedArray(ab));
  return encodeFramesToGifBytes({
    frames,
    width,
    height,
    delayMs,
    transparent,
    dither,
    repeat,
    onProgress,
  });
}
