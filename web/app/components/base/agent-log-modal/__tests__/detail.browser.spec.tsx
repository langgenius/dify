import type { AgentLogResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { ComponentProps } from 'react'
import type { IChatItem } from '@/app/components/base/chat/chat/type'
import { userEvent } from 'vite-plus/test/browser'
import { toast } from '@/app/notifications'
import { apiError, setupFakeApi } from '@/test/fake-api'
import AgentLogDetail from '../detail'
import { renderAgentLog } from './browser-test-env'

// The contract requires UUID app ids.
const appId = '0f8e2c1a-7b3d-4e5f-8a9b-0c1d2e3f4a5b'

vi.unmock('react-i18next')

const log: IChatItem = {
  id: 'msg-id',
  content: 'output content',
  isAnswer: false,
  conversationId: 'conv-id',
  input: 'user input',
}

const createResponse = (overrides: Partial<AgentLogResponse> = {}): AgentLogResponse => ({
  meta: {
    status: 'succeeded',
    executor: 'User',
    start_time: '2023-01-01',
    elapsed_time: 1,
    total_tokens: 100,
    agent_mode: 'function_call',
    iterations: 1,
  },
  iterations: [
    {
      created_at: '',
      files: [],
      thought: 'Final answer',
      tokens: 7,
      tool_raw: { inputs: '', outputs: '' },
      tool_calls: [
        {
          tool_name: 'tool1',
          status: 'success',
          tool_icon: null,
          time_cost: 0,
          tool_input: {},
          tool_output: {},
          tool_parameters: {},
          tool_label: { 'en-US': 'Tool 1' },
        },
      ],
    },
  ],
  files: [],
  ...overrides,
})

async function renderDetail(props: Partial<ComponentProps<typeof AgentLogDetail>> = {}) {
  return renderAgentLog(
    <AgentLogDetail
      appId={appId}
      conversationID="conv-id"
      messageID="msg-id"
      log={log}
      {...props}
    />,
  )
}

const fake = setupFakeApi(() => ({
  console: {
    apps: {
      byAppId: { agent: { logs: { get: () => createResponse() } } },
    },
  },
}))

beforeEach(() => {
  toast.dismiss()
})

it('shows loading until the requested record resolves', async () => {
  fake.console.apps.byAppId.agent.logs.get.mockReturnValue(new Promise(() => {}))
  const { screen } = await renderDetail()
  await expect.element(screen.getByRole('progressbar')).toBeVisible()
})

it('renders the requested inputs, outputs and execution metadata in real readonly editors', async () => {
  const { screen } = await renderDetail()
  await expect.element(screen.getByText('User')).toBeVisible()
  await expect.element(screen.getByText('"user input"')).toBeVisible()
  await expect.element(screen.getByText('"output content"')).toBeVisible()
  const editors = screen.getByRole('textbox', { name: 'Editor content' })
  await expect.poll(() => editors.all().length).toBe(2)
  for (const editor of editors.all()) await expect.element(editor).toHaveAttribute('readonly')
  await expect.element(screen.getByRole('status')).toMatchTextContent('100 Tokens')
  await expect.element(screen.getByText('tool1')).toBeVisible()
  await expect.element(screen.getByText('01/01/2023 08:00:00 AM')).toBeVisible()
})

it('switches between detail and tracing with native keyboard focus without refetching', async () => {
  const { screen } = await renderDetail()
  const detail = screen.getByRole('button', { name: 'DETAIL' })
  const tracing = screen.getByRole('button', { name: 'TRACING' })
  await expect.element(screen.getByText('User')).toBeVisible()
  await detail.click()
  await userEvent.keyboard('{Tab}')
  await expect.element(tracing).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(screen.getByText('Final Processing')).toBeVisible()
  await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
  await expect.element(detail).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(screen.getByText('User')).toBeVisible()
  expect(fake.console.apps.byAppId.agent.logs.get).toHaveBeenCalledOnce()
})

it('shows a failed execution consistently in its summary and metadata', async () => {
  const failed = createResponse()
  failed.meta.status = 'failed'
  fake.console.apps.byAppId.agent.logs.get.mockResolvedValue(failed)
  const { screen } = await renderDetail()
  await expect.element(screen.getByText('Failure')).toBeVisible()
  await expect.element(screen.getByText('FAILED')).toBeVisible()
  await expect.element(screen.getByText('Success')).not.toBeInTheDocument()
})

it('removes loading and reports the service error', async () => {
  fake.console.apps.byAppId.agent.logs.get.mockRejectedValue(
    apiError({ status: 500, code: 'INTERNAL_SERVER_ERROR', message: 'API Error' }),
  )
  const { screen } = await renderDetail()
  await expect.element(screen.getByRole('dialog', { name: 'API Error' })).toBeVisible()
  await expect.element(screen.getByRole('progressbar')).not.toBeInTheDocument()
})

it('summarizes empty and repeated trace data from the service response', async () => {
  fake.console.apps.byAppId.agent.logs.get.mockResolvedValueOnce(createResponse({ iterations: [] }))
  const { rerender, screen } = await renderDetail()
  await expect.element(screen.getByText('Null')).toBeVisible()
  await expect.element(screen.getByText('0', { exact: true })).toBeVisible()

  const repeated = createResponse()
  repeated.iterations = [
    repeated.iterations[0]!,
    {
      ...repeated.iterations[0]!,
      tool_calls: [
        repeated.iterations[0]!.tool_calls[0]!,
        { ...repeated.iterations[0]!.tool_calls[0]!, tool_name: 'tool2' },
      ],
    },
  ]
  fake.console.apps.byAppId.agent.logs.get.mockResolvedValueOnce(repeated)
  await rerender(
    <AgentLogDetail
      appId={appId}
      conversationID="conv-id"
      messageID="next-message"
      log={{ ...log, id: 'next-message' }}
    />,
  )
  await expect.element(screen.getByText('tool1, tool2')).toBeVisible()
  await expect.element(screen.getByText('2', { exact: true })).toBeVisible()
})

it('keeps showing the current record when an earlier request resolves late', async () => {
  let resolveFirst!: (value: AgentLogResponse) => void
  fake.console.apps.byAppId.agent.logs.get.mockReturnValueOnce(
    new Promise<AgentLogResponse>((resolve) => {
      resolveFirst = resolve
    }),
  )
  const { rerender, screen } = await renderDetail()
  const current = createResponse()
  current.meta.executor = 'Current executor'
  fake.console.apps.byAppId.agent.logs.get.mockResolvedValueOnce(current)
  await rerender(
    <AgentLogDetail
      appId={appId}
      conversationID="conv-id"
      messageID="next-message"
      log={{ ...log, id: 'next-message' }}
    />,
  )
  await expect.element(screen.getByText('Current executor')).toBeVisible()
  const stale = createResponse()
  stale.meta.executor = 'Stale executor'
  resolveFirst(stale)
  await expect.element(screen.getByText('Stale executor')).not.toBeInTheDocument()
  await expect.element(screen.getByText('Current executor')).toBeVisible()
})
