// @vitest-environment node

import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vite-plus/test'
import { generateResourceTypes } from '../generate-i18n-types'

describe('generated i18n resource types', () => {
  it('checks interpolation and plural options through the official selector types', async () => {
    const generated = await generateResourceTypes({
      app: {
        title: 'Delete {{ name }}?',
        'files.count_one': '{{count}} file for {{name}}',
        'files.count_other': '{{count}} files for {{name}}',
        size: '{{size, number}} bytes',
        features: ['First feature', 'Second feature'],
      },
      common: { save: 'Save' },
    })
    const source = `${generated}
      import type { TFunction } from 'i18next';
      declare module 'i18next' {
        interface CustomTypeOptions {
          defaultNS: 'app';
          enableSelector: 'optimize';
          keySeparator: false;
          resources: Resources;
        }
      }
      declare const t: TFunction<['app', 'common']>;
      t($ => $.title, { name: 'Alice' });
      t($ => $['files.count'], { count: 2, name: 'Alice' });
      // @ts-expect-error Optimized resources expose plural base keys only.
      t($ => $['files.count_other'], { count: 2, name: 'Alice' });
      t($ => $.size, { size: 42 });
      t($ => $.save, { ns: 'common' });
      const features: string[] = t($ => $.features, { returnObjects: true });
      // @ts-expect-error Unknown key.
      t($ => $.missing);
      // @ts-expect-error Namespace does not contain this key.
      t($ => $.save, { ns: 'app' });
      // @ts-expect-error Misspelled interpolation parameter.
      t($ => $.title, { typo: 'Alice' });
      // @ts-expect-error Empty options cannot satisfy interpolation.
      t($ => $.title, {});
      // @ts-expect-error Plural options need count.
      t($ => $['files.count'], { name: 'Alice' });
      // @ts-expect-error Count is numeric.
      t($ => $['files.count'], { count: '2', name: 'Alice' });
      // @ts-expect-error Built-in number formatter requires a number.
      t($ => $.size, { size: '42' });
    `
    const file = fileURLToPath(new URL('./i18n-type-contract.ts', import.meta.url))
    const options: ts.CompilerOptions = {
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      types: [],
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.Preserve,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    }
    const host = ts.createCompilerHost(options)
    const getSourceFile = host.getSourceFile.bind(host)
    host.getSourceFile = (name, ...args) =>
      name === file
        ? ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true)
        : getSourceFile(name, ...args)
    const program = ts.createProgram([file], options, host)
    expect(
      ts
        .getPreEmitDiagnostics(program)
        .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')),
    ).toEqual([])
  })

  it('retains all plural variants and an existing base translation without emitting runtime code', async () => {
    const source = await generateResourceTypes({
      app: {
        item: 'Item',
        item_one: '{{count}} item',
        item_other: '{{count}} items',
        quote: 'A "quote"\nNew line',
      },
    })
    expect(source).toContain("item: 'Item' | '{{count}} item' | '{{count}} items'")
    expect(
      ts.transpile(source, { module: ts.ModuleKind.ESNext, removeComments: true }).trim(),
    ).toBe('export {};')
  })
})
