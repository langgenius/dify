import type { WorkflowRunNodeExecutionResponse } from '@dify/contracts/api/console/apps/types.gen'
import { screen } from '@testing-library/react'
import { renderEditor as render } from '@/app/components/workflow/editor-resource/__tests__/render'
import LastRun from '../index'

const { request } = vi.hoisted(() => ({
  request:
    vi.fn<(url: string, init: RequestInit, options: { request: Request }) => Promise<Response>>(),
}))

vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  request,
}))

function renderLastRun(execution: WorkflowRunNodeExecutionResponse) {
  const urls: URL[] = []
  request.mockImplementation(async (_url, _init, { request: sent }) => {
    const url = new URL(sent.url)
    urls.push(url)
    if (url.pathname.endsWith('/last-run')) return Response.json(execution)
    if (url.pathname.endsWith(`/trace-runs/node/${execution.id}`)) {
      return Response.json({
        source_kind: 'node',
        source_id: execution.id,
        status: 'accepted',
        provider: 'langfuse',
        span_url: 'https://cloud.langfuse.com/trace/frozen?observation=agent',
      })
    }
    throw new Error(`Unexpected request: ${url}`)
  })

  render(
    <LastRun
      nodeId="node-1"
      canSingleRun
      isRunAfterSingleRun={false}
      updateNodeRunningStatus={vi.fn()}
      onSingleRunClicked={vi.fn()}
    />,
  )
  return urls
}

describe('LastRun external tracing', () => {
  it.each(['succeeded', 'failed'])(
    'opens the frozen trace for a %s Agent V2 execution returned by the API',
    async (status) => {
      const urls = renderLastRun({
        id: 'execution-1',
        node_id: 'node-1',
        node_type: 'agent',
        status,
        error: status === 'failed' ? 'Agent execution failed' : null,
        process_data: { workflow_agent_binding_id: 'binding-1' },
        extras: {},
      })

      expect(await screen.findByRole('link', { name: 'app.tracing.run.viewSpan' })).toHaveAttribute(
        'href',
        'https://cloud.langfuse.com/trace/frozen?observation=agent',
      )
      expect(urls.map((url) => url.pathname)).toEqual([
        expect.stringMatching(/\/apps\/app-1\/workflows\/draft\/nodes\/node-1\/last-run$/),
        expect.stringMatching(/\/apps\/app-1\/trace-runs\/node\/execution-1$/),
      ])
    },
  )

  it('does not query Agent V2 tracing for a legacy Agent execution', async () => {
    const urls = renderLastRun({
      id: 'legacy-execution',
      node_id: 'node-1',
      node_type: 'agent',
      status: 'failed',
      error: 'Legacy Agent failed',
      process_data: {},
      extras: {},
    })

    expect(await screen.findByText('Legacy Agent failed')).toBeVisible()
    expect(screen.queryByRole('link', { name: /app.tracing.run.view/ })).not.toBeInTheDocument()
    expect(urls).toHaveLength(1)
  })
})
