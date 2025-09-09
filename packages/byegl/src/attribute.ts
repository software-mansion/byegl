import { ByeGLBuffer, VertexBufferSegment } from './buffer.ts';
import { $internal } from './types.ts';

/**
 * WebGL state related to attributes. There is a global AttributeState, but
 * also one per each Vertex Array Object.
 */
export interface AttributeState {
  /**
   * Set using gl.enableVertexAttribArray and gl.disableVertexAttribArray.
   */
  enabledVertexAttribArrays: Set<number>;

  vertexBufferSegments: VertexBufferSegment[];

  /**
   * Set using gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ???).
   */
  boundElementArrayBuffer: ByeGLBuffer | null;
}

export class ByeGLVertexArrayObject {
  readonly [$internal]: AttributeState;

  constructor() {
    this[$internal] = {
      boundElementArrayBuffer: null,
      enabledVertexAttribArrays: new Set(),
      vertexBufferSegments: [],
    };
  }
}
