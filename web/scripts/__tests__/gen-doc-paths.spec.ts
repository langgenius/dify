// @vitest-environment node

import { writeFile } from 'node:fs/promises'

// boundary: capture the generated file without overwriting the checked-in documentation paths.
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  writeFile: vi.fn().mockResolvedValue(undefined),
}))

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

it.each([
  ['missing', [], []],
  ['Cloud-only', ['en/cloud/use-dify/workspace/channels/overview'], ['cloud']],
  ['self-host-only', ['zh/self-host/use-dify/workspace/channels/overview'], ['self-host']],
  [
    'both products',
    [
      'en/cloud/use-dify/workspace/channels/overview',
      'zh/self-host/use-dify/workspace/channels/overview',
    ],
    ['cloud', 'self-host'],
  ],
] as const)(
  'derives channel help availability from %s navigation',
  async (_scenario, pages, products) => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          navigation: {
            pages: ['en/cloud/use-dify/getting-started/introduction', ...pages],
          },
        }),
      ),
    )

    await import('../gen-doc-paths')
    await vi.waitFor(() => expect(writeFile).toHaveBeenCalledOnce())

    const [, source] = vi.mocked(writeFile).mock.calls[0]!
    if (products.length === 0) {
      expect(source).not.toContain('/use-dify/workspace/channels/')
      return
    }

    const channelPath = '/use-dify/workspace/channels/overview'
    expect(source).toContain(`  | '${channelPath}'`)
    expect(source).toContain(
      `  '${channelPath}': [${products.map((product) => `'${product}'`).join(', ')}],`,
    )
  },
)
