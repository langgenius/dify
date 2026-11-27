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

it('types product pages only by their productless path', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        navigation: {
          pages: ['en/cloud/use-dify/build/agent', 'en/self-host/use-dify/build/agent'],
        },
      }),
    ),
  )

  await import('../gen-doc-paths')
  await vi.waitFor(() => expect(writeFile).toHaveBeenCalledOnce())

  const [, source] = vi.mocked(writeFile).mock.calls[0]!
  expect(source).toContain(`  | '/use-dify/build/agent'`)
  expect(source).not.toContain(`'/cloud/use-dify/build/agent'`)
  expect(source).not.toContain(`'/self-host/use-dify/build/agent'`)
})

const docsJsonWithOpenApi = {
  navigation: {
    pages: [
      'en/use-dify/getting-started/introduction',
      { openapi: 'en/api-reference/openapi.json' },
    ],
  },
}
const openApiSpec = {
  paths: { '/datasets': { get: { summary: 'List Knowledge Bases', tags: ['Datasets'] } } },
}

it('aborts without writing when a docs source is missing', async () => {
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input) =>
      String(input).endsWith('openapi.json')
        ? new Response('', { status: 404 })
        : Response.json(docsJsonWithOpenApi),
    ),
  )

  await import('../gen-doc-paths')
  await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1))

  expect(writeFile).not.toHaveBeenCalled()
})

it('retries a transient docs source failure before generating', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  let openApiRequests = 0
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input) => {
      if (!String(input).endsWith('openapi.json')) return Response.json(docsJsonWithOpenApi)
      openApiRequests++
      return openApiRequests === 1 ? new Response('', { status: 503 }) : Response.json(openApiSpec)
    }),
  )

  await import('../gen-doc-paths')
  await vi.advanceTimersByTimeAsync(2000)
  await vi.waitFor(() => expect(writeFile).toHaveBeenCalledOnce())
  vi.useRealTimers()

  const [, source] = vi.mocked(writeFile).mock.calls[0]!
  expect(openApiRequests).toBe(2)
  expect(source).toContain(`  | '/api-reference/datasets/list-knowledge-bases'`)
})
