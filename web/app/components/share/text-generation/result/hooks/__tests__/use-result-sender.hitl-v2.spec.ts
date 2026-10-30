import type { TextGenerationTranslate } from '../../../types'
import type { ResultInputValue } from '../../result-request'
import type {
  createWorkflowEventsSubscription,
  WorkflowEventsHandlers,
} from '../../workflow-events-subscription'
import type { createWorkflowStreamHandlers } from '../../workflow-stream-handlers'
import type { ResultRunStateController } from '../use-result-run-state'
import type { PromptConfig } from '@/models/debug'
import type { AppSourceType } from '@/service/share'
import type { VisionSettings } from '@/types/app'
import { act, renderHook } from '@testing-library/react'
import { AppSourceType as AppSourceTypeEnum } from '@/service/share'
import { withSelectorKey } from '@/test/i18n-mock'
import { Resolution, TransferMethod } from '@/types/app'
import { useResultSender } from '../use-result-sender'

const releaseGate = vi.hoisted(() => ({ enabled: true }))
vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  get ENABLE_HITL_IM() {
    return releaseGate.enabled
  },
}))

const {
  buildResultRequestDataMock,
  createWorkflowEventsSubscriptionMock,
  createWorkflowStreamHandlersMock,
  mockTrackEvent,
  mockWebAppState,
  sendCompletionMessageMock,
  sendWorkflowMessageMock,
  sleepMock,
  validateResultRequestMock,
  workflowEventsSubscription,
} = vi.hoisted(() => ({
  buildResultRequestDataMock: vi.fn(),
  createWorkflowEventsSubscriptionMock: vi.fn(),
  createWorkflowStreamHandlersMock: vi.fn(),
  mockTrackEvent: vi.fn(),
  mockWebAppState: {
    appInfo: {
      mode: 'completion',
    },
  },
  sendCompletionMessageMock: vi.fn(),
  sendWorkflowMessageMock: vi.fn(),
  sleepMock: vi.fn(),
  validateResultRequestMock: vi.fn(),
  workflowEventsSubscription: {
    start: vi.fn(),
    prepare: vi.fn(),
    dispose: vi.fn(),
  },
}))

vi.mock('@/app/components/base/amplitude/web-app-event', () => ({
  trackWebAppEvent: mockTrackEvent,
}))

vi.mock('@/context/web-app-context', () => ({
  useWebAppStore: (selector: (state: typeof mockWebAppState) => unknown) =>
    selector(mockWebAppState),
}))

vi.mock('@/service/share', async () => {
  const actual = await vi.importActual<typeof import('@/service/share')>('@/service/share')
  return {
    ...actual,
    sendCompletionMessage: (...args: Parameters<typeof actual.sendCompletionMessage>) =>
      sendCompletionMessageMock(...args),
    sendWorkflowMessage: (...args: Parameters<typeof actual.sendWorkflowMessage>) =>
      sendWorkflowMessageMock(...args),
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

vi.mock('../../workflow-stream-handlers', async () => ({
  ...(await vi.importActual<typeof import('../../workflow-stream-handlers')>(
    '../../workflow-stream-handlers',
  )),
  createWorkflowStreamHandlers: (...args: unknown[]) => createWorkflowStreamHandlersMock(...args),
}))

vi.mock('../../workflow-events-subscription', () => ({
  createWorkflowEventsSubscription: (...args: unknown[]) =>
    createWorkflowEventsSubscriptionMock(...args),
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

type WorkflowHandlerOptions = Parameters<typeof createWorkflowStreamHandlers>[0]

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
  prompt_variables: [{ key: 'name', name: 'Name', type: 'string', required: true }],
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

  const hook = renderHook(
    (props: { controlRetry: number; controlSend: number }) =>
      useResultSender({
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
        t: withSelectorKey((key: string) => key) as TextGenerationTranslate,
        taskId,
        visionConfig,
      }),
    {
      initialProps: {
        controlRetry,
        controlSend,
      },
    },
  )

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
    releaseGate.enabled = true
    vi.clearAllMocks()
    mockWebAppState.appInfo.mode = 'completion'
    validateResultRequestMock.mockReturnValue({ canSend: true })
    buildResultRequestDataMock.mockReturnValue({ inputs: { name: 'Alice' } })
    createWorkflowStreamHandlersMock.mockReturnValue({ onWorkflowFinished: vi.fn() })
    createWorkflowEventsSubscriptionMock.mockReturnValue(workflowEventsSubscription)
    workflowEventsSubscription.prepare.mockResolvedValue(true)
    sendCompletionMessageMock.mockResolvedValue(undefined)
    sendWorkflowMessageMock.mockResolvedValue(undefined)
    sleepMock.mockImplementation(() => new Promise<void>(() => {}))
  })

  it.each([AppSourceTypeEnum.installedApp, AppSourceTypeEnum.tryApp])(
    'should keep %s workflow handlers on the existing non-public path',
    async (appSourceType) => {
      const harness = createRunStateHarness()

      const { result } = renderSender({
        appSourceType,
        isWorkflow: true,
        runState: harness.runState,
      })

      await act(async () => {
        expect(await result.current.handleSend()).toBe(true)
      })

      expect(createWorkflowStreamHandlersMock).toHaveBeenCalledWith(
        expect.objectContaining({
          isPublicAPI: false,
        }),
      )
      expect(sendWorkflowMessageMock).toHaveBeenCalledWith(
        { inputs: { name: 'Alice' } },
        expect.any(Object),
        appSourceType,
        'app-1',
      )
      expect(mockTrackEvent).not.toHaveBeenCalled()
      expect(createWorkflowEventsSubscriptionMock).not.toHaveBeenCalled()
    },
  )

  it('should keep a paused approval available after the generation timeout has elapsed', async () => {
    const harness = createRunStateHarness()
    let expireGenerationTimeout: (() => void) | undefined
    let markPausedTransportEnded: (() => void) | undefined
    let isTimedOut: (() => boolean) | undefined

    sleepMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          expireGenerationTimeout = resolve
        }),
    )
    createWorkflowStreamHandlersMock.mockImplementation((options: WorkflowHandlerOptions) => {
      markPausedTransportEnded = options.markEnded
      isTimedOut = options.isTimedOut
      return {}
    })
    const { result, onCompleted } = renderSender({
      isWorkflow: true,
      runState: harness.runState,
    })

    await act(async () => {
      await result.current.handleSend()
      markPausedTransportEnded?.()
      expireGenerationTimeout?.()
      await Promise.resolve()
    })

    expect(isTimedOut?.()).toBe(false)
    expect(harness.runState.resetRunState).not.toHaveBeenCalled()
    expect(onCompleted).not.toHaveBeenCalled()
    expect(workflowEventsSubscription.dispose).not.toHaveBeenCalled()
  })

  it('should release a public workflow subscription before a new run and on unmount', async () => {
    const harness = createRunStateHarness()
    let onPaused: ((workflowRunId: string, handlers: WorkflowEventsHandlers) => void) | undefined
    createWorkflowStreamHandlersMock.mockImplementation((options: WorkflowHandlerOptions) => {
      onPaused = options.onPaused
      return { isPublicAPI: options.isPublicAPI }
    })
    const { result, unmount } = renderSender({
      isWorkflow: true,
      runState: harness.runState,
    })

    await act(async () => {
      await result.current.handleSend()
    })
    expect(createWorkflowEventsSubscriptionMock).toHaveBeenCalledOnce()
    const streamHandlers: WorkflowEventsHandlers = { isPublicAPI: true }
    onPaused?.('run-1', streamHandlers)
    expect(workflowEventsSubscription.start).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        isPublicAPI: true,
        getAbortController: expect.any(Function),
      }),
    )
    expect(await result.current.prepareHumanInputSubmission()).toBe(true)
    expect(workflowEventsSubscription.prepare).toHaveBeenCalledOnce()

    harness.runState.isResponding = false
    await act(async () => {
      await result.current.handleSend()
    })
    expect(workflowEventsSubscription.dispose).toHaveBeenCalledOnce()
    expect(createWorkflowEventsSubscriptionMock).toHaveBeenCalledTimes(2)

    unmount()
    expect(workflowEventsSubscription.dispose).toHaveBeenCalledTimes(2)
  })

  it('releases a stopped public run and lets the user start another run', async () => {
    const harness = createRunStateHarness()
    let onAbort: (() => void) | undefined
    createWorkflowEventsSubscriptionMock.mockImplementation(
      (options: Parameters<typeof createWorkflowEventsSubscription>[0]) => {
        onAbort = options?.onAbort
        return workflowEventsSubscription
      },
    )
    const { result, onCompleted } = renderSender({ isWorkflow: true, runState: harness.runState })
    await act(async () => {
      await result.current.handleSend()
    })
    await act(async () => {
      onAbort?.()
    })
    expect(harness.runState.isResponding).toBe(false)
    expect(harness.runState.getWorkflowProcessData()).toMatchObject({
      status: 'stopped',
      humanInputFormDataList: [],
    })
    expect(onCompleted).toHaveBeenCalledWith('', undefined, false)
    await act(async () => {
      expect(await result.current.handleSend()).toBe(true)
    })
    expect(sendWorkflowMessageMock).toHaveBeenCalledTimes(2)
  })
  it('uses the legacy public stream without creating an IM subscription when disabled', async () => {
    releaseGate.enabled = false
    const harness = createRunStateHarness()
    const { result } = renderSender({ isWorkflow: true, runState: harness.runState })
    await act(async () => {
      await result.current.handleSend()
    })
    expect(createWorkflowStreamHandlersMock).toHaveBeenCalledWith(
      expect.objectContaining({ isPublicAPI: true }),
    )
    expect(createWorkflowStreamHandlersMock.mock.calls[0]?.[0].onPaused).toBeUndefined()
    expect(createWorkflowEventsSubscriptionMock).not.toHaveBeenCalled()
    expect(await result.current.prepareHumanInputSubmission()).toBe(true)
    expect(workflowEventsSubscription.prepare).not.toHaveBeenCalled()
  })
})
