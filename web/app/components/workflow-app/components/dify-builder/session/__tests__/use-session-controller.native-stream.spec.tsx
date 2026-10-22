import type { DifyBuilderStreamEventResponse } from '@dify/contracts/api/console/dify-builder/types.gen'
import type { ConversationItem } from '../../types'
import { act, waitFor } from '@testing-library/react'
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
  streamOf,
} from './fixtures'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  stream: vi.fn(),
  conversation: vi.fn(),
  action: vi.fn(),
}))
vi.mock('@/service/console', () => ({
  consoleClient: {
    difyBuilder: {
      sessions: {
        bySessionId: {
          get: mocks.get,
          stream: { get: mocks.stream },
          conversation: { get: mocks.conversation },
          actions: { post: mocks.action },
        },
      },
    },
  },
}))
const nativeFrame = (version: number, terminal = false): DifyBuilderStreamEventResponse => ({
  event: 'native_execution',
  data: {
    session_id: 'session-1',
    cursor: String(version).repeat(64),
    receipt: createNativeReceipt({
      version,
      ...(terminal ? { status: 'terminal', outcome: 'succeeded' } : {}),
    }),
  },
})
const initial = () =>
  createSessionView({
    run_status: 'waiting_confirmation',
    canvas_read_only: false,
    test_execution: createNativeReceipt(),
    actions: [
      {
        id: 'cancel_test',
        label: 'Cancel',
        kind: 'secondary',
        payload: { request_id: 'request-1' },
      },
    ],
  })
beforeEach(() => {
  vi.resetAllMocks()
  mocks.conversation.mockResolvedValue(conversationPage())
  mocks.get.mockResolvedValue(initial())
})

it.each(['omitted', 'stale'])(
  'keeps native observation across %s command completion and permits actions while observing',
  async (metadata) => {
    const stream = createControlledEventStream()
    mocks.stream.mockResolvedValue(stream.iterable)
    const plainCommandView = {
      ...initial(),
      version: 2,
      test_execution: metadata === 'omitted' ? undefined : createNativeReceipt(),
    }
    const commandStream = createControlledEventStream()
    mocks.action.mockResolvedValue(commandStream.iterable)
    const { result, store } = renderSessionHook()
    act(() => {
      store.set(difyBuilderActiveSessionIdAtom, 'session-1')
      store.set(difyBuilderSessionViewAtom, initial())
    })
    await waitFor(() => expect(mocks.stream).toHaveBeenCalledOnce())
    expect(mocks.stream.mock.calls[0]?.[0].query).toEqual({
      native_tests: 'builder-native-test-v1',
    })
    expect(store.get(difyBuilderSessionBusyAtom)).toBe(false)
    let command!: Promise<boolean>
    act(() => {
      stream.push(stateEvent(initial()))
      command = result.current.runAction('confirm', { option_id: 'cancel_test' })
    })
    await waitFor(() => expect(mocks.action).toHaveBeenCalledOnce())
    act(() => {
      commandStream.push(commandStartedEvent(initial()))
      stream.push(nativeFrame(3))
    })
    await waitFor(() =>
      expect(store.get(difyBuilderSessionViewAtom)?.test_execution?.version).toBe(3),
    )
    expect(store.get(difyBuilderSessionBusyAtom)).toBe(true)
    await act(async () => {
      commandStream.push(stateEvent(plainCommandView))
      expect(await command).toBe(true)
    })
    expect(mocks.stream).toHaveBeenCalledOnce()
    expect(store.get(difyBuilderSessionBusyAtom)).toBe(false)
    expect(store.get(difyBuilderSessionViewAtom)?.test_execution?.version).toBe(3)
    expect(mocks.get).not.toHaveBeenCalled()
  },
)

it.each(['error', 'eof'])(
  'reconnects after %s using the native cursor without replaying a command',
  async (failure) => {
    vi.useFakeTimers()
    const first = createControlledEventStream(),
      second = createControlledEventStream()
    mocks.stream.mockResolvedValueOnce(first.iterable).mockResolvedValueOnce(second.iterable)
    mocks.get.mockResolvedValue({
      ...initial(),
      test_execution: createNativeReceipt({ version: 2 }),
    })
    const { store } = renderSessionHook()
    try {
      await act(async () => {
        store.set(difyBuilderActiveSessionIdAtom, 'session-1')
        store.set(difyBuilderSessionViewAtom, initial())
      })
      expect(mocks.stream).toHaveBeenCalledOnce()
      await act(async () => {
        first.push(nativeFrame(2))
        if (failure === 'error') first.error(new Error('Disconnected'))
        else first.close()
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      expect(mocks.stream).toHaveBeenCalledTimes(2)
      expect(mocks.stream.mock.calls[1]?.[0].headers).toEqual({ 'Last-Event-ID': '2'.repeat(64) })
      expect(mocks.get).toHaveBeenCalledOnce()
      expect(mocks.action).not.toHaveBeenCalled()
      await act(async () => {
        second.push(nativeFrame(3))
      })
      expect(store.get(difyBuilderSessionViewAtom)?.test_execution?.version).toBe(3)
    } finally {
      vi.useRealTimers()
    }
  },
)

it('hydrates terminal history without older in-flight history replacing live command rows', async () => {
  const stream = createControlledEventStream()
  mocks.stream.mockResolvedValue(stream.iterable)
  let resolveHistory!: (page: ReturnType<typeof conversationPage>) => void
  mocks.conversation.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveHistory = resolve
    }),
  )
  const { result, store } = renderSessionHook()
  act(() => {
    store.set(difyBuilderActiveSessionIdAtom, 'session-1')
    store.set(difyBuilderSessionViewAtom, initial())
  })
  await waitFor(() => expect(mocks.stream).toHaveBeenCalledOnce())
  act(() => {
    stream.push(stateEvent({ ...initial(), conversation_last_seq: 0 }))
  })
  await waitFor(() => expect(mocks.conversation).toHaveBeenCalledOnce())
  mocks.conversation.mockResolvedValue(
    conversationPage([
      { seq: 0, at_version: 1, kind: 'notice', payload: { text: 'Initial result' } },
    ]),
  )
  mocks.action.mockResolvedValue(
    streamOf(
      commandStartedEvent(initial()),
      conversationItemEvent({
        seq: 0,
        at_version: 2,
        kind: 'notice',
        payload: { text: 'Updated streamed result' },
      }),
      conversationItemEvent({
        seq: 1,
        at_version: 2,
        kind: 'notice',
        payload: { text: 'New streamed row' },
      }),
      stateEvent({ ...initial(), version: 2, conversation_last_seq: 1 }),
    ),
  )
  await act(async () => {
    await result.current.runAction('confirm', { option_id: 'cancel_test' })
  })
  expect(store.get(difyBuilderConversationAtom).some((item) => item.seq === 1)).toBe(true)
  await act(async () => {
    resolveHistory(
      conversationPage([
        { seq: 0, at_version: 1, kind: 'notice', payload: { text: 'Initial result' } },
      ]),
    )
  })
  expect(store.get(difyBuilderConversationAtom).map((item) => item.seq)).toEqual([0, 1])
  expect(store.get(difyBuilderConversationAtom)[0]?.payload).toMatchObject({
    text: 'Updated streamed result',
  })
  mocks.get.mockResolvedValue({
    ...initial(),
    version: 2,
    conversation_last_seq: 2,
    test_execution: createNativeReceipt({ version: 4, status: 'terminal', outcome: 'succeeded' }),
  })
  mocks.conversation.mockResolvedValue(
    conversationPage([
      { seq: 2, at_version: 2, kind: 'notice', payload: { text: 'Final native result' } },
    ]),
  )
  act(() => {
    stream.push(nativeFrame(4, true))
  })
  await waitFor(() =>
    expect(store.get(difyBuilderConversationAtom).map((item) => item.seq)).toEqual([0, 1, 2]),
  )
  expect(store.get(difyBuilderSessionViewAtom)?.test_execution?.outcome).toBe('succeeded')
})

it('waits for the separately persisted terminal result after the native receipt commits first', async () => {
  const stream = createControlledEventStream()
  mocks.stream.mockResolvedValue(stream.iterable)
  const previousResult: ConversationItem = {
    seq: 0,
    at_version: 1,
    kind: 'test_result',
    payload: { status: 'succeeded', dify_run_id: 'older-native-run' },
  }
  const terminal = {
    ...initial(),
    conversation_last_seq: 0,
    test_execution: createNativeReceipt({ status: 'terminal', outcome: 'succeeded', version: 4 }),
  }
  mocks.get.mockResolvedValue(terminal)
  const { store } = renderSessionHook()
  act(() => {
    store.set(difyBuilderActiveSessionIdAtom, 'session-1')
    store.set(difyBuilderConversationAtom, [previousResult])
    store.set(difyBuilderSessionViewAtom, { ...initial(), conversation_last_seq: 0 })
  })
  await waitFor(() => expect(mocks.stream).toHaveBeenCalledOnce())
  act(() => {
    stream.push(nativeFrame(4, true))
  })
  await waitFor(() => expect(mocks.get).toHaveBeenCalledOnce())
  await waitFor(() =>
    expect(store.get(difyBuilderSessionViewAtom)?.test_execution?.status).toBe('terminal'),
  )
  const finalResult: ConversationItem = {
    seq: 1,
    at_version: 2,
    kind: 'test_result',
    payload: { status: 'succeeded', dify_run_id: 'run-1' },
  }
  mocks.conversation.mockResolvedValue(conversationPage([finalResult]))
  act(() => {
    stream.push(stateEvent({ ...terminal, version: 2, conversation_last_seq: 1 }))
  })
  await waitFor(() =>
    expect(store.get(difyBuilderConversationAtom)).toEqual([previousResult, finalResult]),
  )
  expect(mocks.get).toHaveBeenCalledOnce()
  expect(mocks.action).not.toHaveBeenCalled()
})

it('discards retired-request recovery and native frames after a new request becomes current', async () => {
  const first = createControlledEventStream()
  const second = createControlledEventStream()
  mocks.stream.mockResolvedValueOnce(first.iterable).mockResolvedValueOnce(second.iterable)
  let resolveSnapshot!: (view: ReturnType<typeof createSessionView>) => void
  mocks.get.mockReturnValue(
    new Promise((resolve) => {
      resolveSnapshot = resolve
    }),
  )
  const { store } = renderSessionHook()
  act(() => {
    store.set(difyBuilderActiveSessionIdAtom, 'session-1')
    store.set(difyBuilderSessionViewAtom, initial())
  })
  await waitFor(() => expect(mocks.stream).toHaveBeenCalledOnce())
  act(() => {
    first.push(nativeFrame(4, true))
  })
  await waitFor(() => expect(mocks.get).toHaveBeenCalledOnce())
  const nextView = {
    ...initial(),
    version: 2,
    test_execution: createNativeReceipt({ request_id: 'request-2' }),
  }
  act(() => {
    store.set(difyBuilderSessionViewAtom, nextView)
  })
  await waitFor(() => expect(mocks.stream).toHaveBeenCalledTimes(2))
  await act(async () => {
    resolveSnapshot({
      ...initial(),
      version: 3,
      test_execution: createNativeReceipt({ status: 'terminal', version: 4 }),
    })
    second.push(nativeFrame(5, true))
  })
  expect(store.get(difyBuilderSessionViewAtom)?.test_execution?.request_id).toBe('request-2')
  expect(store.get(difyBuilderSessionViewAtom)?.version).toBe(2)
  expect(mocks.get).toHaveBeenCalledOnce()
})

it('recovers a missing terminal result before a higher live conversation sequence', async () => {
  const stream = createControlledEventStream()
  mocks.stream.mockResolvedValue(stream.iterable)
  const first: ConversationItem = {
    seq: 0,
    at_version: 1,
    kind: 'notice',
    payload: { text: 'Initial request' },
  }
  const resultCard: ConversationItem = {
    seq: 1,
    at_version: 2,
    kind: 'test_result',
    payload: { status: 'succeeded', dify_run_id: 'run-1' },
  }
  const liveTail: ConversationItem = {
    seq: 2,
    at_version: 2,
    kind: 'notice',
    payload: { text: 'Result ready' },
  }
  mocks.get.mockResolvedValue({
    ...initial(),
    version: 2,
    conversation_last_seq: 2,
    test_execution: createNativeReceipt({ version: 4, status: 'terminal', outcome: 'succeeded' }),
  })
  mocks.conversation.mockResolvedValue(conversationPage([resultCard]))
  const { store } = renderSessionHook()
  act(() => {
    store.set(difyBuilderActiveSessionIdAtom, 'session-1')
    store.set(difyBuilderConversationAtom, [first])
    store.set(difyBuilderSessionViewAtom, { ...initial(), conversation_last_seq: 0 })
  })
  await waitFor(() => expect(mocks.stream).toHaveBeenCalledOnce())
  act(() => {
    stream.push(conversationItemEvent(liveTail))
    stream.push(nativeFrame(4, true))
  })
  await waitFor(() =>
    expect(store.get(difyBuilderConversationAtom)).toEqual([first, resultCard, liveTail]),
  )
  expect(mocks.conversation).toHaveBeenCalledWith(
    { params: { session_id: 'session-1' }, query: { after_seq: 0, limit: 100 } },
    expect.anything(),
  )
  expect(mocks.get).toHaveBeenCalledOnce()
  expect(mocks.action).not.toHaveBeenCalled()
})
