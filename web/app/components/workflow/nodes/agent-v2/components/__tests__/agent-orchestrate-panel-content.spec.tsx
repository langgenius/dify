import type {
  AgentBuildDraftResponse,
  MessageDetailResponse,
  SandboxReadResponse,
} from '@dify/contracts/api/console/agent/types.gen'
import type { WorkflowAgentComposerResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { ComponentProps } from 'react'
import { zWorkflowAgentComposerResponse } from '@dify/contracts/api/console/apps/zod.gen'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { replacePromptEditorText } from '@/app/components/base/prompt-editor/plugins/__tests__/test-helpers'
import { renderEditor } from '@/app/components/workflow/editor-resource/__tests__/render'
import { AgentScope } from '@/features/agent-v2/analytics'
import { consoleQuery } from '@/service/console'
import { createHttpError } from '@/service/http-error'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper, seedAppDetail, seedFeatures } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { createDeferred } from '@/test/deferred'
import { createAgentFixture } from '@/test/fixtures/agent'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import { WorkflowInlineAgentConfigureWorkspace } from '../agent-orchestrate-panel-content'

const ssePost = vi.hoisted(() => vi.fn<typeof import('@/service/base').ssePost>())

const api = vi.hoisted(() => ({
  loadBuildDraft: vi.fn(),
  saveBuildDraft: vi.fn(),
  deleteBuildDraft: vi.fn(),
  saveComposer: vi.fn(),
  refreshConversation: vi.fn(),
  stopMessage: vi.fn(),
  history: vi.fn(),
  trackEvent: vi.fn(),
}))
vi.mock('@/app/components/base/amplitude', () => ({ trackEvent: api.trackEvent }))
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({ appId: 'app-1' }),
  usePathname: () => '/app/app-1/workflow',
}))
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
      'agent.byAgentId.buildDraft.get': api.loadBuildDraft,
      'agent.byAgentId.buildDraft.put': api.saveBuildDraft,
      'agent.byAgentId.buildDraft.delete': api.deleteBuildDraft,
      'agent.byAgentId.debugConversation.refresh.post': api.refreshConversation,
      'agent.byAgentId.chatMessages.get': api.history,
      'apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.put': api.saveComposer,
      'agent.byAgentId.sandbox.get': () => ({ workspace_cwd: '.' }),
      'agent.byAgentId.sandbox.files.get': () => ({
        path: '.',
        entries: [{ name: 'result.txt', type: 'file' }],
      }),
      'agent.byAgentId.sandbox.files.read.get': () =>
        ({
          text: 'Build result',
          path: 'result.txt',
          binary: false,
          truncated: false,
        }) satisfies SandboxReadResponse,
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'agent.byAgentId.chatMessages.byTaskId.stop.post': api.stopMessage,
    }),
  }
})

const createComposer = (overrides: Partial<WorkflowAgentComposerResponse> = {}) =>
  zWorkflowAgentComposerResponse.parse({
    variant: 'workflow',
    agent_soul: { schema_version: 1, prompt: { system_prompt: 'Help with workflow tasks.' } },
    node_job: {},
    save_options: [],
    soul_lock: { locked: false },
    agent: {
      id: 'agent-1',
      name: 'Inline Agent',
      description: '',
      scope: 'workflow_only',
      status: 'active',
      icon_type: 'emoji',
      icon: 'A',
    },
    binding: {
      id: 'binding-1',
      binding_type: 'inline_agent',
      agent_id: 'agent-1',
      current_snapshot_id: 'snapshot-1',
      node_id: 'node-1',
      workflow_id: 'workflow-1',
    },
    ...overrides,
  } satisfies WorkflowAgentComposerResponse)
const createBuildDraft = (prompt = 'Built instructions'): AgentBuildDraftResponse => ({
  variant: 'agent_app',
  agent_soul: { schema_version: 1, prompt: { system_prompt: prompt } },
  draft: { id: 'build-1', agent_id: 'agent-1', draft_type: 'debug_build' },
})
const createHistoryMessage = (
  conversationId = 'old-conversation',
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

const historyByConversation = new Map<string, MessageDetailResponse[]>()

const prefix = 'agentV2.agentDetail.configure'
const promptEditor = () => screen.getByRole('textbox', { name: `${prefix}.prompt.label` })
const buildInput = () => screen.getByRole('textbox', { name: `${prefix}.build.inputPlaceholder` })
const previewInput = () =>
  screen.getByRole('textbox', { name: new RegExp(`${prefix}.preview.inputPlaceholder`) })
const applyButton = () => screen.getByRole('button', { name: 'custom.apply' })
const discardButton = () => screen.getByRole('button', { name: `${prefix}.buildDraft.discard` })
const restartButton = () => screen.getByRole('button', { name: `${prefix}.preview.restart` })

function renderWorkspace({
  composer = createComposer(),
  open = true,
  edition = 'CLOUD',
  canCreate = true,
  onSaveInlineToRoster,
}: {
  composer?: WorkflowAgentComposerResponse | null
  open?: boolean
  edition?: 'CLOUD' | 'COMMUNITY'
  canCreate?: boolean
  onSaveInlineToRoster?: () => void
} = {}) {
  const { queryClient } = createConsoleQueryWrapper({
    workspacePermissionKeys: canCreate ? ['agent.create'] : [],
    systemFeatures: { deployment_edition: edition },
  })
  seedFeatures(queryClient)
  seedAppDetail(queryClient, createAppDetailFixture({ id: 'app-1', mode: 'workflow' }))
  seedModelProviderQueries(queryClient)
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(
    consoleQuery.agent.byAgentId.get.queryKey({ input: { params: { agent_id: 'agent-1' } } }),
    createAgentFixture({ name: 'Inline Agent' }),
  )
  queryClient.setQueryData(
    consoleQuery.workspaces.current.agents.byAgentId.skills.get.queryKey({
      input: { params: { agent_id: 'agent-1' } },
    }),
    { agent_id: 'agent-1', data: [] },
  )
  const props: ComponentProps<typeof WorkflowInlineAgentConfigureWorkspace> = {
    agentId: 'agent-1',
    resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    inlineComposerState: composer ?? undefined,
    nodeId: 'node-1',
    open,
    onSaveInlineToRoster,
  }
  const render = createNuqsTestRenderer((ui) => renderEditor(ui, { queryClient }))
  const result = render(<WorkflowInlineAgentConfigureWorkspace {...props} />)
  return {
    ...result,
    queryClient,
    update: (changes: Partial<typeof props>) =>
      result.rerender(<WorkflowInlineAgentConfigureWorkspace {...props} {...changes} />),
  }
}
async function sendBuild(
  user: ReturnType<typeof userEvent.setup>,
  message = 'Build a tender reviewer',
) {
  await user.type(
    await screen.findByRole('textbox', { name: `${prefix}.build.inputPlaceholder` }),
    message,
  )
  await user.keyboard('{Enter}')
}
async function sendPreview(
  user: ReturnType<typeof userEvent.setup>,
  message = 'Review this tender',
) {
  await user.type(previewInput(), message)
  await user.keyboard('{Enter}')
}
async function changeMode(user: ReturnType<typeof userEvent.setup>, mode: 'build' | 'preview') {
  await user.click(await screen.findByRole('radio', { name: `${prefix}.rightPanel.${mode}` }))
}
async function confirm(user: ReturnType<typeof userEvent.setup>) {
  const dialog = within(await screen.findByRole('alertdialog'))
  await user.click(dialog.getByRole('button', { name: 'common.operation.confirm' }))
}
function stream(index = 0) {
  const options = vi.mocked(ssePost).mock.calls[index]?.[2]
  if (!options) throw new Error('Expected a chat stream')
  return options
}
async function receive(
  index = 0,
  conversationId = 'build-conversation',
  message = 'Built the reviewer',
) {
  const body = ssePost.mock.calls[index]![1].body
  if (!body || typeof body !== 'object' || !('query' in body) || typeof body.query !== 'string')
    throw new Error('Expected a chat request body')
  historyByConversation.set(conversationId, [
    ...(historyByConversation.get(conversationId) ?? []),
    {
      ...createHistoryMessage(conversationId, message),
      id: `message-${index}`,
      query: body.query,
      parent_message_id:
        'parent_message_id' in body && typeof body.parent_message_id === 'string'
          ? body.parent_message_id
          : null,
    },
  ])
  await act(async () => {
    stream(index).onData?.(message, true, {
      event: 'message',
      conversationId,
      messageId: `message-${index}`,
      taskId: `task-${index}`,
    })
  })
}
async function complete(index = 0) {
  await act(async () => {
    await stream(index).onCompleted?.()
  })
}

beforeAll(async () => {
  // Load the real dynamic chat and Markdown renderers before timing preview interactions.
  await Promise.all([
    import('@/app/components/base/chat/chat'),
    import('@/app/components/base/markdown/streamdown-wrapper'),
  ])
})

beforeEach(() => {
  historyByConversation.clear()
  for (const mock of Object.values(api)) mock.mockReset()
  vi.mocked(ssePost)
    .mockReset()
    .mockImplementation(async (_url, _data, options) => {
      options.getAbortController?.(new AbortController())
    })
  api.loadBuildDraft.mockRejectedValue(createHttpError(new Response(null, { status: 404 })))
  api.saveBuildDraft.mockImplementation(async (input) =>
    createBuildDraft(input.body.agent_soul.prompt.system_prompt),
  )
  api.deleteBuildDraft.mockResolvedValue({ result: 'success' })
  api.saveComposer.mockImplementation(async (input) =>
    createComposer({ agent_soul: input.body.agent_soul }),
  )
  api.refreshConversation.mockResolvedValue({
    debug_conversation_id: 'refreshed-conversation',
    debug_conversation_has_messages: false,
    debug_conversation_message_count: 0,
  })
  api.stopMessage.mockResolvedValue({ result: 'success' })
  api.history.mockImplementation(async (input) => ({
    data: historyByConversation.get(input.query.conversation_id) ?? [],
    has_more: false,
    limit: 20,
  }))
})

describe('Inline Agent configure workspace', () => {
  it('loads the build draft while waiting for composer data', async () => {
    renderWorkspace({ composer: null })
    expect(screen.getByRole('progressbar', { name: 'common.loading' })).toBeVisible()
    expect(
      screen.queryByRole('textbox', { name: `${prefix}.prompt.label` }),
    ).not.toBeInTheDocument()
    await waitFor(() => expect(api.loadBuildDraft).toHaveBeenCalledOnce())
  })

  it('starts loading the build draft when the panel opens', async () => {
    const { update } = renderWorkspace({ open: false })
    expect(api.loadBuildDraft).not.toHaveBeenCalled()
    update({ open: true })
    await waitFor(() => expect(api.loadBuildDraft).toHaveBeenCalledOnce())
  })

  it('runs preview without creating a build draft and preserves the separate build session', async () => {
    const user = userEvent.setup()
    renderWorkspace()
    await changeMode(user, 'preview')
    await sendPreview(user)
    await waitFor(() => expect(ssePost).toHaveBeenCalledOnce())
    expect(vi.mocked(ssePost).mock.calls[0]?.[1].body).toMatchObject({
      query: 'Review this tender',
    })
    expect(vi.mocked(ssePost).mock.calls[0]?.[1].body).not.toHaveProperty('draft_type')
    expect(api.saveBuildDraft).not.toHaveBeenCalled()
    expect(api.trackEvent).toHaveBeenCalledWith('agent_preview_mode_run', {
      agent_scope: AgentScope.InWorkflow,
    })
    await receive(0, 'preview-conversation', 'Preview answer')
    await complete()
    expect(await screen.findByText('Preview answer')).toBeVisible()
    await changeMode(user, 'build')
    expect(buildInput()).toBeVisible()
    expect(screen.queryByText('Preview answer')).not.toBeInTheDocument()
  })

  it('saves the edited workflow prompt before preparing the build draft and starting the stream', async () => {
    const user = userEvent.setup()
    const saved = createDeferred<ReturnType<typeof createComposer>>()
    api.saveComposer.mockReturnValue(saved.promise)
    api.saveBuildDraft.mockResolvedValue(createBuildDraft('Normalized instructions'))
    renderWorkspace()
    await replacePromptEditorText(
      await screen.findByRole('textbox', { name: `${prefix}.prompt.label` }),
      'Local instructions',
    )
    await sendBuild(user)
    await waitFor(() => expect(api.saveComposer).toHaveBeenCalledOnce())
    expect(api.saveBuildDraft).not.toHaveBeenCalled()
    expect(ssePost).not.toHaveBeenCalled()
    await act(async () =>
      saved.resolve(
        createComposer({ agent_soul: { prompt: { system_prompt: 'Saved instructions' } } }),
      ),
    )
    await waitFor(() => expect(ssePost).toHaveBeenCalledOnce())
    expect(api.saveBuildDraft).toHaveBeenCalledWith({
      params: { agent_id: 'agent-1' },
      body: {
        variant: 'agent_app',
        save_strategy: 'save_to_current_version',
        agent_soul: expect.objectContaining({ prompt: { system_prompt: 'Saved instructions' } }),
      },
    })
    expect(vi.mocked(ssePost).mock.calls[0]?.[1].body).toMatchObject({
      query: 'Build a tender reviewer',
      draft_type: 'debug_build',
    })
    expect(promptEditor()).toHaveTextContent('Normalized instructions')
    expect(api.trackEvent).toHaveBeenCalledWith('agent_build_mode_run', {
      agent_scope: AgentScope.InWorkflow,
    })
  })

  it('keeps the current conversation visible while entering build draft mode and unlocks actions after completion', async () => {
    const user = userEvent.setup()
    renderWorkspace()
    expect(await screen.findByRole('button', { name: `${prefix}.preview.restart` })).toBeDisabled()
    await sendBuild(user)
    await waitFor(() => expect(ssePost).toHaveBeenCalledOnce())
    await receive()
    expect(await screen.findByText('Built the reviewer')).toBeVisible()
    expect(promptEditor()).toHaveAttribute('contenteditable', 'false')
    expect(applyButton()).toBeDisabled()
    expect(discardButton()).toBeDisabled()
    api.loadBuildDraft.mockResolvedValue(createBuildDraft())
    await complete()
    await waitFor(() => expect(applyButton()).toBeEnabled(), { timeout: 2000 })
    expect(discardButton()).toBeEnabled()
    expect(restartButton()).toBeEnabled()
    expect(screen.getByText('Built the reviewer')).toBeVisible()
  })

  it('requires confirmation to discard a build session and stops its stream before switching to preview', async () => {
    const user = userEvent.setup()
    renderWorkspace()
    await sendBuild(user)
    await waitFor(() => expect(ssePost).toHaveBeenCalledOnce())
    await receive()
    await changeMode(user, 'preview')
    expect(
      await screen.findByRole('alertdialog', { name: `${prefix}.switchToPreviewConfirm.title` }),
    ).toBeVisible()
    expect(api.deleteBuildDraft).not.toHaveBeenCalled()
    await confirm(user)
    await waitFor(() => expect(api.deleteBuildDraft).toHaveBeenCalledOnce())
    expect(api.stopMessage).toHaveBeenCalledWith(
      { params: { agent_id: 'agent-1', task_id: 'task-0' } },
      { context: { silent: true } },
    )
    expect(api.stopMessage.mock.invocationCallOrder[0]).toBeLessThan(
      api.deleteBuildDraft.mock.invocationCallOrder[0]!,
    )
    expect(previewInput()).toBeVisible()
    expect(promptEditor()).toHaveTextContent('Help with workflow tasks.')
  })

  it('disables preview in community edition', async () => {
    renderWorkspace({ edition: 'COMMUNITY' })
    expect(
      await screen.findByRole('radio', { name: `${prefix}.rightPanel.preview` }),
    ).toBeDisabled()
  })

  it('hides save to roster when workspace permissions deny agent creation', async () => {
    renderWorkspace({ canCreate: false, onSaveInlineToRoster: vi.fn() })
    await screen.findByRole('textbox', { name: `${prefix}.prompt.label` })
    expect(screen.queryByRole('button', { name: 'common.operation.more' })).not.toBeInTheDocument()
  })

  it('preserves local prompt edits when a newer inline snapshot arrives', async () => {
    const { update } = renderWorkspace()
    await replacePromptEditorText(
      await screen.findByRole('textbox', { name: `${prefix}.prompt.label` }),
      'Unsaved local instructions',
    )
    update({
      inlineComposerState: createComposer({
        binding: { ...createComposer().binding!, current_snapshot_id: 'snapshot-2' },
        agent_soul: { prompt: { system_prompt: 'Server instructions' } },
      }),
    })
    expect(promptEditor()).toHaveTextContent('Unsaved local instructions')
  })

  it('waits for an in-flight build preparation before discarding it, without sending the stale request', async () => {
    const user = userEvent.setup()
    const saved = createDeferred<AgentBuildDraftResponse>()
    api.saveBuildDraft.mockReturnValue(saved.promise)
    renderWorkspace()
    await sendBuild(user)
    await waitFor(() => expect(api.saveBuildDraft).toHaveBeenCalledOnce())
    await changeMode(user, 'preview')
    await confirm(user)
    expect(api.deleteBuildDraft).not.toHaveBeenCalled()
    await act(async () => saved.resolve(createBuildDraft('Late build instructions')))
    await waitFor(() => expect(api.deleteBuildDraft).toHaveBeenCalledOnce())
    expect(ssePost).not.toHaveBeenCalled()
    expect(previewInput()).toBeVisible()
    expect(promptEditor()).toHaveTextContent('Help with workflow tasks.')
  })

  it('ignores a late stream completion after leaving and reopening build mode', async () => {
    const user = userEvent.setup()
    renderWorkspace()
    await sendBuild(user)
    await waitFor(() => expect(ssePost).toHaveBeenCalledOnce())
    await receive()
    await changeMode(user, 'preview')
    await confirm(user)
    await screen.findByRole('textbox', { name: new RegExp(`${prefix}.preview.inputPlaceholder`) })
    await changeMode(user, 'build')
    await screen.findByRole('textbox', { name: `${prefix}.build.inputPlaceholder` })
    const requests = api.loadBuildDraft.mock.calls.length
    vi.useFakeTimers()
    try {
      await complete()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      expect(api.loadBuildDraft).toHaveBeenCalledTimes(requests)
      expect(promptEditor()).toHaveAttribute('contenteditable', 'true')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not unlock a new build run when an older completion refresh resolves', async () => {
    const user = userEvent.setup()
    // Advance the delayed refresh without spending the test budget on real timers.
    const completeAndRefresh = async (index = 0) => {
      vi.useFakeTimers()
      try {
        await complete(index)
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1000)
        })
      } finally {
        vi.useRealTimers()
      }
    }
    const refreshed = createDeferred<AgentBuildDraftResponse>()
    renderWorkspace()
    await sendBuild(user)
    await waitFor(() => expect(ssePost).toHaveBeenCalledOnce())
    await receive()
    api.loadBuildDraft.mockReturnValue(refreshed.promise)
    await completeAndRefresh()
    expect(api.loadBuildDraft).toHaveBeenCalledTimes(2)
    await sendBuild(user, 'Improve the reviewer')
    await waitFor(() => expect(ssePost).toHaveBeenCalledTimes(2))
    await act(async () => refreshed.resolve(createBuildDraft('Old completion')))
    expect(applyButton()).toBeDisabled()
    expect(discardButton()).toBeDisabled()
    expect(promptEditor()).not.toHaveTextContent('Old completion')
    await receive(1, 'build-conversation', 'Improved reviewer')
    api.loadBuildDraft.mockResolvedValue(createBuildDraft('Improved instructions'))
    await completeAndRefresh(1)
    await waitFor(() => expect(applyButton()).toBeEnabled())
  })

  it('unlocks draft actions after the chat stream fails', async () => {
    const user = userEvent.setup()
    renderWorkspace()
    await sendBuild(user)
    await waitFor(() => expect(ssePost).toHaveBeenCalledOnce())
    expect(applyButton()).toBeDisabled()
    await act(async () => {
      await stream().onCompleted?.(true, 'Stream unavailable')
    })
    await waitFor(() => expect(applyButton()).toBeEnabled())
    expect(discardButton()).toBeEnabled()
  })

  it.each(['apply', 'discard'] as const)(
    'finishes %s and restores editing even when refreshing the debug conversation fails',
    async (action) => {
      const user = userEvent.setup()
      api.loadBuildDraft.mockResolvedValue(createBuildDraft())
      api.refreshConversation.mockRejectedValue(new Error('Refresh failed'))
      renderWorkspace()
      await screen.findByRole('button', { name: 'custom.apply' })
      expect(promptEditor()).toHaveAttribute('contenteditable', 'false')
      if (action === 'apply') await user.click(applyButton())
      else {
        await user.click(discardButton())
        await confirm(user)
      }
      await waitFor(() =>
        expect(
          screen.queryByRole('group', { name: `${prefix}.buildDraft.title` }),
        ).not.toBeInTheDocument(),
      )
      expect(promptEditor()).toHaveAttribute('contenteditable', 'true')
      expect(promptEditor()).toHaveTextContent(
        action === 'apply' ? 'Built instructions' : 'Help with workflow tasks.',
      )
      expect(api.deleteBuildDraft).toHaveBeenCalledExactlyOnceWith({
        params: { agent_id: 'agent-1' },
      })
      expect(api.refreshConversation).toHaveBeenCalledExactlyOnceWith({
        params: { agent_id: 'agent-1' },
      })
      if (action === 'apply')
        expect(api.saveComposer).toHaveBeenCalledWith({
          params: { app_id: 'app-1', node_id: 'node-1' },
          body: {
            variant: 'workflow',
            save_strategy: 'node_job_only',
            agent_soul: createBuildDraft().agent_soul,
          },
        })
      else expect(api.saveComposer).not.toHaveBeenCalled()
    },
  )

  it('keeps an existing build draft until the switch-to-preview confirmation is accepted', async () => {
    const user = userEvent.setup()
    api.loadBuildDraft.mockResolvedValue(createBuildDraft())
    renderWorkspace()
    await screen.findByRole('button', { name: 'custom.apply' })
    await changeMode(user, 'preview')
    const dialog = within(await screen.findByRole('alertdialog'))
    await user.click(dialog.getByRole('button', { name: 'common.operation.cancel' }))
    expect(api.deleteBuildDraft).not.toHaveBeenCalled()
    expect(applyButton()).toBeVisible()
    await changeMode(user, 'preview')
    await confirm(user)
    await waitFor(() => expect(api.deleteBuildDraft).toHaveBeenCalledOnce())
    expect(previewInput()).toBeVisible()
    expect(promptEditor()).toHaveTextContent('Help with workflow tasks.')
  })

  it.each([false, true])(
    'reopens and restarts the composer debug conversation (with build draft: %s)',
    async (hasBuildDraft) => {
      const user = userEvent.setup()
      if (hasBuildDraft) api.loadBuildDraft.mockResolvedValue(createBuildDraft())

      historyByConversation.set('old-conversation', [createHistoryMessage()])
      renderWorkspace({
        composer: createComposer({
          debug_conversation_id: 'old-conversation',
          debug_conversation_has_messages: true,
          debug_conversation_message_count: 1,
        }),
      })
      expect(await screen.findByText('Earlier answer')).toBeVisible()
      expect(api.history).toHaveBeenCalledWith({
        params: { agent_id: 'agent-1' },
        query: { conversation_id: 'old-conversation' },
      })
      await user.click(restartButton())
      await confirm(user)
      await waitFor(() =>
        expect(api.refreshConversation).toHaveBeenCalledExactlyOnceWith({
          params: { agent_id: 'agent-1' },
        }),
      )
      await waitFor(() => expect(screen.queryByText('Earlier answer')).not.toBeInTheDocument())
      if (hasBuildDraft) expect(api.deleteBuildDraft).toHaveBeenCalledOnce()
      else expect(api.deleteBuildDraft).not.toHaveBeenCalled()
    },
  )

  it('keeps restart disabled when the existing debug conversation has no messages', async () => {
    renderWorkspace({
      composer: createComposer({
        debug_conversation_id: 'empty-conversation',
        debug_conversation_has_messages: false,
        debug_conversation_message_count: 0,
      }),
    })
    await screen.findByRole('textbox', { name: `${prefix}.build.inputPlaceholder` })
    expect(restartButton()).toBeDisabled()
  })

  it('refreshes only the preview conversation when restarting preview', async () => {
    const user = userEvent.setup()
    historyByConversation.set('saved-build', [createHistoryMessage('saved-build', 'Build history')])
    renderWorkspace({
      composer: createComposer({
        debug_conversation_id: 'saved-build',
        debug_conversation_has_messages: true,
        debug_conversation_message_count: 1,
      }),
    })
    await screen.findByText('Build history')
    await changeMode(user, 'preview')
    await sendPreview(user)
    await waitFor(() => expect(ssePost).toHaveBeenCalledOnce())
    await receive(0, 'preview-conversation', 'Preview answer')
    await complete()
    await user.click(restartButton())
    expect(api.refreshConversation).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByText('Preview answer')).not.toBeInTheDocument())
    expect(api.deleteBuildDraft).not.toHaveBeenCalled()
    await changeMode(user, 'build')
    expect(await screen.findByText('Build history')).toBeVisible()
  })

  it('opens generated files after a build response completes', async () => {
    const user = userEvent.setup()
    renderWorkspace()
    expect(
      screen.queryByRole('button', { name: `${prefix}.workingDirectory.fileSystem` }),
    ).not.toBeInTheDocument()
    await sendBuild(user)
    await waitFor(() => expect(ssePost).toHaveBeenCalledOnce())
    await receive()
    expect(
      screen.queryByRole('button', { name: `${prefix}.workingDirectory.fileSystem` }),
    ).not.toBeInTheDocument()
    api.loadBuildDraft.mockResolvedValue(createBuildDraft())
    await complete()
    await user.click(
      await screen.findByRole('button', { name: `${prefix}.workingDirectory.fileSystem` }),
    )
    expect(await screen.findByRole('dialog', { name: 'result.txt' })).toBeVisible()
    expect(await screen.findByText('Build result')).toBeVisible()
  })
})
