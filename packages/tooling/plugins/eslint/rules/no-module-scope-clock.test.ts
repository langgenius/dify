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
  const directory = mkdtempSync(join(tmpdir(), 'dify-module-scope-clock-'))
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
        rules: { 'dify/no-module-scope-clock': 'error' },
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

it('reports clock reads that run at module scope', () => {
  expect(
    lintFixture(
      [
        'const today = dayjs()',
        'const now = Date.now()',
        'const year = new Date().getFullYear()',
        'export const range = { end: dayjs().endOf("day") }',
      ].join('\n'),
    ),
  ).toEqual([1, 2, 3, 4])
})

it('allows clock reads inside functions, handlers, and explicit dates', () => {
  expect(
    lintFixture(
      [
        'const fixed = dayjs("2026-01-01")',
        'const epoch = new Date(0)',
        'function Footer() { return new Date().getFullYear() }',
        'const onSelect = () => dayjs().startOf("day")',
        'const initial = () => ({ start: Date.now() })',
        'class Clock { now = Date.now() }',
      ].join('\n'),
    ),
  ).toEqual([])
})
