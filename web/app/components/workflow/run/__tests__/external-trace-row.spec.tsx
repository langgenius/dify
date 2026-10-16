import type { GetAppsByAppIdTraceRunsBySourceKindBySourceIdResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { ExternalTraceSource } from '../external-trace-row'
import { act, render, screen } from '@testing-library/react'
import { httpErrorFromResponse } from '@/service/http-error'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { ExternalTraceRow } from '../external-trace-row'

type TraceRun = GetAppsByAppIdTraceRunsBySourceKindBySourceIdResponse

const { request } = vi.hoisted(() => ({
  request:
    vi.fn<(url: string, init: RequestInit, options: { request: Request }) => Promise<Response>>(),
}))
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  request,
}))

const workflowRun: ExternalTraceSource = {
  appId: 'app-1',
  kind: 'workflow',
  workflowRunId: 'run-1',
}

const accepted: TraceRun = {
  status: 'accepted',
  source_kind: 'workflow',
  source_id: 'run-1',
  provider: 'langfuse',
  trace_url: 'https://cloud.langfuse.com/trace/abc',
  project_url: 'https://cloud.langfuse.com/project/p',
}

function setup(source: ExternalTraceSource, responses: Array<TraceRun | number>, subject?: string) {
  const urls: URL[] = []
  request.mockImplementation(async (_url, _init, { request: sent }) => {
    urls.push(new URL(sent.url))
    const next = responses.length > 1 ? responses.shift()! : responses[0]!
    if (typeof next === 'number')
      throw await httpErrorFromResponse(
        Response.json({ code: 'forbidden', message: 'Forbidden' }, { status: next }),
      )
    return Response.json(next)
  })
  const { wrapper } = createConsoleQueryWrapper()
  const view = render(
    <dl>
      <ExternalTraceRow source={source} subject={subject} />
    </dl>,
    { wrapper },
  )
  return { ...view, urls }
}

const PROVIDER = '{"provider":"app.tracing.langfuse.title"}'

describe('ExternalTraceRow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('links an accepted workflow run to its frozen third-party trace', async () => {
    setup(workflowRun, [accepted])

    expect(await screen.findByText(`app.tracing.run.accepted:${PROVIDER}`)).toBeInTheDocument()
    expect(screen.getByRole('term')).toHaveTextContent('app.tracing.run.title')
    const link = screen.getByRole('link', { name: 'app.tracing.run.viewTrace' })
    expect(link).toHaveAttribute('href', accepted.trace_url)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAccessibleDescription('common.operation.openInNewTab')
  })

  it('locates an Agent node span within the workflow run', async () => {
    const { urls } = setup(
      { ...workflowRun, nodeExecutionId: 'node-exec-1' },
      [{ ...accepted, span_url: 'https://cloud.langfuse.com/trace/abc?observation=span' }],
      'Agent 1',
    )

    // The node title keeps links to different spans distinguishable by name.
    expect(
      await screen.findByRole('link', { name: 'app.tracing.run.viewSpan Agent 1' }),
    ).toHaveAttribute('href', 'https://cloud.langfuse.com/trace/abc?observation=span')
    expect(urls[0]!.pathname).toMatch(/\/apps\/app-1\/trace-runs\/workflow\/run-1$/)
    expect(urls[0]!.searchParams.get('node_execution_id')).toBe('node-exec-1')
  })

  it('labels a project-only destination as the project, not this run', async () => {
    setup(workflowRun, [{ ...accepted, trace_url: null }])

    expect(
      await screen.findByRole('link', { name: 'app.tracing.run.viewProject' }),
    ).toHaveAttribute('href', accepted.project_url)
  })

  it('reports a failed delivery without offering a link', async () => {
    setup(workflowRun, [{ ...accepted, status: 'failed' }])

    expect(await screen.findByText(`app.tracing.run.failed:${PROVIDER}`)).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('stays hidden for runs that were not collected or cannot be read', async () => {
    const notCollected = setup(workflowRun, [
      { status: 'not_collected', source_kind: 'workflow', source_id: 'run-1' },
    ])
    await vi.waitFor(() => expect(request).toHaveBeenCalled())
    expect(screen.queryByText('app.tracing.run.title')).not.toBeInTheDocument()
    notCollected.unmount()

    request.mockClear()
    const forbidden = setup(workflowRun, [403])
    await vi.waitFor(() => expect(request).toHaveBeenCalled())
    expect(screen.queryByText('app.tracing.run.title')).not.toBeInTheDocument()
    forbidden.unmount()
  })

  it('keeps polling while the export is pending and stops once it is accepted', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      setup(workflowRun, [{ ...accepted, status: 'exporting', trace_url: null }, accepted])

      expect(await screen.findByText(`app.tracing.run.pending:${PROVIDER}`)).toBeInTheDocument()
      await act(() => vi.advanceTimersByTimeAsync(3000))
      expect(await screen.findByText(`app.tracing.run.accepted:${PROVIDER}`)).toBeInTheDocument()

      await act(() => vi.advanceTimersByTimeAsync(9000))
      expect(request).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
