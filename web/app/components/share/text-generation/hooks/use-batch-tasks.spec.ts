import type { PromptConfig } from '@/models/debug'
import { act, renderHook } from '@testing-library/react'
import { TaskStatus } from '../types'
import { useBatchTasks } from './use-batch-tasks'

vi.mock('@/app/components/base/toast', () => ({
  default: { notify: vi.fn() },
}))

const createPromptConfig = (overrides?: Partial<PromptConfig>): PromptConfig => ({
  prompt_template: '',
  prompt_variables: [
    { key: 'name', name: 'Name', type: 'string', required: true, max_length: 100 },
    { key: 'age', name: 'Age', type: 'string', required: false, max_length: 10 },
  ] as PromptConfig['prompt_variables'],
  ...overrides,
})

// Build a valid CSV data matrix: [header, ...rows]
const buildCsvData = (rows: string[][]): string[][] => [
  ['Name', 'Age'],
  ...rows,
]

describe('useBatchTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Initial state
  describe('Initial state', () => {
    it('should start with empty task list and batch mode off', () => {
      const { result } = renderHook(() => useBatchTasks(createPromptConfig()))

      expect(result.current.isCallBatchAPI).toBe(false)
      expect(result.current.allTaskList).toEqual([])
      expect(result.current.noPendingTask).toBe(true)
      expect(result.current.allTasksRun).toBe(true)
    })
  })

  // Batch validation via startBatchRun
  describe('startBatchRun validation', () => {
    it('should reject empty data', () => {
      const { result } = renderHook(() => useBatchTasks(createPromptConfig()))

      let ok = false
      act(() => {
        ok = result.current.startBatchRun([])
      })

      expect(ok).toBe(false)
      expect(result.current.isCallBatchAPI).toBe(false)
    })

    it('should reject data with mismatched header', () => {
      const { result } = renderHook(() => useBatchTasks(createPromptConfig()))
      const data = [['Wrong', 'Header'], ['a', 'b']]

      let ok = false
      act(() => {
        ok = result.current.startBatchRun(data)
      })

      expect(ok).toBe(false)
    })

    it('should reject data with no payload rows (header only)', () => {
      const { result } = renderHook(() => useBatchTasks(createPromptConfig()))
      const data = [['Name', 'Age']]

      let ok = false
      act(() => {
        ok = result.current.startBatchRun(data)
      })

      expect(ok).toBe(false)
    })

    it('should reject when required field is empty', () => {
      const { result } = renderHook(() => useBatchTasks(createPromptConfig()))
      const data = buildCsvData([['', '25']])

      let ok = false
      act(() => {
        ok = result.current.startBatchRun(data)
      })

      expect(ok).toBe(false)
    })

    it('should reject when required field exceeds max_length', () => {
      const { result } = renderHook(() => useBatchTasks(createPromptConfig()))
      const longName = 'a'.repeat(101)
      const data = buildCsvData([[longName, '25']])

      let ok = false
      act(() => {
        ok = result.current.startBatchRun(data)
      })

      expect(ok).toBe(false)
    })
  })

  // Successful batch run
  describe('startBatchRun success', () => {
    it('should create tasks and enable batch mode', () => {
      const { result } = renderHook(() => useBatchTasks(createPromptConfig()))
      const data = buildCsvData([['Alice', '30'], ['Bob', '25']])

      let ok = false
      act(() => {
        ok = result.current.startBatchRun(data)
      })

      expect(ok).toBe(true)
      expect(result.current.isCallBatchAPI).toBe(true)
      expect(result.current.allTaskList).toHaveLength(2)
      expect(result.current.allTaskList[0].params.inputs.name).toBe('Alice')
      expect(result.current.allTaskList[1].params.inputs.name).toBe('Bob')
    })

    it('should set first tasks to running status (limited by BATCH_CONCURRENCY)', () => {
      const { result } = renderHook(() => useBatchTasks(createPromptConfig()))
      const data = buildCsvData([['Alice', '30'], ['Bob', '25']])

      act(() => {
        result.current.startBatchRun(data)
      })

      // Both should be running since 2 < BATCH_CONCURRENCY (5)
      expect(result.current.allTaskList[0].status).toBe(TaskStatus.running)
      expect(result.current.allTaskList[1].status).toBe(TaskStatus.running)
    })

    it('should set excess tasks to pending when exceeding BATCH_CONCURRENCY', () => {
      const { result } = renderHook(() => useBatchTasks(createPromptConfig()))
      // Create 7 tasks (BATCH_CONCURRENCY=5, so 2 should be pending)
      const rows = Array.from({ length: 7 }, (_, i) => [`User${i}`, `${20 + i}`])
      const data = buildCsvData(rows)

      act(() => {
        result.current.startBatchRun(data)
      })

      const running = result.current.allTaskList.filter(t => t.status === TaskStatus.running)
      const pending = result.current.allTaskList.filter(t => t.status === TaskStatus.pending)
      expect(running).toHaveLength(5)
      expect(pending).toHaveLength(2)
    })
  })

  // Task completion handling
  describe('handleCompleted', () => {
    it('should mark task as completed on success', () => {
      const { result } = renderHook(() => useBatchTasks(createPromptConfig()))
      act(() => {
        result.current.startBatchRun(buildCsvData([['Alice', '30']]))
      })

      act(() => {
        result.current.handleCompleted('result text', 1, true)
      })

      expect(result.current.allTaskList[0].status).toBe(TaskStatus.completed)
    })

    it('should mark task as failed on failure', () => {
      const { result } = renderHook(() => useBatchTasks(createPromptConfig()))
      act(() => {
        result.current.startBatchRun(buildCsvData([['Alice', '30']]))
      })

      act(() => {
        result.current.handleCompleted('', 1, false)
      })

      expect(result.current.allTaskList[0].status).toBe(TaskStatus.failed)
      expect(result.current.allFailedTaskList).toHaveLength(1)
    })

    it('should promote pending tasks to running when group completes', () => {
      const { result } = renderHook(() => useBatchTasks(createPromptConfig()))
      // 7 tasks: first 5 running, last 2 pending
      const rows = Array.from({ length: 7 }, (_, i) => [`User${i}`, `${20 + i}`])
      act(() => {
        result.current.startBatchRun(buildCsvData(rows))
      })

      // Complete all 5 running tasks
      for (let i = 1; i <= 5; i++) {
        act(() => {
          result.current.handleCompleted(`res${i}`, i, true)
        })
      }

      // Tasks 6 and 7 should now be running
      expect(result.current.allTaskList[5].status).toBe(TaskStatus.running)
      expect(result.current.allTaskList[6].status).toBe(TaskStatus.running)
    })
  })

  // Derived task lists
  describe('Derived lists', () => {
    it('should compute showTaskList excluding pending tasks', () => {
      const { result } = renderHook(() => useBatchTasks(createPromptConfig()))
      const rows = Array.from({ length: 7 }, (_, i) => [`User${i}`, `${i}`])
      act(() => {
        result.current.startBatchRun(buildCsvData(rows))
      })

      expect(result.current.showTaskList).toHaveLength(5) // 5 running
      expect(result.current.noPendingTask).toBe(false)
    })

    it('should compute allTasksRun when all tasks completed or failed', () => {
      const { result } = renderHook(() => useBatchTasks(createPromptConfig()))
      act(() => {
        result.current.startBatchRun(buildCsvData([['Alice', '30'], ['Bob', '25']]))
      })

      expect(result.current.allTasksRun).toBe(false)

      act(() => {
        result.current.handleCompleted('res1', 1, true)
      })
      act(() => {
        result.current.handleCompleted('', 2, false)
      })

      expect(result.current.allTasksRun).toBe(true)
      expect(result.current.allSuccessTaskList).toHaveLength(1)
      expect(result.current.allFailedTaskList).toHaveLength(1)
    })
  })

  // Clear state
  describe('clearBatchState', () => {
    it('should reset batch mode and task list', () => {
      const { result } = renderHook(() => useBatchTasks(createPromptConfig()))
      act(() => {
        result.current.startBatchRun(buildCsvData([['Alice', '30']]))
      })
      expect(result.current.isCallBatchAPI).toBe(true)

      act(() => {
        result.current.clearBatchState()
      })

      expect(result.current.isCallBatchAPI).toBe(false)
      expect(result.current.allTaskList).toEqual([])
    })
  })

  // Export results
  describe('exportRes', () => {
    it('should format export data with variable names as keys', () => {
      const { result } = renderHook(() => useBatchTasks(createPromptConfig()))
      act(() => {
        result.current.startBatchRun(buildCsvData([['Alice', '30']]))
      })
      act(() => {
        result.current.handleCompleted('Generated text', 1, true)
      })

      const exported = result.current.exportRes
      expect(exported).toHaveLength(1)
      expect(exported[0].Name).toBe('Alice')
      expect(exported[0].Age).toBe('30')
    })

    it('should use empty string for missing optional inputs', () => {
      const { result } = renderHook(() => useBatchTasks(createPromptConfig()))
      act(() => {
        result.current.startBatchRun(buildCsvData([['Alice', '']]))
      })
      act(() => {
        result.current.handleCompleted('res', 1, true)
      })

      expect(result.current.exportRes[0].Age).toBe('')
    })
  })

  // Retry failed tasks
  describe('handleRetryAllFailedTask', () => {
    it('should update controlRetry timestamp', () => {
      const { result } = renderHook(() => useBatchTasks(createPromptConfig()))
      const before = result.current.controlRetry

      act(() => {
        result.current.handleRetryAllFailedTask()
      })

      expect(result.current.controlRetry).toBeGreaterThan(before)
    })
  })
})
