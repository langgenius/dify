import type { ReactNode } from 'react'
import type { TextGenerationTranslate } from '../../../types'
import type { ResultInputValue } from '../../result-request'
import type { PromptConfig } from '@/models/debug'
import type { AppData } from '@/models/share'
import type { VisionSettings } from '@/types/app'
import type {
  HumanInputFormData,
  WorkflowFinishedResponse,
  WorkflowPausedResponse,
} from '@/types/workflow'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, useLayoutEffect } from 'react'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { TEXT_GENERATION_TIMEOUT_MS } from '@/config'
import WebAppStoreProvider, { useWebAppStore } from '@/context/web-app-context'
// oxlint-disable-next-line no-restricted-imports -- The test drives the production continuation transport callback boundary.
import { sseGet } from '@/service/base'
import { AppSourceType, sendWorkflowMessage } from '@/service/share'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { withSelectorKey } from '@/test/i18n-mock'
import { Resolution, TransferMethod } from '@/types/app'
import { useResultRunState as useResultRunController } from '../use-result-run-state'
import { useResultSender } from '../use-result-sender'

const releaseGate = vi.hoisted(() => ({ enabled: true }))
vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  get ENABLE_HITL_IM() {
    return releaseGate.enabled
  },
}))

const mocks = vi.hoisted(() => ({
  sendWorkflowMessage: vi.fn(),
  sseGet: vi.fn(),
  trackEvent: vi.fn(),
}))

vi.mock('@/service/share', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/share')>()),
  sendWorkflowMessage: mocks.sendWorkflowMessage,
}))
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  sseGet: mocks.sseGet,
}))
vi.mock('@/app/components/base/amplitude/web-app-event', () => ({
  trackWebAppEvent: mocks.trackEvent,
}))
vi.mock('@/next/navigation', () => ({
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

const workflowTransport = vi.mocked(sendWorkflowMessage)
// oxlint-disable-next-line typescript/no-deprecated -- The production continuation still uses the SSE transport.
const workflowEvents = vi.mocked(sseGet)

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

const appInfo: AppData = {
  app_id: 'app-1',
  mode: 'completion',
  custom_config: null,
  site: { title: 'Result App' },
}

const form: HumanInputFormData = {
  form_id: 'form-1',
  node_id: 'node-1',
  node_title: 'Approval',
  form_content: 'Please review',
  inputs: [],
  actions: [],
  form_token: 'token-1',
  resolved_default_values: {},
  display_in_ui: true,
  expiration_time: 100,
}

const paused: WorkflowPausedResponse = {
  event: 'workflow_paused',
  task_id: 'task-1',
  workflow_run_id: 'run-1',
  data: {
    workflow_run_id: 'run-1',
    outputs: {},
    paused_nodes: ['node-1'],
    reasons: [],
  },
}

const finished: WorkflowFinishedResponse = {
  event: 'workflow_finished',
  task_id: 'task-1',
  workflow_run_id: 'run-1',
  data: {
    id: 'run-1',
    workflow_id: 'workflow-1',
    status: 'succeeded',
    outputs: { answer: 'Approved' },
    error: '',
    elapsed_time: 1,
    total_tokens: 0,
    total_steps: 3,
    created_at: 0,
    finished_at: 1,
    created_by: { id: 'user-1', name: 'User', email: 'user@example.com' },
  },
}

const InitialWebAppData = ({ children, data }: { children?: ReactNode; data: AppData }) => {
  const updateAppInfo = useWebAppStore((state) => state.updateAppInfo)
  useLayoutEffect(() => {
    updateAppInfo(data)
    return () => updateAppInfo(null)
  }, [data, updateAppInfo])
  return children
}

type RenderSenderOptions = {
  appSourceType?: AppSourceType
  controlRetry?: number
  controlSend?: number
  inputs?: Record<string, ResultInputValue>
  isPC?: boolean
  isWorkflow?: boolean
  taskId?: number
}

const renderSender = ({
  appSourceType = AppSourceType.webApp,
  controlRetry = 0,
  controlSend = 0,
  inputs = { name: 'Alice' },
  isPC = true,
  isWorkflow = true,
  taskId,
}: RenderSenderOptions = {}) => {
  const notify = vi.fn()
  const onCompleted = vi.fn()
  const onRunStart = vi.fn()
  const onShowRes = vi.fn()
  const { wrapper: QueryWrapper } = createConsoleQueryWrapper()
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      QueryWrapper,
      null,
      createElement(
        WebAppStoreProvider,
        null,
        createElement(InitialWebAppData, { data: appInfo }, children),
      ),
    )
  const hook = renderHook(
    (props: { controlRetry: number; controlSend: number }) => {
      const state = useResultRunController({
        appId: 'app-1',
        appSourceType,
        isWorkflow,
        notify,
      })
      const sender = useResultSender({
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
        runState: state,
        t: withSelectorKey((key: string) => key) as TextGenerationTranslate,
        taskId,
        visionConfig,
      })
      return { ...sender, state }
    },
    {
      initialProps: { controlRetry, controlSend },
      wrapper,
    },
  )
  return { ...hook, notify, onCompleted, onRunStart, onShowRes }
}

const initialHandlers = (run = 0) => {
  const call = workflowTransport.mock.calls[run]
  if (!call) throw new Error(`Missing workflow transport ${run}`)
  return call[1]
}

const continuationHandlers = (run = 0) => {
  const call = workflowEvents.mock.calls[run]
  if (!call) throw new Error(`Missing workflow continuation ${run}`)
  return call[2]
}

const pausePublicRun = (run = 0) => {
  const handlers = initialHandlers(run)
  act(() => {
    handlers.onWorkflowStarted?.({
      workflow_run_id: `run-${run + 1}`,
      task_id: `task-${run + 1}`,
      event: 'workflow_started',
      data: { id: `run-${run + 1}`, workflow_id: 'workflow-1', created_at: 0 },
    })
    handlers.onHumanInputRequired?.({
      event: 'human_input_required',
      task_id: `task-${run + 1}`,
      workflow_run_id: `run-${run + 1}`,
      data: { ...form, form_id: `form-${run + 1}` },
    })
    handlers.onWorkflowPaused?.({
      ...paused,
      task_id: `task-${run + 1}`,
      workflow_run_id: `run-${run + 1}`,
      data: { ...paused.data, workflow_run_id: `run-${run + 1}` },
    })
  })
}

describe('useResultSender HITL workflow ownership', () => {
  beforeEach(() => {
    releaseGate.enabled = true
    mocks.sendWorkflowMessage.mockResolvedValue(undefined)
    mocks.sseGet.mockResolvedValue(undefined)
  })

  it.each([AppSourceType.installedApp, AppSourceType.tryApp])(
    'keeps %s workflow events on the existing non-public route',
    async (appSourceType) => {
      const { result } = renderSender({ appSourceType })
      await act(async () => expect(await result.current.handleSend()).toBe(true))

      expect(workflowTransport).toHaveBeenCalledExactlyOnceWith(
        { inputs: { name: 'Alice' } },
        expect.objectContaining({ isPublicAPI: false }),
        appSourceType,
        'app-1',
      )
      expect(mocks.trackEvent).not.toHaveBeenCalled()
      expect(workflowEvents).not.toHaveBeenCalled()
      act(() => initialHandlers().onWorkflowFinished?.(finished))
      expect(result.current.state.workflowProcessData?.status).toBe(WorkflowRunningStatus.Succeeded)
    },
  )

  it('keeps a paused approval available after the real generation timeout elapses', async () => {
    vi.useFakeTimers()
    try {
      const { result, onCompleted } = renderSender()
      await act(async () => result.current.handleSend())
      pausePublicRun()

      await act(async () => vi.advanceTimersByTimeAsync(TEXT_GENERATION_TIMEOUT_MS))

      expect(result.current.state.workflowProcessData).toEqual(
        expect.objectContaining({
          status: WorkflowRunningStatus.Paused,
          humanInputFormDataList: [form],
        }),
      )
      expect(result.current.state.isResponding).toBe(true)
      expect(onCompleted).not.toHaveBeenCalled()
      expect(workflowEvents).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('waits for event readiness and disposes each public continuation before reuse or unmount', async () => {
    const { result, unmount } = renderSender()
    await act(async () => result.current.handleSend())
    pausePublicRun()

    let ready: boolean | undefined
    const readiness = result.current.prepareHumanInputSubmission().then((value) => {
      ready = value
    })
    await act(async () => Promise.resolve())
    expect(ready).toBeUndefined()

    const firstController = new AbortController()
    act(() => {
      continuationHandlers().getAbortController?.(firstController)
      continuationHandlers().onWorkflowPaused?.(paused)
    })
    await act(async () => readiness)
    expect(ready).toBe(true)

    act(() => continuationHandlers().onWorkflowFinished?.(finished))
    await waitFor(() => expect(result.current.state.isResponding).toBe(false))
    expect(firstController.signal.aborted).toBe(true)

    await act(async () => expect(await result.current.handleSend()).toBe(true))
    pausePublicRun(1)
    const secondController = new AbortController()
    act(() => continuationHandlers(1).getAbortController?.(secondController))
    unmount()
    expect(secondController.signal.aborted).toBe(true)
    expect(workflowTransport).toHaveBeenCalledTimes(2)
  })

  it('releases a stopped public run and lets the user start another run', async () => {
    const { result, onCompleted } = renderSender()
    await act(async () => result.current.handleSend())
    pausePublicRun()
    const controller = new AbortController()
    act(() => continuationHandlers().getAbortController?.(controller))
    act(() => controller.abort())

    expect(result.current.state.isResponding).toBe(false)
    expect(result.current.state.workflowProcessData).toEqual(
      expect.objectContaining({
        status: WorkflowRunningStatus.Stopped,
        humanInputFormDataList: [],
      }),
    )
    expect(onCompleted).toHaveBeenCalledWith('', undefined, false)
    await act(async () => expect(await result.current.handleSend()).toBe(true))
    expect(workflowTransport).toHaveBeenCalledTimes(2)
  })

  it('uses the legacy public stream without creating a continuation when disabled', async () => {
    releaseGate.enabled = false
    const { result } = renderSender()
    await act(async () => result.current.handleSend())

    expect(workflowTransport).toHaveBeenCalledExactlyOnceWith(
      { inputs: { name: 'Alice' } },
      expect.objectContaining({ isPublicAPI: true }),
      AppSourceType.webApp,
      'app-1',
    )
    expect(workflowEvents).not.toHaveBeenCalled()
    expect(await result.current.prepareHumanInputSubmission()).toBe(true)
    act(() => initialHandlers().onWorkflowFinished?.(finished))
    expect(result.current.state.workflowProcessData?.status).toBe(WorkflowRunningStatus.Succeeded)
  })
})
