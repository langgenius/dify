import type {
  GetKnowledgeSpacesByIdSourcesBySourceIdSyncPolicyResponse,
  GetKnowledgeSpacesByIdSourceWorkflowsByRunIdPagesResponse,
  Source,
  SourceWorkflowRun,
} from '@dify/contracts/knowledge-fs/types.gen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { getInitOptions } from '@/i18n-config/settings'
import datasetTranslations from '@/i18n/en-US/dataset.json'
import { render } from '@/test/console/render'
import { CrawlSelectionForm } from '../crawl-selection-form'

const clientMock = vi.hoisted(() => ({
  getPolicy: vi.fn(),
  getWorkflow: vi.fn(),
  selectPages: vi.fn(),
  updatePolicy: vi.fn(),
}))

const routerMock = vi.hoisted(() => ({ push: vi.fn() }))
const queryClientMock = vi.hoisted(() => ({ invalidateQueries: vi.fn() }))
const policyQueryOptionsMock = vi.hoisted(() =>
  vi.fn(({ input }) => ({
    queryFn: () => clientMock.getPolicy(input),
    queryKey: ['sync-policy', input.params.sourceId],
    retry: false,
  })),
)

vi.mock('@/next/navigation', () => ({ useRouter: () => routerMock }))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-query')>()
  return { ...original, useQueryClient: () => queryClientMock }
})

vi.mock('@/service/client', () => ({
  consoleClient: {
    knowledgeFs: {
      getKnowledgeSpacesByIdSourcesBySourceIdSyncPolicy: clientMock.getPolicy,
      getKnowledgeSpacesByIdSourceWorkflowsByRunId: clientMock.getWorkflow,
    },
  },
  consoleQuery: {
    knowledgeFs: {
      getKnowledgeSpacesByIdSources: {
        key: vi.fn(() => ['knowledge-sources']),
      },
      getKnowledgeSpacesByIdSourcesBySourceIdSyncPolicy: {
        queryOptions: policyQueryOptionsMock,
      },
      postKnowledgeSpacesByIdSourceWorkflowsByRunIdSelection: {
        mutationOptions: vi.fn(() => ({
          mutationFn: (input: unknown) => clientMock.selectPages(input),
        })),
      },
      putKnowledgeSpacesByIdSourcesBySourceIdSyncPolicy: {
        mutationOptions: vi.fn(() => ({
          mutationFn: (input: unknown) => clientMock.updatePolicy(input),
        })),
      },
    },
  },
}))

type PreviewPage = GetKnowledgeSpacesByIdSourceWorkflowsByRunIdPagesResponse['items'][number]

const source: Source = {
  connectionId: 'connection-1',
  createdAt: '2026-07-20T10:00:00Z',
  id: 'source-1',
  knowledgeSpaceId: 'space-1',
  metadata: {},
  name: 'Dify docs',
  status: 'disabled',
  type: 'web',
  updatedAt: '2026-07-20T10:00:00Z',
  uri: 'https://docs.dify.ai/',
  version: 3,
}

const run: SourceWorkflowRun = {
  checkpoint: 'crawl',
  createdAt: '2026-07-20T10:00:00Z',
  executionAttempts: 1,
  id: 'run-1',
  knowledgeSpaceId: 'space-1',
  kind: 'crawl-preview',
  maxExecutionAttempts: 3,
  progressCompleted: 3,
  progressFailed: 1,
  progressSkipped: 0,
  progressTotal: 4,
  sourceId: source.id,
  state: 'succeeded',
  updatedAt: '2026-07-20T10:01:00Z',
}

const pages: PreviewPage[] = [
  {
    pageId: 'page-1',
    sourceUrl: 'https://docs.dify.ai/getting-started',
    title: 'Getting started',
  },
  {
    pageId: 'page-2',
    sourceUrl: 'https://docs.dify.ai/guides',
    title: 'Guides',
  },
  {
    pageId: 'off-domain',
    sourceUrl: 'https://github.com/langgenius/dify/edit/main/docs.md',
    title: 'Edit this page',
  },
]

const policy = (
  overrides: Partial<GetKnowledgeSpacesByIdSourcesBySourceIdSyncPolicyResponse> = {},
): GetKnowledgeSpacesByIdSourcesBySourceIdSyncPolicyResponse => ({
  createdAt: '2026-07-20T10:00:00Z',
  enabled: true,
  expectedSourceVersion: 3,
  id: 'policy-1',
  knowledgeSpaceId: 'space-1',
  mode: 'interval',
  revision: 2,
  sourceId: source.id,
  updatedAt: '2026-07-20T10:00:00Z',
  ...overrides,
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

function renderSelectionForm(
  onCancel = vi.fn(),
  workflowUncertain = false,
  discardRequested = () => false,
  previewPages = pages,
  initialSyncMode?: 'custom' | 'interval' | 'manual' | 'provider',
) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  const onSubmissionUncertainChange = vi.fn()
  const onRecrawl = vi.fn()
  const onWorkflowPending = vi.fn()
  const onWorkflowRun = vi.fn()
  const view = render(
    <QueryClientProvider client={queryClient}>
      <CrawlSelectionForm
        discardRequested={discardRequested}
        initialSyncMode={initialSyncMode}
        knowledgeSpaceId="space-1"
        onCancel={onCancel}
        onRecrawl={onRecrawl}
        onSubmissionUncertainChange={onSubmissionUncertainChange}
        onSubmitted={vi.fn()}
        onWorkflowPending={onWorkflowPending}
        onWorkflowRun={onWorkflowRun}
        pages={previewPages}
        rootUrl="https://docs.dify.ai/"
        run={run}
        source={source}
        workflowUncertain={workflowUncertain}
      />
    </QueryClientProvider>,
  )
  return {
    ...view,
    onRecrawl,
    onSubmissionUncertainChange,
    onWorkflowPending,
    onWorkflowRun,
  }
}

describe('CrawlSelectionForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clientMock.getPolicy.mockResolvedValue(policy())
    clientMock.getWorkflow.mockResolvedValue({ ...run, checkpoint: 'complete', state: 'completed' })
    clientMock.updatePolicy.mockResolvedValue(policy({ mode: 'manual', revision: 3 }))
    clientMock.selectPages.mockResolvedValue({ ...run, checkpoint: 'import', state: 'queued' })
  })

  it('uses singular and plural copy for the crawl summary', async () => {
    const instance = createInstance()
    await instance.init({
      ...getInitOptions(),
      defaultNS: 'dataset',
      lng: 'en-US',
      ns: ['dataset'],
      resources: { 'en-US': { dataset: datasetTranslations } },
    })
    const tDataset = instance.getFixedT('en-US', 'dataset')
    expect(tDataset(($) => $['newKnowledge.pagesCrawled'], { count: 1, host: 'example.com' })).toBe(
      '1 page crawled at example.com',
    )
    expect(tDataset(($) => $['newKnowledge.pagesCrawled'], { count: 2, host: 'example.com' })).toBe(
      '2 pages crawled at example.com',
    )
  })

  it('loads a missing initial sync policy without a global error notification', async () => {
    renderSelectionForm()
    await screen.findByRole('checkbox', { name: 'Getting started' })

    expect(policyQueryOptionsMock).toHaveBeenCalledWith(
      expect.objectContaining({ context: { silent: true } }),
    )
  })

  it('preserves the sync policy selected in the creation flow', async () => {
    renderSelectionForm(vi.fn(), false, () => false, pages, 'manual')

    expect(
      await screen.findByRole('combobox', { name: 'dataset.newKnowledge.syncPolicy' }),
    ).toHaveValue('manual')
  })

  it('selects only valid same-domain pages and exposes an indeterminate select-all state', async () => {
    const user = userEvent.setup()
    renderSelectionForm()

    await screen.findByRole('checkbox', { name: 'Getting started' })
    const addSource = screen.getByRole('button', { name: 'dataset.newKnowledge.addSource' })
    expect(addSource).toBeDisabled()
    const offDomainPage = screen.getByRole('checkbox', { name: 'Edit this page' })
    expect(offDomainPage).toHaveAttribute('aria-disabled', 'true')
    expect(offDomainPage).toHaveAccessibleDescription(
      'https://github.com/langgenius/dify/edit/main/docs.md dataset.newKnowledge.skippedOffDomain',
    )
    expect(screen.getByText('dataset.newKnowledge.skippedOffDomain')).toBeInTheDocument()
    expect(screen.getByText(/dataset\.newKnowledge\.skippedFailed/)).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: 'Getting started' }))
    expect(addSource).toBeEnabled()
    expect(
      screen.getByRole('checkbox', { name: 'dataset.newKnowledge.selectAll' }),
    ).toHaveAttribute('aria-checked', 'mixed')
    expect(
      screen.getByRole('checkbox', { name: 'dataset.newKnowledge.selectAll' }),
    ).toHaveAttribute('data-indeterminate')
    expect(screen.getByText('dataset.newKnowledge.pagesSelected:{"count":1}')).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: 'dataset.newKnowledge.selectAll' }))
    expect(screen.getByRole('checkbox', { name: 'Getting started' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Guides' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Edit this page' })).not.toBeChecked()
  })

  it('toggles selection from the visible checkbox labels', async () => {
    const user = userEvent.setup()
    renderSelectionForm()
    await screen.findByRole('checkbox', { name: 'Getting started' })

    await user.click(screen.getByText('Getting started'))
    expect(screen.getByRole('checkbox', { name: 'Getting started' })).toBeChecked()
    await user.click(screen.getByText('dataset.newKnowledge.selectAll'))

    expect(screen.getByRole('checkbox', { name: 'Getting started' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Guides' })).toBeChecked()
  })

  it('locks stale selections while keeping workflow reconciliation available', async () => {
    const onCancel = vi.fn()
    const user = userEvent.setup()
    const { onRecrawl } = renderSelectionForm(onCancel, true)
    await screen.findByRole('checkbox', { name: 'Getting started' })

    expect(screen.getByRole('checkbox', { name: 'Getting started' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByRole('combobox', { name: 'dataset.newKnowledge.syncPolicy' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.addSource' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.reCrawl' }))
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.cancelAddSource' }))

    expect(onRecrawl).toHaveBeenCalledOnce()
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('never submits more page IDs than the selection contract accepts', async () => {
    const longPageList: PreviewPage[] = Array.from({ length: 201 }, (_, index) => ({
      pageId: `page-${index + 1}`,
      sourceUrl: `https://docs.dify.ai/page-${index + 1}`,
      title: `Page ${index + 1}`,
    }))
    const user = userEvent.setup()
    renderSelectionForm(vi.fn(), false, () => false, longPageList)
    await user.click(
      await screen.findByRole('checkbox', { name: 'dataset.newKnowledge.selectAll' }),
    )

    const overflowPage = screen.getByRole('checkbox', { name: 'Page 201' })
    expect(overflowPage).toHaveAttribute('aria-disabled', 'true')
    expect(overflowPage).toHaveAccessibleDescription(
      'https://docs.dify.ai/page-201 dataset.newKnowledge.maxPages: 200',
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addSource' }))

    await waitFor(() => expect(clientMock.selectPages).toHaveBeenCalledOnce())
    expect(clientMock.selectPages.mock.calls[0]?.[0].body.pageIds).toHaveLength(200)
  })

  it('validates a custom interval and submits policy plus selection exactly once', async () => {
    const selectionRequest = deferred<SourceWorkflowRun>()
    clientMock.selectPages.mockReturnValue(selectionRequest.promise)
    const user = userEvent.setup()
    renderSelectionForm()

    await user.click(await screen.findByRole('checkbox', { name: 'Getting started' }))
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'dataset.newKnowledge.syncPolicy' }),
      'custom',
    )
    const interval = screen.getByRole('spinbutton', {
      name: 'dataset.newKnowledge.customIntervalHours',
    })
    await user.clear(interval)
    await user.type(interval, '0')
    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.addSource' })).toBeDisabled()
    expect(interval).toHaveAccessibleDescription('dataset.newKnowledge.customIntervalInvalid')
    await user.clear(interval)
    await user.type(interval, '6')

    const addSource = screen.getByRole('button', { name: 'dataset.newKnowledge.addSource' })
    await user.dblClick(addSource)

    await waitFor(() => expect(clientMock.updatePolicy).toHaveBeenCalledOnce())
    expect(clientMock.updatePolicy).toHaveBeenCalledWith({
      body: {
        customIntervalSeconds: 21600,
        enabled: true,
        expectedRevision: 2,
        expectedSourceVersion: 3,
        mode: 'custom',
      },
      params: { id: 'space-1', sourceId: 'source-1' },
    })
    expect(clientMock.selectPages).toHaveBeenCalledOnce()
    expect(clientMock.selectPages).toHaveBeenCalledWith({
      body: { pageIds: ['page-1'] },
      headers: { 'Idempotency-Key': expect.any(String) },
      params: { id: 'space-1', runId: 'run-1' },
    })

    selectionRequest.resolve({ ...run, checkpoint: 'import', state: 'queued' })
    await waitFor(() => expect(clientMock.getWorkflow).toHaveBeenCalledOnce())
    await waitFor(() =>
      expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['knowledge-sources'],
      }),
    )
    expect(routerMock.push).toHaveBeenCalledWith('/datasets/new/space-1/sources')
  })

  it('tracks policy updates and stops before selection when discard is requested', async () => {
    const policyRequest = deferred<GetKnowledgeSpacesByIdSourcesBySourceIdSyncPolicyResponse>()
    clientMock.updatePolicy.mockReturnValue(policyRequest.promise)
    let discardRequested = false
    const user = userEvent.setup()
    const { onWorkflowPending } = renderSelectionForm(vi.fn(), false, () => discardRequested)
    await user.click(await screen.findByRole('checkbox', { name: 'Getting started' }))
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'dataset.newKnowledge.syncPolicy' }),
      'manual',
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addSource' }))

    expect(onWorkflowPending).toHaveBeenCalledOnce()
    expect(clientMock.selectPages).not.toHaveBeenCalled()
    discardRequested = true
    await act(async () =>
      policyRequest.resolve(policy({ enabled: false, mode: 'manual', revision: 3 })),
    )
    await expect(onWorkflowPending.mock.calls[0]?.[0]).resolves.toBeUndefined()
    expect(clientMock.selectPages).not.toHaveBeenCalled()
  })

  it('releases a pending import for cancellation as soon as the current poll returns', async () => {
    const workflowRequest = deferred<SourceWorkflowRun>()
    clientMock.getWorkflow.mockReturnValue(workflowRequest.promise)
    let discardRequested = false
    const user = userEvent.setup()
    const { onWorkflowPending } = renderSelectionForm(vi.fn(), false, () => discardRequested)
    await user.click(await screen.findByRole('checkbox', { name: 'Getting started' }))
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addSource' }))

    await waitFor(() => expect(clientMock.getWorkflow).toHaveBeenCalledOnce())
    expect(onWorkflowPending).toHaveBeenCalledOnce()
    discardRequested = true
    const importRun = { ...run, checkpoint: 'import', state: 'running' }
    await act(async () => workflowRequest.resolve(importRun))

    await expect(onWorkflowPending.mock.calls[0]?.[0]).resolves.toEqual(importRun)
    expect(clientMock.getWorkflow).toHaveBeenCalledOnce()
    expect(queryClientMock.invalidateQueries).not.toHaveBeenCalled()
    expect(routerMock.push).not.toHaveBeenCalled()
  })

  it.each([
    { enabled: true, initialMode: 'interval', mode: 'provider' },
    { enabled: false, initialMode: 'interval', mode: 'manual' },
    { enabled: true, initialMode: 'manual', mode: 'interval' },
  ] as const)(
    'submits the $mode sync policy using the KnowledgeFS contract',
    async ({ enabled, initialMode, mode }) => {
      clientMock.getPolicy.mockResolvedValue(
        policy({ enabled: initialMode !== 'manual', mode: initialMode }),
      )
      clientMock.updatePolicy.mockResolvedValue(policy({ enabled, mode, revision: 3 }))
      const user = userEvent.setup()
      renderSelectionForm()

      await user.click(await screen.findByRole('checkbox', { name: 'Getting started' }))
      await user.selectOptions(
        screen.getByRole('combobox', { name: 'dataset.newKnowledge.syncPolicy' }),
        mode,
      )
      await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addSource' }))

      await waitFor(() => expect(clientMock.updatePolicy).toHaveBeenCalledOnce())
      expect(clientMock.updatePolicy).toHaveBeenCalledWith({
        body: {
          enabled,
          expectedRevision: 2,
          expectedSourceVersion: 3,
          mode,
        },
        params: { id: 'space-1', sourceId: 'source-1' },
      })
      expect(clientMock.selectPages).toHaveBeenCalledOnce()
    },
  )

  it('reconciles a lost sync-policy response before importing the selected pages', async () => {
    clientMock.getPolicy
      .mockReset()
      .mockResolvedValueOnce(policy())
      .mockResolvedValueOnce(policy({ enabled: false, mode: 'manual', revision: 3 }))
    clientMock.updatePolicy.mockRejectedValue(new Error('response lost'))
    const user = userEvent.setup()
    renderSelectionForm()

    await user.click(await screen.findByRole('checkbox', { name: 'Getting started' }))
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'dataset.newKnowledge.syncPolicy' }),
      'manual',
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addSource' }))

    await waitFor(() => expect(clientMock.selectPages).toHaveBeenCalledOnce())
    expect(clientMock.getPolicy).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('allows discard when only the sync-policy outcome is uncertain', async () => {
    clientMock.getPolicy
      .mockReset()
      .mockResolvedValueOnce(policy())
      .mockRejectedValueOnce(new Error('reconciliation unavailable'))
    clientMock.updatePolicy.mockRejectedValue(new Error('response lost'))
    const onCancel = vi.fn()
    const user = userEvent.setup()
    const { onSubmissionUncertainChange } = renderSelectionForm(onCancel)
    await user.click(await screen.findByRole('checkbox', { name: 'Getting started' }))
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'dataset.newKnowledge.syncPolicy' }),
      'manual',
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addSource' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'dataset.newKnowledge.addSourceFailed',
    )
    expect(onSubmissionUncertainChange).not.toHaveBeenCalledWith(true)
    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.addSource' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.cancelAddSource' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('uses the latest concurrency tokens after a conflicting sync-policy update', async () => {
    clientMock.getPolicy
      .mockReset()
      .mockResolvedValueOnce(policy())
      .mockResolvedValueOnce(
        policy({
          expectedSourceVersion: 4,
          mode: 'provider',
          revision: 3,
        }),
      )
    clientMock.updatePolicy
      .mockRejectedValueOnce(Object.assign(new Error('conflict'), { status: 409 }))
      .mockResolvedValueOnce(policy({ enabled: false, mode: 'manual', revision: 4 }))
    const user = userEvent.setup()
    renderSelectionForm()

    await user.click(await screen.findByRole('checkbox', { name: 'Getting started' }))
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'dataset.newKnowledge.syncPolicy' }),
      'manual',
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addSource' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'dataset.newKnowledge.addSourceFailed',
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addSource' }))

    await waitFor(() => expect(clientMock.updatePolicy).toHaveBeenCalledTimes(2))
    expect(clientMock.updatePolicy.mock.calls[1]?.[0]).toEqual({
      body: {
        enabled: false,
        expectedRevision: 3,
        expectedSourceVersion: 4,
        mode: 'manual',
      },
      params: { id: 'space-1', sourceId: 'source-1' },
    })
    expect(clientMock.selectPages).toHaveBeenCalledOnce()
  })

  it('recovers when the initial sync policy cannot load', async () => {
    clientMock.getPolicy
      .mockReset()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(policy())
    const user = userEvent.setup()
    renderSelectionForm()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'dataset.newKnowledge.syncPolicyLoadFailed',
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.retrySyncPolicy' }))

    await screen.findByRole('checkbox', { name: 'Getting started' })
    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.addSource' })).toBeDisabled()
  })

  it('creates the initial provider policy when a provisional source has no policy yet', async () => {
    clientMock.getPolicy.mockRejectedValue(
      Object.assign(new Error('policy not found'), { status: 404 }),
    )
    clientMock.updatePolicy.mockResolvedValue(policy({ mode: 'provider', revision: 1 }))
    const user = userEvent.setup()
    renderSelectionForm()

    await user.click(await screen.findByRole('checkbox', { name: 'Getting started' }))
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addSource' }))

    await waitFor(() => expect(clientMock.updatePolicy).toHaveBeenCalledOnce())
    expect(clientMock.updatePolicy).toHaveBeenCalledWith({
      body: {
        enabled: true,
        expectedRevision: 0,
        expectedSourceVersion: 3,
        mode: 'provider',
      },
      params: { id: 'space-1', sourceId: 'source-1' },
    })
    expect(clientMock.selectPages).toHaveBeenCalledOnce()
  })

  it('keeps Cancel available when the sync policy cannot load', async () => {
    clientMock.getPolicy.mockRejectedValue(new Error('temporary failure'))
    const onCancel = vi.fn()
    const user = userEvent.setup()
    renderSelectionForm(onCancel)

    await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.addSource' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.cancelAddSource' }))

    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('keeps Cancel available while the sync policy is loading', async () => {
    const policyRequest = deferred<GetKnowledgeSpacesByIdSourcesBySourceIdSyncPolicyResponse>()
    clientMock.getPolicy.mockReturnValue(policyRequest.promise)
    const onCancel = vi.fn()
    const user = userEvent.setup()
    renderSelectionForm(onCancel)

    expect(
      screen.getByRole('status', { name: 'dataset.newKnowledge.loadingSyncPolicy' }),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.addSource' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.cancelAddSource' }))

    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('uses a new selection idempotency key after a confirmed import failure', async () => {
    clientMock.getWorkflow.mockResolvedValueOnce({ ...run, checkpoint: 'import', state: 'failed' })
    const user = userEvent.setup()
    renderSelectionForm()

    await user.click(await screen.findByRole('checkbox', { name: 'Getting started' }))
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addSource' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'dataset.newKnowledge.addSourceFailed',
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addSource' }))

    await waitFor(() => expect(clientMock.selectPages).toHaveBeenCalledTimes(2))
    expect(clientMock.selectPages.mock.calls[0]?.[0].headers['Idempotency-Key']).not.toBe(
      clientMock.selectPages.mock.calls[1]?.[0].headers['Idempotency-Key'],
    )
  })

  it('reuses the selection idempotency key after a lost response without rewriting policy', async () => {
    clientMock.getPolicy.mockResolvedValue(policy({ enabled: false, mode: 'manual' }))
    clientMock.selectPages
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce({ ...run, checkpoint: 'import', state: 'queued' })
    const user = userEvent.setup()
    const { onSubmissionUncertainChange, onWorkflowPending, onWorkflowRun } = renderSelectionForm()

    await user.click(await screen.findByRole('checkbox', { name: 'Getting started' }))
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'dataset.newKnowledge.syncPolicy' }),
      'manual',
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addSource' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'dataset.newKnowledge.addSourceFailed',
    )
    expect(onWorkflowPending).toHaveBeenCalledOnce()
    expect(onSubmissionUncertainChange).toHaveBeenLastCalledWith(true)
    expect(screen.getByRole('checkbox', { name: 'Guides' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByRole('combobox', { name: 'dataset.newKnowledge.syncPolicy' })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.cancelAddSource' }),
    ).toBeDisabled()
    await user.click(screen.getByText('Guides'))
    expect(screen.getByRole('checkbox', { name: 'Guides' })).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addSource' }))

    await waitFor(() => expect(clientMock.selectPages).toHaveBeenCalledTimes(2))
    expect(onWorkflowRun).toHaveBeenCalledWith(
      expect.objectContaining({ checkpoint: 'import', state: 'queued' }),
    )
    expect(clientMock.updatePolicy).not.toHaveBeenCalled()
    expect(clientMock.selectPages.mock.calls[0]?.[0].headers).toEqual(
      clientMock.selectPages.mock.calls[1]?.[0].headers,
    )
  })
})
