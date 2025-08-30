function isPowerOf2(value: number): boolean {
  return (value & (value - 1)) === 0;
}

export interface TextureInfo {
  texture: WebGLTexture;
  width: number;
  height: number;
}

export function loadTexture(
  gl: WebGLRenderingContext,
  src: string,
): Promise<TextureInfo> {
  const texture = gl.createTexture();

  // Asynchronously load an image
  return new Promise<TextureInfo>((resolve) => {
    const image = new Image();
    image.src = src;

    image.addEventListener('load', () => {
      // Now that the image has loaded copy it to the texture.
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        image,
      );

      // Check if the image is a power of 2 in both dimensions.
      if (isPowerOf2(image.width) && isPowerOf2(image.height)) {
        // Yes, it's a power of 2. Generate mips.
        gl.generateMipmap(gl.TEXTURE_2D);
      } else {
        // No, it's not a power of 2. Turn off mips and set wrapping to clamp to edge
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      }

      resolve({ texture, width: image.width, height: image.height });
    });
  });
}
