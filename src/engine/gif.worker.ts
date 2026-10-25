/// <reference lib="webworker" />
import { encodeFramesToGifBytes } from './gifCore';

export interface GifWorkerRequest {
  buffers: ArrayBuffer[];
  width: number;
  height: number;
  delayMs: number;
  transparent: boolean;
  dither: boolean;
  repeat: number;
}

export type GifWorkerResponse =
  | { type: 'progress'; fraction: number }
  | { type: 'done'; gifBuffer: ArrayBuffer }
  | { type: 'error'; message: string };

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<GifWorkerRequest>) => {
  try {
    const { buffers, width, height, delayMs, transparent, dither, repeat } =
      e.data;
    const frames = buffers.map((ab) => new Uint8ClampedArray(ab));

    const bytes = encodeFramesToGifBytes({
      frames,
      width,
      height,
      delayMs,
      transparent,
      dither,
      repeat,
      onProgress: (fraction) => {
        const msg: GifWorkerResponse = { type: 'progress', fraction };
        ctx.postMessage(msg);
      },
    });

    const outCopy = bytes.slice();
    const doneMsg: GifWorkerResponse = {
      type: 'done',
      gifBuffer: outCopy.buffer,
    };
    ctx.postMessage(doneMsg, [outCopy.buffer]);
  } catch (err) {
    const errMsg: GifWorkerResponse = {
      type: 'error',
      message: err instanceof Error ? err.message : 'خطا در رمزنگاری فایل گیف',
    };
    ctx.postMessage(errMsg);
  }
};
