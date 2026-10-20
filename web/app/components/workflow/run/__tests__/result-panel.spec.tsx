import type { ReactNode } from 'react'
import type { AgentLogItemWithChildren, NodeTracing } from '@/types/workflow'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowComponent as render } from '../../__tests__/workflow-test-env'
import { BlockEnum, NodeRunningStatus, WorkflowRunningStatus } from '../../types'
import ResultPanel from '../result-panel'

vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  __esModule: true,
  default: (props: { title: ReactNode; value: unknown; footer?: ReactNode; tip?: ReactNode }) => {
    return (
      <section data-testid="code-editor">
        <div>{props.title}</div>
        <div>{typeof props.value === 'string' ? props.value : JSON.stringify(props.value)}</div>
        {props.tip}
        {props.footer}
      </section>
    )
  },
}))

const createNodeInfo = (overrides: Partial<NodeTracing> = {}): NodeTracing => ({
  id: 'trace-node-1',
  index: 0,
  predecessor_node_id: '',
  node_id: 'node-1',
  node_type: BlockEnum.Code,
  title: 'Code',
  inputs: {},
  inputs_truncated: false,
  process_data: {},
  process_data_truncated: false,
  outputs_truncated: false,
  status: NodeRunningStatus.Succeeded,
  elapsed_time: 0,
  metadata: {
    iterator_length: 0,
    iterator_index: 0,
    loop_length: 0,
    loop_index: 0,
  },
  created_at: 0,
  created_by: {
    id: 'user-1',
    name: 'User',
    email: 'user@example.com',
  },
  finished_at: 1,
  details: undefined,
  retryDetail: undefined,
  agentLog: undefined,
  iterDurationMap: undefined,
  loopDurationMap: undefined,
  ...overrides,
})

const createLogDetail = (id: string): NodeTracing =>
  createNodeInfo({
    id: `trace-${id}`,
    node_id: id,
    title: id,
  })

const createAgentLog = (label: string): AgentLogItemWithChildren => ({
  node_execution_id: `execution-${label}`,
  message_id: `message-${label}`,
  node_id: `node-${label}`,
  parent_id: undefined,
  label,
  status: 'success',
  data: {},
  metadata: {},
  children: [],
})

describe('ResultPanel', () => {
  it('offers Builder only for a failed workflow run', async () => {
    const user = userEvent.setup()
    const onFixRun = vi.fn()
    const { rerender } = render(
      <ResultPanel
        status={WorkflowRunningStatus.Failed}
        workflowRunId="failed-run"
        onFixRun={onFixRun}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'difyBuilder.fixRun' }))
    expect(onFixRun).toHaveBeenCalledWith('failed-run')
    rerender(
      <ResultPanel
        status={WorkflowRunningStatus.Succeeded}
        workflowRunId="successful-run"
        onFixRun={onFixRun}
      />,
    )
    expect(screen.queryByRole('button', { name: 'difyBuilder.fixRun' })).not.toBeInTheDocument()
  })
  it('should render status, editors, alerts, error strategy tip, and metadata', () => {
    render(
      <ResultPanel
        nodeInfo={createNodeInfo()}
        inputs={JSON.stringify({ topic: 'AI' })}
        inputs_truncated
        process_data={JSON.stringify({ step: 1 })}
        process_data_truncated
        outputs={{ answer: 'done' }}
        outputs_truncated
        outputs_full_content={{ download_url: 'https://example.com/output.json' }}
        status={NodeRunningStatus.Succeeded}
        error="boom"
        elapsed_time={2.5}
        total_tokens={42}
        created_at={1710000000}
        created_by="Alice"
        steps={3}
        showSteps
        exceptionCounts={1}
        execution_metadata={{ error_strategy: 'default-value' }}
        isListening
        workflowRunId="run-1"
      />,
    )

    expect(screen.getByText('WORKFLOW.COMMON.INPUT')).toBeInTheDocument()
    expect(screen.getByText('WORKFLOW.COMMON.PROCESSDATA')).toBeInTheDocument()
    expect(screen.getByText('WORKFLOW.COMMON.OUTPUT')).toBeInTheDocument()
    expect(screen.getByText('{"answer":"done"}')).toBeInTheDocument()
    expect(
      screen.getAllByText('workflowDebug.debug.variableInspect.largeDataNoExport'),
    ).toHaveLength(3)
    expect(
      screen.getByText('workflow.nodes.common.errorHandle.defaultValue.inLog'),
    ).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getAllByText('2.500s')).toHaveLength(2)
    expect(screen.getAllByText('42 Tokens')).toHaveLength(2)
    expect(
      screen.getByRole('link', { name: 'workflowDebug.debug.variableInspect.export' }),
    ).toHaveAttribute('href', 'https://example.com/output.json')
  })

  it('opens iteration and loop details with their execution durations', async () => {
    const user = userEvent.setup()
    const handleShowIterationResultList = vi.fn()
    const handleShowLoopResultList = vi.fn()
    const details = [[createLogDetail('iter-1')]]

    const { rerender } = render(
      <ResultPanel
        nodeInfo={createNodeInfo({
          node_type: BlockEnum.Iteration,
          details,
          iterDurationMap: { 0: 3 },
        })}
        status={NodeRunningStatus.Running}
        handleShowIterationResultList={handleShowIterationResultList}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: /workflowLogic.nodes.iteration.iteration/ }),
    )
    expect(handleShowIterationResultList).toHaveBeenCalledWith(details, { 0: 3 })

    rerender(
      <ResultPanel
        nodeInfo={createNodeInfo({
          node_type: BlockEnum.Loop,
          details,
          loopDurationMap: { 0: 5 },
        })}
        status={NodeRunningStatus.Running}
        handleShowLoopResultList={handleShowLoopResultList}
      />,
    )

    await user.click(screen.getByRole('button', { name: /workflowLogic.nodes.loop.loop/ }))
    expect(handleShowLoopResultList).toHaveBeenCalledWith(details, { 0: 5 }, {})
  })

  it('opens retry and agent/tool details for supported node types', async () => {
    const user = userEvent.setup()
    const onShowRetryDetail = vi.fn()
    const handleShowAgentOrToolLog = vi.fn()
    const retryDetail = [createLogDetail('retry-1')]
    const agentLog = [createAgentLog('tool-call')]

    const { rerender } = render(
      <ResultPanel
        nodeInfo={createNodeInfo({
          node_type: BlockEnum.Code,
          retryDetail,
        })}
        status={NodeRunningStatus.Succeeded}
        onShowRetryDetail={onShowRetryDetail}
      />,
    )

    await user.click(screen.getByRole('button', { name: /workflow.nodes.common.retry.retries/ }))
    expect(onShowRetryDetail).toHaveBeenCalledWith(retryDetail)

    rerender(
      <ResultPanel
        nodeInfo={createNodeInfo({
          node_type: BlockEnum.Agent,
          agentLog,
        })}
        status={NodeRunningStatus.Succeeded}
        handleShowAgentOrToolLog={handleShowAgentOrToolLog}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: /workflowAgent.nodes.agent.strategy.label/ }),
    )
    expect(handleShowAgentOrToolLog).toHaveBeenCalledWith({
      message_id: 'trace-node-1',
      children: agentLog,
    })

    rerender(
      <ResultPanel
        nodeInfo={createNodeInfo({
          node_type: BlockEnum.AgentV2,
          agentLog,
        })}
        status={NodeRunningStatus.Succeeded}
        handleShowAgentOrToolLog={handleShowAgentOrToolLog}
      />,
    )

    expect(
      screen.queryByRole('button', { name: /workflowAgent.nodes.agent.strategy.label/ }),
    ).not.toBeInTheDocument()

    rerender(
      <ResultPanel
        nodeInfo={createNodeInfo({
          node_type: BlockEnum.Tool,
          agentLog,
        })}
        status={NodeRunningStatus.Succeeded}
        handleShowAgentOrToolLog={handleShowAgentOrToolLog}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: /workflowAgent.nodes.agent.strategy.label/ }),
    )
    expect(handleShowAgentOrToolLog).toHaveBeenLastCalledWith({
      message_id: 'trace-node-1',
      children: agentLog,
    })
  })

  it('should still render the output editor while the node is running even without outputs', () => {
    render(
      <ResultPanel nodeInfo={createNodeInfo()} inputs="{}" status={NodeRunningStatus.Running} />,
    )

    expect(screen.getByText('WORKFLOW.COMMON.OUTPUT')).toBeInTheDocument()
  })
})
