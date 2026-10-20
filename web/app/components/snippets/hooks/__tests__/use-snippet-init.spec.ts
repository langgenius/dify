import type { SnippetWorkflow } from '@/types/snippet'
import { act, waitFor } from '@testing-library/react'
import { renderWorkflowHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { createHttpError } from '@/service/http-error'
import { createDeferred } from '@/test/deferred'
import { useSnippetInit } from '../use-snippet-init'

const requests = vi.hoisted(() => ({
  detail: vi.fn(),
  draft: vi.fn(),
  defaults: vi.fn(),
  published: vi.fn(),
}))
const workflow = (overrides: Partial<SnippetWorkflow> = {}): SnippetWorkflow => ({
  id: 'draft-1',
  graph: {},
  features: {},
  input_fields: [],
  hash: 'draft-hash',
  created_at: 1_712_300_000,
  updated_at: 1_712_345_678,
  ...overrides,
})
const notFound = () =>
  createHttpError(new Response(null, { status: 404 }), { message: 'Not found' })

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

beforeEach(() => {
  vi.resetAllMocks()
  requests.detail.mockImplementation(async ({ params }: { params: { snippet_id: string } }) => ({
    id: params.snippet_id,
    name: 'Tone Rewriter',
    description: '',
    type: 'node',
    is_published: false,
    version: '1',
    use_count: 0,
    tags: [],
    created_at: 1_712_300_000,
    created_by: 'user-1',
    updated_at: 1_712_300_000,
    updated_by: 'user-1',
  }))
  requests.draft.mockRejectedValue(notFound())
  requests.defaults.mockResolvedValue({})
  requests.published.mockResolvedValue(null)
})
const renderInit = () => renderWorkflowHook(() => useSnippetInit('snippet-1'))

it('initializes an empty graph when no draft or published workflow exists', async () => {
  const { result, store } = renderInit()
  await waitFor(() => expect(result.current.isLoading).toBe(false))
  expect(result.current.data?.snippet.id).toBe('snippet-1')
  expect(result.current.data?.draft.graph).toEqual({
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  })
  expect(store.getState().isWorkflowDataLoaded).toBe(true)
  expect(store.getState().publishedAt).toBe(0)
})

it('loads draft fields and metadata while preserving the published graph', async () => {
  requests.published.mockResolvedValue(
    workflow({ graph: { nodes: [{ id: 'published' }] }, created_at: 100 }),
  )
  const input_fields = [
    { label: 'Draft field', variable: 'draft_field', type: 'text-input', required: true },
  ]
  requests.draft.mockResolvedValue(
    workflow({
      input_fields,
      graph: { nodes: [{ id: 'draft' }], viewport: { x: 10, y: 20, zoom: 1.2 } },
    }),
  )
  const { result, store } = renderInit()
  await waitFor(() => expect(result.current.isLoading).toBe(false))
  expect(result.current.data?.draft.inputFields).toEqual(input_fields)
  expect(result.current.data?.published.graph.nodes).toEqual([{ id: 'published' }])
  expect(result.current.data?.draft.graph.viewport).toEqual({ x: 10, y: 20, zoom: 1.2 })
  expect(result.current.data?.hasDraftChanges).toBe(true)
  expect(store.getState()).toMatchObject({
    publishedAt: 100_000,
    draftUpdatedAt: 1_712_345_678_000,
    syncWorkflowDraftHash: 'draft-hash',
  })
})

it('keeps initialization gated until the draft request completes', async () => {
  const pending = createDeferred<SnippetWorkflow>()
  requests.draft.mockReturnValue(pending.promise)
  const { result } = renderInit()
  await waitFor(() => expect(requests.detail).toHaveBeenCalled())
  expect(result.current.isLoading).toBe(true)
  expect(result.current.data).toBeUndefined()
  await act(async () => pending.resolve(workflow()))
  await waitFor(() => expect(result.current.isLoading).toBe(false))
})

it('keeps initialization gated on an unexpected draft failure', async () => {
  requests.draft.mockRejectedValue(new Error('unavailable'))
  const { result, store } = renderInit()
  await waitFor(() => expect(requests.draft).toHaveBeenCalled())
  expect(result.current.data).toBeUndefined()
  expect(result.current.isLoading).toBe(true)
  expect(store.getState().isWorkflowDataLoaded).toBe(false)
})

it('ignores an outdated draft response after selecting another snippet', async () => {
  const first = createDeferred<SnippetWorkflow>()
  requests.draft.mockImplementation(({ params }: { params: { snippet_id: string } }) =>
    params.snippet_id === 'snippet-1'
      ? first.promise
      : Promise.resolve(workflow({ hash: 'second-hash', graph: { nodes: [{ id: 'second' }] } })),
  )
  const { result, rerender, store } = renderWorkflowHook(({ id }) => useSnippetInit(id), {
    initialProps: { id: 'snippet-1' },
  })
  await waitFor(() => expect(requests.draft).toHaveBeenCalled())
  rerender({ id: 'snippet-2' })
  await waitFor(() => expect(result.current.isLoading).toBe(false))
  await act(async () => first.resolve(workflow({ hash: 'stale-hash' })))
  expect(result.current.data?.snippet.id).toBe('snippet-2')
  expect(result.current.data?.draft.graph.nodes).toEqual([{ id: 'second' }])
  expect(store.getState().syncWorkflowDraftHash).toBe('second-hash')
})

it.each([[{ type: 'llm', config: { model: 'gpt-4.1' } }], { llm: { model: 'gpt-4.1' } }])(
  'normalizes fetched block defaults into the workflow store',
  async (defaults) => {
    requests.defaults.mockResolvedValue(defaults)
    const { store } = renderInit()
    await waitFor(() =>
      expect(store.getState().nodesDefaultConfigs).toEqual({ llm: { model: 'gpt-4.1' } }),
    )
  },
)
