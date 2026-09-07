import type { NodeTracing } from '@/types/workflow'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { BlockEnum } from '../../types'
import TracingPanel from '../tracing-panel'

const mockRequest = vi.hoisted(() => vi.fn())

vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  request: mockRequest,
}))

// Monaco is an independent editor boundary; preserve its displayed trace content.
vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  default: ({ value }: { value: unknown }) => <pre>{JSON.stringify(value)}</pre>,
}))

const trace = (id: string, overrides: Partial<NodeTracing> = {}): NodeTracing => ({
  id,
  index: 1,
  predecessor_node_id: '',
  node_id: id,
  node_type: BlockEnum.Tool,
  title: id,
  inputs: {},
  inputs_truncated: false,
  process_data: null,
  process_data_truncated: false,
  outputs_truncated: false,
  status: 'succeeded',
  elapsed_time: 1,
  metadata: { iterator_length: 0, iterator_index: 0, loop_length: 0, loop_index: 0 },
  created_at: 1,
  created_by: { id: 'account', name: 'Tester', email: 'tester@example.com' },
  finished_at: 2,
  extras: { workflow_tool: true, icon: { content: '✅', background: '#fff' } },
  ...overrides,
})

const jsonResponse = (data: unknown) =>
  new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

describe('Workflow tool tracing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps workflow-tool tracing on the execution instead of individual retry attempts', async () => {
    const user = userEvent.setup()
    const root = trace('root-execution', { node_id: 'approval-tool', expand: true })
    const retry = trace('root-execution:retry:1', {
      node_id: root.node_id,
      status: 'retry',
      retry_index: 1,
      error: 'Approval service unavailable',
      expand: true,
    })
    mockRequest.mockImplementation(() => Promise.resolve(jsonResponse({ data: [] })))

    renderWithConsoleQuery(
      <TracingPanel
        list={[retry, root]}
        workflowRun={{ appId: 'root-app', runId: 'run', status: 'succeeded' }}
      />,
    )

    expect(await screen.findByRole('button', { name: 'runLog.tracing' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /workflow.nodes.common.retry.retries/ }))
    expect(await screen.findByText('Approval service unavailable')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'runLog.tracing' })).not.toBeInTheDocument()
    expect(mockRequest).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'workflow.singleRun.back' }))
    await user.click(await screen.findByRole('button', { name: 'runLog.tracing' }))
    await screen.findByText('common.noData')
    expect(mockRequest).toHaveBeenCalledWith(
      expect.stringContaining('/node-executions/root-execution/children'),
      expect.anything(),
      expect.anything(),
    )
  })

  it('loads the selected invocation lazily and drills through a child iteration to nested execution details', async () => {
    const user = userEvent.setup()
    const root = trace('root-execution', { title: 'Approval tool', expand: true })
    const iteration = trace('iteration-execution', {
      node_id: 'iteration-node',
      title: 'Approval batch',
      node_type: BlockEnum.Iteration,
      execution_metadata: {
        total_tokens: 0,
        total_price: 0,
        currency: 'USD',
        iteration_duration_map: { 0: 1 },
      },
    })
    const nestedTool = {
      ...trace('nested-database-id', {
        index: 2,
        title: 'Nested approval tool',
        execution_metadata: {
          total_tokens: 0,
          total_price: 0,
          currency: 'USD',
          iteration_id: 'iteration-node',
          iteration_index: 0,
        },
      }),
      node_execution_id: 'nested-engine-execution',
    }
    const humanInput = trace('human-execution', {
      node_type: BlockEnum.HumanInput,
      title: 'Human approval',
      inputs: { request: 'Review request' },
      process_data: { action: 'approve' },
      outputs: { approved_text: 'Approved result' },
    })
    mockRequest.mockImplementation((url: string) => {
      if (url.endsWith('/root-execution/children'))
        return Promise.resolve(jsonResponse({ data: [iteration, nestedTool] }))
      if (url.endsWith('/nested-engine-execution/children'))
        return Promise.resolve(jsonResponse({ data: [humanInput] }))
      throw new Error(`Unexpected request: ${url}`)
    })

    renderWithConsoleQuery(
      <TracingPanel
        list={[root]}
        workflowRun={{ appId: 'root-app', runId: 'run', status: 'succeeded' }}
      />,
    )
    expect(mockRequest).not.toHaveBeenCalled()

    await user.click(await screen.findByRole('button', { name: 'runLog.tracing' }))
    await user.click(await screen.findByText('Approval batch'))
    await user.click(screen.getByRole('button', { name: /workflow.nodes.iteration.iteration/ }))
    await user.click(screen.getByText('workflow.singleRun.iteration 1'))
    await user.click(screen.getByText('Nested approval tool'))
    await user.click(screen.getByRole('button', { name: 'runLog.tracing' }))
    await user.click(await screen.findByText('Human approval'))

    expect(screen.getByText(/Review request/)).toBeInTheDocument()
    expect(screen.getByText(/"action":"approve"/)).toBeInTheDocument()
    expect(screen.getByText(/Approved result/)).toBeInTheDocument()
    expect(mockRequest).toHaveBeenCalledWith(
      expect.stringContaining(
        '/apps/root-app/workflow-runs/run/node-executions/nested-engine-execution/children',
      ),
      expect.anything(),
      expect.anything(),
    )

    await user.click(screen.getAllByRole('button', { name: 'workflow.singleRun.back' }).at(-1)!)
    expect(screen.getByText('Nested approval tool')).toBeInTheDocument()
    expect(screen.queryByText('Human approval')).not.toBeInTheDocument()
  })

  it('refreshes open child logs when a paused run finishes', async () => {
    const user = userEvent.setup()
    const root = trace('root-execution', { title: 'Approval tool', expand: true })
    mockRequest.mockResolvedValue(jsonResponse({ data: [] }))
    const { rerender } = renderWithConsoleQuery(
      <TracingPanel list={[root]} workflowRun={{ appId: 'app', runId: 'run', status: 'paused' }} />,
    )

    await user.click(await screen.findByRole('button', { name: 'runLog.tracing' }))
    await screen.findByText('common.noData')
    mockRequest.mockImplementation(() =>
      Promise.resolve(
        jsonResponse({
          data: [
            trace('completed-child', { title: 'Completed approval', node_type: BlockEnum.End }),
          ],
        }),
      ),
    )
    rerender(
      <TracingPanel
        list={[root]}
        workflowRun={{ appId: 'app', runId: 'run', status: 'succeeded' }}
      />,
    )

    await waitFor(() => expect(screen.getByText('Completed approval')).toBeInTheDocument())
    expect(screen.queryByText('common.noData')).not.toBeInTheDocument()
  })

  it.each([BlockEnum.Iteration, BlockEnum.Loop])(
    'refreshes an open source %s after its human input is submitted',
    async (containerType) => {
      const user = userEvent.setup()
      const root = trace('root-execution', { title: 'Approval tool', expand: true })
      const container = trace('batch-execution', {
        node_id: 'batch',
        title: 'Approval batch',
        node_type: containerType,
        status: 'paused',
        parallel_id: 'parallel',
        parallel_start_node_id: 'branch',
      })
      const branch = trace('branch-execution', {
        node_id: 'branch',
        node_type: BlockEnum.TemplateTransform,
        parallel_id: 'parallel',
        parallel_start_node_id: 'branch',
      })
      const approval = trace('approval-execution', {
        index: 2,
        title: 'Human approval',
        node_type: BlockEnum.HumanInput,
        status: 'paused',
        execution_metadata: {
          total_tokens: 0,
          total_price: 0,
          currency: 'USD',
          [`${containerType}_id`]: 'batch',
          [`${containerType}_index`]: 0,
        },
      })
      mockRequest.mockImplementation(() =>
        Promise.resolve(jsonResponse({ data: [branch, container, approval] })),
      )
      const { rerender } = renderWithConsoleQuery(
        <TracingPanel
          list={[root]}
          workflowRun={{ appId: 'app', runId: 'run', status: 'paused' }}
        />,
      )

      await user.click(await screen.findByRole('button', { name: 'runLog.tracing' }))
      await user.click(await screen.findByText('Approval batch'))
      await user.click(
        screen.getByRole('button', { name: new RegExp(`workflow.nodes.${containerType}`) }),
      )
      await user.click(screen.getByText(`workflow.singleRun.${containerType} 1`))
      await user.click(screen.getByText('Human approval'))
      expect(screen.getByText('workflow.nodes.humanInput.log.reasonContent')).toBeInTheDocument()

      mockRequest.mockImplementation(() =>
        Promise.resolve(
          jsonResponse({
            data: [
              branch,
              {
                ...container,
                status: 'succeeded',
                execution_metadata: {
                  total_tokens: 0,
                  total_price: 0,
                  currency: 'USD',
                  [`${containerType}_duration_map`]: { 0: 2 },
                  loop_variable_map: { 0: { decision: 'Updated loop variables' } },
                },
              },
              { ...approval, status: 'succeeded', outputs: { decision: 'Approved result' } },
              trace('next-execution', {
                index: 3,
                title: 'After approval',
                node_type: BlockEnum.TemplateTransform,
                execution_metadata: approval.execution_metadata,
              }),
            ],
          }),
        ),
      )
      rerender(
        <TracingPanel
          list={[root]}
          workflowRun={{ appId: 'app', runId: 'run', status: 'succeeded' }}
        />,
      )

      expect(await screen.findByText(/Approved result/)).toBeInTheDocument()
      expect(screen.getByText('After approval')).toBeInTheDocument()
      expect(screen.getByText('2.00s')).toBeInTheDocument()
      if (containerType === BlockEnum.Loop)
        expect(screen.getByText(/Updated loop variables/)).toBeInTheDocument()
      expect(
        screen.queryByText('workflow.nodes.humanInput.log.reasonContent'),
      ).not.toBeInTheDocument()
      expect(screen.getByText(`workflow.singleRun.${containerType} 1`)).toBeInTheDocument()
    },
  )
})
