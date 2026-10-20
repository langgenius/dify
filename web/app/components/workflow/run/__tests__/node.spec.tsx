import type { NodeTracing } from '@/types/workflow'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createNodeTracing } from '../../__tests__/fixtures'
import { BlockEnum, NodeRunningStatus } from '../../types'
import NodePanel from '../node'

const { request } = vi.hoisted(() => ({
  request:
    vi.fn<(url: string, init: RequestInit, options: { request: Request }) => Promise<Response>>(),
}))

vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  request,
}))

const createNodeInfo = (overrides: Partial<NodeTracing> = {}) =>
  createNodeTracing({
    id: 'trace-node-1',
    node_id: 'node-1',
    node_type: BlockEnum.Code,
    title: 'Code Node',
    inputs: undefined,
    process_data: undefined,
    outputs: undefined,
    elapsed_time: 1.25,
    created_by: { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
    execution_metadata: { total_tokens: 64, total_price: 0, currency: 'USD' },
    ...overrides,
  })

describe('Run NodePanel', () => {
  it('opens the historical Agent V2 span even when process data was truncated', async () => {
    const user = userEvent.setup()
    const urls: URL[] = []
    request.mockImplementation(async (_url, _init, { request: sent }) => {
      urls.push(new URL(sent.url))
      return Response.json({
        status: 'accepted',
        source_kind: 'workflow',
        source_id: 'run-1',
        provider: 'langfuse',
        span_url: 'https://cloud.langfuse.com/trace/frozen?observation=agent',
      })
    })
    render(
      <NodePanel
        nodeInfo={createNodeInfo({
          node_type: BlockEnum.Agent,
          title: 'Agent V2',
          process_data: { workflow_agent_binding_id: 'binding-1' },
          process_data_truncated: true,
          extras: {},
        })}
        externalTraceRun={{ appId: 'app-1', workflowRunId: 'run-1' }}
      />,
    )

    await user.click(screen.getByRole('button', { name: /Agent V2/ }))

    expect(
      await screen.findByRole('link', { name: 'app.tracing.run.viewSpan Agent V2' }),
    ).toHaveAttribute('href', 'https://cloud.langfuse.com/trace/frozen?observation=agent')
    expect(urls).toHaveLength(1)
    expect(urls[0]!.pathname).toMatch(/\/apps\/app-1\/trace-runs\/workflow\/run-1$/)
    expect(urls[0]!.searchParams.get('node_execution_id')).toBe('trace-node-1')
  })

  it('does not query Agent V2 spans for a legacy Agent in the same workflow', async () => {
    const user = userEvent.setup()
    render(
      <NodePanel
        nodeInfo={createNodeInfo({
          node_type: BlockEnum.Agent,
          title: 'Legacy Agent',
          process_data: {},
          extras: {},
        })}
        externalTraceRun={{ appId: 'app-1', workflowRunId: 'run-1' }}
      />,
    )

    await user.click(screen.getByRole('button', { name: /Legacy Agent/ }))

    expect(screen.getByRole('button', { name: /Legacy Agent/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.queryByRole('link', { name: /app.tracing.run.view/ })).not.toBeInTheDocument()
    expect(request).not.toHaveBeenCalled()
  })

  it('expands and collapses trace details from the keyboard', async () => {
    const user = userEvent.setup()
    render(<NodePanel nodeInfo={createNodeInfo({ status: NodeRunningStatus.Stopped })} />)

    const trigger = screen.getByRole('button', { name: /Code Node/ })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/Alice/)).not.toBeInTheDocument()

    await user.tab()
    expect(trigger).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/Alice/)).toBeVisible()
    expect(document.getElementById(trigger.getAttribute('aria-controls')!)).toBeVisible()

    await user.keyboard(' ')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/Alice/)).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it.each([
    NodeRunningStatus.Succeeded,
    NodeRunningStatus.Failed,
    NodeRunningStatus.Stopped,
    NodeRunningStatus.Paused,
    NodeRunningStatus.Exception,
  ])('exposes the %s status before the node is expanded', (status) => {
    render(<NodePanel nodeInfo={createNodeInfo({ status })} />)

    expect(
      screen.getByRole('button', {
        name: new RegExp(`Code Node.*workflow.tracing.status.${status}`),
      }),
    ).toHaveAttribute('aria-expanded', 'false')
  })

  it('keeps process details unavailable when they are hidden', async () => {
    const user = userEvent.setup()
    render(
      <NodePanel
        hideProcessDetail
        nodeInfo={createNodeInfo({
          expand: true,
          status: NodeRunningStatus.Stopped,
        })}
      />,
    )

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('workflow.tracing.status.stopped')).toBeInTheDocument()
    await user.click(screen.getByText('Code Node'))
    expect(screen.queryByText(/Alice/)).not.toBeInTheDocument()
  })

  it('renders the running state in the header without the finished summary', () => {
    render(
      <NodePanel
        nodeInfo={createNodeInfo({
          status: NodeRunningStatus.Running,
        })}
      />,
    )

    expect(screen.getByText('workflow.common.running')).toBeInTheDocument()
    expect(screen.queryByText('1.250 s')).not.toBeInTheDocument()
  })

  it('opens trace details when requested by tracing state', async () => {
    render(
      <NodePanel
        nodeInfo={createNodeInfo({
          expand: true,
          status: NodeRunningStatus.Stopped,
        })}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText(/Alice/)).toBeInTheDocument()
    })
  })

  it('forwards iteration details through the real iteration trigger', async () => {
    const user = userEvent.setup()
    const handleShowIterationDetail = vi.fn()
    const details = [
      [
        createNodeInfo({
          id: 'iter-trace-1',
          node_id: 'iter-node-1',
          execution_metadata: {
            total_tokens: 8,
            total_price: 0,
            currency: 'USD',
            iteration_index: 0,
          },
        }),
      ],
    ]
    const iterDurationMap = { 0: 1.2 }

    render(
      <NodePanel
        nodeInfo={createNodeInfo({
          expand: true,
          node_type: BlockEnum.Iteration,
          details,
          iterDurationMap,
        })}
        onShowIterationDetail={handleShowIterationDetail}
      />,
    )

    const trigger = await screen.findByRole('button', {
      name: /workflowLogic.nodes.iteration.iteration/,
    })
    await user.click(trigger)

    expect(handleShowIterationDetail).toHaveBeenCalledWith(details, iterDurationMap)
  })

  it('forwards retry details through the real retry trigger', async () => {
    const user = userEvent.setup()
    const handleShowRetryDetail = vi.fn()
    const retryDetail = [
      createNodeInfo({
        id: 'retry-trace-1',
        node_id: 'retry-node-1',
        retry_index: 1,
        status: NodeRunningStatus.Failed,
      }),
    ]

    render(
      <NodePanel
        nodeInfo={createNodeInfo({
          expand: true,
          retryDetail,
          status: NodeRunningStatus.Failed,
        })}
        onShowRetryDetail={handleShowRetryDetail}
      />,
    )

    const trigger = await screen.findByRole('button', {
      name: /workflow.nodes.common.retry.retries/,
    })
    await user.click(trigger)

    expect(handleShowRetryDetail).toHaveBeenCalledWith(retryDetail)
  })
})
