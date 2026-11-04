import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, it } from 'vite-plus/test'
import { lintConfig } from './lint.config.ts'

const rule = 'better-tailwindcss/enforce-logical-properties'

function fixture() {
  const require = createRequire(import.meta.url)
  const viteRequire = createRequire(require.resolve('vite-plus/package.json'))
  const oxlintBin = join(dirname(dirname(viteRequire.resolve('oxlint'))), 'bin', 'oxlint')
  const directory = mkdtempSync(join(tmpdir(), 'dify-logical-properties-'))
  writeFileSync(
    join(directory, '.oxlintrc.json'),
    JSON.stringify({
      categories: { correctness: 'off' },
      jsPlugins: lintConfig.jsPlugins.filter(
        (plugin) =>
          typeof plugin === 'string' && plugin.includes('eslint-plugin-better-tailwindcss'),
      ),
      settings: { 'better-tailwindcss': lintConfig.settings['better-tailwindcss'] },
      options: { reportUnusedDisableDirectives: 'error' },
      overrides: lintConfig.overrides.filter((override) => rule in override.rules),
    }),
  )
  return {
    close: () => rmSync(directory, { recursive: true, force: true }),
    lint(source: string, file = 'web/example.tsx', flags: string[] = []) {
      const target = join(directory, file)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, source)
      const result = spawnSync(
        process.execPath,
        [oxlintBin, '--config', '.oxlintrc.json', '--format', 'json', ...flags, file],
        { cwd: directory, encoding: 'utf8' },
      )
      expect(result.error).toBeUndefined()
      expect([0, 1], result.stderr + result.stdout).toContain(result.status)
      return { status: result.status, source: readFileSync(target, 'utf8'), output: result.stdout }
    },
  }
}

it('enforces logical classes in both Web and Dify UI without the canonical-class flag', () => {
  const test = fixture()
  try {
    for (const file of ['web/example.tsx', 'packages/dify-ui/src/example.tsx']) {
      const result = test.lint('<div className="pl-2 text-right rounded-tl-md" />', file)
      expect(result.status).toBe(1)
      expect(result.output).toContain('enforce-logical-properties')
      const fixed = test.lint('<div className="pl-2 text-right rounded-tl-md" />', file, ['--fix'])
      expect(fixed.status).toBe(0)
      expect(fixed.source).toContain('ps-2 text-end rounded-ss-md')
    }
  } finally {
    test.close()
  }
})

it('preserves physical geometry and described exceptions while rejecting ordinary offsets', () => {
  const test = fixture()
  try {
    expect(
      test.lint(
        '<div className="pt-2 mb-4 top-0 h-8 w-8 border-b left-1/2 -translate-x-1/2 rtl:pl-2 ltr:pr-2 data-[swipe-direction=right]:right-0 data-[swipe-direction=left]:rounded-r-2xl" />',
      ).status,
    ).toBe(0)
    expect(
      test.lint(
        '// oxlint-disable-next-line better-tailwindcss/enforce-logical-properties -- The stack exits toward the physical right.\nconst toast = <div className="right-4" />',
      ).status,
    ).toBe(0)
    expect(test.lint('<div className="right-4" />').status).toBe(1)
  } finally {
    test.close()
  }
})

it('baselines Web debt, rejects additional violations, and fixes baselined classes', () => {
  const test = fixture()
  try {
    const source = '<div className="pl-2" />'
    expect(test.lint(source, undefined, ['--suppress-all']).status).toBe(0)
    expect(test.lint(source).status).toBe(0)
    expect(test.lint('<div className="pl-2 pr-4" />').status).toBe(1)
    expect(test.lint(source, 'packages/dify-ui/src/example.tsx').status).toBe(1)
    const fixed = test.lint(source, undefined, ['--fix'])
    expect(fixed.status).toBe(0)
    expect(fixed.source).toContain('ps-2')
    expect(test.lint(source).status).toBe(1)
  } finally {
    test.close()
  }
})
