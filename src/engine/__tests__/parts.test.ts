import { describe, expect, it } from 'vitest';
import { ImagePart, partMotionAt, pointInPolygon, splitPartPixels, drawImageParts } from '../parts';
import { EvaluatedPose, PuppetRig } from '../types';

const square = [{x:0,y:0},{x:0.5,y:0},{x:0.5,y:1},{x:0,y:1}];
const part: ImagePart = { id:'a', name:'arm', points:square, jointId:'', motion:'swing', intensity:1 };

describe('manual image parts', () => {
  it('tests polygon interiors and extracts each pixel once, preserving alpha', () => {
    expect(pointInPolygon(.25,.5,square)).toBe(true);
    expect(pointInPolygon(.75,.5,square)).toBe(false);
    const rgba = new Uint8ClampedArray([10,20,30,128, 40,50,60,255, 70,80,90,0, 100,110,120,255]);
    const result = splitPartPixels(rgba, 2, 2, [part, {...part,id:'b'}]);
    expect(result.base[3]).toBe(0);
    expect(result.layers[0].slice(0,4)).toEqual(rgba.slice(0,4));
    expect(result.layers[1].every(x => x === 0)).toBe(true);
    expect(result.base[7]).toBe(255);
    expect(result.base[11]).toBe(0);
    expect(result.layers[0][11]).toBe(0);
  });
  it('restores pixels when a part is removed', () => {
    const rgba = new Uint8ClampedArray([1,2,3,255, 4,5,6,255]);
    expect(splitPartPixels(rgba, 2, 1, []).base).toEqual(rgba);
    expect(rgba[3]).toBe(255);
  });
  it.each(['none', 'swing', 'bounce', 'pulse', 'flutter'] as const)('%s is seamless and stops at zero intensity', motion => {
    const a = partMotionAt(motion, 0, 1), b = partMotionAt(motion, 1, 1);
    for (const key of ['rotation', 'x', 'y', 'scale'] as const) expect(a[key]).toBeCloseTo(b[key], 10);
    const stopped = partMotionAt(motion, .25, 0);
    expect(Math.abs(stopped.rotation) + Math.abs(stopped.x) + Math.abs(stopped.y)).toBe(0);
    expect(stopped.scale).toBe(1);
  });
  it('uses evaluated joint transforms and falls back safely if the joint was removed', () => {
    const calls: unknown[][] = [];
    const ctx = Object.fromEntries(['save','restore','translate','rotate','scale','drawImage'].map(name => [name, (...args: unknown[]) => calls.push([name, ...args])])) as unknown as CanvasRenderingContext2D;
    const rig = { joints: [{id:'joint',rest:{x:.2,y:.3}}] } as PuppetRig;
    const pose = {worldJoints:{joint:{x:.4,y:.5}},worldRotations:{joint:.2},worldScales:{joint:{x:1,y:1}},mouthOpen:0,mouthWide:0,viseme:'rest',browLift:0,groundLift:0} as EvaluatedPose;
    const canvas = {} as HTMLCanvasElement;
    drawImageParts(ctx, {x:10,y:20,w:100,h:200}, [{part:{...part,jointId:'joint',motion:'none'},canvas}], rig, pose, 0);
    expect(calls).toContainEqual(['translate',50,120]);
    expect(calls).toContainEqual(['rotate',.2]);
    calls.length = 0;
    drawImageParts(ctx, {x:10,y:20,w:100,h:200}, [{part:{...part,jointId:'missing',motion:'none'},canvas}], rig, pose, 0);
    expect(calls).toContainEqual(['translate',35,120]);
  });
});
