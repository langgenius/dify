import type { DifyBuilderStreamEventResponse } from '@dify/contracts/api/console/dify-builder/types.gen'
import type { ConversationItem, SessionView } from '../types'
import type { MarkdownProps } from '@/app/components/base/markdown'
import { act, screen, waitFor, within } from '@testing-library/react'
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
  app_id: 'app-1',
  app_revision: { observed: 'hash-1', current: 'hash-1', conflicted: false },
  canvas_read_only: false,
  active_interaction: null,
  conversation_last_seq: -1,
  interrupted: false,
  run_status: 'waiting_input',
  session_id: 'session-1',
  state: 'build.await_requirements',
  version: 1,
  ...overrides,
})

const commandStartedEvent = (view: SessionView): DifyBuilderStreamEventResponse => ({
  event: 'command_started',
  data: { kind: 'command_started', ...view },
})

const conversationPage = (data: ConversationItem[] = []) => ({
  data,
  first_seq: data[0]?.seq ?? null,
  has_more: false,
  last_seq: data.at(-1)?.seq ?? null,
})

const stateEvent = (view: SessionView): DifyBuilderStreamEventResponse => ({
  event: 'state',
  data: { kind: 'state', ...view },
})

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
const renderFlow = (edgeCount = 0) => {
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
    { features: { dify_builder_enabled: true }, queryClient },
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

  it.each([
    {
      entryMode: 'build',
      edgeCount: 0,
      approvalState: 'build.plan_approval',
      appliedState: 'build.execution',
    },
    {
      entryMode: 'edit',
      edgeCount: 1,
      approvalState: 'edit.plan_approval',
      appliedState: 'edit.apply_changes',
    },
    {
      entryMode: 'fix',
      edgeCount: 0,
      approvalState: 'fix.await_approval',
      appliedState: 'fix.await_verify',
    },
  ] as const)(
    'displays $entryMode change sets on commit and after restoring the session',
    async ({ entryMode, edgeCount, approvalState, appliedState }) => {
      const waiting = createSessionView({
        entry_mode: entryMode,
        state: approvalState,
        version: 2,
        actions: [{ id: 'approve_plan', kind: 'primary', label: 'Approve changes' }],
      })
      const changeSet: ConversationItem = {
        seq: 0,
        at_version: 3,
        kind: 'change_set',
        payload: {
          count: 2,
          changes: ['Update answer configuration', 'Add an approval step'],
          scope: 'configuration',
          nodes: [
            { node_id: 'node3', title: 'Answer' },
            { node_id: 'node4', title: 'Approval' },
          ],
        },
      }
      const applied = createSessionView({
        entry_mode: entryMode,
        state: appliedState,
        version: 3,
        conversation_last_seq: 0,
      })
      const actionStream = createControlledEventStream()
      mocks.create.mockResolvedValue(
        streamOf(commandStartedEvent(createSessionView()), stateEvent(waiting)),
      )
      mocks.action.mockResolvedValue(actionStream.iterable)
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
        actionStream.push({
          event: 'commit',
          data: {
            kind: 'commit',
            session_id: waiting.session_id,
            operation_id: 'apply-1',
            stage_id: appliedState,
            at_version: 3,
            version: 3,
            state: appliedState,
            settled: true,
            items: [changeSet],
          },
        })
      })

      const changes = await screen.findByRole('article', { name: 'workflow.difyBuilder.changes' })
      const details = within(changes).getByRole('list', {
        name: 'workflow.difyBuilder.changeDetails',
      })
      for (const change of changeSet.payload.changes) {
        expect(within(details).getByText(change)).toBeInTheDocument()
      }
      const targets = within(changes).getByRole('list', {
        name: 'workflow.difyBuilder.affectedNodes',
      })
      expect(within(targets).getByText('Answer')).toBeInTheDocument()
      expect(within(targets).getByText('node3')).toBeInTheDocument()
      expect(within(changes).queryByRole('button')).not.toBeInTheDocument()
      expect(getComposer()).toBeDisabled()

      await act(async () => {
        actionStream.push(stateEvent(applied))
        actionStream.close()
      })
      await waitFor(() => expect(getComposer()).toBeEnabled())

      mocks.get.mockResolvedValue(applied)
      mocks.conversation.mockResolvedValue(conversationPage([changeSet]))
      unmount()
      renderFlow(edgeCount)

      const restored = await screen.findByRole('article', { name: 'workflow.difyBuilder.changes' })
      const restoredDetails = within(restored).getByRole('list', {
        name: 'workflow.difyBuilder.changeDetails',
      })
      for (const change of changeSet.payload.changes) {
        expect(within(restoredDetails).getByText(change)).toBeInTheDocument()
      }
      const restoredTargets = within(restored).getByRole('list', {
        name: 'workflow.difyBuilder.affectedNodes',
      })
      expect(within(restoredTargets).getByText('Answer')).toBeInTheDocument()
      expect(within(restoredTargets).getByText('node3')).toBeInTheDocument()
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
        state,
        version: 2,
        conversation_last_seq: 0,
        active_interaction: { action_id: actionId, card: form, valid_at_version: 2 },
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
        active_interaction: { action_id: actionId, card: form, valid_at_version: 4 },
      }
      const messageStream = createControlledEventStream()
      mocks.create.mockResolvedValue(
        streamOf(commandStartedEvent(createSessionView()), stateEvent(waiting)),
      )
      mocks.conversation
        .mockResolvedValueOnce(conversationPage())
        .mockResolvedValueOnce(conversationPage([form]))
        .mockResolvedValueOnce(conversationPage([reply]))
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
      await act(async () => {
        messageStream.push(commandStartedEvent(waiting))
        messageStream.push({
          event: 'commit',
          data: {
            kind: 'commit',
            session_id: waiting.session_id,
            operation_id: 'message-1',
            stage_id: state,
            at_version: 3,
            version: 3,
            state,
            settled: false,
            items: [
              {
                seq: 1,
                at_version: 3,
                kind: 'user',
                payload: { turn_id: 'user-1', text: 'How is the audience used?' },
              },
            ],
          },
        })
      })
      await screen.findByText('How is the audience used?')
      expect(screen.getByRole('textbox', { name: 'Audience' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Submit form' })).toBeDisabled()

      await act(async () => messageStream.push(stateEvent(answered)))
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
      state: 'build.goal',
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
    const planReady = createSessionView({
      actions: [{ id: 'approve_plan', kind: 'primary', label: 'Approve plan' }],
      conversation_last_seq: 1,
      phase: 'plan',
      state: 'build.await_plan_approval',
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
      state: 'build.await_verify',
      version: 3,
    })
    const createStream = createControlledEventStream()
    const actionStream = createControlledEventStream()
    mocks.create.mockResolvedValue(createStream.iterable)
    mocks.action.mockResolvedValue(actionStream.iterable)
    mocks.conversation
      .mockResolvedValueOnce(conversationPage())
      .mockResolvedValueOnce(conversationPage([planItem]))
      .mockResolvedValueOnce(conversationPage([approvedNotice]))
    const user = userEvent.setup()
    renderFlow()

    await user.type(getComposer(), 'Build a support workflow')
    await user.click(getSendButton())

    await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce())
    expect(getComposer()).toBeDisabled()
    expect(getSendButton()).toBeDisabled()

    await act(async () => {
      createStream.push(commandStartedEvent(createStarted))
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
      actionStream.push(stateEvent(actionComplete))
    })

    expect(await screen.findByText('Plan approved and ready to verify.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run verification' })).toBeEnabled()
    expect(mocks.create).toHaveBeenCalledWith(
      {
        body: {
          app_id: 'app-1',
          goal_text: 'Build a support workflow',
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
  })

  it('selects Edit for a connected canvas and sends the opening goal', async () => {
    const editStarted = createSessionView({
      entry_mode: 'edit',
      run_status: 'processing',
      state: 'edit.capability_check',
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
    const editReady = createSessionView({
      conversation_last_seq: 1,
      entry_mode: 'edit',
      phase: 'plan',
      state: 'edit.await_rules',
      version: 2,
    })
    mocks.conversation
      .mockResolvedValueOnce(conversationPage())
      .mockResolvedValueOnce(conversationPage([editReply]))
    mocks.create.mockResolvedValue(
      streamOf(commandStartedEvent(editStarted), stateEvent(editReady)),
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
  })

  it('recovers the latest Fix view with JSON GET when the create stream ends early', async () => {
    const fixStarted = createSessionView({
      canvas_read_only: true,
      entry_mode: 'fix',
      run_status: 'processing',
      state: 'fix.diagnose',
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
      entry_mode: 'fix',
      phase: 'plan',
      state: 'fix.await_approval',
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
        card: buildForm,
        valid_at_version: 2,
      },
      conversation_last_seq: 0,
      entry_mode: 'build',
      phase: 'clarify',
      session_id: 'build-session',
      state: 'build.goal_analysis',
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
      entry_mode: 'fix',
      phase: 'plan',
      run_status: 'waiting_confirmation',
      session_id: 'fix-session',
      state: 'fix.await_approval',
      version: 2,
    })
    mocks.get.mockResolvedValueOnce(build).mockResolvedValue(fix)
    mocks.conversation.mockImplementation(({ params }: { params: { session_id: string } }) =>
      Promise.resolve(
        conversationPage(params.session_id === 'build-session' ? [buildForm] : [fixNotice]),
      ),
    )
    let finishSync!: () => void
    mocks.syncDraft.mockImplementationOnce(
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
          state: 'fix.diagnose',
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
