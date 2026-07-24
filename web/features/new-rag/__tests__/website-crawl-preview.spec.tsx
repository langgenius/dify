import type { Source, SourceWorkflowRun } from '@dify/contracts/knowledge-fs/types.gen'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/console/render'
import { WebsiteCrawlPreview } from '../website-crawl-preview'

const clientMock = vi.hoisted(() => ({
  cancel: vi.fn(),
  createSource: vi.fn(),
  getPages: vi.fn(),
  getRun: vi.fn(),
  listSources: vi.fn(),
  retry: vi.fn(),
  startPreview: vi.fn(),
}))

const routerMock = vi.hoisted(() => ({ push: vi.fn() }))

vi.mock('@/next/navigation', () => ({ useRouter: () => routerMock }))

vi.mock('../crawl-selection-form', () => ({
  CrawlSelectionForm: ({
    busy,
    onCancel,
    onRecrawl,
    pages,
  }: {
    busy?: boolean
    onCancel: () => void
    onRecrawl: () => void
    pages: Array<{ pageId: string; title?: string }>
  }) => (
    <div>
      <p role="status">dataset.newKnowledge.pagesCrawled</p>
      {pages.map((page) => (
        <label key={page.pageId}>
          <input type="checkbox" aria-label={page.title} />
          {page.title}
        </label>
      ))}
      <button type="button" aria-disabled={busy} disabled={busy} onClick={onRecrawl}>
        dataset.newKnowledge.reCrawl
      </button>
      <button type="button" onClick={onCancel}>
        dataset.newKnowledge.cancelAddSource
      </button>
    </div>
  ),
}))

vi.mock('@/service/client', () => ({
  consoleClient: {
    knowledgeFs: {
      getKnowledgeSpacesByIdSources: clientMock.listSources,
      getKnowledgeSpacesByIdSourceWorkflowsByRunId: clientMock.getRun,
      getKnowledgeSpacesByIdSourceWorkflowsByRunIdPages: clientMock.getPages,
      postKnowledgeSpacesByIdSources: clientMock.createSource,
      postKnowledgeSpacesByIdSourcesBySourceIdCrawlPreview: clientMock.startPreview,
      postKnowledgeSpacesByIdSourceWorkflowsByRunIdCancel: clientMock.cancel,
      postKnowledgeSpacesByIdSourceWorkflowsByRunIdRetry: clientMock.retry,
    },
  },
}))

const connection = {
  id: 'connection-1',
  providerId: 'plugin-daemon-website',
}

const source = (metadata: Source['metadata'] = {}): Source => ({
  connectionId: connection.id,
  createdAt: '2026-07-20T10:00:00Z',
  id: 'source-1',
  knowledgeSpaceId: 'space-1',
  metadata,
  name: 'Dify docs',
  status: 'disabled',
  type: 'web',
  updatedAt: '2026-07-20T10:00:00Z',
  uri: 'https://docs.dify.ai/',
})

const run = (state: string, overrides: Partial<SourceWorkflowRun> = {}): SourceWorkflowRun => ({
  checkpoint: 'crawl',
  createdAt: '2026-07-20T10:00:00Z',
  executionAttempts: 1,
  id: 'run-1',
  knowledgeSpaceId: 'space-1',
  kind: 'crawl-preview',
  maxExecutionAttempts: 3,
  progressCompleted: 0,
  progressFailed: 0,
  progressSkipped: 0,
  sourceId: 'source-1',
  state,
  updatedAt: '2026-07-20T10:00:00Z',
  ...overrides,
})

async function fillValidForm() {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText(/^dataset\.newKnowledge\.rootUrl/), 'https://docs.dify.ai')
  await user.type(screen.getByLabelText(/^dataset\.newKnowledge\.sourceName/), 'Dify docs')
  return user
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

describe('WebsiteCrawlPreview', () => {
  beforeEach(() => {
    vi.useRealTimers()
    for (const mock of Object.values(clientMock)) mock.mockReset()
    clientMock.createSource.mockResolvedValue(source())
    clientMock.startPreview.mockResolvedValue(run('running'))
    clientMock.getRun.mockResolvedValue(
      run('preview_ready', {
        checkpoint: 'preview-staged',
        progressCompleted: 1,
        progressTotal: 1,
      }),
    )
    clientMock.getPages.mockResolvedValue({
      items: [
        {
          pageId: 'page-1',
          sourceUrl: 'https://docs.dify.ai/getting-started',
          title: 'Getting started',
        },
      ],
    })
    clientMock.listSources.mockResolvedValue({ items: [] })
    routerMock.push.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('validates the URL and starts a real crawl preview with a provisional source', async () => {
    const user = userEvent.setup()
    render(<WebsiteCrawlPreview connection={connection} knowledgeSpaceId="space-1" />)

    expect(screen.getByRole('status')).toHaveTextContent(
      'dataset.newKnowledge.providerConnected:{"provider":"Firecrawl"}',
    )
    const start = screen.getByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' })
    expect(start).toBeDisabled()
    await user.type(screen.getByLabelText(/^dataset\.newKnowledge\.rootUrl/), 'ftp://docs.dify.ai')
    await user.tab()
    expect(screen.getByLabelText(/^dataset\.newKnowledge\.rootUrl/)).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    await user.clear(screen.getByLabelText(/^dataset\.newKnowledge\.rootUrl/))
    await user.type(
      screen.getByLabelText(/^dataset\.newKnowledge\.rootUrl/),
      'https://docs.dify.ai',
    )
    await user.type(screen.getByLabelText(/^dataset\.newKnowledge\.sourceName/), 'Dify docs')
    await user.click(start)

    await waitFor(() => expect(clientMock.startPreview).toHaveBeenCalledOnce())
    expect(clientMock.createSource).toHaveBeenCalledWith({
      body: {
        connectionId: 'connection-1',
        metadata: {
          clientRequestId: expect.any(String),
          crawlOptions: { includeSubpages: true, limit: 100 },
          preview: true,
          providerId: 'plugin-daemon-website',
        },
        name: 'Dify docs',
        status: 'disabled',
        type: 'web',
        uri: 'https://docs.dify.ai/',
      },
      params: { id: 'space-1' },
    })
    expect(clientMock.startPreview).toHaveBeenCalledWith({
      headers: { 'Idempotency-Key': expect.any(String) },
      params: { id: 'space-1', sourceId: 'source-1' },
    })
    expect(await screen.findByText('Getting started')).toBeInTheDocument()
    expect(screen.getByText(/^dataset\.newKnowledge\.pagesCrawled/)).toHaveAttribute(
      'role',
      'status',
    )
    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.reCrawl' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' }),
    ).not.toBeInTheDocument()
  })

  it('submits the crawl form with Enter and enforces the source name contract limit', async () => {
    render(<WebsiteCrawlPreview connection={connection} knowledgeSpaceId="space-1" />)
    const user = await fillValidForm()
    const name = screen.getByLabelText(/^dataset\.newKnowledge\.sourceName/)
    expect(name).toHaveAttribute('maxlength', '200')
    await user.clear(name)
    await user.type(name, 'x'.repeat(201))
    expect(name).toHaveValue('x'.repeat(200))
    await user.type(name, '{enter}')

    await waitFor(() => expect(clientMock.startPreview).toHaveBeenCalledOnce())
  })

  it('caps crawl previews at the selection contract limit', async () => {
    render(<WebsiteCrawlPreview connection={connection} knowledgeSpaceId="space-1" />)
    const user = await fillValidForm()
    await user.click(screen.getByRole('button', { name: /^dataset\.newKnowledge\.crawlOptions/ }))
    const pageLimit = screen.getByRole('spinbutton', { name: 'dataset.newKnowledge.maxPages' })
    expect(pageLimit).toHaveAttribute('max', '200')
    await user.clear(pageLimit)
    await user.type(pageLimit, '1000')
    expect(pageLimit).toHaveValue(200)
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' }))

    await waitFor(() => expect(clientMock.createSource).toHaveBeenCalledOnce())
    expect(clientMock.createSource.mock.calls[0]?.[0].body.metadata.crawlOptions.limit).toBe(200)
  })

  it('preserves a replacement crawl page limit after clearing the input', async () => {
    render(<WebsiteCrawlPreview connection={connection} knowledgeSpaceId="space-1" />)
    const user = await fillValidForm()
    await user.click(screen.getByRole('button', { name: /^dataset\.newKnowledge\.crawlOptions/ }))
    const pageLimit = screen.getByRole('spinbutton', { name: 'dataset.newKnowledge.maxPages' })
    await user.clear(pageLimit)
    await user.type(pageLimit, '50')
    expect(pageLimit).toHaveValue(50)
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' }))

    await waitFor(() => expect(clientMock.createSource).toHaveBeenCalledOnce())
    expect(clientMock.createSource.mock.calls[0]?.[0].body.metadata.crawlOptions.limit).toBe(50)
  })

  it('confirms dirty cancellation and protects an unfinished draft from page unload', async () => {
    const user = userEvent.setup()
    render(<WebsiteCrawlPreview connection={connection} knowledgeSpaceId="space-1" />)

    await user.type(
      screen.getByLabelText(/^dataset\.newKnowledge\.rootUrl/),
      'https://docs.dify.ai',
    )
    const unload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(true)

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.cancelAddSource' }))
    expect(
      screen.getByRole('alertdialog', { name: 'dataset.newKnowledge.discardSourceChanges' }),
    ).toBeInTheDocument()
    expect(routerMock.push).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.keepEditing' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.cancelAddSource' }))
    await user.click(
      screen.getByRole('button', { name: 'dataset.newKnowledge.discardSourceChangesConfirm' }),
    )
    await waitFor(() =>
      expect(routerMock.push).toHaveBeenCalledWith('/datasets/new/space-1/sources'),
    )
  })

  it('cancels an active preview before discarding its provisional source', async () => {
    clientMock.getRun.mockReturnValue(new Promise<SourceWorkflowRun>(() => {}))
    clientMock.cancel.mockResolvedValue(run('canceled'))
    render(<WebsiteCrawlPreview connection={connection} knowledgeSpaceId="space-1" />)
    const user = await fillValidForm()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' }))
    await waitFor(() => expect(clientMock.startPreview).toHaveBeenCalledOnce())

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.cancelAddSource' }))
    await user.click(
      screen.getByRole('button', { name: 'dataset.newKnowledge.discardSourceChangesConfirm' }),
    )

    await waitFor(() => expect(clientMock.cancel).toHaveBeenCalledOnce())
    expect(clientMock.cancel).toHaveBeenCalledWith({
      body: { reason: 'user_requested' },
      params: { id: 'space-1', runId: 'run-1' },
    })
    await waitFor(() =>
      expect(routerMock.push).toHaveBeenCalledWith('/datasets/new/space-1/sources'),
    )
  })

  it('cancels a crawl that finishes starting after discard was confirmed', async () => {
    const startRequest = deferred<SourceWorkflowRun>()
    clientMock.startPreview.mockReturnValue(startRequest.promise)
    clientMock.cancel.mockResolvedValue(run('canceled'))
    render(<WebsiteCrawlPreview connection={connection} knowledgeSpaceId="space-1" />)
    const user = await fillValidForm()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' }))
    await waitFor(() => expect(clientMock.startPreview).toHaveBeenCalledOnce())

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.cancelAddSource' }))
    await user.click(
      screen.getByRole('button', { name: 'dataset.newKnowledge.discardSourceChangesConfirm' }),
    )
    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.keepEditing' })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.discardSourceChangesConfirm' }),
    ).toHaveAttribute('aria-disabled', 'true')

    startRequest.resolve(run('running'))

    await waitFor(() => expect(clientMock.cancel).toHaveBeenCalledOnce())
    await waitFor(() =>
      expect(routerMock.push).toHaveBeenCalledWith('/datasets/new/space-1/sources'),
    )
  })

  it('reconciles a response-lost start before discarding its workflow', async () => {
    clientMock.startPreview
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce(run('running'))
    clientMock.cancel.mockResolvedValue(run('canceled'))
    render(<WebsiteCrawlPreview connection={connection} knowledgeSpaceId="space-1" />)
    const user = await fillValidForm()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' }))
    await screen.findByRole('alert')

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.cancelAddSource' }))
    await user.click(
      screen.getByRole('button', { name: 'dataset.newKnowledge.discardSourceChangesConfirm' }),
    )

    await waitFor(() => expect(clientMock.startPreview).toHaveBeenCalledTimes(2))
    expect(clientMock.startPreview.mock.calls[0]?.[0].headers).toEqual(
      clientMock.startPreview.mock.calls[1]?.[0].headers,
    )
    await waitFor(() => expect(clientMock.cancel).toHaveBeenCalledOnce())
    await waitFor(() =>
      expect(routerMock.push).toHaveBeenCalledWith('/datasets/new/space-1/sources'),
    )
  })

  it('does not start a crawl when discard is confirmed during source creation', async () => {
    const sourceRequest = deferred<Source>()
    clientMock.createSource.mockReturnValue(sourceRequest.promise)
    render(<WebsiteCrawlPreview connection={connection} knowledgeSpaceId="space-1" />)
    const user = await fillValidForm()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' }))
    await waitFor(() => expect(clientMock.createSource).toHaveBeenCalledOnce())

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.cancelAddSource' }))
    await user.click(
      screen.getByRole('button', { name: 'dataset.newKnowledge.discardSourceChangesConfirm' }),
    )
    sourceRequest.resolve(source())

    await waitFor(() =>
      expect(routerMock.push).toHaveBeenCalledWith('/datasets/new/space-1/sources'),
    )
    expect(clientMock.startPreview).not.toHaveBeenCalled()
    expect(clientMock.cancel).not.toHaveBeenCalled()
  })

  it('cancels a retry that returns after navigation discard was confirmed', async () => {
    const retryRequest = deferred<SourceWorkflowRun>()
    clientMock.retry.mockReturnValue(retryRequest.promise)
    clientMock.cancel.mockResolvedValue(run('canceled'))
    render(
      <>
        <a href="/datasets/new/space-1/documents">Documents navigation</a>
        <WebsiteCrawlPreview connection={connection} knowledgeSpaceId="space-1" />
      </>,
    )
    const user = await fillValidForm()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' }))
    await screen.findByText('Getting started')
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.reCrawl' }))
    await waitFor(() => expect(clientMock.retry).toHaveBeenCalledOnce())

    await user.click(screen.getByRole('link', { name: 'Documents navigation' }))
    await user.click(
      screen.getByRole('button', { name: 'dataset.newKnowledge.discardSourceChangesConfirm' }),
    )
    retryRequest.resolve(run('running'))

    await waitFor(() => expect(clientMock.cancel).toHaveBeenCalledOnce())
    await waitFor(() =>
      expect(routerMock.push).toHaveBeenCalledWith('/datasets/new/space-1/documents'),
    )
  })

  it('reconciles a response-lost retry before leaving the preview', async () => {
    const previousRun = run('succeeded', { progressCompleted: 1, progressTotal: 1 })
    clientMock.getRun
      .mockResolvedValueOnce(previousRun)
      .mockResolvedValueOnce(previousRun)
      .mockResolvedValueOnce(run('running', { executionAttempts: 2 }))
    clientMock.retry.mockRejectedValue(new Error('response lost'))
    clientMock.cancel.mockResolvedValue(run('canceled', { executionAttempts: 2 }))
    render(
      <>
        <a href="/datasets/new/space-1/documents">Documents navigation</a>
        <WebsiteCrawlPreview connection={connection} knowledgeSpaceId="space-1" />
      </>,
    )
    const user = await fillValidForm()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' }))
    await screen.findByText('Getting started')
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.reCrawl' }))
    await waitFor(() => expect(clientMock.getRun).toHaveBeenCalledTimes(2))

    await user.click(screen.getByRole('link', { name: 'Documents navigation' }))
    await user.click(
      screen.getByRole('button', { name: 'dataset.newKnowledge.discardSourceChangesConfirm' }),
    )

    await waitFor(() => expect(clientMock.getRun).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(clientMock.cancel).toHaveBeenCalledOnce())
    await waitFor(() =>
      expect(routerMock.push).toHaveBeenCalledWith('/datasets/new/space-1/documents'),
    )
  })

  it('keeps the started run available when discard cancellation must be retried', async () => {
    clientMock.getRun.mockReturnValue(new Promise<SourceWorkflowRun>(() => {}))
    clientMock.cancel
      .mockRejectedValueOnce(Object.assign(new Error('conflict'), { status: 409 }))
      .mockResolvedValueOnce(run('canceled'))
    render(<WebsiteCrawlPreview connection={connection} knowledgeSpaceId="space-1" />)
    const user = await fillValidForm()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' }))
    await waitFor(() => expect(clientMock.startPreview).toHaveBeenCalledOnce())

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.cancelAddSource' }))
    await user.click(
      screen.getByRole('button', { name: 'dataset.newKnowledge.discardSourceChangesConfirm' }),
    )
    expect(within(screen.getByRole('alertdialog')).getByRole('alert')).toHaveTextContent(
      'dataset.newKnowledge.crawlFailedDescription',
    )
    expect(routerMock.push).not.toHaveBeenCalled()

    await user.click(
      screen.getByRole('button', { name: 'dataset.newKnowledge.discardSourceChangesConfirm' }),
    )

    await waitFor(() => expect(clientMock.cancel).toHaveBeenCalledTimes(2))
    expect(clientMock.cancel.mock.calls[0]?.[0].params.runId).toBe('run-1')
    expect(clientMock.cancel.mock.calls[1]?.[0].params.runId).toBe('run-1')
    await waitFor(() =>
      expect(routerMock.push).toHaveBeenCalledWith('/datasets/new/space-1/sources'),
    )
  })

  it('restores polling after cancel failure and honors the latest terminal snapshot', async () => {
    const retryRequest = deferred<SourceWorkflowRun>()
    clientMock.getRun
      .mockResolvedValueOnce(run('succeeded', { progressCompleted: 1, progressTotal: 1 }))
      .mockResolvedValueOnce(
        run('canceled', {
          executionAttempts: 2,
          progressCompleted: 1,
          updatedAt: '2026-07-20T10:02:00Z',
        }),
      )
    clientMock.getPages
      .mockResolvedValueOnce({
        items: [
          {
            pageId: 'page-1',
            sourceUrl: 'https://docs.dify.ai/getting-started',
            title: 'Getting started',
          },
        ],
      })
      .mockResolvedValueOnce({ items: [] })
    clientMock.retry.mockReturnValue(retryRequest.promise)
    clientMock.cancel.mockRejectedValue(Object.assign(new Error('conflict'), { status: 409 }))
    render(
      <>
        <a href="/datasets/new/space-1/documents">Documents navigation</a>
        <WebsiteCrawlPreview connection={connection} knowledgeSpaceId="space-1" />
      </>,
    )
    const user = await fillValidForm()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' }))
    await screen.findByText('Getting started')
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.reCrawl' }))
    await user.click(screen.getByRole('link', { name: 'Documents navigation' }))
    await user.click(
      screen.getByRole('button', { name: 'dataset.newKnowledge.discardSourceChangesConfirm' }),
    )
    retryRequest.resolve(
      run('running', { executionAttempts: 2, updatedAt: '2026-07-20T10:01:00Z' }),
    )

    expect(await within(screen.getByRole('alertdialog')).findByRole('alert')).toHaveTextContent(
      'dataset.newKnowledge.crawlFailedDescription',
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.keepEditing' }))
    await waitFor(() => expect(clientMock.getRun).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('dataset.newKnowledge.crawlStopped')).toBeInTheDocument()
    expect(screen.queryByText('Getting started')).not.toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'Documents navigation' }))
    await user.click(
      screen.getByRole('button', { name: 'dataset.newKnowledge.discardSourceChangesConfirm' }),
    )

    expect(clientMock.cancel).toHaveBeenCalledOnce()
    await waitFor(() =>
      expect(routerMock.push).toHaveBeenCalledWith('/datasets/new/space-1/documents'),
    )
  })

  it('guards sidebar links and browser history after a crawl preview is ready', async () => {
    render(
      <>
        <a href="/datasets/new/space-1/documents">Documents navigation</a>
        <WebsiteCrawlPreview connection={connection} knowledgeSpaceId="space-1" />
      </>,
    )
    const user = await fillValidForm()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' }))
    await screen.findByText('Getting started')

    act(() => window.history.back())
    expect(
      await screen.findByRole('alertdialog', {
        name: 'dataset.newKnowledge.discardSourceChanges',
      }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.keepEditing' }))

    await user.click(screen.getByRole('link', { name: 'Documents navigation' }))
    expect(
      screen.getByRole('alertdialog', { name: 'dataset.newKnowledge.discardSourceChanges' }),
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: 'dataset.newKnowledge.discardSourceChangesConfirm' }),
    )

    await waitFor(() =>
      expect(routerMock.push).toHaveBeenCalledWith('/datasets/new/space-1/documents'),
    )
  })

  it('guards browser history before a crawl preview starts', async () => {
    const user = userEvent.setup()
    render(<WebsiteCrawlPreview connection={connection} knowledgeSpaceId="space-1" />)
    await user.type(
      screen.getByLabelText(/^dataset\.newKnowledge\.rootUrl/),
      'https://docs.dify.ai',
    )

    act(() => window.history.back())

    expect(
      await screen.findByRole('alertdialog', {
        name: 'dataset.newKnowledge.discardSourceChanges',
      }),
    ).toBeInTheDocument()
  })

  it('leaves through clean Cancel after a dirty form is cleared', async () => {
    const user = userEvent.setup()
    render(<WebsiteCrawlPreview connection={connection} knowledgeSpaceId="space-1" />)
    const rootUrl = screen.getByLabelText(/^dataset\.newKnowledge\.rootUrl/)
    await user.type(rootUrl, 'x')
    await user.clear(rootUrl)

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.cancelAddSource' }))

    await waitFor(() =>
      expect(routerMock.push).toHaveBeenCalledWith('/datasets/new/space-1/sources'),
    )
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('leaves through a same-origin link after a dirty form is cleared', async () => {
    const user = userEvent.setup()
    render(
      <>
        <a href="/datasets/new/space-1/documents">Documents navigation</a>
        <WebsiteCrawlPreview connection={connection} knowledgeSpaceId="space-1" />
      </>,
    )
    const rootUrl = screen.getByLabelText(/^dataset\.newKnowledge\.rootUrl/)
    await user.type(rootUrl, 'x')
    await user.clear(rootUrl)

    await user.click(screen.getByRole('link', { name: 'Documents navigation' }))

    await waitFor(() =>
      expect(routerMock.push).toHaveBeenCalledWith('/datasets/new/space-1/documents'),
    )
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('clears a canceled sidebar destination before the form cancel action', async () => {
    render(
      <>
        <a href="/datasets/new/space-1/documents">Documents navigation</a>
        <WebsiteCrawlPreview connection={connection} knowledgeSpaceId="space-1" />
      </>,
    )
    const user = await fillValidForm()
    await user.click(screen.getByRole('link', { name: 'Documents navigation' }))
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.keepEditing' }))

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.cancelAddSource' }))
    await user.click(
      screen.getByRole('button', { name: 'dataset.newKnowledge.discardSourceChangesConfirm' }),
    )

    await waitFor(() =>
      expect(routerMock.push).toHaveBeenCalledWith('/datasets/new/space-1/sources'),
    )
    expect(routerMock.push).not.toHaveBeenCalledWith('/datasets/new/space-1/documents')
  })

  it('shows pending feedback while a completed crawl is being restarted', async () => {
    const retryRequest = deferred<SourceWorkflowRun>()
    clientMock.retry.mockReturnValue(retryRequest.promise)

    render(<WebsiteCrawlPreview connection={connection} knowledgeSpaceId="space-1" />)
    const user = await fillValidForm()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' }))
    const reCrawl = await screen.findByRole('button', { name: 'dataset.newKnowledge.reCrawl' })
    await user.click(reCrawl)

    expect(reCrawl).toHaveAttribute('aria-disabled', 'true')
    await act(async () =>
      retryRequest.resolve(
        run('running', { executionAttempts: 2, updatedAt: '2026-07-20T10:01:00Z' }),
      ),
    )
    await waitFor(() => expect(clientMock.retry).toHaveBeenCalledOnce())
  })

  it('streams page cursors while running and replaces them with the final snapshot', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    clientMock.getRun
      .mockResolvedValueOnce(run('running', { progressCompleted: 2, progressTotal: 4 }))
      .mockResolvedValueOnce(run('succeeded', { progressCompleted: 4, progressTotal: 4 }))
    clientMock.getPages
      .mockResolvedValueOnce({
        items: [{ pageId: 'page-1', sourceUrl: 'https://docs.dify.ai/one', title: 'Old one' }],
        nextCursor: 'page-2',
      })
      .mockResolvedValueOnce({
        items: [
          { pageId: 'page-2', sourceUrl: 'https://docs.dify.ai/two', title: 'Two' },
          {
            pageId: 'page-deleted',
            sourceUrl: 'https://docs.dify.ai/deleted',
            title: 'Deleted page',
          },
        ],
      })
      .mockResolvedValueOnce({
        items: [
          { pageId: 'page-0', sourceUrl: 'https://docs.dify.ai/new', title: 'New first' },
          { pageId: 'page-2', sourceUrl: 'https://docs.dify.ai/two', title: 'Two' },
        ],
        nextCursor: 'final-page-2',
      })
      .mockResolvedValueOnce({
        items: [
          { pageId: 'page-1', sourceUrl: 'https://docs.dify.ai/one', title: 'Updated one' },
          { pageId: 'page-3', sourceUrl: 'https://docs.dify.ai/three', title: 'Three' },
        ],
      })

    render(<WebsiteCrawlPreview connection={connection} knowledgeSpaceId="space-1" />)
    const user = await fillValidForm()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' }))

    expect(await screen.findByText('Two')).toBeInTheDocument()
    expect(clientMock.getRun).toHaveBeenNthCalledWith(1, {
      params: { id: 'space-1', runId: 'run-1' },
    })
    expect(clientMock.getPages).toHaveBeenNthCalledWith(1, {
      params: { id: 'space-1', runId: 'run-1' },
      query: { limit: 200 },
    })
    expect(clientMock.getPages).toHaveBeenNthCalledWith(2, {
      params: { id: 'space-1', runId: 'run-1' },
      query: { cursor: 'page-2', limit: 200 },
    })
    expect(
      screen.getByRole('progressbar', {
        name: 'dataset.newKnowledge.crawlProgress:{"host":"docs.dify.ai"}',
      }),
    ).toHaveValue(3)
    const status = screen.getByText(/^dataset\.newKnowledge\.crawlingPages/)
    expect(status).toHaveAttribute('role', 'status')
    expect(status.querySelector('button')).not.toBeInTheDocument()
    const skeletons = screen.getAllByTestId('crawl-page-skeleton')
    expect(skeletons).toHaveLength(2)
    expect(skeletons[0]?.closest('ul')).toBe(screen.getByRole('list'))
    await act(async () => vi.advanceTimersByTime(1500))
    expect(await screen.findByText('Three')).toBeInTheDocument()
    expect(screen.getByText('New first')).toBeInTheDocument()
    expect(screen.getByText('Updated one')).toBeInTheDocument()
    expect(screen.queryByText('Old one')).not.toBeInTheDocument()
    expect(screen.queryByText('Deleted page')).not.toBeInTheDocument()
    expect(clientMock.getPages).toHaveBeenNthCalledWith(3, {
      params: { id: 'space-1', runId: 'run-1' },
      query: { limit: 200 },
    })
    expect(clientMock.getPages).toHaveBeenNthCalledWith(4, {
      params: { id: 'space-1', runId: 'run-1' },
      query: { cursor: 'final-page-2', limit: 200 },
    })
    expect(
      screen.getAllByRole('checkbox').map((checkbox) => checkbox.getAttribute('aria-label')),
    ).toEqual(['New first', 'Two', 'Updated one', 'Three'])
    expect(
      screen.queryByRole('button', { name: 'dataset.newKnowledge.stopCrawl' }),
    ).not.toBeInTheDocument()
  })

  it('stops the active run once and keeps pages already discovered', async () => {
    clientMock.getRun.mockResolvedValue(run('running', { progressCompleted: 1 }))
    clientMock.cancel.mockResolvedValue(run('canceled', { progressCompleted: 1 }))

    render(<WebsiteCrawlPreview connection={connection} knowledgeSpaceId="space-1" />)
    const user = await fillValidForm()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' }))
    await screen.findByText('Getting started')
    const stop = screen.getByRole('button', { name: 'dataset.newKnowledge.stopCrawl' })
    await user.dblClick(stop)

    await waitFor(() => expect(clientMock.cancel).toHaveBeenCalledOnce())
    expect(clientMock.cancel).toHaveBeenCalledWith({
      body: { reason: 'user_requested' },
      params: { id: 'space-1', runId: 'run-1' },
    })
    expect(screen.getByText('Getting started')).toBeInTheDocument()
    expect(await screen.findByText('dataset.newKnowledge.crawlStopped')).toHaveAttribute(
      'role',
      'status',
    )
  })

  it('reconciles a lost Stop response without sending cancel twice', async () => {
    clientMock.getRun
      .mockResolvedValueOnce(run('running', { progressCompleted: 1 }))
      .mockResolvedValueOnce(run('canceled', { progressCompleted: 1 }))
    clientMock.cancel.mockRejectedValue(new Error('response lost'))

    render(<WebsiteCrawlPreview connection={connection} knowledgeSpaceId="space-1" />)
    const user = await fillValidForm()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' }))
    await screen.findByText('Getting started')
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.stopCrawl' }))

    expect(await screen.findByText('dataset.newKnowledge.crawlStopped')).toHaveAttribute(
      'role',
      'status',
    )
    expect(clientMock.cancel).toHaveBeenCalledOnce()
  })

  it('only reconciles Stop while an ambiguous cancel response remains stale', async () => {
    clientMock.getRun.mockResolvedValue(run('running', { progressCompleted: 1 }))
    clientMock.cancel.mockRejectedValue(
      Object.assign(new Error('proxy connection lost'), { status: 502 }),
    )

    render(<WebsiteCrawlPreview connection={connection} knowledgeSpaceId="space-1" />)
    const user = await fillValidForm()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' }))
    await screen.findByText('Getting started')
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.stopCrawl' }))
    clientMock.getRun.mockRejectedValueOnce(
      Object.assign(new Error('reconciliation unavailable'), { status: 503 }),
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.stopCrawl' }))
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.stopCrawl' }))

    await waitFor(() => expect(clientMock.getRun.mock.calls.length).toBeGreaterThanOrEqual(3))
    expect(clientMock.cancel).toHaveBeenCalledOnce()
  })

  it('allows Stop to be retried after a definitive HTTP rejection', async () => {
    clientMock.getRun.mockResolvedValue(run('running', { progressCompleted: 1 }))
    clientMock.cancel
      .mockRejectedValueOnce(Object.assign(new Error('rate limited'), { status: 429 }))
      .mockResolvedValueOnce(run('canceled', { progressCompleted: 1 }))

    render(<WebsiteCrawlPreview connection={connection} knowledgeSpaceId="space-1" />)
    const user = await fillValidForm()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' }))
    await screen.findByText('Getting started')
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.stopCrawl' }))
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.stopCrawl' }))

    expect(await screen.findByText('dataset.newKnowledge.crawlStopped')).toBeInTheDocument()
    expect(clientMock.cancel).toHaveBeenCalledTimes(2)
  })

  it('shows provider failures and retries the same workflow without duplicate requests', async () => {
    clientMock.getRun.mockResolvedValue(
      run('failed', { lastErrorCode: 'PROVIDER_403', progressFailed: 1 }),
    )
    clientMock.getPages.mockResolvedValue({ items: [] })
    clientMock.retry.mockResolvedValue(run('running'))

    render(<WebsiteCrawlPreview connection={connection} knowledgeSpaceId="space-1" />)
    const user = await fillValidForm()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'dataset.newKnowledge.crawlFailed403',
    )
    const retry = screen.getByRole('button', { name: 'dataset.newKnowledge.retryCrawl' })
    await user.dblClick(retry)

    await waitFor(() => expect(clientMock.retry).toHaveBeenCalledOnce())
    expect(clientMock.retry).toHaveBeenCalledWith({
      params: { id: 'space-1', runId: 'run-1' },
    })
    expect(clientMock.createSource).toHaveBeenCalledOnce()
    expect(clientMock.startPreview).toHaveBeenCalledOnce()
  })

  it('accepts a successful retry response even when its counters have not advanced yet', async () => {
    const failedRun = run('failed', { lastErrorCode: 'PROVIDER_403', progressFailed: 1 })
    clientMock.getRun
      .mockResolvedValueOnce(failedRun)
      .mockResolvedValueOnce(failedRun)
      .mockReturnValue(new Promise<SourceWorkflowRun>(() => {}))
    clientMock.getPages.mockResolvedValue({ items: [] })
    clientMock.retry.mockResolvedValue(run('running'))

    render(<WebsiteCrawlPreview connection={connection} knowledgeSpaceId="space-1" />)
    const user = await fillValidForm()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' }))
    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.retryCrawl' }))

    expect(
      await screen.findByRole('button', { name: 'dataset.newKnowledge.stopCrawl' }),
    ).toBeInTheDocument()
    await waitFor(() => expect(clientMock.getRun).toHaveBeenCalledTimes(2))
    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.stopCrawl' }),
    ).toBeInTheDocument()
  })

  it('keeps retry causality across stale replicas and retires its fingerprint', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const failedRun = run('failed', { lastErrorCode: 'PROVIDER_403', progressFailed: 1 })
    clientMock.getRun
      .mockResolvedValueOnce(failedRun)
      .mockResolvedValueOnce(failedRun)
      .mockResolvedValueOnce(run('running'))
      .mockResolvedValueOnce(failedRun)
      .mockResolvedValueOnce(
        run('succeeded', { progressCompleted: 1, updatedAt: '2026-07-20T10:01:00Z' }),
      )
    clientMock.getPages.mockResolvedValueOnce({ items: [] }).mockResolvedValue({
      items: [
        {
          pageId: 'page-1',
          sourceUrl: 'https://docs.dify.ai/getting-started',
          title: 'Getting started',
        },
      ],
    })
    clientMock.retry.mockResolvedValue(run('running'))

    render(<WebsiteCrawlPreview connection={connection} knowledgeSpaceId="space-1" />)
    const user = await fillValidForm()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' }))
    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.retryCrawl' }))
    await waitFor(() => expect(clientMock.getRun).toHaveBeenCalledTimes(2))

    await act(async () => vi.advanceTimersByTime(1500))
    await waitFor(() => expect(clientMock.getRun).toHaveBeenCalledTimes(3))
    await act(async () => vi.advanceTimersByTime(1500))
    await waitFor(() => expect(clientMock.getRun).toHaveBeenCalledTimes(4))
    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.stopCrawl' }),
    ).toBeInTheDocument()
    await act(async () => vi.advanceTimersByTime(1500))
    await screen.findByText('Getting started')

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.reCrawl' }))
    await waitFor(() => expect(clientMock.retry).toHaveBeenCalledTimes(2))
  })

  it('reconciles a lost Retry response without sending retry twice', async () => {
    clientMock.getRun
      .mockResolvedValueOnce(run('failed', { lastErrorCode: 'PROVIDER_403' }))
      .mockResolvedValueOnce(
        run('succeeded', {
          progressCompleted: 1,
        }),
      )
      .mockResolvedValueOnce(
        run('succeeded', {
          progressCompleted: 1,
        }),
      )
    clientMock.retry.mockRejectedValue(new Error('response lost'))

    render(<WebsiteCrawlPreview connection={connection} knowledgeSpaceId="space-1" />)
    const user = await fillValidForm()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' }))
    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.retryCrawl' }))

    expect(
      await screen.findByRole('button', { name: 'dataset.newKnowledge.reCrawl' }),
    ).toBeInTheDocument()
    expect(clientMock.retry).toHaveBeenCalledOnce()
  })

  it('only reconciles Retry while an ambiguous retry response remains stale', async () => {
    const failedRun = run('failed', { lastErrorCode: 'PROVIDER_403', progressFailed: 1 })
    clientMock.getRun
      .mockResolvedValueOnce(failedRun)
      .mockResolvedValueOnce(failedRun)
      .mockRejectedValueOnce(
        Object.assign(new Error('reconciliation unavailable'), { status: 503 }),
      )
      .mockResolvedValue(failedRun)
    clientMock.getPages.mockResolvedValue({ items: [] })
    clientMock.retry.mockRejectedValue(Object.assign(new Error('proxy timeout'), { status: 504 }))

    render(<WebsiteCrawlPreview connection={connection} knowledgeSpaceId="space-1" />)
    const user = await fillValidForm()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' }))
    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.retryCrawl' }))
    expect(screen.getByLabelText(/^dataset\.newKnowledge\.rootUrl/)).toBeDisabled()
    expect(screen.getByLabelText(/^dataset\.newKnowledge\.sourceName/)).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.retryCrawl' }))
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.retryCrawl' }))

    await waitFor(() => expect(clientMock.getRun).toHaveBeenCalledTimes(4))
    expect(clientMock.retry).toHaveBeenCalledOnce()
  })

  it('allows Retry to be repeated after a definitive HTTP rejection', async () => {
    clientMock.getRun.mockResolvedValue(
      run('failed', { lastErrorCode: 'PROVIDER_403', progressFailed: 1 }),
    )
    clientMock.getPages.mockResolvedValue({ items: [] })
    clientMock.retry
      .mockRejectedValueOnce(Object.assign(new Error('rate limited'), { status: 429 }))
      .mockResolvedValueOnce(run('running', { executionAttempts: 2 }))

    render(<WebsiteCrawlPreview connection={connection} knowledgeSpaceId="space-1" />)
    const user = await fillValidForm()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' }))
    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.retryCrawl' }))
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.retryCrawl' }))

    await waitFor(() => expect(clientMock.retry).toHaveBeenCalledTimes(2))
  })

  it.each([
    ['failed', 'PROVIDER_TIMEOUT', 'dataset.newKnowledge.crawlFailedTimeout'],
    [
      'failed',
      'PROVIDER_UNAVAILABLE',
      'dataset.newKnowledge.crawlFailedProvider:{"provider":"Firecrawl"}',
    ],
    ['timed_out', undefined, 'dataset.newKnowledge.crawlFailedTimeout'],
  ])('shows a recovery message for %s / %s', async (state, lastErrorCode, message) => {
    clientMock.getRun.mockResolvedValue(run(state, { lastErrorCode }))
    clientMock.getPages.mockResolvedValue({ items: [] })

    render(<WebsiteCrawlPreview connection={connection} knowledgeSpaceId="space-1" />)
    const user = await fillValidForm()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
  })

  it('offers an adjust-and-recrawl path after a successful zero-result crawl', async () => {
    clientMock.getRun.mockResolvedValue(run('succeeded'))
    clientMock.getPages.mockResolvedValue({ items: [] })
    clientMock.retry.mockResolvedValue(run('running'))

    render(<WebsiteCrawlPreview connection={connection} knowledgeSpaceId="space-1" />)
    const user = await fillValidForm()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' }))

    const noPages = await screen.findByText(/^dataset\.newKnowledge\.noPagesFound:/)
    expect(noPages.closest('[role="status"]')).toHaveAttribute('aria-live', 'polite')
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.adjustAndRecrawl' }))
    await waitFor(() => expect(clientMock.retry).toHaveBeenCalledOnce())
  })

  it('treats a superseded workflow as terminal and stops polling', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    clientMock.getRun.mockResolvedValue(run('superseded'))
    clientMock.getPages.mockResolvedValue({ items: [] })

    render(<WebsiteCrawlPreview connection={connection} knowledgeSpaceId="space-1" />)
    const user = await fillValidForm()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' }))
    expect(await screen.findByText('dataset.newKnowledge.crawlStopped')).toHaveAttribute(
      'role',
      'status',
    )
    await act(async () => vi.advanceTimersByTime(6000))

    expect(clientMock.getRun).toHaveBeenCalledOnce()
    expect(
      screen.queryByRole('button', { name: 'dataset.newKnowledge.stopCrawl' }),
    ).not.toBeInTheDocument()
  })

  it('resumes polling after a transient status request failure without retrying the workflow', async () => {
    clientMock.getRun
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockResolvedValueOnce(run('succeeded', { progressCompleted: 1 }))

    render(<WebsiteCrawlPreview connection={connection} knowledgeSpaceId="space-1" />)
    const user = await fillValidForm()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'dataset.newKnowledge.crawlFailedDescription',
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.retryCrawl' }))

    await waitFor(() => expect(clientMock.getRun).toHaveBeenCalledTimes(2))
    expect(clientMock.retry).not.toHaveBeenCalled()
    expect(await screen.findByText('Getting started')).toBeInTheDocument()
  })

  it('reuses the idempotency key when the preview start response is lost', async () => {
    clientMock.startPreview
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce(run('running'))

    render(<WebsiteCrawlPreview connection={connection} knowledgeSpaceId="space-1" />)
    const user = await fillValidForm()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' }))
    await screen.findByRole('alert')
    expect(screen.getByLabelText(/^dataset\.newKnowledge\.rootUrl/)).toBeDisabled()
    expect(screen.getByLabelText(/^dataset\.newKnowledge\.sourceName/)).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.retryCrawl' }))

    await waitFor(() => expect(clientMock.startPreview).toHaveBeenCalledTimes(2))
    expect(clientMock.createSource).toHaveBeenCalledOnce()
    expect(clientMock.startPreview.mock.calls[0]?.[0].headers).toEqual(
      clientMock.startPreview.mock.calls[1]?.[0].headers,
    )
  })

  it('reconciles a response-lost provisional source by its client request id', async () => {
    clientMock.createSource.mockRejectedValue(new Error('response lost'))
    clientMock.listSources.mockImplementation(
      async ({ query }: { query?: { cursor?: string } }) => {
        const clientRequestId =
          clientMock.createSource.mock.calls[0]?.[0].body.metadata.clientRequestId
        return query?.cursor
          ? { items: [source({ clientRequestId })] }
          : { items: [], nextCursor: 'next' }
      },
    )

    render(<WebsiteCrawlPreview connection={connection} knowledgeSpaceId="space-1" />)
    const user = await fillValidForm()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' }))

    await waitFor(() => expect(clientMock.listSources).toHaveBeenCalledTimes(2))
    expect(clientMock.startPreview).toHaveBeenCalledOnce()
  })

  it('checks for a response-lost source before repeating its create request', async () => {
    clientMock.createSource.mockRejectedValue(new Error('response lost'))
    clientMock.listSources.mockResolvedValueOnce({ items: [] }).mockImplementationOnce(async () => {
      const clientRequestId =
        clientMock.createSource.mock.calls[0]?.[0].body.metadata.clientRequestId
      return { items: [source({ clientRequestId })] }
    })

    render(<WebsiteCrawlPreview connection={connection} knowledgeSpaceId="space-1" />)
    const user = await fillValidForm()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' }))
    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.retryCrawl' }))

    await waitFor(() => expect(clientMock.startPreview).toHaveBeenCalledOnce())
    expect(clientMock.createSource).toHaveBeenCalledOnce()
    expect(clientMock.listSources).toHaveBeenCalledTimes(2)
  })

  it('never repeats source creation while an ambiguous result remains unreconciled', async () => {
    clientMock.createSource.mockRejectedValue(
      Object.assign(new Error('proxy timeout'), { status: 504 }),
    )
    clientMock.listSources.mockResolvedValue({ items: [] })

    render(<WebsiteCrawlPreview connection={connection} knowledgeSpaceId="space-1" />)
    const user = await fillValidForm()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' }))
    await screen.findByRole('alert')
    expect(screen.getByLabelText(/^dataset\.newKnowledge\.rootUrl/)).toBeDisabled()
    expect(screen.getByLabelText(/^dataset\.newKnowledge\.sourceName/)).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.retryCrawl' }))
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.retryCrawl' }))

    await waitFor(() => expect(clientMock.listSources).toHaveBeenCalledTimes(3))
    expect(clientMock.createSource).toHaveBeenCalledOnce()
    expect(clientMock.startPreview).not.toHaveBeenCalled()
  })

  it('blocks discard while provisional source creation is still uncertain', async () => {
    clientMock.createSource.mockRejectedValue(new Error('response lost'))
    clientMock.listSources.mockResolvedValue({ items: [] })
    render(<WebsiteCrawlPreview connection={connection} knowledgeSpaceId="space-1" />)
    const user = await fillValidForm()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' }))
    await screen.findByRole('alert')

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.cancelAddSource' }))
    await user.click(
      screen.getByRole('button', { name: 'dataset.newKnowledge.discardSourceChangesConfirm' }),
    )

    expect(within(screen.getByRole('alertdialog')).getByRole('alert')).toHaveTextContent(
      'dataset.newKnowledge.crawlFailedDescription',
    )
    expect(routerMock.push).not.toHaveBeenCalled()
  })

  it('retries source creation after a definitive HTTP rejection', async () => {
    clientMock.createSource
      .mockRejectedValueOnce(Object.assign(new Error('rate limited'), { status: 429 }))
      .mockResolvedValueOnce(source())

    render(<WebsiteCrawlPreview connection={connection} knowledgeSpaceId="space-1" />)
    const user = await fillValidForm()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' }))
    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.retryCrawl' }))

    await waitFor(() => expect(clientMock.startPreview).toHaveBeenCalledOnce())
    expect(clientMock.createSource).toHaveBeenCalledTimes(2)
    expect(clientMock.listSources).not.toHaveBeenCalled()
  })

  it('cleans up polling when the component unmounts', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    clientMock.getRun.mockResolvedValue(run('running'))
    const view = render(<WebsiteCrawlPreview connection={connection} knowledgeSpaceId="space-1" />)
    const user = await fillValidForm()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' }))
    await waitFor(() => expect(clientMock.getRun).toHaveBeenCalledOnce())
    view.unmount()
    await act(async () => vi.advanceTimersByTime(6000))

    expect(clientMock.getRun).toHaveBeenCalledOnce()
  })
})
