import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, it } from 'vite-plus/test'

function lintFixture(source: string) {
  const require = createRequire(import.meta.url)
  const viteRequire = createRequire(require.resolve('vite-plus/package.json'))
  const oxlintBin = join(dirname(dirname(viteRequire.resolve('oxlint'))), 'bin', 'oxlint')
  const directory = mkdtempSync(join(tmpdir(), 'dify-mutation-policy-bypass-'))
  try {
    writeFileSync(
      join(directory, 'plugin.mjs'),
      `export { default } from ${JSON.stringify(require.resolve('../index.ts'))};`,
    )
    writeFileSync(
      join(directory, '.oxlintrc.json'),
      JSON.stringify({
        categories: { correctness: 'off' },
        jsPlugins: ['./plugin.mjs'],
        rules: { 'dify/no-mutation-policy-bypass': 'error' },
      }),
    )
    writeFileSync(join(directory, 'fixture.jsx'), source)
    const result = spawnSync(
      process.execPath,
      [oxlintBin, '--config', join(directory, '.oxlintrc.json'), '--format', 'json', 'fixture.jsx'],
      { cwd: directory, encoding: 'utf8' },
    )
    expect(result.error).toBeUndefined()
    expect([0, 1], result.stderr + result.stdout).toContain(result.status)
    return (
      JSON.parse(result.stdout).diagnostics as Array<{ labels: { span: { line: number } }[] }>
    ).map((diagnostic) => diagnostic.labels[0]!.span.line)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

it('reports callbacks that replace a spread mutation policy', () => {
  expect(
    lintFixture(
      [
        'useMutation({ ...query.a.mutationOptions(), onSuccess() {} })',
        'const options = query.b.mutationOptions()',
        'useMutation({ ...options, onSettled: () => {} })',
        'useMutation({ onError() {}, ...query.c.mutationOptions() })',
        'useMutation({ ...query.d.mutationOptions(), retry: 1 })',
      ].join('\n'),
    ),
  ).toEqual([1, 3])
})

it('reports policy callbacks called by hand', () => {
  expect(
    lintFixture(
      [
        'query.a.mutationOptions().onSuccess?.(data)',
        'const options = query.b.mutationOptions()',
        'await options.onSettled?.(data)',
        'query.c.mutationOptions({ onSuccess() {} })',
      ].join('\n'),
    ),
  ).toEqual([1, 3])
})

it('ignores unrelated bindings that share a name with mutation options', () => {
  expect(
    lintFixture(
      [
        'function save() {',
        '  const options = query.a.mutationOptions()',
        '  return useMutation(options)',
        '}',
        'function notify(options) {',
        '  options.onSuccess?.()',
        '  return { ...options, onError() {} }',
        '}',
        'function shadowed() {',
        '  const options = query.b.mutationOptions()',
        '  {',
        '    const options = {}',
        '    options.onSettled?.()',
        '  }',
        '  options.onSettled?.()',
        '}',
      ].join('\n'),
    ),
  ).toEqual([15])
})
