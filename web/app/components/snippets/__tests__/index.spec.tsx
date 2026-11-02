import type { SnippetWorkflow } from '@/types/snippet'
import { act, screen, waitFor } from '@testing-library/react'
import { createEdge, createNode } from '@/app/components/workflow/__tests__/fixtures'
import { WorkflowInitializationProbe } from '@/app/components/workflow/__tests__/workflow-initialization-probe'
import codeNodeDefault from '@/app/components/workflow/nodes/code/default'
import { consoleQuery } from '@/service/console'
import { createHttpError } from '@/service/http-error'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import SnippetPage from '..'

const requests = vi.hoisted(() => ({
  detail: vi.fn(),
  draft: vi.fn(),
  defaults: vi.fn(),
  published: vi.fn(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'snippets.bySnippetId.workflows.draft.get': requests.draft,
    }),
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.customizedSnippets.bySnippetId.get': requests.detail,
      'snippets.bySnippetId.workflows.defaultWorkflowBlockConfigs.get': requests.defaults,
      'snippets.bySnippetId.workflows.publish.get': requests.published,
    }),
  }
})

// SnippetMain owns editing and publishing; this page owns fetching and choosing the initial graph.
vi.mock('../components/snippet-main', () => ({
  default: ({ hasPublishedWorkflow }: { hasPublishedWorkflow: boolean }) => (
    <>
      <WorkflowInitializationProbe />
      <output aria-label="Published workflow">{String(hasPublishedWorkflow)}</output>
    </>
  ),
}))

const workflow = (version: string): SnippetWorkflow => ({
  id: version,
  graph: {
    nodes: [
      createNode({
        id: `${version}-source`,
        data: {
          ...codeNodeDefault.defaultValue,
          code: 'def main(): return {}',
          title: `${version} source`,
        },
      }),
      createNode({
        id: `${version}-target`,
        data: {
          ...codeNodeDefault.defaultValue,
          code: 'def main(): return {}',
          title: `${version} target`,
        },
      }),
    ],
    edges: [createEdge({ source: `${version}-source`, target: `${version}-target` })],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
  features: {},
  input_fields: [],
  hash: `${version}-hash`,
  created_at: 1_712_300_000,
  updated_at: 1_712_345_678,
})

beforeEach(() => {
  requests.detail.mockReset().mockResolvedValue({
    id: 'snippet-1',
    name: 'Tone Rewriter',
    description: 'Rewrites a draft.',
    type: 'node',
    is_published: true,
    version: '1',
    use_count: 0,
    tags: [],
    created_at: 1_712_300_000,
    created_by: 'user-1',
    updated_at: 1_712_300_000,
    updated_by: 'user-1',
  })
  requests.defaults.mockReset().mockResolvedValue({})
  requests.draft.mockReset().mockResolvedValue(workflow('draft'))
  requests.published.mockReset().mockResolvedValue(workflow('published'))
})

const expectGraph = async (version: string) => {
  expect(await screen.findByRole('status', { name: 'Initialized nodes' })).toHaveTextContent(
    `${version}-source:${version} source,${version}-target:${version} target`,
  )
  expect(screen.getByRole('status', { name: 'Initialized edges' })).toHaveTextContent(
    `${version}-source->${version}-target`,
  )
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
}

describe('SnippetPage', () => {
  it.each([
    { published: true, version: 'published' },
    { published: false, version: 'draft' },
  ])(
    'initializes the $version graph in the real workflow provider',
    async ({ published, version }) => {
      if (!published) requests.published.mockResolvedValue(null)
      renderWithConsoleQuery(<SnippetPage snippetId="snippet-1" />)

      await expectGraph(version)
      expect(screen.getByRole('status', { name: 'Published workflow' })).toHaveTextContent(
        String(published),
      )
      expect(requests.draft).toHaveBeenCalledWith(
        { params: { snippet_id: 'snippet-1' } },
        expect.anything(),
      )
    },
  )

  it('keeps the loading fallback when the snippet is unavailable', async () => {
    requests.detail.mockRejectedValue(
      createHttpError(new Response(null, { status: 404 }), { message: 'Not found' }),
    )
    const { queryClient } = renderWithConsoleQuery(<SnippetPage snippetId="missing-snippet" />)

    await waitFor(() =>
      expect(
        queryClient.getQueryState(
          consoleQuery.workspaces.current.customizedSnippets.bySnippetId.get.queryKey({
            input: { params: { snippet_id: 'missing-snippet' } },
          }),
        )?.status,
      ).toBe('error'),
    )
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Initialized nodes' })).not.toBeInTheDocument()
  })

  it('keeps the route shell gated until the draft arrives', async () => {
    const pending = createDeferred<SnippetWorkflow>()
    requests.draft.mockReturnValue(pending.promise)
    renderWithConsoleQuery(<SnippetPage snippetId="snippet-1" />)

    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Initialized nodes' })).not.toBeInTheDocument()
    await act(async () => pending.resolve(workflow('draft')))
    await expectGraph('published')
  })
})
