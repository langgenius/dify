import type { ReactNode } from 'react'
import type { AgentLogItemWithChildren, NodeTracing } from '@/types/workflow'
import { fireEvent, render, screen } from '@testing-library/react'
import { BlockEnum, NodeRunningStatus } from '../../types'
import ResultPanel from '../result-panel'

const mockUseTranslation = vi.hoisted(() => vi.fn())
const mockCodeEditor = vi.hoisted(() => vi.fn())
const mockLargeDataAlert = vi.hoisted(() => vi.fn())
const mockStatusPanel = vi.hoisted(() => vi.fn())
const mockMetaData = vi.hoisted(() => vi.fn())
const mockErrorHandleTip = vi.hoisted(() => vi.fn())
const mockIterationLogTrigger = vi.hoisted(() => vi.fn())
const mockLoopLogTrigger = vi.hoisted(() => vi.fn())
const mockRetryLogTrigger = vi.hoisted(() => vi.fn())
const mockAgentLogTrigger = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', () => ({
  useTranslation: () => mockUseTranslation(),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  __esModule: true,
  default: (props: {
    title: ReactNode
    value: unknown
    footer?: ReactNode
    tip?: ReactNode
  }) => {
    mockCodeEditor(props)
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

vi.mock('@/app/components/workflow/nodes/_base/components/error-handle/error-handle-tip', () => ({
  __esModule: true,
  default: ({ type }: { type?: string }) => {
    mockErrorHandleTip(type)
    return <div data-testid="error-handle-tip">{type}</div>
  },
}))

vi.mock('@/app/components/workflow/run/iteration-log', () => ({
  IterationLogTrigger: (props: {
    onShowIterationResultList: (detail: unknown, durationMap: unknown) => void
    nodeInfo: { details?: unknown, iterDurationMap?: unknown }
  }) => {
    mockIterationLogTrigger(props)
    return (
      <button
        type="button"
        onClick={() => props.onShowIterationResultList(props.nodeInfo.details, props.nodeInfo.iterDurationMap)}
      >
        iteration-trigger
      </button>
    )
  },
}))

vi.mock('@/app/components/workflow/run/loop-log', () => ({
  LoopLogTrigger: (props: {
    onShowLoopResultList: (detail: unknown, durationMap: unknown) => void
    nodeInfo: { details?: unknown, loopDurationMap?: unknown }
  }) => {
    mockLoopLogTrigger(props)
    return (
      <button
        type="button"
        onClick={() => props.onShowLoopResultList(props.nodeInfo.details, props.nodeInfo.loopDurationMap)}
      >
        loop-trigger
      </button>
    )
  },
}))

vi.mock('@/app/components/workflow/run/retry-log', () => ({
  RetryLogTrigger: (props: {
    onShowRetryResultList: (detail: unknown) => void
    nodeInfo: { retryDetail?: unknown }
  }) => {
    mockRetryLogTrigger(props)
    return (
      <button
        type="button"
        onClick={() => props.onShowRetryResultList(props.nodeInfo.retryDetail)}
      >
        retry-trigger
      </button>
    )
  },
}))

vi.mock('@/app/components/workflow/run/agent-log', () => ({
  AgentLogTrigger: (props: {
    onShowAgentOrToolLog: (detail: unknown) => void
    nodeInfo: { agentLog?: unknown }
  }) => {
    mockAgentLogTrigger(props)
    return (
      <button
        type="button"
        onClick={() => props.onShowAgentOrToolLog(props.nodeInfo.agentLog)}
      >
        agent-trigger
      </button>
    )
  },
}))

vi.mock('@/app/components/workflow/variable-inspect/large-data-alert', () => ({
  __esModule: true,
  default: (props: { downloadUrl?: string }) => {
    mockLargeDataAlert(props)
    return <div data-testid="large-data-alert">{props.downloadUrl ?? 'no-download'}</div>
  },
}))

vi.mock('@/app/components/workflow/run/meta', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    mockMetaData(props)
    return <div data-testid="meta-data">{JSON.stringify(props)}</div>
  },
}))

vi.mock('@/app/components/workflow/run/status', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    mockStatusPanel(props)
    return <div data-testid="status-panel">{JSON.stringify(props)}</div>
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

const createLogDetail = (id: string): NodeTracing => createNodeInfo({
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
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTranslation.mockReturnValue({
      t: (key: string) => key,
    })
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
        execution_metadata={{ error_strategy: 'continue-on-error' }}
        isListening
        workflowRunId="run-1"
      />,
    )

    expect(screen.getByTestId('status-panel')).toBeInTheDocument()
    expect(screen.getByText('COMMON.INPUT')).toBeInTheDocument()
    expect(screen.getByText('COMMON.PROCESSDATA')).toBeInTheDocument()
    expect(screen.getByText('COMMON.OUTPUT')).toBeInTheDocument()
    expect(screen.getAllByTestId('code-editor')).toHaveLength(3)
    expect(screen.getAllByTestId('large-data-alert')).toHaveLength(3)
    expect(screen.getByTestId('error-handle-tip')).toHaveTextContent('continue-on-error')
    expect(screen.getByTestId('meta-data')).toBeInTheDocument()
    expect(mockStatusPanel).toHaveBeenCalledWith(expect.objectContaining({
      status: NodeRunningStatus.Succeeded,
      time: 2.5,
      tokens: 42,
      error: 'boom',
      exceptionCounts: 1,
      isListening: true,
      workflowRunId: 'run-1',
    }))
    expect(mockMetaData).toHaveBeenCalledWith(expect.objectContaining({
      status: NodeRunningStatus.Succeeded,
      executor: 'Alice',
      startTime: 1710000000,
      time: 2.5,
      tokens: 42,
      steps: 3,
      showSteps: true,
    }))
    expect(mockLargeDataAlert).toHaveBeenLastCalledWith(expect.objectContaining({
      downloadUrl: 'https://example.com/output.json',
    }))
  })

  it('should render and invoke iteration and loop triggers only when their handlers are provided', () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'iteration-trigger' }))
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

    fireEvent.click(screen.getByRole('button', { name: 'loop-trigger' }))
    expect(handleShowLoopResultList).toHaveBeenCalledWith(details, { 0: 5 })
  })

  it('should render retry and agent/tool triggers when the node shape supports them', () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'retry-trigger' }))
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

    fireEvent.click(screen.getByRole('button', { name: 'agent-trigger' }))
    expect(handleShowAgentOrToolLog).toHaveBeenCalledWith(agentLog)

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

    fireEvent.click(screen.getByRole('button', { name: 'agent-trigger' }))
    expect(handleShowAgentOrToolLog).toHaveBeenLastCalledWith(agentLog)
  })

  it('should still render the output editor while the node is running even without outputs', () => {
    render(
      <ResultPanel
        nodeInfo={createNodeInfo()}
        inputs="{}"
        status={NodeRunningStatus.Running}
      />,
    )

    expect(screen.getByText('COMMON.OUTPUT')).toBeInTheDocument()
  })
})
