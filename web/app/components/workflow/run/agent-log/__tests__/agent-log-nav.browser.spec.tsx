import type { AgentLogItemWithChildren } from '@/types/workflow'
import { render } from 'vitest-browser-react'
import { AgentLogNav } from '../agent-log-nav'

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return createReactI18nextMock({ 'workflow.nodes.agent.strategy.label': 'Strategy' })
})

it('keeps a long current log name readable inside the result panel', async () => {
  const label = 'Research and development platform engineering operations team'
  const item: AgentLogItemWithChildren = {
    message_id: 'tool',
    label,
    children: [],
    status: 'succeeded',
    node_execution_id: 'exec',
    node_id: 'node',
    data: {},
  }
  const screen = await render(
    <div style={{ width: 400 }}>
      <AgentLogNav
        agentOrToolLogItemStack={[{ ...item, message_id: 'root', label: 'Strategy' }, item]}
        onShowAgentOrToolLog={() => {}}
      />
    </div>,
  )
  const navigation = screen.getByRole('navigation').element()
  const current = screen.getByText(label).element()
  const text = document.createRange()
  text.selectNodeContents(current)
  const bounds = navigation.getBoundingClientRect()
  for (const line of text.getClientRects()) {
    expect(line.right).toBeLessThanOrEqual(bounds.right)
    expect(line.bottom).toBeLessThanOrEqual(bounds.bottom)
  }
  expect(navigation.scrollWidth).toBeLessThanOrEqual(navigation.clientWidth)
})
