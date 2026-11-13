import type {
  AgentAppComposerResponse,
  AgentBuildDraftResponse,
  AgentConfigSnapshotDetailResponse,
  AgentSoulConfig,
  MessageDetailResponse,
} from '@dify/contracts/api/console/agent/types.gen'
import type userEvent from '@testing-library/user-event'
import { zAgentAppComposerResponse } from '@dify/contracts/api/console/agent/zod.gen'
import { focusManager, onlineManager } from '@tanstack/react-query'
import { act, screen, waitFor, within } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { AgentPermission } from '@/features/agent-v2/acl'
import { consoleQuery } from '@/service/console'
import { createHttpError } from '@/service/http-error'
import {
  createDefaultModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { createAgentFixture } from '@/test/fixtures/agent'
import { renderWithNuqs } from '@/test/nuqs-testing'
import { AgentConfigurePage } from '../page'

const ssePost = vi.hoisted(() => vi.fn<typeof import('@/service/base').ssePost>())
const api = vi.hoisted(() => ({
  getAgent: vi.fn(),
  getComposer: vi.fn(),
  getBuildDraft: vi.fn(),
  getVersion: vi.fn(),
  getVersions: vi.fn(),
  saveComposer: vi.fn(),
  checkout: vi.fn(),
  discard: vi.fn(),
  finalize: vi.fn(),
  apply: vi.fn(),
  refresh: vi.fn(),
  restore: vi.fn(),
  history: vi.fn(),
  stop: vi.fn(),
  track: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}))
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({ agentId: 'agent-1' }),
  usePathname: () => '/agents/agent-1/configure',
}))
vi.mock('@/app/notifications', () => ({ toast: { error: api.error, success: api.success } }))
vi.mock('@/app/components/base/amplitude', () => ({ trackEvent: api.track }))
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  ssePost,
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'agent.byAgentId.get': api.getAgent,
      'agent.byAgentId.composer.get': api.getComposer,
      'agent.byAgentId.buildDraft.get': api.getBuildDraft,
      'agent.byAgentId.versions.byVersionId.get': api.getVersion,
      'agent.byAgentId.composer.put': api.saveComposer,
      'agent.byAgentId.buildDraft.checkout.post': api.checkout,
      'agent.byAgentId.buildDraft.delete': api.discard,
      'agent.byAgentId.buildChat.finalize.post': api.finalize,
      'agent.byAgentId.buildDraft.apply.post': api.apply,
      'agent.byAgentId.debugConversation.refresh.post': api.refresh,
      'agent.byAgentId.versions.byVersionId.restore.post': api.restore,
      'agent.byAgentId.chatMessages.get': api.history,
      'agent.byAgentId.versions.get': api.getVersions,
      'agent.byAgentId.referencingWorkflows.get': async () => ({ data: [] }),
      'workspaces.current.modelProviders.byProvider.models.parameterRules.get': async () => ({
        data: [],
      }),
      'agent.byAgentId.sandbox.files.read.get': async () => ({
        path: '~/result.txt',
        text: 'Build result',
        binary: false,
        truncated: false,
      }),
      'agent.byAgentId.sandbox.get': async () => ({ workspace_cwd: '.' }),
      'agent.byAgentId.sandbox.files.get': async () => ({
        path: '.',
        entries: [{ name: 'result.txt', type: 'file' }],
      }),
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'agent.byAgentId.chatMessages.byTaskId.stop.post': api.stop,
    }),
  }
})

// Keep the real dynamically imported Chat; compile its dependency graph before timed scenarios.
beforeAll(async () => {
  await import('@/app/components/base/chat/chat')
})

const agentInput = { params: { agent_id: 'agent-1' } }
export const composerKey = consoleQuery.agent.byAgentId.composer.get.queryKey({ input: agentInput })
export const buildDraftKey = consoleQuery.agent.byAgentId.buildDraft.get.queryKey({
  input: agentInput,
})
export const prefix = 'agentV2.agentDetail.configure'
export const promptEditor = () => screen.getByRole('textbox', { name: `${prefix}.prompt.label` })
export const chatInput = (mode: 'build' | 'preview' = 'build') =>
  screen.getByRole('textbox', { name: new RegExp(`${prefix}.${mode}.inputPlaceholder`) })
export const modeButton = (mode: 'build' | 'preview') =>
  screen.getByRole('radio', { name: `${prefix}.rightPanel.${mode}` })
export const applyButton = () => screen.getByRole('button', { name: 'custom.apply' })
export const discardButton = () =>
  screen.getByRole('button', { name: `${prefix}.buildDraft.discard` })
export const restartButton = () => screen.getByRole('button', { name: `${prefix}.preview.restart` })
export const versionsButton = () =>
  screen.getByRole('button', { name: `${prefix}.publishBar.versionHistory` })
export const workingDirectoryButton = () =>
  screen.queryByRole('button', { name: `${prefix}.workingDirectory.fileSystem` })

export const createSoul = (
  prompt = 'Draft instructions',
  overrides: Partial<AgentSoulConfig> = {},
): AgentSoulConfig => ({
  schema_version: 1,
  model: { model_provider: 'openai', model: 'gpt-4', plugin_id: 'openai' },
  prompt: { system_prompt: prompt },
  ...overrides,
})
export const createComposer = (soul = createSoul()): AgentAppComposerResponse =>
  zAgentAppComposerResponse.parse({
    variant: 'agent_app',
    active_config_is_published: false,
    save_options: [],
    agent: {
      id: 'agent-1',
      name: 'Research Agent',
      description: '',
      scope: 'roster',
      status: 'active',
    },
    agent_soul: soul,
  } satisfies AgentAppComposerResponse)
export const createBuildDraft = (
  soul = createSoul('Built instructions'),
): AgentBuildDraftResponse => ({
  variant: 'agent_app',
  agent_soul: soul,
  draft: { id: 'build-1', agent_id: 'agent-1', draft_type: 'debug_build' },
})
const publishedVersion: AgentConfigSnapshotDetailResponse = {
  id: 'version-2',
  version: 2,
  version_note: 'Published update',
  created_at: 1710000100,
  created_by: 'Alice',
  config_snapshot: createSoul('Published instructions'),
}
const createMessage = (
  conversationId: string,
  answer = 'Earlier answer',
): MessageDetailResponse => ({
  id: 'old-message',
  conversation_id: conversationId,
  query: 'Earlier request',
  answer,
  agent_thoughts: [],
  feedbacks: [],
  from_source: 'console',
  inputs: {},
  message: [],
  message_files: [],
  answer_tokens: 3,
  message_tokens: 2,
  metadata: {},
  provider_response_latency: 0.5,
  status: 'normal',
})
const history = new Map<string, MessageDetailResponse[]>()
export const emptyConversation = {
  debug_conversation_has_messages: false,
  debug_conversation_id: 'fresh-build',
  debug_conversation_message_count: 0,
}

export function setupConfigureTest() {
  history.clear()
  for (const mock of Object.values(api)) mock.mockReset()
  ssePost.mockReset().mockImplementation(async (_url, _data, options) => {
    options.getAbortController?.(new AbortController())
  })
  api.getBuildDraft.mockRejectedValue(createHttpError(new Response(null, { status: 404 })))
  api.getVersion.mockResolvedValue(publishedVersion)
  api.getVersions.mockResolvedValue({ data: [publishedVersion] })
  api.saveComposer.mockImplementation(async (input) => createComposer(input.body.agent_soul))
  api.checkout.mockResolvedValue(createBuildDraft())
  api.discard.mockResolvedValue({ result: 'success' })
  api.finalize.mockResolvedValue({ result: 'success' })
  api.apply.mockResolvedValue({ result: 'success', draft: {} })
  api.restore.mockResolvedValue({ result: 'success', active_config_snapshot_id: 'version-2' })
  api.refresh.mockResolvedValue(emptyConversation)
  api.stop.mockResolvedValue({ result: 'success' })
  api.history.mockImplementation(async (input) => ({
    data: history.get(input.query.conversation_id) ?? [],
    has_more: false,
    limit: 20,
  }))
}
export function cleanupConfigureTest() {
  focusManager.setFocused(undefined)
  onlineManager.setOnline(true)
  vi.useRealTimers()
}

export function createEnvironment({
  composer = createComposer(),
  buildDraft,
  edition = 'CLOUD',
  permissions = Object.values(AgentPermission),
  conversationId = 'old-build',
}: {
  composer?: AgentAppComposerResponse | null
  buildDraft?: AgentBuildDraftResponse
  edition?: 'CLOUD' | 'COMMUNITY' | 'ENTERPRISE'
  permissions?: string[]
  conversationId?: string | null
} = {}) {
  const { queryClient, wrapper: QueryProvider } = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: edition, license: { status: 'lost' } },
    features: { billing: { subscription: { plan: 'professional' } } },
  })
  queryClient.setDefaultOptions({
    queries: { retry: false, retryOnMount: false, staleTime: Infinity, gcTime: Infinity },
    mutations: { retry: false },
  })
  seedModelProviderQueries(queryClient, [createModelCatalogFixture()])
  queryClient.setQueryData(
    consoleQuery.workspaces.current.defaultModel.get.queryKey({
      input: { query: { model_type: 'llm' } },
    }),
    { data: createDefaultModelFixture() },
  )
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(
    consoleQuery.workspaces.current.agents.byAgentId.skills.get.queryKey({
      input: { params: { agent_id: 'agent-1' } },
    }),
    { agent_id: 'agent-1', data: [] },
  )
  const agent = createAgentFixture({
    name: 'Research Agent',
    permission_keys: permissions,
    debug_conversation_id: conversationId,
    debug_conversation_has_messages: !!conversationId,
    debug_conversation_message_count: conversationId ? 1 : 0,
  })
  api.getAgent.mockResolvedValue(agent)
  queryClient.setQueryData(consoleQuery.agent.byAgentId.get.queryKey({ input: agentInput }), agent)
  if (conversationId) history.set(conversationId, [createMessage(conversationId)])
  if (composer) {
    api.getComposer.mockResolvedValue(composer)
    queryClient.setQueryData<AgentAppComposerResponse>(composerKey, composer)
  } else api.getComposer.mockReturnValue(new Promise(() => {}))
  if (buildDraft) {
    api.getBuildDraft.mockResolvedValue(buildDraft)
    queryClient.setQueryData<AgentBuildDraftResponse>(buildDraftKey, buildDraft)
  }
  const store = createStore()
  store.set(queryClientAtom, queryClient)
  const ui = (visible = true) => (
    <QueryProvider>
      <Provider store={store}>{visible && <AgentConfigurePage agentId="agent-1" />}</Provider>
    </QueryProvider>
  )
  const render = (searchParams = '') => {
    const view = renderWithNuqs(ui(), { searchParams, hasMemory: true })
    return { ...view, show: (visible: boolean) => view.rerender(ui(visible)) }
  }
  return { queryClient, render }
}

export async function send(
  user: ReturnType<typeof userEvent.setup>,
  mode: 'build' | 'preview' = 'build',
  message = 'Review this tender',
) {
  await user.type(
    await screen.findByRole('textbox', { name: new RegExp(`${prefix}.${mode}.inputPlaceholder`) }),
    message,
  )
  await user.keyboard('{Enter}')
}
export async function changeMode(
  user: ReturnType<typeof userEvent.setup>,
  mode: 'build' | 'preview',
) {
  await user.click(modeButton(mode))
}
export async function confirm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', {
      name: 'common.operation.confirm',
    }),
  )
}
function stream(index = 0) {
  const options = ssePost.mock.calls[index]?.[2]
  if (!options) throw new Error('Expected a chat stream')
  return options
}
export async function receive(index = 0, conversationId = 'new-build', answer = 'Built answer') {
  await waitFor(() => expect(ssePost.mock.calls[index]).toBeDefined())
  const body = ssePost.mock.calls[index]![1].body
  if (!body || typeof body !== 'object' || !('query' in body) || typeof body.query !== 'string')
    throw new Error('Expected a chat request')
  history.set(conversationId, [
    ...(history.get(conversationId) ?? []),
    {
      ...createMessage(conversationId, answer),
      id: `message-${index}`,
      query: body.query,
      parent_message_id:
        'parent_message_id' in body && typeof body.parent_message_id === 'string'
          ? body.parent_message_id
          : null,
    },
  ])
  await act(async () =>
    stream(index).onData?.(answer, true, {
      event: 'message',
      conversationId,
      messageId: `message-${index}`,
      taskId: `task-${index}`,
    }),
  )
}
export async function complete(index = 0) {
  await act(async () => {
    await stream(index).onCompleted?.()
  })
}
export async function flushBuildRefresh() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000)
  })
}

export { api, ssePost }
