import type { InputVar } from '@/models/pipeline'
import { ORPCError } from '@orpc/client'
import { act, waitFor } from '@testing-library/react'
import { createEdge, createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowCanvasHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import { PipelineInputVarType } from '@/models/pipeline'
import { createDeferred } from '@/test/deferred'
import { useSnippetDraftStore } from '../../draft-store'
import { useNodesSyncDraft } from '../use-nodes-sync-draft'

const mockRefreshDraft = vi.fn()
const mockPostWithKeepalive = vi.fn()
const mockSyncDraftWorkflow = vi.fn()

// Rejections pass through the console link's contract error validation, as in production.
vi.mock('@/service/console', async (importOriginal) => {
  const { snippets } = await import('@dify/contracts/api/console/snippets/orpc.gen')
  const { validateDefinedErrors } = await import('@/service/console/defined-errors')
  const validate = validateDefinedErrors({ snippets })
  const post = (...args: unknown[]) =>
    validate({
      context: {},
      input: args[0],
      path: ['snippets', 'bySnippetId', 'workflows', 'draft', 'post'],
      next: () => mockSyncDraftWorkflow(...args),
    })
  return {
    ...(await importOriginal<typeof import('@/service/console')>()),
    consoleClient: { snippets: { bySnippetId: { workflows: { draft: { post } } } } },
  }
})

vi.mock('@/service/fetch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/fetch')>()),
  postWithKeepalive: (...args: unknown[]) => mockPostWithKeepalive(...args),
}))

vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  API_PREFIX: '/api',
}))

vi.mock('../use-snippet-refresh-draft', () => ({
  useSnippetRefreshDraft: () => ({
    handleRefreshWorkflowDraft: mockRefreshDraft,
  }),
}))

const createInputField = (variable: string): InputVar => ({
  type: PipelineInputVarType.textInput,
  label: variable,
  variable,
  required: false,
})

const canvasNode = createNode({
  id: 'node-1',
  data: { type: BlockEnum.Start, title: 'Start', _temp: 'drop' },
})
const canvasEdge = createEdge({ id: 'edge-1', source: 'node-1', target: 'node-2' })
const savedGraph = {
  nodes: [
    expect.objectContaining({
      id: 'node-1',
      position: { x: 0, y: 0 },
      data: { type: BlockEnum.Start, title: 'Start', desc: '' },
    }),
  ],
  edges: [canvasEdge],
  viewport: { x: 12, y: 24, zoom: 1.5 },
}

const renderSnippetDraftSync = () =>
  renderWorkflowCanvasHook(() => useNodesSyncDraft('snippet-1'), {
    resource: { kind: 'snippet', snippetId: 'snippet-1' },
    nodes: [canvasNode],
    edges: [canvasEdge],
    transform: [12, 24, 1.5],
    initialStoreState: { syncWorkflowDraftHash: 'draft-hash' },
  })

describe('snippet/use-nodes-sync-draft', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    useSnippetDraftStore.getState().reset()
    mockSyncDraftWorkflow.mockResolvedValue({
      hash: 'next-hash',
      updated_at: 123,
    })
    useSnippetDraftStore.getState().setInputFields([createInputField('topic')])
  })

  it.each([
    { code: 'draft_workflow_not_sync', skipRefresh: false, refreshes: 1 },
    { code: 'draft_workflow_not_sync', skipRefresh: true, refreshes: 0 },
    { code: 'forbidden', skipRefresh: false, refreshes: 0 },
  ])(
    'recovers from $code with skipRefresh=$skipRefresh and allows retry',
    async ({ code, skipRefresh, refreshes }) => {
      mockSyncDraftWorkflow.mockRejectedValueOnce(
        new ORPCError(code, {
          status: code === 'forbidden' ? 403 : 409,
          message: 'Draft could not be saved',
          data: {
            code,
            message: 'Draft could not be saved',
            status: code === 'forbidden' ? 403 : 409,
          },
        }),
      )
      const callback = { onError: vi.fn(), onSuccess: vi.fn(), onSettled: vi.fn() }
      const { result, store } = renderSnippetDraftSync()

      await act(async () => {
        expect(await result.current.doSyncWorkflowDraft(skipRefresh, callback)).toBeUndefined()
      })

      expect(mockRefreshDraft).toHaveBeenCalledTimes(refreshes)
      expect(callback.onError).toHaveBeenCalledOnce()
      expect(callback.onSuccess).not.toHaveBeenCalled()
      expect(callback.onSettled).toHaveBeenCalledOnce()
      expect(store.getState().syncWorkflowDraftHash).toBe('draft-hash')
      expect(useSnippetDraftStore.getState().inputFields).toEqual([createInputField('topic')])

      await act(async () => {
        await result.current.doSyncWorkflowDraft(false, callback)
      })

      expect(callback.onSuccess).toHaveBeenCalledOnce()
      expect(callback.onSettled).toHaveBeenCalledTimes(2)
      expect(store.getState()).toMatchObject({
        syncWorkflowDraftHash: 'next-hash',
        draftUpdatedAt: 123_000,
      })
    },
  )

  it('should include current input_fields when syncing the draft graph', async () => {
    const { result } = renderSnippetDraftSync()

    await act(async () => {
      await result.current.doSyncWorkflowDraft()
    })

    expect(mockSyncDraftWorkflow).toHaveBeenCalledWith({
      params: { snippet_id: 'snippet-1' },
      body: {
        graph: savedGraph,
        input_fields: [createInputField('topic')],
        hash: 'draft-hash',
      },
    })
  })

  it('should include the latest graph when syncing input fields', async () => {
    const { result } = renderSnippetDraftSync()
    const nextFields = [createInputField('summary')]

    await act(async () => {
      await result.current.syncInputFieldsDraft(nextFields)
    })

    expect(mockSyncDraftWorkflow).toHaveBeenCalledWith({
      params: { snippet_id: 'snippet-1' },
      body: {
        graph: savedGraph,
        input_fields: nextFields,
        hash: 'draft-hash',
      },
    })
  })

  it('queues saves across hook instances while preserving captured graphs and advancing the hash', async () => {
    const firstSave = createDeferred<{ hash: string; updated_at: number }>()
    mockSyncDraftWorkflow.mockReturnValueOnce(firstSave.promise)
    const { result, setCanvas, store } = renderWorkflowCanvasHook(
      () => [useNodesSyncDraft('snippet-1'), useNodesSyncDraft('snippet-1')] as const,
      {
        resource: { kind: 'snippet', snippetId: 'snippet-1' },
        nodes: [canvasNode],
        edges: [canvasEdge],
        transform: [12, 24, 1.5],
        initialStoreState: { syncWorkflowDraftHash: 'draft-hash' },
      },
    )
    const [firstHook, secondHook] = result.current
    let first!: ReturnType<typeof firstHook.doSyncWorkflowDraft>
    let second!: ReturnType<typeof secondHook.doSyncWorkflowDraft>
    act(() => {
      first = firstHook.doSyncWorkflowDraft()
    })
    await waitFor(() => expect(mockSyncDraftWorkflow).toHaveBeenCalledOnce())

    const queuedNode = createNode({
      id: 'queued-node',
      position: { x: 2, y: 3 },
      data: { type: BlockEnum.Code, title: 'Queued' },
    })
    setCanvas({ nodes: [queuedNode], edges: [], transform: [20, 30, 1.2] })
    act(() => {
      second = secondHook.doSyncWorkflowDraft()
    })
    expect(mockSyncDraftWorkflow).toHaveBeenCalledOnce()
    // Changes made after enqueueing must not replace the captured graph.
    setCanvas({ nodes: [], transform: [0, 0, 1] })
    await act(async () => {
      firstSave.resolve({ hash: 'hash-after-first', updated_at: 123 })
      await Promise.all([first, second])
    })

    expect(mockSyncDraftWorkflow).toHaveBeenNthCalledWith(1, {
      params: { snippet_id: 'snippet-1' },
      body: expect.objectContaining({ hash: 'draft-hash' }),
    })
    expect(mockSyncDraftWorkflow).toHaveBeenNthCalledWith(2, {
      params: { snippet_id: 'snippet-1' },
      body: {
        graph: {
          nodes: [
            expect.objectContaining({
              id: 'queued-node',
              data: { type: BlockEnum.Code, title: 'Queued', desc: '' },
            }),
          ],
          edges: [],
          viewport: { x: 20, y: 30, zoom: 1.2 },
        },
        input_fields: [createInputField('topic')],
        hash: 'hash-after-first',
      },
    })
    expect(store.getState().syncWorkflowDraftHash).toBe('next-hash')
  })

  it('should send input_fields together with graph on page close', () => {
    const { result } = renderSnippetDraftSync()

    act(() => {
      result.current.syncWorkflowDraftWhenPageClose()
    })

    expect(mockPostWithKeepalive).toHaveBeenCalledWith('/api/snippets/snippet-1/workflows/draft', {
      graph: savedGraph,
      input_fields: [createInputField('topic')],
      hash: 'draft-hash',
    })
  })

  it('does not persist the draft while the canvas is read-only', async () => {
    const { result, store } = renderSnippetDraftSync()
    act(() => store.setState({ canvasReadOnly: true }))

    await act(async () => {
      await result.current.doSyncWorkflowDraft()
      result.current.syncWorkflowDraftWhenPageClose()
    })

    expect(mockSyncDraftWorkflow).not.toHaveBeenCalled()
    expect(mockPostWithKeepalive).not.toHaveBeenCalled()
  })
})
