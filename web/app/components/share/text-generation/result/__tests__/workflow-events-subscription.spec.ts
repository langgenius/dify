import type { WorkflowEventsHandlers } from '../workflow-events-subscription'
import type { WorkflowFinishedResponse, WorkflowPausedResponse } from '@/types/workflow'
import { createWorkflowEventsSubscription } from '../workflow-events-subscription'

const sseGetMock = vi.hoisted(() =>
  vi.fn<(url: string, options: object, handlers: WorkflowEventsHandlers) => Promise<void>>(),
)
vi.mock('@/service/base', () => ({ sseGet: sseGetMock }))

const paused: WorkflowPausedResponse = {
  event: 'workflow_paused',
  task_id: 'task-1',
  workflow_run_id: 'run-1',
  data: { workflow_run_id: 'run-1', outputs: {}, paused_nodes: [], reasons: [] },
}
const finished: WorkflowFinishedResponse = {
  event: 'workflow_finished',
  task_id: 'task-1',
  workflow_run_id: 'run-1',
  data: {
    id: 'run-1',
    workflow_id: 'workflow-1',
    status: 'succeeded',
    outputs: { decision: 'Approved' },
    error: '',
    elapsed_time: 1,
    total_tokens: 0,
    total_steps: 3,
    created_at: 0,
    finished_at: 1,
    created_by: { id: 'user-1', name: 'User', email: 'user@example.com' },
  },
}
const streamOptions = (index: number) => {
  const call = sseGetMock.mock.calls[index]
  if (!call) throw new Error(`Missing workflow stream ${index}`)
  return call[2]
}

describe('Workflow approval continuation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sseGetMock.mockResolvedValue(undefined)
  })

  it('reconnects an idle paused stream and waits for its snapshot before allowing approval', async () => {
    const subscription = createWorkflowEventsSubscription()
    subscription.start('run-1', { isPublicAPI: true })
    streamOptions(0).onWorkflowPaused?.(paused)
    streamOptions(0).onCompleted?.(false)

    let ready = false
    const preparation = subscription.prepare().then((value) => {
      ready = value
      return value
    })
    await Promise.resolve()
    expect(ready).toBe(false)
    expect(sseGetMock).toHaveBeenCalledTimes(2)
    expect(sseGetMock).toHaveBeenLastCalledWith(
      '/workflow/run-1/events?include_state_snapshot=true&continue_on_pause=true',
      {},
      expect.objectContaining({ isPublicAPI: true }),
    )
    streamOptions(1).onWorkflowPaused?.(paused)
    expect(await preparation).toBe(true)
    subscription.dispose()
  })

  it('shows an already finished snapshot and blocks a duplicate approval', async () => {
    const onWorkflowFinished = vi.fn()
    const subscription = createWorkflowEventsSubscription()
    subscription.start('run-1', { onWorkflowFinished })
    const preparation = subscription.prepare()
    streamOptions(0).onWorkflowFinished?.(finished)
    expect(await preparation).toBe(false)
    expect(onWorkflowFinished).toHaveBeenCalledWith(finished)
    subscription.dispose()
  })

  it('recovers one disconnect after approval without starting a retry loop', async () => {
    const subscription = createWorkflowEventsSubscription()
    subscription.start('run-1', {})
    streamOptions(0).onWorkflowPaused?.(paused)
    expect(await subscription.prepare()).toBe(true)
    streamOptions(0).onCompleted?.(false)
    expect(sseGetMock).toHaveBeenCalledTimes(2)
    streamOptions(1).onCompleted?.(false)
    expect(sseGetMock).toHaveBeenCalledTimes(2)
    subscription.dispose()
  })

  it('keeps one connection for simultaneous preparations and allows retry after a failed read', async () => {
    const subscription = createWorkflowEventsSubscription()
    subscription.start('run-1', {})
    const first = subscription.prepare()
    const second = subscription.prepare()
    expect(sseGetMock).toHaveBeenCalledTimes(1)
    streamOptions(0).onError?.('Offline')
    expect(await first).toBe(false)
    expect(await second).toBe(false)
    const retry = subscription.prepare()
    expect(sseGetMock).toHaveBeenCalledTimes(2)
    streamOptions(1).onWorkflowPaused?.(paused)
    expect(await retry).toBe(true)
    subscription.dispose()
  })

  it('aborts the connection on cleanup and ignores late events from the old run', async () => {
    const onWorkflowFinished = vi.fn()
    const onAbort = vi.fn()
    const subscription = createWorkflowEventsSubscription({ onAbort })
    subscription.start('run-1', { onWorkflowFinished })
    const controller = new AbortController()
    streamOptions(0).getAbortController?.(controller)
    const preparation = subscription.prepare()
    subscription.dispose()
    expect(await preparation).toBe(false)
    expect(controller.signal.aborted).toBe(true)
    streamOptions(0).onWorkflowFinished?.(finished)
    expect(onWorkflowFinished).not.toHaveBeenCalled()
    expect(onAbort).not.toHaveBeenCalled()
  })

  it('blocks approval after a pause snapshot whose connection has already closed', async () => {
    const subscription = createWorkflowEventsSubscription()
    subscription.start('run-1', {})
    const preparation = subscription.prepare()
    streamOptions(0).onWorkflowPaused?.(paused)
    streamOptions(0).onCompleted?.(false)
    expect(await preparation).toBe(false)
    subscription.dispose()
  })

  it('notifies the owner once when the user stops an active or idle paused run', async () => {
    const onAbort = vi.fn()
    const subscription = createWorkflowEventsSubscription({ onAbort })
    subscription.start('run-1', {})
    const controller = new AbortController()
    streamOptions(0).getAbortController?.(controller)
    streamOptions(0).onWorkflowPaused?.(paused)
    streamOptions(0).onCompleted?.(false)
    controller.abort()
    expect(onAbort).toHaveBeenCalledOnce()
    expect(await subscription.prepare()).toBe(false)
    subscription.dispose()
    expect(onAbort).toHaveBeenCalledOnce()
  })
})
