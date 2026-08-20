import type { Source, SourceWorkflowRun } from '../source-models'
import type { SyncPolicyValue } from '../sync-policy-field'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { getInitOptions } from '@/i18n-config/settings'
import datasetTranslations from '@/i18n/en-US/dataset.json'
import { render } from '@/test/console/render'
import { CrawlSelectionForm } from '../crawl-selection-form'

const clientMock = vi.hoisted(() => ({ asyncImport: vi.fn() }))
const routerMock = vi.hoisted(() => ({ push: vi.fn() }))
const queryClientMock = vi.hoisted(() => ({ invalidateQueries: vi.fn() }))
const settingsState = vi.hoisted(() => ({
  configurationState: 'active' as 'active' | 'setup-required',
}))

const workflowApiResponse = vi.hoisted(() => (workflow: SourceWorkflowRun) => ({
  canceled_at: workflow.canceledAt ?? null,
  checkpoint: workflow.checkpoint,
  completed_at: workflow.completedAt ?? null,
  created_at: workflow.createdAt,
  cursor: workflow.cursor ?? null,
  execution_attempts: workflow.executionAttempts,
  id: workflow.id,
  knowledge_space_id: workflow.knowledgeSpaceId,
  kind: workflow.kind,
  last_error_code: workflow.lastErrorCode ?? null,
  max_execution_attempts: workflow.maxExecutionAttempts,
  progress_completed: workflow.progressCompleted,
  progress_failed: workflow.progressFailed,
  progress_skipped: workflow.progressSkipped,
  progress_total: workflow.progressTotal ?? null,
  source_id: workflow.sourceId ?? null,
  state: workflow.state,
  updated_at: workflow.updatedAt,
}))

vi.mock('@/next/navigation', () => ({
  usePathname: () => '/datasets/new/space-1/sources/new/website',
  useRouter: () => routerMock,
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-query')>()
  return { ...original, useQueryClient: () => queryClientMock }
})

vi.mock('@/service/client', () => ({
  consoleClient: {
    knowledgeFs: {
      spaces: {
        byControlSpaceId: {
          sources: {
            bySourceId: {
              asyncImport: {
                post: async (input: unknown) =>
                  workflowApiResponse(await clientMock.asyncImport(input)),
              },
            },
          },
        },
      },
    },
  },
  consoleQuery: {
    knowledgeFs: {
      spaces: {
        byControlSpaceId: {
          settings: {
            get: {
              queryOptions: ({ input }: { input: unknown }) => ({
                queryFn: async () => ({
                  active_profile_available: settingsState.configurationState === 'active',
                  active_profile_revisions:
                    settingsState.configurationState === 'active'
                      ? { embedding: 1, retrieval: 1 }
                      : {},
                  capabilities: {
                    deep: settingsState.configurationState === 'active',
                    index: settingsState.configurationState === 'active',
                    ingest: settingsState.configurationState === 'active',
                    query: settingsState.configurationState === 'active',
                    research: settingsState.configurationState === 'active',
                    source_sync: settingsState.configurationState === 'active',
                  },
                  configuration_state: settingsState.configurationState,
                  embedding: null,
                  issues: [],
                  retrieval: null,
                  revision: 1,
                }),
                queryKey: ['knowledge-fs', 'settings', input],
              }),
            },
          },
          sources: {
            get: { key: vi.fn(() => ['knowledge-sources']) },
          },
        },
      },
    },
  },
}))

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

const pages = [
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

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

function renderSelectionForm({
  initialSelectedPageIds,
  initialSyncMode,
  onCancel = vi.fn(),
  syncPolicyValue,
  workflowUncertain = false,
}: {
  initialSelectedPageIds?: readonly string[]
  initialSyncMode?: 'custom' | 'interval' | 'manual' | 'provider'
  onCancel?: () => void
  syncPolicyValue?: SyncPolicyValue
  workflowUncertain?: boolean
} = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  const onInteractionLockChange = vi.fn()
  const onRecrawl = vi.fn()
  const onSubmissionUncertainChange = vi.fn()
  const onSubmitted = vi.fn()
  const onWorkflowPending = vi.fn()
  const onWorkflowRun = vi.fn()
  const view = render(
    <QueryClientProvider client={queryClient}>
      <CrawlSelectionForm
        discardRequested={() => false}
        initialSelectedPageIds={initialSelectedPageIds}
        initialSyncMode={initialSyncMode}
        knowledgeSpaceId="space-1"
        onCancel={onCancel}
        onInteractionLockChange={onInteractionLockChange}
        onRecrawl={onRecrawl}
        onSubmissionUncertainChange={onSubmissionUncertainChange}
        onSubmitted={onSubmitted}
        onWorkflowPending={onWorkflowPending}
        onWorkflowRun={onWorkflowRun}
        pages={pages}
        rootUrl="https://docs.dify.ai/"
        run={run}
        showSyncPolicyField={!syncPolicyValue}
        source={source}
        syncPolicyValue={syncPolicyValue}
        workflowUncertain={workflowUncertain}
      />
    </QueryClientProvider>,
  )
  return {
    ...view,
    onInteractionLockChange,
    onRecrawl,
    onSubmissionUncertainChange,
    onSubmitted,
    onWorkflowPending,
    onWorkflowRun,
  }
}

async function selectSyncPolicy(
  user: ReturnType<typeof userEvent.setup>,
  mode: 'custom' | 'interval' | 'manual' | 'provider',
) {
  const optionNames = {
    custom: 'dataset.newKnowledge.syncPolicyCustom',
    interval: 'dataset.newKnowledge.syncPolicyDaily',
    manual: 'dataset.newKnowledge.syncPolicyManual',
    provider: 'dataset.newKnowledge.syncPolicyProvider',
  }
  await user.click(screen.getByRole('combobox', { name: 'dataset.newKnowledge.syncPolicy' }))
  await user.click(screen.getByRole('option', { name: optionNames[mode] }))
}

describe('CrawlSelectionForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clientMock.asyncImport.mockResolvedValue({ ...run, checkpoint: 'import', state: 'queued' })
    settingsState.configurationState = 'active'
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

  it('prompts for model setup before submitting the import', async () => {
    const user = userEvent.setup()
    settingsState.configurationState = 'setup-required'
    renderSelectionForm()
    await user.click(screen.getByRole('checkbox', { name: 'Getting started' }))
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addSource' }))

    expect(clientMock.asyncImport).not.toHaveBeenCalled()
    await user.click(
      await screen.findByRole('button', { name: 'common.modelProvider.selector.configure' }),
    )
    expect(routerMock.push).toHaveBeenCalledWith(
      '/datasets/new/space-1/settings?returnTo=%2Fdatasets%2Fnew%2Fspace-1%2Fsources%2Fnew%2Fwebsite&capability=ingest',
    )
  })

  it('preserves the sync policy selected before crawl review', () => {
    renderSelectionForm({ initialSyncMode: 'manual' })
    expect(
      screen.getByRole('combobox', { name: 'dataset.newKnowledge.syncPolicy' }),
    ).toHaveTextContent('dataset.newKnowledge.syncPolicyManual')
  })

  it('selects only valid same-domain pages', async () => {
    const user = userEvent.setup()
    renderSelectionForm()
    const addSource = screen.getByRole('button', { name: 'dataset.newKnowledge.addSource' })
    expect(addSource).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Edit this page' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )

    await user.click(screen.getByRole('checkbox', { name: 'Getting started' }))
    expect(addSource).toBeEnabled()
    expect(
      screen.getByRole('checkbox', { name: 'dataset.newKnowledge.selectAll' }),
    ).toHaveAttribute('aria-checked', 'mixed')
    await user.click(screen.getByRole('checkbox', { name: 'dataset.newKnowledge.selectAll' }))
    expect(screen.getByRole('checkbox', { name: 'Guides' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Edit this page' })).not.toBeChecked()
  })

  it('keeps only valid initial selections', () => {
    renderSelectionForm({ initialSelectedPageIds: ['page-1', 'off-domain'] })
    expect(screen.getByRole('checkbox', { name: 'Getting started' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Edit this page' })).not.toBeChecked()
  })

  it('locks stale selections while keeping recrawl and cancel available', async () => {
    const onCancel = vi.fn()
    const user = userEvent.setup()
    const { onRecrawl } = renderSelectionForm({ onCancel, workflowUncertain: true })
    expect(screen.getByRole('checkbox', { name: 'Getting started' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.addSource' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.reCrawl' }))
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.cancelAddSource' }))
    expect(onRecrawl).toHaveBeenCalledOnce()
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('never submits more page IDs than the async import contract accepts', async () => {
    const longPageList = Array.from({ length: 201 }, (_, index) => ({
      pageId: `page-${index + 1}`,
      sourceUrl: `https://docs.dify.ai/page-${index + 1}`,
      title: `Page ${index + 1}`,
    }))
    const user = userEvent.setup()
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <CrawlSelectionForm
          discardRequested={() => false}
          knowledgeSpaceId="space-1"
          onCancel={vi.fn()}
          onRecrawl={vi.fn()}
          onSubmissionUncertainChange={vi.fn()}
          onSubmitted={vi.fn()}
          onWorkflowPending={vi.fn()}
          onWorkflowRun={vi.fn()}
          pages={longPageList}
          rootUrl="https://docs.dify.ai/"
          run={run}
          source={source}
        />
      </QueryClientProvider>,
    )
    await user.click(screen.getByRole('checkbox', { name: 'dataset.newKnowledge.selectAll' }))
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addSource' }))

    await waitFor(() => expect(clientMock.asyncImport).toHaveBeenCalledOnce())
    expect(clientMock.asyncImport.mock.calls[0]?.[0].body.pageIds).toHaveLength(200)
  })

  it('submits custom policy in one request and navigates on acceptance', async () => {
    const user = userEvent.setup()
    const { onSubmitted, onWorkflowRun } = renderSelectionForm()
    await user.click(screen.getByRole('checkbox', { name: 'Getting started' }))
    await selectSyncPolicy(user, 'custom')
    const dialog = await screen.findByRole('dialog', {
      name: 'dataset.newKnowledge.syncPolicyCustom',
    })
    const interval = within(dialog).getByRole('textbox', {
      name: 'dataset.newKnowledge.syncPolicyCustom dataset.newKnowledge.syncPolicyUnit.hours',
    })
    await user.clear(interval)
    await user.type(interval, '6')
    await user.click(
      within(dialog).getByRole('button', { name: 'dataset.newKnowledge.syncPolicyApply' }),
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addSource' }))

    await waitFor(() =>
      expect(routerMock.push).toHaveBeenCalledWith('/datasets/new/space-1/sources'),
    )
    expect(clientMock.asyncImport).toHaveBeenCalledWith({
      body: {
        kind: 'crawl-preview-selection',
        pageIds: ['page-1'],
        previewWorkflowId: 'run-1',
        syncPolicy: {
          customIntervalSeconds: 21600,
          enabled: true,
          mode: 'custom',
        },
      },
      headers: { 'Idempotency-Key': expect.any(String) },
      params: { control_space_id: 'space-1', source_id: 'source-1' },
    })
    expect(onWorkflowRun).toHaveBeenCalledWith(expect.objectContaining({ state: 'queued' }))
    expect(onSubmitted).toHaveBeenCalledOnce()
    expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['knowledge-sources'],
      refetchType: 'none',
    })
  })

  it.each([
    { enabled: true, mode: 'provider' },
    { enabled: false, mode: 'manual' },
    { enabled: true, mode: 'interval' },
  ] as const)('includes the $mode policy in the async import', async ({ enabled, mode }) => {
    const user = userEvent.setup()
    renderSelectionForm()
    await user.click(screen.getByRole('checkbox', { name: 'Getting started' }))
    await selectSyncPolicy(user, mode)
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addSource' }))

    await waitFor(() => expect(clientMock.asyncImport).toHaveBeenCalledOnce())
    expect(clientMock.asyncImport.mock.calls[0]?.[0].body.syncPolicy).toEqual({ enabled, mode })
  })

  it('keeps the form locked only until the async submission is accepted', async () => {
    const request = deferred<SourceWorkflowRun>()
    clientMock.asyncImport.mockReturnValue(request.promise)
    const user = userEvent.setup()
    const { onInteractionLockChange } = renderSelectionForm()
    await user.click(screen.getByRole('checkbox', { name: 'Getting started' }))
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addSource' }))

    await waitFor(() => expect(onInteractionLockChange).toHaveBeenLastCalledWith(true))
    request.resolve({ ...run, checkpoint: 'import', state: 'queued' })
    await waitFor(() => expect(onInteractionLockChange).toHaveBeenLastCalledWith(false))
  })

  it('reuses the idempotency key when an async import response is lost', async () => {
    clientMock.asyncImport
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce({ ...run, checkpoint: 'import', state: 'queued' })
    const user = userEvent.setup()
    const { onSubmissionUncertainChange } = renderSelectionForm()
    await user.click(screen.getByRole('checkbox', { name: 'Getting started' }))
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addSource' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'dataset.newKnowledge.addSourceFailed',
    )
    expect(onSubmissionUncertainChange).toHaveBeenLastCalledWith(true)
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addSource' }))

    await waitFor(() => expect(clientMock.asyncImport).toHaveBeenCalledTimes(2))
    expect(clientMock.asyncImport.mock.calls[0]?.[0].headers).toEqual(
      clientMock.asyncImport.mock.calls[1]?.[0].headers,
    )
    expect(routerMock.push).toHaveBeenCalledWith('/datasets/new/space-1/sources')
  })
})
