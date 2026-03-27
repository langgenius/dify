/* eslint-disable ts/no-explicit-any, style/jsx-one-expression-per-line */
import type { AgentLogItemWithChildren } from '@/types/workflow'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AgentLogNav from '../agent-log-nav'
import AgentLogNavMore from '../agent-log-nav-more'
import AgentResultPanel from '../agent-result-panel'

vi.mock('../agent-log-item', () => ({
  default: ({ item, onShowAgentOrToolLog }: any) => (
    <button type="button" onClick={() => onShowAgentOrToolLog(item)}>
      item-{item.label}
    </button>
  ),
}))

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

describe('agent-log leaf components', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // The navigation and result views should expose stack navigation and nested agent log entries.
  describe('Navigation and Results', () => {
    it('should navigate back, open intermediate entries, and show the tail label', async () => {
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

    it('should render the more menu options as shortcuts to nested logs', async () => {
      const user = userEvent.setup()
      const onShowAgentOrToolLog = vi.fn()
      const option = createLogItem({ message_id: 'mid', label: 'Intermediate Tool' })

      render(
        <AgentLogNavMore
          options={[option]}
          onShowAgentOrToolLog={onShowAgentOrToolLog}
        />,
      )

      await user.click(screen.getByRole('button'))
      await user.click(screen.getByText('Intermediate Tool'))

      expect(onShowAgentOrToolLog).toHaveBeenCalledWith(option)
    })

    it('should render result items and the circular invocation warning', async () => {
      const user = userEvent.setup()
      const onShowAgentOrToolLog = vi.fn()
      const top = createLogItem({ message_id: 'top', label: 'Top', hasCircle: true })
      const child = createLogItem({ message_id: 'child', label: 'Child Tool' })

      render(
        <AgentResultPanel
          agentOrToolLogItemStack={[top]}
          agentOrToolLogListMap={{ top: [child] }}
          onShowAgentOrToolLog={onShowAgentOrToolLog}
        />,
      )

      expect(screen.getByText('runLog.circularInvocationTip')).toBeInTheDocument()

      await user.click(screen.getByText('item-Child Tool'))

      expect(onShowAgentOrToolLog).toHaveBeenCalledWith(child)
    })
  })
})
