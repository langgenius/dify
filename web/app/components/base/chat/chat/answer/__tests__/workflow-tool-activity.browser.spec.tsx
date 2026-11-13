import type { WorkflowAgentToolActivity } from '../../../types'
import { page, userEvent } from 'vite-plus/test/browser'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { chatItem, renderChatOwner } from '../../__tests__/chat-owner-preset'
import Answer from '../index'

vi.unmock('react-i18next')
// boundary: real attachment owners read params without a running Next router.
vi.mock('@/next/navigation', () => ({ useParams: () => ({}), usePathname: () => '/chat' }))

beforeEach(async () => {
  await page.viewport(1000, 800)
  onTestFinished(guardUnexpectedFetch())
})

const toolActivity = (
  overrides: Partial<WorkflowAgentToolActivity> = {},
): WorkflowAgentToolActivity => ({
  id: 'run-1:call-1',
  node_id: 'agent-node',
  node_execution_id: 'exec-1',
  label: 'shell_run',
  status: 'started',
  error: null,
  data: {
    tool_call_id: 'call-1',
    tool_name: 'shell_run',
    tool_input: '{"command":"ls"}',
    tool_output: '',
    node_title: 'Research agent',
  },
  ...overrides,
})

it('shows live tool activity before answer text and expands request/response', async () => {
  const screen = await renderChatOwner(
    <Answer
      item={chatItem({ content: '', workflowAgentActivities: [toolActivity()] })}
      question="Question"
      index={0}
      responding
    />,
  )

  await expect.element(page.getByText('Running commands')).toBeVisible()
  await expect.element(page.getByText('Research agent')).toBeVisible()
  await expect.element(page.getByText('An answer')).not.toBeInTheDocument()

  await userEvent.click(page.getByRole('button', { name: /Running commands/ }))
  await expect.element(page.getByText('Request', { exact: true })).toBeVisible()
  await expect.element(page.getByText('{"command":"ls"}', { exact: true })).toBeVisible()

  await screen.rerender(
    <Answer
      item={chatItem({
        content: '',
        workflowAgentActivities: [
          toolActivity({
            status: 'succeeded',
            data: {
              tool_call_id: 'call-1',
              tool_name: 'shell_run',
              tool_input: '{"command":"ls"}',
              tool_output: 'a.txt',
              node_title: 'Research agent',
            },
          }),
        ],
      })}
      question="Question"
      index={0}
      responding
    />,
  )

  await expect.element(page.getByRole('button', { name: /Ran commands/ })).toBeVisible()
  await expect.element(page.getByText('Response', { exact: true })).toBeVisible()
  await expect.element(page.getByText('a.txt', { exact: true })).toBeVisible()

  await screen.rerender(
    <Answer
      item={chatItem({
        content: 'Final answer text',
        workflowAgentActivities: [
          toolActivity({
            status: 'succeeded',
            data: {
              tool_call_id: 'call-1',
              tool_name: 'shell_run',
              tool_input: '{"command":"ls"}',
              tool_output: 'a.txt',
              node_title: 'Research agent',
            },
          }),
        ],
      })}
      question="Question"
      index={0}
    />,
  )

  await expect.element(page.getByText('Final answer text')).toBeVisible()
  await expect.element(page.getByRole('button', { name: /Ran commands/ })).toBeVisible()
})

it('updates same-name parallel calls out of order and keeps per-call request/response pairs', async () => {
  const searchActivity = (id: string, callId: string, status: string, output = '') =>
    toolActivity({
      id,
      label: 'web_search',
      status: status as WorkflowAgentToolActivity['status'],
      data: {
        tool_call_id: callId,
        tool_name: 'web_search',
        tool_input: `{"q":"${callId}"}`,
        tool_output: output,
        node_title: 'Research agent',
      },
    })

  const running = [
    searchActivity('run-1:a', 'a', 'started'),
    searchActivity('run-1:b', 'b', 'started'),
  ]
  const screen = await renderChatOwner(
    <Answer
      item={chatItem({ content: '', workflowAgentActivities: running })}
      question="Question"
      index={0}
      responding
    />,
  )

  const buttons = page.getByRole('button', { name: /web_search/ })
  await expect.poll(() => buttons.elements().length).toBe(2)

  await screen.rerender(
    <Answer
      item={chatItem({
        content: '',
        workflowAgentActivities: [
          searchActivity('run-1:a', 'a', 'started'),
          searchActivity('run-1:b', 'b', 'succeeded', 'result-b'),
        ],
      })}
      question="Question"
      index={0}
      responding
    />,
  )

  await screen.rerender(
    <Answer
      item={chatItem({
        content: '',
        workflowAgentActivities: [
          searchActivity('run-1:a', 'a', 'succeeded', 'result-a'),
          searchActivity('run-1:b', 'b', 'succeeded', 'result-b'),
        ],
      })}
      question="Question"
      index={0}
      responding
    />,
  )

  await expect.poll(() => buttons.elements().length).toBe(2)

  await userEvent.click(buttons.nth(0))
  await userEvent.click(buttons.nth(1))

  await expect.element(page.getByText('result-a', { exact: true })).toBeVisible()
  await expect.element(page.getByText('result-b', { exact: true })).toBeVisible()

  const values = [
    ...page
      .getByTestId('workflow-tool-activity')
      .element()
      .querySelectorAll('.whitespace-pre-wrap'),
  ].map((element) => element.textContent)
  expect(values).toEqual(['{"q":"a"}', 'result-a', '{"q":"b"}', 'result-b'])
})

it('shows readable failed, cancelled, and interrupted statuses with the original tool label', async () => {
  const failed = toolActivity({
    status: 'failed',
    error: 'command not found',
    data: {
      tool_call_id: 'call-1',
      tool_name: 'shell_run',
      tool_input: '{"command":"nope"}',
      tool_output: '',
      node_title: 'Research agent',
    },
  })
  const cancelled = toolActivity({
    id: 'run-1:call-2',
    label: 'web_search',
    status: 'cancelled',
    error: 'run cancelled',
    data: {
      tool_call_id: 'call-2',
      tool_name: 'web_search',
      tool_input: '{"q":"dify"}',
      tool_output: '',
      node_title: 'Research agent',
    },
  })
  const unfinished = toolActivity({
    id: 'run-1:call-3',
    label: 'web_search',
    status: 'started',
    data: {
      tool_call_id: 'call-3',
      tool_name: 'web_search',
      tool_input: '{"q":"open"}',
      tool_output: '',
      node_title: 'Research agent',
    },
  })

  const screen = await renderChatOwner(
    <Answer
      item={chatItem({
        content: '',
        workflowAgentActivities: [failed, cancelled, unfinished],
      })}
      question="Question"
      index={0}
      responding
    />,
  )

  await expect.element(page.getByRole('button', { name: /shell_run/ })).toBeVisible()
  await expect.element(page.getByRole('button', { name: /web_search/ }).nth(0)).toBeVisible()
  await expect.element(page.getByText('Failed', { exact: true })).toBeVisible()
  await expect.element(page.getByText('Stopped', { exact: true })).toBeVisible()
  await expect.element(page.getByText('Ran commands')).not.toBeInTheDocument()

  await userEvent.click(page.getByRole('button', { name: /shell_run/ }))
  await expect.element(page.getByText('command not found', { exact: true })).toBeVisible()

  await screen.rerender(
    <Answer
      item={chatItem({
        content: '',
        workflowAgentActivities: [failed, cancelled, unfinished],
      })}
      question="Question"
      index={0}
    />,
  )

  await expect.poll(() => page.getByText('Stopped', { exact: true }).elements().length).toBe(2)
})
