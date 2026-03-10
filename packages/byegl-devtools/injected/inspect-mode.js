// Injected at document_start in the MAIN world when Inspect Mode is active.
// This runs before any page scripts, guaranteeing __BYEGL_INSPECT__ is set
// by the time WebGL contexts are created.
globalThis.__BYEGL_INSPECT__ = true;
