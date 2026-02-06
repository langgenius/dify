import type { WorkflowCallbackDeps } from './workflow-callbacks'
import type { WorkflowProcess } from '@/app/components/base/chat/types'
import type { NodeTracing } from '@/types/workflow'
import { NodeRunningStatus, WorkflowRunningStatus } from '@/app/components/workflow/types'
import { createWorkflowCallbacks } from './workflow-callbacks'

vi.mock('@/app/components/base/file-uploader/utils', () => ({
  getFilesInLogs: vi.fn(() => [{ name: 'file.png' }]),
}))

// Factory for a minimal NodeTracing-like object
const createTrace = (overrides: Partial<NodeTracing> = {}): NodeTracing => ({
  id: 'trace-1',
  index: 0,
  predecessor_node_id: '',
  node_id: 'node-1',
  node_type: 'start',
  title: 'Node',
  status: NodeRunningStatus.Running,
  ...overrides,
} as NodeTracing)

// Factory for a base WorkflowProcess
const createProcess = (overrides: Partial<WorkflowProcess> = {}): WorkflowProcess => ({
  status: WorkflowRunningStatus.Running,
  tracing: [],
  expand: false,
  resultText: '',
  ...overrides,
})

// Factory for mock dependencies
function createMockDeps(overrides: Partial<WorkflowCallbackDeps> = {}): WorkflowCallbackDeps {
  const process = createProcess()
  return {
    getProcessData: vi.fn(() => process),
    setProcessData: vi.fn(),
    setCurrentTaskId: vi.fn(),
    setIsStopping: vi.fn(),
    getCompletionRes: vi.fn(() => ''),
    setCompletionRes: vi.fn(),
    setRespondingFalse: vi.fn(),
    resetRunState: vi.fn(),
    setMessageId: vi.fn(),
    isTimeoutRef: { current: false },
    isEndRef: { current: false },
    tempMessageIdRef: { current: '' },
    onCompleted: vi.fn(),
    notify: vi.fn(),
    t: vi.fn((key: string) => key) as unknown as WorkflowCallbackDeps['t'],
    requestData: { inputs: {} },
    ...overrides,
  }
}

describe('createWorkflowCallbacks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Workflow lifecycle start
  describe('onWorkflowStarted', () => {
    it('should initialize process data and set task id', () => {
      const deps = createMockDeps()
      const cb = createWorkflowCallbacks(deps)

      cb.onWorkflowStarted({ workflow_run_id: 'run-1', task_id: 'task-1' } as never)

      expect(deps.tempMessageIdRef.current).toBe('run-1')
      expect(deps.setCurrentTaskId).toHaveBeenCalledWith('task-1')
      expect(deps.setIsStopping).toHaveBeenCalledWith(false)
      expect(deps.setProcessData).toHaveBeenCalledWith(
        expect.objectContaining({ status: WorkflowRunningStatus.Running, tracing: [] }),
      )
    })

    it('should default task_id to null when not provided', () => {
      const deps = createMockDeps()
      const cb = createWorkflowCallbacks(deps)

      cb.onWorkflowStarted({ workflow_run_id: 'run-2' } as never)

      expect(deps.setCurrentTaskId).toHaveBeenCalledWith(null)
    })
  })

  // Shared group handlers (iteration & loop use the same logic)
  describe('group handlers (iteration/loop)', () => {
    it('onIterationStart should push a running trace', () => {
      const deps = createMockDeps()
      const cb = createWorkflowCallbacks(deps)
      const trace = createTrace({ node_id: 'iter-node' })

      cb.onIterationStart({ data: trace } as never)

      const produced = (deps.setProcessData as ReturnType<typeof vi.fn>).mock.calls[0][0] as WorkflowProcess
      expect(produced.expand).toBe(true)
      expect(produced.tracing).toHaveLength(1)
      expect(produced.tracing[0].node_id).toBe('iter-node')
      expect(produced.tracing[0].status).toBe(NodeRunningStatus.Running)
    })

    it('onLoopStart should behave identically to onIterationStart', () => {
      const deps = createMockDeps()
      const cb = createWorkflowCallbacks(deps)

      cb.onLoopStart({ data: createTrace({ node_id: 'loop-node' }) } as never)

      const produced = (deps.setProcessData as ReturnType<typeof vi.fn>).mock.calls[0][0] as WorkflowProcess
      expect(produced.tracing[0].node_id).toBe('loop-node')
    })

    it('onIterationFinish should replace trace entry', () => {
      const existing = createTrace({ node_id: 'n1', execution_metadata: { parallel_id: 'p1' } as NodeTracing['execution_metadata'] })
      const deps = createMockDeps({
        getProcessData: vi.fn(() => createProcess({ tracing: [existing] })),
      })
      const cb = createWorkflowCallbacks(deps)
      const updated = createTrace({ node_id: 'n1', execution_metadata: { parallel_id: 'p1' } as NodeTracing['execution_metadata'], error: 'fail' } as NodeTracing)

      cb.onIterationFinish({ data: updated } as never)

      const produced = (deps.setProcessData as ReturnType<typeof vi.fn>).mock.calls[0][0] as WorkflowProcess
      expect(produced.tracing[0].expand).toBe(true) // error -> expand
    })
  })

  // Node lifecycle
  describe('onNodeStarted', () => {
    it('should add a running trace for top-level nodes', () => {
      const deps = createMockDeps()
      const cb = createWorkflowCallbacks(deps)

      cb.onNodeStarted({ data: createTrace({ node_id: 'top-node' }) } as never)

      const produced = (deps.setProcessData as ReturnType<typeof vi.fn>).mock.calls[0][0] as WorkflowProcess
      expect(produced.tracing).toHaveLength(1)
    })

    it('should skip nodes inside an iteration', () => {
      const deps = createMockDeps()
      const cb = createWorkflowCallbacks(deps)

      cb.onNodeStarted({ data: createTrace({ iteration_id: 'iter-1' }) } as never)

      expect(deps.setProcessData).not.toHaveBeenCalled()
    })

    it('should skip nodes inside a loop', () => {
      const deps = createMockDeps()
      const cb = createWorkflowCallbacks(deps)

      cb.onNodeStarted({ data: createTrace({ loop_id: 'loop-1' }) } as never)

      expect(deps.setProcessData).not.toHaveBeenCalled()
    })
  })

  describe('onNodeFinished', () => {
    it('should update existing trace entry', () => {
      const trace = createTrace({ node_id: 'n1', execution_metadata: { parallel_id: 'p1' } as NodeTracing['execution_metadata'] })
      const deps = createMockDeps({
        getProcessData: vi.fn(() => createProcess({ tracing: [trace] })),
      })
      const cb = createWorkflowCallbacks(deps)
      const finished = createTrace({
        node_id: 'n1',
        execution_metadata: { parallel_id: 'p1' } as NodeTracing['execution_metadata'],
        status: NodeRunningStatus.Succeeded as NodeTracing['status'],
      })

      cb.onNodeFinished({ data: finished } as never)

      const produced = (deps.setProcessData as ReturnType<typeof vi.fn>).mock.calls[0][0] as WorkflowProcess
      expect(produced.tracing[0].status).toBe(NodeRunningStatus.Succeeded)
    })

    it('should skip nodes inside iteration or loop', () => {
      const deps = createMockDeps()
      const cb = createWorkflowCallbacks(deps)

      cb.onNodeFinished({ data: createTrace({ iteration_id: 'i1' }) } as never)
      cb.onNodeFinished({ data: createTrace({ loop_id: 'l1' }) } as never)

      expect(deps.setProcessData).not.toHaveBeenCalled()
    })
  })

  // Workflow completion
  describe('onWorkflowFinished', () => {
    it('should handle success with outputs', () => {
      const deps = createMockDeps({ taskId: 1 })
      const cb = createWorkflowCallbacks(deps)

      cb.onWorkflowFinished({
        data: { status: 'succeeded', outputs: { result: 'hello' } },
      } as never)

      expect(deps.setCompletionRes).toHaveBeenCalledWith({ result: 'hello' })
      expect(deps.setRespondingFalse).toHaveBeenCalled()
      expect(deps.resetRunState).toHaveBeenCalled()
      expect(deps.onCompleted).toHaveBeenCalledWith('', 1, true)
      expect(deps.isEndRef.current).toBe(true)
    })

    it('should handle success with single string output and set resultText', () => {
      const deps = createMockDeps()
      const cb = createWorkflowCallbacks(deps)

      cb.onWorkflowFinished({
        data: { status: 'succeeded', outputs: { text: 'response' } },
      } as never)

      // setProcessData called multiple times: succeeded status, then resultText
      expect(deps.setProcessData).toHaveBeenCalledTimes(2)
    })

    it('should handle success without outputs', () => {
      const deps = createMockDeps()
      const cb = createWorkflowCallbacks(deps)

      cb.onWorkflowFinished({
        data: { status: 'succeeded', outputs: null },
      } as never)

      expect(deps.setCompletionRes).toHaveBeenCalledWith('')
    })

    it('should handle stopped status', () => {
      const deps = createMockDeps()
      const cb = createWorkflowCallbacks(deps)

      cb.onWorkflowFinished({
        data: { status: WorkflowRunningStatus.Stopped },
      } as never)

      expect(deps.onCompleted).toHaveBeenCalledWith('', undefined, false)
      expect(deps.isEndRef.current).toBe(true)
    })

    it('should handle error status', () => {
      const deps = createMockDeps()
      const cb = createWorkflowCallbacks(deps)

      cb.onWorkflowFinished({
        data: { status: 'failed', error: 'Something broke' },
      } as never)

      expect(deps.notify).toHaveBeenCalledWith({ type: 'error', message: 'Something broke' })
      expect(deps.onCompleted).toHaveBeenCalledWith('', undefined, false)
    })

    it('should skip processing when timeout has already occurred', () => {
      const deps = createMockDeps()
      deps.isTimeoutRef.current = true
      const cb = createWorkflowCallbacks(deps)

      cb.onWorkflowFinished({
        data: { status: 'succeeded', outputs: { text: 'late' } },
      } as never)

      expect(deps.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'warning' }),
      )
      expect(deps.onCompleted).not.toHaveBeenCalled()
    })
  })

  // Streaming text handlers
  describe('text handlers', () => {
    it('onTextChunk should append text to resultText', () => {
      const deps = createMockDeps({
        getProcessData: vi.fn(() => createProcess({ resultText: 'hello' })),
      })
      const cb = createWorkflowCallbacks(deps)

      cb.onTextChunk({ data: { text: ' world' } } as never)

      const produced = (deps.setProcessData as ReturnType<typeof vi.fn>).mock.calls[0][0] as WorkflowProcess
      expect(produced.resultText).toBe('hello world')
    })

    it('onTextReplace should replace resultText entirely', () => {
      const deps = createMockDeps({
        getProcessData: vi.fn(() => createProcess({ resultText: 'old' })),
      })
      const cb = createWorkflowCallbacks(deps)

      cb.onTextReplace({ data: { text: 'new' } } as never)

      const produced = (deps.setProcessData as ReturnType<typeof vi.fn>).mock.calls[0][0] as WorkflowProcess
      expect(produced.resultText).toBe('new')
    })
  })
})
