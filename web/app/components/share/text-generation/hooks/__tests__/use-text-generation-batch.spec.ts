import type { PromptConfig, PromptVariable } from '@/models/debug'
import { act, renderHook } from '@testing-library/react'
import { BATCH_CONCURRENCY } from '@/config'
import { TaskStatus } from '../../types'
import { useTextGenerationBatch } from '../use-text-generation-batch'

const createVariable = (overrides: Partial<PromptVariable>): PromptVariable => ({
  key: 'input',
  name: 'Input',
  type: 'string',
  required: true,
  ...overrides,
})

const createPromptConfig = (): PromptConfig => ({
  prompt_template: 'template',
  prompt_variables: [
    createVariable({ key: 'name', name: 'Name', type: 'string', required: true }),
    createVariable({ key: 'score', name: 'Score', type: 'number', required: false }),
  ],
})

const createTranslator = () => vi.fn((key: string) => key)

const renderBatchHook = (promptConfig: PromptConfig = createPromptConfig()) => {
  const notify = vi.fn()
  const onStart = vi.fn()
  const t = createTranslator()

  const hook = renderHook(() => useTextGenerationBatch({
    promptConfig,
    notify,
    t,
  }))

  return {
    ...hook,
    notify,
    onStart,
    t,
  }
}

describe('useTextGenerationBatch', () => {
  it('should initialize the first batch group when csv content is valid', () => {
    const { result, onStart } = renderBatchHook()
    const csvData = [
      ['Name', 'Score'],
      ...Array.from({ length: BATCH_CONCURRENCY + 1 }, (_, index) => [`Item ${index + 1}`, '']),
    ]

    let isStarted = false
    act(() => {
      isStarted = result.current.handleRunBatch(csvData, { onStart })
    })

    expect(isStarted).toBe(true)
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(result.current.isCallBatchAPI).toBe(true)
    expect(result.current.allTaskList).toHaveLength(BATCH_CONCURRENCY + 1)
    expect(result.current.allTaskList.slice(0, BATCH_CONCURRENCY).every(task => task.status === TaskStatus.running)).toBe(true)
    expect(result.current.allTaskList.at(-1)?.status).toBe(TaskStatus.pending)
    expect(result.current.allTaskList[0]?.params.inputs).toEqual({
      name: 'Item 1',
      score: undefined,
    })
  })

  it('should reject csv data when the header does not match prompt variables', () => {
    const { result, notify, onStart } = renderBatchHook()

    let isStarted = true
    act(() => {
      isStarted = result.current.handleRunBatch([
        ['Prompt', 'Score'],
        ['Hello', '1'],
      ], { onStart })
    })

    expect(isStarted).toBe(false)
    expect(onStart).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith({
      type: 'error',
      message: 'generation.errorMsg.fileStructNotMatch',
    })
    expect(result.current.allTaskList).toEqual([])
  })

  it('should reject empty batch inputs and rows without executable payload', () => {
    const { result, notify, onStart } = renderBatchHook()

    let isStarted = true
    act(() => {
      isStarted = result.current.handleRunBatch([], { onStart })
    })

    expect(isStarted).toBe(false)
    expect(notify).toHaveBeenLastCalledWith({
      type: 'error',
      message: 'generation.errorMsg.empty',
    })

    notify.mockClear()

    act(() => {
      isStarted = result.current.handleRunBatch([
        ['Name', 'Score'],
      ], { onStart })
    })

    expect(isStarted).toBe(false)
    expect(notify).toHaveBeenLastCalledWith({
      type: 'error',
      message: 'generation.errorMsg.atLeastOne',
    })

    notify.mockClear()

    act(() => {
      isStarted = result.current.handleRunBatch([
        ['Name', 'Score'],
        ['', ''],
      ], { onStart })
    })

    expect(isStarted).toBe(false)
    expect(notify).toHaveBeenLastCalledWith({
      type: 'error',
      message: 'generation.errorMsg.atLeastOne',
    })
  })

  it('should reject csv data when empty rows appear in the middle of the payload', () => {
    const { result, notify, onStart } = renderBatchHook()

    let isStarted = true
    act(() => {
      isStarted = result.current.handleRunBatch([
        ['Name', 'Score'],
        ['Alice', '1'],
        ['', ''],
        ['Bob', '2'],
        ['', ''],
        ['', ''],
      ], { onStart })
    })

    expect(isStarted).toBe(false)
    expect(notify).toHaveBeenCalledWith({
      type: 'error',
      message: 'generation.errorMsg.emptyLine',
    })
  })

  it('should reject rows with missing required values', () => {
    const { result, notify, onStart } = renderBatchHook()

    let isStarted = true
    act(() => {
      isStarted = result.current.handleRunBatch([
        ['Name', 'Score'],
        ['', '1'],
      ], { onStart })
    })

    expect(isStarted).toBe(false)
    expect(notify).toHaveBeenCalledWith({
      type: 'error',
      message: 'generation.errorMsg.invalidLine',
    })
  })

  it('should reject rows that exceed the configured max length', () => {
    const { result, notify, onStart } = renderBatchHook({
      prompt_template: 'template',
      prompt_variables: [
        createVariable({ key: 'name', name: 'Name', type: 'string', required: true, max_length: 3 }),
        createVariable({ key: 'score', name: 'Score', type: 'number', required: false }),
      ],
    })

    let isStarted = true
    act(() => {
      isStarted = result.current.handleRunBatch([
        ['Name', 'Score'],
        ['Alice', '1'],
      ], { onStart })
    })

    expect(isStarted).toBe(false)
    expect(notify).toHaveBeenCalledWith({
      type: 'error',
      message: 'generation.errorMsg.moreThanMaxLengthLine',
    })
  })

  it('should promote pending tasks after the current batch group completes', () => {
    const { result } = renderBatchHook()
    const csvData = [
      ['Name', 'Score'],
      ...Array.from({ length: BATCH_CONCURRENCY + 1 }, (_, index) => [`Item ${index + 1}`, `${index + 1}`]),
    ]

    act(() => {
      result.current.handleRunBatch(csvData, { onStart: vi.fn() })
    })

    act(() => {
      Array.from({ length: BATCH_CONCURRENCY }).forEach((_, index) => {
        result.current.handleCompleted(`Result ${index + 1}`, index + 1, true)
      })
    })

    expect(result.current.allTaskList.at(-1)?.status).toBe(TaskStatus.running)
    expect(result.current.exportRes.at(0)).toEqual({
      'Name': 'Item 1',
      'Score': '1',
      'generation.completionResult': 'Result 1',
    })
  })

  it('should block starting a new batch while previous tasks are still running', () => {
    const { result, notify, onStart } = renderBatchHook()
    const csvData = [
      ['Name', 'Score'],
      ...Array.from({ length: BATCH_CONCURRENCY + 1 }, (_, index) => [`Item ${index + 1}`, `${index + 1}`]),
    ]

    act(() => {
      result.current.handleRunBatch(csvData, { onStart })
    })

    notify.mockClear()

    let isStarted = true
    act(() => {
      isStarted = result.current.handleRunBatch(csvData, { onStart })
    })

    expect(isStarted).toBe(false)
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith({
      type: 'info',
      message: 'errorMessage.waitForBatchResponse',
    })
  })

  it('should ignore completion updates without a task id', () => {
    const { result } = renderBatchHook()

    act(() => {
      result.current.handleRunBatch([
        ['Name', 'Score'],
        ['Alice', '1'],
      ], { onStart: vi.fn() })
    })

    const taskSnapshot = result.current.allTaskList

    act(() => {
      result.current.handleCompleted('ignored')
    })

    expect(result.current.allTaskList).toEqual(taskSnapshot)
  })

  it('should expose failed tasks, retry signals, and reset state after batch failures', () => {
    const { result } = renderBatchHook()

    act(() => {
      result.current.handleRunBatch([
        ['Name', 'Score'],
        ['Alice', ''],
      ], { onStart: vi.fn() })
    })

    act(() => {
      result.current.handleCompleted('{"answer":"failed"}', 1, false)
    })

    expect(result.current.allFailedTaskList).toEqual([
      expect.objectContaining({
        id: 1,
        status: TaskStatus.failed,
      }),
    ])
    expect(result.current.allTasksFinished).toBe(false)
    expect(result.current.allTasksRun).toBe(true)
    expect(result.current.noPendingTask).toBe(true)
    expect(result.current.exportRes).toEqual([
      {
        'Name': 'Alice',
        'Score': '',
        'generation.completionResult': '{"answer":"failed"}',
      },
    ])

    act(() => {
      result.current.handleRetryAllFailedTask()
    })

    expect(result.current.controlRetry).toBeGreaterThan(0)

    act(() => {
      result.current.resetBatchExecution()
    })

    expect(result.current.allTaskList).toEqual([])
    expect(result.current.allFailedTaskList).toEqual([])
    expect(result.current.showTaskList).toEqual([])
    expect(result.current.exportRes).toEqual([])
    expect(result.current.noPendingTask).toBe(true)
  })
})
