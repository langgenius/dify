import type {
  ConversationDetail,
  ConversationMessageDetail,
} from '@dify/contracts/api/console/apps/types.gen'
import type { ComponentProps } from 'react'
import type { WorkflowRunDetailResponse } from '@/models/log'
import type { consoleClient } from '@/service/console'
import {
  zConversationDetail,
  zConversationMessageDetail,
} from '@dify/contracts/api/console/apps/zod.gen'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { toast } from '@/app/notifications'
import { AppToastHost } from '@/app/notifications/host'
import {
  createCatalogModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import ConversationList from '../list'

const api = vi.hoisted(() => ({
  messages: vi.fn<typeof consoleClient.apps.byAppId.chatMessages.get>(),
  feedback: vi.fn<typeof consoleClient.apps.byAppId.feedbacks.post>(),
  addAnnotation: vi.fn<typeof consoleClient.apps.byAppId.annotations.post>(),
  editAnnotation: vi.fn<typeof consoleClient.apps.byAppId.annotations.byAnnotationId.post>(),
  removeAnnotation: vi.fn<typeof consoleClient.apps.byAppId.annotations.byAnnotationId.delete>(),
  chatDetail: vi.fn<typeof consoleClient.apps.byAppId.chatConversations.byConversationId.get>(),
  completionDetail:
    vi.fn<typeof consoleClient.apps.byAppId.completionConversations.byConversationId.get>(),
  agentLog: vi.fn<typeof consoleClient.apps.byAppId.agent.logs.get>(),
  run: vi.fn<typeof import('@/service/log').fetchRunDetail>(),
  tracing: vi.fn<typeof import('@/service/log').fetchTracingList>(),
}))

vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({ appId: 'app-1' }),
  usePathname: () => '/app/app-1/logs',
}))
vi.mock('@/service/log', () => ({ fetchRunDetail: api.run, fetchTracingList: api.tracing }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.chatMessages.get': (input) => api.messages(input),
      'apps.byAppId.chatConversations.byConversationId.get': (input) => api.chatDetail(input),
      'apps.byAppId.completionConversations.byConversationId.get': (input) =>
        api.completionDetail(input),
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'apps.byAppId.chatMessages.get': (input) => api.messages(input),
      'apps.byAppId.feedbacks.post': (input) => api.feedback(input),
      'apps.byAppId.annotations.post': (input) => api.addAnnotation(input),
      'apps.byAppId.annotations.byAnnotationId.post': (input) => api.editAnnotation(input),
      'apps.byAppId.annotations.byAnnotationId.delete': (input) => api.removeAnnotation(input),
      'apps.byAppId.agent.logs.get': (input) => api.agentLog(input),
    }),
  }
})
const createLogs = () => ({
  has_more: false,
  limit: 20,
  page: 1,
  total: 1,
  data: [
    {
      from_source: 'api',
      status: 'normal',
      summary: '',
      id: 'conversation-1',
      name: 'hello world',
      from_account_name: 'demo-user',
      read_at: null,
      message_count: 2,
      user_feedback_stats: { like: 0, dislike: 0 },
      admin_feedback_stats: { like: 0, dislike: 0 },
      updated_at: 1710000000,
      created_at: 1710000000,
      annotated: false,
    },
  ],
})

const createCompletionLogs = () => ({
  has_more: false,
  limit: 20,
  page: 1,
  total: 1,
  data: [
    {
      from_source: 'api',
      status: 'normal',
      id: 'conversation-1',
      from_account_name: 'demo-user',
      read_at: null,
      user_feedback_stats: { like: 0, dislike: 0 },
      admin_feedback_stats: { like: 0, dislike: 0 },
      updated_at: 1710000000,
      created_at: 1710000000,
      message: {
        message: 'Question',
        query: 'Question',
        inputs: {
          query: 'Question',
        },
        answer: 'Answer',
      },
      annotation: {
        id: 'annotation-1',
        content: 'Annotated answer',
        account: { id: 'account-1', email: 'admin@example.com', name: 'Admin' },
        created_at: 1710000100,
      },
    },
  ],
})

type MessageDetailResponse = Awaited<
  ReturnType<typeof consoleClient.apps.byAppId.chatMessages.get>
>['data'][number]

const createChatMessage = (
  id: string,
  overrides: Partial<MessageDetailResponse> = {},
): MessageDetailResponse => ({
  id,
  conversation_id: 'conversation-1',
  agent_thoughts: [],
  metadata: {},
  from_source: 'console',
  provider_response_latency: 0,
  status: 'normal',
  answer: `Assistant reply ${id}`,
  query: `Question ${id}`,
  created_at: 1710000000,
  inputs: {
    query: `Question ${id}`,
  },
  feedbacks: [],
  message: [],
  message_files: [],
  answer_tokens: 10,
  message_tokens: 5,
  parent_message_id: null,
  ...overrides,
})

const createChatDetail = (overrides: Partial<ConversationDetail> = {}): ConversationDetail =>
  zConversationDetail.parse({
    id: 'conversation-1',
    from_source: 'console',
    status: 'normal',
    annotated: false,
    created_at: 1710000000,
    message_count: 1,
    model_config: {
      model: { provider: 'openai', name: 'gpt-4o', mode: 'chat', completion_params: {} },
      user_input_form: [{ 'text-input': { variable: 'query', label: 'Topic' } }],
    },
    ...overrides,
  })
const createCompletionDetail = (answer = 'Generated output'): ConversationMessageDetail =>
  zConversationMessageDetail.parse({
    id: 'conversation-1',
    from_source: 'console',
    status: 'normal',
    created_at: 1710000000,
    model_config: createChatDetail().model_config,
    message: createChatMessage('message-1', { answer, inputs: { query: 'Completion topic' } }),
  })
const run: WorkflowRunDetailResponse = {
  id: 'run-1',
  version: '1',
  graph: { nodes: [], edges: [] },
  inputs: '{}',
  inputs_truncated: false,
  outputs: '{}',
  outputs_truncated: false,
  status: 'succeeded',
  elapsed_time: 1,
  total_tokens: 15,
  total_steps: 1,
  created_by_role: 'account',
  created_by_account: { id: 'account-1', name: 'Admin', email: 'admin@example.com' },
  created_at: 1710000000,
  finished_at: 1710000001,
}
const onRefresh = vi.fn()
function createClient() {
  const queryClient = createConsoleQueryClient()
  seedModelProviderQueries(queryClient, [
    createModelCatalogFixture({
      models: [createCatalogModelFixture({ model: 'gpt-4o', label: { en_US: 'GPT-4o' } })],
    }),
  ])
  return queryClient
}
function renderConversationList({
  appDetail = createAppDetailFixture({ id: 'app-1', mode: 'chat' }),
  logs = createLogs(),
  searchParams = '?page=2',
}: {
  appDetail?: ComponentProps<typeof ConversationList>['appDetail']
  logs?: ComponentProps<typeof ConversationList>['logs']
  searchParams?: string
} = {}) {
  const { wrapper: UrlState, onUrlUpdate } = createNuqsTestWrapper({ searchParams })
  const rendered = renderWithConsoleQuery(
    <UrlState>
      <ConversationList appDetail={appDetail} logs={logs} onRefresh={onRefresh} />
      <AppToastHost />
    </UrlState>,
    { queryClient: createClient() },
  )
  return { ...rendered, onUrlUpdate }
}

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset()
  onRefresh.mockClear()
  api.chatDetail.mockImplementation(async ({ params }) =>
    createChatDetail({ id: params.conversation_id }),
  )
  api.completionDetail.mockResolvedValue(createCompletionDetail())
  api.messages.mockResolvedValue({
    data: [createChatMessage('message-1')],
    has_more: false,
    limit: 10,
  })
  api.feedback.mockResolvedValue({ result: 'success' })
  api.addAnnotation.mockResolvedValue({ id: 'annotation-1' })
  api.editAnnotation.mockImplementation(async ({ body }) => ({ id: 'annotation-1', ...body }))
  api.removeAnnotation.mockResolvedValue({ result: 'success' })
  api.run.mockResolvedValue(run)
  api.tracing.mockResolvedValue({ data: [] })
  api.agentLog.mockResolvedValue({
    iterations: [],
    meta: {
      status: 'succeeded',
      executor: 'Admin',
      start_time: '2024-03-09',
      elapsed_time: 1,
      total_tokens: 15,
      agent_mode: 'function_call',
      iterations: 0,
    },
  })
})
afterEach(() => toast.dismiss())

it('opens a conversation with push navigation while preserving the page', async () => {
  const user = userEvent.setup()
  const { onUrlUpdate } = renderConversationList()
  await user.click(screen.getByText('hello world'))
  expect(await screen.findByRole('dialog', { name: 'appLog.detail.conversationId' })).toBeVisible()
  const update = onUrlUpdate.mock.calls.at(-1)![0]
  expect(update.searchParams.get('page')).toBe('2')
  expect(update.searchParams.get('conversation_id')).toBe('conversation-1')
  expect(update.options.history).toBe('push')
})

it('exposes the unread marker only for unread conversations', () => {
  const unreadLog = createLogs().data[0]!
  renderConversationList({
    logs: {
      ...createLogs(),
      total: 2,
      data: [
        unreadLog,
        { ...unreadLog, id: 'conversation-2', name: 'read conversation', read_at: 1710000100 },
      ],
    },
  })
  expect(
    within(screen.getByRole('row', { name: /hello world/ })).getByText('appLog.table.unread'),
  ).toBeVisible()
  expect(
    within(screen.getByRole('row', { name: /read conversation/ })).queryByText(
      'appLog.table.unread',
    ),
  ).not.toBeInTheDocument()
})

it.each(['keyboard', 'row'])(
  'restores focus to the entry and refreshes after closing a conversation opened by %s',
  async (opening) => {
    const user = userEvent.setup()
    const { onUrlUpdate } = renderConversationList()
    const trigger = within(screen.getByRole('row', { name: /hello world/ })).getByRole('button')
    if (opening === 'keyboard') {
      trigger.focus()
      await user.keyboard('{Enter}')
    } else await user.click(screen.getByText('hello world'))
    await screen.findByText('Assistant reply message-1')
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'appLog.detail.conversationId' }),
      ).not.toBeInTheDocument(),
    )
    expect(trigger).toHaveFocus()
    expect(onRefresh).toHaveBeenCalledTimes(1)
    const update = onUrlUpdate.mock.calls.at(-1)![0]
    expect(update.searchParams.has('conversation_id')).toBe(false)
    expect(update.searchParams.get('page')).toBe('2')
    expect(update.options.history).toBe('replace')
  },
)

it.each([true, false])(
  'settles admin feedback with the request outcome (success: %s)',
  async (succeeded) => {
    const user = userEvent.setup()
    if (!succeeded) api.feedback.mockRejectedValueOnce(new Error('Feedback failed'))
    renderConversationList({ searchParams: '?conversation_id=conversation-1' })
    const drawer = await screen.findByRole('dialog', { name: 'appLog.detail.conversationId' })
    expect(await within(drawer).findByText('GPT-4o')).toBeVisible()
    expect(await within(drawer).findByText('query')).toBeVisible()
    const like = await within(drawer).findByRole('button', {
      name: 'appLog.table.header.adminRate: appLog.detail.operation.like',
    })
    await user.click(like)
    await waitFor(() =>
      expect(api.feedback).toHaveBeenCalledExactlyOnceWith({
        params: { app_id: 'app-1' },
        body: { message_id: 'message-1', rating: 'like', content: undefined },
      }),
    )
    await waitFor(() =>
      expect(
        within(drawer).getByRole('button', {
          name: 'appLog.table.header.adminRate: appLog.detail.operation.like',
        }),
      ).toHaveAttribute('aria-pressed', String(succeeded)),
    )
  },
)

it.each(['chat', 'agent-chat', 'advanced-chat'] as const)(
  'exposes run details only for chatflow answers (%s)',
  async (mode) => {
    renderConversationList({
      appDetail: createAppDetailFixture({ id: 'app-1', mode }),
      searchParams: '?conversation_id=conversation-1',
    })
    await screen.findByText('Assistant reply message-1')
    if (mode === 'advanced-chat')
      expect(screen.getByRole('button', { name: 'common.operation.log' })).toBeVisible()
    else
      expect(screen.queryByRole('button', { name: 'common.operation.log' })).not.toBeInTheDocument()
  },
)

it('refetches completion output after feedback', async () => {
  const user = userEvent.setup()
  renderConversationList({
    appDetail: createAppDetailFixture({ id: 'app-1', mode: 'completion' }),
    logs: createCompletionLogs(),
    searchParams: '?conversation_id=conversation-1',
  })
  const drawer = await screen.findByRole('dialog', { name: 'appLog.detail.time' })
  expect(await within(drawer).findByText('Generated output')).toBeVisible()
  expect(within(drawer).getByText('Completion topic')).toBeVisible()
  expect(
    within(drawer).queryByRole('button', { name: 'common.operation.log' }),
  ).not.toBeInTheDocument()
  api.completionDetail.mockResolvedValue(createCompletionDetail('Updated generated output'))
  await user.click(within(drawer).getByRole('button', { name: 'appDebug.operation.agree' }))
  expect(await within(drawer).findByText('Updated generated output')).toBeVisible()
  expect(api.feedback).toHaveBeenCalledExactlyOnceWith({
    params: { app_id: 'app-1' },
    body: { message_id: 'message-1', rating: 'like', content: undefined },
  })
  expect(api.completionDetail).toHaveBeenCalledTimes(2)
})

it('adds, edits and removes an annotation from a conversation answer', async () => {
  const user = userEvent.setup()
  renderConversationList({ searchParams: '?conversation_id=conversation-1' })
  await user.click(await screen.findByRole('button', { name: 'appDebug.feature.annotation.add' }))
  expect(api.addAnnotation).toHaveBeenCalledExactlyOnceWith({
    params: { app_id: 'app-1' },
    body: {
      message_id: 'message-1',
      question: 'Question message-1',
      answer: 'Assistant reply message-1',
    },
  })
  await user.click(await screen.findByRole('button', { name: 'appDebug.feature.annotation.edit' }))
  const editor = await screen.findByRole('dialog', { name: 'appAnnotation.editModal.title' })
  await user.click(within(editor).getAllByRole('button', { name: 'common.operation.edit' })[1]!)
  await user.type(
    within(editor).getByRole('textbox', { name: 'appAnnotation.editModal.yourAnswer' }),
    'Improved answer',
  )
  await user.click(within(editor).getByRole('button', { name: 'common.operation.save' }))
  await waitFor(() =>
    expect(api.editAnnotation).toHaveBeenCalledExactlyOnceWith({
      params: { app_id: 'app-1', annotation_id: 'annotation-1' },
      body: { question: 'Question message-1', answer: 'Improved answer' },
    }),
  )
  await user.click(within(editor).getByRole('button', { name: 'common.operation.close' }))
  await waitFor(() => expect(editor).not.toBeInTheDocument())
  expect(
    await within(screen.getByRole('dialog', { name: 'appLog.detail.conversationId' })).findByText(
      'Improved answer',
    ),
  ).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'appDebug.feature.annotation.edit' }))
  const reopened = await screen.findByRole('dialog', { name: 'appAnnotation.editModal.title' })
  await user.click(
    within(reopened).getByRole('button', { name: 'appAnnotation.editModal.removeThisCache' }),
  )
  const confirm = await screen.findByRole('alertdialog')
  await user.click(within(confirm).getByRole('button', { name: 'common.operation.confirm' }))
  await waitFor(() => expect(reopened).not.toBeInTheDocument())
  expect(
    await screen.findByRole('button', { name: 'appDebug.feature.annotation.add' }),
  ).toBeVisible()
  expect(api.removeAnnotation).toHaveBeenCalledExactlyOnceWith({
    params: { app_id: 'app-1', annotation_id: 'annotation-1' },
  })
})

it('loads older messages at the top using the oldest answer as the pagination cursor', async () => {
  api.messages
    .mockResolvedValueOnce({
      data: [
        createChatMessage('message-1', { parent_message_id: 'older-message' }),
        createChatMessage('message-2', { parent_message_id: 'message-1' }),
        createChatMessage('message-3', { parent_message_id: 'message-2' }),
        createChatMessage('message-4', { parent_message_id: 'message-3' }),
      ],
      has_more: true,
      limit: 10,
    })
    .mockResolvedValueOnce({
      data: [createChatMessage('older-message')],
      has_more: false,
      limit: 10,
    })
  renderConversationList({ searchParams: '?conversation_id=conversation-1' })
  const history = await screen.findByRole('log')
  await within(history).findByText('Assistant reply message-4')
  // happy-dom has no layout; these metrics describe the reverse-scrolling history at its top.
  Object.defineProperties(history, {
    clientHeight: { configurable: true, value: 100 },
    scrollHeight: { configurable: true, value: 500 },
    scrollTop: { configurable: true, value: -400 },
  })
  fireEvent.scroll(history)
  expect(await within(history).findByText('Assistant reply older-message')).toBeVisible()
  expect(api.messages).toHaveBeenLastCalledWith({
    params: { app_id: 'app-1' },
    query: { conversation_id: 'conversation-1', limit: 10, first_id: 'message-1' },
  })
  expect(api.messages).toHaveBeenCalledTimes(2)
})

it('opens and closes the workflow run selected from an answer', async () => {
  api.messages.mockResolvedValue({
    data: [createChatMessage('message-1', { workflow_run_id: 'run-1' })],
    has_more: false,
    limit: 10,
  })
  const user = userEvent.setup()
  renderConversationList({
    appDetail: createAppDetailFixture({ id: 'app-1', mode: 'advanced-chat' }),
    searchParams: '?conversation_id=conversation-1',
  })
  const conversation = await screen.findByRole('dialog', { name: 'appLog.detail.conversationId' })
  await user.click(
    await within(conversation).findByRole('button', { name: 'common.operation.log' }),
  )
  const runDialog = await screen.findByRole('dialog', { name: 'appLog.runDetail.title' })
  expect(await within(runDialog).findByRole('tab', { name: 'runLog.detail' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await waitFor(() => expect(api.run).toHaveBeenCalledWith('/apps/app-1/workflow-runs/run-1'))
  expect(api.tracing).toHaveBeenCalledWith({
    url: '/apps/app-1/workflow-runs/run-1/node-executions',
  })
  await user.click(within(runDialog).getByRole('button', { name: 'common.operation.close' }))
  await waitFor(() => expect(runDialog).not.toBeInTheDocument())
})

it('renders the prompt generated from the selected answer', async () => {
  api.messages.mockResolvedValue({
    data: [
      createChatMessage('message-1', { message: [{ role: 'user', text: 'Prompt sent to model' }] }),
    ],
    has_more: false,
    limit: 10,
  })
  const user = userEvent.setup()
  renderConversationList({
    appDetail: createAppDetailFixture({ id: 'app-1', mode: 'advanced-chat' }),
    searchParams: '?conversation_id=conversation-1',
  })
  await user.click(await screen.findByRole('button', { name: 'common.operation.log' }))
  expect(await screen.findByText('PROMPT LOG')).toBeVisible()
  expect(screen.getByText('Prompt sent to model')).toBeVisible()
})

it('loads the selected agent trace using its conversation and message ids', async () => {
  api.messages.mockResolvedValue({
    data: [
      createChatMessage('message-1', {
        agent_thoughts: [
          {
            id: 'thought-1',
            message_id: 'message-1',
            tool_labels: {},
            thought: 'Agent reasoning',
            tool: '',
            tool_input: '',
            observation: '',
            position: 0,
            files: [],
          },
        ],
      }),
    ],
    has_more: false,
    limit: 10,
  })
  const user = userEvent.setup()
  renderConversationList({
    appDetail: createAppDetailFixture({ id: 'app-1', mode: 'advanced-chat' }),
    searchParams: '?conversation_id=conversation-1',
  })
  await user.click(await screen.findByRole('button', { name: 'common.operation.log' }))
  const dialog = await screen.findByRole('dialog', { name: 'appLog.runDetail.workflowTitle' })
  expect(await within(dialog).findByText('Admin')).toBeVisible()
  expect(api.agentLog).toHaveBeenCalledExactlyOnceWith({
    params: { app_id: 'app-1' },
    query: { conversation_id: 'conversation-1', message_id: 'message-1' },
  })
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))
  await waitFor(() => expect(dialog).not.toBeInTheDocument())
})

it('discards a selected log when URL navigation changes or closes the conversation', async () => {
  const queryClient = createClient()
  const appDetail = createAppDetailFixture({ id: 'app-1', mode: 'advanced-chat' })
  const user = userEvent.setup()
  const view = (searchParams: string) => (
    <NuqsTestingAdapter searchParams={searchParams} hasMemory>
      <ConversationList appDetail={appDetail} logs={createLogs()} onRefresh={onRefresh} />
    </NuqsTestingAdapter>
  )
  const { rerender } = renderWithConsoleQuery(view('?conversation_id=conversation-1'), {
    queryClient,
  })
  await user.click(await screen.findByRole('button', { name: 'common.operation.log' }))
  expect(await screen.findByText('PROMPT LOG')).toBeVisible()
  rerender(view('?conversation_id=conversation-2'))
  await waitFor(() => expect(screen.queryByText('PROMPT LOG')).not.toBeInTheDocument())
  expect(await screen.findByText('conversation-2')).toBeVisible()
  await user.click(await screen.findByRole('button', { name: 'common.operation.log' }))
  expect(await screen.findByText('PROMPT LOG')).toBeVisible()
  rerender(view(''))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.queryByText('PROMPT LOG')).not.toBeInTheDocument()
  rerender(view('?conversation_id=conversation-1'))
  await screen.findByText('Assistant reply message-1')
  expect(screen.queryByText('PROMPT LOG')).not.toBeInTheDocument()
})
it('shows each chatflow status and its conversation feedback counts', () => {
  const states = [
    ['Paused conversation', { paused: 4, success: 0, failed: 0, partial_success: 0 }, 'Pending'],
    [
      'Successful conversation',
      { paused: 0, success: 5, failed: 0, partial_success: 0 },
      'Success',
    ],
    [
      'Partial conversation',
      { paused: 0, success: 6, failed: 0, partial_success: 1 },
      'Partial Success',
    ],
    ['Failed conversation', { paused: 0, success: 6, failed: 2, partial_success: 0 }, '2 Failures'],
  ] as const
  const base = createLogs().data[0]!
  renderConversationList({
    appDetail: createAppDetailFixture({ id: 'app-1', mode: 'advanced-chat' }),
    logs: {
      ...createLogs(),
      total: states.length,
      data: states.map(([name, status_count]) => ({
        ...base,
        id: name,
        name,
        status_count,
        message_count: Object.values(status_count).reduce<number>((sum, count) => sum + count, 0),
        user_feedback_stats: { like: 2, dislike: 0 },
        admin_feedback_stats: { like: 0, dislike: 3 },
      })),
    },
  })
  for (const [name, , status] of states) {
    const row = within(screen.getByRole('row', { name: new RegExp(name) }))
    expect(row.getByText(status)).toBeVisible()
    expect(row.getByText('2')).toBeVisible()
    expect(row.getByText('3')).toBeVisible()
  }
})

it('keeps the table and close action available while conversation requests resolve independently', async () => {
  const user = userEvent.setup()
  const detail = createDeferred<ConversationDetail>()
  const messages =
    createDeferred<Awaited<ReturnType<typeof consoleClient.apps.byAppId.chatMessages.get>>>()
  api.chatDetail.mockReturnValue(detail.promise)
  api.messages.mockReturnValue(messages.promise)
  renderConversationList()
  await user.click(screen.getByText('hello world'))
  const dialog = await screen.findByRole('dialog', { name: 'appLog.detail.conversationId' })
  expect(within(dialog).getByRole('button', { name: 'common.operation.close' })).toBeVisible()
  expect(screen.getByText('hello world')).toBeVisible()
  expect(api.messages).toHaveBeenCalled()
  await act(async () => {
    detail.resolve(createChatDetail())
  })
  expect(screen.getByText('hello world')).toBeVisible()
  expect(within(dialog).queryByText('Assistant reply message-1')).not.toBeInTheDocument()
  await act(async () => {
    messages.resolve({ data: [createChatMessage('message-1')], has_more: false, limit: 10 })
  })
  expect(await within(dialog).findByText('Assistant reply message-1')).toBeVisible()
  expect(screen.getByText('hello world')).toBeVisible()
})

it('opens a deep-linked conversation while the list is still pending', async () => {
  const { wrapper: UrlState } = createNuqsTestWrapper({
    searchParams: '?conversation_id=conversation-1',
  })
  renderWithConsoleQuery(
    <UrlState>
      <ConversationList
        appDetail={createAppDetailFixture({ id: 'app-1', mode: 'chat' })}
        onRefresh={onRefresh}
      />
    </UrlState>,
    { queryClient: createClient() },
  )
  expect(screen.getByText('appLog.table.header.summary')).toBeVisible()
  expect(await screen.findByText('Assistant reply message-1')).toBeVisible()
})
