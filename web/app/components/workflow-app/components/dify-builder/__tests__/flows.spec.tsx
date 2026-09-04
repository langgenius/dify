import type { DifyBuilderStreamEventResponse } from '@dify/contracts/api/console/dify-builder/types.gen'
import type { ConversationItem, SessionView } from '../types'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useSetAtom } from 'jotai'
import { baseProviderContextValue, ProviderContext } from '@/context/provider-context'
import DifyBuilderPanel from '../panel'
import { DifyBuilderProvider } from '../provider'
import { difyBuilderStartRunFixAtom } from '../store'

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
  setShowPanel: vi.fn(),
  syncDraft: vi.fn(async () => undefined),
}))

vi.mock('@/service/client', () => ({
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
}))

vi.mock('../model-selector', () => ({
  default: () => <button type="button">Model selector</button>,
}))

vi.mock('@/features/agent-v2/agent-detail/configure/components/build-grid-texture', () => ({
  AgentBuildGridTexture: () => null,
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: <T,>(
    selector: (state: {
      setCanvasReadOnly: typeof mocks.setCanvasReadOnly
      setShowDifyBuilderPanel: typeof mocks.setShowPanel
    }) => T,
  ) =>
    selector({
      setCanvasReadOnly: mocks.setCanvasReadOnly,
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
  const startFix = useSetAtom(difyBuilderStartRunFixAtom)
  return (
    <button type="button" onClick={() => void startFix('failed-run-42')}>
      Fix failed run
    </button>
  )
}

const renderFlow = (edgeCount = 0) =>
  render(
    // oxlint-disable-next-line eslint-react/no-context-provider -- use-context-selector requires its special provider.
    <ProviderContext.Provider value={{ ...baseProviderContextValue, difyBuilderEnabled: true }}>
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
      </DifyBuilderProvider>
    </ProviderContext.Provider>,
  )

const getComposer = () =>
  screen.getByRole('textbox', { name: 'workflow.difyBuilder.messagePlaceholder' })

const getSendButton = () => screen.getByRole('button', { name: 'workflow.difyBuilder.messageSend' })

describe('Dify Builder Build, Edit, and Fix flows', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.conversation.mockResolvedValue(conversationPage())
    window.sessionStorage.clear()
  })

  it('streams a Build command and next action without a session-state GET', async () => {
    const createStarted = createSessionView({
      canvas_read_only: true,
      run_status: 'executing',
      state: 'build.goal',
    })
    const planItem: ConversationItem = {
      at_version: 2,
      kind: 'assistant_turn',
      payload: {
        reply_text: 'Plan reconciled from the server.',
        stage_id: 'build.plan',
        trace: { status: 'completed' },
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
          scenario: 'build',
        },
      },
      { signal: expect.any(AbortSignal) },
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
      run_status: 'executing',
      state: 'edit.capability_check',
    })
    const editReply: ConversationItem = {
      at_version: 2,
      kind: 'assistant_turn',
      payload: {
        reply_text: 'Edit impact analysis is ready.',
        stage_id: 'edit.impact_analysis',
        trace: { status: 'completed' },
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
        scenario: 'edit',
      },
    })
    expect(mocks.syncDraft).toHaveBeenCalledOnce()
  })

  it('recovers the latest Fix view with JSON GET when the create stream ends early', async () => {
    const fixStarted = createSessionView({
      canvas_read_only: true,
      entry_mode: 'fix',
      run_status: 'executing',
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
})
