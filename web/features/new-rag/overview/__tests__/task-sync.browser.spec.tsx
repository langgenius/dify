import type { KnowledgeFsOverviewAttentionResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { zGetFeaturesVectorSpaceResponse } from '@dify/contracts/api/console/features/zod.gen'
import { QueryObserver } from '@tanstack/react-query'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import {
  createConsoleQueryClient,
  createConsoleQueryWrapper,
  seedFeatures,
} from '@/test/console/query-data'
import { createOverviewTask as task } from '@/test/new-rag-overview'
import { QueryTestingAdapter } from '@/test/query-state-testing-adapter'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { OverviewActivity } from '../overview-activity'
import { AttentionPanel } from '../overview-attention'
import { OverviewTaskSync } from '../overview-task-sync'
import { OverviewStateBoundary } from '../state-boundary'

type SpaceInput = {
  params: {
    control_space_id: string
  }
}

const service = vi.hoisted(() => ({
  attention: vi.fn(),
  activity: vi.fn(),
  tasks: vi.fn(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleQueryOverrides } =
    await import('@/test/console/service-responses')
  const { createOverviewData } = await import('@/test/new-rag-overview')
  const data = createOverviewData()
  const spaceQuery = (handler: (spaceId: string, signal: AbortSignal) => unknown) => ({
    queryOptions: ({ input }: { input: SpaceInput }) => ({
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        handler(input.params.control_space_id, signal),
    }),
  })
  return {
    ...actual,
    consoleQuery: withConsoleQueryOverrides(
      withConsoleResponses(actual.consoleQuery, {
        'knowledgeFs.spaces.byControlSpaceId.overview.stats.get': () => data.stats,
        'knowledgeFs.spaces.byControlSpaceId.overview.inventory.get': () => data.inventory,
        'knowledgeFs.spaces.byControlSpaceId.overview.queryOutcomes.get': async () => data.outcomes,
        'workspaces.current.members.get': () => ({ accounts: [] }),
      }),
      {
        'knowledgeFs.spaces.byControlSpaceId.overview.attention.get': spaceQuery(service.attention),
        'knowledgeFs.spaces.byControlSpaceId.overview.activity.get': spaceQuery(service.activity),
        'knowledgeFs.spaces.byControlSpaceId.backgroundTasks.get': {
          infiniteOptions: ({ input }: { input: (page: null) => SpaceInput }) => ({
            queryFn: ({ signal }: { signal: AbortSignal }) =>
              service.tasks(input(null).params.control_space_id, signal),
          }),
        },
      },
    ),
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

describe('overview task completion synchronization', () => {
  let client: ReturnType<typeof createConsoleQueryClient>
  beforeEach(async () => {
    await page.viewport(1280, 900)
    onTestFinished(guardUnexpectedFetch())
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    onTestFinished(() => {
      client.clear()
      vi.useRealTimers()
    })
    service.attention.mockReset()
    service.activity.mockReset()
    service.tasks.mockReset()
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

  async function mount(deploymentEdition: 'CLOUD' | 'ENTERPRISE' = 'ENTERPRISE') {
    const { wrapper: Wrapper } = createConsoleQueryWrapper({
      queryClient: client,
      systemFeatures: { deployment_edition: deploymentEdition },
    })
    await render(
      <Wrapper>
        <QueryTestingAdapter>
          <OverviewStateBoundary knowledgeSpaceId="space-a">
            <OverviewTaskSync />
            <AttentionPanel />
            <OverviewActivity />
          </OverviewStateBoundary>
        </QueryTestingAdapter>
      </Wrapper>,
    )
    await expect.poll(() => client.isFetching({ queryKey: tasksKey() })).toBe(0)
  }

  it('cancels a pre-terminal snapshot and fetches failures after the last active task stops', async () => {
    let resolveStale!: (value: { data: KnowledgeFsOverviewAttentionResponse[] }) => void
    service.attention.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStale = resolve
        }),
    )
    await mount('CLOUD')
    await expect
      .poll(() => service.attention.mock.calls.some(([, signal]) => !signal.aborted))
      .toBe(true)
    await expect.poll(() => service.tasks).toHaveBeenCalledOnce()
    expect(client.getQueryState(billingKeys.features())?.isInvalidated).toBe(false)
    expect(client.getQueryState(billingKeys['vector-space']())?.isInvalidated).toBe(false)
    const staleSignal = service.attention.mock.calls.at(-1)![1] as AbortSignal
    expect(staleSignal.aborted).toBe(false)
    service.tasks.mockResolvedValue({ data: [task('failed')], next_cursor: null })
    service.attention.mockResolvedValue({ data: [failedIssue] })
    // Complete via a public refetch before any interval can cancel the pending snapshot.
    await client.invalidateQueries({ queryKey: tasksKey() })
    await expect
      .element(page.getByText('knowledgeOverview.overview.attention.failedDocument.title'))
      .toBeVisible()
    expect(staleSignal.aborted).toBe(true)
    expect(client.getQueryState(billingKeys.features())?.isInvalidated).toBe(true)
    expect(client.getQueryState(billingKeys['vector-space']())?.isInvalidated).toBe(true)
    resolveStale({ data: [] })
    await expect.poll(() => client.isFetching()).toBe(0)
    await expect
      .element(page.getByText('knowledgeOverview.overview.attention.failedDocument.title'))
      .toBeVisible()
    const calls = service.attention.mock.calls.length
    await vi.advanceTimersByTimeAsync(4000)
    expect(service.attention).toHaveBeenCalledTimes(calls)
  })

  it.each(['features', 'vector-space'] as const)(
    'preserves an active %s precheck while refreshing terminal tasks',
    async (usageKey) => {
      const queryKey = billingKeys[usageKey]()
      let resolveUsage!: (value: { size: number; limit: number }) => void
      let precheckSignal!: AbortSignal
      const queryFn = vi.fn(({ signal }: { signal: AbortSignal }) => {
        precheckSignal ??= signal
        return new Promise<{
          size: number
          limit: number
        }>((resolve) => {
          resolveUsage = resolve
        })
      })
      const observer = new QueryObserver(client, { queryKey, queryFn, staleTime: Infinity })
      const unsubscribe = observer.subscribe(() => {})
      const precheck = client
        .query({ queryKey, queryFn, staleTime: 0, retry: false })
        .catch((error: unknown) => error)
      try {
        await mount('CLOUD')
        await expect.poll(() => service.tasks).toHaveBeenCalledOnce()
        service.tasks.mockResolvedValue({ data: [task('failed')], next_cursor: null })
        service.attention.mockResolvedValue({ data: [failedIssue] })
        await client.invalidateQueries({ queryKey: tasksKey() })
        await expect
          .element(page.getByText('knowledgeOverview.overview.attention.failedDocument.title'))
          .toBeVisible()
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
    const otherIssue = {
      ...failedIssue,
      knowledge_space_id: 'space-b',
      issue_key: 'space-b-failed-document',
    }
    client.setQueryData(otherSpaceAttentionKey, { data: [otherIssue] })
    await mount()
    await expect.poll(() => service.tasks).toHaveBeenCalledOnce()
    service.tasks.mockResolvedValue({ data: [task('failed')], next_cursor: null })
    service.attention.mockResolvedValue({ data: [failedIssue] })
    await client.invalidateQueries({ queryKey: tasksKey() })
    await expect
      .element(page.getByText('knowledgeOverview.overview.attention.failedDocument.title'))
      .toBeVisible()
    service.tasks.mockResolvedValue({ data: [task('running')], next_cursor: null })
    await client.invalidateQueries({ queryKey: tasksKey() })
    service.tasks.mockResolvedValue({
      data: [{ ...task('completed'), updated_at: '2026-09-08T00:00:03Z' }],
      next_cursor: null,
    })
    service.attention.mockResolvedValue({ data: [] })
    await client.invalidateQueries({ queryKey: tasksKey() })
    await expect.element(page.getByText('knowledgeOverview.overview.noIssues')).toBeVisible()
    await expect
      .element(page.getByText('knowledgeOverview.overview.attention.failedDocument.title'))
      .not.toBeInTheDocument()
    expect(client.getQueryState(otherSpaceAttentionKey)?.isInvalidated).toBe(false)
    expect(client.getQueryData(otherSpaceAttentionKey)).toEqual({
      data: [otherIssue],
    })
    expect(client.getQueryState(billingKeys.features())?.isInvalidated).toBe(false)
    expect(client.getQueryState(billingKeys['vector-space']())?.isInvalidated).toBe(false)
  })
})
