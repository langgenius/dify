import type { AgentToolActivity } from '@dify/contracts/api/console/agent/types.gen'
import { page } from 'vite-plus/test/browser'
import { createChatThoughtFixture } from '@/test/fixtures/chat'
import { chatItem, renderChatOwner } from '../../__tests__/chat-owner-preset'
import { AgentRosterResponseContent } from '../agent-roster-response-content'

vi.unmock('react-i18next')

beforeEach(async () => {
  await page.viewport(1000, 800)
})

it('renders persisted call identity, frozen rejection quota and cancellation without inventing a result', async () => {
  const activity: AgentToolActivity = {
    id: 'run:fourth',
    run_id: 'run',
    tool_call_id: 'fourth',
    tool_name: 'search',
    status: 'not_executed',
    call_limit: {
      tool_identity: 'operation',
      used: 3,
      limit: 3,
      execution_status: 'not_executed',
      reason: 'call_limit_reached',
    },
  }
  const item = chatItem({
    agent_thoughts: [
      createChatThoughtFixture({
        tool: 'search',
        tool_input: '{"query":"rust"}',
        observation: 'Structured denial',
        tool_activity: activity,
        tool_labels: { search: { en_US: 'Search repositories', zh_Hans: '搜索仓库' } },
      }),
    ],
  })
  const screen = await renderChatOwner(<AgentRosterResponseContent item={item} />)
  await page.getByRole('button', { name: 'Thinking' }).click()
  await expect.element(page.getByText('3 of 3 calls used')).toBeVisible()
  await page.getByRole('button', { name: /3 of 3 calls used/ }).click()
  await expect
    .element(page.getByText('Call limit reached (3 per run). This request was not executed.'))
    .toBeVisible()
  await expect.element(page.getByText('Structured denial')).not.toBeInTheDocument()
  await screen.rerender(
    <AgentRosterResponseContent
      item={{
        ...item,
        agent_thoughts: [
          createChatThoughtFixture({
            tool: 'search',
            tool_input: '{"query":"rust"}',
            tool_activity: {
              ...activity,
              status: 'cancelled',
              error: 'Stopped before the result was received.',
              call_limit: {
                tool_identity: 'operation',
                used: 3,
                limit: 3,
                execution_status: 'unconfirmed',
              },
            },
          }),
        ],
      }}
    />,
  )
  await expect.element(page.getByText('Stopped', { exact: true })).toBeVisible()
  await expect.element(page.getByText('Not executed', { exact: true })).not.toBeInTheDocument()
  await expect.element(page.getByText('3 of 3 calls used')).not.toBeInTheDocument()
  // The same tool call keeps its details expanded across the update.
  await expect.element(page.getByText('Stopped before the result was received.')).toBeVisible()
})
