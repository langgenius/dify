import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, it } from 'vite-plus/test'

function lintFixture(filename: string, source: string) {
  const require = createRequire(import.meta.url)
  const viteRequire = createRequire(require.resolve('vite-plus/package.json'))
  const oxlintBin = join(dirname(dirname(viteRequire.resolve('oxlint'))), 'bin', 'oxlint')
  const directory = mkdtempSync(join(tmpdir(), 'dify-feature-boundaries-'))
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
        rules: { 'dify/feature-boundaries': 'error' },
      }),
    )
    mkdirSync(dirname(join(directory, filename)), { recursive: true })
    writeFileSync(join(directory, filename), source)
    const result = spawnSync(
      process.execPath,
      [oxlintBin, '--config', join(directory, '.oxlintrc.json'), '--format', 'json', filename],
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

it('rejects composing another feature from internal files through imports, exports, and lazy imports', () => {
  expect(
    lintFixture(
      'web/app/host.ts',
      [
        "import type { Draft } from '@/features/skills/detail/draft'",
        "export { Editor } from '../features/agent-v2/agent-editor/preview/surface'",
        "export * from '@/features/tag-management/tag-bindings'",
        "const Editor = import('@/features/agent-v2/agent-editor/configuration')",
      ].join('\n'),
    ),
  ).toEqual([1, 2, 3, 4])
})

it('allows documented public entrypoints and imports inside the owning feature', () => {
  expect(
    lintFixture(
      'web/app/host.ts',
      [
        "import List from '@/features/skills/list/page'",
        "import Detail from '@/features/skills/detail/route'",
        "import { Editor } from '@/features/agent-v2/agent-editor/workflow-panel'",
        "import { TagSelector } from '@/features/tag-management/tag-selector'",
        "const dialog = import('@/features/tag-management/tag-management-dialog')",
      ].join('\n'),
    ),
  ).toEqual([])
  expect(
    lintFixture(
      'web/features/agent-v2/agent-editor/host.ts',
      "import { Surface } from './preview/surface'",
    ),
  ).toEqual([])
  expect(
    lintFixture('web/features/skills/detail/host.ts', "import { Draft } from './draft'"),
  ).toEqual([])
})

it('keeps shared Marketplace and tag capabilities independent of consuming UI', () => {
  expect(
    lintFixture(
      'web/features/marketplace/client.ts',
      "import { adapter } from '@/app/components/plugins/marketplace/utils'",
    ),
  ).toEqual([1])
  expect(
    lintFixture(
      'web/features/tag-management/permissions.ts',
      "import { permission } from '../../app/components/snippets/utils/permission'",
    ),
  ).toEqual([1])
})

it('prevents restoring the Skills dependency on Agent file presentation', () => {
  expect(
    lintFixture(
      'web/features/skills/detail/files.ts',
      "import { getFileIconType } from '@/features/agent-v2/file-icon'",
    ),
  ).toEqual([1])
  expect(
    lintFixture(
      'web/features/skills/detail/files.ts',
      "import { getFileIconType } from '@/utils/file-icon'",
    ),
  ).toEqual([])
})
