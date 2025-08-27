export interface ExampleContext {
  canvas: HTMLCanvasElement;

  /**
   * Used to record values produces by the program, which can be compared
   * between both implementations (WebGL and ByeGL)
   */
  trace(...values: unknown[]): void;
}
