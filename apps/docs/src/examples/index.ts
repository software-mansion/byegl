import { mapKeys, mapValues, pipe } from 'remeda';
import type { ExampleContext } from './types.ts';

export interface ExampleMeta {
  name: string;
  usesHooks?: boolean | undefined;
}

export type ExampleExecute = (
  ctx: ExampleContext,
) => Promise<() => void | undefined>;

export interface ExampleContent {
  meta: ExampleMeta;
  execute: () => Promise<ExampleExecute>;
}

const mapExampleKeys = <T extends Record<string, unknown>>(data: T) =>
  mapKeys(data, (key: string) => key.replace(/^\.\/(.*)\/.*$/, '$1'));

const metaFiles = pipe(
  import.meta.glob('./**/meta.json', {
    eager: true,
    import: 'default',
  }) as Record<string, ExampleMeta>,
  mapExampleKeys,
);

const executableFiles = pipe(
  import.meta.glob('./**/*.ts', {
    import: 'default',
  }) as Record<string, () => Promise<ExampleExecute>>,
  mapExampleKeys,
);

export const examples: Record<string, ExampleContent> = pipe(
  metaFiles,
  mapValues((meta, key) => ({
    meta,
    execute: executableFiles[key],
  })),
);
