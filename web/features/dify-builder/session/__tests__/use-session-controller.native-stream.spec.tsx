import type { NativeCanvasPath } from '@dify/contracts/api/console/dify-builder/types.gen'
import type { ConversationItem } from '../../types'
import { act, waitFor } from '@testing-library/react'
import { createDeferred } from '@/test/deferred'
import {
  difyBuilderActiveSessionIdAtom,
  difyBuilderConversationAtom,
  difyBuilderSessionBusyAtom,
  difyBuilderSessionViewAtom,
} from '../state'
import {
  commandStartedEvent,
  conversationItemEvent,
  conversationPage,
  createControlledEventStream,
  createNativeReceipt,
  createSessionView,
  renderSessionHook,
  stateEvent,
} from './fixtures'

const api = vi.hoisted(() => ({
  create: vi.fn(),
  get: vi.fn(),
  stream: vi.fn(),
  conversation: vi.fn(),
  action: vi.fn(),
  message: vi.fn(),
}))
vi.mock('@/service/console', () => ({
  consoleClient: {
    difyBuilder: {
      sessions: {
        post: api.create,
        bySessionId: {
          get: api.get,
          stream: { get: api.stream },
          conversation: { get: api.conversation },
          actions: { post: api.action },
          messages: { post: api.message },
        },
      },
    },
  },
}))

const idleTimeout = 2 * 60_000

const published = createSessionView({
  phase: 'complete',
  run_status: 'complete',
  canvas_read_only: false,
  command_pending: false,
})

const pending = {
  request_id: 'request-1',
  pending_operation_id: 'operation-1',
  pending_version: 2,
  scope_digest: 'a'.repeat(64),
}

const waiting = createSessionView({
  version: 4,
  run_status: 'waiting_confirmation',
  canvas_read_only: false,
  command_pending: false,
  last_command_id: 'prepare-test',
  test_execution: createNativeReceipt({ status: 'waiting', wait_reason: 'approval' }),
  actions: [{ id: 'confirm_test_operation', label: 'Approve', kind: 'primary', payload: pending }],
})

const runResult: ConversationItem = {
  seq: 1,
  at_version: 6,
  kind: 'test_result',
  payload: { status: 'succeeded', dify_run_id: 'run-1' },
}

beforeEach(() => {
  vi.resetAllMocks()
  api.conversation.mockResolvedValue(conversationPage())
})

it.each(['message', 'action'] as const)(
  'reopens an idle published session before submitting the next %s',
  async (operation) => {
    vi.useFakeTimers()
    const first = createControlledEventStream()
    const second = createControlledEventStream()
    const model = { provider: 'provider-1', name: 'model-1' }
    const submit = operation === 'message' ? api.message : api.action
    api.stream.mockResolvedValueOnce(first.iterable).mockResolvedValueOnce(second.iterable)
    submit.mockResolvedValue({
      command_id: 'next-command',
      pending: false,
      session: { ...published, version: 2, last_command_id: 'next-command' },
    })
    const { result, unmount } = renderSessionHook(undefined, undefined, { scripted: false })
    try {
      await act(async () => {
        first.push({ event: 'session_ready', data: published })
        expect(await result.current.restore('session-1')).toBe(true)
      })
      const firstSignal: AbortSignal = api.stream.mock.calls[0]?.[1].signal
      await act(async () => {
        await vi.advanceTimersByTimeAsync(idleTimeout)
      })
      expect(firstSignal.aborted).toBe(true)
      await act(async () => {
        first.close()
        await vi.advanceTimersByTimeAsync(idleTimeout)
      })
      expect(api.stream).toHaveBeenCalledTimes(1)

      let command!: Promise<boolean>
      await act(async () => {
        command =
          operation === 'message'
            ? result.current.sendMessage('Add a step')
            : result.current.updateModel(model)
      })
      expect(api.stream).toHaveBeenCalledTimes(2)
      expect(api.stream).toHaveBeenLastCalledWith(
        { params: { session_id: 'session-1' } },
        expect.anything(),
      )
      expect(submit).not.toHaveBeenCalled()

      await act(async () => {
        second.push({ event: 'session_ready', data: published })
        expect(await command).toBe(true)
      })
      expect(submit).toHaveBeenCalledExactlyOnceWith(
        {
          params: { session_id: 'session-1' },
          body: expect.objectContaining(
            operation === 'message' ? { text: 'Add a step' } : { action_id: 'update_model' },
          ),
        },
        expect.anything(),
      )
      expect(api.create).not.toHaveBeenCalled()
    } finally {
      unmount()
      first.close()
      second.close()
      vi.useRealTimers()
    }
  },
)

it('lets a message retry reopen an idle session after reconnect attempts fail', async () => {
  vi.useFakeTimers()
  const first = createControlledEventStream()
  const recovered = createControlledEventStream()
  api.stream
    .mockResolvedValueOnce(first.iterable)
    .mockRejectedValueOnce({ status: 503 })
    .mockRejectedValueOnce({ status: 503 })
    .mockRejectedValueOnce({ status: 503 })
    .mockResolvedValueOnce(recovered.iterable)
  api.message.mockResolvedValue({
    command_id: 'next-command',
    pending: false,
    session: { ...published, version: 2, last_command_id: 'next-command' },
  })
  const { result, unmount } = renderSessionHook(undefined, undefined, { scripted: false })
  try {
    await act(async () => {
      first.push({ event: 'session_ready', data: published })
      expect(await result.current.restore('session-1')).toBe(true)
      await vi.advanceTimersByTimeAsync(idleTimeout)
      first.close()
    })
    await act(async () => {
      const send = result.current.sendMessage('Add a step')
      await vi.advanceTimersByTimeAsync(2000)
      expect(await send).toBe(false)
    })
    expect(api.message).not.toHaveBeenCalled()

    let retry!: Promise<boolean>
    await act(async () => {
      retry = result.current.sendMessage('Add a step')
    })
    expect(api.stream).toHaveBeenCalledTimes(5)
    expect(api.message).not.toHaveBeenCalled()
    await act(async () => {
      recovered.push({ event: 'session_ready', data: published })
      expect(await retry).toBe(true)
    })
    expect(api.message).toHaveBeenCalledTimes(1)
  } finally {
    unmount()
    first.close()
    recovered.close()
    vi.useRealTimers()
  }
})

it('waits for command admission and native test settlement before disconnecting for idleness', async () => {
  vi.useFakeTimers()
  const stream = createControlledEventStream()
  const ready = createSessionView({
    phase: 'test',
    run_status: 'waiting_input',
    canvas_read_only: false,
    command_pending: false,
    last_command_id: 'prepare-test',
  })
  const admission = createDeferred<{ command_id: string; pending: boolean }>()
  api.stream.mockResolvedValue(stream.iterable)
  api.action.mockReturnValue(admission.promise)
  const { result, unmount } = renderSessionHook(undefined, undefined, { scripted: false })
  try {
    await act(async () => {
      stream.push({ event: 'session_ready', data: ready })
      expect(await result.current.restore('session-1')).toBe(true)
    })
    const signal: AbortSignal = api.stream.mock.calls[0]?.[1].signal
    await act(async () => {
      await vi.advanceTimersByTimeAsync(idleTimeout - 1000)
    })
    let command!: Promise<boolean>
    await act(async () => {
      command = result.current.runAction('run_test')
    })
    expect(api.action).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(idleTimeout)
    })
    expect(signal.aborted).toBe(false)

    await act(async () => {
      stream.push(commandStartedEvent(ready))
      stream.push(stateEvent({ ...waiting, last_command_id: 'command-1' }))
      admission.resolve({ command_id: 'command-1', pending: true })
      expect(await command).toBe(true)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(idleTimeout)
    })
    expect(signal.aborted).toBe(false)

    await act(async () => {
      stream.push({
        event: 'session_state',
        data: {
          ...waiting,
          version: 5,
          phase: 'review',
          run_status: 'waiting_input',
          test_execution: createNativeReceipt({
            version: 2,
            status: 'terminal',
            outcome: 'succeeded',
          }),
        },
      })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(idleTimeout - 1)
    })
    expect(signal.aborted).toBe(false)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(signal.aborted).toBe(true)
  } finally {
    unmount()
    stream.close()
    vi.useRealTimers()
  }
})

it('restores the same pending Native Test after disabling and enabling Builder', async () => {
  const before = createControlledEventStream()
  const after = createControlledEventStream()
  api.stream.mockResolvedValueOnce(before.iterable).mockResolvedValueOnce(after.iterable)
  api.get.mockResolvedValue(waiting)
  const { result, store, rerender } = renderSessionHook(undefined, undefined, { scripted: false })

  await act(async () => {
    before.push({ event: 'session_ready', data: waiting })
    expect(await result.current.restore('session-1')).toBe(true)
  })
  expect(store.get(difyBuilderSessionViewAtom)?.test_execution?.request_id).toBe('request-1')
  expect(api.stream).toHaveBeenCalledTimes(1)
  const firstSignal = api.stream.mock.calls[0]?.[1].signal
  expect(firstSignal.aborted).toBe(false)

  rerender({ enabled: false })
  expect(firstSignal.aborted).toBe(true)
  rerender({ enabled: true })
  await act(async () => {
    after.push({ event: 'session_ready', data: waiting })
    expect(await result.current.restore('session-1')).toBe(true)
  })
  expect(api.action).not.toHaveBeenCalled()
  expect(store.get(difyBuilderSessionViewAtom)?.actions).toEqual(waiting.actions)

  const running = {
    ...waiting,
    version: 5,
    run_status: 'processing' as const,
    last_command_id: 'approve-test',
    test_execution: createNativeReceipt({ version: 2 }),
  }
  api.action.mockResolvedValue({ command_id: 'approve-test', pending: false, session: running })
  await act(async () => {
    expect(await result.current.runAction('confirm_test_operation')).toBe(true)
  })
  expect(api.action).toHaveBeenCalledExactlyOnceWith(
    {
      params: { session_id: 'session-1' },
      body: expect.objectContaining({ action_id: 'confirm_test_operation', payload: pending }),
    },
    expect.anything(),
  )

  api.conversation.mockResolvedValue(
    conversationPage([
      { seq: 0, at_version: 5, kind: 'notice', payload: { text: 'Approved' } },
      runResult,
    ]),
  )
  await act(async () => {
    after.push({
      event: 'session_state',
      data: {
        ...running,
        version: 6,
        run_status: 'complete',
        conversation_last_seq: 1,
        test_execution: createNativeReceipt({
          version: 3,
          status: 'terminal',
          outcome: 'succeeded',
        }),
      },
    })
    after.push(conversationItemEvent(runResult))
  })
  expect(store.get(difyBuilderSessionViewAtom)?.test_execution).toMatchObject({
    request_id: 'request-1',
    native_run_id: 'run-1',
    status: 'terminal',
  })
  expect(
    store.get(difyBuilderConversationAtom).filter((item) => item.kind === 'test_result'),
  ).toEqual([runResult])
  expect(api.stream).toHaveBeenCalledTimes(2)
  expect(api.action).toHaveBeenCalledTimes(1)
  expect(api.create).not.toHaveBeenCalled()
})

it('waits for the opening history to be applied before sending the first command', async () => {
  const stream = createControlledEventStream()
  const session = createSessionView({
    command_pending: false,
    last_command_id: '',
    conversation_last_seq: 0,
  })
  const history = createDeferred<ReturnType<typeof conversationPage>>()
  api.create.mockResolvedValue({ session, requires_start: true })
  api.stream.mockResolvedValue(stream.iterable)
  api.conversation.mockReturnValue(history.promise)
  api.action.mockResolvedValue({ command_id: 'command-1', pending: true })
  const { result } = renderSessionHook(undefined, undefined, { scripted: false })

  let command!: Promise<boolean>
  act(() => {
    command = result.current.startBuild('app-1', 'Build a workflow')
  })
  await waitFor(() => expect(api.stream).toHaveBeenCalledTimes(1))
  expect(api.action).not.toHaveBeenCalled()
  act(() => {
    stream.push({ event: 'session_ready', data: session })
  })
  await waitFor(() => expect(api.conversation).toHaveBeenCalledTimes(1))
  expect(api.action).not.toHaveBeenCalled()

  await act(async () => {
    history.resolve(
      conversationPage([
        {
          seq: 0,
          at_version: 1,
          kind: 'user',
          payload: { text: 'Build a workflow', turn_id: 'opening-turn' },
        },
      ]),
    )
  })
  await waitFor(() => expect(api.action).toHaveBeenCalledTimes(1))
  expect(api.action.mock.calls[0]?.[0].body).toMatchObject({
    action_id: 'start_session',
    base_version: session.version,
  })
  await act(async () => {
    stream.push(commandStartedEvent(session))
    stream.push(stateEvent({ ...session, version: 2, last_command_id: 'command-1' }))
    expect(await command).toBe(true)
  })
  expect(api.stream).toHaveBeenCalledTimes(1)
})

it('correlates a command that completes on the stream before its POST returns', async () => {
  const stream = createControlledEventStream()
  const session = { ...waiting, test_execution: undefined }
  const admission = createDeferred<{ command_id: string; pending: boolean }>()
  api.stream.mockResolvedValue(stream.iterable)
  api.action.mockReturnValue(admission.promise)
  const { result, store } = renderSessionHook(undefined, undefined, { scripted: false })

  await act(async () => {
    stream.push({ event: 'session_ready', data: session })
    expect(await result.current.restore('session-1')).toBe(true)
  })
  let command!: Promise<boolean>
  act(() => {
    command = result.current.runAction('run_test')
  })
  await waitFor(() => expect(api.action).toHaveBeenCalledTimes(1))
  const path = {
    native_run_id: 'run-1',
    revision: 2,
    edges: [
      {
        edge_id: 'start-agent',
        source: 'start',
        target: 'agent',
        source_handle: 'source',
        target_handle: 'target',
        source_status: 'succeeded',
        target_status: 'paused',
      },
    ],
  } satisfies NativeCanvasPath
  const native = createNativeReceipt({
    status: 'waiting',
    wait_reason: 'approval',
    canvas_path: path,
  })
  await act(async () => {
    stream.push(commandStartedEvent(session))
    stream.push(
      stateEvent({ ...waiting, version: 5, last_command_id: 'command-1', test_execution: native }),
    )
    stream.push({
      event: 'session_state',
      data: {
        ...waiting,
        version: 5,
        last_command_id: 'command-1',
        test_execution: { ...native, version: 2 },
      },
    })
    stream.push(
      stateEvent({
        ...waiting,
        version: 5,
        last_command_id: 'command-1',
        test_execution: { ...native, version: 2, canvas_path: { ...path, revision: 1, edges: [] } },
      }),
    )
  })
  expect(store.get(difyBuilderSessionBusyAtom)).toBe(true)
  expect(store.get(difyBuilderSessionViewAtom)?.test_execution?.version).toBe(2)
  expect(store.get(difyBuilderSessionViewAtom)?.test_execution?.canvas_path).toEqual(path)
  await act(async () => {
    admission.resolve({ command_id: 'command-1', pending: true })
    expect(await command).toBe(true)
  })
  expect(store.get(difyBuilderSessionBusyAtom)).toBe(false)
  expect(api.stream).toHaveBeenCalledTimes(1)
})

it('fills missing result history on reconnect without resubmitting the run', async () => {
  vi.useFakeTimers()
  const first = createControlledEventStream()
  const second = createControlledEventStream()
  const notice: ConversationItem = {
    seq: 0,
    at_version: 4,
    kind: 'notice',
    payload: { text: 'Test started' },
  }
  const tail: ConversationItem = {
    seq: 2,
    at_version: 6,
    kind: 'notice',
    payload: { text: 'Test finished' },
  }
  api.stream.mockResolvedValueOnce(first.iterable).mockResolvedValueOnce(second.iterable)
  api.conversation
    .mockResolvedValueOnce(conversationPage([notice]))
    .mockResolvedValueOnce(conversationPage([runResult]))
  const { result, store } = renderSessionHook(undefined, undefined, { scripted: false })
  try {
    await act(async () => {
      first.push({ event: 'session_ready', data: { ...waiting, conversation_last_seq: 0 } })
      expect(await result.current.restore('session-1')).toBe(true)
    })
    await act(async () => {
      first.push(conversationItemEvent(tail))
      first.close()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
      second.push({
        event: 'session_ready',
        data: {
          ...waiting,
          version: 6,
          run_status: 'complete',
          conversation_last_seq: 2,
          test_execution: createNativeReceipt({
            version: 3,
            status: 'terminal',
            outcome: 'succeeded',
          }),
        },
      })
      second.push(conversationItemEvent(runResult))
    })
    expect(api.stream).toHaveBeenCalledTimes(2)
    expect(api.conversation).toHaveBeenLastCalledWith(
      { params: { session_id: 'session-1' }, query: { after_seq: 0, limit: 100 } },
      expect.anything(),
    )
    expect(store.get(difyBuilderActiveSessionIdAtom)).toBe('session-1')
    expect(store.get(difyBuilderConversationAtom)).toEqual([notice, runResult, tail])
    expect(api.action).not.toHaveBeenCalled()
  } finally {
    vi.useRealTimers()
  }
})

it('settles an acknowledged command from the reconnect snapshot without sending a second command', async () => {
  vi.useFakeTimers()
  const first = createControlledEventStream()
  const second = createControlledEventStream()
  const idle = { ...waiting, run_status: 'waiting_input' as const, test_execution: undefined }
  const resumed = { ...waiting, version: 5, last_command_id: 'run-test-command' }
  api.stream.mockResolvedValueOnce(first.iterable).mockResolvedValueOnce(second.iterable)
  api.action.mockResolvedValue({ command_id: 'run-test-command', pending: true })
  const { result, store } = renderSessionHook(undefined, undefined, { scripted: false })
  try {
    await act(async () => {
      first.push({ event: 'session_ready', data: idle })
      expect(await result.current.restore('session-1')).toBe(true)
    })
    let command!: Promise<boolean>
    await act(async () => {
      command = result.current.runAction('run_test')
    })
    expect(api.action).toHaveBeenCalledTimes(1)
    await act(async () => {
      first.close()
      await vi.advanceTimersByTimeAsync(1000)
      second.push({ event: 'session_ready', data: resumed })
      expect(await command).toBe(true)
    })
    expect(store.get(difyBuilderSessionViewAtom)?.test_execution?.request_id).toBe('request-1')
    expect(store.get(difyBuilderSessionBusyAtom)).toBe(false)
    expect(api.stream).toHaveBeenCalledTimes(2)
    expect(api.action).toHaveBeenCalledTimes(1)
  } finally {
    vi.useRealTimers()
  }
})
