import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, it } from 'vite-plus/test'
import { lintConfig } from '../../../lint.config.ts'

type Diagnostic = { code: string; labels: { span: { line: number } }[] }

function fixture() {
  const require = createRequire(import.meta.url)
  const viteRequire = createRequire(require.resolve('vite-plus/package.json'))
  const oxlintBin = join(dirname(dirname(viteRequire.resolve('oxlint'))), 'bin', 'oxlint')
  const directory = mkdtempSync(join(tmpdir(), 'dify-handwritten-api-'))
  writeFileSync(
    join(directory, 'plugin.mjs'),
    `export { default } from ${JSON.stringify(require.resolve('../index.ts'))};`,
  )
  const override = lintConfig.overrides.find((entry) => 'dify/no-handwritten-api' in entry.rules)
  expect(override).toBeDefined()
  writeFileSync(
    join(directory, '.oxlintrc.json'),
    JSON.stringify({
      categories: { correctness: 'off' },
      jsPlugins: ['./plugin.mjs'],
      options: { respectEslintDisableDirectives: false },
      overrides: [override],
    }),
  )
  return {
    close: () => rmSync(directory, { recursive: true, force: true }),
    lint(source: string, file = 'web/app/feature.tsx', flags: string[] = []) {
      mkdirSync(dirname(join(directory, file)), { recursive: true })
      writeFileSync(join(directory, file), source)
      const result = spawnSync(
        process.execPath,
        [oxlintBin, '--config', '.oxlintrc.json', '--format', 'json', ...flags, file],
        { cwd: directory, encoding: 'utf8' },
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

it('checks each helper call, including import aliases, relative paths and local aliases', () => {
  const test = fixture()
  try {
    const { diagnostics } = test.lint(
      [
        "import { get as read, postPublic } from '@/service/base'",
        "import * as legacy from '../service/base.ts'",
        "import { base as transport, postWithKeepalive } from '@/service/fetch'",
        "read('/one')",
        "read('/two')",
        "legacy['post']('/three')",
        'const alias = read',
        "alias('/four')",
        'const { patch: update } = legacy',
        "update('/five')",
        "postPublic('/public')",
        "transport('/low-level')",
        "transport.fetch('/response')",
        "postWithKeepalive('/unload', {})",
        "legacy.ssePost('/stream')",
      ].join('\n'),
    )
    expect(diagnostics.map((entry) => entry.labels[0]!.span.line)).toEqual([
      4, 5, 6, 8, 10, 11, 12, 13, 14, 15,
    ])
  } finally {
    test.close()
  }
})

it('rejects raw HTTP through globals, aliases, client factories and dynamic imports', () => {
  const test = fixture()
  try {
    const { diagnostics } = test.lint(
      [
        "import axios from 'axios'",
        "import ky from 'ky'",
        "fetch('/one')",
        "window.fetch('/two')",
        "globalThis['fetch']('/three')",
        "self.fetch('/four')",
        'const { fetch: read } = globalThis',
        "read('/five')",
        'const bound = fetch.bind(globalThis)',
        "bound('/six')",
        'new XMLHttpRequest()',
        'new window.XMLHttpRequest()',
        "axios.post('/seven')",
        "const client = ky.extend({ prefixUrl: '/api' })",
        "client.get('/eight')",
        "const { get } = await import('@/service/base')",
        "get('/nine')",
        "const legacy = require('../service/base')",
        "legacy.post('/ten')",
        "export { get as readAgain } from '@/service/base'",
        "export * from '@/service/fetch'",
      ].join('\n'),
    )
    expect(diagnostics.map((entry) => entry.labels[0]!.span.line)).toEqual([
      3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 17, 19, 20, 21,
    ])
  } finally {
    test.close()
  }
})

it('allows generated clients, non-transport utilities and shadowed or unrelated names', () => {
  const test = fixture()
  try {
    expect(
      test.lint(
        [
          "import { consoleClient, consoleQuery } from '@/service/console'",
          "import { marketplaceClient } from '@/service/marketplace'",
          "import { get } from './local-store'",
          "import { buildSigninUrlWithRedirect } from '@/service/base'",
          "import { getBaseOptions } from '@/service/fetch'",
          "import type { IOtherOptions } from '@/service/base'",
          "export type { IOtherOptions } from '@/service/base'",
          'consoleClient.apps.get({})',
          'consoleQuery.apps.get.queryOptions()',
          'marketplaceClient.plugins.get({})',
          "get('state')",
          'buildSigninUrlWithRedirect()',
          'getBaseOptions()',
          'function local(fetch: Function, window: any, XMLHttpRequest: any) { fetch(); window.fetch(); new XMLHttpRequest() }',
          'const store = { fetch() {} }; store.fetch()',
        ].join('\n'),
      ).diagnostics,
    ).toEqual([])
    for (const file of [
      'web/app/feature.spec.tsx',
      'web/app/__tests__/feature.ts',
      'web/__mocks__/api.ts',
      'web/test/api.ts',
      'web/scripts/download.ts',
      'web/app/feature.stories.tsx',
    ])
      expect(test.lint("fetch('/fixture')", file).diagnostics).toEqual([])
    expect(
      test.lint("fetch('/new-endpoint')", 'web/service/new-service.ts').diagnostics,
    ).toHaveLength(1)
    expect(
      test.lint("fetch('/new-endpoint')", 'web/features/new-feature/client.ts').diagnostics,
    ).toHaveLength(1)
  } finally {
    test.close()
  }
})

it('keeps the rule active in baselined files and rejects additional calls using an existing import', () => {
  const test = fixture()
  const source = "import { get } from '@/service/base'\nget('/existing')"
  try {
    test.lint(source, undefined, ['--suppress-all'])
    expect(test.lint(source).status).toBe(0)
    const added = test.lint(`${source}\nget('/new')`)
    expect(added.status).toBe(1)
    expect(added.diagnostics.some((entry) => entry.code === 'dify(no-handwritten-api)')).toBe(true)
  } finally {
    test.close()
  }
})
