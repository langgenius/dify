import type { TextGenerationTranslate } from '../../../types'
import type { ResultInputValue } from '../../result-request'
import type { PromptConfig } from '@/models/debug'
// oxlint-disable-next-line no-restricted-imports -- This fixture uses the existing SSE transport callback contract without issuing HTTP requests.
import type { IOtherOptions } from '@/service/base'
import type { VisionSettings } from '@/types/app'
import { act, renderHook, waitFor } from '@testing-library/react'
import { AppSourceType } from '@/service/share'
import { withSelectorKey } from '@/test/i18n-mock'
import { Resolution, TransferMethod } from '@/types/app'
import { useResultRunState } from '../use-result-run-state'
import { useResultSender } from '../use-result-sender'

type CompletionHandlers = {
  onData: NonNullable<IOtherOptions['onData']>
  onCompleted: () => void
  onError: () => void
  onMessageReplace: (message: { answer: string }) => void
}

const mocks = vi.hoisted(() => ({
  completion: vi.fn(),
  workflow: vi.fn(),
  sleep: vi.fn(),
  track: vi.fn(),
}))
vi.mock('@/service/share', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/share')>()),
  sendCompletionMessage: mocks.completion,
  sendWorkflowMessage: mocks.workflow,
}))
vi.mock('@/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils')>()),
  sleep: mocks.sleep,
}))
vi.mock('@/app/components/base/amplitude/web-app-event', () => ({ trackWebAppEvent: mocks.track }))
vi.mock('@/context/web-app-context', () => ({
  useWebAppStore: (selector: (state: { appInfo: { mode: string } }) => unknown) =>
    selector({ appInfo: { mode: 'completion' } }),
}))

const promptConfig: PromptConfig = {
  prompt_template: 'template',
  prompt_variables: [{ key: 'name', name: 'Name', type: 'string', required: true }],
}

const visionConfig: VisionSettings = {
  enabled: false,
  number_limits: 2,
  detail: Resolution.low,
  transfer_methods: [TransferMethod.local_file],
}

function renderSender(
  options: {
    inputs?: Record<string, ResultInputValue>
    isWorkflow?: boolean
    appSourceType?: AppSourceType
  } = {},
) {
  const notify = vi.fn()
  const onCompleted = vi.fn()
  const onRunStart = vi.fn()
  const onShowRes = vi.fn()
  const t = withSelectorKey((key: string) => key) as TextGenerationTranslate
  const appSourceType = options.appSourceType ?? AppSourceType.webApp
  const isWorkflow = options.isWorkflow ?? false
  const hook = renderHook(
    ({ controlSend, controlRetry }) => {
      const state = useResultRunState({ appId: 'app-1', appSourceType, isWorkflow, notify })
      const sender = useResultSender({
        appId: 'app-1',
        appSourceType,
        isWorkflow,
        notify,
        onCompleted,
        onRunStart,
        onShowRes,
        controlSend,
        controlRetry,
        taskId: 7,
        isCallBatchAPI: false,
        isPC: false,
        completionFiles: [],
        inputs: options.inputs ?? { name: 'Alice' },
        promptConfig,
        visionConfig,
        runState: state,
        t,
      })
      return { ...sender, state }
    },
    { initialProps: { controlSend: 0, controlRetry: 0 } },
  )
  return { ...hook, notify, onCompleted, onRunStart, onShowRes }
}

beforeEach(() => {
  mocks.completion.mockResolvedValue(undefined)
  mocks.workflow.mockResolvedValue(undefined)
  mocks.sleep.mockImplementation(() => new Promise<void>(() => {}))
})

describe('result sending', () => {
  it('rejects missing required inputs before sending or tracking a run', async () => {
    const { result, notify } = renderSender({ inputs: {} })
    await act(async () => {
      expect(await result.current.handleSend()).toBe(false)
    })
    expect(notify).toHaveBeenCalledWith({
      type: 'error',
      message: 'errorMessage.valueOfVarRequired',
    })
    expect(mocks.completion).not.toHaveBeenCalled()
    expect(mocks.track).not.toHaveBeenCalled()
  })

  it('sends current input once, blocks duplicate runs and applies stream replacement', async () => {
    const { result, rerender, notify, onCompleted, onRunStart, onShowRes } = renderSender()
    rerender({ controlSend: 1, controlRetry: 0 })
    expect(mocks.completion).toHaveBeenCalledExactlyOnceWith(
      { inputs: { name: 'Alice' } },
      expect.any(Object),
      AppSourceType.webApp,
      'app-1',
    )
    expect(result.current.state.isResponding).toBe(true)
    expect(onRunStart).toHaveBeenCalledOnce()
    expect(onShowRes).toHaveBeenCalledOnce()
    expect(mocks.track).toHaveBeenCalledWith('webapp_run', { app_mode: 'completion' })
    await act(async () => {
      expect(await result.current.handleSend()).toBe(false)
    })
    expect(mocks.completion).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith({ type: 'info', message: 'errorMessage.waitForResponse' })

    const callbacks = mocks.completion.mock.calls[0]![1] as CompletionHandlers
    act(() => {
      callbacks.onData!('Hello', false, { messageId: 'message-1', taskId: 'task-1' })
      callbacks.onData!(' world', false, { messageId: 'message-1', taskId: 'task-1' })
    })
    expect(result.current.state.completionRes).toBe('Hello world')
    expect(result.current.state.currentTaskId).toBe('task-1')
    act(() => {
      callbacks.onMessageReplace!({ answer: 'Replaced' })
    })
    act(() => {
      callbacks.onCompleted!()
    })
    expect(result.current.state.completionRes).toBe('Replaced')
    expect(result.current.state.messageId).toBe('message-1')
    expect(result.current.state.currentTaskId).toBeNull()
    expect(result.current.state.isResponding).toBe(false)
    expect(onCompleted).toHaveBeenCalledExactlyOnceWith('Replaced', 7, true)
  })

  it.each([new Error('workflow failed'), 'workflow failed'])(
    'reports workflow request failures and permits retry (%s)',
    async (failure) => {
      mocks.workflow.mockRejectedValueOnce(failure)
      const { result, rerender, notify } = renderSender({
        isWorkflow: true,
        appSourceType: AppSourceType.installedApp,
      })
      rerender({ controlSend: 0, controlRetry: 1 })
      await waitFor(() =>
        expect(notify).toHaveBeenCalledWith({ type: 'error', message: 'workflow failed' }),
      )
      expect(result.current.state.isResponding).toBe(false)
      expect(mocks.workflow).toHaveBeenCalledWith(
        { inputs: { name: 'Alice' } },
        expect.any(Object),
        AppSourceType.installedApp,
        'app-1',
      )
      expect(mocks.track).not.toHaveBeenCalled()
      rerender({ controlSend: 0, controlRetry: 2 })
      expect(mocks.workflow).toHaveBeenCalledTimes(2)
      expect(result.current.state.isResponding).toBe(true)
    },
  )

  it.each(['onCompleted', 'onError'] as const)(
    'completes a timed-out request only once even when %s arrives late',
    async (callback) => {
      let timeout!: () => void
      mocks.sleep.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            timeout = resolve
          }),
      )
      const { result, notify, onCompleted } = renderSender()
      await act(async () => {
        await result.current.handleSend()
      })
      await act(async () => {
        timeout()
      })
      expect(result.current.state.isResponding).toBe(false)
      expect(onCompleted).toHaveBeenCalledExactlyOnceWith('', 7, false)
      const callbacks = mocks.completion.mock.calls[0]![1] as CompletionHandlers
      act(() => {
        callbacks[callback]!()
      })
      expect(notify).toHaveBeenCalledWith({
        type: 'warning',
        message: 'warningMessage.timeoutExceeded',
      })
      expect(onCompleted).toHaveBeenCalledTimes(1)
    },
  )

  it.each(['onCompleted', 'onError'] as const)(
    'does not time out a stream that ended through %s',
    async (callback) => {
      let timeout!: () => void
      mocks.sleep.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            timeout = resolve
          }),
      )
      const { result, onCompleted } = renderSender()
      await act(async () => {
        await result.current.handleSend()
      })
      const callbacks = mocks.completion.mock.calls[0]![1] as CompletionHandlers
      act(() => {
        callbacks.onData!('Partial answer', false, { messageId: 'message-1', taskId: '   ' })
      })
      expect(result.current.state.currentTaskId).toBeNull()
      act(() => {
        callbacks[callback]!()
      })
      await act(async () => {
        timeout()
      })
      expect(onCompleted).toHaveBeenCalledExactlyOnceWith(
        'Partial answer',
        7,
        callback === 'onCompleted',
      )
      expect(result.current.state.isResponding).toBe(false)
    },
  )
})
