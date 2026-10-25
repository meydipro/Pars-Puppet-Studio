import {
  buildAnimatedCustomMouthPolygons,
  compileCustomMouth,
  compileMouthGeometry,
  subdivideCatmullRom,
} from './mouthPenGeometry';
import { transformHeadPoint } from './rigAndAnimator';
import {
  AnimationSettings,
  EvaluatedPose,
  PuppetMesh,
  PuppetRig,
  StageSettings,
  Vec2,
  ViewportToolMode,
} from './types';

export interface CharacterRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function computeCharacterRect(
  stageW: number,
  stageH: number,
  imgW: number,
  imgH: number,
  characterScale = 0.86,
  hasSpeechBubble = false,
  offsetX = 0,
  offsetY = 0
): CharacterRect {
  const safeImgW = Math.max(1, imgW);
  const safeImgH = Math.max(1, imgH);
  const scaleMul = hasSpeechBubble ? characterScale * 0.88 : characterScale;
  const fit = Math.min(stageW / safeImgW, stageH / safeImgH) * scaleMul;
  const w = safeImgW * fit;
  const h = safeImgH * fit;
  const x = (stageW - w) * 0.5 + offsetX * stageW;
  const y =
    (hasSpeechBubble ? (stageH - h) * 0.66 : (stageH - h) * 0.54) +
    offsetY * stageH;
  return { x, y, w, h };
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * Hardware-accelerated WebGL1 2D Mesh Renderer with automatic Software Scanline Fallback.
 * Zero hairline triangle seams, premultiplied-alpha clean bilinear sampling.
 */
export class PuppetMeshRenderer {
  private glCanvas: HTMLCanvasElement | null = null;
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private posBuffer: WebGLBuffer | null = null;
  private uvBuffer: WebGLBuffer | null = null;
  private indexBuffer: WebGLBuffer | null = null;
  private texture: WebGLTexture | null = null;

  private aPosLoc = -1;
  private aUvLoc = -1;
  private uStageSizeLoc: WebGLUniformLocation | null = null;

  private texPixels: Uint8ClampedArray | null = null;
  private texWidth = 0;
  private texHeight = 0;
  private glFailed = false;

  private scaledPosScratch = new Float32Array(0);

  constructor() {
    if (typeof document !== 'undefined') {
      this.initWebGL();
    } else {
      this.glFailed = true;
    }
  }

  private initWebGL(): void {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const gl = (canvas.getContext('webgl', {
        alpha: true,
        premultipliedAlpha: true,
        antialias: true,
        preserveDrawingBuffer: true,
      }) ||
        canvas.getContext('experimental-webgl', {
          alpha: true,
          premultipliedAlpha: true,
          antialias: true,
          preserveDrawingBuffer: true,
        })) as WebGLRenderingContext | null;

      if (!gl) {
        this.glFailed = true;
        return;
      }

      const vsSrc = `
        attribute vec2 a_pos;
        attribute vec2 a_uv;
        uniform vec2 u_stageSize;
        varying vec2 v_uv;
        void main() {
          vec2 clip = (a_pos / u_stageSize) * 2.0 - 1.0;
          gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
          v_uv = a_uv;
        }
      `;

      const fsSrc = `
        precision mediump float;
        varying vec2 v_uv;
        uniform sampler2D u_tex;
        void main() {
          gl_FragColor = texture2D(u_tex, v_uv);
        }
      `;

      const compile = (type: number, src: string) => {
        const sh = gl.createShader(type)!;
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
          const info = gl.getShaderInfoLog(sh);
          gl.deleteShader(sh);
          throw new Error(info || 'Shader compile error');
        }
        return sh;
      };

      const vs = compile(gl.VERTEX_SHADER, vsSrc);
      const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
      const prog = gl.createProgram()!;
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error('WebGL program link failed');
      }

      this.glCanvas = canvas;
      this.gl = gl;
      this.program = prog;
      this.posBuffer = gl.createBuffer();
      this.uvBuffer = gl.createBuffer();
      this.indexBuffer = gl.createBuffer();
      this.aPosLoc = gl.getAttribLocation(prog, 'a_pos');
      this.aUvLoc = gl.getAttribLocation(prog, 'a_uv');
      this.uStageSizeLoc = gl.getUniformLocation(prog, 'u_stageSize');

      canvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        this.glFailed = true;
      });
    } catch {
      this.glFailed = true;
    }
  }

  public setTexture(rgba: Uint8ClampedArray, width: number, height: number): void {
    this.texPixels = rgba;
    this.texWidth = width;
    this.texHeight = height;

    if (this.glFailed || !this.gl) return;
    const gl = this.gl;

    if (!this.texture) {
      this.texture = gl.createTexture();
    }

    // Explicitly premultiply RGB by Alpha so bilinear filtering has zero dark fringes
    const premul = new Uint8Array(rgba.length);
    for (let i = 0; i < rgba.length; i += 4) {
      const a = rgba[i + 3];
      if (a === 255) {
        premul[i] = rgba[i];
        premul[i + 1] = rgba[i + 1];
        premul[i + 2] = rgba[i + 2];
        premul[i + 3] = 255;
      } else if (a > 0) {
        const f = a / 255;
        premul[i] = Math.round(rgba[i] * f);
        premul[i + 1] = Math.round(rgba[i + 1] * f);
        premul[i + 2] = Math.round(rgba[i + 2] * f);
        premul[i + 3] = a;
      }
    }

    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      premul
    );
  }

  /**
   * Draws the deformed mesh onto `targetCtx` inside `charRect`.
   */
  public drawDeformedCharacter(
    targetCtx: CanvasRenderingContext2D,
    stageW: number,
    stageH: number,
    mesh: PuppetMesh,
    charRect: CharacterRect
  ): void {
    if (!this.texPixels || mesh.vertexCount === 0 || mesh.indices.length === 0) {
      return;
    }

    const needed = mesh.vertexCount * 2;
    if (this.scaledPosScratch.length < needed) {
      this.scaledPosScratch = new Float32Array(needed);
    }

    const srcPos = mesh.deformedPositions;
    const stagePos = this.scaledPosScratch;
    for (let i = 0; i < needed; i += 2) {
      stagePos[i] = charRect.x + srcPos[i] * charRect.w;
      stagePos[i + 1] = charRect.y + srcPos[i + 1] * charRect.h;
    }

    if (!this.glFailed && this.gl && this.glCanvas && this.program && this.texture) {
      const gl = this.gl;
      if (this.glCanvas.width !== stageW || this.glCanvas.height !== stageH) {
        this.glCanvas.width = stageW;
        this.glCanvas.height = stageH;
      }

      gl.viewport(0, 0, stageW, stageH);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

      gl.useProgram(this.program);
      gl.uniform2f(this.uStageSizeLoc, stageW, stageH);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        stagePos.subarray(0, needed),
        gl.DYNAMIC_DRAW
      );
      gl.enableVertexAttribArray(this.aPosLoc);
      gl.vertexAttribPointer(this.aPosLoc, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.uvs, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(this.aUvLoc);
      gl.vertexAttribPointer(this.aUvLoc, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);

      gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_SHORT, 0);

      targetCtx.drawImage(this.glCanvas, 0, 0);
      return;
    }

    // Seamless CPU Barycentric Scanline Fallback (zero hairline seams!)
    const outBuffer = new Uint8ClampedArray(stageW * stageH * 4);
    rasterizeMeshSoftware(
      outBuffer,
      stageW,
      stageH,
      stagePos,
      mesh.uvs,
      mesh.indices,
      this.texPixels,
      this.texWidth,
      this.texHeight
    );

    if (typeof document !== 'undefined') {
      const tmp = document.createElement('canvas');
      tmp.width = stageW;
      tmp.height = stageH;
      const tctx = tmp.getContext('2d')!;
      tctx.putImageData(new ImageData(outBuffer, stageW, stageH), 0, 0);
      targetCtx.drawImage(tmp, 0, 0);
    }
  }
}

/**
 * Pure TypedArray scanline barycentric textured mesh rasterizer.
 * Used both as automatic WebGL fallback and in headless tests.
 */
export function rasterizeMeshSoftware(
  dstRgba: Uint8ClampedArray,
  dstW: number,
  dstH: number,
  stagePositions: Float32Array,
  uvs: Float32Array,
  indices: Uint16Array,
  texRgba: Uint8ClampedArray,
  texW: number,
  texH: number
): void {
  const texMaxX = texW - 1;
  const texMaxY = texH - 1;

  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t];
    const i1 = indices[t + 1];
    const i2 = indices[t + 2];

    const x0 = stagePositions[i0 * 2],
      y0 = stagePositions[i0 * 2 + 1];
    const x1 = stagePositions[i1 * 2],
      y1 = stagePositions[i1 * 2 + 1];
    const x2 = stagePositions[i2 * 2],
      y2 = stagePositions[i2 * 2 + 1];

    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const maxX = Math.min(dstW - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const maxY = Math.min(dstH - 1, Math.ceil(Math.max(y0, y1, y2)));

    if (minX > maxX || minY > maxY) continue;

    const denom = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
    if (Math.abs(denom) < 1e-5) continue;
    const invDenom = 1 / denom;

    const u0 = uvs[i0 * 2],
      v0 = uvs[i0 * 2 + 1];
    const u1 = uvs[i1 * 2],
      v1 = uvs[i1 * 2 + 1];
    const u2 = uvs[i2 * 2],
      v2 = uvs[i2 * 2 + 1];

    const dW0x = (y1 - y2) * invDenom;
    const dW1x = (y2 - y0) * invDenom;

    for (let py = minY; py <= maxY; py++) {
      const cy = py + 0.5;
      let w0 =
        ((y1 - y2) * (minX + 0.5 - x2) + (x2 - x1) * (cy - y2)) * invDenom;
      let w1 =
        ((y2 - y0) * (minX + 0.5 - x2) + (x0 - x2) * (cy - y2)) * invDenom;

      const rowOffset = py * dstW;
      for (let px = minX; px <= maxX; px++) {
        const w2 = 1 - w0 - w1;
        if (w0 >= -1e-4 && w1 >= -1e-4 && w2 >= -1e-4) {
          const tu = clamp((w0 * u0 + w1 * u1 + w2 * u2) * texMaxX, 0, texMaxX);
          const tv = clamp((w0 * v0 + w1 * v1 + w2 * v2) * texMaxY, 0, texMaxY);

          const sx = Math.round(tu);
          const sy = Math.round(tv);
          const sIdx = (sy * texW + sx) * 4;
          const sa = texRgba[sIdx + 3];

          if (sa > 0) {
            const dIdx = (rowOffset + px) * 4;
            if (sa === 255 || dstRgba[dIdx + 3] === 0) {
              dstRgba[dIdx] = texRgba[sIdx];
              dstRgba[dIdx + 1] = texRgba[sIdx + 1];
              dstRgba[dIdx + 2] = texRgba[sIdx + 2];
              dstRgba[dIdx + 3] = sa;
            } else {
              const fa = sa / 255;
              const da = dstRgba[dIdx + 3] / 255;
              const outA = fa + da * (1 - fa);
              dstRgba[dIdx] = Math.round(
                (texRgba[sIdx] * fa + dstRgba[dIdx] * da * (1 - fa)) / outA
              );
              dstRgba[dIdx + 1] = Math.round(
                (texRgba[sIdx + 1] * fa + dstRgba[dIdx + 1] * da * (1 - fa)) /
                  outA
              );
              dstRgba[dIdx + 2] = Math.round(
                (texRgba[sIdx + 2] * fa + dstRgba[dIdx + 2] * da * (1 - fa)) /
                  outA
              );
              dstRgba[dIdx + 3] = Math.round(outA * 255);
            }
          }
        }
        w0 += dW0x;
        w1 += dW1x;
      }
    }
  }
}

/**
 * Renders a complete frame (Stage Background + Ground Shadow + Deformed Character
 * + Mouth Cavity/Viseme + Speech Bubble + Optional Editor Gizmos).
 */
export function renderSceneFrame(params: {
  ctx: CanvasRenderingContext2D;
  stageW: number;
  stageH: number;
  imgW: number;
  imgH: number;
  meshRenderer: PuppetMeshRenderer;
  mesh: PuppetMesh;
  rig: PuppetRig;
  pose: EvaluatedPose;
  animSettings: AnimationSettings;
  stageSettings: StageSettings;
  exportMode?: boolean;
  toolMode?: ViewportToolMode;
  showWireframe?: boolean;
  hoveredJointId?: string | null;
  selectedJointId?: string | null;
  penDraftPoints?: Vec2[];
  penCursorNorm?: Vec2 | null;
  hoveredPenVertIdx?: number | null;
  penTargetKind?: 'seam' | 'polygon';
  mouthSkinColor?: string | null;
  viewportCamera?: { zoom: number; panX: number; panY: number };
}): CharacterRect {
  const {
    ctx,
    stageW,
    stageH,
    imgW,
    imgH,
    meshRenderer,
    mesh,
    rig,
    pose,
    animSettings,
    stageSettings,
    exportMode = false,
    toolMode = 'animate',
    showWireframe = false,
    hoveredJointId = null,
    selectedJointId = null,
    penDraftPoints = [],
    penCursorNorm = null,
    hoveredPenVertIdx = null,
    penTargetKind = 'seam',
    mouthSkinColor = null,
    viewportCamera,
  } = params;

  ctx.clearRect(0, 0, stageW, stageH);

  // 1. Background
  const bg = stageSettings.backgroundStyle;
  if (bg !== 'transparent') {
    if (bg === 'solid') {
      ctx.fillStyle = stageSettings.solidColor || '#1e293b';
      ctx.fillRect(0, 0, stageW, stageH);
    } else if (bg === 'green_screen') {
      ctx.fillStyle = '#00b140';
      ctx.fillRect(0, 0, stageW, stageH);
    } else if (bg === 'gradient_indigo') {
      const grad = ctx.createLinearGradient(0, 0, stageW, stageH);
      grad.addColorStop(0, '#1e1b4b');
      grad.addColorStop(0.5, '#312e81');
      grad.addColorStop(1, '#0f172a');
      ctx.fillRect(0, 0, stageW, stageH);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, stageW, stageH);
    } else if (bg === 'gradient_sunset') {
      const grad = ctx.createLinearGradient(0, 0, stageW, stageH);
      grad.addColorStop(0, '#4c1d95');
      grad.addColorStop(0.55, '#be185d');
      grad.addColorStop(1, '#fb923c');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, stageW, stageH);
    } else if (bg === 'gradient_mint') {
      const grad = ctx.createLinearGradient(0, 0, 0, stageH);
      grad.addColorStop(0, '#ecfeff');
      grad.addColorStop(1, '#a7f3d0');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, stageW, stageH);
    }
  }

  const hasBubble =
    animSettings.showSpeechBubble && animSettings.dialogueText.trim().length > 0;
  const baseCharRect = computeCharacterRect(
    stageW,
    stageH,
    imgW,
    imgH,
    stageSettings.characterScale,
    hasBubble,
    stageSettings.characterOffsetX ?? 0,
    stageSettings.characterOffsetY ?? 0
  );
  const cam =
    !exportMode && viewportCamera
      ? viewportCamera
      : { zoom: 1, panX: 0, panY: 0 };
  const charRect: CharacterRect = {
    x: stageW * 0.5 + (baseCharRect.x - stageW * 0.5) * cam.zoom + cam.panX,
    y: stageH * 0.5 + (baseCharRect.y - stageH * 0.5) * cam.zoom + cam.panY,
    w: baseCharRect.w * cam.zoom,
    h: baseCharRect.h * cam.zoom,
  };

  // 2. Dynamic Ground Shadow (shrinks softly when character jumps!)
  if (
    stageSettings.groundShadow &&
    rig.mode !== 'portrait' &&
    !(exportMode && bg === 'transparent')
  ) {
    // Soft dynamic shadow beneath character feet
    const liftFactor = clamp(1 - pose.groundLift * 3.2, 0.35, 1.0);
    const hipPos = pose.worldJoints['hips'] || { x: 0.5, y: 0.65 };
    const shadowX = charRect.x + hipPos.x * charRect.w;
    const shadowY = charRect.y + 0.91 * charRect.h;
    const radX = charRect.w * 0.24 * liftFactor;
    const radY = charRect.h * 0.032 * liftFactor;

    ctx.save();
    ctx.fillStyle = `rgba(10, 14, 26, ${(0.34 * liftFactor).toFixed(2)})`;
    ctx.beginPath();
    ctx.ellipse(shadowX, shadowY, radX, radY, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 3. Deformed Character Mesh
  meshRenderer.drawDeformedCharacter(ctx, stageW, stageH, mesh, charRect);

  // 4. Mouth Cavity / Cartoon Viseme Overlay (locked to Head bone transform!)
  if (animSettings.mouthStyle === 'cutout_jaw' && pose.mouthOpen > 0.02) {
    drawCutoutMouthCavity(ctx, charRect, rig, pose);
  } else if (animSettings.mouthStyle === 'cartoon_viseme') {
    drawCartoonVisemeMouth(ctx, charRect, rig, pose, mouthSkinColor);
  }

  // 5. Optional Animated Speech Bubble
  if (hasBubble) {
    drawSpeechBubble(
      ctx,
      stageW,
      stageH,
      charRect,
      rig,
      pose,
      animSettings.dialogueText.trim(),
      animSettings.speechBubblePos
    );
  }

  // 6. Viewport Editor Overlays (NEVER drawn during GIF export!)
  if (!exportMode) {
    if (
      Math.abs(cam.zoom - 1) > 0.02 ||
      Math.abs(cam.panX) > 2 ||
      Math.abs(cam.panY) > 2
    ) {
      const fx = stageW * 0.5 + (0 - stageW * 0.5) * cam.zoom + cam.panX;
      const fy = stageH * 0.5 + (0 - stageH * 0.5) * cam.zoom + cam.panY;
      const fw = stageW * cam.zoom;
      const fh = stageH * cam.zoom;
      ctx.save();
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.45)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(fx, fy, fw, fh);
      ctx.restore();
    }

    if (showWireframe) {
      drawMeshWireframe(ctx, mesh, charRect);
    }
    drawEditorGizmos(
      ctx,
      charRect,
      rig,
      pose,
      toolMode,
      animSettings.mouthStyle !== 'none',
      hoveredJointId,
      selectedJointId,
      penDraftPoints,
      penCursorNorm,
      hoveredPenVertIdx,
      penTargetKind
    );
  }

  return charRect;
}

function traceSmoothClosedPoly(
  ctx: CanvasRenderingContext2D,
  pts: Vec2[]
): void {
  const n = pts.length;
  if (n < 3) return;
  ctx.beginPath();
  const mid0x = (pts[n - 1].x + pts[0].x) * 0.5;
  const mid0y = (pts[n - 1].y + pts[0].y) * 0.5;
  ctx.moveTo(mid0x, mid0y);
  for (let i = 0; i < n; i++) {
    const next = pts[(i + 1) % n];
    const mx = (pts[i].x + next.x) * 0.5;
    const my = (pts[i].y + next.y) * 0.5;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  ctx.closePath();
}

function traceSmoothOpenCurve(
  ctx: CanvasRenderingContext2D,
  pts: Vec2[]
): void {
  const n = pts.length;
  if (n < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < n - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) * 0.5;
    const my = (pts[i].y + pts[i + 1].y) * 0.5;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  ctx.lineTo(pts[n - 1].x, pts[n - 1].y);
}

function drawCutoutMouthCavity(
  ctx: CanvasRenderingContext2D,
  charRect: CharacterRect,
  rig: PuppetRig,
  pose: EvaluatedPose
): void {
  const cm = compileMouthGeometry(rig.mouth);
  const { upperPts, lowerPts, closedPolygon } =
    buildAnimatedCustomMouthPolygons(
      cm,
      pose.mouthOpen,
      pose.mouthWide,
      pose.viseme
    );
  if (closedPolygon.length < 4) return;

  const toStage = (pt: Vec2): Vec2 => {
    const xf = transformHeadPoint(pt, rig, pose);
    return {
      x: charRect.x + xf.pos.x * charRect.w,
      y: charRect.y + xf.pos.y * charRect.h,
    };
  };

  const stagePoly = closedPolygon.map(toStage);
  const stageUpper = upperPts.map(toStage);
  const stageLower = lowerPts.map(toStage);

  const midIdx = stageUpper.length >> 1;
  const openPx = Math.hypot(
    stageLower[midIdx].x - stageUpper[midIdx].x,
    stageLower[midIdx].y - stageUpper[midIdx].y
  );
  if (openPx < 1.1) return;

  // Smooth fade-in on very tiny openings so closed-to-open transition is 100% seamless
  const alphaFade = clamp((pose.mouthOpen - 0.015) / 0.06, 0, 1);

  ctx.save();
  ctx.globalAlpha = alphaFade;

  // 1. Fill natural shaded inner mouth cavity
  traceSmoothClosedPoly(ctx, stagePoly);
  const baseColor = rig.mouth.interiorColor || '#3b0a18';
  const grad = ctx.createLinearGradient(
    stageUpper[midIdx].x,
    stageUpper[midIdx].y,
    stageLower[midIdx].x,
    stageLower[midIdx].y
  );
  grad.addColorStop(0, '#1f040d');
  grad.addColorStop(0.55, baseColor);
  grad.addColorStop(1, '#581026');
  ctx.fillStyle = grad;
  ctx.fill();

  // 2. Strictly clip interior teeth & tongue inside stagePoly!
  ctx.save();
  traceSmoothClosedPoly(ctx, stagePoly);
  ctx.clip();

  if (rig.mouth.showTeeth && openPx > 4.5) {
    const i0 = Math.max(1, Math.floor(stageUpper.length * 0.16));
    const i1 = Math.min(
      stageUpper.length - 2,
      Math.ceil(stageUpper.length * 0.84)
    );
    const teethThick = Math.min(openPx * 0.32, charRect.h * 0.026);
    const nx = cm.normalDown.x * teethThick;
    const ny = cm.normalDown.y * teethThick;

    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.moveTo(stageUpper[i0].x - nx * 0.4, stageUpper[i0].y - ny * 0.4);
    for (let i = i0 + 1; i <= i1; i++) {
      ctx.lineTo(stageUpper[i].x - nx * 0.4, stageUpper[i].y - ny * 0.4);
    }
    for (let i = i1; i >= i0; i--) {
      const env = Math.sin(
        (Math.PI * (i - i0)) / Math.max(1, i1 - i0)
      );
      ctx.lineTo(
        stageUpper[i].x + nx * (0.45 + 0.55 * env),
        stageUpper[i].y + ny * (0.45 + 0.55 * env)
      );
    }
    ctx.closePath();
    ctx.fill();
  }

  if (rig.mouth.showTongue && openPx > 6) {
    const midLower = stageLower[midIdx];
    const tongueRx = Math.max(3.5, cm.spanWidth * charRect.w * 0.25);
    const tongueRy = Math.max(2.5, openPx * 0.36);
    const headRot =
      pose.worldRotations[
        rig.joints.find((j) => j.id === 'head')?.id || ''
      ] || 0;

    ctx.save();
    ctx.translate(
      midLower.x - cm.normalDown.x * tongueRy * 0.32,
      midLower.y - cm.normalDown.y * tongueRy * 0.32
    );
    ctx.rotate(headRot + cm.tiltAngle);
    ctx.fillStyle = '#f43f5e';
    ctx.beginPath();
    ctx.ellipse(0, 0, tongueRx, tongueRy, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.restore(); // end clip

  // 3. Re-trace ONLY the outer lip contour (NEVER the tongue path!) for a soft natural lip shadow
  traceSmoothClosedPoly(ctx, stagePoly);
  ctx.strokeStyle = 'rgba(24, 12, 24, 0.42)';
  ctx.lineWidth = Math.max(1.1, charRect.w * 0.0028);
  ctx.lineJoin = 'round';
  ctx.stroke();

  ctx.restore();
}

function drawCartoonVisemeMouth(
  ctx: CanvasRenderingContext2D,
  charRect: CharacterRect,
  rig: PuppetRig,
  pose: EvaluatedPose,
  mouthSkinColor: string | null = null
): void {
  const cm = compileMouthGeometry(rig.mouth);
  const toStage = (pt: Vec2): Vec2 => {
    const xf = transformHeadPoint(pt, rig, pose);
    return {
      x: charRect.x + xf.pos.x * charRect.w,
      y: charRect.y + xf.pos.y * charRect.h,
    };
  };

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Step 1: Softly conceal the photo's static drawn mouth with local skin tone so nothing peeks out!
  if (mouthSkinColor && cm.outline.length >= 4) {
    const restCoverPoly = cm.outline.map(toStage);
    traceSmoothClosedPoly(ctx, restCoverPoly);
    ctx.fillStyle = mouthSkinColor;
    ctx.fill();
    ctx.strokeStyle = mouthSkinColor;
    ctx.lineWidth = Math.max(3, charRect.w * 0.009);
    ctx.stroke();
  }

  const strokeW = Math.max(2, charRect.w * 0.0058);
  const open = pose.mouthOpen;
  const viseme = pose.viseme;

  // Step 2: Closed / Smile / 'M' -> draw clean organic curve right along the character's curved seam!
  if (open < 0.08 || viseme === 'M' || viseme === 'rest' || viseme === 'smile') {
    const { seamPts } = buildAnimatedCustomMouthPolygons(
      cm,
      0,
      viseme === 'M' ? -0.08 : 0.14,
      viseme
    );
    const stageSeam = seamPts.map(toStage);
    traceSmoothOpenCurve(ctx, stageSeam);
    ctx.strokeStyle = '#1e1b4b';
    ctx.lineWidth = strokeW;
    ctx.stroke();
    ctx.restore();
    return;
  }

  // Step 3: Expressive Open Cartoon Viseme following the exact curved mouth contour!
  const { upperPts, lowerPts, closedPolygon } =
    buildAnimatedCustomMouthPolygons(
      cm,
      open * 1.08,
      pose.mouthWide,
      viseme
    );
  const stagePoly = closedPolygon.map(toStage);
  const stageUpper = upperPts.map(toStage);
  const stageLower = lowerPts.map(toStage);
  const midIdx = stageUpper.length >> 1;
  const openPx = Math.hypot(
    stageLower[midIdx].x - stageUpper[midIdx].x,
    stageLower[midIdx].y - stageUpper[midIdx].y
  );

  traceSmoothClosedPoly(ctx, stagePoly);
  ctx.fillStyle = rig.mouth.interiorColor || '#4c0519';
  ctx.fill();

  ctx.save();
  traceSmoothClosedPoly(ctx, stagePoly);
  ctx.clip();

  if (rig.mouth.showTeeth && openPx > 4) {
    const i0 = Math.max(1, Math.floor(stageUpper.length * 0.14));
    const i1 = Math.min(
      stageUpper.length - 2,
      Math.ceil(stageUpper.length * 0.86)
    );
    const teethThick = Math.min(openPx * 0.36, charRect.h * 0.03);
    const nx = cm.normalDown.x * teethThick;
    const ny = cm.normalDown.y * teethThick;

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(stageUpper[i0].x - nx * 0.5, stageUpper[i0].y - ny * 0.5);
    for (let i = i0 + 1; i <= i1; i++) {
      ctx.lineTo(stageUpper[i].x - nx * 0.5, stageUpper[i].y - ny * 0.5);
    }
    for (let i = i1; i >= i0; i--) {
      ctx.lineTo(stageUpper[i].x + nx, stageUpper[i].y + ny);
    }
    ctx.closePath();
    ctx.fill();
  }

  if (rig.mouth.showTongue && openPx > 5) {
    const midLower = stageLower[midIdx];
    const tongueRx = Math.max(4, cm.spanWidth * charRect.w * 0.28);
    const tongueRy = Math.max(3, openPx * 0.4);
    const headRot =
      pose.worldRotations[
        rig.joints.find((j) => j.id === 'head')?.id || ''
      ] || 0;
    ctx.save();
    ctx.translate(
      midLower.x - cm.normalDown.x * tongueRy * 0.25,
      midLower.y - cm.normalDown.y * tongueRy * 0.25
    );
    ctx.rotate(headRot + cm.tiltAngle);
    ctx.fillStyle = '#fb7185';
    ctx.beginPath();
    ctx.ellipse(0, 0, tongueRx, tongueRy, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.restore(); // end clip

  // Re-trace outer cartoon mouth contour cleanly before stroking!
  traceSmoothClosedPoly(ctx, stagePoly);
  ctx.strokeStyle = '#1e1b4b';
  ctx.lineWidth = strokeW;
  ctx.stroke();

  ctx.restore();
}

function drawSpeechBubble(
  ctx: CanvasRenderingContext2D,
  stageW: number,
  stageH: number,
  charRect: CharacterRect,
  rig: PuppetRig,
  pose: EvaluatedPose,
  text: string,
  posSide: 'top-right' | 'top-left'
): void {
  const headXf = transformHeadPoint(
    rig.joints.find((j) => j.id === 'head')?.rest || { x: 0.5, y: 0.2 },
    rig,
    pose
  );
  const headStageX = charRect.x + headXf.pos.x * charRect.w;
  const headStageY = charRect.y + headXf.pos.y * charRect.h;

  const fontSize = clamp(Math.round(stageW * 0.036), 13, 24);
  ctx.save();
  ctx.font = `700 ${fontSize}px Vazirmatn, system-ui, sans-serif`;
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Simple word-wrap up to 2 lines
  const maxBubbleW = stageW * 0.72;
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let curLine = '';
  for (const w of words) {
    const test = curLine ? `${curLine} ${w}` : w;
    if (ctx.measureText(test).width > maxBubbleW - 28 && curLine) {
      lines.push(curLine);
      curLine = w;
      if (lines.length >= 2) break;
    } else {
      curLine = test;
    }
  }
  if (curLine && lines.length < 3) lines.push(curLine);

  let textMaxW = 60;
  for (const l of lines) {
    textMaxW = Math.max(textMaxW, ctx.measureText(l).width);
  }

  const padX = fontSize * 0.95;
  const padY = fontSize * 0.65;
  const lineH = fontSize * 1.42;
  const bw = Math.min(stageW * 0.86, textMaxW + padX * 2);
  const bh = lines.length * lineH + padY * 1.6;

  // Subtle lively float synced with mouth openness
  const bob = -pose.mouthOpen * 3.5;
  const bx =
    posSide === 'top-right'
      ? clamp(headStageX + charRect.w * 0.06, stageW * 0.06, stageW - bw - stageW * 0.05)
      : clamp(headStageX - bw - charRect.w * 0.06, stageW * 0.05, stageW - bw - stageW * 0.06);
  const by = clamp(
    Math.min(charRect.y * 0.35, headStageY - bh - charRect.h * 0.14) + bob,
    stageH * 0.03,
    stageH * 0.32
  );

  const r = Math.min(18, bh * 0.35);

  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = Math.max(2.5, stageW * 0.005);

  // Bubble + Tail path
  const tailBaseX = clamp(headStageX, bx + r + 8, bx + bw - r - 8);
  const tailTipX = clamp(headStageX, bx - 18, bx + bw + 18);
  const tailTipY = Math.max(by + bh + 12, Math.min(by + bh + 24, headStageY - 14));

  ctx.beginPath();
  ctx.moveTo(bx + r, by);
  ctx.lineTo(bx + bw - r, by);
  ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + r);
  ctx.lineTo(bx + bw, by + bh - r);
  ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - r, by + bh);
  ctx.lineTo(Math.min(bx + bw - r, tailBaseX + 9), by + bh);
  ctx.lineTo(tailTipX, tailTipY);
  ctx.lineTo(Math.max(bx + r, tailBaseX - 9), by + bh);
  ctx.lineTo(bx + r, by + bh);
  ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - r);
  ctx.lineTo(bx, by + r);
  ctx.quadraticCurveTo(bx, by, bx + r, by);
  ctx.closePath();

  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#0f172a';
  const startY = by + bh * 0.5 - ((lines.length - 1) * lineH) * 0.5;
  lines.forEach((line, i) => {
    ctx.fillText(line, bx + bw * 0.5, startY + i * lineH);
  });

  ctx.restore();
}

function drawMeshWireframe(
  ctx: CanvasRenderingContext2D,
  mesh: PuppetMesh,
  charRect: CharacterRect
): void {
  const pos = mesh.deformedPositions;
  const tris = mesh.indices;

  ctx.save();
  ctx.strokeStyle = 'rgba(129, 140, 248, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i] * 2;
    const b = tris[i + 1] * 2;
    const c = tris[i + 2] * 2;

    const ax = charRect.x + pos[a] * charRect.w;
    const ay = charRect.y + pos[a + 1] * charRect.h;
    const bx = charRect.x + pos[b] * charRect.w;
    const by = charRect.y + pos[b + 1] * charRect.h;
    const cx = charRect.x + pos[c] * charRect.w;
    const cy = charRect.y + pos[c + 1] * charRect.h;

    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.lineTo(cx, cy);
    ctx.lineTo(ax, ay);
  }
  ctx.stroke();
  ctx.restore();
}

function drawEditorGizmos(
  ctx: CanvasRenderingContext2D,
  charRect: CharacterRect,
  rig: PuppetRig,
  pose: EvaluatedPose,
  toolMode: ViewportToolMode,
  showMouthGizmo: boolean,
  hoveredJointId: string | null,
  selectedJointId: string | null,
  penDraftPoints: Vec2[] = [],
  penCursorNorm: Vec2 | null = null,
  hoveredPenVertIdx: number | null = null,
  penTargetKind: 'seam' | 'polygon' = 'seam'
): void {
  const isSetup = toolMode === 'setup_rig';
  const isPen = toolMode === 'pen_mouth';
  ctx.save();

  const getJointPos = (id: string, rest: { x: number; y: number }) => {
    const p = isSetup || isPen ? rest : pose.worldJoints[id] || rest;
    return {
      x: charRect.x + p.x * charRect.w,
      y: charRect.y + p.y * charRect.h,
    };
  };

  // Draw Bone Connections (compact & subtle in Animate mode so 14-18 pins stay super clean)
  const jointMap = new Map(rig.joints.map((j) => [j.id, j]));
  ctx.lineWidth = isSetup ? 2.2 : isPen ? 1.0 : 1.3;
  ctx.strokeStyle = isSetup
    ? 'rgba(56, 189, 248, 0.65)'
    : isPen
    ? 'rgba(148, 163, 184, 0.14)'
    : 'rgba(148, 163, 184, 0.22)';

  for (const j of rig.joints) {
    if (!j.parentId || !jointMap.has(j.parentId)) continue;
    const parent = jointMap.get(j.parentId)!;
    const pA = getJointPos(parent.id, parent.rest);
    const pB = getJointPos(j.id, j.rest);

    ctx.beginPath();
    ctx.moveTo(pA.x, pA.y);
    ctx.lineTo(pB.x, pB.y);
    ctx.stroke();
  }

  // Dedicated Pen Mouth Tool Overlay!
  if (isPen) {
    drawPenMouthEditorOverlay(
      ctx,
      charRect,
      rig,
      penDraftPoints,
      penCursorNorm,
      hoveredPenVertIdx,
      penTargetKind
    );
    ctx.restore();
    return;
  }

  // Draw Mouth Gizmo in Setup Mode (or subtly when hovered in Animate Mode)
  if (
    showMouthGizmo &&
    (isSetup ||
      hoveredJointId === '__mouth__' ||
      hoveredJointId === '__mouth_resize__' ||
      hoveredJointId === '__mouth_arch__')
  ) {
    const customMouth = compileCustomMouth(rig.mouth);
    const toStage = (pt: Vec2): Vec2 => {
      if (isSetup) {
        return {
          x: charRect.x + pt.x * charRect.w,
          y: charRect.y + pt.y * charRect.h,
        };
      }
      const xf = transformHeadPoint(pt, rig, pose);
      return {
        x: charRect.x + xf.pos.x * charRect.w,
        y: charRect.y + xf.pos.y * charRect.h,
      };
    };

    if (customMouth) {
      ctx.save();
      const stageOut = customMouth.outline.map(toStage);
      if (stageOut.length >= 3) {
        traceSmoothClosedPoly(ctx, stageOut);
        ctx.fillStyle = 'rgba(232, 121, 249, 0.15)';
        ctx.fill();
        ctx.setLineDash([5, 3]);
        ctx.strokeStyle =
          hoveredJointId === '__mouth__' ? '#f0abfc' : '#e879f9';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      const stageSeam = customMouth.seam.map(toStage);
      ctx.setLineDash([]);
      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 2;
      traceSmoothOpenCurve(ctx, stageSeam);
      ctx.stroke();

      if (isSetup) {
        const cStage = toStage(customMouth.center);
        ctx.font = '600 11px Vazirmatn, sans-serif';
        ctx.fillStyle = '#fae8ff';
        ctx.textAlign = 'center';
        ctx.fillText('دهان سفارشی (Pen)', cStage.x, cStage.y - 16);
      }
      ctx.restore();
    } else {
      // Curved Default Mouth Gizmo (with interactive middle Smile/Arch bend handle!)
      const cmDefault = compileMouthGeometry(rig.mouth);
      const stageOut = cmDefault.outline.map(toStage);
      const stageSeam = cmDefault.seam.map(toStage);
      const mCenter = toStage(rig.mouth.center);
      const rx = rig.mouth.rx * charRect.w;
      const ry = rig.mouth.ry * charRect.h;

      ctx.save();
      if (stageOut.length >= 3) {
        traceSmoothClosedPoly(ctx, stageOut);
        ctx.fillStyle = 'rgba(244, 63, 94, 0.14)';
        ctx.fill();
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle =
          hoveredJointId === '__mouth__' ? '#fda4af' : '#fb7185';
        ctx.lineWidth = 1.8;
        ctx.stroke();
      }

      // Curved lip seam line!
      ctx.setLineDash([]);
      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 2.2;
      traceSmoothOpenCurve(ctx, stageSeam);
      ctx.stroke();

      if (isSetup) {
        // Right width resize handle
        const hx = mCenter.x + rx * 0.92;
        const hy = stageSeam[stageSeam.length - 1].y;
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#e11d48';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(hx, hy, 5.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Middle smile/arch bend handle!
        const midSeam = stageSeam[stageSeam.length >> 1];
        ctx.fillStyle =
          hoveredJointId === '__mouth_arch__' ? '#fde047' : '#38bdf8';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(midSeam.x, midSeam.y, 4.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.font = '600 11px Vazirmatn, sans-serif';
        ctx.fillStyle = '#ffe4e6';
        ctx.textAlign = 'center';
        ctx.fillText('خط لب منحنی', mCenter.x, mCenter.y - ry - 9);
      }
      ctx.restore();
    }
  }

  // Draw Joint Handles (clean & subtle in Animate mode so 14-18 pins never look cluttered!)
  for (const j of rig.joints) {
    const pos = getJointPos(j.id, j.rest);
    const isHovered = hoveredJointId === j.id;
    const isSelected = selectedJointId === j.id;
    const radius =
      isHovered || isSelected ? 8.2 : isSetup ? 6.4 : j.pinned ? 3.8 : 4.3;

    ctx.beginPath();
    ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = j.pinned ? '#ef4444' : j.color;
    ctx.globalAlpha =
      isSetup || isHovered || isSelected ? 0.94 : j.pinned ? 0.42 : 0.56;
    ctx.fill();

    ctx.lineWidth = isSelected ? 2.8 : isSetup ? 1.8 : 1.3;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (j.pinned && (isSetup || isHovered || isSelected)) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(pos.x - 2.6, pos.y - 2.6);
      ctx.lineTo(pos.x + 2.6, pos.y + 2.6);
      ctx.moveTo(pos.x + 2.6, pos.y - 2.6);
      ctx.lineTo(pos.x - 2.6, pos.y + 2.6);
      ctx.stroke();
    }

    if (isHovered || (isSetup && isSelected)) {
      ctx.font = '600 11px Vazirmatn, sans-serif';
      const label = j.pinned ? `${j.nameFa} (ثابت)` : j.nameFa;
      const tw = ctx.measureText(label).width + 12;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.fillRect(pos.x - tw * 0.5, pos.y - radius - 24, tw, 19);
      ctx.fillStyle = '#f8fafc';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, pos.x, pos.y - radius - 14.5);
    }
  }

  ctx.restore();
}

function drawPenMouthEditorOverlay(
  ctx: CanvasRenderingContext2D,
  charRect: CharacterRect,
  rig: PuppetRig,
  penDraftPoints: Vec2[],
  penCursorNorm: Vec2 | null,
  hoveredPenVertIdx: number | null,
  penTargetKind: 'seam' | 'polygon' = 'seam'
): void {
  const toStage = (p: Vec2): Vec2 => ({
    x: charRect.x + p.x * charRect.w,
    y: charRect.y + p.y * charRect.h,
  });

  ctx.save();

  // Case A: User is actively placing new Pen points (`penDraftPoints.length > 0`)
  if (penDraftPoints.length > 0) {
    const stagePts = penDraftPoints.map(toStage);
    const cursorStage = penCursorNorm ? toStage(penCursorNorm) : null;

    let nearFirstPoint = false;
    if (cursorStage && penDraftPoints.length >= 3) {
      const distFirst = Math.hypot(
        cursorStage.x - stagePts[0].x,
        cursorStage.y - stagePts[0].y
      );
      nearFirstPoint = distFirst <= 13;
    }

    // Preview fill ONLY when drawing polygon or hovering start ring
    if (
      stagePts.length >= 3 &&
      (penTargetKind === 'polygon' || nearFirstPoint)
    ) {
      const densePoly = subdivideCatmullRom(penDraftPoints, true, 4).map(
        toStage
      );
      traceSmoothClosedPoly(ctx, densePoly);
      ctx.fillStyle = 'rgba(217, 70, 239, 0.14)';
      ctx.fill();
    }

    // Live smooth spline preview through placed points (follows uneven lip curvature!)
    const smoothDraft =
      penDraftPoints.length >= 2
        ? subdivideCatmullRom(penDraftPoints, false, 5).map(toStage)
        : stagePts;

    ctx.strokeStyle = '#fde047';
    ctx.lineWidth = 2.6;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(smoothDraft[0].x, smoothDraft[0].y);
    for (let i = 1; i < smoothDraft.length; i++) {
      ctx.lineTo(smoothDraft[i].x, smoothDraft[i].y);
    }
    ctx.stroke();

    // Rubber-band preview line to cursor
    if (cursorStage) {
      const snapTarget = nearFirstPoint ? stagePts[0] : cursorStage;
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = nearFirstPoint ? '#34d399' : '#38bdf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(
        stagePts[stagePts.length - 1].x,
        stagePts[stagePts.length - 1].y
      );
      ctx.lineTo(snapTarget.x, snapTarget.y);
      ctx.stroke();
      ctx.restore();
    }

    // Draw placed Pen anchor points
    for (let i = 0; i < stagePts.length; i++) {
      const sp = stagePts[i];
      const isStart = i === 0;

      if (isStart && nearFirstPoint) {
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 12, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(16, 185, 129, 0.28)';
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(sp.x, sp.y, isStart ? 6.2 : 5, 0, Math.PI * 2);
      ctx.fillStyle = isStart ? '#10b981' : '#ffffff';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = isStart ? '#ecfdf5' : '#0284c7';
      ctx.stroke();
    }

    if (nearFirstPoint) {
      ctx.font = '700 11px Vazirmatn, sans-serif';
      const msg = 'کلیک برای بستن دور دهان ✓';
      const w = ctx.measureText(msg).width + 14;
      ctx.fillStyle = 'rgba(6, 78, 59, 0.92)';
      ctx.fillRect(stagePts[0].x - w * 0.5, stagePts[0].y - 30, w, 20);
      ctx.fillStyle = '#a7f3d0';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(msg, stagePts[0].x, stagePts[0].y - 20);
    }

    ctx.restore();
    return;
  }

  // Case B: Editing an existing Custom Pen Mouth (`rig.mouth.customPath`)
  const customPath = rig.mouth.customPath;
  const compiled = compileCustomMouth(rig.mouth);
  if (customPath && compiled) {
    const stageOutline = compiled.outline.map(toStage);
    const stageUpper = compiled.upperChain.map(toStage);
    const stageLower = compiled.lowerChain.map(toStage);
    const stageSeam = compiled.seam.map(toStage);

    // Subtle interior fill
    if (stageOutline.length >= 3) {
      ctx.beginPath();
      ctx.moveTo(stageOutline[0].x, stageOutline[0].y);
      for (let i = 1; i < stageOutline.length; i++) {
        ctx.lineTo(stageOutline[i].x, stageOutline[i].y);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(217, 70, 239, 0.14)';
      ctx.fill();
    }

    // Upper lip curve (Sky Cyan)
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    for (let i = 0; i < stageUpper.length; i++) {
      if (i === 0) ctx.moveTo(stageUpper[i].x, stageUpper[i].y);
      else ctx.lineTo(stageUpper[i].x, stageUpper[i].y);
    }
    ctx.stroke();

    // Lower jaw curve (Rose Pink)
    ctx.strokeStyle = '#fb7185';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    for (let i = 0; i < stageLower.length; i++) {
      if (i === 0) ctx.moveTo(stageLower[i].x, stageLower[i].y);
      else ctx.lineTo(stageLower[i].x, stageLower[i].y);
    }
    ctx.stroke();

    // Uneven Lip Parting Seam (Gold Dashed)
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = '#fde047';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    for (let i = 0; i < stageSeam.length; i++) {
      if (i === 0) ctx.moveTo(stageSeam[i].x, stageSeam[i].y);
      else ctx.lineTo(stageSeam[i].x, stageSeam[i].y);
    }
    ctx.stroke();
    ctx.restore();

    // Jaw opening direction indicator arrow from seam center
    const cStage = toStage(compiled.center);
    const arrowLen = 18;
    const ax = cStage.x + compiled.normalDown.x * arrowLen;
    const ay = cStage.y + compiled.normalDown.y * arrowLen;
    ctx.strokeStyle = 'rgba(253, 224, 71, 0.85)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(cStage.x, cStage.y);
    ctx.lineTo(ax, ay);
    ctx.stroke();
    ctx.fillStyle = '#fde047';
    ctx.beginPath();
    ctx.arc(ax, ay, 2.8, 0, Math.PI * 2);
    ctx.fill();

    // Corner L/R pins
    for (const corner of [compiled.cornerLeft, compiled.cornerRight]) {
      const cp = toStage(corner);
      ctx.beginPath();
      ctx.arc(cp.x, cp.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#fde047';
      ctx.fill();
    }

    // Segment Midpoint '+' handles for inserting extra points
    const ctrlStage = customPath.points.map(toStage);
    const edgeCount =
      customPath.kind === 'polygon' ? ctrlStage.length : ctrlStage.length - 1;
    for (let i = 0; i < edgeCount; i++) {
      const a = ctrlStage[i];
      const b = ctrlStage[(i + 1) % ctrlStage.length];
      if (Math.hypot(b.x - a.x, b.y - a.y) < 22) continue;
      const mx = (a.x + b.x) * 0.5;
      const my = (a.y + b.y) * 0.5;
      ctx.beginPath();
      ctx.arc(mx, my, 4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(232, 121, 249, 0.75)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // Editable Pen Control Anchor Handles (squares like vector Pen anchors!)
    for (let i = 0; i < ctrlStage.length; i++) {
      const p = ctrlStage[i];
      const hovered = hoveredPenVertIdx === i;
      const half = hovered ? 6.5 : 4.8;

      ctx.fillStyle = hovered ? '#f0abfc' : '#ffffff';
      ctx.strokeStyle = hovered ? '#701a75' : '#c026d3';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.rect(p.x - half, p.y - half, half * 2, half * 2);
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();
    return;
  }

  // Case C: No custom path yet & no points placed yet -> show faint reference around current mouth
  const refCenter = toStage(rig.mouth.center);
  const rx = rig.mouth.rx * charRect.w;
  const ry = rig.mouth.ry * charRect.h;
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = 'rgba(244, 114, 182, 0.45)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(refCenter.x, refCenter.y, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();

  if (penCursorNorm) {
    const cs = toStage(penCursorNorm);
    ctx.setLineDash([]);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cs.x, cs.y, 5, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}
