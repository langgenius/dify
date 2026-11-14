import type { AgentLogItemWithChildren } from '@/types/workflow'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { render } from 'vitest-browser-react'
import workflowAgent from '@/i18n/locales/en-US/workflow-agent.json'
import { AgentLogNav } from '../agent-log-nav'

vi.unmock('react-i18next')
const i18n = createInstance().use(initReactI18next)

beforeAll(async () => {
  await i18n.init({
    lng: 'en-US',
    fallbackLng: false,
    keySeparator: false,
    resources: { 'en-US': { workflowAgent } },
  })
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
    <I18nextProvider i18n={i18n}>
      <div style={{ width: 400 }}>
        <AgentLogNav
          agentOrToolLogItemStack={[{ ...item, message_id: 'root', label: 'Strategy' }, item]}
          onShowAgentOrToolLog={() => {}}
        />
      </div>
    </I18nextProvider>,
  )
  await expect.element(screen.getByRole('navigation', { name: 'Agentic Strategy' })).toBeVisible()
  await expect.element(screen.getByText(label)).toBeVisible()
  const navigation = screen.getByRole('navigation').element()
  const current = screen.getByText(label).element()
  const text = document.createRange()
  text.selectNodeContents(current)
  const bounds = navigation.getBoundingClientRect()
  const lines = Array.from(text.getClientRects())
  expect(lines.length).toBeGreaterThan(0)
  for (const line of lines) {
    expect(line.right).toBeLessThanOrEqual(bounds.right)
    expect(line.bottom).toBeLessThanOrEqual(bounds.bottom)
  }
  expect(navigation.scrollWidth).toBeLessThanOrEqual(navigation.clientWidth)
})
