import type { AgentLogItemWithChildren } from '@/types/workflow'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AgentLogItem from '../agent-log-item'

const createLogItem = (overrides: Partial<AgentLogItemWithChildren> = {}): AgentLogItemWithChildren => ({
  message_id: 'message-1',
  label: 'Planner',
  children: [],
  status: 'succeeded',
  node_execution_id: 'exec-1',
  node_id: 'node-1',
  data: { thought: 'inspect data' },
  metadata: {
    elapsed_time: 1.234,
  },
  ...overrides,
})

describe('AgentLogItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('expands to show action logs and data, then routes nested log clicks', async () => {
    const user = userEvent.setup()
    const onShowAgentOrToolLog = vi.fn()
    const child = createLogItem({ message_id: 'child', label: 'Tool Call' })
    const item = createLogItem({
      children: [child],
    })

    render(
      <AgentLogItem
        item={item}
        onShowAgentOrToolLog={onShowAgentOrToolLog}
      />,
    )

    expect(screen.getByText('Planner')).toBeInTheDocument()
    expect(screen.getByText((_, node) => node?.textContent === '1.234s')).toBeInTheDocument()

    await user.click(screen.getByText('Planner'))

    expect(screen.getByRole('button', { name: /1 Action Logs/i })).toBeInTheDocument()
    expect((screen.getByTestId('monaco-editor') as HTMLTextAreaElement).value).toContain('inspect data')

    await user.click(screen.getByRole('button', { name: /1 Action Logs/i }))

    expect(onShowAgentOrToolLog).toHaveBeenCalledWith(item)
  })
})
