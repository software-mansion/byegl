import * as d from 'typegpu/data';

/**
 * Used when we can't determine something's type (usually a hole in the implementation)
 */
export const UnknownType = Symbol('UnknownType');
export type UnknownType = typeof UnknownType;

export type ByeglData =
  | d.AnyWgslData
  | WgslTexture1D
  | WgslTexture2D
  | WgslTexture2DArray
  | WgslTexture3D
  | WgslTextureCube
  | WgslTexture2DU32
  | WgslSampler;

export const texture1dType = {
  type: 'texture_1d<f32>',
  sampleType: d.f32,
} as const;
export const texture2dType = {
  type: 'texture_2d<f32>',
  sampleType: d.f32,
} as const;
export const texture2dArrayType = {
  type: 'texture_2d_array<f32>',
  sampleType: d.f32,
} as const;
export const texture3dType = {
  type: 'texture_3d<f32>',
  sampleType: d.f32,
} as const;
export const textureCubeType = {
  type: 'texture_cube<f32>',
  sampleType: d.f32,
} as const;
export const texture2dU32Type = {
  type: 'texture_2d<u32>',
  sampleType: d.u32,
} as const;
export const samplerType = { type: 'sampler' } as const;

// TODO: Implement more texture types

export type WgslTexture1D = typeof texture1dType;
export type WgslTexture2D = typeof texture2dType;
export type WgslTexture2DArray = typeof texture2dArrayType;
export type WgslTexture3D = typeof texture3dType;
export type WgslTextureCube = typeof textureCubeType;
export type WgslTexture2DU32 = typeof texture2dU32Type;

export type WgslSampler = typeof samplerType;

export function isPrimitive(data: ByeglData): boolean {
  return data.type !== 'array' && data.type !== 'struct';
}
