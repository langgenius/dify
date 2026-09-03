import type { KnowledgeFsSettingsResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { useState } from 'react'
import { render } from '@/test/console/render'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import { RetrievalTestPage } from '../page'

const apiMock = vi.hoisted(() => ({
  cancelResearch: vi.fn(),
  createBadCase: vi.fn(),
  createGolden: vi.fn(),
  createResearch: vi.fn(),
  planResearch: vi.fn(),
  readinessRefetch: vi.fn(),
  listLogicalDocuments: vi.fn(),
  routerPush: vi.fn(),
  partials: [] as Array<Record<string, unknown>>,
  queryAdmission: vi.fn(),
  refetchPartials: vi.fn(),
  refetchTasks: vi.fn(),
  refetchTraces: vi.fn(),
  researchTasks: [] as Array<Record<string, unknown>>,
  streamCapability: vi.fn(),
  streamQuery: vi.fn(),
  streamResearchEvents: vi.fn(),
  uploadFile: vi.fn(),
  evidence: undefined as Record<string, unknown> | undefined,
  evidenceError: false,
  evidenceFetchNextPageError: false,
  fetchNextEvidence: vi.fn(),
  fetchNextPartials: vi.fn(),
  fetchNextTasks: vi.fn(),
  fetchNextTraces: vi.fn(),
  getTraceEvidence: vi.fn(),
  matchEvidence: vi.fn(),
  researchDetail: undefined as Record<string, unknown> | undefined,
  researchDetailError: false,
  researchDetailPending: false,
  refetchResearchDetail: vi.fn(),
  researchHasNextPage: false,
  evidenceHasNextPage: false,
  partialsHasNextPage: false,
  partialsError: false,
  partialsFetchNextPageError: false,
  refetchEvidence: vi.fn(),
  traceDetail: undefined as Record<string, unknown> | undefined,
  tracesHasNextPage: false,
  traces: [] as Array<Record<string, unknown>>,
  readiness: {
    active_profile_available: true,
    active_profile_revisions: { embedding: 1, retrieval: 1 },
    capabilities: {
      deep: true,
      index: true,
      ingest: true,
      query: true,
      research: true,
      source_sync: true,
    },
    configuration_state: 'active',
    embedding: null,
    issues: [],
    retrieval: null,
    revision: 1,
  } as KnowledgeFsSettingsResponse,
}))
const knowledgeSpacePermissionState = vi.hoisted(() => ({
  keys: ['knowledge_space_edit'],
}))
vi.mock('../../space/context', () => ({
  useKnowledgeSpacePermission: (permission: string) =>
    knowledgeSpacePermissionState.keys.includes(permission),
}))

vi.mock('../services/knowledge-query-events', () => ({
  streamKnowledgeQuery: apiMock.streamQuery,
}))

vi.mock('@/next/navigation', () => ({
  usePathname: () => '/datasets/new/space-1/retrieval',
  useRouter: () => ({ push: apiMock.routerPush }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('../services/research-task-events', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/research-task-events')>()),
  streamResearchTaskEvents: apiMock.streamResearchEvents,
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...original,
    useQuery: (options: { queryKey?: string[] }) => {
      const resource = options.queryKey?.[0]
      if (resource === 'trace-detail')
        return {
          data: apiMock.traceDetail,
          isPending: false,
        }
      if (resource === 'research-detail')
        return {
          data: apiMock.researchDetail,
          isError: apiMock.researchDetailError,
          isPending: apiMock.researchDetailPending,
          refetch: apiMock.refetchResearchDetail,
        }
      if (resource === 'settings')
        return {
          data: apiMock.readiness,
          isError: false,
          isPending: false,
          refetch: apiMock.readinessRefetch,
        }
      return { data: undefined, isPending: false }
    },
    useInfiniteQuery: (options: { queryKey?: string[] }) => {
      const resource = options.queryKey?.[0]
      if (resource === 'traces')
        return {
          data: { pageParams: [null], pages: [{ data: apiMock.traces, next_cursor: null }] },
          fetchNextPage: apiMock.fetchNextTraces,
          hasNextPage: apiMock.tracesHasNextPage,
          isFetchingNextPage: false,
          isPending: false,
          refetch: apiMock.refetchTraces,
        }
      if (resource === 'tasks')
        return {
          data: { pageParams: [null], pages: [{ data: apiMock.researchTasks, next_cursor: null }] },
          fetchNextPage: apiMock.fetchNextTasks,
          hasNextPage: apiMock.researchHasNextPage,
          isFetchingNextPage: false,
          isPending: false,
          refetch: apiMock.refetchTasks,
        }
      if (resource === 'evidence')
        return {
          data: {
            pageParams: [null],
            pages: [apiMock.evidence ?? { data: [], next_cursor: null, truncated: false }],
          },
          fetchNextPage: apiMock.fetchNextEvidence,
          hasNextPage: apiMock.evidenceHasNextPage,
          isError: apiMock.evidenceError,
          isFetchNextPageError: apiMock.evidenceFetchNextPageError,
          isFetchingNextPage: false,
          isPending: false,
          refetch: apiMock.refetchEvidence,
        }
      if (resource === 'partials')
        return {
          data: { pageParams: [null], pages: [{ data: apiMock.partials, next_cursor: null }] },
          fetchNextPage: apiMock.fetchNextPartials,
          hasNextPage: apiMock.partialsHasNextPage,
          isError: apiMock.partialsError,
          isFetchNextPageError: apiMock.partialsFetchNextPageError,
          isFetchingNextPage: false,
          isPending: false,
          refetch: apiMock.refetchPartials,
        }
      return { data: undefined, isPending: false }
    },
  }
})

vi.mock('jotai-tanstack-query', async (importOriginal) => {
  const original = await importOriginal<typeof import('jotai-tanstack-query')>()
  const { atom, getDefaultStore } = await import('jotai')
  type Options = { queryKey?: string[] }
  type Getter = (target: never) => unknown
  const queryRevisionAtom = atom(0)
  const refreshQueryAtoms = () => {
    const store = getDefaultStore()
    store.set(queryRevisionAtom, store.get(queryRevisionAtom) + 1)
  }
  const refetchTraces = async (...args: unknown[]) => {
    const result = await apiMock.refetchTraces(...args)
    refreshQueryAtoms()
    return result
  }
  const refetchTasks = async (...args: unknown[]) => {
    const result = await apiMock.refetchTasks(...args)
    refreshQueryAtoms()
    return result
  }
  const queryResult = (options: Options) => {
    const resource = options.queryKey?.[0]
    if (resource === 'trace-detail')
      return {
        data: apiMock.traceDetail,
        isError: false,
        isPending: false,
        refetch: vi.fn(),
      }
    if (resource === 'research-detail')
      return {
        data: apiMock.researchDetail,
        isError: apiMock.researchDetailError,
        isPending: apiMock.researchDetailPending,
        refetch: apiMock.refetchResearchDetail,
      }
    return { data: undefined, isError: false, isPending: false, refetch: vi.fn() }
  }
  const infiniteQueryResult = (options: Options) => {
    const resource = options.queryKey?.[0]
    if (resource === 'traces')
      return {
        data: { pageParams: [null], pages: [{ data: apiMock.traces, next_cursor: null }] },
        fetchNextPage: apiMock.fetchNextTraces,
        hasNextPage: apiMock.tracesHasNextPage,
        isError: false,
        isFetchNextPageError: false,
        isFetchingNextPage: false,
        isPending: false,
        refetch: refetchTraces,
      }
    if (resource === 'tasks')
      return {
        data: { pageParams: [null], pages: [{ data: apiMock.researchTasks, next_cursor: null }] },
        fetchNextPage: apiMock.fetchNextTasks,
        hasNextPage: apiMock.researchHasNextPage,
        isError: false,
        isFetchNextPageError: false,
        isFetchingNextPage: false,
        isPending: false,
        refetch: refetchTasks,
      }
    if (resource === 'evidence')
      return {
        data: {
          pageParams: [null],
          pages: [apiMock.evidence ?? { data: [], next_cursor: null, truncated: false }],
        },
        fetchNextPage: apiMock.fetchNextEvidence,
        hasNextPage: apiMock.evidenceHasNextPage,
        isError: apiMock.evidenceError,
        isFetchNextPageError: apiMock.evidenceFetchNextPageError,
        isFetchingNextPage: false,
        isPending: false,
        refetch: apiMock.refetchEvidence,
      }
    return {
      data: { pageParams: [null], pages: [{ data: apiMock.partials, next_cursor: null }] },
      fetchNextPage: apiMock.fetchNextPartials,
      hasNextPage: apiMock.partialsHasNextPage,
      isError: apiMock.partialsError,
      isFetchNextPageError: apiMock.partialsFetchNextPageError,
      isFetchingNextPage: false,
      isPending: false,
      refetch: apiMock.refetchPartials,
    }
  }
  return {
    ...original,
    atomWithInfiniteQuery: (getOptions: (get: Getter) => Options) =>
      atom((get) => {
        get(queryRevisionAtom)
        return infiniteQueryResult(getOptions(get as Getter))
      }),
    atomWithQuery: (getOptions: (get: Getter) => Options) =>
      atom((get) => {
        get(queryRevisionAtom)
        return queryResult(getOptions(get as Getter))
      }),
  }
})

vi.mock('@/service/client', () => ({
  consoleClient: {
    knowledgeFs: {
      tasks: {
        byTaskId: {
          streamCapability: { post: apiMock.streamCapability },
        },
      },
      spaces: {
        byControlSpaceId: {
          queries: { admission: { post: apiMock.queryAdmission } },
          logicalDocuments: { get: apiMock.listLogicalDocuments },
          goldenQuestions: { post: apiMock.createGolden },
          quality: { badCases: { post: apiMock.createBadCase } },
          researchTasks: {
            byTaskId: { delete: apiMock.cancelResearch },
            plan: { post: apiMock.planResearch },
            post: apiMock.createResearch,
          },
          traces: {
            byTraceId: { evidence: { get: apiMock.getTraceEvidence } },
          },
        },
      },
    },
  },
  consoleQuery: {
    files: {
      upload: {
        post: {
          mutationOptions: () => ({ mutationFn: apiMock.uploadFile }),
        },
      },
    },
    knowledgeFs: {
      spaces: {
        byControlSpaceId: {
          goldenQuestions: {
            evidenceMatches: {
              post: {
                mutationOptions: () => ({ mutationFn: apiMock.matchEvidence }),
              },
            },
            get: {
              key: () => ['quality', 'golden'],
            },
          },
          settings: {
            get: {
              queryOptions: () => ({ queryKey: ['settings'] }),
            },
          },
          researchTasks: {
            byTaskId: {
              get: {
                queryOptions: () => ({ queryKey: ['research-detail'] }),
              },
              partials: {
                get: {
                  infiniteOptions: () => ({ queryKey: ['partials'] }),
                },
              },
            },
            get: {
              infiniteOptions: () => ({ queryKey: ['tasks'] }),
            },
          },
          traces: {
            byTraceId: {
              get: {
                queryOptions: () => ({ queryKey: ['trace-detail'] }),
              },
              evidence: {
                get: {
                  infiniteOptions: () => ({ queryKey: ['evidence'] }),
                },
              },
            },
            get: {
              infiniteOptions: () => ({ queryKey: ['traces'] }),
            },
          },
        },
      },
    },
  },
}))

function renderPage({ searchParams = '' }: { searchParams?: string } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  })
  const { onUrlUpdate, wrapper: NuqsWrapper } = createNuqsTestWrapper({ searchParams })
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <NuqsWrapper>{children}</NuqsWrapper>
    </QueryClientProvider>
  )
  return {
    onUrlUpdate,
    queryClient,
    ...render(<RetrievalTestPage knowledgeSpaceId="space-1" />, { wrapper: Wrapper }),
  }
}

describe('RetrievalTestPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    knowledgeSpacePermissionState.keys = ['knowledge_space_edit']
    apiMock.planResearch.mockResolvedValue({
      budget: { budget_usd: 1, exceeds_budget: false },
      estimates: {},
      knowledge_space_id: 'space-1',
      query: 'Compare the refund policies',
      retrieval_plan: { top_k: 8 },
      steps: [],
      strategy_version: 'research-dry-run-planner-v1',
    })
    apiMock.readiness = {
      active_profile_available: true,
      active_profile_revisions: { embedding: 1, retrieval: 1 },
      capabilities: {
        deep: true,
        index: true,
        ingest: true,
        query: true,
        research: true,
        source_sync: true,
      },
      configuration_state: 'active',
      embedding: null,
      issues: [],
      retrieval: null,
      revision: 1,
    }
    apiMock.readinessRefetch.mockImplementation(async () => ({
      data: apiMock.readiness,
      isError: false,
    }))
    apiMock.createResearch.mockResolvedValue({
      cost: {},
      created_at: 1_800_000_000,
      id: 'research-1',
      knowledge_space_id: 'space-1',
      metadata: {},
      query: 'Compare the refund policies',
      stage: 'queued',
      updated_at: 1_800_000_000,
    })
    apiMock.refetchTasks.mockResolvedValue(undefined)
    apiMock.refetchTraces.mockResolvedValue(undefined)
    apiMock.researchTasks = []
    apiMock.researchDetail = undefined
    apiMock.researchDetailError = false
    apiMock.researchDetailPending = false
    apiMock.researchHasNextPage = false
    apiMock.evidenceError = false
    apiMock.evidenceFetchNextPageError = false
    apiMock.evidenceHasNextPage = false
    apiMock.partialsError = false
    apiMock.partialsFetchNextPageError = false
    apiMock.partialsHasNextPage = false
    apiMock.tracesHasNextPage = false
    apiMock.streamCapability.mockResolvedValue({
      expires_at: '2026-07-31T10:30:00.000Z',
      operation_id: 'streamResearchTask',
      token: 'capability-token',
      url: 'https://knowledge.example.test/research/events',
    })
    apiMock.streamQuery.mockResolvedValue(undefined)
    apiMock.streamResearchEvents.mockResolvedValue({
      reconnect: false,
      terminal: false,
    })
    apiMock.uploadFile.mockResolvedValue({ id: 'upload-image-1' })
    apiMock.queryAdmission.mockResolvedValue({})
    apiMock.createBadCase.mockResolvedValue({ id: 'bad-case-1' })
    apiMock.createGolden.mockResolvedValue({ id: 'golden-1' })
    apiMock.evidence = undefined
    apiMock.getTraceEvidence.mockResolvedValue({ data: [] })
    apiMock.listLogicalDocuments.mockResolvedValue({ data: [], next_cursor: null })
    apiMock.matchEvidence.mockResolvedValue({ candidates: [], evidence: '', matched: false })
    apiMock.partials = []
    apiMock.traceDetail = undefined
    apiMock.traces = []
  })

  it('starts research from the segmented composer with the planned budget', async () => {
    const user = userEvent.setup()
    renderPage()

    expect(
      screen.getByRole('heading', { name: 'knowledgeSpace.retrievalTest.title' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('radiogroup', {
        name: 'knowledgeSpace.settings.retrievalModeLabel',
      }),
    ).toBeInTheDocument()
    expect(screen.getByText('knowledgeSpace.retrievalTest.emptyTitle')).toBeInTheDocument()

    await user.type(
      screen.getByLabelText('knowledgeSpace.retrievalTest.queryPlaceholder'),
      'Compare the refund policies',
    )
    await user.click(
      screen.getByRole('radio', {
        name: 'knowledgeSpace.settings.retrievalMode.research',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.retrievalTest.run' }))

    await waitFor(() =>
      expect(apiMock.planResearch).toHaveBeenCalledWith({
        body: { mode: 'research', query: 'Compare the refund policies' },
        params: { control_space_id: 'space-1' },
      }),
    )
    expect(apiMock.createResearch).toHaveBeenCalledWith({
      body: {
        budgetUsd: 1,
        mode: 'research',
        query: 'Compare the refund policies',
        topK: 8,
      },
      params: { control_space_id: 'space-1' },
    })
  })

  it('uploads a query image and sends an image-only retrieval request', async () => {
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:query-image')
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const user = userEvent.setup()
    const rendered = renderPage()

    await user.upload(
      screen.getByLabelText('knowledgeSpace.retrievalTest.addImages'),
      new File(['diagram'], 'diagram.png', { type: 'image/png' }),
    )
    expect(await screen.findByRole('img', { name: 'diagram.png' })).toHaveAttribute(
      'src',
      'blob:query-image',
    )
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.retrievalTest.run' }))

    await waitFor(() =>
      expect(apiMock.queryAdmission).toHaveBeenCalledWith({
        body: {
          mode: 'fast',
          query: '',
          queryImages: [{ uploadFileId: 'upload-image-1' }],
        },
        params: { control_space_id: 'space-1' },
      }),
    )
    rendered.unmount()
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:query-image')
    createObjectUrl.mockRestore()
    revokeObjectUrl.mockRestore()
  })

  it.each([
    { capability: 'query', mode: 'fast' },
    { capability: 'deep', mode: 'deep' },
    { capability: 'research', mode: 'research' },
  ] as const)(
    'blocks $mode before admission or task planning when $capability is unavailable',
    async ({ capability, mode }) => {
      apiMock.readiness = {
        ...apiMock.readiness,
        active_profile_available: false,
        capabilities: { ...apiMock.readiness.capabilities, [capability]: false },
        configuration_state: 'pending-validation',
        issues: [],
      }
      const user = userEvent.setup()
      renderPage()

      await user.type(
        screen.getByLabelText('knowledgeSpace.retrievalTest.queryPlaceholder'),
        'Blocked query',
      )
      if (mode !== 'fast')
        await user.click(
          screen.getByRole('radio', {
            name: `knowledgeSpace.settings.retrievalMode.${mode}`,
          }),
        )
      await user.click(screen.getByRole('button', { name: 'knowledgeSpace.retrievalTest.run' }))

      expect(apiMock.queryAdmission).not.toHaveBeenCalled()
      expect(apiMock.planResearch).not.toHaveBeenCalled()
      expect(apiMock.createResearch).not.toHaveBeenCalled()
      const dialog = screen.getByRole('dialog', {
        name: 'knowledgeSpace.overview.attention.modelReadiness.pendingTitle',
      })
      expect(dialog).toHaveTextContent(
        'knowledgeSpace.overview.attention.modelReadiness.pendingDescription',
      )
      expect(dialog).not.toHaveTextContent(
        'knowledgeSpace.overview.attention.modelReadiness.profilesMissing',
      )
      expect(dialog).not.toHaveTextContent('datasetSettings.form.embeddingModel')
      expect(dialog).not.toHaveTextContent('common.modelProvider.systemReasoningModel.key')
      expect(dialog).not.toHaveTextContent('common.modelProvider.rerankModel.key')
    },
  )

  it('admits only one research task while the first Run request is pending', async () => {
    let resolvePlan: ((value: Awaited<ReturnType<typeof apiMock.planResearch>>) => void) | undefined
    const pendingPlan = new Promise<Awaited<ReturnType<typeof apiMock.planResearch>>>((resolve) => {
      resolvePlan = resolve
    })
    apiMock.planResearch.mockReturnValueOnce(pendingPlan)
    const user = userEvent.setup()
    renderPage()

    await user.type(
      screen.getByLabelText('knowledgeSpace.retrievalTest.queryPlaceholder'),
      'Compare the refund policies',
    )
    await user.click(
      screen.getByRole('radio', {
        name: 'knowledgeSpace.settings.retrievalMode.research',
      }),
    )
    const run = screen.getByRole('button', {
      name: 'knowledgeSpace.retrievalTest.run',
    })
    await user.click(run)
    await user.click(run)

    expect(apiMock.planResearch).toHaveBeenCalledOnce()
    resolvePlan?.({
      budget: { budget_usd: 1, exceeds_budget: false },
      estimates: {},
      knowledge_space_id: 'space-1',
      query: 'Compare the refund policies',
      retrieval_plan: { top_k: 8 },
      steps: [],
      strategy_version: 'research-dry-run-planner-v1',
    })
    await waitFor(() => expect(apiMock.createResearch).toHaveBeenCalledOnce())
  })

  it.each([
    {
      label: 'knowledgeSpace.settings.retrievalMode.fast',
      mode: 'fast',
    },
    {
      label: 'knowledgeSpace.settings.retrievalMode.deep',
      mode: 'deep',
    },
  ] as const)(
    'admits only one $mode query while the first Run request is pending',
    async ({ label, mode }) => {
      let resolveAdmission: ((value: Record<string, never>) => void) | undefined
      apiMock.queryAdmission.mockReturnValueOnce(
        new Promise<Record<string, never>>((resolve) => {
          resolveAdmission = resolve
        }),
      )
      const user = userEvent.setup()
      renderPage()

      await user.type(
        screen.getByLabelText('knowledgeSpace.retrievalTest.queryPlaceholder'),
        `Run one ${mode} query`,
      )
      if (mode === 'deep') await user.click(screen.getByRole('radio', { name: label }))
      const run = screen.getByRole('button', {
        name: 'knowledgeSpace.retrievalTest.run',
      })
      act(() => {
        run.click()
        run.click()
      })

      await waitFor(() => expect(apiMock.queryAdmission).toHaveBeenCalledOnce())
      expect(apiMock.queryAdmission).toHaveBeenCalledWith({
        body: { mode, query: `Run one ${mode} query` },
        params: { control_space_id: 'space-1' },
      })
      expect(apiMock.streamQuery).not.toHaveBeenCalled()

      await act(async () => resolveAdmission?.({}))
      await waitFor(() => expect(apiMock.streamQuery).toHaveBeenCalledOnce())
    },
  )

  it('admits only one query when Retry is triggered twice while admission is pending', async () => {
    apiMock.traces = [
      {
        completed: false,
        created_at: '2026-07-29T00:00:00.000Z',
        duration_ms: 30_000,
        id: 'trace-failed',
        mode: 'fast',
        profile: {},
        query: 'Retry this query once',
        result_count: 0,
        scores: {},
        stages: [{ name: 'query.generate', status: 'error' }],
      },
    ]
    let resolveAdmission: ((value: Record<string, never>) => void) | undefined
    apiMock.queryAdmission.mockReturnValueOnce(
      new Promise<Record<string, never>>((resolve) => {
        resolveAdmission = resolve
      }),
    )
    renderPage({ searchParams: '?trace=trace-failed' })

    const retry = await screen.findByRole('button', {
      name: 'knowledgeSpace.retrievalTest.retry',
    })
    act(() => {
      retry.click()
      retry.click()
    })

    await waitFor(() => expect(apiMock.queryAdmission).toHaveBeenCalledOnce())
    expect(apiMock.queryAdmission).toHaveBeenCalledWith({
      body: { mode: 'fast', query: 'Retry this query once' },
      params: { control_space_id: 'space-1' },
    })
    expect(apiMock.streamQuery).not.toHaveBeenCalled()

    await act(async () => resolveAdmission?.({}))
    await waitFor(() => expect(apiMock.streamQuery).toHaveBeenCalledOnce())
  })

  it('keeps retrieved evidence visible and retries a Research run that later fails', async () => {
    apiMock.createResearch.mockResolvedValueOnce({
      cost: {},
      created_at: 1_800_000_000,
      id: 'research-1',
      knowledge_space_id: 'space-1',
      metadata: {},
      query: 'Anything here?',
      stage: 'queued',
      updated_at: 1_800_000_000,
    })
    apiMock.partials = [
      {
        evidence_bundle: {
          items: [
            {
              citations: [
                {
                  documentAssetId: 'document-1',
                  documentVersion: 1,
                  sectionPath: ['Warranty'],
                  startOffset: 0,
                },
              ],
              metadata: {},
              nodeId: 'failed-research-evidence-1',
              score: 0.9,
              text: 'Evidence retrieved before generation failed',
            },
          ],
        },
        knowledge_space_id: 'space-1',
        research_task_job_id: 'research-1',
        sequence: 1,
      },
    ]
    apiMock.streamResearchEvents.mockImplementation(
      async ({ onEvent }: { onEvent: (event: Record<string, unknown>) => void }) => {
        onEvent({
          createdAt: '2027-01-15T08:00:01.000Z',
          id: 'research-failed-1',
          payload: { error: 'Published runtime snapshot unavailable' },
          researchTaskJobId: 'research-1',
          sequence: 1,
          stage: 'failed',
          type: 'research_task.failed',
        })
        return { cursor: '1', reconnect: false, terminal: true }
      },
    )
    const user = userEvent.setup()
    renderPage()

    await user.type(
      screen.getByLabelText('knowledgeSpace.retrievalTest.queryPlaceholder'),
      'Anything here?',
    )
    await user.click(
      screen.getByRole('radio', {
        name: 'knowledgeSpace.settings.retrievalMode.research',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.retrievalTest.run' }))

    const record = await screen.findByRole('button', { name: /Anything here\?/ })
    expect(record).toHaveAttribute('aria-pressed', 'true')
    expect(record).toHaveTextContent('knowledgeSpace.retrievalTest.failedTitle')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('knowledgeSpace.taskFailure.research')
    expect(
      await screen.findByText('Evidence retrieved before generation failed'),
    ).toBeInTheDocument()
    expect(screen.queryByText('knowledgeSpace.retrievalTest.noChunksTitle')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.retrievalTest.retry' }))

    await waitFor(() => expect(apiMock.createResearch).toHaveBeenCalledTimes(2))
    expect(apiMock.createResearch).toHaveBeenLastCalledWith({
      body: {
        budgetUsd: 1,
        mode: 'research',
        query: 'Anything here?',
        topK: 8,
      },
      params: { control_space_id: 'space-1' },
    })
  })

  it('retries a historical image-only Research task with its persisted image references', async () => {
    apiMock.researchTasks = [
      {
        cost: {},
        created_at: 1_800_000_000,
        id: 'research-image-failed',
        knowledge_space_id: 'space-1',
        metadata: {},
        mode: 'research',
        query: '',
        query_images: [{ upload_file_id: 'historical-image-1' }],
        stage: 'failed',
        updated_at: 1_800_000_005,
      },
    ]
    const user = userEvent.setup()
    renderPage({ searchParams: '?research=research-image-failed' })

    await user.click(
      await screen.findByRole('button', { name: 'knowledgeSpace.retrievalTest.retry' }),
    )

    await waitFor(() =>
      expect(apiMock.planResearch).toHaveBeenCalledWith({
        body: {
          mode: 'research',
          query: '',
          queryImages: [{ uploadFileId: 'historical-image-1' }],
        },
        params: { control_space_id: 'space-1' },
      }),
    )
    expect(apiMock.createResearch).toHaveBeenCalledWith({
      body: {
        budgetUsd: 1,
        mode: 'research',
        query: '',
        queryImages: [{ uploadFileId: 'historical-image-1' }],
        topK: 8,
      },
      params: { control_space_id: 'space-1' },
    })
  })

  it('shows pending feedback while retrying a failed Research task', async () => {
    let rejectPlan: ((reason?: unknown) => void) | undefined
    apiMock.planResearch.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectPlan = reject
      }),
    )
    apiMock.researchTasks = [
      {
        cost: {},
        created_at: 1_800_000_000,
        id: 'research-retry-pending',
        knowledge_space_id: 'space-1',
        metadata: {},
        mode: 'research',
        query: 'Compare the sources',
        stage: 'failed',
        updated_at: 1_800_000_005,
      },
    ]
    renderPage({ searchParams: '?research=research-retry-pending' })

    const retry = await screen.findByRole('button', {
      name: 'knowledgeSpace.retrievalTest.retry',
    })
    act(() => {
      retry.click()
      retry.click()
    })

    await waitFor(() => expect(retry).toHaveAttribute('aria-disabled', 'true'))
    expect(apiMock.planResearch).toHaveBeenCalledOnce()

    await act(async () => rejectPlan?.(new Error('Plan unavailable')))
    await waitFor(() => expect(retry).not.toHaveAttribute('aria-disabled'))
  })

  it('routes a non-retryable Research failure to its required configuration', async () => {
    apiMock.researchTasks = [
      {
        cost: {},
        created_at: 1_800_000_000,
        failure: {
          action: 'configure_model',
          category: 'configuration',
          code: 'MODEL_PROFILE_ACTIVATION_INCOMPLETE',
          message: 'The selected model configuration is incomplete.',
          retryPolicy: 'after_configuration',
        },
        id: 'research-model-configuration-failed',
        knowledge_space_id: 'space-1',
        metadata: {},
        mode: 'research',
        query: 'Compare the sources',
        stage: 'failed',
        updated_at: 1_800_000_005,
      },
    ]

    renderPage({ searchParams: '?research=research-model-configuration-failed' })

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('knowledgeSpace.taskFailure.modelConfiguration')
    expect(alert).toHaveTextContent('knowledgeSpace.retrievalTest.failedTitle')
    expect(
      screen.queryByRole('button', { name: 'knowledgeSpace.retrievalTest.retry' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'common.datasetMenus.settings' })).toHaveAttribute(
      'href',
      '/datasets/new/space-1/settings',
    )
  })

  it('collapses the research process when a running task completes', async () => {
    let emitResearchEvent:
      | ((event: {
          createdAt: string
          id: string
          payload: Record<string, unknown>
          researchTaskJobId: string
          sequence: number
          stage: string
          type: string
        }) => void)
      | undefined
    let resolveResearchStream:
      | ((value: { cursor: string; reconnect: boolean; terminal: boolean }) => void)
      | undefined
    apiMock.streamResearchEvents.mockImplementation(
      ({ onEvent }: { onEvent: typeof emitResearchEvent }) => {
        emitResearchEvent = onEvent
        return new Promise((resolve) => {
          resolveResearchStream = resolve
        })
      },
    )
    const user = userEvent.setup()
    renderPage()

    await user.type(
      screen.getByLabelText('knowledgeSpace.retrievalTest.queryPlaceholder'),
      'Compare the refund policies',
    )
    await user.click(
      screen.getByRole('radio', {
        name: 'knowledgeSpace.settings.retrievalMode.research',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.retrievalTest.run' }))

    const processLog = await screen.findByRole('button', {
      name: 'knowledgeSpace.retrievalTest.processLog',
    })
    expect(processLog).toHaveAttribute('aria-pressed', 'true')
    const runningSummary = screen.getByRole('button', {
      name: /knowledgeSpace\.retrievalTest\.running/,
    })
    const cancelResearch = screen.getByRole('button', {
      name: 'knowledgeSpace.retrievalTest.cancel',
    })
    expect(runningSummary).toHaveAttribute('aria-expanded', 'true')
    expect(runningSummary).not.toContainElement(cancelResearch)

    act(() => {
      emitResearchEvent?.({
        createdAt: '2027-01-15T08:00:00.000Z',
        id: 'research-started',
        payload: {},
        researchTaskJobId: 'research-1',
        sequence: 1,
        stage: 'planning',
        type: 'research_task.started',
      })
      emitResearchEvent?.({
        createdAt: '2027-01-15T08:00:14.000Z',
        id: 'research-completed',
        payload: { details: { chunks: 3, documents: 1, sources: 1 } },
        researchTaskJobId: 'research-1',
        sequence: 2,
        stage: 'completed',
        type: 'research_task.stage_changed',
      })
    })

    const completedSummary = await screen.findByRole('button', {
      name: /knowledgeSpace\.retrievalTest\.completedIn.*14s/,
    })
    expect(processLog).toHaveAttribute('aria-pressed', 'false')
    expect(completedSummary).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('knowledgeSpace.retrievalTest.planning')).not.toBeInTheDocument()

    await user.click(processLog)

    expect(processLog).toHaveAttribute('aria-pressed', 'true')
    expect(completedSummary).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('knowledgeSpace.retrievalTest.planning')).toBeInTheDocument()

    await act(async () =>
      resolveResearchStream?.({ cursor: '2', reconnect: false, terminal: true }),
    )
  })

  it('replays research progress events and shows actual stage durations', async () => {
    apiMock.researchTasks = [
      {
        completed_at: 1_800_000_025,
        cost: {},
        created_at: 1_800_000_000,
        id: 'research-completed',
        knowledge_space_id: 'space-1',
        metadata: {},
        mode: 'research',
        query: 'Compare the refund policies',
        stage: 'completed',
        updated_at: 1_800_000_025,
      },
    ]
    apiMock.streamResearchEvents.mockImplementation(
      async ({
        onEvent,
      }: {
        onEvent: (event: {
          createdAt: string
          id: string
          payload: Record<string, unknown>
          researchTaskJobId: string
          sequence: number
          stage: string
          type: string
        }) => void
      }) => {
        const stages = [
          ['planning', 0],
          ['retrieving', 7],
          ['analyzing', 79_007],
          ['generating', 86_007],
          ['completed', 86_028],
        ] as const
        stages.forEach(([stage, milliseconds], index) =>
          onEvent({
            createdAt: new Date(1_800_000_000_000 + milliseconds).toISOString(),
            id: `event-${index + 1}`,
            payload: {
              ...(stage === 'retrieving'
                ? {
                    details: { questions: ['Compare the refund policies'], topK: 8 },
                    previousStage: 'planning',
                  }
                : {}),
              ...(stage === 'analyzing'
                ? {
                    details: {
                      results: [
                        {
                          chunkCount: 3,
                          createdAt: '2027-01-15T08:00:02.000Z',
                          question: 'Refund policy',
                          sourceId: 'internal-source-id',
                        },
                      ],
                      retrievalCount: 9,
                      sourceCount: 2,
                      unknownTotal: 9,
                    },
                    previousStage: 'retrieving',
                  }
                : {}),
              ...(stage === 'generating'
                ? {
                    details: { chunks: 3, retrievalCount: 9 },
                    previousStage: 'analyzing',
                  }
                : {}),
              ...(stage === 'completed'
                ? {
                    details: { chunks: 3, documents: 2, sources: 2 },
                    previousStage: 'generating',
                  }
                : {}),
            },
            researchTaskJobId: 'research-completed',
            sequence: index + 1,
            stage,
            type: index ? 'research_task.stage_changed' : 'research_task.started',
          }),
        )
        return { cursor: '5', reconnect: false, terminal: true }
      },
    )
    const user = userEvent.setup()
    renderPage({ searchParams: '?research=research-completed' })

    const processLog = screen.getByRole('button', {
      name: 'knowledgeSpace.retrievalTest.processLog',
    })
    expect(processLog).toHaveAttribute('aria-pressed', 'false')
    expect(
      screen.getByRole('link', { name: 'knowledgeSpace.retrievalTest.quality' }),
    ).toHaveAttribute('href', '/datasets/new/space-1/quality')
    await user.click(processLog)

    await waitFor(() =>
      expect(apiMock.streamCapability).toHaveBeenCalledWith({
        body: { control_space_id: 'space-1' },
        params: { task_id: 'research-completed' },
      }),
    )
    expect(apiMock.streamResearchEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: expect.objectContaining({ operation_id: 'streamResearchTask' }),
      }),
    )
    expect(await screen.findByText('7ms')).toBeInTheDocument()
    expect(screen.getByText('1m 19s')).toBeInTheDocument()
    expect(screen.getByText('7s')).toBeInTheDocument()
    expect(screen.getByText('21ms')).toBeInTheDocument()
    expect(screen.getAllByText('knowledgeSpace.sources: 2').length).toBeGreaterThan(0)
    expect(screen.getAllByText('knowledgeSpace.documents: 2').length).toBeGreaterThan(0)
    expect(screen.getAllByText('knowledgeSpace.chunkCount: 3').length).toBeGreaterThan(1)
    expect(screen.getAllByText('Compare the refund policies').length).toBeGreaterThan(0)
    expect(screen.getAllByText('knowledgeSpace.settings.topKLabel: 8').length).toBeGreaterThan(0)
    expect(screen.getAllByText('knowledgeSpace.retrievalCount: 9').length).toBeGreaterThan(1)
    expect(screen.getByText('Refund policy · 3 knowledgeSpace.chunkCount')).toBeInTheDocument()
    expect(screen.queryByText('internal-source-id')).not.toBeInTheDocument()
    expect(screen.queryByText('2027-01-15T08:00:02.000Z')).not.toBeInTheDocument()
    expect(screen.queryByText(/unknown.*9/i)).not.toBeInTheDocument()
    expect(apiMock.refetchTasks).not.toHaveBeenCalled()
    expect(apiMock.refetchPartials).toHaveBeenCalledOnce()
  })

  it('does not mix persisted stage details with fallback zero counts', async () => {
    apiMock.researchTasks = [
      {
        cost: {},
        created_at: 1_800_000_000,
        id: 'research-analyzing',
        knowledge_space_id: 'space-1',
        metadata: {},
        mode: 'research',
        query: 'What are the data classification rules?',
        stage: 'analyzing',
        top_k: 10,
        updated_at: 1_800_000_010,
      },
    ]
    apiMock.streamResearchEvents.mockImplementation(
      async ({ onEvent }: { onEvent: (event: Record<string, unknown>) => void }) => {
        const stages = ['queued', 'planning', 'retrieving', 'analyzing'] as const
        stages.forEach((stage, index) =>
          onEvent({
            createdAt: new Date(1_800_000_000_000 + index * 1000).toISOString(),
            id: `active-event-${index + 1}`,
            payload: {
              ...(stage === 'retrieving'
                ? {
                    details: {
                      topK: 10,
                      questions: ['What are the data classification rules?'],
                    },
                    previousStage: 'planning',
                  }
                : {}),
              ...(stage === 'analyzing'
                ? {
                    details: {
                      results: [
                        {
                          chunkCount: 10,
                          question: 'What are the data classification rules?',
                        },
                      ],
                      retrievalCount: 50,
                    },
                    previousStage: 'retrieving',
                  }
                : {}),
            },
            researchTaskJobId: 'research-analyzing',
            sequence: index + 1,
            stage,
            type: index ? 'research_task.stage_changed' : 'research_task.started',
          }),
        )
        return { cursor: '4', reconnect: false, terminal: false }
      },
    )

    renderPage({ searchParams: '?research=research-analyzing' })

    const plannedTopK = await screen.findByText('knowledgeSpace.settings.topKLabel: 10')
    const plannedDetails = plannedTopK.parentElement
    expect(plannedDetails).not.toBeNull()
    const plannedQuestion = within(plannedDetails!).getByText(
      'What are the data classification rules?',
    )
    expect(plannedQuestion.compareDocumentPosition(plannedTopK)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(
      await screen.findByText(
        'What are the data classification rules? · 10 knowledgeSpace.chunkCount',
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('What are the data classification rules? · 0 knowledgeSpace.chunkCount'),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('knowledgeSpace.chunkCount: 0')).not.toBeInTheDocument()
    expect(screen.queryByText('knowledgeSpace.documents: 0')).not.toBeInTheDocument()
  })

  it('fills historical research stages from persisted task and evidence data', async () => {
    apiMock.researchTasks = [
      {
        completed_at: 1_800_000_025,
        cost: {},
        created_at: 1_800_000_000,
        id: 'research-legacy',
        knowledge_space_id: 'space-1',
        metadata: {},
        mode: 'research',
        query: 'Where is the warranty policy?',
        stage: 'completed',
        updated_at: 1_800_000_025,
      },
    ]
    apiMock.streamResearchEvents.mockImplementation(
      async ({ onEvent }: { onEvent: (event: Record<string, unknown>) => void }) => {
        const stages = ['planning', 'retrieving', 'analyzing', 'generating', 'completed']
        stages.forEach((stage, index) =>
          onEvent({
            createdAt: new Date(1_800_000_000_000 + index * 1000).toISOString(),
            id: `legacy-event-${index + 1}`,
            payload: {},
            researchTaskJobId: 'research-legacy',
            sequence: index + 1,
            stage,
            type: index ? 'research_task.stage_changed' : 'research_task.started',
          }),
        )
        return { cursor: '5', reconnect: false, terminal: true }
      },
    )
    const user = userEvent.setup()
    renderPage({ searchParams: '?research=research-legacy' })

    await user.click(
      screen.getByRole('button', { name: 'knowledgeSpace.retrievalTest.processLog' }),
    )

    expect(
      await screen.findByText('Where is the warranty policy? · 0 knowledgeSpace.chunkCount'),
    ).toBeInTheDocument()
    expect(screen.getAllByText('knowledgeSpace.chunkCount: 0').length).toBeGreaterThan(0)
    expect(screen.getAllByText('knowledgeSpace.documents: 0').length).toBeGreaterThan(0)
    expect(screen.getAllByText('knowledgeSpace.sources: 0').length).toBeGreaterThan(0)
  })

  it('replaces the just-now label after the first minute', () => {
    vi.useFakeTimers()
    try {
      const now = Date.parse('2026-07-29T09:04:30Z')
      vi.setSystemTime(now)
      apiMock.traces = [
        {
          completed: true,
          created_at: new Date(now - 30_000).toISOString(),
          id: 'trace-recent',
          mode: 'fast',
          profile: {},
          query: 'A recent retrieval run',
          scores: {},
          stages: [],
        },
      ]

      renderPage()

      expect(screen.getAllByText('knowledgeSpace.retrievalTest.justNow')).not.toHaveLength(0)
      act(() => vi.advanceTimersByTime(30_001))
      expect(screen.queryAllByText('knowledgeSpace.retrievalTest.justNow')).toHaveLength(0)
      expect(screen.getByRole('button', { name: /A recent retrieval run/ })).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('selects the newest persisted record instead of showing the no-runs empty state', () => {
    apiMock.traces = [
      {
        completed: true,
        created_at: '2026-07-29T00:00:00.000Z',
        id: 'trace-newest',
        mode: 'fast',
        profile: {},
        query: 'Newest persisted query',
        result_count: 0,
        scores: {},
        stages: [],
      },
      {
        completed: true,
        created_at: '2026-07-28T00:00:00.000Z',
        id: 'trace-older',
        mode: 'fast',
        profile: {},
        query: 'Older persisted query',
        result_count: 0,
        scores: {},
        stages: [],
      },
    ]

    renderPage()

    expect(screen.getByRole('button', { name: /Newest persisted query/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.queryByText('knowledgeSpace.retrievalTest.emptyTitle')).not.toBeInTheDocument()
  })

  it('renders generated Research answer deltas while the task is still active', async () => {
    apiMock.researchTasks = [
      {
        cost: {},
        created_at: 1_800_000_000,
        id: 'research-active',
        knowledge_space_id: 'space-1',
        metadata: {},
        mode: 'research',
        query: 'What is the warranty?',
        stage: 'generating',
        updated_at: 1_800_000_005,
      },
    ]
    apiMock.streamResearchEvents.mockImplementation(
      async ({ onEvent }: { onEvent: (event: Record<string, unknown>) => void }) => {
        onEvent({
          createdAt: '2027-01-15T08:00:10.000Z',
          id: 'answer-1',
          payload: { delta: 'The warranty ', executionAttempt: 1, offset: 0 },
          researchTaskJobId: 'research-active',
          sequence: 1,
          stage: 'generating',
          type: 'research_task.answer_delta',
        })
        onEvent({
          createdAt: '2027-01-15T08:00:11.000Z',
          id: 'answer-2',
          payload: { delta: 'is two years.', executionAttempt: 1, offset: 13 },
          researchTaskJobId: 'research-active',
          sequence: 2,
          stage: 'generating',
          type: 'research_task.answer_delta',
        })
        return { cursor: '2', reconnect: false, terminal: false }
      },
    )
    renderPage({ searchParams: '?research=research-active' })

    const answer = await screen.findByText('The warranty is two years.')
    expect(answer.closest('[aria-live="polite"]')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', {
        name: 'knowledgeSpace.retrievalTest.generatingActive',
      }),
    ).toBeInTheDocument()
  })

  it('shows the persisted final answer when reopening completed Research history', async () => {
    apiMock.researchTasks = [
      {
        completed_at: 1_800_000_025,
        cost: {},
        created_at: 1_800_000_000,
        id: 'research-completed',
        knowledge_space_id: 'space-1',
        metadata: {},
        mode: 'research',
        query: 'What is the warranty?',
        stage: 'completed',
        updated_at: 1_800_000_025,
      },
    ]
    apiMock.partials = [
      {
        answer: 'The persisted warranty answer.',
        evidence_bundle: {},
        knowledge_space_id: 'space-1',
        research_task_job_id: 'research-completed',
        sequence: 1,
      },
    ]
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /What is the warranty\?/ }))

    expect(await screen.findByText('The persisted warranty answer.')).toBeInTheDocument()
    expect(screen.queryByText('knowledgeSpace.retrievalTest.noChunksTitle')).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'knowledgeSpace.retrievalTest.generating' }),
    ).toBeInTheDocument()
  })

  it('expands hidden evidence and jumps to a generated answer citation', async () => {
    apiMock.researchTasks = [
      {
        completed_at: 1_800_000_025,
        cost: {},
        created_at: 1_800_000_000,
        id: 'research-completed',
        knowledge_space_id: 'space-1',
        metadata: {},
        mode: 'research',
        query: 'What is the warranty?',
        stage: 'completed',
        updated_at: 1_800_000_025,
      },
    ]
    apiMock.partials = [
      {
        answer: 'The seventh source contains the relevant detail. [7]',
        evidence_bundle: {
          items: Array.from({ length: 10 }, (_, index) => ({
            id: `chunk-${index + 1}`,
            score: 1,
            text: `Evidence ${index + 1}`,
            title: `Chunk ${index + 1}`,
          })),
        },
        knowledge_space_id: 'space-1',
        research_task_job_id: 'research-completed',
        sequence: 1,
      },
    ]
    const scrollIntoView = vi
      .spyOn(HTMLElement.prototype, 'scrollIntoView')
      .mockImplementation(() => undefined)
    const user = userEvent.setup()

    renderPage({ searchParams: '?research=research-completed' })

    expect(screen.queryByRole('heading', { name: 'Chunk 7' })).not.toBeInTheDocument()
    await user.click(await screen.findByRole('link', { name: '[7]' }))

    const citedEvidence = screen.getByRole('heading', { name: 'Chunk 7' }).closest('article')
    expect(citedEvidence).toHaveFocus()
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
  })

  it('keeps the selected research record in the URL', async () => {
    apiMock.researchTasks = [
      {
        completed_at: 1_800_000_025,
        cost: {},
        created_at: 1_800_000_000,
        id: 'research-completed',
        knowledge_space_id: 'space-1',
        metadata: {},
        mode: 'research',
        query: 'What is the warranty?',
        stage: 'completed',
        updated_at: 1_800_000_025,
      },
    ]
    const user = userEvent.setup()
    const { onUrlUpdate } = renderPage()

    await user.click(screen.getByRole('button', { name: /What is the warranty\?/ }))

    await waitFor(() => {
      const urlUpdate = onUrlUpdate.mock.calls.at(-1)?.[0]
      expect(urlUpdate?.searchParams.get('research')).toBe('research-completed')
      expect(urlUpdate?.searchParams.get('trace')).toBeNull()
      expect(urlUpdate?.options.history).toBe('push')
      expect(urlUpdate?.options.shallow).toBe(false)
    })
  })

  it('restores a selected research record from the URL', () => {
    apiMock.researchTasks = [
      {
        completed_at: 1_800_000_025,
        cost: {},
        created_at: 1_800_000_000,
        id: 'research-completed',
        knowledge_space_id: 'space-1',
        metadata: {},
        mode: 'research',
        query: 'What is the warranty?',
        stage: 'completed',
        updated_at: 1_800_000_025,
      },
    ]

    renderPage({ searchParams: '?research=research-completed' })

    expect(screen.getByRole('button', { name: /What is the warranty\?/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(
      screen.getByRole('heading', { name: 'knowledgeSpace.retrievalTest.researchResult' }),
    ).toBeInTheDocument()
  })

  it('loads a research deep link even when the task is not in the first history page', async () => {
    apiMock.researchDetail = {
      completed_at: 1_800_000_025,
      cost: {},
      created_at: 1_800_000_000,
      id: 'research-older',
      knowledge_space_id: 'space-1',
      metadata: {},
      mode: 'research',
      query: 'An older research question',
      stage: 'completed',
      updated_at: 1_800_000_025,
    }

    renderPage({ searchParams: '?research=research-older' })

    expect(
      screen.getByRole('heading', { name: 'knowledgeSpace.retrievalTest.researchResult' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('knowledgeSpace.retrievalTest.queryPlaceholder')).toHaveValue(
      'An older research question',
    )
  })

  it('keeps an older research deep link in a loading state until its detail arrives', () => {
    apiMock.researchDetailPending = true

    renderPage({ searchParams: '?research=research-older' })

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText('knowledgeSpace.retrievalTest.noChunksTitle')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: 'knowledgeSpace.retrievalTest.keepGoldenQuestion',
      }),
    ).not.toBeInTheDocument()
  })

  it('shows and retries an older research deep-link detail failure', async () => {
    apiMock.researchDetailError = true
    const user = userEvent.setup()

    renderPage({ searchParams: '?research=research-older' })

    expect(screen.getByRole('alert')).toHaveTextContent(
      'knowledgeSpace.retrievalTest.failedDescription',
    )
    expect(screen.queryByText('knowledgeSpace.retrievalTest.noChunksTitle')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.retrievalTest.retry' }))
    expect(apiMock.refetchResearchDetail).toHaveBeenCalledOnce()
  })

  it('loads older trace and research history pages', async () => {
    apiMock.traces = [
      {
        completed: true,
        created_at: '2026-07-29T00:00:00.000Z',
        id: 'trace-1',
        mode: 'fast',
        profile: {},
        query: 'First page query',
        scores: {},
        stages: [],
      },
    ]
    apiMock.tracesHasNextPage = true
    apiMock.researchHasNextPage = true
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.loadMore' }))

    expect(apiMock.fetchNextTraces).toHaveBeenCalledOnce()
    expect(apiMock.fetchNextTasks).toHaveBeenCalledOnce()
  })

  it('continues loading paginated trace evidence', async () => {
    apiMock.traces = [
      {
        completed: true,
        created_at: '2026-07-29T00:00:00.000Z',
        id: 'trace-1',
        mode: 'fast',
        profile: {},
        query: 'Paginated evidence',
        scores: {},
        stages: [],
      },
    ]
    apiMock.evidenceHasNextPage = true

    const user = userEvent.setup()
    renderPage({ searchParams: '?trace=trace-1' })

    expect(apiMock.fetchNextEvidence).not.toHaveBeenCalled()
    await user.click(
      screen.getByRole('button', {
        name: /knowledgeSpace\.retrievalTest\.showAllChunks/,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.loadMore' }))
    expect(apiMock.fetchNextEvidence).toHaveBeenCalledOnce()
  })

  it('does not carry the expanded evidence state to a URL-selected result', async () => {
    apiMock.traces = ['trace-1', 'trace-2'].map((id) => ({
      completed: true,
      created_at: '2026-07-29T00:00:00.000Z',
      id,
      mode: 'fast',
      profile: {},
      query: `${id} query`,
      scores: {},
      stages: [],
    }))
    apiMock.evidence = {
      data: Array.from({ length: 4 }, (_, index) => ({
        kind: 'resource',
        metadata: { text: `Evidence ${index + 1}` },
        name: `chunk-${index + 1}`,
        path: `/queries/evidence/chunk-${index + 1}`,
        resourceType: 'node',
        targetId: `chunk-${index + 1}`,
      })),
      next_cursor: null,
      truncated: false,
    }
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    })
    const user = userEvent.setup()

    function NavigationHarness() {
      const [searchParams, setSearchParams] = useState('?trace=trace-1')
      return (
        <NuqsTestingAdapter hasMemory searchParams={searchParams}>
          <button type="button" onClick={() => setSearchParams('?trace=trace-2')}>
            Navigate to trace 2
          </button>
          <RetrievalTestPage knowledgeSpaceId="space-1" />
        </NuqsTestingAdapter>
      )
    }

    render(
      <QueryClientProvider client={queryClient}>
        <NavigationHarness />
      </QueryClientProvider>,
    )

    const showAllName = /knowledgeSpace\.retrievalTest\.showAllChunks/
    await user.click(screen.getByRole('button', { name: showAllName }))
    expect(screen.queryByRole('button', { name: showAllName })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Navigate to trace 2' }))

    expect(await screen.findByRole('button', { name: showAllName })).toBeInTheDocument()
  })

  it('keeps partial trace evidence visible and retries a failed next page', async () => {
    apiMock.traces = [
      {
        completed: true,
        created_at: '2026-07-29T00:00:00.000Z',
        id: 'trace-1',
        mode: 'fast',
        profile: {},
        query: 'Paginated evidence',
        scores: {},
        stages: [],
      },
    ]
    apiMock.evidence = {
      data: [
        {
          kind: 'resource',
          metadata: { text: 'Evidence from the first page.' },
          name: 'chunk-1',
          path: '/queries/trace-1/evidence/chunk-1',
          resourceType: 'node',
          targetId: 'chunk-1',
        },
      ],
      next_cursor: 'page-2',
      truncated: true,
    }
    apiMock.evidenceFetchNextPageError = true
    const user = userEvent.setup()

    renderPage({ searchParams: '?trace=trace-1' })

    expect(screen.getByText('Evidence from the first page.')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: 'knowledgeSpace.retrievalTest.keepGoldenQuestion',
      }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.retrievalTest.retry' }))
    expect(apiMock.fetchNextEvidence).toHaveBeenCalledOnce()
  })

  it('continues loading paginated research partials', async () => {
    apiMock.researchTasks = [
      {
        completed_at: 1_800_000_025,
        cost: {},
        created_at: 1_800_000_000,
        id: 'research-completed',
        knowledge_space_id: 'space-1',
        metadata: {},
        mode: 'research',
        query: 'Paginated research evidence',
        stage: 'completed',
        updated_at: 1_800_000_025,
      },
    ]
    apiMock.partialsHasNextPage = true

    const user = userEvent.setup()
    renderPage({ searchParams: '?research=research-completed' })

    expect(apiMock.fetchNextPartials).not.toHaveBeenCalled()
    await user.click(
      screen.getByRole('button', {
        name: /knowledgeSpace\.retrievalTest\.showAllChunks/,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.loadMore' }))
    expect(apiMock.fetchNextPartials).toHaveBeenCalledOnce()
  })

  it('keeps a partial research answer visible and retries a failed next page', async () => {
    apiMock.researchTasks = [
      {
        completed_at: 1_800_000_025,
        cost: {},
        created_at: 1_800_000_000,
        id: 'research-completed',
        knowledge_space_id: 'space-1',
        metadata: {},
        mode: 'research',
        query: 'Paginated research evidence',
        stage: 'completed',
        updated_at: 1_800_000_025,
      },
    ]
    apiMock.partials = [
      {
        answer: 'The first page of the research answer.',
        evidence_bundle: {},
        knowledge_space_id: 'space-1',
        research_task_job_id: 'research-completed',
        sequence: 1,
      },
    ]
    apiMock.partialsFetchNextPageError = true
    const user = userEvent.setup()

    renderPage({ searchParams: '?research=research-completed' })

    expect(screen.getByText('The first page of the research answer.')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.retrievalTest.retry' }))
    expect(apiMock.fetchNextPartials).toHaveBeenCalledOnce()
  })

  it('reconnects an active research event stream from its latest cursor', async () => {
    apiMock.researchTasks = [
      {
        cost: {},
        created_at: 1_800_000_000,
        id: 'research-active',
        knowledge_space_id: 'space-1',
        metadata: {},
        mode: 'research',
        query: 'Compare the refund policies',
        stage: 'retrieving',
        updated_at: 1_800_000_005,
      },
    ]
    apiMock.streamResearchEvents
      .mockResolvedValueOnce({ cursor: '3', reconnect: true, terminal: false })
      .mockResolvedValueOnce({ cursor: '4', reconnect: false, terminal: true })
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /Compare the refund policies/ }))

    await waitFor(() => expect(apiMock.streamCapability).toHaveBeenCalledTimes(2))
    expect(apiMock.streamResearchEvents).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cursor: '3' }),
    )
  })

  it('refreshes final partials only once when a streamed task completes', async () => {
    const activeTask = {
      cost: {},
      created_at: 1_800_000_000,
      id: 'research-active',
      knowledge_space_id: 'space-1',
      metadata: {},
      mode: 'research',
      query: 'Compare the refund policies',
      stage: 'retrieving',
      updated_at: 1_800_000_005,
    }
    apiMock.researchTasks = [activeTask]
    apiMock.refetchTasks.mockImplementation(async () => {
      apiMock.researchTasks = [
        {
          ...activeTask,
          completed_at: 1_800_000_025,
          stage: 'completed',
          updated_at: 1_800_000_025,
        },
      ]
    })
    apiMock.streamResearchEvents.mockImplementation(
      async ({
        onEvent,
      }: {
        onEvent: (event: {
          createdAt: string
          id: string
          payload: Record<string, unknown>
          researchTaskJobId: string
          sequence: number
          stage: string
          type: string
        }) => void
      }) => {
        onEvent({
          createdAt: '2027-01-15T08:00:25.000Z',
          id: 'event-completed',
          payload: {},
          researchTaskJobId: 'research-active',
          sequence: 5,
          stage: 'completed',
          type: 'research_task.stage_changed',
        })
        return { cursor: '5', reconnect: false, terminal: true }
      },
    )
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /Compare the refund policies/ }))

    await waitFor(() => expect(apiMock.refetchTasks).toHaveBeenCalledOnce())
    await waitFor(() => expect(apiMock.refetchPartials).toHaveBeenCalledOnce())
  })

  it('shows retrieved Research chunks during generation without reloading the page', async () => {
    apiMock.partials = [
      {
        evidence_bundle: {
          items: [
            {
              citations: [
                {
                  documentAssetId: 'document-1',
                  documentVersion: 1,
                  sectionPath: ['Warranty'],
                  startOffset: 0,
                },
              ],
              metadata: {},
              nodeId: 'chunk-live-1',
              score: 0.9,
              text: 'Retrieved warranty evidence',
            },
          ],
        },
        knowledge_space_id: 'space-1',
        research_task_job_id: 'research-1',
        sequence: 1,
      },
    ]
    apiMock.streamResearchEvents.mockImplementation(
      async ({
        onEvent,
      }: {
        onEvent: (event: {
          createdAt: string
          id: string
          payload: Record<string, unknown>
          researchTaskJobId: string
          sequence: number
          stage: string
          type: string
        }) => void
      }) => {
        onEvent({
          createdAt: '2027-01-15T08:00:20.000Z',
          id: 'event-generating',
          payload: {
            details: { chunks: 1, retrievalCount: 1 },
            previousStage: 'analyzing',
          },
          researchTaskJobId: 'research-1',
          sequence: 6,
          stage: 'generating',
          type: 'research_task.stage_changed',
        })
        return { cursor: '6', reconnect: false, terminal: false }
      },
    )
    const user = userEvent.setup()
    renderPage()

    await user.type(
      screen.getByLabelText('knowledgeSpace.retrievalTest.queryPlaceholder'),
      'Compare the refund policies',
    )
    await user.click(
      screen.getByRole('radio', {
        name: 'knowledgeSpace.settings.retrievalMode.research',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.retrievalTest.run' }))

    expect(await screen.findByText('Retrieved warranty evidence')).toBeInTheDocument()
    expect(apiMock.refetchPartials).toHaveBeenCalledOnce()
    expect(screen.queryByText('knowledgeSpace.retrievalTest.noChunksTitle')).not.toBeInTheDocument()
  })

  it('does not let the composer shortcut bypass an active research task', async () => {
    apiMock.researchTasks = [
      {
        cost: {},
        created_at: 1_800_000_000,
        id: 'research-active',
        knowledge_space_id: 'space-1',
        metadata: {},
        mode: 'research',
        query: 'Compare the refund policies',
        stage: 'retrieving',
        updated_at: 1_800_000_005,
      },
    ]
    const user = userEvent.setup()
    renderPage()

    expect(
      screen.getByText('knowledgeSpace.retrievalTest.retrievingActive · 2/4'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Compare the refund policies/ }))
    const queryInput = screen.getByLabelText('knowledgeSpace.retrievalTest.queryPlaceholder')
    expect(screen.getByRole('button', { name: 'knowledgeSpace.retrievalTest.run' })).toBeDisabled()

    await user.click(queryInput)
    await user.keyboard('{Control>}{Enter}{/Control}')

    expect(apiMock.planResearch).not.toHaveBeenCalled()
    expect(apiMock.queryAdmission).not.toHaveBeenCalled()
  })

  it('persists a selected trace as a production bad case', async () => {
    apiMock.traces = [
      {
        completed: true,
        created_at: '2026-07-29T00:00:00.000Z',
        id: 'trace-1',
        mode: 'fast',
        profile: {},
        query: 'Why did retrieval miss the refund exception?',
        scores: {},
        stages: [],
      },
    ]
    const user = userEvent.setup()
    renderPage({ searchParams: '?trace=trace-1' })

    expect(
      screen.queryByRole('link', { name: 'knowledgeSpace.retrievalTest.quality' }),
    ).not.toBeInTheDocument()
    const makeBadCaseButton = screen.getByRole('button', {
      name: 'knowledgeSpace.retrievalTest.makeBadCase',
    })
    expect(makeBadCaseButton).toHaveClass('bg-components-button-secondary-bg')
    await user.click(makeBadCaseButton)
    expect(apiMock.createBadCase).not.toHaveBeenCalled()
    await user.click(
      await screen.findByRole('menuitem', {
        name: 'knowledgeSpace.qualityPage.reasonValues.lowScore',
      }),
    )

    await waitFor(() =>
      expect(apiMock.createBadCase).toHaveBeenCalledWith({
        body: {
          reason: 'low-score',
          tags: ['retrieval-test'],
          trace_id: 'trace-1',
        },
        params: { control_space_id: 'space-1' },
      }),
    )
    expect(screen.getByText('knowledgeSpace.retrievalTest.savedBadCase')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'knowledgeSpace.retrievalTest.viewInQuality' }),
    ).toHaveAttribute('href', '/datasets/new/space-1/quality')
  })

  it('hides quality mutations from viewers of retrieval traces', async () => {
    knowledgeSpacePermissionState.keys = []
    apiMock.traces = [
      {
        completed: true,
        created_at: '2026-07-29T00:00:00.000Z',
        id: 'trace-viewer',
        mode: 'fast',
        profile: {},
        query: 'View this result without changing quality data',
        scores: {},
        stages: [],
      },
    ]

    renderPage({ searchParams: '?trace=trace-viewer' })

    expect(
      await screen.findAllByText('View this result without changing quality data'),
    ).not.toHaveLength(0)
    expect(
      screen.queryByRole('button', {
        name: 'knowledgeSpace.retrievalTest.makeBadCase',
      }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: 'knowledgeSpace.retrievalTest.keepGoldenQuestion',
      }),
    ).not.toBeInTheDocument()
  })

  it('lets the user select retrieved evidence before keeping a golden question', async () => {
    apiMock.traces = [
      {
        completed: true,
        created_at: '2026-07-29T00:00:00.000Z',
        id: 'trace-1',
        mode: 'fast',
        profile: {},
        query: 'What is useEffect?',
        scores: {},
        stages: [],
      },
    ]
    apiMock.evidence = {
      data: [
        {
          kind: 'resource',
          metadata: {
            score: 0.9,
            text: 'useEffect synchronizes a component with an external system.',
          },
          name: 'chunk-1',
          path: '/queries/trace-1/evidence/chunk-1',
          resourceType: 'node',
          targetId: 'chunk-1',
        },
      ],
    }
    const user = userEvent.setup()
    const { queryClient } = renderPage({ searchParams: '?trace=trace-1' })
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    await user.click(
      screen.getByRole('button', {
        name: 'knowledgeSpace.retrievalTest.keepGoldenQuestion',
      }),
    )

    const dialog = await screen.findByRole('dialog', {
      name: 'knowledgeSpace.qualityPage.promoteTitle',
    })
    expect(apiMock.createGolden).not.toHaveBeenCalled()
    expect(
      within(dialog).getByPlaceholderText('knowledgeSpace.qualityPage.questionPlaceholder'),
    ).toHaveValue('What is useEffect?')
    await user.click(
      within(dialog).getByText('useEffect synchronizes a component with an external system.'),
    )
    await user.type(
      within(dialog).getByPlaceholderText('knowledgeSpace.qualityPage.annotationPlaceholder'),
      'The answer must cite the retrieved useEffect evidence.',
    )
    await user.click(
      within(dialog).getByRole('button', {
        name: 'knowledgeSpace.qualityPage.promote',
      }),
    )

    await waitFor(() =>
      expect(apiMock.createGolden).toHaveBeenCalledWith({
        body: {
          annotation: 'The answer must cite the retrieved useEffect evidence.',
          expected_evidence_ids: ['chunk-1'],
          match_policy: 'all',
          question: 'What is useEffect?',
          tags: ['retrieval-test'],
        },
        params: { control_space_id: 'space-1' },
      }),
    )
    await waitFor(() =>
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['quality', 'golden'],
      }),
    )
    expect(screen.getByText('knowledgeSpace.retrievalTest.savedGoldenQuestion')).toBeInTheDocument()
  })

  it('loads a deep-linked trace detail when it is not present in the first list page', async () => {
    apiMock.traceDetail = {
      completed: true,
      created_at: '2026-07-01T00:00:00.000Z',
      id: 'trace-old',
      mode: 'deep',
      profile: {},
      query: 'An older production question',
      scores: {},
      stages: [],
    }
    const user = userEvent.setup()
    renderPage({ searchParams: '?trace=trace-old' })

    expect(
      screen.getByRole('heading', {
        name: 'knowledgeSpace.retrievalTest.result',
      }),
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', {
        name: 'knowledgeSpace.retrievalTest.makeBadCase',
      }),
    )
    await user.click(
      await screen.findByRole('menuitem', {
        name: 'knowledgeSpace.qualityPage.reasonValues.retrievalMiss',
      }),
    )

    await waitFor(() =>
      expect(apiMock.createBadCase).toHaveBeenCalledWith({
        body: {
          reason: 'retrieval-miss',
          tags: ['retrieval-test'],
          trace_id: 'trace-old',
        },
        params: { control_space_id: 'space-1' },
      }),
    )
  })

  it('runs a one-shot retest from a linked production trace', async () => {
    apiMock.traceDetail = {
      completed: true,
      created_at: '2026-07-01T00:00:00.000Z',
      id: 'trace-old',
      mode: 'deep',
      profile: {},
      query: 'Retest the refund exception',
      scores: {},
      stages: [],
    }
    const { onUrlUpdate } = renderPage({
      searchParams: '?trace=trace-old&retest=trace-old',
    })

    await waitFor(() =>
      expect(apiMock.queryAdmission).toHaveBeenCalledWith({
        body: { mode: 'deep', query: 'Retest the refund exception' },
        params: { control_space_id: 'space-1' },
      }),
    )
    expect(apiMock.queryAdmission).toHaveBeenCalledTimes(1)
    expect(onUrlUpdate).toHaveBeenCalled()
  })

  it('opens retrieval evidence through its logical document instead of its asset', async () => {
    apiMock.traces = [
      {
        completed: true,
        created_at: '2026-07-29T00:00:00.000Z',
        id: 'trace-1',
        mode: 'fast',
        profile: {},
        query: 'What is the refund policy?',
        scores: {},
        stages: [],
      },
    ]
    apiMock.evidence = {
      data: [
        {
          kind: 'resource',
          metadata: {
            documentId: 'asset-1',
            documentName: 'refund-policy.txt',
            documentRevision: 2,
            logicalDocumentId: 'document-1',
            revision: '2',
            score: 0.0005295,
            text: 'Refunds are available within 30 days.',
          },
          name: 'chunk-1',
          path: '/queries/trace-1/evidence/chunk-1',
          resourceType: 'node',
          targetId: 'chunk-1',
        },
      ],
    }
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /What is the refund policy\?/ }))

    expect(screen.getByRole('link', { name: 'knowledgeSpace.retrievalTest.open' })).toHaveAttribute(
      'href',
      '/datasets/new/space-1/documents/document-1?revision=2&chunk=chunk-1',
    )
    expect(screen.getByText('refund-policy.txt')).toBeInTheDocument()
    expect(screen.getByText('<0.01')).toBeInTheDocument()
    expect(
      screen.getByText('knowledgeSpace.retrievalTest.revision:{"revision":"2"}'),
    ).toBeInTheDocument()
  })

  it('keeps a trace visible when one document is deleted and marks only that evidence unavailable', async () => {
    apiMock.traces = [
      {
        completed: true,
        created_at: '2026-07-29T00:00:00.000Z',
        id: 'trace-1',
        mode: 'fast',
        profile: {},
        query: 'Compare all three sources',
        scores: {},
        stages: [],
      },
    ]
    apiMock.evidence = {
      data: [
        {
          kind: 'resource',
          metadata: {
            availability: 'available',
            logicalDocumentId: 'document-1',
            text: 'First available passage.',
            title: 'First source',
          },
          name: 'node-1',
          path: '/queries/trace-1/evidence/node-1',
          resourceType: 'node',
          targetId: 'node-1',
        },
        {
          kind: 'resource',
          metadata: {
            availability: 'unavailable',
            text: 'Evidence deleted or unavailable',
            unavailableReason: 'document-deleted-or-unavailable',
          },
          name: 'node-2',
          path: '/queries/trace-1/evidence/node-2',
          resourceType: 'node',
          targetId: 'node-2',
        },
        {
          kind: 'resource',
          metadata: {
            availability: 'available',
            logicalDocumentId: 'document-3',
            text: 'Third available passage.',
            title: 'Third source',
          },
          name: 'node-3',
          path: '/queries/trace-1/evidence/node-3',
          resourceType: 'node',
          targetId: 'node-3',
        },
      ],
    }
    const user = userEvent.setup()

    renderPage()
    await user.click(screen.getByRole('button', { name: /Compare all three sources/ }))

    expect(screen.getByText('First available passage.')).toBeInTheDocument()
    expect(screen.getByText('Third available passage.')).toBeInTheDocument()
    expect(
      screen.getByText('knowledgeSpace.qualityPage.evaluation.evidenceUnavailable'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Evidence deleted or unavailable')).not.toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'knowledgeSpace.retrievalTest.open' })).toHaveLength(
      2,
    )
  })

  it('shows the full chunk and opens its source when the revision is unavailable', async () => {
    apiMock.traces = [
      {
        completed: true,
        created_at: '2026-07-29T00:00:00.000Z',
        id: 'trace-1',
        mode: 'fast',
        profile: {},
        query: 'How are issues tracked?',
        scores: {},
        stages: [],
      },
    ]
    const evidenceText =
      'This is the complete issue tracking chunk, including the problem description, severity, resolution status, resolution time, and resolution details.'
    apiMock.evidence = {
      data: [
        {
          kind: 'resource',
          metadata: {
            documentName: 'Issue Tracking Log',
            logicalDocumentId: 'document-1',
            score: 0.74,
            text: evidenceText,
          },
          name: 'chunk-1',
          path: '/queries/trace-1/evidence/chunk-1',
          resourceType: 'node',
          targetId: 'chunk-1',
        },
      ],
    }
    const user = userEvent.setup()

    renderPage()
    await user.click(screen.getByRole('button', { name: /How are issues tracked\?/ }))

    expect(screen.getByText(evidenceText)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'share.chat.expand' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'knowledgeSpace.retrievalTest.open' })).toHaveAttribute(
      'href',
      '/datasets/new/space-1/documents/document-1?chunk=chunk-1',
    )
  })

  it('resolves an asset-only evidence source before opening it', async () => {
    apiMock.traces = [
      {
        completed: true,
        created_at: '2026-07-29T00:00:00.000Z',
        id: 'trace-1',
        mode: 'fast',
        profile: {},
        query: 'How are issues tracked?',
        scores: {},
        stages: [],
      },
    ]
    apiMock.evidence = {
      data: [
        {
          kind: 'resource',
          metadata: {
            documentId: 'asset-1',
            documentName: 'Issue Tracking Log',
            documentVersion: 1,
            score: 0.74,
            text: 'Issues are recorded in the tracking log.',
          },
          name: 'chunk-1',
          path: '/queries/trace-1/evidence/chunk-1',
          resourceType: 'node',
          targetId: 'chunk-1',
        },
      ],
    }
    apiMock.listLogicalDocuments
      .mockResolvedValueOnce({
        data: [],
        next_cursor: 'page-2',
      })
      .mockResolvedValueOnce({
        data: [
          {
            active: { document_asset_id: 'asset-1' },
            id: 'document-1',
            title: 'Issue Tracking Log',
          },
        ],
        next_cursor: null,
      })
    const user = userEvent.setup()

    renderPage()
    await user.click(screen.getByRole('button', { name: /How are issues tracked\?/ }))
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.retrievalTest.open' }))

    await waitFor(() =>
      expect(apiMock.routerPush).toHaveBeenCalledWith(
        '/datasets/new/space-1/documents/document-1?revision=1&chunk=chunk-1',
      ),
    )
    expect(apiMock.listLogicalDocuments).toHaveBeenNthCalledWith(1, {
      params: { control_space_id: 'space-1' },
      query: {},
    })
    expect(apiMock.listLogicalDocuments).toHaveBeenNthCalledWith(2, {
      params: { control_space_id: 'space-1' },
      query: { cursor: 'page-2' },
    })
  })

  it('keeps a failed run in Records and renders the failure inline', async () => {
    apiMock.streamQuery.mockRejectedValueOnce(new Error('provider timed out'))
    const user = userEvent.setup()
    renderPage()

    await user.type(
      screen.getByLabelText('knowledgeSpace.retrievalTest.queryPlaceholder'),
      'Why did this fail?',
    )
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.retrievalTest.run' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'knowledgeSpace.retrievalTest.failedTitle',
    )
    expect(screen.getAllByText('Why did this fail?')).toHaveLength(2)
    expect(screen.getByText('provider timed out')).toBeInTheDocument()
  })

  it('restores a historical failed trace with its query and retry action', async () => {
    apiMock.traces = [
      {
        completed: false,
        created_at: '2026-07-29T00:00:00.000Z',
        duration_ms: 30_000,
        id: 'trace-failed',
        mode: 'fast',
        profile: {},
        query: 'Why did historical retrieval fail?',
        result_count: 0,
        scores: {},
        stages: [{ name: 'query.generate', status: 'error' }],
      },
    ]
    const user = userEvent.setup()
    renderPage({ searchParams: '?trace=trace-failed' })

    expect(
      await screen.findByDisplayValue('Why did historical retrieval fail?'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('knowledgeSpace.retrievalTest.failedAfter:{"duration":"30s"}'),
    ).toBeInTheDocument()
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('knowledgeSpace.retrievalTest.failedTitle')
    expect(alert).toHaveTextContent('knowledgeSpace.retrievalTest.failedDescription')

    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.retrievalTest.retry' }))

    expect(apiMock.queryAdmission).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { mode: 'fast', query: 'Why did historical retrieval fail?' },
      }),
    )
    expect(apiMock.streamQuery).toHaveBeenCalledOnce()
  })

  it('keeps a completed trace selected with its persisted chunk and duration summary', async () => {
    apiMock.streamQuery.mockImplementationOnce(
      async ({ onEvent }: { onEvent: (event: Record<string, unknown>) => void }) => {
        onEvent({ data: { trace_id: 'trace-1' }, event: 'completed' })
      },
    )
    apiMock.refetchTraces.mockImplementationOnce(async () => {
      apiMock.traces = [
        {
          completed: true,
          created_at: new Date().toISOString(),
          duration_ms: 1250,
          id: 'trace-1',
          mode: 'fast',
          profile: {},
          query: 'What is the retention window?',
          result_count: 4,
          scores: {},
          stages: [],
        },
      ]
      return {
        data: { pageParams: [null], pages: [{ data: apiMock.traces, next_cursor: null }] },
      }
    })
    const user = userEvent.setup()
    renderPage()

    await user.type(
      screen.getByLabelText('knowledgeSpace.retrievalTest.queryPlaceholder'),
      'What is the retention window?',
    )
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.retrievalTest.run' }))

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /What is the retention window\?/ }),
      ).toHaveAttribute('aria-pressed', 'true'),
    )
    const record = screen.getByRole('button', { name: /What is the retention window\?/ })
    expect(
      within(record).getByText(
        'knowledgeSpace.retrievalTest.recordSummary:{"count":4,"duration":"1.3s"}',
      ),
    ).toBeInTheDocument()
  })

  it('renders the readable message from a structured retrieval error', async () => {
    apiMock.streamQuery.mockRejectedValueOnce(
      new Response(
        JSON.stringify({
          code: 'RETRIEVAL_DELETION_IN_PROGRESS',
          error: 'Knowledge space retrieval is unavailable while deletion is in progress',
        }),
        { status: 409 },
      ),
    )
    const user = userEvent.setup()
    renderPage()

    await user.type(
      screen.getByLabelText('knowledgeSpace.retrievalTest.queryPlaceholder'),
      'Can I search now?',
    )
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.retrievalTest.run' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      'Knowledge space retrieval is unavailable while deletion is in progress',
    )
    expect(alert).not.toHaveTextContent('RETRIEVAL_DELETION_IN_PROGRESS')
    expect(
      screen.getByText('knowledgeSpace.retrievalTest.failedAfter:{"duration":"0s"}'),
    ).toBeInTheDocument()
  })

  it('locks the composer and announces a stalled fast run', async () => {
    apiMock.streamQuery.mockImplementationOnce(
      ({ signal }: { signal?: AbortSignal }) =>
        new Promise<void>((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'))
          })
        }),
    )
    const user = userEvent.setup()
    renderPage()

    const queryInput = screen.getByLabelText('knowledgeSpace.retrievalTest.queryPlaceholder')
    await user.type(queryInput, 'A query that never completes')
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.retrievalTest.run' }))

    expect(queryInput).toBeDisabled()
    expect(screen.getByRole('button', { name: 'knowledgeSpace.retrievalTest.run' })).toBeDisabled()
    expect(
      screen.queryByRole('button', { name: 'knowledgeSpace.retrievalTest.cancel' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'common.loading' })).toHaveAttribute(
      'aria-live',
      'polite',
    )
    expect(
      screen.queryByRole('link', { name: 'knowledgeSpace.retrievalTest.quality' }),
    ).not.toBeInTheDocument()
  })

  it('maps an empty unpublished knowledge space to the designed no-results state', async () => {
    apiMock.streamQuery.mockRejectedValueOnce(
      new Response('Published runtime snapshot unavailable', { status: 503 }),
    )
    const user = userEvent.setup()
    renderPage()

    await user.type(
      screen.getByLabelText('knowledgeSpace.retrievalTest.queryPlaceholder'),
      'Anything here?',
    )
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.retrievalTest.run' }))

    expect(
      await screen.findByText('knowledgeSpace.retrievalTest.noChunksTitle'),
    ).toBeInTheDocument()
    expect(screen.queryByText('knowledgeSpace.retrievalTest.failedTitle')).not.toBeInTheDocument()
    expect(screen.getAllByText('Anything here?')).toHaveLength(2)
    expect(
      screen.queryByRole('button', {
        name: 'knowledgeSpace.retrievalTest.makeBadCase',
      }),
    ).not.toBeInTheDocument()
  })

  it('does not guess a trace id for a trace-less local run', async () => {
    apiMock.traces = [
      {
        completed: true,
        created_at: new Date().toISOString(),
        id: 'different-trace',
        mode: 'fast',
        profile: {},
        query: 'Repeated question',
        scores: {},
        stages: [],
      },
    ]
    const user = userEvent.setup()
    renderPage()

    await user.type(
      screen.getByLabelText('knowledgeSpace.retrievalTest.queryPlaceholder'),
      'Repeated question',
    )
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.retrievalTest.run' }))

    expect(
      screen.queryByRole('button', {
        name: 'knowledgeSpace.retrievalTest.makeBadCase',
      }),
    ).not.toBeInTheDocument()
    expect(apiMock.createBadCase).not.toHaveBeenCalled()
  })

  it('keeps query images attached to their run and restores them when the record is reselected', async () => {
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:query-image')
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    apiMock.streamQuery.mockImplementationOnce(
      async ({ onEvent }: { onEvent: (event: Record<string, unknown>) => void }) => {
        onEvent({ data: { trace_id: 'trace-2' }, event: 'completed' })
      },
    )
    apiMock.refetchTraces.mockImplementationOnce(async () => {
      apiMock.traces = [
        {
          completed: true,
          created_at: '2026-07-30T00:00:00.000Z',
          duration_ms: 1250,
          id: 'trace-2',
          mode: 'fast',
          profile: {},
          query: 'What does this diagram show?',
          result_count: 4,
          scores: {},
          stages: [],
        },
        {
          completed: true,
          created_at: '2026-07-29T00:00:00.000Z',
          id: 'trace-1',
          mode: 'fast',
          profile: {},
          query: 'What is the refund policy?',
          scores: {},
          stages: [],
        },
      ]
      return {
        data: { pageParams: [null], pages: [{ data: apiMock.traces, next_cursor: null }] },
      }
    })
    const user = userEvent.setup()
    const rendered = renderPage()

    await user.upload(
      screen.getByLabelText('knowledgeSpace.retrievalTest.addImages'),
      new File(['diagram'], 'diagram.png', { type: 'image/png' }),
    )
    await screen.findByRole('img', { name: 'diagram.png' })
    await user.type(
      screen.getByLabelText('knowledgeSpace.retrievalTest.queryPlaceholder'),
      'What does this diagram show?',
    )
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.retrievalTest.run' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /What does this diagram show\?/ })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    )

    // The composer keeps the image and the result panel shows what the run was asked with.
    expect(screen.getAllByRole('img', { name: 'diagram.png' })).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: /What does this diagram show\?/ }))
    expect(screen.getAllByRole('img', { name: 'diagram.png' })).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: /What is the refund policy\?/ }))
    expect(screen.queryByRole('img', { name: 'diagram.png' })).not.toBeInTheDocument()
    expect(revokeObjectUrl).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /What does this diagram show\?/ }))
    expect(screen.getAllByRole('img', { name: 'diagram.png' })).toHaveLength(2)

    rendered.unmount()
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:query-image')
    createObjectUrl.mockRestore()
    revokeObjectUrl.mockRestore()
  })

  it('shows persisted query images for history records and restores them into the composer', async () => {
    apiMock.traces = [
      {
        completed: true,
        created_at: '2026-07-30T00:00:00.000Z',
        duration_ms: 900,
        id: 'trace-1',
        mode: 'fast',
        profile: {},
        query: 'What does this diagram show?',
        query_images: [
          {
            byte_size: 2048,
            mime_type: 'image/png',
            name: 'diagram.png',
            preview_url: 'https://files.example.test/diagram.png?sign=1',
            upload_file_id: 'upload-image-1',
          },
          {
            byte_size: 512,
            mime_type: 'image/png',
            name: null,
            preview_url: null,
            upload_file_id: 'upload-image-2',
          },
        ],
        result_count: 2,
        scores: {},
        stages: [],
      },
      {
        completed: true,
        created_at: '2026-07-29T00:00:00.000Z',
        id: 'trace-0',
        mode: 'fast',
        profile: {},
        query: 'text only',
        scores: {},
        stages: [],
      },
    ]
    const user = userEvent.setup()
    renderPage()

    // The newest record is selected on load: composer and result panel both show its images,
    // a persisted image whose file is gone falls back to a labelled placeholder.
    const previews = screen.getAllByRole('img', { name: 'diagram.png' })
    expect(previews).toHaveLength(2)
    for (const preview of previews)
      expect(preview).toHaveAttribute('src', 'https://files.example.test/diagram.png?sign=1')
    expect(screen.getAllByRole('img', { name: 'upload-image-2' })).toHaveLength(2)
    const record = screen.getByRole('button', { name: /What does this diagram show\?/ })
    expect(
      within(record).getByRole('img', { name: 'knowledgeSpace.retrievalTest.queryImages' }),
    ).toHaveTextContent('2')

    await user.click(screen.getByRole('button', { name: /text only/ }))
    expect(screen.queryByRole('img', { name: 'diagram.png' })).not.toBeInTheDocument()

    await user.click(record)
    expect(screen.getAllByRole('img', { name: 'diagram.png' })).toHaveLength(2)

    // Editing the composer detaches it from the record without touching the record itself.
    await user.click(
      screen.getByRole('button', {
        name: 'knowledgeSpace.retrievalTest.removeImage:{"name":"diagram.png"}',
      }),
    )
    expect(screen.getAllByRole('img', { name: 'diagram.png' })).toHaveLength(1)
    expect(
      within(record).getByRole('img', { name: 'knowledgeSpace.retrievalTest.queryImages' }),
    ).toHaveTextContent('2')
  })

  it('does not offer to flag a trace that already has an unresolved bad case', async () => {
    apiMock.traces = [
      {
        completed: true,
        created_at: '2026-07-29T00:00:00.000Z',
        id: 'trace-1',
        mode: 'fast',
        open_bad_case_id: 'bad-case-open',
        profile: {},
        query: 'Why did retrieval miss the refund exception?',
        scores: {},
        stages: [],
      },
    ]
    renderPage({ searchParams: '?trace=trace-1' })

    expect(await screen.findByText('knowledgeSpace.retrievalTest.savedBadCase')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'knowledgeSpace.retrievalTest.viewInQuality' }),
    ).toHaveAttribute('href', '/datasets/new/space-1/quality')
    expect(
      screen.queryByRole('button', { name: 'knowledgeSpace.retrievalTest.makeBadCase' }),
    ).not.toBeInTheDocument()
  })

  it('treats a conflict on flagging as the trace already being an open bad case', async () => {
    apiMock.createBadCase.mockRejectedValueOnce(new Response('', { status: 409 }))
    apiMock.traces = [
      {
        completed: true,
        created_at: '2026-07-29T00:00:00.000Z',
        id: 'trace-1',
        mode: 'fast',
        profile: {},
        query: 'Why did retrieval miss the refund exception?',
        scores: {},
        stages: [],
      },
    ]
    const user = userEvent.setup()
    renderPage({ searchParams: '?trace=trace-1' })

    await user.click(
      screen.getByRole('button', { name: 'knowledgeSpace.retrievalTest.makeBadCase' }),
    )
    await user.click(
      await screen.findByRole('menuitem', {
        name: 'knowledgeSpace.qualityPage.reasonValues.lowScore',
      }),
    )

    expect(await screen.findByText('knowledgeSpace.retrievalTest.savedBadCase')).toBeInTheDocument()
    expect(apiMock.refetchTraces).toHaveBeenCalled()
    expect(
      screen.queryByRole('button', { name: 'knowledgeSpace.retrievalTest.makeBadCase' }),
    ).not.toBeInTheDocument()
  })
})
