import type { TextGenerationTranslate } from '../../../types'
import type { PromptConfig } from '@/models/debug'
import type { VisionSettings } from '@/types/app'
import { act, renderHook, waitFor } from '@testing-library/react'
import { toast } from '@/app/notifications'
import { captureAppAccessScope } from '@/features/app-access-error/state'
import { AppSourceType } from '@/service/share'
import { withSelectorKey } from '@/test/i18n-mock'
import { Resolution, TransferMethod } from '@/types/app'
import { useTextGenerationBatch } from '../../../hooks/use-text-generation-batch'
import { TaskStatus } from '../../../types'
import { useResultRunState } from '../use-result-run-state'
import { useResultSender } from '../use-result-sender'

// Exercise the actual sender, batch state, request service and SSE parser together.
const sleep = vi.hoisted(() => vi.fn())
vi.mock('@/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils')>()),
  sleep,
}))
vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))

const promptConfig: PromptConfig = {
  prompt_template: '',
  prompt_variables: [{ key: 'name', name: 'Name', type: 'string', required: true }],
}
const visionConfig: VisionSettings = {
  enabled: false,
  number_limits: 2,
  detail: Resolution.low,
  transfer_methods: [TransferMethod.local_file],
}
const t = withSelectorKey((key: string) => key) as TextGenerationTranslate
let expireTimeouts: (() => void)[]

const message = (answer: string) => ({
  event: 'message',
  answer,
  id: 'message-1',
  task_id: 'task-1',
})
const encodeEvent = (event: unknown) =>
  new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)
const streamResponse = (...events: unknown[]) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) controller.enqueue(encodeEvent(event))
        controller.close()
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  )
const invocationError = {
  event: 'error',
  status: 400,
  code: 'completion_request_error',
  message: 'Completion provider failed',
}

function renderBatch(names = ['Alice']) {
  const notify = vi.fn()
  const completed = vi.fn<(answer: string, id?: number, success?: boolean) => void>()
  const batch = renderHook(() => useTextGenerationBatch({ promptConfig, notify, t }))
  act(() => {
    batch.result.current.handleRunBatch([['Name'], ...names.map((name) => [name])], {
      onStart: () => {},
    })
  })

  const renderSender = (taskId = 1) => {
    const task = batch.result.current.allTaskList.find(({ id }) => id === taskId)
    if (!task) throw new Error(`Missing test task ${taskId}`)
    return renderHook(
      ({ controlRetry }) => {
        const state = useResultRunState({
          appId: 'app-1',
          appSourceType: AppSourceType.webApp,
          isWorkflow: false,
          notify,
        })
        const sender = useResultSender({
          appId: 'app-1',
          appSourceType: AppSourceType.webApp,
          isWorkflow: false,
          completionFiles: [],
          inputs: task.params.inputs,
          promptConfig,
          isCallBatchAPI: true,
          isPC: true,
          visionConfig,
          runState: state,
          notify,
          onCompleted: (answer, id, success) => {
            completed(answer, id, success)
            batch.result.current.handleCompleted(answer, id, success)
          },
          onRunStart: () => {},
          onShowRes: () => {},
          controlRetry,
          t,
          taskId,
        })
        return { sender, state }
      },
      { initialProps: { controlRetry: 0 } },
    )
  }
  return { batch, renderSender, completed }
}

async function expireTimers() {
  await act(async () => {
    for (const resolve of expireTimeouts.splice(0)) resolve()
  })
}

beforeEach(() => {
  window.history.replaceState({}, '', '/completion/app-1')
  captureAppAccessScope()
  vi.spyOn(globalThis, 'fetch').mockReset()
  expireTimeouts = []
  sleep.mockImplementation(() => new Promise<void>((resolve) => expireTimeouts.push(resolve)))
})

afterEach(() => vi.restoreAllMocks())

describe('completion stream error settlement', () => {
  it.each([
    { partial: '', error: invocationError },
    {
      partial: 'Incomplete answer',
      error: {
        event: 'error',
        status: 429,
        code: 'rate_limit_error',
        message: 'Completion provider rate limit exceeded',
      },
    },
  ])(
    'settles an SSE $error.code once and retains the failed batch task',
    async ({ partial, error }) => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        streamResponse(...(partial ? [message(partial), error] : [error])),
      )
      const run = renderBatch()
      const sender = run.renderSender()
      await act(async () => {
        await sender.result.current.sender.handleSend()
      })
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(error.message))

      expect(run.completed.mock.calls).toEqual([[partial, 1, false]])
      expect(run.batch.result.current.allFailedTaskList.map(({ id }) => id)).toEqual([1])
      expect(run.batch.result.current.allSuccessTaskList).toHaveLength(0)
      await expireTimers()
      expect(run.completed).toHaveBeenCalledOnce()
    },
  )

  it('keeps partial output failed when reading the response body rejects', async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          stream = controller
          controller.enqueue(encodeEvent(message('Partial answer')))
        },
      }),
      { headers: { 'Content-Type': 'text/event-stream' } },
    )
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response)
    const run = renderBatch()
    const sender = run.renderSender()
    await act(async () => {
      await sender.result.current.sender.handleSend()
    })
    await waitFor(() => expect(sender.result.current.state.completionRes).toBe('Partial answer'))
    await act(async () => {
      stream.error(new Error('Connection lost'))
    })
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Error: Connection lost'))

    expect(run.completed.mock.calls).toEqual([['Partial answer', 1, false]])
    expect(run.batch.result.current.allTaskList[0]?.status).toBe(TaskStatus.failed)
    await expireTimers()
    expect(run.completed).toHaveBeenCalledOnce()
  })

  it('retries both HTTP and SSE failures in a mixed batch', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ message: 'HTTP row failed' }, { status: 500 }))
      .mockResolvedValueOnce(streamResponse(message('Partial second row'), invocationError))
      .mockResolvedValueOnce(streamResponse(message('First retry succeeded')))
      .mockResolvedValueOnce(streamResponse(message('Second retry succeeded')))
    const run = renderBatch(['HTTP row', 'SSE row'])
    const senders = [run.renderSender(1), run.renderSender(2)]
    await act(async () => {
      for (const sender of senders) await sender.result.current.sender.handleSend()
    })
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('HTTP row failed'))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(invocationError.message))
    expect(run.batch.result.current.allFailedTaskList.map(({ id }) => id)).toEqual([1, 2])
    expect(run.batch.result.current.allSuccessTaskList).toHaveLength(0)

    act(() => run.batch.result.current.handleRetryAllFailedTask())
    // The result panel forwards this public retry signal to failed task senders.
    for (const sender of senders)
      sender.rerender({ controlRetry: run.batch.result.current.controlRetry })
    await waitFor(() => expect(run.batch.result.current.allSuccessTaskList).toHaveLength(2))
    expect(globalThis.fetch).toHaveBeenCalledTimes(4)
    expect(run.completed).toHaveBeenCalledTimes(4)
    expect(run.completed).toHaveBeenCalledWith('First retry succeeded', 1, true)
    expect(run.completed).toHaveBeenCalledWith('Second retry succeeded', 2, true)
    expect(run.batch.result.current.allFailedTaskList).toHaveLength(0)
    await expireTimers()
    expect(run.completed).toHaveBeenCalledTimes(4)
  })

  it.each([
    { name: 'normal success', succeeds: true, answer: 'Complete answer' },
    { name: 'HTTP failure', succeeds: false, answer: '' },
  ])('preserves single settlement for $name', async ({ succeeds, answer }) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      succeeds
        ? streamResponse(message(answer), { event: 'message_end', id: 'message-1', metadata: {} })
        : Response.json({ message: 'HTTP request failed' }, { status: 500 }),
    )
    const run = renderBatch()
    const sender = run.renderSender()
    await act(async () => {
      await sender.result.current.sender.handleSend()
    })
    await waitFor(() => expect(run.completed).toHaveBeenCalledExactlyOnceWith(answer, 1, succeeds))
    expect(run.batch.result.current.allTaskList[0]?.status).toBe(
      succeeds ? TaskStatus.completed : TaskStatus.failed,
    )
    await expireTimers()
    expect(run.completed).toHaveBeenCalledOnce()
  })
})
