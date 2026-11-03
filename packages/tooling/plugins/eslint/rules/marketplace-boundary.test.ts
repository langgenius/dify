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
  const directory = mkdtempSync(join(tmpdir(), 'dify-marketplace-boundary-'))
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
        rules: { 'dify/marketplace-boundary': 'error' },
      }),
    )
    writeFileSync(join(directory, 'fixture.ts'), source)
    const result = spawnSync(
      process.execPath,
      [oxlintBin, '--config', join(directory, '.oxlintrc.json'), '--format', 'json', 'fixture.ts'],
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

it('reports Marketplace links, data and availability read outside the Marketplace module', () => {
  const lines = lintFixture(
    [
      "import { marketplaceQuery } from '@/service/marketplace'",
      "import { getPluginDetailPath, marketplaceLinks } from '@/features/marketplace/links'",
      "import { MARKETPLACE_API_PREFIX, getMarketplaceApiUrl } from '@/features/marketplace/api'",
      "import type { MarketplaceLinks } from '@/features/marketplace/links'",
      'const enabled = systemFeatures.enable_marketplace',
      'const { enable_marketplace } = systemFeatures',
      'const prefix = env.NEXT_PUBLIC_MARKETPLACE_URL_PREFIX',
      "const page = 'https://marketplace.dify.ai/plugins'",
      'const creators = `https://creators-staging.dify.dev/` + path',
      "const docs = 'https://docs.dify.ai/marketplace'",
    ].join('\n'),
  )

  expect(lines).toEqual([1, 2, 3, 5, 6, 7, 8, 9])
})
