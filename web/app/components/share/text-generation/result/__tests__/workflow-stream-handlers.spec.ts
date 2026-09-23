import type { WorkflowProcess } from '@/app/components/base/chat/types'
import type { IOtherOptions } from '@/service/base'
import type { HumanInputFormData, NodeTracing } from '@/types/workflow'
import { act } from '@testing-library/react'
import {
  BlockEnum,
  NodeRunningStatus,
  WorkflowRunningStatus,
} from '@/app/components/workflow/types'
import { withSelectorKey } from '@/test/i18n-mock'
import {
  appendParallelNext,
  appendParallelStart,
  applyWorkflowFinishedState,
  createWorkflowStreamHandlers,
  finishWorkflowNode,
  markNodesStopped,
} from '../workflow-stream-handlers'

const sseGetMock = vi.fn()

type TraceOverrides = Omit<Partial<NodeTracing>, 'execution_metadata'> & {
  execution_metadata?: Partial<NonNullable<NodeTracing['execution_metadata']>>
}

vi.mock('@/service/base', async () => {
  const actual = await vi.importActual<typeof import('@/service/base')>('@/service/base')
  return {
    ...actual,
    sseGet: (...args: Parameters<typeof actual.sseGet>) => sseGetMock(...args),
  }
})

const createTrace = (overrides: TraceOverrides = {}): NodeTracing => {
  const { execution_metadata, ...restOverrides } = overrides

  return {
    id: 'trace-1',
    index: 0,
    predecessor_node_id: '',
    node_id: 'node-1',
    node_type: BlockEnum.LLM,
    title: 'Node',
    inputs: {},
    inputs_truncated: false,
    process_data: {},
    process_data_truncated: false,
    outputs: {},
    outputs_truncated: false,
    status: NodeRunningStatus.Running,
    elapsed_time: 0,
    metadata: {
      iterator_length: 0,
      iterator_index: 0,
      loop_length: 0,
      loop_index: 0,
    },
    created_at: 0,
    created_by: {
      id: 'user-1',
      name: 'User',
      email: 'user@example.com',
    },
    finished_at: 0,
    details: [[]],
    execution_metadata: {
      total_tokens: 0,
      total_price: 0,
      currency: 'USD',
      ...execution_metadata,
    },
    ...restOverrides,
  }
}

const createWorkflowProcess = (): WorkflowProcess => ({
  status: WorkflowRunningStatus.Running,
  tracing: [],
  expand: false,
  resultText: '',
})

const createHumanInput = (overrides: Partial<HumanInputFormData> = {}): HumanInputFormData => ({
  form_id: 'form-1',
  node_id: 'node-1',
  node_title: 'Node',
  form_content: 'content',
  inputs: [],
  actions: [],
  form_token: 'token-1',
  resolved_default_values: {},
  display_in_ui: true,
  expiration_time: 100,
  ...overrides,
})

describe('workflow-stream-handlers helpers', () => {
  it('creates trace groups for the first and next parallel execution', () => {
    const trace = createTrace({
      execution_metadata: { parallel_id: 'parallel-1' },
      details: undefined,
    })

    const started = appendParallelStart(undefined, trace)
    const next = appendParallelNext(started, trace)

    expect(started.tracing[0]?.details).toEqual([[]])
    expect(next.tracing[0]?.details).toEqual([[], []])
  })

  it('preserves node extras when the finished event supplies execution outputs', () => {
    const process = createWorkflowProcess()
    process.tracing = [createTrace({ extras: { workflow_tool: true } })]

    const finished = finishWorkflowNode(
      process,
      createTrace({
        status: NodeRunningStatus.Succeeded,
        outputs: { answer: 'Approved' },
      }),
    )

    expect(finished?.tracing).toEqual([
      expect.objectContaining({
        status: NodeRunningStatus.Succeeded,
        extras: { workflow_tool: true },
        outputs: { answer: 'Approved' },
      }),
    ])
  })

  it('marks running nodes as stopped recursively', () => {
    const process = createWorkflowProcess()
    process.tracing = [
      createTrace({
        status: NodeRunningStatus.Running,
        details: [[createTrace({ status: NodeRunningStatus.Waiting })]],
      }),
    ]

    const stopped = applyWorkflowFinishedState(process, WorkflowRunningStatus.Stopped)
    markNodesStopped(stopped.tracing)

    expect(stopped.status).toBe(WorkflowRunningStatus.Stopped)
    expect(stopped.tracing[0]!.status).toBe(NodeRunningStatus.Stopped)
    expect(stopped.tracing[0]!.details?.[0]![0]!.status).toBe(NodeRunningStatus.Stopped)
  })
})

describe('createWorkflowStreamHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const setupHandlers = (overrides: { isPublicAPI?: boolean; isTimedOut?: () => boolean } = {}) => {
    let completionRes = ''
    let currentTaskId: string | null = null
    let isStopping = false
    let messageId: string | null = null
    let workflowProcessData: WorkflowProcess | undefined

    const setCurrentTaskId = vi.fn(
      (value: string | null | ((prev: string | null) => string | null)) => {
        currentTaskId = typeof value === 'function' ? value(currentTaskId) : value
      },
    )
    const setIsStopping = vi.fn((value: boolean | ((prev: boolean) => boolean)) => {
      isStopping = typeof value === 'function' ? value(isStopping) : value
    })
    const setMessageId = vi.fn(
      (value: string | null | ((prev: string | null) => string | null)) => {
        messageId = typeof value === 'function' ? value(messageId) : value
      },
    )
    const setWorkflowProcessData = vi.fn((value: WorkflowProcess | undefined) => {
      workflowProcessData = value
    })
    const setCompletionRes = vi.fn((value: string) => {
      completionRes = value
    })
    const notify = vi.fn()
    const onCompleted = vi.fn()
    const resetRunState = vi.fn()
    const setRespondingFalse = vi.fn()
    const markEnded = vi.fn()

    const handlers = createWorkflowStreamHandlers({
      getCompletionRes: () => completionRes,
      getWorkflowProcessData: () => workflowProcessData,
      isPublicAPI: overrides.isPublicAPI ?? false,
      isTimedOut: overrides.isTimedOut ?? (() => false),
      markEnded,
      notify,
      onCompleted,
      resetRunState,
      setCompletionRes,
      setCurrentTaskId,
      setIsStopping,
      setMessageId,
      setRespondingFalse,
      setWorkflowProcessData,
      t: withSelectorKey((key: string) => key),
      taskId: 3,
    })

    return {
      currentTaskId: () => currentTaskId,
      handlers,
      isStopping: () => isStopping,
      messageId: () => messageId,
      notify,
      onCompleted,
      resetRunState,
      setCompletionRes,
      setCurrentTaskId,
      setMessageId,
      setRespondingFalse,
      workflowProcessData: () => workflowProcessData,
    }
  }

  it('should process workflow success and paused events', () => {
    const setup = setupHandlers({ isPublicAPI: true })
    const handlers = setup.handlers as Required<
      Pick<
        IOtherOptions,
        | 'onWorkflowStarted'
        | 'onTextChunk'
        | 'onHumanInputRequired'
        | 'onHumanInputFormFilled'
        | 'onHumanInputFormTimeout'
        | 'onWorkflowPaused'
        | 'onWorkflowFinished'
        | 'onNodeStarted'
        | 'onNodeFinished'
        | 'onIterationStart'
        | 'onIterationNext'
        | 'onIterationFinish'
        | 'onLoopStart'
        | 'onLoopNext'
        | 'onLoopFinish'
      >
    >

    act(() => {
      handlers.onWorkflowStarted({
        workflow_run_id: 'run-1',
        task_id: 'task-1',
        event: 'workflow_started',
        data: { id: 'run-1', workflow_id: 'wf-1', created_at: 0 },
      })
      handlers.onNodeStarted({
        task_id: 'task-1',
        workflow_run_id: 'run-1',
        event: 'node_started',
        data: createTrace({ node_id: 'node-1' }),
      })
      handlers.onNodeFinished({
        task_id: 'task-1',
        workflow_run_id: 'run-1',
        event: 'node_finished',
        data: createTrace({ node_id: 'node-1', error: '' }),
      })
      handlers.onIterationStart({
        task_id: 'task-1',
        workflow_run_id: 'run-1',
        event: 'iteration_start',
        data: createTrace({
          node_id: 'iter-1',
          execution_metadata: { parallel_id: 'parallel-1' },
          details: [[]],
        }),
      })
      handlers.onIterationNext({
        task_id: 'task-1',
        workflow_run_id: 'run-1',
        event: 'iteration_next',
        data: createTrace({
          node_id: 'iter-1',
          execution_metadata: { parallel_id: 'parallel-1' },
          details: [[]],
        }),
      })
      handlers.onIterationFinish({
        task_id: 'task-1',
        workflow_run_id: 'run-1',
        event: 'iteration_finish',
        data: createTrace({
          node_id: 'iter-1',
          execution_metadata: { parallel_id: 'parallel-1' },
        }),
      })
      handlers.onLoopStart({
        task_id: 'task-1',
        workflow_run_id: 'run-1',
        event: 'loop_start',
        data: createTrace({
          node_id: 'loop-1',
          execution_metadata: { parallel_id: 'parallel-2' },
          details: [[]],
        }),
      })
      handlers.onLoopNext({
        task_id: 'task-1',
        workflow_run_id: 'run-1',
        event: 'loop_next',
        data: createTrace({
          node_id: 'loop-1',
          execution_metadata: { parallel_id: 'parallel-2' },
          details: [[]],
        }),
      })
      handlers.onLoopFinish({
        task_id: 'task-1',
        workflow_run_id: 'run-1',
        event: 'loop_finish',
        data: createTrace({
          node_id: 'loop-1',
          execution_metadata: { parallel_id: 'parallel-2' },
        }),
      })
      handlers.onTextChunk({
        task_id: 'task-1',
        workflow_run_id: 'run-1',
        event: 'text_chunk',
        data: { text: 'Hello' },
      })
      handlers.onHumanInputRequired({
        task_id: 'task-1',
        workflow_run_id: 'run-1',
        event: 'human_input_required',
        data: createHumanInput({ node_id: 'node-1' }),
      })
      handlers.onHumanInputFormFilled({
        task_id: 'task-1',
        workflow_run_id: 'run-1',
        event: 'human_input_form_filled',
        data: {
          node_id: 'node-1',
          node_title: 'Node',
          rendered_content: 'Done',
          action_id: 'action-1',
          action_text: 'Submit',
        },
      })
      handlers.onHumanInputFormTimeout({
        task_id: 'task-1',
        workflow_run_id: 'run-1',
        event: 'human_input_form_timeout',
        data: {
          node_id: 'node-1',
          node_title: 'Node',
          expiration_time: 200,
        },
      })
      handlers.onWorkflowPaused({
        task_id: 'task-1',
        workflow_run_id: 'run-1',
        event: 'workflow_paused',
        data: {
          outputs: {},
          paused_nodes: [],
          reasons: [],
          workflow_run_id: 'run-1',
        },
      })
      handlers.onWorkflowPaused({
        task_id: 'task-1',
        workflow_run_id: 'run-1',
        event: 'workflow_paused',
        data: {
          outputs: {},
          paused_nodes: [],
          reasons: [],
          workflow_run_id: 'run-1',
        },
      })
      handlers.onWorkflowFinished({
        task_id: 'task-1',
        workflow_run_id: 'run-1',
        event: 'workflow_finished',
        data: {
          id: 'run-1',
          workflow_id: 'wf-1',
          status: WorkflowRunningStatus.Succeeded,
          outputs: { answer: 'Hello' },
          error: '',
          elapsed_time: 0,
          total_tokens: 0,
          total_steps: 0,
          created_at: 0,
          created_by: {
            id: 'user-1',
            name: 'User',
            email: 'user@example.com',
          },
          finished_at: 0,
        },
      })
    })

    expect(setup.currentTaskId()).toBe('task-1')
    expect(setup.isStopping()).toBe(false)
    expect(setup.workflowProcessData()).toEqual(
      expect.objectContaining({
        resultText: 'Hello',
        status: WorkflowRunningStatus.Succeeded,
      }),
    )
    expect(sseGetMock).toHaveBeenCalledWith(
      '/workflow/run-1/events?include_state_snapshot=true&continue_on_pause=true',
      {},
      expect.objectContaining({ isPublicAPI: true }),
    )
    expect(sseGetMock).toHaveBeenCalledTimes(1)
    expect(setup.messageId()).toBe('run-1')
    expect(setup.onCompleted).toHaveBeenCalledWith('{"answer":"Hello"}', 3, true)
    expect(setup.setRespondingFalse).toHaveBeenCalled()
    expect(setup.resetRunState).toHaveBeenCalled()
  })

  it('should keep one resumable stream for installed apps', () => {
    const { handlers } = setupHandlers({ isPublicAPI: false })
    const onWorkflowPaused = handlers.onWorkflowPaused!
    const pausedEvent = {
      data: {
        workflow_run_id: 'run-installed',
      },
    } as never

    onWorkflowPaused(pausedEvent)
    onWorkflowPaused(pausedEvent)

    expect(sseGetMock).toHaveBeenCalledWith(
      '/workflow/run-installed/events?include_state_snapshot=true&continue_on_pause=true',
      {},
      expect.objectContaining({ isPublicAPI: false }),
    )
    expect(sseGetMock).toHaveBeenCalledTimes(1)
  })

  it('should finish timed-out workflow state and warn without applying late outputs', () => {
    const timeoutSetup = setupHandlers({
      isTimedOut: () => true,
    })
    const timeoutHandlers = timeoutSetup.handlers as Required<
      Pick<IOtherOptions, 'onWorkflowFinished'>
    >

    act(() => {
      timeoutHandlers.onWorkflowFinished({
        task_id: 'task-1',
        workflow_run_id: 'run-1',
        event: 'workflow_finished',
        data: {
          id: 'run-1',
          workflow_id: 'wf-1',
          status: WorkflowRunningStatus.Succeeded,
          outputs: { answer: 'Late result' },
          error: '',
          elapsed_time: 0,
          total_tokens: 0,
          total_steps: 0,
          created_at: 0,
          created_by: {
            id: 'user-1',
            name: 'User',
            email: 'user@example.com',
          },
          finished_at: 0,
        },
      })
    })

    expect(timeoutSetup.notify).toHaveBeenCalledWith({
      type: 'warning',
      message: 'warningMessage.timeoutExceeded',
    })
    expect(timeoutSetup.workflowProcessData()).toEqual(
      expect.objectContaining({
        resultText: '',
        status: WorkflowRunningStatus.Succeeded,
      }),
    )
    expect(timeoutSetup.onCompleted).not.toHaveBeenCalled()
    expect(timeoutSetup.setRespondingFalse).not.toHaveBeenCalled()
    expect(timeoutSetup.resetRunState).not.toHaveBeenCalled()
  })

  it('should handle workflow failures', () => {
    const failureSetup = setupHandlers()
    const failureHandlers = failureSetup.handlers as Required<
      Pick<IOtherOptions, 'onWorkflowStarted' | 'onWorkflowFinished'>
    >

    act(() => {
      failureHandlers.onWorkflowStarted({
        workflow_run_id: 'run-2',
        task_id: 'task-2',
        event: 'workflow_started',
        data: { id: 'run-2', workflow_id: 'wf-2', created_at: 0 },
      })
      failureHandlers.onWorkflowFinished({
        task_id: 'task-2',
        workflow_run_id: 'run-2',
        event: 'workflow_finished',
        data: {
          id: 'run-2',
          workflow_id: 'wf-2',
          status: WorkflowRunningStatus.Failed,
          outputs: null,
          error: 'failed',
          elapsed_time: 0,
          total_tokens: 0,
          total_steps: 0,
          created_at: 0,
          created_by: {
            id: 'user-1',
            name: 'User',
            email: 'user@example.com',
          },
          finished_at: 0,
        },
      })
    })

    expect(failureSetup.notify).toHaveBeenCalledWith({
      type: 'error',
      message: 'failed',
    })
    expect(failureSetup.onCompleted).toHaveBeenCalledWith('', 3, false)
    expect(failureSetup.workflowProcessData()).toEqual(
      expect.objectContaining({
        status: WorkflowRunningStatus.Failed,
        error: 'failed',
      }),
    )
  })

  it('should cover existing workflow starts, stopped runs, and non-string outputs', () => {
    const setup = setupHandlers()
    let existingProcess: WorkflowProcess = {
      status: WorkflowRunningStatus.Paused,
      tracing: [
        createTrace({
          node_id: 'existing-node',
          status: NodeRunningStatus.Waiting,
        }),
      ],
      expand: false,
      resultText: '',
    }

    const handlers = createWorkflowStreamHandlers({
      getCompletionRes: () => '',
      getWorkflowProcessData: () => existingProcess,
      isPublicAPI: false,
      isTimedOut: () => false,
      markEnded: vi.fn(),
      notify: setup.notify,
      onCompleted: setup.onCompleted,
      resetRunState: setup.resetRunState,
      setCompletionRes: setup.setCompletionRes,
      setCurrentTaskId: setup.setCurrentTaskId,
      setIsStopping: vi.fn(),
      setMessageId: setup.setMessageId,
      setRespondingFalse: setup.setRespondingFalse,
      setWorkflowProcessData: (value) => {
        existingProcess = value!
      },
      t: withSelectorKey((key: string) => key),
      taskId: 5,
    }) as Required<
      Pick<IOtherOptions, 'onWorkflowStarted' | 'onWorkflowFinished' | 'onTextReplace'>
    >

    act(() => {
      handlers.onWorkflowStarted({
        workflow_run_id: 'run-existing',
        task_id: '',
        event: 'workflow_started',
        data: { id: 'run-existing', workflow_id: 'wf-1', created_at: 0 },
      })
      handlers.onTextReplace({
        task_id: 'task-existing',
        workflow_run_id: 'run-existing',
        event: 'text_replace',
        data: { text: 'Replaced text' },
      })
    })

    expect(existingProcess).toEqual(
      expect.objectContaining({
        expand: true,
        status: WorkflowRunningStatus.Running,
        resultText: 'Replaced text',
      }),
    )

    act(() => {
      handlers.onWorkflowFinished({
        task_id: 'task-existing',
        workflow_run_id: 'run-existing',
        event: 'workflow_finished',
        data: {
          id: 'run-existing',
          workflow_id: 'wf-1',
          status: WorkflowRunningStatus.Stopped,
          outputs: null,
          error: '',
          elapsed_time: 0,
          total_tokens: 0,
          total_steps: 0,
          created_at: 0,
          created_by: {
            id: 'user-1',
            name: 'User',
            email: 'user@example.com',
          },
          finished_at: 0,
        },
      })
    })

    expect(existingProcess.status).toBe(WorkflowRunningStatus.Stopped)
    expect(existingProcess.tracing[0]!.status).toBe(NodeRunningStatus.Stopped)
    expect(setup.onCompleted).toHaveBeenCalledWith('', 5, false)

    const noOutputSetup = setupHandlers()
    const noOutputHandlers = noOutputSetup.handlers as Required<
      Pick<IOtherOptions, 'onWorkflowStarted' | 'onWorkflowFinished' | 'onTextReplace'>
    >

    act(() => {
      noOutputHandlers.onWorkflowStarted({
        workflow_run_id: 'run-no-output',
        task_id: '',
        event: 'workflow_started',
        data: { id: 'run-no-output', workflow_id: 'wf-2', created_at: 0 },
      })
      noOutputHandlers.onTextReplace({
        task_id: 'task-no-output',
        workflow_run_id: 'run-no-output',
        event: 'text_replace',
        data: { text: 'Draft' },
      })
      noOutputHandlers.onWorkflowFinished({
        task_id: 'task-no-output',
        workflow_run_id: 'run-no-output',
        event: 'workflow_finished',
        data: {
          id: 'run-no-output',
          workflow_id: 'wf-2',
          status: WorkflowRunningStatus.Succeeded,
          outputs: null,
          error: '',
          elapsed_time: 0,
          total_tokens: 0,
          total_steps: 0,
          created_at: 0,
          created_by: {
            id: 'user-1',
            name: 'User',
            email: 'user@example.com',
          },
          finished_at: 0,
        },
      })
    })

    expect(noOutputSetup.setCompletionRes).toHaveBeenCalledWith('')

    const objectOutputSetup = setupHandlers()
    const objectOutputHandlers = objectOutputSetup.handlers as Required<
      Pick<IOtherOptions, 'onWorkflowStarted' | 'onWorkflowFinished'>
    >

    act(() => {
      objectOutputHandlers.onWorkflowStarted({
        workflow_run_id: 'run-object',
        task_id: undefined as unknown as string,
        event: 'workflow_started',
        data: { id: 'run-object', workflow_id: 'wf-3', created_at: 0 },
      })
      objectOutputHandlers.onWorkflowFinished({
        task_id: 'task-object',
        workflow_run_id: 'run-object',
        event: 'workflow_finished',
        data: {
          id: 'run-object',
          workflow_id: 'wf-3',
          status: WorkflowRunningStatus.Succeeded,
          outputs: {
            answer: 'Hello',
            meta: {
              mode: 'object',
            },
          },
          error: '',
          elapsed_time: 0,
          total_tokens: 0,
          total_steps: 0,
          created_at: 0,
          created_by: {
            id: 'user-1',
            name: 'User',
            email: 'user@example.com',
          },
          finished_at: 0,
        },
      })
    })

    expect(objectOutputSetup.currentTaskId()).toBeNull()
    expect(objectOutputSetup.setCompletionRes).toHaveBeenCalledWith(
      '{"answer":"Hello","meta":{"mode":"object"}}',
    )
    expect(objectOutputSetup.workflowProcessData()).toEqual(
      expect.objectContaining({
        status: WorkflowRunningStatus.Succeeded,
        resultText: '',
      }),
    )
  })

  it('should serialize empty, string, and circular workflow outputs', () => {
    const noOutputSetup = setupHandlers()
    const noOutputHandlers = noOutputSetup.handlers as Required<
      Pick<IOtherOptions, 'onWorkflowFinished'>
    >

    act(() => {
      noOutputHandlers.onWorkflowFinished({
        task_id: 'task-empty',
        workflow_run_id: 'run-empty',
        event: 'workflow_finished',
        data: {
          id: 'run-empty',
          workflow_id: 'wf-empty',
          status: WorkflowRunningStatus.Succeeded,
          outputs: null,
          error: '',
          elapsed_time: 0,
          total_tokens: 0,
          total_steps: 0,
          created_at: 0,
          created_by: {
            id: 'user-1',
            name: 'User',
            email: 'user@example.com',
          },
          finished_at: 0,
        },
      })
    })

    expect(noOutputSetup.setCompletionRes).toHaveBeenCalledWith('')

    const stringOutputSetup = setupHandlers()
    const stringOutputHandlers = stringOutputSetup.handlers as Required<
      Pick<IOtherOptions, 'onWorkflowFinished'>
    >

    act(() => {
      stringOutputHandlers.onWorkflowFinished({
        task_id: 'task-string',
        workflow_run_id: 'run-string',
        event: 'workflow_finished',
        data: {
          id: 'run-string',
          workflow_id: 'wf-string',
          status: WorkflowRunningStatus.Succeeded,
          outputs: 'plain text output',
          error: '',
          elapsed_time: 0,
          total_tokens: 0,
          total_steps: 0,
          created_at: 0,
          created_by: {
            id: 'user-1',
            name: 'User',
            email: 'user@example.com',
          },
          finished_at: 0,
        },
      })
    })

    expect(stringOutputSetup.setCompletionRes).toHaveBeenCalledWith('plain text output')

    const circularOutputSetup = setupHandlers()
    const circularOutputHandlers = circularOutputSetup.handlers as Required<
      Pick<IOtherOptions, 'onWorkflowFinished'>
    >
    const circularOutputs: Record<string, unknown> = {
      answer: 'Hello',
    }
    circularOutputs.self = circularOutputs

    act(() => {
      circularOutputHandlers.onWorkflowFinished({
        task_id: 'task-circular',
        workflow_run_id: 'run-circular',
        event: 'workflow_finished',
        data: {
          id: 'run-circular',
          workflow_id: 'wf-circular',
          status: WorkflowRunningStatus.Succeeded,
          outputs: circularOutputs,
          error: '',
          elapsed_time: 0,
          total_tokens: 0,
          total_steps: 0,
          created_at: 0,
          created_by: {
            id: 'user-1',
            name: 'User',
            email: 'user@example.com',
          },
          finished_at: 0,
        },
      })
    })

    expect(circularOutputSetup.setCompletionRes).toHaveBeenCalledWith('[object Object]')
  })
})
