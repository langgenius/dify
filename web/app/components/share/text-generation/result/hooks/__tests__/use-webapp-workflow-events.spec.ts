import type { TextGenerationTranslate } from '../../../types'
import type { WorkflowEventsHandlers } from '../../workflow-events-subscription'
import type { createWorkflowStreamHandlers } from '../../workflow-stream-handlers'
import type { WorkflowProcess } from '@/app/components/base/chat/types'
import type {
  HumanInputFormData,
  WorkflowFinishedResponse,
  WorkflowPausedResponse,
} from '@/types/workflow'
import { act, renderHook } from '@testing-library/react'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { withSelectorKey } from '@/test/i18n-mock'
import { useWebAppWorkflowEvents } from '../use-webapp-workflow-events'

const sseGetMock = vi.hoisted(() =>
  vi.fn<(url: string, options: object, handlers: WorkflowEventsHandlers) => Promise<void>>(),
)
vi.mock('@/service/base', async () => ({
  ...(await vi.importActual<typeof import('@/service/base')>('@/service/base')),
  sseGet: sseGetMock,
}))

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
  data: { workflow_run_id: 'run-1', outputs: {}, paused_nodes: ['node-1'], reasons: [] },
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

const continuation = () => {
  const call = sseGetMock.mock.calls[0]
  if (!call) throw new Error('Missing workflow continuation')
  return call[2]
}

const setup = () => {
  let completionRes = ''
  let process: WorkflowProcess | undefined
  const abortControllerRef: { current: AbortController | null } = { current: null }
  const setCompletionRes = vi.fn((value: string) => {
    completionRes = value
  })
  const setWorkflowProcessData = vi.fn((value: WorkflowProcess | undefined) => {
    process = value
  })
  const options: Parameters<typeof createWorkflowStreamHandlers>[0] = {
    getCompletionRes: () => completionRes,
    getWorkflowProcessData: () => process,
    isPublicAPI: true,
    isTimedOut: () => false,
    markEnded: vi.fn(),
    notify: vi.fn(),
    onCompleted: vi.fn(),
    resetRunState: vi.fn(),
    setCompletionRes,
    setCurrentTaskId: vi.fn(),
    setIsStopping: vi.fn(),
    setMessageId: vi.fn(),
    setRespondingFalse: vi.fn(),
    setWorkflowProcessData,
    t: withSelectorKey((key: string) => key) as TextGenerationTranslate,
    taskId: 3,
  }
  const hook = renderHook(() => useWebAppWorkflowEvents({ abortControllerRef, isResponding: true }))
  const handlers = hook.result.current.createStreamHandlers(options)
  act(() => {
    handlers.onHumanInputRequired?.({
      event: 'human_input_required',
      task_id: 'task-1',
      workflow_run_id: 'run-1',
      data: form,
    })
    handlers.onWorkflowPaused?.(paused)
  })
  return { ...hook, abortControllerRef, options, process: () => process }
}

describe('Webapp Workflow approval owner', () => {
  beforeEach(() => {
    sseGetMock.mockResolvedValue(undefined)
  })

  it('keeps the pending approval while pausing the generation timeout', () => {
    const subject = setup()
    expect(subject.process()).toEqual(
      expect.objectContaining({
        status: WorkflowRunningStatus.Paused,
        humanInputFormDataList: [form],
      }),
    )
    expect(subject.options.markEnded).toHaveBeenCalledOnce()
    expect(subject.options.onCompleted).not.toHaveBeenCalled()
    expect(subject.options.resetRunState).not.toHaveBeenCalled()
    expect(subject.options.setRespondingFalse).not.toHaveBeenCalled()
    expect(sseGetMock).toHaveBeenCalledOnce()
    subject.unmount()
  })

  it('applies a finished snapshot without a filled event and clears the stale approval', async () => {
    const subject = setup()
    const preparation = subject.result.current.prepareHumanInputSubmission()
    act(() => continuation().onWorkflowFinished?.(finished))
    expect(await preparation).toBe(false)
    expect(subject.process()).toEqual(
      expect.objectContaining({
        status: WorkflowRunningStatus.Succeeded,
        resultText: 'Approved',
        humanInputFormDataList: [],
      }),
    )
    expect(subject.options.setMessageId).toHaveBeenCalledWith('run-1')
    expect(subject.options.onCompleted).toHaveBeenCalledWith('{"answer":"Approved"}', 3, true)
    expect(subject.options.setRespondingFalse).toHaveBeenCalledOnce()
    expect(subject.options.resetRunState).toHaveBeenCalledOnce()
    subject.unmount()
  })

  it('finishes the owner when the user aborts the continuation', async () => {
    const subject = setup()
    const controller = new AbortController()
    act(() => continuation().getAbortController?.(controller))
    expect(subject.abortControllerRef.current).toBe(controller)
    act(() => controller.abort())
    expect(subject.process()).toEqual(
      expect.objectContaining({
        status: WorkflowRunningStatus.Stopped,
        humanInputFormDataList: [],
      }),
    )
    expect(subject.options.onCompleted).toHaveBeenCalledWith('', 3, false)
    expect(subject.options.setRespondingFalse).toHaveBeenCalledOnce()
    expect(subject.options.resetRunState).toHaveBeenCalledOnce()
    expect(await subject.result.current.prepareHumanInputSubmission()).toBe(false)
    subject.unmount()
  })
})
