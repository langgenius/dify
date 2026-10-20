import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, it } from 'vite-plus/test'
import { lintConfig } from './lint.config.ts'

type Diagnostic = { code?: string; filename: string; labels: { span: { line: number } }[] }
const nativeRules = new Set([
  'typescript/no-deprecated',
  'no-restricted-globals',
  'no-restricted-properties',
  'no-restricted-imports',
])

function fixture() {
  const require = createRequire(import.meta.url)
  const viteRequire = createRequire(require.resolve('vite-plus/package.json'))
  const oxlintBin = join(dirname(dirname(viteRequire.resolve('oxlint'))), 'bin', 'oxlint')
  const oxlintRequire = createRequire(oxlintBin)
  const tsgolintRequire = createRequire(oxlintRequire.resolve('oxlint-tsgolint/package.json'))
  const tsgolint = tsgolintRequire.resolve(
    `@oxlint-tsgolint/${process.platform}-${process.arch}/tsgolint${process.platform === 'win32' ? '.exe' : ''}`,
  )
  const directory = mkdtempSync(join(tmpdir(), 'dify-native-http-'))
  writeFileSync(
    join(directory, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: { target: 'ESNext', module: 'ESNext', lib: ['ESNext', 'DOM'], strict: true },
      include: ['web/**/*.ts', 'web/**/*.tsx'],
    }),
  )
  mkdirSync(join(directory, 'web/service'), { recursive: true })
  writeFileSync(
    join(directory, 'web/service/legacy.ts'),
    '/** @deprecated Use generated clients. */\nexport const get = (url: string) => Promise.resolve(url)\n',
  )
  const select = (rules: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(rules).filter(([name]) => nativeRules.has(name)))
  writeFileSync(
    join(directory, '.oxlintrc.json'),
    JSON.stringify({
      categories: { correctness: 'off' },
      options: { typeAware: true },
      rules: select(lintConfig.rules),
      overrides: lintConfig.overrides.map((override) => ({
        ...override,
        rules: select(override.rules),
      })),
    }),
  )
  return {
    close: () => rmSync(directory, { recursive: true, force: true }),
    lint(source: string, file = 'web/feature.ts', flags: string[] = []) {
      mkdirSync(dirname(join(directory, file)), { recursive: true })
      writeFileSync(join(directory, file), source)
      const result = spawnSync(
        process.execPath,
        [oxlintBin, '--config', '.oxlintrc.json', '--format', 'json', ...flags, file],
        {
          cwd: directory,
          encoding: 'utf8',
          env: { ...process.env, OXLINT_TSGOLINT_PATH: tsgolint },
        },
      )
      expect(result.error).toBeUndefined()
      expect([0, 1], result.stderr + result.stdout).toContain(result.status)
      return {
        status: result.status,
        diagnostics: JSON.parse(result.stdout).diagnostics as Diagnostic[],
      }
    },
  }
}

it('rejects each direct deprecated helper call and allows generated clients and local functions', () => {
  const test = fixture()
  try {
    const result = test.lint(
      [
        "import { get as read } from './service/legacy'",
        "import * as legacy from './service/legacy'",
        "read('/one')",
        "legacy.get('/two')",
        'const consoleClient = { get: (url: string) => Promise.resolve(url) }',
        "consoleClient.get('/allowed')",
        'const fetch = (url: string) => url',
        "fetch('/local')",
      ].join('\n'),
    )
    expect(result.diagnostics.map((d) => [d.code, d.labels[0]!.span.line])).toEqual([
      ['typescript(no-deprecated)', 3],
      ['typescript(no-deprecated)', 4],
    ])
  } finally {
    test.close()
  }
})

it('blocks native requests and client imports without blocking type-only imports', () => {
  const test = fixture()
  try {
    const result = test.lint(
      [
        "import ky from 'ky'",
        "import type { Options } from 'ky'",
        "fetch('/one')",
        "window.fetch('/two')",
        "globalThis['fetch']('/three')",
        'new XMLHttpRequest()',
        'new self.XMLHttpRequest()',
        "import { request } from 'node:https'",
      ].join('\n'),
    )
    expect(result.diagnostics.map((d) => d.labels[0]!.span.line).sort((a, b) => a - b)).toEqual([
      1, 3, 4, 5, 6, 7, 8,
    ])
  } finally {
    test.close()
  }
})

it('preserves storage and service import restrictions alongside transport restrictions', () => {
  const test = fixture()
  try {
    const result = test.lint(
      "import { get } from './base'\nlocalStorage.getItem('key')\nwindow.localStorage.getItem('key')\nfetch('/one')",
      'web/service/feature.ts',
    )
    expect(result.diagnostics.map((d) => d.labels[0]!.span.line).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4,
    ])
    expect(test.lint("fetch('/one')", 'web/instrumentation-client.ts').diagnostics).toHaveLength(1)
  } finally {
    test.close()
  }
})

it('checks deprecations in all Web scopes while allowing test and script transports', () => {
  const test = fixture()
  try {
    for (const file of [
      'web/feature.spec.ts',
      'web/feature.test.tsx',
      'web/feature.stories.tsx',
      'web/__tests__/http.ts',
      'web/__mocks__/http.ts',
      'web/scripts/check.ts',
      'web/test/helper.ts',
      'web/vitest.setup.ts',
      'web/vitest.browser.setup.ts',
    ]) {
      const source = [
        "import ky from 'ky'",
        "fetch('/allowed')",
        '/** @deprecated Use the replacement. */',
        'function legacy() {}',
        'legacy()',
      ].join('\n')
      expect(
        test.lint(source, file).diagnostics.map((d) => [d.code, d.labels[0]!.span.line]),
      ).toEqual([['typescript(no-deprecated)', 5]])
    }
  } finally {
    test.close()
  }
})

it('rejects additional direct calls beyond the existing suppression count', () => {
  const test = fixture()
  try {
    const source = "import { get } from './service/legacy'\nget('/existing')\nfetch('/existing')"
    expect(test.lint(source, undefined, ['--suppress-all']).status).toBe(0)
    expect(test.lint(`${source}\nget('/new')\nfetch('/new')`).status).toBe(1)
  } finally {
    test.close()
  }
})

it('documents the accepted Oxlint gap for calls through an already baselined alias', () => {
  const test = fixture()
  try {
    const source = "import { get } from './service/legacy'\nconst saved = get\nsaved('/existing')"
    expect(test.lint(source).diagnostics.map((d) => d.labels[0]!.span.line)).toEqual([2])
    expect(test.lint(source, undefined, ['--suppress-all']).status).toBe(0)
    // Change this expectation and the documentation when Oxlint gains signature propagation.
    expect(test.lint(`${source}\nsaved('/new')`).diagnostics).toEqual([])
  } finally {
    test.close()
  }
})
