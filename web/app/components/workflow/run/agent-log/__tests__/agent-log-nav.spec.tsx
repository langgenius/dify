import type { AgentLogItemWithChildren } from '@/types/workflow'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AgentLogNav from '../agent-log-nav'

const createLogItem = (overrides: Partial<AgentLogItemWithChildren> = {}): AgentLogItemWithChildren => ({
  message_id: 'message-1',
  label: 'Planner',
  children: [],
  status: 'succeeded',
  node_execution_id: 'exec-1',
  node_id: 'node-1',
  data: {},
  ...overrides,
})

describe('AgentLogNav', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('navigates back, opens intermediate entries, and shows the tail label', async () => {
    const user = userEvent.setup()
    const onShowAgentOrToolLog = vi.fn()
    const stack = [
      createLogItem({ message_id: 'root', label: 'Strategy' }),
      createLogItem({ message_id: 'mid', label: 'Tool A' }),
      createLogItem({ message_id: 'tail', label: 'Tool B' }),
    ]

    render(
      <AgentLogNav
        agentOrToolLogItemStack={stack}
        onShowAgentOrToolLog={onShowAgentOrToolLog}
      />,
    )

    await user.click(screen.getByRole('button', { name: /^AGENT$/i }))
    await user.click(screen.getByRole('button', { name: /^workflow\.nodes\.agent\.strategy\.label$/ }))
    await user.click(screen.getAllByRole('button')[2]!)
    await user.click(screen.getByText('Tool A'))

    expect(onShowAgentOrToolLog.mock.calls[0]).toHaveLength(0)
    expect(onShowAgentOrToolLog).toHaveBeenNthCalledWith(2, stack[0])
    expect(onShowAgentOrToolLog).toHaveBeenNthCalledWith(3, stack[1])
    expect(screen.getByText('Tool B')).toBeInTheDocument()
  })
})
