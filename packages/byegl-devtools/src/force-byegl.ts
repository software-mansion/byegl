import { enableSync } from 'byegl';

// Synchronously patches HTMLCanvasElement.prototype.getContext before any
// page scripts run. The real WebGPU device is initialised in the background;
// draw calls issued before activation are silently dropped and reissued by
// the page's own render loop once the device is ready.
enableSync();
