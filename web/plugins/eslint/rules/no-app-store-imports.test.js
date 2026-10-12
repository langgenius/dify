import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { expect, it } from 'vite-plus/test'

const appStore = resolve(import.meta.dirname, '../../../app/components/app/store')
const message =
  'Do not import the legacy app store. Read app details through generated consoleQuery APIs keyed by appId, and keep UI state in the owning feature.'

function withFixture(run) {
  const require = createRequire(import.meta.url)
  const viteRequire = createRequire(require.resolve('vite-plus/package.json'))
  const oxlintBin = join(dirname(dirname(viteRequire.resolve('oxlint'))), 'bin', 'oxlint')
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'dify-app-store-imports-')))
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
        rules: { 'dify/no-app-store-imports': 'error' },
      }),
    )
    function lint(...args) {
      const result = spawnSync(
        process.execPath,
        [oxlintBin, '--config', '.oxlintrc.json', '--format', 'json', ...args],
        { cwd: directory, encoding: 'utf8' },
      )
      expect(result.error).toBeUndefined()
      expect([0, 1], result.stderr + result.stdout).toContain(result.status)
      return { status: result.status, ...JSON.parse(result.stdout) }
    }
    return run({ directory, lint })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

it('rejects value, type, namespace, and side-effect imports through both aliases', () => {
  withFixture(({ directory, lint }) => {
    writeFileSync(
      join(directory, 'fixture.tsx'),
      [
        "import { useStore as renamed } from '@/app/components/app/store'",
        "import * as store from '~@/app/components/app/store.ts'",
        "import type { useStore } from '@/app/components/app/store'",
        "import '@/app/components/app/store'",
        "import '@/app/components/app/store.ts?legacy'",
        "export * from '~@/app/components/app/store#legacy'",
      ].join('\n'),
    )
    const result = lint('fixture.tsx')
    expect(result.status).toBe(1)
    expect(
      result.diagnostics.map(({ code, message: diagnostic, labels }) => ({
        code,
        message: diagnostic,
        line: labels[0].span.line,
      })),
    ).toEqual(
      [1, 2, 3, 4, 5, 6].map((line) => ({
        code: 'dify(no-app-store-imports)',
        message,
        line,
      })),
    )
  })
})

it('rejects resolved relative paths, re-exports, dynamic imports, and require forms', () => {
  withFixture(({ directory, lint }) => {
    const source = JSON.stringify(relative(directory, appStore))
    writeFileSync(
      join(directory, 'fixture.ts'),
      [
        `import { useStore } from ${source}`,
        `export { useStore as store } from ${source}`,
        `export * from ${source}`,
        `export type { useStore as StoreType } from ${source}`,
        `const lazy = import(${source})`,
        `const required = require(${source})`,
        `import store = require(${source})`,
        `type Store = typeof import(${source})`,
        `import ${JSON.stringify(`${appStore}.js`)}`,
        `const variant = import(${JSON.stringify(`${relative(directory, appStore)}.ts?legacy#source`)})`,
      ].join('\n'),
    )
    const result = lint('fixture.ts')
    expect(result.status).toBe(1)
    expect(result.diagnostics.map(({ labels }) => labels[0].span.line)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ])
  })
})

it('allows other feature stores, computed sources, mocks, and shadowed require', () => {
  withFixture(({ directory, lint }) => {
    writeFileSync(
      join(directory, 'fixture.ts'),
      [
        "import { useStore } from '@/app/components/workflow-app/store'",
        "export * from '@/app/components/workflow/store'",
        "import './store'",
        "import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'",
        "vi.mock('@/app/components/app/store', () => ({}))",
        "function local(require: Function) { require('@/app/components/app/store') }",
        'function dynamic(source: string) { return import(source) }',
      ].join('\n'),
    )
    expect(lint('fixture.ts').diagnostics).toEqual([])
  })
})

it('baselines existing imports while rejecting a new file and an increased import count', () => {
  withFixture(({ directory, lint }) => {
    const source = "import { useStore } from '@/app/components/app/store'\n"
    writeFileSync(join(directory, 'existing.ts'), source)
    lint('--suppress-all', 'existing.ts')
    expect(JSON.parse(readFileSync(join(directory, 'oxlint-suppressions.json'), 'utf8'))).toEqual({
      'existing.ts': { 'dify/no-app-store-imports': { count: 1 } },
    })
    expect(lint('existing.ts').diagnostics).toEqual([])
    writeFileSync(join(directory, 'added.ts'), source)
    expect(lint('added.ts').status).toBe(1)
    writeFileSync(join(directory, 'existing.ts'), `${source}import '@/app/components/app/store'`)
    expect(lint('existing.ts').status).toBe(1)
  })
})
