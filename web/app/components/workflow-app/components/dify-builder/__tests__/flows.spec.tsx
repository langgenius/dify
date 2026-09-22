import type {
  DifyBuilderCommandFinishedEventData,
  DifyBuilderConversationItemAppendedEventData,
  DifyBuilderStreamEventResponse,
} from '@dify/contracts/api/console/dify-builder/types.gen'
import type { ConversationItem, SessionView } from '../types'
import type { MarkdownProps } from '@/app/components/base/markdown'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAtomValue, useSetAtom } from 'jotai'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { consoleQuery } from '@/service/console'
import { commonQueryKeys } from '@/service/use-common'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import DifyBuilderPanel from '../panel'
import { DifyBuilderProvider } from '../provider'
import { difyBuilderCanStartFixAtom, difyBuilderStartRunFixAtom } from '../store'

const mocks = vi.hoisted(() => ({
  action: vi.fn(),
  create: vi.fn(),
  conversation: vi.fn(),
  focusCanvas: vi.fn(),
  get: vi.fn(),
  message: vi.fn(),
  stream: vi.fn(),
  refreshCanvas: vi.fn(async () => true),
  setCanvasReadOnly: vi.fn(),
  invalidateWorkflowDraftSync: vi.fn(),
  setShowPanel: vi.fn(),
  syncDraft: vi.fn(async (): Promise<void> => undefined),
}))

const runEvents = vi.hoisted(() => ({
  onWorkflowEvent: vi.fn(),
  onStreamInterrupted: vi.fn(),
  onCanvasEvent: vi.fn(),
  restoreRun: vi.fn(),
  finishCommand: vi.fn(),
  reset: vi.fn(),
  onCanvasRefreshed: vi.fn(),
}))
vi.mock('../provider/use-run-events', () => ({ useDifyBuilderRunEvents: () => runEvents }))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()

  return {
    ...actual,
    consoleClient: {
      difyBuilder: {
        sessions: {
          post: mocks.create,
          bySessionId: {
            get: mocks.get,
            conversation: { get: mocks.conversation },
            stream: { get: mocks.stream },
            actions: { post: mocks.action },
            messages: { post: mocks.message },
          },
        },
      },
    },
  }
})

vi.mock('../model-selector', () => ({
  default: () => <button type="button">Model selector</button>,
}))

// These flows verify delivered replies; Markdown rendering has its own tests.
vi.mock('@/app/components/base/markdown', () => ({
  Markdown: ({ content }: MarkdownProps) => <div>{content}</div>,
}))

vi.mock('@/features/agent-v2/agent-detail/configure/components/build-grid-texture', () => ({
  AgentBuildGridTexture: () => null,
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: <T,>(
    selector: (state: {
      setCanvasReadOnly: typeof mocks.setCanvasReadOnly
      invalidateWorkflowDraftSync: typeof mocks.invalidateWorkflowDraftSync
      setShowDifyBuilderPanel: typeof mocks.setShowPanel
    }) => T,
  ) =>
    selector({
      setCanvasReadOnly: mocks.setCanvasReadOnly,
      invalidateWorkflowDraftSync: mocks.invalidateWorkflowDraftSync,
      setShowDifyBuilderPanel: mocks.setShowPanel,
    }),
}))

const createSessionView = (overrides: Partial<SessionView> = {}): SessionView => ({
  actions: [],
  app_revision: { current: 'hash-1', conflicted: false },
  canvas_read_only: false,
  active_interaction: null,
  conversation_last_seq: -1,
  interrupted: false,
  last_command_id: 'command-1',
  phase: 'clarify',
  run_status: 'waiting_input',
  session_id: 'session-1',
  version: 1,
  ...overrides,
})

const commandStartedEvent = (view: SessionView): DifyBuilderStreamEventResponse => ({
  event: 'command_started',
  data: {
    session_id: view.session_id,
    command_id: 'command-1',
    version: view.version,
    phase: view.phase ?? 'understand',
    run_status: 'processing',
  },
})

const conversationPage = (data: ConversationItem[] = []) => ({
  data,
  first_seq: data[0]?.seq ?? null,
  has_more: false,
  last_seq: data.at(-1)?.seq ?? null,
})

const stateEvent = (
  view: SessionView,
  overrides: Partial<DifyBuilderCommandFinishedEventData> = {},
): DifyBuilderStreamEventResponse => {
  const { last_command_id: lastCommandId, ...state } = view
  return {
    event: 'command_finished',
    data: {
      ...state,
      command_id: lastCommandId || 'command-1',
      ...overrides,
    },
  }
}

const conversationItemEvent = (
  item: DifyBuilderConversationItemAppendedEventData['item'],
): DifyBuilderStreamEventResponse => ({
  event: 'conversation_item_appended',
  data: {
    session_id: 'session-1',
    command_id: 'command-1',
    item,
  },
})

const assistantMessageEvents = (
  item: Extract<ConversationItem, { kind: 'assistant_turn' }>,
  operationId = item.payload.turn_id,
): DifyBuilderStreamEventResponse[] => {
  const text = item.payload.reply_text ?? ''
  const splitAt = Math.ceil(text.length / 2)
  const chunks = text ? [text.slice(0, splitAt), text.slice(splitAt)].filter(Boolean) : []
  let textBytes = 0
  const events = chunks.map((delta, index): DifyBuilderStreamEventResponse => {
    textBytes += new TextEncoder().encode(delta).byteLength
    return {
      event: 'agent_message',
      data: {
        session_id: 'session-1',
        command_id: 'command-1',
        operation_id: operationId,
        turn_id: item.payload.turn_id,
        delta,
        seq: item.seq,
        at_version: item.at_version,
        revision: index + 1,
        done: false,
        text_bytes: textBytes,
      },
    }
  })
  events.push({
    event: 'agent_message',
    data: {
      session_id: 'session-1',
      command_id: 'command-1',
      operation_id: operationId,
      turn_id: item.payload.turn_id,
      delta: '',
      seq: item.seq,
      at_version: item.at_version,
      revision: chunks.length + 1,
      done: true,
      text_bytes: textBytes,
      execution: item.payload.execution,
      cards: item.payload.cards ?? [],
    },
  })
  return events
}

async function* streamOf(
  ...events: DifyBuilderStreamEventResponse[]
): AsyncGenerator<DifyBuilderStreamEventResponse> {
  yield* events
}

type ControlledItem = { event: DifyBuilderStreamEventResponse } | { done: true }

const createControlledEventStream = () => {
  const queue: ControlledItem[] = []
  let waiter: ((item: ControlledItem) => void) | undefined

  const send = (item: ControlledItem) => {
    if (waiter) {
      const resolve = waiter
      waiter = undefined
      resolve(item)
    } else {
      queue.push(item)
    }
  }

  const next = () => {
    const item = queue.shift()
    return item
      ? Promise.resolve(item)
      : new Promise<ControlledItem>((resolve) => (waiter = resolve))
  }

  const iterable = (async function* () {
    while (true) {
      const item = await next()
      if ('done' in item) return
      yield item.event
    }
  })()

  return {
    iterable,
    push: (event: DifyBuilderStreamEventResponse) => send({ event }),
    close: () => send({ done: true }),
  }
}

const FixEntry = () => {
  const canStartFix = useAtomValue(difyBuilderCanStartFixAtom)
  const startFix = useSetAtom(difyBuilderStartRunFixAtom)
  return (
    <button type="button" disabled={!canStartFix} onClick={() => void startFix('failed-run-42')}>
      Fix failed run
    </button>
  )
}

const builderModel = { provider: 'openai', name: 'gpt-4o', mode: 'chat', completion_params: {} }
const renderFlow = (edgeCount = 0, reactStrictMode = false) => {
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(commonQueryKeys.defaultModel(ModelTypeEnum.textGeneration), {
    data: {
      model: 'gpt-4o',
      model_type: 'llm',
      provider: {
        provider: 'openai',
        label: { en_US: 'OpenAI' },
        supported_model_types: ['llm'],
        tenant_id: 'workspace-1',
      },
    },
  })
  queryClient.setQueryData(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryKey({
      input: { params: { model_type: 'llm' } },
    }),
    {
      data: [
        {
          provider: 'openai',
          label: { en_US: 'OpenAI' },
          status: 'active',
          tenant_id: 'workspace-1',
          models: [
            {
              model: 'gpt-4o',
              label: { en_US: 'gpt-4o' },
              model_type: 'llm',
              status: 'active',
              model_properties: { mode: 'chat' },
              fetch_from: 'predefined-model',
              deprecated: false,
              has_invalid_load_balancing_configs: false,
              load_balancing_enabled: false,
            },
          ],
        },
      ],
    },
  )
  return renderWithConsoleQuery(
    <DifyBuilderProvider
      appId="app-1"
      canEdit
      getCanvasSnapshot={() => ({ nodes: [], edgeCount })}
      onFocusCanvas={mocks.focusCanvas}
      onRefreshCanvas={mocks.refreshCanvas}
      onSyncDraft={mocks.syncDraft}
      tenantId="workspace-1"
      userId="user-1"
    >
      <FixEntry />
      <DifyBuilderPanel />
    </DifyBuilderProvider>,
    { features: { dify_builder_enabled: true }, queryClient, reactStrictMode },
  )
}

const getComposer = () =>
  screen.getByRole('textbox', { name: 'workflow.difyBuilder.messagePlaceholder' })

const getSendButton = () => screen.getByRole('button', { name: 'workflow.difyBuilder.messageSend' })

describe('Dify Builder Build, Edit, and Fix flows', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.conversation.mockResolvedValue(conversationPage())
    window.sessionStorage.clear()
  })

  it('goes from requirements to resources and shows Plan v1 only after confirmation', async () => {
    const form: ConversationItem = {
      kind: 'form',
      seq: 0,
      at_version: 2,
      payload: {
        variant: 'build_requirements',
        fields: [{ key: 'audience', label: 'Audience', type: 'text' }],
        values: { audience: 'Managers' },
      },
    }
    const resources: ConversationItem = {
      kind: 'resource_select',
      seq: 1,
      at_version: 3,
      payload: {
        recommended: [
          { id: 'dataset-1', label: 'Knowledge', kind: 'dataset', readiness: 'ready', meta: '' },
        ],
      },
    }
    const plan: ConversationItem = {
      kind: 'plan',
      seq: 2,
      at_version: 4,
      payload: {
        title: 'Support workflow',
        items: ['Find an answer'],
      },
    }
    const goalView = createSessionView({
      version: 2,
      conversation_last_seq: 0,
      active_interaction: {
        action_id: 'submit_requirements',
        card_seq: form.seq,
        valid_at_version: 2,
      },
      actions: [{ id: 'submit_requirements', kind: 'primary', label: 'Submit requirements' }],
    })
    const resourceView = createSessionView({
      version: 3,
      conversation_last_seq: 1,
      active_interaction: {
        action_id: 'confirm_resources',
        card_seq: resources.seq,
        valid_at_version: 3,
      },
      actions: [{ id: 'confirm_resources', kind: 'primary', label: 'Confirm resources' }],
    })
    const planView = createSessionView({
      version: 4,
      conversation_last_seq: 2,
      actions: [{ id: 'approve_plan', kind: 'primary', label: 'Approve plan' }],
    })
    mocks.create.mockResolvedValue(
      streamOf(commandStartedEvent(createSessionView()), stateEvent(goalView)),
    )
    mocks.action
      .mockResolvedValueOnce(streamOf(commandStartedEvent(goalView), stateEvent(resourceView)))
      .mockResolvedValueOnce(streamOf(commandStartedEvent(resourceView), stateEvent(planView)))
    mocks.conversation.mockResolvedValue(conversationPage([form, resources, plan]))
    const user = userEvent.setup()
    renderFlow()
    await user.type(getComposer(), 'Build a support workflow')
    await user.click(getSendButton())
    const submit = await screen.findByRole('button', { name: 'Submit requirements' })
    await waitFor(() => expect(submit).toBeEnabled())
    await user.click(submit)
    const confirm = await screen.findByRole('button', { name: 'Confirm resources' })
    await waitFor(() => expect(confirm).toBeEnabled())
    expect(screen.queryByRole('heading', { name: 'Support workflow' })).not.toBeInTheDocument()
    await user.click(confirm)
    expect(screen.getAllByRole('heading', { name: 'Support workflow' })).toHaveLength(1)
    expect(screen.queryByText(/\bv1\b/i)).not.toBeInTheDocument()
    expect(mocks.action.mock.calls.map(([request]) => request.body.action_id)).toEqual([
      'submit_requirements',
      'confirm_resources',
    ])
    expect(mocks.action.mock.calls[1]?.[0].body.payload).toEqual({ resource_ids: ['dataset-1'] })
  })

  it('submits prefilled test inputs only after the user confirms them', async () => {
    const form: ConversationItem = {
      kind: 'form',
      seq: 0,
      at_version: 7,
      payload: {
        variant: 'testdata',
        frozen: false,
        fields: [
          { key: 'query', label: 'Question', type: 'text', required: true },
          { key: 'count', label: 'Count', type: 'number' },
          { key: 'enabled', label: 'Enabled', type: 'checkbox' },
        ],
        values: { query: 'Sample question', count: 0, enabled: false },
      },
    }
    const waiting = createSessionView({
      version: 7,
      conversation_last_seq: 0,
      active_interaction: {
        action_id: 'provide_testdata',
        card_seq: form.seq,
        valid_at_version: 7,
      },
      actions: [{ id: 'provide_testdata', label: 'Run test', kind: 'primary' }],
    })
    mocks.get.mockResolvedValue(waiting)
    mocks.conversation.mockResolvedValue(conversationPage([form]))
    mocks.action.mockResolvedValue(
      streamOf(
        commandStartedEvent(waiting),
        stateEvent({ ...waiting, version: 8, actions: [], active_interaction: null }),
      ),
    )
    window.sessionStorage.setItem(
      'dify-builder:v1:workspace-1:user-1:app-1:active-session-id',
      'session-1',
    )
    const user = userEvent.setup()
    renderFlow()
    const input = await screen.findByRole('textbox', { name: /Question/ })
    await waitFor(() => expect(input).toBeEnabled())
    expect(input).toHaveValue('Sample question')
    expect(mocks.action).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Run test' }))
    await waitFor(() => expect(mocks.action).toHaveBeenCalledOnce())
    expect(mocks.action.mock.calls[0]?.[0].body).toMatchObject({
      action_id: 'provide_testdata',
      payload: {
        mode: 'provide',
        inputs: { query: 'Sample question', count: 0, enabled: false },
      },
    })
  })

  it('retries a historical interrupted initial-plan state without losing its conversation', async () => {
    const notice: ConversationItem = {
      kind: 'notice',
      seq: 0,
      at_version: 2,
      payload: { text: 'Keep my original goal.' },
    }
    const interrupted = createSessionView({
      version: 3,
      run_status: 'processing',
      interrupted: true,
      conversation_last_seq: 0,
      actions: [{ id: 'recovery_continue', kind: 'primary', label: 'Retry' }],
    })
    mocks.get.mockResolvedValue(interrupted)
    mocks.conversation.mockResolvedValue(conversationPage([notice]))
    mocks.action.mockResolvedValue(
      streamOf(
        commandStartedEvent(interrupted),
        stateEvent(
          createSessionView({
            version: 4,
            conversation_last_seq: 0,
            actions: [{ id: 'confirm_resources', kind: 'primary', label: 'Confirm resources' }],
          }),
        ),
      ),
    )
    window.sessionStorage.setItem(
      'dify-builder:v1:workspace-1:user-1:app-1:active-session-id',
      'session-1',
    )
    const user = userEvent.setup()
    renderFlow()
    const retry = await screen.findByRole('button', { name: 'Retry' })
    await waitFor(() => expect(retry).toBeEnabled())
    await user.click(retry)
    expect(await screen.findByRole('button', { name: 'Confirm resources' })).toBeInTheDocument()
    expect(screen.getByText('Keep my original goal.')).toBeInTheDocument()
    expect(mocks.action.mock.calls[0]?.[0].body.action_id).toBe('recovery_continue')
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    'restores waiting Build actions after refresh with StrictMode=%s',
    async (reactStrictMode) => {
      const notice: ConversationItem = {
        seq: 0,
        at_version: 4,
        kind: 'notice',
        payload: { text: 'The workflow is ready on the canvas.' },
      }
      const waiting = createSessionView({
        actions: [
          { id: 'run_test', kind: 'primary', label: 'Run test' },
          { id: 'revert', kind: 'destructive', label: 'Revert' },
        ],
        conversation_last_seq: 0,
        phase: 'modify',
        run_status: 'waiting_confirmation',
        version: 4,
      })
      mocks.get.mockImplementation(async (_input: unknown, { signal }: { signal: AbortSignal }) => {
        await Promise.resolve()
        signal.throwIfAborted()
        return waiting
      })
      mocks.conversation.mockResolvedValue(conversationPage([notice]))
      mocks.action.mockResolvedValue(
        streamOf(
          commandStartedEvent(waiting),
          stateEvent({
            ...waiting,
            actions: [{ id: 'publish_workflow', kind: 'primary', label: 'Publish' }],
            phase: 'review',
            version: 5,
          }),
        ),
      )
      window.sessionStorage.setItem(
        'dify-builder:v1:workspace-1:user-1:app-1:active-session-id',
        waiting.session_id,
      )
      const user = userEvent.setup()
      renderFlow(1, reactStrictMode)

      expect(await screen.findByText(notice.payload.text)).toBeInTheDocument()
      const runTest = screen.getByRole('button', { name: 'Run test' })
      await waitFor(() => expect(runTest).toBeEnabled())
      expect(screen.getByRole('button', { name: 'Revert' })).toBeEnabled()
      expect(screen.queryByText('workflow.common.running')).not.toBeInTheDocument()
      expect(mocks.refreshCanvas).toHaveBeenCalledOnce()
      expect(mocks.stream).not.toHaveBeenCalled()

      await user.click(runTest)

      const publish = await screen.findByRole('button', { name: 'Publish' })
      await waitFor(() => expect(publish).toBeEnabled())
      expect(mocks.action).toHaveBeenCalledWith(
        {
          params: { session_id: waiting.session_id },
          body: {
            action_id: 'run_test',
            base_app_revision: 'hash-1',
            base_version: 4,
            payload: {},
          },
        },
        { signal: expect.any(AbortSignal) },
      )
    },
  )

  it('ignores a canceled restore response that arrives after the replacement restore', async () => {
    const waiting = createSessionView({
      actions: [
        { id: 'run_test', kind: 'primary', label: 'Run test' },
        { id: 'revert', kind: 'destructive', label: 'Revert' },
      ],
      phase: 'modify',
      run_status: 'waiting_confirmation',
      version: 4,
    })
    let finishCanceledRequest!: (view: SessionView) => void
    mocks.get
      .mockImplementationOnce(
        () =>
          new Promise<SessionView>((resolve) => {
            finishCanceledRequest = resolve
          }),
      )
      .mockResolvedValue(waiting)
    const storageKey = 'dify-builder:v1:workspace-1:user-1:app-1:active-session-id'
    window.sessionStorage.setItem(storageKey, waiting.session_id)
    const first = renderFlow(1)
    await waitFor(() => expect(mocks.get).toHaveBeenCalledOnce())
    first.unmount()
    renderFlow(1)

    const runTest = await screen.findByRole('button', { name: 'Run test' })
    await waitFor(() => expect(runTest).toBeEnabled())

    // The lock can settle without changing the durable session version.
    await act(async () => {
      finishCanceledRequest({ ...waiting, run_status: 'processing', canvas_read_only: true })
    })

    expect(runTest).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Revert' })).toBeEnabled()
    expect(screen.queryByText('workflow.common.running')).not.toBeInTheDocument()
    expect(window.sessionStorage.getItem(storageKey)).toBe(waiting.session_id)
    expect(mocks.stream).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    'refreshes the canvas after restored history loads with StrictMode=%s',
    async (reactStrictMode) => {
      const waiting = createSessionView({
        actions: [
          { id: 'run_test', kind: 'primary', label: 'Run test' },
          { id: 'revert', kind: 'destructive', label: 'Revert' },
        ],
        phase: 'modify',
        run_status: 'waiting_confirmation',
        version: 6,
      })
      let finishHistory!: (page: ReturnType<typeof conversationPage>) => void
      mocks.get.mockImplementation(async (_input: unknown, { signal }: { signal: AbortSignal }) => {
        await Promise.resolve()
        signal.throwIfAborted()
        return waiting
      })
      mocks.conversation.mockImplementation(
        () =>
          new Promise((resolve) => {
            finishHistory = resolve
          }),
      )
      window.sessionStorage.setItem(
        'dify-builder:v1:workspace-1:user-1:app-1:active-session-id',
        waiting.session_id,
      )
      renderFlow(1, reactStrictMode)

      const runTest = await screen.findByRole('button', { name: 'Run test' })
      expect(runTest).toBeDisabled()
      expect(mocks.refreshCanvas).not.toHaveBeenCalled()

      await act(async () => finishHistory(conversationPage()))

      await waitFor(() => expect(runTest).toBeEnabled())
      expect(screen.getByRole('button', { name: 'Revert' })).toBeEnabled()
      expect(screen.queryByText('workflow.common.running')).not.toBeInTheDocument()
      expect(mocks.refreshCanvas).toHaveBeenCalledOnce()
      expect(mocks.setCanvasReadOnly).toHaveBeenLastCalledWith(false)
    },
  )

  it.each([false, true])(
    'reconnects graph generation and unlocks its settled canvas with StrictMode=%s',
    async (reactStrictMode) => {
      const processing = createSessionView({
        canvas_read_only: true,
        phase: 'plan',
        run_status: 'processing',
        version: 5,
      })
      const waiting = createSessionView({
        actions: [
          { id: 'run_test', kind: 'primary', label: 'Run test' },
          { id: 'revert', kind: 'destructive', label: 'Revert' },
        ],
        conversation_last_seq: 0,
        phase: 'modify',
        run_status: 'waiting_confirmation',
        version: 6,
      })
      const notice: ConversationItem = {
        seq: 0,
        at_version: 6,
        kind: 'notice',
        payload: { text: 'The generated workflow is ready.' },
      }
      const reconnect = createControlledEventStream()
      mocks.get.mockImplementation(async (_input: unknown, { signal }: { signal: AbortSignal }) => {
        await Promise.resolve()
        signal.throwIfAborted()
        return processing
      })
      mocks.stream.mockResolvedValue(reconnect.iterable)
      window.sessionStorage.setItem(
        'dify-builder:v1:workspace-1:user-1:app-1:active-session-id',
        processing.session_id,
      )
      renderFlow(1, reactStrictMode)
      await waitFor(() => expect(mocks.stream).toHaveBeenCalledOnce())
      expect(getComposer()).toBeDisabled()
      expect(mocks.refreshCanvas).not.toHaveBeenCalled()

      let finishHistory!: (page: ReturnType<typeof conversationPage>) => void
      mocks.conversation.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishHistory = resolve
          }),
      )
      await act(async () => reconnect.push(stateEvent(waiting)))
      expect(screen.getByRole('button', { name: 'Run test' })).toBeDisabled()
      expect(mocks.refreshCanvas).not.toHaveBeenCalled()

      await act(async () => finishHistory(conversationPage([notice])))

      expect(await screen.findByText(notice.payload.text)).toBeInTheDocument()
      const runTest = await screen.findByRole('button', { name: 'Run test' })
      await waitFor(() => expect(runTest).toBeEnabled())
      expect(screen.getByRole('button', { name: 'Revert' })).toBeEnabled()
      expect(getComposer()).toBeEnabled()
      expect(screen.queryByText('workflow.common.running')).not.toBeInTheDocument()
      expect(mocks.refreshCanvas).toHaveBeenCalledOnce()
      expect(mocks.setCanvasReadOnly).toHaveBeenLastCalledWith(false)
      expect(mocks.create).not.toHaveBeenCalled()
      expect(mocks.action).not.toHaveBeenCalled()
    },
  )

  it.each([
    {
      entryMode: 'build',
      edgeCount: 0,
      appliedState: 'build.execution',
    },
    {
      entryMode: 'edit',
      edgeCount: 1,
      appliedState: 'edit.apply_changes',
    },
    {
      entryMode: 'fix',
      edgeCount: 0,
      appliedState: 'fix.await_verify',
    },
  ] as const)(
    'streams $entryMode change summaries as text and restores the durable reply',
    async ({ entryMode, edgeCount, appliedState }) => {
      const waiting = createSessionView({
        version: 2,
        actions: [{ id: 'approve_plan', kind: 'primary', label: 'Approve changes' }],
      })
      const changeSummary: ConversationItem = {
        seq: 0,
        at_version: 3,
        kind: 'assistant_turn',
        payload: {
          turn_id: 'apply-1',
          stage_id: appliedState,
          execution: { status: 'completed' },
          reply_text: 'Updated the answer configuration and added an approval step.',
        },
      }
      const applied = createSessionView({
        version: 3,
        conversation_last_seq: 0,
      })
      const actionStream = createControlledEventStream()
      mocks.create.mockResolvedValue(
        streamOf(commandStartedEvent(createSessionView()), stateEvent(waiting)),
      )
      mocks.action.mockResolvedValue(actionStream.iterable)
      mocks.conversation.mockResolvedValue(conversationPage([changeSummary]))
      const user = userEvent.setup()
      const { unmount } = renderFlow(edgeCount)

      if (entryMode === 'fix') {
        await user.click(screen.getByRole('button', { name: 'Fix failed run' }))
      } else {
        await user.type(getComposer(), 'Prepare the workflow')
        await user.click(getSendButton())
      }
      const approve = await screen.findByRole('button', { name: 'Approve changes' })
      await waitFor(() => expect(approve).toBeEnabled())
      await user.click(approve)
      await waitFor(() => expect(mocks.action).toHaveBeenCalledOnce())

      await act(async () => {
        actionStream.push(commandStartedEvent(waiting))
        for (const event of assistantMessageEvents(changeSummary, 'apply-1'))
          actionStream.push(event)
      })

      expect(
        await screen.findByText('Updated the answer configuration and added an approval step.'),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('article', { name: 'workflow.difyBuilder.changes' }),
      ).not.toBeInTheDocument()
      expect(getComposer()).toBeDisabled()

      await act(async () => {
        actionStream.push(stateEvent(applied))
        actionStream.close()
      })
      await waitFor(() => expect(getComposer()).toBeEnabled())

      mocks.get.mockResolvedValue(applied)
      mocks.conversation.mockResolvedValue(conversationPage([changeSummary]))
      unmount()
      renderFlow(edgeCount)

      expect(
        await screen.findByText('Updated the answer configuration and added an approval step.'),
      ).toBeInTheDocument()
      expect(mocks.get).toHaveBeenCalledOnce()
      expect(mocks.action).toHaveBeenCalledOnce()
    },
  )

  it.each([
    {
      variant: 'build_requirements',
      state: 'build.goal_analysis',
      actionId: 'submit_requirements',
      edgeCount: 0,
    },
    {
      variant: 'edit_rules',
      state: 'edit.impact_analysis',
      actionId: 'submit_edit_rules',
      edgeCount: 1,
    },
    {
      variant: 'testdata',
      state: 'build.await_testdata',
      actionId: 'provide_testdata',
      edgeCount: 0,
    },
  ])(
    'preserves $variant drafts through a chat commit and submits the edited values',
    async ({ variant, state, actionId, edgeCount }) => {
      const form: ConversationItem = {
        seq: 0,
        at_version: 2,
        kind: 'form',
        payload: {
          variant,
          fields: [{ key: 'audience', label: 'Audience', type: 'text' }],
          values: { audience: 'Managers' },
        },
      }
      const waiting = createSessionView({
        version: 2,
        conversation_last_seq: 0,
        active_interaction: { action_id: actionId, card_seq: form.seq, valid_at_version: 2 },
        actions: [{ id: actionId, kind: 'primary', label: 'Submit form' }],
      })
      const reply: ConversationItem = {
        seq: 2,
        at_version: 4,
        kind: 'assistant_turn',
        payload: {
          turn_id: 'reply-1',
          stage_id: state,
          execution: { status: 'completed' },
          reply_text: 'The audience determines how to explain the results.',
        },
      }
      const answered = {
        ...waiting,
        version: 4,
        conversation_last_seq: 2,
        active_interaction: { action_id: actionId, card_seq: form.seq, valid_at_version: 4 },
      }
      const messageStream = createControlledEventStream()
      mocks.create.mockResolvedValue(
        streamOf(
          commandStartedEvent(createSessionView()),
          conversationItemEvent(form),
          stateEvent(waiting),
        ),
      )
      mocks.message.mockResolvedValue(messageStream.iterable)
      mocks.action.mockResolvedValue(
        streamOf(
          commandStartedEvent(answered),
          stateEvent({
            ...answered,
            version: 5,
            active_interaction: null,
            actions: [],
          }),
        ),
      )
      const user = userEvent.setup()
      renderFlow(edgeCount)

      await user.type(getComposer(), 'Prepare the workflow')
      await user.click(getSendButton())
      const audience = await screen.findByRole('textbox', { name: 'Audience' })
      await waitFor(() => expect(audience).toBeEnabled())
      await user.clear(audience)
      await user.type(audience, 'Support agents')
      await user.type(getComposer(), 'How is the audience used?')
      await user.click(getSendButton())
      await waitFor(() => expect(mocks.message).toHaveBeenCalledOnce())
      const clientTurnId = mocks.message.mock.calls[0]?.[0].body.client_turn_id
      expect(clientTurnId).toEqual(expect.any(String))
      const question: ConversationItem = {
        seq: 1,
        at_version: 3,
        kind: 'user',
        payload: { turn_id: clientTurnId, text: 'How is the audience used?' },
      }
      await act(async () => {
        messageStream.push(commandStartedEvent(waiting))
        messageStream.push(conversationItemEvent(question))
        for (const event of assistantMessageEvents(reply, 'message-1')) messageStream.push(event)
      })
      await screen.findByText('The audience determines how to explain the results.')
      expect(screen.getByRole('textbox', { name: 'Audience' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Submit form' })).toBeDisabled()

      await act(async () => messageStream.push(stateEvent(answered)))
      await screen.findByText('How is the audience used?')
      await screen.findByText('The audience determines how to explain the results.')
      await waitFor(() => expect(screen.getByRole('textbox', { name: 'Audience' })).toBeEnabled())
      expect(screen.getByRole('textbox', { name: 'Audience' })).toHaveValue('Support agents')

      await user.click(screen.getByRole('button', { name: 'Submit form' }))
      await waitFor(() => expect(mocks.action).toHaveBeenCalledOnce())
      expect(mocks.action.mock.calls[0]?.[0].body).toMatchObject({
        action_id: actionId,
        base_version: 4,
        payload:
          actionId === 'provide_testdata'
            ? { mode: 'provide', inputs: { audience: 'Support agents' } }
            : { audience: 'Support agents' },
      })
    },
  )

  it('streams a Build command and next action without a session-state GET', async () => {
    const createStarted = createSessionView({
      canvas_read_only: true,
      run_status: 'processing',
    })
    const planItem: ConversationItem = {
      at_version: 2,
      kind: 'assistant_turn',
      payload: {
        reply_text: 'Plan reconciled from the server.',
        stage_id: 'build.plan',
        execution: { status: 'completed' },
        turn_id: 'turn-1',
      },
      seq: 1,
    }
    const goalItem: ConversationItem = {
      at_version: 1,
      kind: 'user',
      payload: { text: 'Build a support workflow', turn_id: 'goal-1' },
      seq: 0,
    }
    const planReady = createSessionView({
      actions: [{ id: 'approve_plan', kind: 'primary', label: 'Approve plan' }],
      conversation_last_seq: 1,
      phase: 'plan',
      version: 2,
    })
    const approvedNotice: ConversationItem = {
      at_version: 3,
      kind: 'notice',
      payload: { text: 'Plan approved and ready to verify.' },
      seq: 2,
    }
    const actionComplete = createSessionView({
      ...planReady,
      actions: [{ id: 'run_verify', kind: 'primary', label: 'Run verification' }],
      conversation_last_seq: 2,
      version: 3,
    })
    const createStream = createControlledEventStream()
    const actionStream = createControlledEventStream()
    mocks.create.mockResolvedValue(createStream.iterable)
    mocks.action.mockResolvedValue(actionStream.iterable)
    const user = userEvent.setup()
    renderFlow()

    await user.type(getComposer(), 'Build a support workflow')
    await user.click(getSendButton())

    await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce())
    expect(getComposer()).toBeDisabled()
    expect(getSendButton()).toBeDisabled()

    await act(async () => {
      createStream.push(commandStartedEvent(createStarted))
      createStream.push(conversationItemEvent(goalItem))
      for (const event of assistantMessageEvents(planItem)) createStream.push(event)
      createStream.push(stateEvent(planReady))
    })

    const approvePlan = await screen.findByRole('button', { name: 'Approve plan' })
    expect(await screen.findByText('Plan reconciled from the server.')).toBeInTheDocument()
    await waitFor(() => expect(approvePlan).toBeEnabled())

    await user.click(approvePlan)
    await waitFor(() => expect(mocks.action).toHaveBeenCalledOnce())
    expect(getComposer()).toBeDisabled()

    await act(async () => {
      actionStream.push(commandStartedEvent(planReady))
      actionStream.push(conversationItemEvent(approvedNotice))
      actionStream.push(stateEvent(actionComplete))
    })

    expect(await screen.findByText('Plan approved and ready to verify.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run verification' })).toBeEnabled()
    expect(mocks.create).toHaveBeenCalledWith(
      {
        body: {
          app_id: 'app-1',
          goal_text: 'Build a support workflow',
          derive_app_name: false,
          model_config: builderModel,
          scenario: 'build',
        },
      },
      { context: { silent: true }, signal: expect.any(AbortSignal) },
    )
    expect(mocks.action).toHaveBeenCalledWith(
      {
        params: { session_id: 'session-1' },
        body: {
          action_id: 'approve_plan',
          base_app_revision: 'hash-1',
          base_version: 2,
          payload: {},
        },
      },
      { signal: expect.any(AbortSignal) },
    )
    expect(mocks.get).not.toHaveBeenCalled()
    expect(mocks.conversation).not.toHaveBeenCalled()
  })

  it('selects Edit for a connected canvas and sends the opening goal', async () => {
    const editStarted = createSessionView({
      run_status: 'processing',
    })
    const editReply: ConversationItem = {
      at_version: 2,
      kind: 'assistant_turn',
      payload: {
        reply_text: 'Edit impact analysis is ready.',
        stage_id: 'edit.impact_analysis',
        execution: { status: 'completed' },
        turn_id: 'turn-edit',
      },
      seq: 1,
    }
    const goalItem: ConversationItem = {
      at_version: 1,
      kind: 'user',
      payload: { text: 'Add an approval step', turn_id: 'goal-edit' },
      seq: 0,
    }
    const editReady = createSessionView({
      conversation_last_seq: 1,
      phase: 'plan',
      version: 2,
    })
    mocks.create.mockResolvedValue(
      streamOf(
        commandStartedEvent(editStarted),
        conversationItemEvent(goalItem),
        ...assistantMessageEvents(editReply),
        stateEvent(editReady),
      ),
    )
    const user = userEvent.setup()
    renderFlow(1)

    await user.type(getComposer(), 'Add an approval step')
    await user.click(getSendButton())

    expect(await screen.findByText('Edit impact analysis is ready.')).toBeInTheDocument()
    expect(mocks.create.mock.calls[0]?.[0]).toEqual({
      body: {
        app_id: 'app-1',
        goal_text: 'Add an approval step',
        model_config: builderModel,
        scenario: 'edit',
      },
    })
    expect(mocks.syncDraft).toHaveBeenCalledOnce()
    expect(mocks.conversation).not.toHaveBeenCalled()
  })

  it('recovers the latest Fix view with JSON GET when the create stream ends early', async () => {
    const fixStarted = createSessionView({
      canvas_read_only: true,
      run_status: 'processing',
    })
    const recoveredNotice: ConversationItem = {
      at_version: 2,
      kind: 'notice',
      payload: { text: 'Recovered the latest Fix state.' },
      seq: 1,
    }
    const recoveredFix = createSessionView({
      actions: [{ id: 'approve_repair', kind: 'primary', label: 'Approve repair' }],
      conversation_last_seq: 1,
      phase: 'plan',
      version: 2,
    })
    mocks.create.mockResolvedValue(streamOf(commandStartedEvent(fixStarted)))
    mocks.get.mockResolvedValue(recoveredFix)
    mocks.conversation
      .mockResolvedValueOnce(conversationPage())
      .mockResolvedValueOnce(conversationPage([recoveredNotice]))
    const user = userEvent.setup()
    renderFlow()

    await user.click(screen.getByRole('button', { name: 'Fix failed run' }))

    expect(await screen.findByText('Recovered the latest Fix state.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve repair' })).toBeEnabled()
    expect(getComposer()).toBeEnabled()
    expect(mocks.create.mock.calls[0]?.[0]).toEqual({
      body: {
        app_id: 'app-1',
        failed_run_id: 'failed-run-42',
        scenario: 'fix',
      },
    })
    expect(mocks.get).toHaveBeenCalledOnce()
  })

  it('replaces an unfinished Build session with Fix and restores the new session on remount', async () => {
    const storageKey = 'dify-builder:v1:workspace-1:user-1:app-1:active-session-id'
    window.sessionStorage.setItem(storageKey, 'build-session')
    const buildForm: ConversationItem = {
      seq: 0,
      at_version: 2,
      kind: 'form',
      payload: {
        variant: 'build_requirements',
        fields: [{ key: 'audience', label: 'Build audience', type: 'text' }],
        values: { audience: 'Support agents' },
      },
    }
    const build = createSessionView({
      actions: [{ id: 'submit_requirements', kind: 'primary', label: 'Submit requirements' }],
      active_interaction: {
        action_id: 'submit_requirements',
        card_seq: buildForm.seq,
        valid_at_version: 2,
      },
      conversation_last_seq: 0,
      phase: 'clarify',
      session_id: 'build-session',
      version: 2,
    })
    const fixNotice: ConversationItem = {
      seq: 0,
      at_version: 2,
      kind: 'notice',
      payload: { text: 'Repair the selected failed run.' },
    }
    const fix = createSessionView({
      actions: [{ id: 'approve_plan', kind: 'primary', label: 'Approve repair' }],
      conversation_last_seq: 0,
      phase: 'plan',
      run_status: 'waiting_confirmation',
      session_id: 'fix-session',
      version: 2,
    })
    mocks.get.mockResolvedValueOnce(build).mockResolvedValue(fix)
    mocks.conversation.mockImplementation(({ params }: { params: { session_id: string } }) =>
      Promise.resolve(
        conversationPage(params.session_id === 'build-session' ? [buildForm] : [fixNotice]),
      ),
    )
    let finishSync!: () => void
    mocks.syncDraft.mockResolvedValueOnce(undefined).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishSync = resolve
        }),
    )
    const fixStream = createControlledEventStream()
    mocks.create.mockResolvedValue(fixStream.iterable)
    const user = userEvent.setup()
    const { unmount } = renderFlow()

    const audience = await screen.findByRole('textbox', { name: 'Build audience' })
    const fixEntry = screen.getByRole('button', { name: 'Fix failed run' })
    await waitFor(() => expect(fixEntry).toBeEnabled())
    await user.type(getComposer(), 'Continue the build')
    await user.click(fixEntry)
    await waitFor(() => expect(fixEntry).toBeDisabled())
    expect(audience).toBeDisabled()
    expect(getComposer()).toBeDisabled()
    expect(mocks.create).not.toHaveBeenCalled()

    await act(async () => finishSync())
    await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce())
    expect(screen.queryByRole('textbox', { name: 'Build audience' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Submit requirements' })).not.toBeInTheDocument()
    expect(getComposer()).toHaveValue('')

    await act(async () => {
      fixStream.push(
        commandStartedEvent({
          ...fix,
          actions: [],
          canvas_read_only: true,
          conversation_last_seq: -1,
          phase: 'understand',
          run_status: 'processing',
          version: 1,
        }),
      )
      fixStream.push(stateEvent(fix))
      fixStream.close()
    })
    expect(await screen.findByText('Repair the selected failed run.')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Approve repair' })).toBeEnabled(),
    )
    expect(window.sessionStorage.getItem(storageKey)).toBe('fix-session')
    expect(mocks.create.mock.calls[0]?.[0].body).toMatchObject({
      scenario: 'fix',
      app_id: 'app-1',
      failed_run_id: 'failed-run-42',
    })

    unmount()
    renderFlow()

    expect(await screen.findByText('Repair the selected failed run.')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Build audience' })).not.toBeInTheDocument()
    expect(mocks.get).toHaveBeenLastCalledWith(
      { params: { session_id: 'fix-session' } },
      { context: { silent: true }, signal: expect.any(AbortSignal) },
    )
    expect(mocks.create).toHaveBeenCalledOnce()
  })
})
