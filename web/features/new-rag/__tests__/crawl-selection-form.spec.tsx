import type {
  GetKnowledgeSpacesByIdSourcesBySourceIdSyncPolicyResponse,
  GetKnowledgeSpacesByIdSourceWorkflowsByRunIdPagesResponse,
  Source,
  SourceWorkflowRun,
} from '@dify/contracts/knowledge-fs/types.gen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/console/render'
import { CrawlSelectionForm } from '../crawl-selection-form'

const clientMock = vi.hoisted(() => ({
  getPolicy: vi.fn(),
  selectPages: vi.fn(),
  updatePolicy: vi.fn(),
}))

const routerMock = vi.hoisted(() => ({ push: vi.fn() }))
const queryClientMock = vi.hoisted(() => ({ invalidateQueries: vi.fn() }))

vi.mock('@/next/navigation', () => ({ useRouter: () => routerMock }))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-query')>()
  return { ...original, useQueryClient: () => queryClientMock }
})

vi.mock('@/service/client', () => ({
  consoleClient: {
    knowledgeFs: {
      getKnowledgeSpacesByIdSourcesBySourceIdSyncPolicy: clientMock.getPolicy,
    },
  },
  consoleQuery: {
    knowledgeFs: {
      getKnowledgeSpacesByIdSources: {
        key: vi.fn(() => ['knowledge-sources']),
      },
      getKnowledgeSpacesByIdSourcesBySourceIdSyncPolicy: {
        queryOptions: vi.fn(({ input }) => ({
          queryFn: () => clientMock.getPolicy(input),
          queryKey: ['sync-policy', input.params.sourceId],
          retry: false,
        })),
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

function renderSelectionForm() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <CrawlSelectionForm
        knowledgeSpaceId="space-1"
        onCancel={vi.fn()}
        onRecrawl={vi.fn()}
        onSubmitted={vi.fn()}
        pages={pages}
        rootUrl="https://docs.dify.ai/"
        run={run}
        source={source}
      />
    </QueryClientProvider>,
  )
}

describe('CrawlSelectionForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clientMock.getPolicy.mockResolvedValue(policy())
    clientMock.updatePolicy.mockResolvedValue(policy({ mode: 'manual', revision: 3 }))
    clientMock.selectPages.mockResolvedValue({ ...run, checkpoint: 'import', state: 'queued' })
  })

  it('selects only valid same-domain pages and exposes an indeterminate select-all state', async () => {
    const user = userEvent.setup()
    renderSelectionForm()

    const addSource = await screen.findByRole('button', {
      name: 'dataset.newKnowledge.addSource',
    })
    expect(addSource).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Edit this page' })).toHaveAttribute(
      'aria-disabled',
      'true',
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
    await waitFor(() =>
      expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['knowledge-sources'],
      }),
    )
    expect(routerMock.push).toHaveBeenCalledWith('/datasets/new/space-1/sources')
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

    expect(
      await screen.findByRole('button', { name: 'dataset.newKnowledge.addSource' }),
    ).toBeDisabled()
  })

  it('reuses the selection idempotency key after a lost response without rewriting policy', async () => {
    clientMock.getPolicy.mockResolvedValue(policy({ enabled: false, mode: 'manual' }))
    clientMock.selectPages
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce({ ...run, checkpoint: 'import', state: 'queued' })
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

    await waitFor(() => expect(clientMock.selectPages).toHaveBeenCalledTimes(2))
    expect(clientMock.updatePolicy).not.toHaveBeenCalled()
    expect(clientMock.selectPages.mock.calls[0]?.[0].headers).toEqual(
      clientMock.selectPages.mock.calls[1]?.[0].headers,
    )
  })
})
