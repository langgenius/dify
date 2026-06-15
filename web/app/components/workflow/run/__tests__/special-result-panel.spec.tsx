import type { AgentLogItemWithChildren, NodeTracing } from '@/types/workflow'
import { fireEvent, render, screen } from '@testing-library/react'
import { BlockEnum } from '../../types'
import SpecialResultPanel from '../special-result-panel'

const mocks = vi.hoisted(() => ({
  retryPanel: vi.fn(),
  iterationPanel: vi.fn(),
  loopPanel: vi.fn(),
  agentPanel: vi.fn(),
}))

vi.mock('../retry-log', () => ({
  RetryResultPanel: ({ list }: { list: NodeTracing[] }) => {
    mocks.retryPanel(list)
    return <div data-testid="retry-result-panel">{list.length}</div>
  },
}))

vi.mock('../iteration-log', () => ({
  IterationResultPanel: ({ list }: { list: NodeTracing[][] }) => {
    mocks.iterationPanel(list)
    return <div data-testid="iteration-result-panel">{list.length}</div>
  },
}))

vi.mock('../loop-log', () => ({
  LoopResultPanel: ({ list }: { list: NodeTracing[][] }) => {
    mocks.loopPanel(list)
    return <div data-testid="loop-result-panel">{list.length}</div>
  },
}))

vi.mock('../agent-log', () => ({
  AgentResultPanel: ({ agentOrToolLogItemStack }: { agentOrToolLogItemStack: AgentLogItemWithChildren[] }) => {
    mocks.agentPanel(agentOrToolLogItemStack)
    return <div data-testid="agent-result-panel">{agentOrToolLogItemStack.length}</div>
  },
}))

const createNodeTracing = (overrides: Partial<NodeTracing> = {}): NodeTracing => ({
  id: 'trace-1',
  index: 0,
  predecessor_node_id: '',
  node_id: 'node-1',
  node_type: BlockEnum.Code,
  title: 'Code',
  inputs: {},
  inputs_truncated: false,
  process_data: {},
  process_data_truncated: false,
  outputs: {},
  outputs_truncated: false,
  status: 'succeeded',
  error: '',
  elapsed_time: 0.2,
  metadata: {
    iterator_length: 0,
    iterator_index: 0,
    loop_length: 0,
    loop_index: 0,
  },
  created_at: 1710000000,
  created_by: {
    id: 'user-1',
    name: 'Alice',
    email: 'alice@example.com',
  },
  finished_at: 1710000001,
  execution_metadata: undefined,
  ...overrides,
})

const createAgentLogItem = (overrides: Partial<AgentLogItemWithChildren> = {}): AgentLogItemWithChildren => ({
  node_execution_id: 'exec-1',
  message_id: 'message-1',
  node_id: 'node-1',
  label: 'Step 1',
  data: {},
  status: 'succeeded',
  children: [],
  ...overrides,
})

describe('SpecialResultPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // The wrapper should isolate clicks from the parent tracing card.
  describe('Event Isolation', () => {
    it('should stop click propagation at the wrapper level', () => {
      const parentClick = vi.fn()

      const { container } = render(
        <div onClick={parentClick}>
          <SpecialResultPanel />
        </div>,
      )

      const panelRoot = container.firstElementChild?.firstElementChild
      if (!panelRoot)
        throw new Error('Expected panel root element')

      fireEvent.click(panelRoot)

      expect(parentClick).not.toHaveBeenCalled()
    })
  })

  // Panel branches should render only when their required props are present.
  describe('Conditional Panels', () => {
    it('should render retry, iteration, loop, and agent panels when their data is provided', () => {
      const retryList = [createNodeTracing()]
      const iterationList = [[createNodeTracing({ id: 'iter-1' })]]
      const loopList = [[createNodeTracing({ id: 'loop-1' })]]
      const agentStack = [createAgentLogItem()]
      const agentMap = {
        'message-1': [createAgentLogItem()],
      }

      render(
        <SpecialResultPanel
          showRetryDetail
          setShowRetryDetailFalse={vi.fn()}
          retryResultList={retryList}
          showIteratingDetail
          setShowIteratingDetailFalse={vi.fn()}
          iterationResultList={iterationList}
          showLoopingDetail
          setShowLoopingDetailFalse={vi.fn()}
          loopResultList={loopList}
          agentOrToolLogItemStack={agentStack}
          agentOrToolLogListMap={agentMap}
          handleShowAgentOrToolLog={vi.fn()}
        />,
      )

      expect(screen.getByTestId('retry-result-panel')).toHaveTextContent('1')
      expect(screen.getByTestId('iteration-result-panel')).toHaveTextContent('1')
      expect(screen.getByTestId('loop-result-panel')).toHaveTextContent('1')
      expect(screen.getByTestId('agent-result-panel')).toHaveTextContent('1')
      expect(mocks.retryPanel).toHaveBeenCalledWith(retryList)
      expect(mocks.iterationPanel).toHaveBeenCalledWith(iterationList)
      expect(mocks.loopPanel).toHaveBeenCalledWith(loopList)
      expect(mocks.agentPanel).toHaveBeenCalledWith(agentStack)
    })

    it('should keep panels hidden when required guards are missing', () => {
      render(
        <SpecialResultPanel
          showRetryDetail
          retryResultList={[]}
          showIteratingDetail
          iterationResultList={[]}
          showLoopingDetail
          loopResultList={[]}
          agentOrToolLogItemStack={[createAgentLogItem()]}
        />,
      )

      expect(screen.queryByTestId('retry-result-panel')).not.toBeInTheDocument()
      expect(screen.queryByTestId('iteration-result-panel')).not.toBeInTheDocument()
      expect(screen.queryByTestId('loop-result-panel')).not.toBeInTheDocument()
      expect(screen.queryByTestId('agent-result-panel')).not.toBeInTheDocument()
    })
  })
})
