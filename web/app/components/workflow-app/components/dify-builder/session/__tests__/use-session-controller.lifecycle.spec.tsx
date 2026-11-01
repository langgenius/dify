import { act, waitFor } from '@testing-library/react'
import { difyBuilderDraftAtom } from '../../store'
import {
  difyBuilderActiveSessionIdAtom,
  difyBuilderConversationAtom,
  difyBuilderLifecycleControlAtom,
  difyBuilderSessionViewAtom,
} from '../state'
import {
  commandStartedEvent,
  conversationPage,
  createControlledEventStream,
  createSessionView,
  renderSessionHook,
  stateEvent,
} from './fixtures'

const api = vi.hoisted(() => ({
  create: vi.fn(),
  get: vi.fn(),
  conversation: vi.fn(),
  stream: vi.fn(),
  clear: vi.fn(),
  abandon: vi.fn(),
  fix: vi.fn(),
  fixRead: vi.fn(),
  action: vi.fn(),
}))

vi.mock('@/service/console', async (importOriginal) => ({
  consoleQuery: (await importOriginal<typeof import('@/service/console')>()).consoleQuery,
  consoleClient: {
    difyBuilder: {
      sessions: {
        post: api.create,
        bySessionId: {
          get: api.get,
          conversation: { get: api.conversation },
          stream: { get: api.stream },
          clear: { post: api.clear },
          abandon: { post: api.abandon },
          fixIntents: { post: api.fix, get: api.fixRead },
          actions: { post: api.action },
        },
      },
    },
  },
}))

const history = [
  {
    seq: 0,
    at_version: 1,
    kind: 'user' as const,
    payload: { text: 'Original goal', turn_id: 'turn-1' },
  },
]
const seed = (store: ReturnType<typeof renderSessionHook>['store']) => {
  const view = createSessionView({
    version: 4,
    task_id: 'task-1',
    task_status: 'completed',
    run_status: 'complete',
    canvas_read_only: false,
    conversation_last_seq: 0,
  })
  act(() => {
    store.set(difyBuilderActiveSessionIdAtom, view.session_id)
    store.set(difyBuilderSessionViewAtom, view)
    store.set(difyBuilderConversationAtom, history)
    store.set(difyBuilderDraftAtom, 'Unsent requirement')
  })
  return view
}

beforeEach(() => {
  vi.resetAllMocks()
  api.conversation.mockResolvedValue(conversationPage(history))
})

it('clears through the confirmed JSON endpoint without preparing or running a command', async () => {
  const prepare = vi.fn()
  const { result, store } = renderSessionHook(prepare)
  seed(store)
  api.clear.mockImplementation(async ({ body }) => ({
    session_id: 'session-1',
    version: 5,
    task_id: 'task-1',
    task_status: 'abandoned',
    last_command_id: body.client_action_id,
    conversation_cleared: true,
    conversation_last_seq: -1,
    settlement: 'settled',
  }))

  await act(async () => expect(await result.current.clearConversation()).toBe(true))
  expect(api.clear).toHaveBeenCalledExactlyOnceWith(
    {
      params: { session_id: 'session-1' },
      body: {
        base_version: 4,
        expected_task_id: 'task-1',
        confirmed: true,
        client_action_id: expect.any(String),
      },
    },
    { context: { silent: true }, signal: expect.any(AbortSignal) },
  )
  expect(prepare).not.toHaveBeenCalled()
  expect(api.create).not.toHaveBeenCalled()
  expect(api.action).not.toHaveBeenCalled()
  expect(api.stream).not.toHaveBeenCalled()
})

it('abandons the current task through JSON, retaining its conversation and invalidated history', async () => {
  const prepare = vi.fn()
  const { result, store } = renderSessionHook(prepare)
  seed(store)
  const abandoned = createSessionView({
    version: 5,
    task_id: 'task-1',
    task_status: 'abandoned',
    run_status: 'paused',
    canvas_read_only: false,
    conversation_last_seq: 0,
  })
  api.abandon.mockImplementation(async ({ body }) => ({
    session_id: 'session-1',
    version: 5,
    task_id: 'task-1',
    task_status: 'abandoned',
    last_command_id: body.client_action_id,
    conversation_cleared: false,
    conversation_last_seq: 0,
    settlement: 'settled',
  }))
  api.get.mockResolvedValue(abandoned)
  await act(async () => expect(await result.current.abandonTask()).toBe(true))
  expect(api.abandon).toHaveBeenCalledWith(
    {
      params: { session_id: 'session-1' },
      body: {
        base_version: 4,
        expected_task_id: 'task-1',
        client_action_id: expect.any(String),
      },
    },
    { context: { silent: true }, signal: expect.any(AbortSignal) },
  )
  expect(store.get(difyBuilderConversationAtom)).toEqual(history)
  expect(store.get(difyBuilderActiveSessionIdAtom)).toBe('session-1')
  expect(store.get(difyBuilderSessionViewAtom)?.task_status).toBe('abandoned')
  expect(store.get(difyBuilderDraftAtom)).toBe('Unsent requirement')
  expect(prepare).not.toHaveBeenCalled()
  expect(api.stream).not.toHaveBeenCalled()
  expect(api.create).not.toHaveBeenCalled()
})

it('isolates a cleared session on restore but keeps commands blocked without authoritative settlement', async () => {
  const { result, store } = renderSessionHook()
  seed(store)
  api.get.mockResolvedValue(
    createSessionView({
      version: 5,
      task_status: 'abandoned',
      conversation_cleared: true,
      conversation_last_seq: -1,
      run_status: 'complete',
      canvas_read_only: false,
    }),
  )
  await act(async () => expect(await result.current.restore('session-1')).toBe(true))
  expect(store.get(difyBuilderActiveSessionIdAtom)).toBe('session-1')
  expect(store.get(difyBuilderConversationAtom)).toEqual([])
  expect(store.get(difyBuilderLifecycleControlAtom)?.phase).toBe('unknown')
  expect(await result.current.startBuild('app-1', 'Another task')).toBe(false)
  expect(api.conversation).not.toHaveBeenCalled()
  expect(api.create).not.toHaveBeenCalled()
  expect(api.stream).not.toHaveBeenCalled()
})

it.each([null, 'pending', 'unknown', 'settled'] as const)(
  'uses the authoritative %s lifecycle settlement when restoring a cleared session',
  async (settlement) => {
    const { result, store } = renderSessionHook()
    seed(store)
    act(() =>
      store.set(difyBuilderLifecycleControlAtom, {
        operation: 'clear',
        phase: 'unknown',
        sessionId: 'session-1',
        clientActionId: 'clear-1',
        baseVersion: 4,
        expectedTaskId: 'task-1',
      }),
    )
    api.get.mockResolvedValue(
      createSessionView({
        version: 5,
        task_status: 'abandoned',
        conversation_cleared: true,
        conversation_last_seq: -1,
        run_status: 'complete',
        canvas_read_only: false,
        last_command_id: 'clear-1',
        lifecycle_settlement: settlement,
      }),
    )
    await act(async () => expect(await result.current.restore('session-1')).toBe(true))
    expect(store.get(difyBuilderConversationAtom)).toEqual([])
    if (settlement === 'settled') {
      expect(store.get(difyBuilderActiveSessionIdAtom)).toBeNull()
      expect(store.get(difyBuilderLifecycleControlAtom)).toBeNull()
    } else {
      expect(store.get(difyBuilderActiveSessionIdAtom)).toBe('session-1')
      expect(store.get(difyBuilderLifecycleControlAtom)?.phase).toBe('unknown')
      expect(await result.current.startBuild('app-1', 'Another task')).toBe(false)
    }
    expect(api.clear).not.toHaveBeenCalled()
    expect(api.create).not.toHaveBeenCalled()
    expect(api.stream).not.toHaveBeenCalled()
  },
)

it.each([null, 'pending', 'unknown', 'settled'] as const)(
  'keeps an abandoned task blocked until its matching %s settlement is authoritative',
  async (settlement) => {
    const { result, store } = renderSessionHook()
    seed(store)
    act(() =>
      store.set(difyBuilderLifecycleControlAtom, {
        operation: 'abandon',
        phase: 'unknown',
        sessionId: 'session-1',
        clientActionId: 'abandon-1',
        baseVersion: 4,
        expectedTaskId: 'task-1',
      }),
    )
    api.get.mockResolvedValue(
      createSessionView({
        version: 5,
        task_id: 'task-1',
        task_status: 'abandoned',
        run_status: 'paused',
        canvas_read_only: false,
        conversation_last_seq: 0,
        last_command_id: 'abandon-1',
        lifecycle_settlement: settlement,
      }),
    )
    await act(async () => expect(await result.current.restore('session-1')).toBe(true))
    expect(store.get(difyBuilderConversationAtom)).toEqual(history)
    expect(store.get(difyBuilderActiveSessionIdAtom)).toBe('session-1')
    expect(store.get(difyBuilderLifecycleControlAtom)?.phase ?? null).toBe(
      settlement === 'settled' ? null : 'unknown',
    )
    expect(api.abandon).not.toHaveBeenCalled()
    expect(api.create).not.toHaveBeenCalled()
  },
)

it('does not borrow a different clear identity even when its settlement is settled', async () => {
  const { result, store } = renderSessionHook()
  seed(store)
  act(() =>
    store.set(difyBuilderLifecycleControlAtom, {
      operation: 'clear',
      phase: 'unknown',
      sessionId: 'session-1',
      clientActionId: 'clear-1',
      baseVersion: 4,
      expectedTaskId: 'task-1',
    }),
  )
  api.get.mockResolvedValue(
    createSessionView({
      version: 5,
      task_status: 'abandoned',
      conversation_cleared: true,
      conversation_last_seq: -1,
      run_status: 'complete',
      canvas_read_only: false,
      last_command_id: 'different-clear',
      lifecycle_settlement: 'settled',
    }),
  )
  await act(async () => expect(await result.current.restore('session-1')).toBe(true))
  expect(store.get(difyBuilderLifecycleControlAtom)?.clientActionId).toBe('clear-1')
  expect(store.get(difyBuilderConversationAtom)).toEqual([])
  expect(await result.current.startBuild('app-1', 'Another task')).toBe(false)
  expect(api.create).not.toHaveBeenCalled()
})

it('does not restore old context from a delayed snapshot after an acknowledged clear', async () => {
  const { result, store } = renderSessionHook()
  const before = seed(store)
  api.clear.mockImplementation(async ({ body }) => ({
    session_id: 'session-1',
    version: 5,
    task_id: 'task-1',
    task_status: 'abandoned',
    last_command_id: body.client_action_id,
    conversation_cleared: true,
    conversation_last_seq: -1,
    settlement: 'pending',
  }))
  await act(async () => expect(await result.current.clearConversation()).toBe(false))
  api.get.mockResolvedValue(before)
  await act(async () => {
    await result.current.restore('session-1')
  })
  expect(store.get(difyBuilderSessionViewAtom)?.conversation_cleared).toBe(true)
  expect(store.get(difyBuilderSessionViewAtom)?.version).toBe(5)
  expect(store.get(difyBuilderConversationAtom)).toEqual([])
  expect(api.conversation).not.toHaveBeenCalled()
  expect(api.clear).toHaveBeenCalledOnce()
})

it('isolates an SSE clear projection and keeps its pending settlement blocked', async () => {
  const response = createControlledEventStream()
  api.create.mockResolvedValue(response.iterable)
  const { result, store } = renderSessionHook()
  let building!: Promise<boolean>
  act(() => {
    building = result.current.startBuild('app-1', 'Original goal')
  })
  await waitFor(() => expect(api.create).toHaveBeenCalledOnce())
  act(() => response.push(commandStartedEvent(createSessionView({ version: 4 }))))
  await waitFor(() => expect(store.get(difyBuilderActiveSessionIdAtom)).toBe('session-1'))
  act(() => {
    store.set(difyBuilderConversationAtom, history)
    response.push(
      stateEvent(
        createSessionView({
          version: 5,
          conversation_cleared: true,
          task_status: 'abandoned',
          conversation_last_seq: -1,
          run_status: 'complete',
          lifecycle_settlement: 'pending',
        }),
      ),
    )
  })
  await waitFor(() => expect(store.get(difyBuilderConversationAtom)).toEqual([]))
  await act(async () => {
    response.close()
    await building
  })
  expect(store.get(difyBuilderLifecycleControlAtom)?.phase).toBe('unknown')
  expect(store.get(difyBuilderActiveSessionIdAtom)).toBe('session-1')
  expect(api.clear).not.toHaveBeenCalled()
  expect(api.create).toHaveBeenCalledOnce()
  expect(api.stream).not.toHaveBeenCalled()
})

it('only interrupts the original response after the server acknowledges an explicit Fix switch', async () => {
  const response = createControlledEventStream()
  const switching = createControlledEventStream()
  api.create.mockResolvedValue(response.iterable)
  api.action.mockResolvedValue(switching.iterable)
  const { result, store } = renderSessionHook()
  let building!: Promise<boolean>
  act(() => {
    building = result.current.startBuild('app-1', 'Original goal')
  })
  await waitFor(() => expect(api.create).toHaveBeenCalledOnce())
  act(() => response.push(commandStartedEvent(createSessionView({ version: 4 }))))
  await waitFor(() => expect(store.get(difyBuilderActiveSessionIdAtom)).toBe('session-1'))
  const payload = { fix_intent_id: 'fix-1', expected_task_id: 'task-1' }
  act(() => {
    store.set(difyBuilderConversationAtom, history)
    store.set(
      difyBuilderSessionViewAtom,
      createSessionView({
        version: 4,
        task_id: 'task-1',
        pending_fix_context: {
          run_id: 'failed-1',
          title: '',
          error_code: '',
          message: '',
          trace_ref: '',
        },
        actions: [
          { id: 'stop_and_switch_fix', label: 'Stop and fix', kind: 'destructive', payload },
        ],
      }),
    )
  })
  let switched!: Promise<boolean>
  act(() => {
    switched = result.current.runAction('confirm', { option_id: 'stop_and_switch_fix', ...payload })
  })
  await waitFor(() => expect(api.action).toHaveBeenCalledOnce())
  expect(api.create.mock.calls[0]![1].signal.aborted).toBe(false)
  await act(async () => {
    switching.push(
      stateEvent(
        createSessionView({
          version: 5,
          task_id: 'task-2',
          run_status: 'waiting_input',
          canvas_read_only: false,
          conversation_last_seq: 0,
          task_summaries: [{ task_id: 'earlier-task', goal: 'Earlier goal' }],
        }),
      ),
    )
    expect(await switched).toBe(true)
    response.close()
    await building
  })
  expect(api.create.mock.calls[0]![1].signal.aborted).toBe(true)
  expect(store.get(difyBuilderSessionViewAtom)?.task_id).toBe('task-2')
  expect(store.get(difyBuilderSessionViewAtom)?.task_summaries).toEqual([
    { task_id: 'earlier-task', goal: 'Earlier goal' },
  ])
  expect(store.get(difyBuilderConversationAtom)).toEqual(history)
  expect(api.create).toHaveBeenCalledOnce()
  expect(api.stream).not.toHaveBeenCalled()
})

it('rejects a Fix decision absent from the server actions', async () => {
  const { result, store } = renderSessionHook()
  seed(store)
  await act(async () =>
    expect(
      await result.current.runAction('confirm', {
        option_id: 'stop_and_switch_fix',
        fix_intent_id: 'invented',
        expected_task_id: 'task-1',
      }),
    ).toBe(false),
  )
  expect(api.action).not.toHaveBeenCalled()
})

it.each(['rejected', 'lost response', 'pending settlement', 'unknown settlement'])(
  'retains its blocking identity and never automatically retries clear after %s',
  async (outcome) => {
    const { result, store } = renderSessionHook()
    const before = seed(store)
    if (outcome === 'rejected') api.clear.mockRejectedValue(new Response(null, { status: 409 }))
    else if (outcome === 'lost response') api.clear.mockRejectedValue(new TypeError('Offline'))
    else
      api.clear.mockImplementation(async ({ body }) => ({
        session_id: 'session-1',
        version: 5,
        task_id: 'task-1',
        task_status: 'abandoned',
        last_command_id: body.client_action_id,
        conversation_cleared: true,
        conversation_last_seq: -1,
        settlement: outcome === 'pending settlement' ? 'pending' : 'unknown',
      }))

    await act(async () => expect(await result.current.clearConversation()).toBe(false))
    if (outcome === 'pending settlement' || outcome === 'unknown settlement') {
      expect(store.get(difyBuilderSessionViewAtom)?.conversation_cleared).toBe(true)
      expect(store.get(difyBuilderConversationAtom)).toEqual([])
      expect(store.get(difyBuilderDraftAtom)).toBe('')
      expect(store.get(difyBuilderActiveSessionIdAtom)).toBe('session-1')
    } else {
      expect(store.get(difyBuilderSessionViewAtom)).toEqual(before)
      expect(store.get(difyBuilderConversationAtom)).toEqual(history)
      expect(store.get(difyBuilderDraftAtom)).toBe('Unsent requirement')
    }
    expect(api.clear).toHaveBeenCalledOnce()
    expect(api.create).not.toHaveBeenCalled()
    expect(api.stream).not.toHaveBeenCalled()
    if (outcome !== 'rejected') {
      await act(async () => expect(await result.current.clearConversation()).toBe(false))
      expect(api.clear).toHaveBeenCalledOnce()
      expect(await result.current.startBuild('app-1', 'Another task')).toBe(false)
      expect(api.create).not.toHaveBeenCalled()
    }
  },
)

it('stages an existing-session Fix while busy and dismisses it without interrupting the original response', async () => {
  const response = createControlledEventStream()
  api.create.mockResolvedValue(response.iterable)
  const prepare = vi.fn(async () => {})
  const { result, store } = renderSessionHook(prepare)
  let building!: Promise<boolean>
  act(() => {
    building = result.current.startBuild('app-1', 'Original goal')
  })
  await waitFor(() => expect(api.create).toHaveBeenCalledOnce())
  act(() => response.push(commandStartedEvent(createSessionView({ version: 4 }))))
  await waitFor(() => expect(store.get(difyBuilderActiveSessionIdAtom)).toBe('session-1'))
  const pending = createSessionView({
    version: 4,
    task_id: 'task-1',
    pending_fix_context: {
      run_id: 'failed-1',
      title: '',
      error_code: '',
      message: '',
      trace_ref: '',
    },
    actions: [
      {
        id: 'dismiss_fix',
        label: 'Keep current task',
        kind: 'secondary',
        payload: { fix_intent_id: 'fix-1', expected_task_id: 'task-1' },
      },
    ],
  })
  api.fix.mockResolvedValue({
    fix_intent_id: 'fix-1',
    status: 'awaiting_confirmation',
    session: pending,
  })
  let fixing!: Promise<boolean>
  act(() => {
    fixing = result.current.startFix('app-1', 'failed-1')
  })
  await waitFor(() => expect(api.fix).toHaveBeenCalledOnce())
  await act(async () => expect(await fixing).toBe(true))
  expect(api.fix).toHaveBeenCalledWith(
    {
      params: { session_id: 'session-1' },
      body: {
        base_version: 4,
        client_action_id: expect.any(String),
        failed_run_id: 'failed-1',
      },
    },
    { context: { silent: true }, signal: expect.any(AbortSignal) },
  )
  expect(api.create.mock.calls[0]![1].signal.aborted).toBe(false)
  expect(prepare).toHaveBeenCalledOnce()
  const dismissed = createSessionView({ version: 5, task_id: 'task-1' })
  api.action.mockResolvedValue(
    (async function* () {
      yield stateEvent(dismissed)
    })(),
  )
  await act(async () =>
    expect(
      await result.current.runAction('confirm', {
        option_id: 'dismiss_fix',
        fix_intent_id: 'fix-1',
        expected_task_id: 'task-1',
      }),
    ).toBe(true),
  )
  expect(api.action).toHaveBeenCalledWith(
    {
      params: { session_id: 'session-1' },
      body: {
        action_id: 'confirm',
        base_version: 4,
        base_app_revision: 'revision-1',
        client_action_id: expect.any(String),
        payload: {
          option_id: 'dismiss_fix',
          fix_intent_id: 'fix-1',
          expected_task_id: 'task-1',
        },
      },
    },
    { signal: expect.any(AbortSignal) },
  )
  expect(api.create.mock.calls[0]![1].signal.aborted).toBe(false)
  expect(api.create).toHaveBeenCalledOnce()
  await act(async () => {
    response.push(stateEvent(createSessionView({ version: 6, run_status: 'waiting_input' })))
    await building
  })
})

it.each(['task-1', 'other-task'])(
  'recovers completed abandon only with its exact settled task %s',
  async (taskId) => {
    const { result, store } = renderSessionHook()
    seed(store)
    act(() =>
      store.set(difyBuilderLifecycleControlAtom, {
        operation: 'abandon',
        phase: 'unknown',
        sessionId: 'session-1',
        clientActionId: 'abandon-completed',
        baseVersion: 4,
        expectedTaskId: 'task-1',
      }),
    )
    api.get.mockResolvedValue(
      createSessionView({
        version: 5,
        task_id: taskId,
        task_status: 'completed',
        run_status: 'complete',
        canvas_read_only: false,
        conversation_last_seq: 0,
        last_command_id: 'abandon-completed',
        lifecycle_settlement: 'settled',
      }),
    )
    await act(async () => expect(await result.current.restore('session-1')).toBe(true))
    expect(store.get(difyBuilderLifecycleControlAtom)?.phase ?? null).toBe(
      taskId === 'task-1' ? null : 'unknown',
    )
    expect(api.abandon).not.toHaveBeenCalled()
  },
)

it.each(['fix', 'dismiss_fix', 'stop_and_switch_fix'] as const)(
  'restores only the exact authenticated %s control receipt without replay',
  async (operation) => {
    const { result, store } = renderSessionHook()
    seed(store)
    const control = {
      operation,
      phase: 'unknown' as const,
      sessionId: 'session-1',
      clientActionId: 'lost-action',
      baseVersion: 4,
      expectedTaskId: 'task-1',
      ...(operation !== 'fix' ? { fixIntentId: 'intent-1' } : {}),
    }
    act(() => store.set(difyBuilderLifecycleControlAtom, control))
    api.get.mockResolvedValue(
      createSessionView({
        version: 6,
        run_status: 'complete',
        conversation_last_seq: 0,
        task_id: 'task-2',
      }),
    )
    const receipt = {
      session_id: 'session-1',
      operation,
      client_action_id: 'lost-action',
      base_version: 4,
      target_task_id: 'task-1',
      fix_intent_id: 'intent-1',
      status:
        operation === 'fix'
          ? 'awaiting_confirmation'
          : operation === 'dismiss_fix'
            ? 'dismissed'
            : 'activated',
      acknowledged: true,
    }
    for (const forged of [
      { client_action_id: 'wrong' },
      { target_task_id: 'wrong' },
      { acknowledged: false },
      ...(operation === 'fix' ? [] : [{ fix_intent_id: 'wrong' }]),
    ]) {
      api.fixRead.mockResolvedValueOnce({ ...receipt, ...forged })
      await act(async () => expect(await result.current.refresh()).toBe(true))
      expect(store.get(difyBuilderLifecycleControlAtom)).toEqual(control)
    }
    api.fixRead.mockResolvedValueOnce(receipt)
    await act(async () => expect(await result.current.refresh()).toBe(true))
    expect(store.get(difyBuilderLifecycleControlAtom)).toBeNull()
    expect(api.fixRead).toHaveBeenLastCalledWith(
      {
        params: { session_id: 'session-1' },
        query: {
          operation,
          client_action_id: 'lost-action',
          base_version: 4,
          expected_task_id: 'task-1',
          ...(operation !== 'fix' ? { fix_intent_id: 'intent-1' } : {}),
        },
      },
      { context: { silent: true }, signal: expect.any(AbortSignal) },
    )
    expect(api.fix).not.toHaveBeenCalled()
    expect(api.action).not.toHaveBeenCalled()
  },
)

it.each([409, undefined])(
  'keeps unknown Fix fenced if explicit clear fails with %s, using a fresh task/version',
  async (status) => {
    const { result, store } = renderSessionHook()
    seed(store)
    const control = {
      operation: 'fix' as const,
      phase: 'unknown' as const,
      sessionId: 'session-1',
      clientActionId: 'lost-alias',
      baseVersion: 4,
      expectedTaskId: 'task-1',
    }
    act(() => store.set(difyBuilderLifecycleControlAtom, control))
    api.get.mockResolvedValue(
      createSessionView({ version: 7, task_id: 'task-new', run_status: 'complete' }),
    )
    api.clear.mockRejectedValue(
      Object.assign(new Error('Request failed'), status ? { status } : {}),
    )
    await act(async () => expect(await result.current.clearConversation()).toBe(false))
    expect(api.get).toHaveBeenCalledOnce()
    expect(api.clear.mock.calls[0]![0].body).toMatchObject({
      base_version: 7,
      expected_task_id: 'task-new',
      confirmed: true,
    })
    expect(store.get(difyBuilderLifecycleControlAtom)?.operation).toBe(
      status === 409 ? 'fix' : 'clear',
    )
    expect(store.get(difyBuilderLifecycleControlAtom)?.phase).toBe('unknown')
    expect(api.fix).not.toHaveBeenCalled()
  },
)
