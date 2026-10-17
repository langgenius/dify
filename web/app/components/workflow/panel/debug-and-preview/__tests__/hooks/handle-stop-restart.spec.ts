import type { useWorkflowRun } from '@/app/components/workflow/hooks/use-workflow-run'
import { act } from '@testing-library/react'
import { renderWorkflowFlowHook as renderHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { useChat } from '../../hooks'

type Callbacks = NonNullable<Parameters<ReturnType<typeof useWorkflowRun>['handleRun']>[1]>
const mocks = vi.hoisted(() => ({ run: vi.fn(), invalidate: vi.fn(), inspect: vi.fn() }))
vi.mock('../../../../hooks/use-workflow-run', () => ({
  useWorkflowRun: () => ({ handleRun: mocks.run }),
}))
vi.mock('../../../../hooks/use-set-workflow-vars-with-value', () => ({
  useSetWorkflowVarsWithValue: () => ({ fetchInspectVars: mocks.inspect }),
}))
vi.mock('@/service/use-workflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/use-workflow')>()),
  useInvalidateAllLastRun: () => mocks.invalidate,
}))
beforeEach(() => vi.resetAllMocks())

it.each(['handleStop', 'handleRestart'] as const)(
  '%s aborts an active run, stops its server task and resets iteration counters',
  (operation) => {
    const controller = new AbortController()
    const stopChat = vi.fn()
    mocks.run.mockImplementation((_params: unknown, callbacks: Callbacks) => {
      callbacks.getAbortController!(controller)
      callbacks.onData!('answer', true, {
        conversationId: 'conversation',
        messageId: 'message',
        taskId: 'task-active',
      })
    })
    const { result, store } = renderHook(() => useChat({}, undefined, undefined, stopChat), {
      initialStoreState: { iterTimes: 4, loopTimes: 8 },
    })
    act(() => {
      result.current.handleSend({ query: 'test' }, {})
    })
    expect(result.current.isResponding).toBe(true)
    act(() => {
      result.current[operation]()
    })
    expect(controller.signal.aborted).toBe(true)
    expect(stopChat).toHaveBeenCalledExactlyOnceWith('task-active')
    expect(result.current.isResponding).toBe(false)
    expect(store.getState()).toMatchObject({ iterTimes: 1, loopTimes: 1 })
  },
)

it('does not send an empty task id when stopped before any run', () => {
  const stopChat = vi.fn()
  const { result } = renderHook(() => useChat({}, undefined, undefined, stopChat))
  act(() => {
    result.current.handleStop()
  })
  expect(stopChat).not.toHaveBeenCalled()
})

it('cancels suggested questions on stop and removes loaded suggestions on restart', async () => {
  let callbacks: Callbacks
  mocks.run.mockImplementation((_params: unknown, value: Callbacks) => {
    callbacks = value
  })
  const cancel = vi.fn()
  const getSuggested = vi.fn((_id: string, onCancel: (cancel: () => void) => void) => {
    onCancel(cancel)
    return Promise.resolve({ data: ['Follow up'] })
  })
  const { result } = renderHook(() =>
    useChat({ suggested_questions_after_answer: { enabled: true } }),
  )
  act(() => {
    result.current.handleSend({ query: 'test' }, { onGetSuggestedQuestions: getSuggested })
  })
  await act(async () => {
    await callbacks.onCompleted!(false)
  })
  expect(result.current.suggestedQuestions).toEqual(['Follow up'])
  act(() => {
    result.current.handleStop()
  })
  expect(cancel).toHaveBeenCalledOnce()
  act(() => {
    result.current.handleRestart()
  })
  expect(result.current.suggestedQuestions).toEqual([])
  expect(result.current.isResponding).toBe(false)
})
