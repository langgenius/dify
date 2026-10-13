// oxlint-disable-next-line no-restricted-imports -- Workflow continuation is an existing SSE transport, not a generated JSON API.
import { sseGet } from '@/service/base'

export type WorkflowEventsHandlers = Parameters<typeof sseGet>[2]

export const createWorkflowEventsSubscription = ({ onAbort }: { onAbort?: () => void } = {}) => {
  let workflowRunId: string | null = null
  let handlers: WorkflowEventsHandlers = {}
  let abortController: AbortController | null = null
  let active = false
  let ready = false
  let paused = false
  let terminal = false
  let disposed = false
  let retriedDisconnect = false
  let generation = 0
  let waiters: Array<(ready: boolean) => void> = []

  const resolveWaiters = (isReady: boolean) => {
    const pending = waiters
    waiters = []
    pending.forEach((resolve) => resolve(isReady))
  }

  const dispose = () => {
    if (disposed) return
    disposed = true
    generation += 1
    active = false
    ready = false
    resolveWaiters(false)
    abortController?.abort()
    abortController = null
  }

  const subscribe = () => {
    if (active || terminal || disposed || !workflowRunId) return
    active = true
    ready = false
    const currentGeneration = ++generation
    const isCurrent = () => !disposed && generation === currentGeneration && active
    const guard = <T extends unknown[]>(handler: ((...args: T) => unknown) | undefined) =>
      handler
        ? (...args: T) => {
            if (isCurrent()) handler(...args)
          }
        : undefined

    const onDisconnected = () => {
      if (!isCurrent()) return
      active = false
      ready = false
      if (!terminal && !paused && !retriedDisconnect) {
        retriedDisconnect = true
        subscribe()
      } else {
        resolveWaiters(false)
      }
    }

    const options: WorkflowEventsHandlers = {
      ...handlers,
      onWorkflowStarted: guard(handlers.onWorkflowStarted),
      onIterationStart: guard(handlers.onIterationStart),
      onIterationNext: guard(handlers.onIterationNext),
      onIterationFinish: guard(handlers.onIterationFinish),
      onLoopStart: guard(handlers.onLoopStart),
      onLoopNext: guard(handlers.onLoopNext),
      onLoopFinish: guard(handlers.onLoopFinish),
      onNodeStarted: guard(handlers.onNodeStarted),
      onNodeFinished: guard(handlers.onNodeFinished),
      onTextChunk: guard(handlers.onTextChunk),
      onTextReplace: guard(handlers.onTextReplace),
      onHumanInputRequired: guard(handlers.onHumanInputRequired),
      onHumanInputFormFilled: guard(handlers.onHumanInputFormFilled),
      onHumanInputFormTimeout: guard(handlers.onHumanInputFormTimeout),
      onWorkflowPaused: (event) => {
        if (!isCurrent()) return
        paused = true
        ready = true
        handlers.onWorkflowPaused?.(event)
        resolveWaiters(true)
      },
      onWorkflowFinished: (event) => {
        if (!isCurrent()) return
        terminal = true
        ready = false
        handlers.onWorkflowFinished?.(event)
        resolveWaiters(false)
      },
      getAbortController: (controller) => {
        if (!isCurrent()) {
          controller.abort()
          return
        }
        abortController = controller
        controller.signal.addEventListener(
          'abort',
          () => {
            if (disposed) return
            dispose()
            onAbort?.()
          },
          { once: true },
        )
        handlers.getAbortController?.(controller)
      },
      onCompleted: onDisconnected,
      onError: () => {
        // A failed read before the pause snapshot must block the write and be retryable.
        if (waiters.length) retriedDisconnect = true
        onDisconnected()
      },
    }
    void sseGet(
      `/workflow/${workflowRunId}/events?include_state_snapshot=true&continue_on_pause=true`,
      {},
      options,
    ).catch(options.onError)
  }

  return {
    start: (runId: string, options: WorkflowEventsHandlers) => {
      workflowRunId = runId
      handlers = options
      subscribe()
    },
    prepare: async () => {
      if (disposed || terminal || !workflowRunId) return false
      retriedDisconnect = false
      if (ready) {
        paused = false
        return true
      }
      const isReady = await new Promise<boolean>((resolve) => {
        waiters.push(resolve)
        subscribe()
      })
      if (isReady && active && ready) {
        paused = false
        return true
      }
      return false
    },
    dispose,
  }
}
