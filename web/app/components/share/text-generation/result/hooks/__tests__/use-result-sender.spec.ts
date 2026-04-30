import type { ResultInputValue } from '../../result-request'
import type { ResultRunStateController } from '../use-result-run-state'
import type { PromptConfig } from '@/models/debug'
import type { AppSourceType } from '@/service/share'
import type { VisionSettings } from '@/types/app'
import { act, renderHook, waitFor } from '@testing-library/react'
import { AppSourceType as AppSourceTypeEnum } from '@/service/share'
import { Resolution, TransferMethod } from '@/types/app'
import { useResultSender } from '../use-result-sender'

const {
  buildResultRequestDataMock,
  createWorkflowStreamHandlersMock,
  sendCompletionMessageMock,
  sendWorkflowMessageMock,
  sleepMock,
  validateResultRequestMock,
} = vi.hoisted(() => ({
  buildResultRequestDataMock: vi.fn(),
  createWorkflowStreamHandlersMock: vi.fn(),
  sendCompletionMessageMock: vi.fn(),
  sendWorkflowMessageMock: vi.fn(),
  sleepMock: vi.fn(),
  validateResultRequestMock: vi.fn(),
}))

vi.mock('@/service/share', async () => {
  const actual = await vi.importActual<typeof import('@/service/share')>('@/service/share')
  return {
    ...actual,
    sendCompletionMessage: (...args: Parameters<typeof actual.sendCompletionMessage>) => sendCompletionMessageMock(...args),
    sendWorkflowMessage: (...args: Parameters<typeof actual.sendWorkflowMessage>) => sendWorkflowMessageMock(...args),
  }
})

vi.mock('@/utils', async () => {
  const actual = await vi.importActual<typeof import('@/utils')>('@/utils')
  return {
    ...actual,
    sleep: (...args: Parameters<typeof actual.sleep>) => sleepMock(...args),
  }
})

vi.mock('../../result-request', () => ({
  buildResultRequestData: (...args: unknown[]) => buildResultRequestDataMock(...args),
  validateResultRequest: (...args: unknown[]) => validateResultRequestMock(...args),
}))

vi.mock('../../workflow-stream-handlers', () => ({
  createWorkflowStreamHandlers: (...args: unknown[]) => createWorkflowStreamHandlersMock(...args),
}))

type RunStateHarness = {
  state: {
    completionRes: string
    currentTaskId: string | null
    messageId: string | null
    workflowProcessData: ResultRunStateController['workflowProcessData']
  }
  runState: ResultRunStateController
}

type CompletionHandlers = {
  getAbortController: (abortController: AbortController) => void
  onCompleted: () => void
  onData: (chunk: string, isFirstMessage: boolean, info: { messageId: string, taskId?: string }) => void
  onError: () => void
  onMessageReplace: (messageReplace: { answer: string }) => void
}

const createRunStateHarness = (): RunStateHarness => {
  const state: RunStateHarness['state'] = {
    completionRes: '',
    currentTaskId: null,
    messageId: null,
    workflowProcessData: undefined,
  }

  const runState: ResultRunStateController = {
    abortControllerRef: { current: null },
    clearMoreLikeThis: vi.fn(),
    completionRes: '',
    controlClearMoreLikeThis: 0,
    currentTaskId: null,
    feedback: { rating: null },
    getCompletionRes: vi.fn(() => state.completionRes),
    getWorkflowProcessData: vi.fn(() => state.workflowProcessData),
    handleFeedback: vi.fn(),
    handleStop: vi.fn(),
    isResponding: false,
    isStopping: false,
    messageId: null,
    prepareForNewRun: vi.fn(() => {
      state.completionRes = ''
      state.currentTaskId = null
      state.messageId = null
      state.workflowProcessData = undefined
      runState.completionRes = ''
      runState.currentTaskId = null
      runState.messageId = null
      runState.workflowProcessData = undefined
    }),
    resetRunState: vi.fn(() => {
      state.currentTaskId = null
      runState.currentTaskId = null
      runState.isStopping = false
    }),
    setCompletionRes: vi.fn((value: string) => {
      state.completionRes = value
      runState.completionRes = value
    }),
    setCurrentTaskId: vi.fn((value) => {
      state.currentTaskId = typeof value === 'function' ? value(state.currentTaskId) : value
      runState.currentTaskId = state.currentTaskId
    }),
    setIsStopping: vi.fn((value) => {
      runState.isStopping = typeof value === 'function' ? value(runState.isStopping) : value
    }),
    setMessageId: vi.fn((value) => {
      state.messageId = typeof value === 'function' ? value(state.messageId) : value
      runState.messageId = state.messageId
    }),
    setRespondingFalse: vi.fn(() => {
      runState.isResponding = false
    }),
    setRespondingTrue: vi.fn(() => {
      runState.isResponding = true
    }),
    setWorkflowProcessData: vi.fn((value) => {
      state.workflowProcessData = value
      runState.workflowProcessData = value
    }),
    workflowProcessData: undefined,
  }

  return {
    state,
    runState,
  }
}

const promptConfig: PromptConfig = {
  prompt_template: 'template',
  prompt_variables: [
    { key: 'name', name: 'Name', type: 'string', required: true },
  ],
}

const visionConfig: VisionSettings = {
  enabled: false,
  number_limits: 2,
  detail: Resolution.low,
  transfer_methods: [TransferMethod.local_file],
}

type RenderSenderOptions = {
  appSourceType?: AppSourceType
  controlRetry?: number
  controlSend?: number
  inputs?: Record<string, ResultInputValue>
  isPC?: boolean
  isWorkflow?: boolean
  runState?: ResultRunStateController
  taskId?: number
}

const renderSender = ({
  appSourceType = AppSourceTypeEnum.webApp,
  controlRetry = 0,
  controlSend = 0,
  inputs = { name: 'Alice' },
  isPC = true,
  isWorkflow = false,
  runState,
  taskId,
}: RenderSenderOptions = {}) => {
  const notify = vi.fn()
  const onCompleted = vi.fn()
  const onRunStart = vi.fn()
  const onShowRes = vi.fn()

  const hook = renderHook((props: { controlRetry: number, controlSend: number }) => useResultSender({
    appId: 'app-1',
    appSourceType,
    completionFiles: [],
    controlRetry: props.controlRetry,
    controlSend: props.controlSend,
    inputs,
    isCallBatchAPI: false,
    isPC,
    isWorkflow,
    notify,
    onCompleted,
    onRunStart,
    onShowRes,
    promptConfig,
    runState: runState || createRunStateHarness().runState,
    t: (key: string) => key,
    taskId,
    visionConfig,
  }), {
    initialProps: {
      controlRetry,
      controlSend,
    },
  })

  return {
    ...hook,
    notify,
    onCompleted,
    onRunStart,
    onShowRes,
  }
}

describe('useResultSender', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    validateResultRequestMock.mockReturnValue({ canSend: true })
    buildResultRequestDataMock.mockReturnValue({ inputs: { name: 'Alice' } })
    createWorkflowStreamHandlersMock.mockReturnValue({ onWorkflowFinished: vi.fn() })
    sendCompletionMessageMock.mockResolvedValue(undefined)
    sendWorkflowMessageMock.mockResolvedValue(undefined)
    sleepMock.mockImplementation(() => new Promise<void>(() => {}))
  })

  it('should reject sends while a response is already in progress', async () => {
    const { runState } = createRunStateHarness()
    runState.isResponding = true
    const { result, notify } = renderSender({ runState })

    await act(async () => {
      expect(await result.current.handleSend()).toBe(false)
    })

    expect(notify).toHaveBeenCalledWith({
      type: 'info',
      message: 'errorMessage.waitForResponse',
    })
    expect(validateResultRequestMock).not.toHaveBeenCalled()
    expect(sendCompletionMessageMock).not.toHaveBeenCalled()
  })

  it('should surface validation failures without building request payloads', async () => {
    const { runState } = createRunStateHarness()
    validateResultRequestMock.mockReturnValue({
      canSend: false,
      notification: {
        type: 'error',
        message: 'invalid',
      },
    })

    const { result, notify } = renderSender({ runState })

    await act(async () => {
      expect(await result.current.handleSend()).toBe(false)
    })

    expect(notify).toHaveBeenCalledWith({
      type: 'error',
      message: 'invalid',
    })
    expect(buildResultRequestDataMock).not.toHaveBeenCalled()
    expect(sendCompletionMessageMock).not.toHaveBeenCalled()
  })

  it('should send completion requests when controlSend changes and process callbacks', async () => {
    const harness = createRunStateHarness()
    let completionHandlers: CompletionHandlers | undefined

    sendCompletionMessageMock.mockImplementation(async (_data, handlers) => {
      completionHandlers = handlers as CompletionHandlers
    })

    const { rerender, onCompleted, onRunStart, onShowRes } = renderSender({
      controlSend: 0,
      isPC: false,
      runState: harness.runState,
      taskId: 7,
    })

    rerender({
      controlRetry: 0,
      controlSend: 1,
    })

    expect(validateResultRequestMock).toHaveBeenCalledWith(expect.objectContaining({
      inputs: { name: 'Alice' },
      isCallBatchAPI: false,
    }))
    expect(buildResultRequestDataMock).toHaveBeenCalled()
    expect(harness.runState.prepareForNewRun).toHaveBeenCalledTimes(1)
    expect(harness.runState.setRespondingTrue).toHaveBeenCalledTimes(1)
    expect(harness.runState.clearMoreLikeThis).toHaveBeenCalledTimes(1)
    expect(onShowRes).toHaveBeenCalledTimes(1)
    expect(onRunStart).toHaveBeenCalledTimes(1)
    expect(sendCompletionMessageMock).toHaveBeenCalledWith(
      { inputs: { name: 'Alice' } },
      expect.objectContaining({
        onCompleted: expect.any(Function),
        onData: expect.any(Function),
      }),
      AppSourceTypeEnum.webApp,
      'app-1',
    )

    const abortController = {} as AbortController
    expect(completionHandlers).toBeDefined()
    completionHandlers!.getAbortController(abortController)
    expect(harness.runState.abortControllerRef.current).toBe(abortController)

    await act(async () => {
      completionHandlers!.onData('Hello', false, {
        messageId: 'message-1',
        taskId: 'task-1',
      })
    })

    expect(harness.runState.setCurrentTaskId).toHaveBeenCalled()
    expect(harness.runState.currentTaskId).toBe('task-1')

    await act(async () => {
      completionHandlers!.onMessageReplace({ answer: 'Replaced' })
      completionHandlers!.onCompleted()
    })

    expect(harness.runState.setCompletionRes).toHaveBeenLastCalledWith('Replaced')
    expect(harness.runState.setRespondingFalse).toHaveBeenCalled()
    expect(harness.runState.resetRunState).toHaveBeenCalled()
    expect(harness.runState.setMessageId).toHaveBeenCalledWith('message-1')
    expect(onCompleted).toHaveBeenCalledWith('Replaced', 7, true)
  })

  it('should trigger workflow sends on retry and report workflow request failures', async () => {
    const harness = createRunStateHarness()
    sendWorkflowMessageMock.mockRejectedValue(new Error('workflow failed'))

    const { rerender, notify } = renderSender({
      controlRetry: 0,
      isWorkflow: true,
      runState: harness.runState,
    })

    rerender({
      controlRetry: 2,
      controlSend: 0,
    })

    await waitFor(() => {
      expect(createWorkflowStreamHandlersMock).toHaveBeenCalledWith(expect.objectContaining({
        getCompletionRes: harness.runState.getCompletionRes,
        isPublicAPI: true,
        resetRunState: harness.runState.resetRunState,
        setWorkflowProcessData: harness.runState.setWorkflowProcessData,
      }))
      expect(sendWorkflowMessageMock).toHaveBeenCalledWith(
        { inputs: { name: 'Alice' } },
        expect.any(Object),
        AppSourceTypeEnum.webApp,
        'app-1',
      )
    })

    await waitFor(() => {
      expect(harness.runState.setRespondingFalse).toHaveBeenCalled()
      expect(harness.runState.resetRunState).toHaveBeenCalled()
      expect(notify).toHaveBeenCalledWith({
        type: 'error',
        message: 'workflow failed',
      })
    })
    expect(harness.runState.clearMoreLikeThis).not.toHaveBeenCalled()
  })

  it('should configure workflow handlers for installed apps as non-public', async () => {
    const harness = createRunStateHarness()

    const { result } = renderSender({
      appSourceType: AppSourceTypeEnum.installedApp,
      isWorkflow: true,
      runState: harness.runState,
    })

    await act(async () => {
      expect(await result.current.handleSend()).toBe(true)
    })

    expect(createWorkflowStreamHandlersMock).toHaveBeenCalledWith(expect.objectContaining({
      isPublicAPI: false,
    }))
    expect(sendWorkflowMessageMock).toHaveBeenCalledWith(
      { inputs: { name: 'Alice' } },
      expect.any(Object),
      AppSourceTypeEnum.installedApp,
      'app-1',
    )
  })

  it('should stringify non-Error workflow failures', async () => {
    const harness = createRunStateHarness()
    sendWorkflowMessageMock.mockRejectedValue('workflow failed')

    const { result, notify } = renderSender({
      isWorkflow: true,
      runState: harness.runState,
    })

    await act(async () => {
      await result.current.handleSend()
    })

    await waitFor(() => {
      expect(notify).toHaveBeenCalledWith({
        type: 'error',
        message: 'workflow failed',
      })
    })
  })

  it('should timeout unfinished completion requests', async () => {
    const harness = createRunStateHarness()
    sleepMock.mockResolvedValue(undefined)

    const { result, onCompleted } = renderSender({
      runState: harness.runState,
      taskId: 9,
    })

    await act(async () => {
      expect(await result.current.handleSend()).toBe(true)
    })

    await waitFor(() => {
      expect(harness.runState.setRespondingFalse).toHaveBeenCalled()
      expect(harness.runState.resetRunState).toHaveBeenCalled()
      expect(onCompleted).toHaveBeenCalledWith('', 9, false)
    })
  })

  it('should ignore empty task ids and surface timeout warnings from stream callbacks', async () => {
    const harness = createRunStateHarness()
    let completionHandlers: CompletionHandlers | undefined

    sleepMock.mockResolvedValue(undefined)
    sendCompletionMessageMock.mockImplementation(async (_data, handlers) => {
      completionHandlers = handlers as CompletionHandlers
    })

    const { result, notify, onCompleted } = renderSender({
      runState: harness.runState,
      taskId: 11,
    })

    await act(async () => {
      await result.current.handleSend()
    })

    await act(async () => {
      completionHandlers!.onData('Hello', false, {
        messageId: 'message-2',
        taskId: '   ',
      })
      completionHandlers!.onCompleted()
      completionHandlers!.onError()
    })

    expect(harness.runState.currentTaskId).toBeNull()
    expect(notify).toHaveBeenNthCalledWith(1, {
      type: 'warning',
      message: 'warningMessage.timeoutExceeded',
    })
    expect(notify).toHaveBeenNthCalledWith(2, {
      type: 'warning',
      message: 'warningMessage.timeoutExceeded',
    })
    expect(onCompleted).toHaveBeenCalledWith('', 11, false)
  })

  it('should avoid timeout fallback after a completion response has already ended', async () => {
    const harness = createRunStateHarness()
    let resolveSleep!: () => void
    let completionHandlers: CompletionHandlers | undefined

    sleepMock.mockImplementation(() => new Promise<void>((resolve) => {
      resolveSleep = resolve
    }))
    sendCompletionMessageMock.mockImplementation(async (_data, handlers) => {
      completionHandlers = handlers as CompletionHandlers
    })

    const { result, onCompleted } = renderSender({
      runState: harness.runState,
      taskId: 12,
    })

    await act(async () => {
      await result.current.handleSend()
    })

    await act(async () => {
      harness.runState.setCompletionRes('Done')
      completionHandlers!.onCompleted()
      resolveSleep()
      await Promise.resolve()
    })

    expect(onCompleted).toHaveBeenCalledWith('Done', 12, true)
    expect(onCompleted).toHaveBeenCalledTimes(1)
  })

  it('should handle non-timeout stream errors as failed completions', async () => {
    const harness = createRunStateHarness()
    let completionHandlers: CompletionHandlers | undefined

    sendCompletionMessageMock.mockImplementation(async (_data, handlers) => {
      completionHandlers = handlers as CompletionHandlers
    })

    const { result, onCompleted } = renderSender({
      runState: harness.runState,
      taskId: 13,
    })

    await act(async () => {
      await result.current.handleSend()
      completionHandlers!.onError()
    })

    expect(harness.runState.setRespondingFalse).toHaveBeenCalled()
    expect(harness.runState.resetRunState).toHaveBeenCalled()
    expect(onCompleted).toHaveBeenCalledWith('', 13, false)
  })
})
