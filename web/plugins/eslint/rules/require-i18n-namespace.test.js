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
  const directory = mkdtempSync(join(tmpdir(), 'dify-i18n-namespace-'))
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

it('rejects missing, empty, string, and dynamic namespaces through named and namespace imports', () => {
  const source = [
    "import { useTranslation as translate } from 'react-i18next'",
    "import { useTranslation } from '#i18n'",
    "import * as i18n from 'react-i18next'",
    'translate()',
    'useTranslation(undefined, { useSuspense: false })',
    'translate(null)',
    "translate('')",
    'translate([])',
    'translate([] as const)',
    "i18n.useTranslation('')",
    "i18n['useTranslation']()",
    "translate('' satisfies string)",
    "translate('common')",
    'function dynamic(namespace: string) { translate(namespace) }',
    "const namespace = 'common'; translate(namespace)",
    "const namespaces = ['common']; translate(namespaces)",
    'translate(getNamespaces())',
  ].join('\n')
  const diagnostics = lintFixture(source, { 'dify/require-i18n-namespace': 'error' })
  expect(diagnostics.map(({ code, labels }) => ({ code, line: labels[0].span.line }))).toEqual(
    [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17].map((line) => ({
      code: 'dify(require-i18n-namespace)',
      line,
    })),
  )
})

it('allows explicit namespace arrays without reporting unrelated or shadowed bindings', () => {
  const source = [
    "import { useTranslation as translate } from 'react-i18next'",
    "import { useTranslation } from './unrelated'",
    "import * as i18n from '#i18n'",
    "translate(['common'])",
    "translate(['common', 'workflow'] as const)",
    "i18n.useTranslation(['common'])",
    "i18n['useTranslation'](['common'])",
    'function shadowed(translate: Function) { translate() }',
    'function shadowedObject(i18n: any) { i18n.useTranslation() }',
    'useTranslation()',
    'const unrelated = { useTranslation() {} }',
    'unrelated.useTranslation()',
  ].join('\n')
  expect(lintFixture(source, { 'dify/require-i18n-namespace': 'error' })).toEqual([])
})

it('allows reading only i18n but still requires namespaces when t or the rest is extracted', () => {
  const source = [
    "import { useTranslation } from 'react-i18next'",
    'const { i18n } = useTranslation(); const { "i18n": quoted } = useTranslation()',
    'const { i18n: instance } = useTranslation()',
    "const { ['i18n']: computed } = useTranslation()",
    'const language = useTranslation().i18n.language',
    "const language2 = useTranslation()['i18n'].language",
    'const { i18n: wrapped } = (useTranslation() as any)!',
    'let assigned; ({ i18n: assigned } = useTranslation())',
    'const { t } = useTranslation()',
    'const { i18n: mixed, t: translate } = useTranslation()',
    'const { i18n: withRest, ...rest } = useTranslation()',
    'const translate2 = useTranslation().t',
    'const { t: i18nAlias } = useTranslation()',
  ].join('\n')
  const diagnostics = lintFixture(source, { 'dify/require-i18n-namespace': 'error' })
  expect(diagnostics.map(({ labels }) => labels[0].span.line)).toEqual([9, 10, 11, 12, 13])
})
