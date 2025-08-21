import { mapKeys, mapValues, pipe } from 'remeda';

export interface ExampleMeta {
  name: string;
}

export type ExampleExecute = (
  canvas: HTMLCanvasElement,
) => Promise<() => void | undefined>;

export interface ExampleContent {
  meta: ExampleMeta;
  execute: ExampleExecute;
}

const mapExampleKeys = mapKeys((key: string) =>
  key.replace(/^\.\/(.*)\/.*$/, '$1'),
);

const metaFiles = pipe(
  import.meta.glob('./**/meta.json', {
    eager: true,
    import: 'default',
  }) as Record<string, ExampleMeta>,
  mapExampleKeys,
);

const executableFiles = pipe(
  import.meta.glob('./**/*.ts', {
    eager: true,
    import: 'default',
  }) as Record<string, ExampleExecute>,
  mapExampleKeys,
);

export const examples: Record<string, ExampleContent> = pipe(
  metaFiles,
  mapValues((meta, key) => ({
    meta,
    execute: executableFiles[key],
  })),
);
