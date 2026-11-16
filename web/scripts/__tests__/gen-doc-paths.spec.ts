// @vitest-environment node

import { writeFile } from 'node:fs/promises'

// boundary: capture the generated file without overwriting the checked-in documentation paths.
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  writeFile: vi.fn().mockResolvedValue(undefined),
}))

afterEach(() => {
  vi.unstubAllGlobals()
})

it('generates channel help paths for both products when they are missing from navigation', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        navigation: {
          languages: [
            { pages: ['en/cloud/use-dify/getting-started/introduction'] },
            { pages: ['zh/self-host/use-dify/getting-started/introduction'] },
          ],
        },
      }),
    ),
  )

  await import('../gen-doc-paths')
  await vi.waitFor(() => expect(writeFile).toHaveBeenCalledOnce())

  const [, source] = vi.mocked(writeFile).mock.calls[0]!
  for (const channel of [
    'overview',
    'email',
    'feishu-lark',
    'dingtalk',
    'wecom',
    'slack',
    'ms-teams',
  ]) {
    const channelPath = `/use-dify/workspace/channels/${channel}`
    expect(source).toContain(`  | '${channelPath}'`)
    expect(source).toContain(`  '${channelPath}': ['cloud', 'self-host'],`)
  }
})
