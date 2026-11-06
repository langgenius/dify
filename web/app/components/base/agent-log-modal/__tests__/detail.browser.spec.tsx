import type { AgentLogResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { ComponentProps } from 'react'
import type { IChatItem } from '@/app/components/base/chat/chat/type'
import { userEvent } from 'vite-plus/test/browser'
import { createHttpError } from '@/service/http-error'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import AgentLogDetail from '../detail'
import { renderAgentLog } from './browser-test-env'

const toastMock = vi.hoisted(() => ({ error: vi.fn() }))
const fetchAgentLogDetail = vi.hoisted(() => vi.fn())

vi.mock('@monaco-editor/react', async () => {
  const { createMonacoEditorModuleMock } = await import('@/test/monaco-editor-mock')
  return createMonacoEditorModuleMock()
})

vi.mock('@/service/console', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/console')>()),
  consoleClient: { apps: { byAppId: { agent: { logs: { get: fetchAgentLogDetail } } } } },
}))

vi.mock('@/app/notifications', () => ({ toast: toastMock }))

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({ formatTime: (timestamp: number, format: string) => `${timestamp}-${format}` }),
}))

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
      appId="app-id"
      conversationID="conv-id"
      messageID="msg-id"
      log={log}
      {...props}
    />,
  )
}

beforeEach(() => {
  onTestFinished(guardUnexpectedFetch())
  fetchAgentLogDetail.mockReset()
})

it('shows loading until the requested record resolves', async () => {
  fetchAgentLogDetail.mockReturnValue(new Promise(() => {}))
  const { screen } = await renderDetail()
  await expect.element(screen.getByRole('progressbar')).toBeVisible()
})

it('renders the requested inputs, outputs and execution metadata in real readonly editors', async () => {
  fetchAgentLogDetail.mockResolvedValue(createResponse())
  const { screen } = await renderDetail()
  await expect.element(screen.getByText('User')).toBeVisible()
  const editors = screen.getByTestId('monaco-editor').all()
  expect(editors).toHaveLength(2)
  await expect.element(editors[0]!).toHaveValue(JSON.stringify('user input'))
  await expect.element(editors[1]!).toHaveValue(JSON.stringify('output content'))
  for (const editor of editors) await expect.element(editor).toHaveAttribute('readonly')
  await expect.element(screen.getByRole('status')).toMatchTextContent('100 Tokens')
  await expect.element(screen.getByText('tool1')).toBeVisible()
})

it('switches between detail and tracing with native keyboard focus without refetching', async () => {
  fetchAgentLogDetail.mockResolvedValue(createResponse())
  const { screen } = await renderDetail()
  const detail = screen.getByRole('button', { name: 'runLog.detail' })
  const tracing = screen.getByRole('button', { name: 'runLog.tracing' })
  await expect.element(screen.getByText('User')).toBeVisible()
  await detail.click()
  await userEvent.keyboard('{Tab}')
  await expect.element(tracing).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(screen.getByText('appLog.agentLogDetail.finalProcessing')).toBeVisible()
  await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
  await expect.element(detail).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(screen.getByText('User')).toBeVisible()
  expect(fetchAgentLogDetail).toHaveBeenCalledOnce()
})

it('shows a failed execution consistently in its summary and metadata', async () => {
  const failed = createResponse()
  failed.meta.status = 'failed'
  fetchAgentLogDetail.mockResolvedValue(failed)
  const { screen } = await renderDetail()
  await expect.element(screen.getByText('appLog.status.failed')).toBeVisible()
  await expect.element(screen.getByText('FAILED')).toBeVisible()
  await expect.element(screen.getByText('appLog.status.succeeded')).not.toBeInTheDocument()
})

it('removes loading and reports the service error', async () => {
  fetchAgentLogDetail.mockRejectedValue(
    createHttpError(new Response(null, { status: 500 }), { message: 'API Error' }),
  )
  const { screen } = await renderDetail()
  await expect.poll(() => toastMock.error).toHaveBeenCalledWith('API Error')
  await expect.element(screen.getByRole('progressbar')).not.toBeInTheDocument()
})

it('summarizes empty and repeated trace data from the service response', async () => {
  fetchAgentLogDetail.mockResolvedValueOnce(createResponse({ iterations: [] }))
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
  fetchAgentLogDetail.mockResolvedValueOnce(repeated)
  await rerender(
    <AgentLogDetail
      appId="app-id"
      conversationID="conv-id"
      messageID="next-message"
      log={{ ...log, id: 'next-message' }}
    />,
  )
  await expect.element(screen.getByText('tool1, tool2')).toBeVisible()
  await expect.element(screen.getByText('2', { exact: true })).toBeVisible()
})
