import type { AgentLogItemWithChildren, NodeTracing } from '@/types/workflow'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum } from '../../../types'
import AgentLogTrigger from '../agent-log-trigger'

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

const createNodeTracing = (overrides: Partial<NodeTracing> = {}): NodeTracing => ({
  id: 'trace-1',
  index: 0,
  predecessor_node_id: '',
  node_id: 'node-1',
  node_type: BlockEnum.Agent,
  title: 'Agent',
  inputs: {},
  inputs_truncated: false,
  process_data: {},
  process_data_truncated: false,
  outputs: {},
  outputs_truncated: false,
  status: 'succeeded',
  error: '',
  elapsed_time: 0.2,
  execution_metadata: {
    total_tokens: 0,
    total_price: 0,
    currency: 'USD',
    tool_info: {
      agent_strategy: 'Plan and execute',
    },
  },
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
  agentLog: [createAgentLogItem()],
  ...overrides,
})

describe('AgentLogTrigger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Agent triggers should expose strategy text and open the log stack payload.
  describe('User Interactions', () => {
    it('should show the agent strategy and pass the log payload on click', async () => {
      const user = userEvent.setup()
      const onShowAgentOrToolLog = vi.fn()
      const agentLog = [createAgentLogItem({ message_id: 'message-1' })]

      render(
        <AgentLogTrigger
          nodeInfo={createNodeTracing({ agentLog })}
          onShowAgentOrToolLog={onShowAgentOrToolLog}
        />,
      )

      expect(screen.getByText('workflow.nodes.agent.strategy.label')).toBeInTheDocument()
      expect(screen.getByText('Plan and execute')).toBeInTheDocument()
      expect(screen.getByText('runLog.detail')).toBeInTheDocument()

      await user.click(screen.getByText('Plan and execute'))

      expect(onShowAgentOrToolLog).toHaveBeenCalledWith({
        message_id: 'trace-1',
        children: agentLog,
      })
    })

    it('should still open the detail view when no strategy label is available', async () => {
      const user = userEvent.setup()
      const onShowAgentOrToolLog = vi.fn()

      render(
        <AgentLogTrigger
          nodeInfo={createNodeTracing({
            execution_metadata: {
              total_tokens: 0,
              total_price: 0,
              currency: 'USD',
            },
          })}
          onShowAgentOrToolLog={onShowAgentOrToolLog}
        />,
      )

      await user.click(screen.getByText('runLog.detail'))

      expect(onShowAgentOrToolLog).toHaveBeenCalledTimes(1)
    })
  })
})
