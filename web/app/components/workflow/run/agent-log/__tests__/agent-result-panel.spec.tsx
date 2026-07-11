import type { AgentLogItemWithChildren } from '@/types/workflow'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AgentResultPanel from '../agent-result-panel'

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

describe('AgentResultPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the real child items, shows the circular warning, and opens nested action logs', async () => {
    const user = userEvent.setup()
    const onShowAgentOrToolLog = vi.fn()
    const grandchild = createLogItem({ message_id: 'grandchild', label: 'Tool Call' })
    const child = createLogItem({
      message_id: 'child',
      label: 'Child Tool',
      children: [grandchild],
    })
    const top = createLogItem({ message_id: 'top', label: 'Top', hasCircle: true })

    render(
      <AgentResultPanel
        agentOrToolLogItemStack={[top]}
        agentOrToolLogListMap={{ top: [child] }}
        onShowAgentOrToolLog={onShowAgentOrToolLog}
      />,
    )

    expect(screen.getByText('runLog.circularInvocationTip')).toBeInTheDocument()

    await user.click(screen.getByText('Child Tool'))
    await user.click(screen.getByRole('button', { name: /1 Action Logs/i }))

    expect(onShowAgentOrToolLog).toHaveBeenCalledWith(child)
  })
})
