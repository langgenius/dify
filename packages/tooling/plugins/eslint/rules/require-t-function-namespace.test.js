import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, it } from 'vite-plus/test'

function lintFixture(source, rules) {
  const require = createRequire(import.meta.url)
  const viteRequire = createRequire(require.resolve('vite-plus/package.json'))
  const oxlintBin = join(dirname(dirname(viteRequire.resolve('oxlint'))), 'bin', 'oxlint')
  const directory = mkdtempSync(join(tmpdir(), 'dify-t-function-namespace-'))
  try {
    writeFileSync(
      join(directory, 'plugin.mjs'),
      `export { default } from ${JSON.stringify(require.resolve('../index.js'))};`,
    )
    writeFileSync(
      join(directory, '.oxlintrc.json'),
      JSON.stringify({
        categories: { correctness: 'off' },
        jsPlugins: ['./plugin.mjs'],
        options: { respectEslintDisableDirectives: false },
        rules,
      }),
    )
    writeFileSync(join(directory, 'fixture.tsx'), source)
    const result = spawnSync(
      process.execPath,
      [oxlintBin, '--config', join(directory, '.oxlintrc.json'), '--format', 'json', 'fixture.tsx'],
      {
        cwd: directory,
        encoding: 'utf8',
      },
    )
    expect(result.error).toBeUndefined()
    expect([0, 1], result.stderr + result.stdout).toContain(result.status)
    return JSON.parse(result.stdout).diagnostics
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

it('rejects missing, broad, and non-tuple namespaces through imported TFunction types', () => {
  const source = [
    "import type { TFunction, TFunction as Translate, Namespace } from 'i18next'",
    "import type * as I18n from 'i18next'",
    'type Missing = TFunction',
    'type Broad = Translate<Namespace>',
    "type Single = TFunction<'common'>",
    'type Empty = TFunction<[]>',
    'type Array = TFunction<string[]>',
    'type BroadElement = TFunction<[Namespace]>',
    "type EmptyElement = TFunction<['']>",
    'type Qualified = I18n.TFunction',
    "type Inline = import('i18next').TFunction<'common'>",
    'type Any = TFunction<any>',
    "type Alias = ['common']; type Indirect = TFunction<Alias>",
    "type Rest = TFunction<['common', ...string[]]>",
    "type Union = TFunction<['common' | 'workflow']>",
  ].join('\n')
  const diagnostics = lintFixture(source, { 'dify/require-t-function-namespace': 'error' })
  expect(diagnostics.map(({ code, labels }) => ({ code, line: labels[0].span.line }))).toEqual(
    Array.from({ length: 13 }, (_, index) => ({
      code: 'dify(require-t-function-namespace)',
      line: index + 3,
    })),
  )
})

it('allows explicit tuples and preserves unrelated or shadowed type bindings', () => {
  const source = [
    "import type { TFunction, TFunction as Translate } from 'i18next'",
    "import type * as I18n from 'i18next'",
    "import type { TFunction as Other } from './other'",
    "type Single = TFunction<['common']>",
    "type Multiple = Translate<['common', 'workflow']>",
    "type Readonly = I18n.TFunction<readonly ['common', 'workflow']>",
    "type Prefix = TFunction<['common'], 'operation'>",
    "type Inline = import('i18next').TFunction<['common']>",
    'type Unrelated = Other',
    'type Shadowed<TFunction> = TFunction',
    'type ShadowedAlias<Translate> = Translate',
    'namespace Nested { type TFunction = string; type Local = TFunction }',
    "type OtherInline = import('./other').TFunction",
  ].join('\n')
  expect(lintFixture(source, { 'dify/require-t-function-namespace': 'error' })).toEqual([])
})
