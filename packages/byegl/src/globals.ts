import { ByeGLContext } from './byegl-context.ts';
import { version as packageVersion } from '../package.json';

interface GlobalExtra {
  __BYEGL_INSPECT__?: boolean | undefined;
  __BYEGL__: {
    version: string;
    /**
     * Storing contexts created by ByeGL for further inspection and debugging.
     */
    contexts: ByeGLContext[];
  };
}

const byeglGlobalDefault: GlobalExtra['__BYEGL__'] = { version: packageVersion, contexts: [] };
const globalExt = globalThis as unknown as typeof globalThis & GlobalExtra;

export function addContext(context: ByeGLContext): void {
  globalExt.__BYEGL__ ??= byeglGlobalDefault;

  if (!globalExt.__BYEGL_INSPECT__) {
    return;
  }

  globalExt.__BYEGL__.contexts.push(context);
}

export function removeContext(context: ByeGLContext): void {
  globalExt.__BYEGL__ ??= byeglGlobalDefault;

  if (!globalExt.__BYEGL_INSPECT__) {
    return;
  }

  const index = globalExt.__BYEGL__.contexts.indexOf(context);
  if (index !== -1) {
    globalExt.__BYEGL__.contexts.splice(index, 1);
  }
}
