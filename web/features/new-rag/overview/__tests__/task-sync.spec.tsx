import type {
  KnowledgeFsBackgroundTaskResponse,
  KnowledgeFsOverviewAttentionResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { createStore, Provider, useAtomValueRawSync } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { OverviewTaskSync } from '../overview-task-sync'
import { overviewActivityPreviewDataAtom, overviewAttentionDataAtom } from '../state'
import { OverviewStateBoundary } from '../state-boundary'

const service = vi.hoisted(() => ({
  attention: vi.fn(),
  activity: vi.fn(),
  tasks: vi.fn(),
  deploymentEdition: vi.fn(),
}))
vi.mock('@/features/system-features/state', async () => {
  const { atom } = await import('jotai')
  return { deploymentEditionAtom: atom(() => service.deploymentEdition()) }
})
vi.mock('@/service/console', () => {
  const endpoint = (name: 'attention' | 'activity') => ({
    get: {
      key: ({ input }: { input: { params: { control_space_id: string } } }) => [
        'overview',
        name,
        input.params.control_space_id,
      ],
      queryOptions: (options: { input: { params: { control_space_id: string } } }) => ({
        ...options,
        queryKey: ['overview', name, options.input.params.control_space_id],
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          service[name](options.input.params.control_space_id, signal),
      }),
    },
  })
  return {
    consoleQuery: {
      features: {
        get: { key: () => ['billing', 'features'] },
        vectorSpace: { get: { key: () => ['billing', 'vector-space'] } },
      },
      knowledgeFs: {
        spaces: {
          byControlSpaceId: {
            overview: { attention: endpoint('attention'), activity: endpoint('activity') },
            backgroundTasks: {
              get: {
                infiniteOptions: (options: {
                  input: (page: null) => { params: { control_space_id: string } }
                }) => ({
                  ...options,
                  queryKey: ['overview', 'tasks', options.input(null).params.control_space_id],
                  queryFn: ({ signal }: { signal: AbortSignal }) =>
                    service.tasks(options.input(null).params.control_space_id, signal),
                }),
              },
            },
          },
        },
      },
    },
  }
})

const failedIssue: KnowledgeFsOverviewAttentionResponse = {
  action: { kind: 'open-resource', resource_id: 'document-1', resource_type: 'document' },
  evidence: [{ code: 'DOCUMENT_PROCESSING_FAILED', observed_at: '2026-09-08T00:00:01Z' }],
  issue_key: 'failed-document:document:document-1',
  knowledge_space_id: 'space-a',
  resource: { id: 'document-1', type: 'document' },
  revision: 1,
  rule_id: 'failed-document',
  severity: 'critical',
  status: 'active',
  title: 'Document processing failed',
  updated_at: '2026-09-08T00:00:01Z',
}
function task(
  state: KnowledgeFsBackgroundTaskResponse['state'],
): KnowledgeFsBackgroundTaskResponse {
  return {
    can_cancel: state === 'running',
    can_retry: state === 'failed',
    created_at: '2026-09-08T00:00:00Z',
    updated_at: state === 'running' ? '2026-09-08T00:00:00Z' : '2026-09-08T00:00:01Z',
    id: 'task-1',
    document_id: 'document-1',
    knowledge_space_id: 'space-a',
    operation: 'document_processing',
    progress_completed: 0,
    progress_failed: state === 'failed' ? 1 : 0,
    progress_percent: 20,
    progress_total: 1,
    state,
    task_kind: 'document',
  }
}
function Snapshot() {
  const attention = useAtomValueRawSync(overviewAttentionDataAtom)
  const activity = useAtomValueRawSync(overviewActivityPreviewDataAtom)
  return (
    <div>
      {attention.map((issue) => (
        <p key={issue.issue_key}>{issue.title}</p>
      ))}
      <output>{activity.length}</output>
    </div>
  )
}

describe('overview task completion synchronization', () => {
  let client: QueryClient
  beforeEach(() => {
    vi.resetAllMocks()
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
    service.activity.mockResolvedValue({ data: [], next_cursor: null })
    service.attention.mockResolvedValue({ data: [] })
    service.tasks.mockResolvedValue({ data: [task('running')], next_cursor: null })
    service.deploymentEdition.mockReturnValue('ENTERPRISE')
    client.setQueryData(['billing', 'features'], { documents_upload_quota: { size: 1, limit: 10 } })
    client.setQueryData(['billing', 'vector-space'], { size: 1, limit: 10 })
  })
  afterEach(() => {
    cleanup()
    client.clear()
  })

  function mount() {
    const store = createStore()
    store.set(queryClientAtom, client)
    return render(
      <QueryClientProvider client={client}>
        <Provider store={store}>
          <OverviewStateBoundary knowledgeSpaceId="space-a">
            <OverviewTaskSync />
            <Snapshot />
          </OverviewStateBoundary>
        </Provider>
      </QueryClientProvider>,
    )
  }

  it('cancels a pre-terminal snapshot and fetches failures after the last active task stops', async () => {
    service.deploymentEdition.mockReturnValue('CLOUD')
    const cancelQueries = vi.spyOn(client, 'cancelQueries')
    const invalidateQueries = vi.spyOn(client, 'invalidateQueries')
    let resolveStale!: (value: { data: KnowledgeFsOverviewAttentionResponse[] }) => void
    service.attention.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStale = resolve
        }),
    )
    mount()
    await waitFor(() => expect(service.attention).toHaveBeenCalledOnce())
    await waitFor(() => expect(service.tasks).toHaveBeenCalledOnce())
    expect(client.getQueryState(['billing', 'features'])?.isInvalidated).toBe(false)
    expect(client.getQueryState(['billing', 'vector-space'])?.isInvalidated).toBe(false)
    const staleSignal = service.attention.mock.calls[0]![1] as AbortSignal
    service.tasks.mockResolvedValue({ data: [task('failed')], next_cursor: null })
    service.attention.mockResolvedValue({ data: [failedIssue] })

    await act(() => client.invalidateQueries({ queryKey: ['overview', 'tasks', 'space-a'] }))
    expect(await screen.findByText('Document processing failed')).toBeInTheDocument()
    expect(staleSignal.aborted).toBe(true)
    expect(client.getQueryState(['billing', 'features'])?.isInvalidated).toBe(true)
    expect(client.getQueryState(['billing', 'vector-space'])?.isInvalidated).toBe(true)
    expect(cancelQueries).not.toHaveBeenCalledWith({ queryKey: ['billing', 'features'] })
    expect(cancelQueries).not.toHaveBeenCalledWith({ queryKey: ['billing', 'vector-space'] })
    expect(invalidateQueries).toHaveBeenCalledWith(
      { queryKey: ['billing', 'features'] },
      { cancelRefetch: false },
    )
    expect(invalidateQueries).toHaveBeenCalledWith(
      { queryKey: ['billing', 'vector-space'] },
      { cancelRefetch: false },
    )
    await act(async () => {
      resolveStale({ data: [] })
    })
    expect(screen.getByText('Document processing failed')).toBeInTheDocument()
    expect(service.activity.mock.calls.length).toBeGreaterThanOrEqual(2)
    const calls = service.attention.mock.calls.length
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2100))
    })
    expect(service.attention).toHaveBeenCalledTimes(calls)
  })

  it.each(['features', 'vector-space'])(
    'preserves an active %s precheck while refreshing terminal tasks',
    async (usageKey) => {
      service.deploymentEdition.mockReturnValue('CLOUD')
      const queryKey = ['billing', usageKey]
      let resolveUsage!: (value: { size: number; limit: number }) => void
      let precheckSignal!: AbortSignal
      const queryFn = vi.fn(({ signal }: { signal: AbortSignal }) => {
        precheckSignal = signal
        return new Promise<{ size: number; limit: number }>((resolve) => {
          resolveUsage = resolve
        })
      })
      const observer = new QueryObserver(client, { queryKey, queryFn, staleTime: Infinity })
      const unsubscribe = observer.subscribe(() => {})
      const precheck = client
        .query({ queryKey, queryFn, staleTime: 0, retry: false })
        .catch((error: unknown) => error)

      try {
        mount()
        await waitFor(() => expect(service.tasks).toHaveBeenCalledOnce())
        service.tasks.mockResolvedValue({ data: [task('failed')], next_cursor: null })
        service.attention.mockResolvedValue({ data: [failedIssue] })

        await act(() => client.invalidateQueries({ queryKey: ['overview', 'tasks', 'space-a'] }))
        expect(await screen.findByText('Document processing failed')).toBeInTheDocument()
        expect(precheckSignal.aborted).toBe(false)
        expect(queryFn).toHaveBeenCalledOnce()

        resolveUsage({ size: 2, limit: 10 })
        await expect(precheck).resolves.toEqual({ size: 2, limit: 10 })
      } finally {
        unsubscribe()
      }
    },
  )

  it('refreshes again for a manual retry completion while preserving another space cache', async () => {
    client.setQueryData(['overview', 'attention', 'space-b'], { data: [failedIssue] })
    mount()
    await waitFor(() => expect(service.tasks).toHaveBeenCalledOnce())
    service.tasks.mockResolvedValue({ data: [task('failed')], next_cursor: null })
    service.attention.mockResolvedValue({ data: [failedIssue] })
    await act(() => client.invalidateQueries({ queryKey: ['overview', 'tasks', 'space-a'] }))
    expect(await screen.findByText('Document processing failed')).toBeInTheDocument()
    service.tasks.mockResolvedValue({ data: [task('running')], next_cursor: null })
    await act(() => client.invalidateQueries({ queryKey: ['overview', 'tasks', 'space-a'] }))
    service.tasks.mockResolvedValue({
      data: [{ ...task('completed'), updated_at: '2026-09-08T00:00:03Z' }],
      next_cursor: null,
    })
    service.attention.mockResolvedValue({ data: [] })
    await act(() => client.invalidateQueries({ queryKey: ['overview', 'tasks', 'space-a'] }))
    await waitFor(() =>
      expect(screen.queryByText('Document processing failed')).not.toBeInTheDocument(),
    )
    expect(client.getQueryState(['overview', 'attention', 'space-b'])?.isInvalidated).toBe(false)
    expect(client.getQueryData(['overview', 'attention', 'space-b'])).toEqual({
      data: [failedIssue],
    })
    expect(client.getQueryState(['billing', 'features'])?.isInvalidated).toBe(false)
    expect(client.getQueryState(['billing', 'vector-space'])?.isInvalidated).toBe(false)
  })
})
