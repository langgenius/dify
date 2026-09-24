import type {
  DifyBuilderStreamEventResponse,
  DifyBuilderWorkflowEventData,
} from '@dify/contracts/api/console/dify-builder/types.gen'
import type { SessionRunEvents } from '../types'
import { act, waitFor } from '@testing-library/react'
import { nodeStarted, runStarted, workflowEvent } from '../../__tests__/workflow-fixtures'
import {
  difyBuilderCanvasAppliedViewAtom,
  difyBuilderCanvasRefreshFailedAtom,
  difyBuilderCanvasRefreshingAtom,
} from '../../store'
import { difyBuilderActiveSessionIdAtom, difyBuilderSessionViewAtom } from '../state'
import {
  commandStartedEvent,
  conversationPage,
  createControlledEventStream,
  createSessionView,
  renderSessionHook,
  stateEvent,
  streamOf,
} from './fixtures'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  conversation: vi.fn(),
  action: vi.fn(),
  get: vi.fn(),
}))
const runEvents = {
  onWorkflowEvent: vi.fn(),
  onCanvasEvent: vi.fn(),
  restoreRun: vi.fn(),
  onStreamInterrupted: vi.fn(),
  finishCommand: vi.fn(),
  reset: vi.fn(),
  onCanvasRefreshed: vi.fn(),
} satisfies SessionRunEvents
vi.mock('@/service/console', () => ({
  consoleClient: {
    difyBuilder: {
      sessions: {
        post: mocks.create,
        bySessionId: {
          get: mocks.get,
          conversation: { get: mocks.conversation },
          actions: { post: mocks.action },
        },
      },
    },
  },
}))

const frame = (
  payload: DifyBuilderWorkflowEventData['payload'],
  overrides: Partial<DifyBuilderWorkflowEventData> = {},
): DifyBuilderStreamEventResponse => ({
  event: 'workflow',
  data: workflowEvent(payload, overrides),
})

describe('Builder workflow stream', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.conversation.mockResolvedValue(conversationPage())
  })

  it('dispatches every accepted payload and rejects stale, duplicate and foreign frames', async () => {
    const stream = createControlledEventStream()
    mocks.create.mockResolvedValue(stream.iterable)
    const { result } = renderSessionHook(undefined, runEvents)
    let pending!: Promise<boolean>
    act(() => {
      pending = result.current.startFix('app-1', 'failed-run')
    })
    await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce())
    act(() => {
      stream.push(commandStartedEvent(createSessionView()))
      stream.push(frame(runStarted()))
      stream.push(frame(nodeStarted(), { revision: 2 }))
      stream.push(frame(nodeStarted(), { revision: 1 }))
      stream.push(frame(nodeStarted(), { revision: 2 }))
      stream.push(frame(nodeStarted(), { revision: 3, session_id: 'other-session' }))
      stream.push(frame(nodeStarted(), { at_version: 1, revision: 4 }))
    })
    await waitFor(() => expect(runEvents.onWorkflowEvent).toHaveBeenCalledTimes(2))
    expect(runEvents.onWorkflowEvent.mock.calls.map(([event]) => event.payload)).toEqual([
      runStarted(),
      nodeStarted(),
    ])
    await act(async () => {
      stream.push(stateEvent(createSessionView({ version: 2, run_status: 'waiting_input' })))
      expect(await pending).toBe(true)
    })
    expect(runEvents.finishCommand).toHaveBeenCalledOnce()
  })

  it('does not terminate the Builder command on an inner workflow error', async () => {
    mocks.create.mockResolvedValue(
      streamOf(
        commandStartedEvent(createSessionView()),
        frame({
          event: 'error',
          workflow_run_id: 'dify-run',
          code: 'invalid_param',
          status: 400,
          message: 'bad input',
        }),
        {
          event: 'canvas',
          data: {
            session_id: 'session-1',
            operation_id: 'op',
            at_version: 2,
            event: 'mark_test_error',
            revision: 2,
          },
        },
        stateEvent(
          createSessionView({
            version: 2,
            run_status: 'waiting_input',
          }),
        ),
      ),
    )
    const { result } = renderSessionHook(undefined, runEvents)
    await act(async () => {
      expect(await result.current.startFix('app-1', 'failed-run')).toBe(true)
    })
    expect(runEvents.onWorkflowEvent).toHaveBeenCalledOnce()
    expect(runEvents.onCanvasEvent).toHaveBeenCalledOnce()
    expect(runEvents.finishCommand).toHaveBeenCalledOnce()
  })

  it('finishes an unknown run without synthesizing a workflow error', async () => {
    mocks.create.mockResolvedValue(
      streamOf(
        commandStartedEvent(createSessionView()),
        frame(runStarted()),
        stateEvent(createSessionView({ version: 2, run_status: 'waiting_input' })),
      ),
    )
    const { result } = renderSessionHook(undefined, runEvents)
    await act(async () => {
      await result.current.startFix('app-1', 'failed-run')
    })
    expect(runEvents.onWorkflowEvent).toHaveBeenCalledOnce()
    expect(runEvents.onCanvasEvent).not.toHaveBeenCalled()
    expect(runEvents.finishCommand).toHaveBeenCalledOnce()
  })

  it.each(['eof', 'transport-error'])(
    'marks interrupted live events before reconciling %s',
    async (failure) => {
      mocks.create.mockResolvedValue(
        (async function* () {
          yield commandStartedEvent(createSessionView())
          yield frame(runStarted())
          if (failure === 'transport-error') throw new Error('Connection lost')
        })(),
      )
      mocks.get.mockImplementation(async () => {
        expect(runEvents.onStreamInterrupted).toHaveBeenCalledOnce()
        return createSessionView({ version: 2, run_status: 'waiting_input' })
      })
      const { result } = renderSessionHook(undefined, runEvents)
      await act(async () => {
        await result.current.startFix('app-1', 'failed-run')
      })
      expect(mocks.get).toHaveBeenCalledOnce()
      expect(runEvents.onWorkflowEvent).toHaveBeenCalledOnce()
    },
  )

  it.each([
    ['Build', 'run_test'],
    ['Edit', 'run_affected_tests'],
  ])(
    'retests a %s repair once, only after its matching graph is applied',
    async (_flow, actionId) => {
      const { result, store } = renderSessionHook(undefined, runEvents)
      const before = createSessionView({
        phase: 'test',
        run_status: 'waiting_confirmation',
      })
      const after = createSessionView({
        phase: 'modify',
        version: 2,
        run_status: 'waiting_confirmation',
        app_revision: {
          current: 'repaired-revision',
          conflicted: false,
        },
      })
      store.set(difyBuilderSessionViewAtom, before)
      store.set(difyBuilderActiveSessionIdAtom, before.session_id)
      store.set(difyBuilderCanvasAppliedViewAtom, { sessionId: before.session_id, version: 1 })
      mocks.action.mockResolvedValueOnce(
        streamOf(
          commandStartedEvent(before),
          stateEvent(after, { post_canvas_action_id: actionId }),
        ),
      )
      mocks.action.mockResolvedValueOnce(streamOf(stateEvent({ ...after, version: 4 })))
      await act(async () => {
        expect(await result.current.runAction('confirm', { option_id: 'approve_plan' })).toBe(true)
      })
      expect(mocks.action).toHaveBeenCalledOnce()
      act(() => result.current.onCanvasRefreshed())
      expect(mocks.action).toHaveBeenCalledOnce()
      act(() => {
        store.set(difyBuilderCanvasAppliedViewAtom, { sessionId: after.session_id, version: 2 })
        store.set(difyBuilderCanvasRefreshingAtom, true)
        result.current.onCanvasRefreshed()
      })
      expect(mocks.action).toHaveBeenCalledOnce()
      act(() => {
        store.set(difyBuilderCanvasRefreshingAtom, false)
        store.set(difyBuilderCanvasRefreshFailedAtom, true)
        result.current.onCanvasRefreshed()
      })
      expect(mocks.action).toHaveBeenCalledOnce()
      act(() => {
        store.set(difyBuilderCanvasRefreshFailedAtom, false)
        result.current.onCanvasRefreshed()
        result.current.onCanvasRefreshed()
      })
      await waitFor(() => expect(mocks.action).toHaveBeenCalledTimes(2))
      expect(mocks.action.mock.calls[1]?.[0]).toMatchObject({
        body: {
          action_id: actionId,
          payload: {},
          base_version: 2,
          base_app_revision: 'repaired-revision',
        },
      })
    },
  )

  it.each(['reset', 'new-version', 'different-revision', 'history'] as const)(
    'does not start a pending retest after %s',
    async (scenario) => {
      const { result, store } = renderSessionHook(undefined, runEvents)
      const before = createSessionView({
        phase: 'test',
        run_status: 'waiting_confirmation',
      })
      const after = { ...before, version: 2 }
      store.set(difyBuilderSessionViewAtom, before)
      store.set(difyBuilderActiveSessionIdAtom, before.session_id)
      if (scenario !== 'history') {
        mocks.action.mockResolvedValueOnce(
          streamOf(stateEvent(after, { post_canvas_action_id: 'run_test' })),
        )
        await act(async () => {
          await result.current.runAction('approve_plan')
        })
      }
      act(() => {
        if (scenario === 'reset') result.current.reset()
        store.set(
          difyBuilderSessionViewAtom,
          scenario === 'new-version'
            ? { ...after, version: 3 }
            : scenario === 'different-revision'
              ? {
                  ...after,
                  app_revision: { current: 'other', conflicted: false },
                }
              : after,
        )
        store.set(difyBuilderCanvasAppliedViewAtom, {
          sessionId: after.session_id,
          version: scenario === 'new-version' ? 3 : 2,
        })
        result.current.onCanvasRefreshed()
      })
      expect(mocks.action).toHaveBeenCalledTimes(scenario === 'history' ? 0 : 1)
    },
  )
})
