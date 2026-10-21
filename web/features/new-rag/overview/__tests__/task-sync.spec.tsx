import type {
  KnowledgeFsBackgroundTaskResponse,
  KnowledgeFsOverviewAttentionResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { zGetFeaturesVectorSpaceResponse } from '@dify/contracts/api/console/features/zod.gen'
import { QueryObserver } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import { useAtomValueRawSync } from 'jotai'
import { consoleQuery } from '@/service/console'
import {
  createConsoleQueryClient,
  createConsoleQueryWrapper,
  seedFeatures,
} from '@/test/console/query-data'
import { OverviewTaskSync } from '../overview-task-sync'
import { overviewActivityPreviewDataAtom, overviewAttentionDataAtom } from '../state'
import { OverviewStateBoundary } from '../state-boundary'

type SpaceInput = { params: { control_space_id: string } }

const service = vi.hoisted(() => ({
  attention: vi.fn(),
  activity: vi.fn(),
  tasks: vi.fn(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleQueryOverrides } = await import('@/test/console/service-responses')
  const spaceQuery = (handler: (spaceId: string, signal: AbortSignal) => unknown) => ({
    queryOptions: ({ input }: { input: SpaceInput }) => ({
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        handler(input.params.control_space_id, signal),
    }),
  })
  return {
    ...actual,
    consoleQuery: withConsoleQueryOverrides(actual.consoleQuery, {
      'knowledgeFs.spaces.byControlSpaceId.overview.attention.get': spaceQuery(service.attention),
      'knowledgeFs.spaces.byControlSpaceId.overview.activity.get': spaceQuery(service.activity),
      'knowledgeFs.spaces.byControlSpaceId.backgroundTasks.get': {
        infiniteOptions: ({ input }: { input: (page: null) => SpaceInput }) => ({
          queryFn: ({ signal }: { signal: AbortSignal }) =>
            service.tasks(input(null).params.control_space_id, signal),
        }),
      },
    }),
  }
})

const billingKeys = {
  features: () => consoleQuery.features.get.queryKey(),
  'vector-space': () => consoleQuery.features.vectorSpace.get.queryKey(),
}
const tasksKey = () => consoleQuery.knowledgeFs.spaces.byControlSpaceId.backgroundTasks.get.key()

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
  let client: ReturnType<typeof createConsoleQueryClient>
  beforeEach(() => {
    vi.resetAllMocks()
    client = createConsoleQueryClient()
    service.activity.mockResolvedValue({ data: [], next_cursor: null })
    service.attention.mockResolvedValue({ data: [] })
    service.tasks.mockResolvedValue({ data: [task('running')], next_cursor: null })
    seedFeatures(client, { documents_upload_quota: { size: 1, limit: 10 } })
    client.setQueryData(
      billingKeys['vector-space'](),
      zGetFeaturesVectorSpaceResponse.parse({ size: 1, limit: 10 }),
    )
  })

  function mount(deploymentEdition: 'CLOUD' | 'ENTERPRISE' = 'ENTERPRISE') {
    const { wrapper } = createConsoleQueryWrapper({
      queryClient: client,
      systemFeatures: { deployment_edition: deploymentEdition },
    })
    return render(
      <OverviewStateBoundary knowledgeSpaceId="space-a">
        <OverviewTaskSync />
        <Snapshot />
      </OverviewStateBoundary>,
      { wrapper },
    )
  }

  it('cancels a pre-terminal snapshot and fetches failures after the last active task stops', async () => {
    let resolveStale!: (value: { data: KnowledgeFsOverviewAttentionResponse[] }) => void
    service.attention.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStale = resolve
        }),
    )
    mount('CLOUD')
    await waitFor(() => expect(service.attention).toHaveBeenCalledOnce())
    await waitFor(() => expect(service.tasks).toHaveBeenCalledOnce())
    expect(client.getQueryState(billingKeys.features())?.isInvalidated).toBe(false)
    expect(client.getQueryState(billingKeys['vector-space']())?.isInvalidated).toBe(false)
    const staleSignal = service.attention.mock.calls[0]![1] as AbortSignal
    service.tasks.mockResolvedValue({ data: [task('failed')], next_cursor: null })
    service.attention.mockResolvedValue({ data: [failedIssue] })

    await act(() => client.invalidateQueries({ queryKey: tasksKey() }))
    expect(await screen.findByText('Document processing failed')).toBeInTheDocument()
    expect(staleSignal.aborted).toBe(true)
    expect(client.getQueryState(billingKeys.features())?.isInvalidated).toBe(true)
    expect(client.getQueryState(billingKeys['vector-space']())?.isInvalidated).toBe(true)
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

  it.each(['features', 'vector-space'] as const)(
    'preserves an active %s precheck while refreshing terminal tasks',
    async (usageKey) => {
      const queryKey = billingKeys[usageKey]()
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
        mount('CLOUD')
        await waitFor(() => expect(service.tasks).toHaveBeenCalledOnce())
        service.tasks.mockResolvedValue({ data: [task('failed')], next_cursor: null })
        service.attention.mockResolvedValue({ data: [failedIssue] })

        await act(() => client.invalidateQueries({ queryKey: tasksKey() }))
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
    const otherSpaceAttentionKey =
      consoleQuery.knowledgeFs.spaces.byControlSpaceId.overview.attention.get.queryKey({
        input: {
          params: { control_space_id: 'space-b' },
          query: { include_dismissed: false, limit: 100 },
        },
      })
    client.setQueryData(otherSpaceAttentionKey, { data: [failedIssue] })
    mount()
    await waitFor(() => expect(service.tasks).toHaveBeenCalledOnce())
    service.tasks.mockResolvedValue({ data: [task('failed')], next_cursor: null })
    service.attention.mockResolvedValue({ data: [failedIssue] })
    await act(() => client.invalidateQueries({ queryKey: tasksKey() }))
    expect(await screen.findByText('Document processing failed')).toBeInTheDocument()
    service.tasks.mockResolvedValue({ data: [task('running')], next_cursor: null })
    await act(() => client.invalidateQueries({ queryKey: tasksKey() }))
    service.tasks.mockResolvedValue({
      data: [{ ...task('completed'), updated_at: '2026-09-08T00:00:03Z' }],
      next_cursor: null,
    })
    service.attention.mockResolvedValue({ data: [] })
    await act(() => client.invalidateQueries({ queryKey: tasksKey() }))
    await waitFor(() =>
      expect(screen.queryByText('Document processing failed')).not.toBeInTheDocument(),
    )
    expect(client.getQueryState(otherSpaceAttentionKey)?.isInvalidated).toBe(false)
    expect(client.getQueryData(otherSpaceAttentionKey)).toEqual({
      data: [failedIssue],
    })
    expect(client.getQueryState(billingKeys.features())?.isInvalidated).toBe(false)
    expect(client.getQueryState(billingKeys['vector-space']())?.isInvalidated).toBe(false)
  })
})
