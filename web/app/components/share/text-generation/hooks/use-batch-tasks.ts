import type { TFunction } from 'i18next'
import type { Task } from '../types'
import type { PromptConfig } from '@/models/debug'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Toast from '@/app/components/base/toast'
import { BATCH_CONCURRENCY } from '@/config'
import { TaskStatus } from '../types'

function validateBatchData(
  data: string[][],
  promptVariables: PromptConfig['prompt_variables'],
  t: TFunction,
): string | null {
  if (!data?.length)
    return t('generation.errorMsg.empty', { ns: 'share' })

  // Validate header matches prompt variables
  const header = data[0]
  if (promptVariables.some((v, i) => v.name !== header[i]))
    return t('generation.errorMsg.fileStructNotMatch', { ns: 'share' })

  const rows = data.slice(1)
  if (!rows.length)
    return t('generation.errorMsg.atLeastOne', { ns: 'share' })

  // Detect non-consecutive empty lines (empty rows in the middle of data)
  const emptyIndexes = rows
    .map((row, i) => row.every(c => c === '') ? i : -1)
    .filter(i => i >= 0)

  if (emptyIndexes.length > 0) {
    let prev = emptyIndexes[0] - 1
    for (const idx of emptyIndexes) {
      if (prev + 1 !== idx)
        return t('generation.errorMsg.emptyLine', { ns: 'share', rowIndex: prev + 2 })
      prev = idx
    }
  }

  // Remove trailing empty rows and re-check
  const nonEmptyRows = rows.filter(row => !row.every(c => c === ''))
  if (!nonEmptyRows.length)
    return t('generation.errorMsg.atLeastOne', { ns: 'share' })

  // Validate individual row values
  for (let r = 0; r < nonEmptyRows.length; r++) {
    const row = nonEmptyRows[r]
    for (let v = 0; v < promptVariables.length; v++) {
      const varItem = promptVariables[v]
      if (varItem.type === 'string' && varItem.max_length && row[v].length > varItem.max_length) {
        return t('generation.errorMsg.moreThanMaxLengthLine', {
          ns: 'share',
          rowIndex: r + 2,
          varName: varItem.name,
          maxLength: varItem.max_length,
        })
      }
      if (varItem.required && row[v].trim() === '') {
        return t('generation.errorMsg.invalidLine', {
          ns: 'share',
          rowIndex: r + 2,
          varName: varItem.name,
        })
      }
    }
  }

  return null
}

export function useBatchTasks(promptConfig: PromptConfig | null) {
  const { t } = useTranslation()

  const [isCallBatchAPI, setIsCallBatchAPI] = useState(false)
  const [controlRetry, setControlRetry] = useState(0)

  // Task list with ref for accessing latest value in async callbacks
  const [allTaskList, doSetAllTaskList] = useState<Task[]>([])
  const allTaskListRef = useRef<Task[]>([])
  const setAllTaskList = useCallback((tasks: Task[]) => {
    doSetAllTaskList(tasks)
    allTaskListRef.current = tasks
  }, [])

  // Batch completion results stored in ref (no re-render needed on each update)
  const batchCompletionResRef = useRef<Record<string, string>>({})
  const currGroupNumRef = useRef(0)

  // Derived task lists
  const pendingTaskList = allTaskList.filter(task => task.status === TaskStatus.pending)
  const noPendingTask = pendingTaskList.length === 0
  const showTaskList = allTaskList.filter(task => task.status !== TaskStatus.pending)
  const allSuccessTaskList = allTaskList.filter(task => task.status === TaskStatus.completed)
  const allFailedTaskList = allTaskList.filter(task => task.status === TaskStatus.failed)
  const allTasksFinished = allTaskList.every(task => task.status === TaskStatus.completed)
  const allTasksRun = allTaskList.every(task =>
    [TaskStatus.completed, TaskStatus.failed].includes(task.status),
  )

  // Export-ready results for CSV download
  const exportRes = allTaskList.map((task) => {
    const completionRes = batchCompletionResRef.current
    const res: Record<string, string> = {}
    const { inputs } = task.params
    promptConfig?.prompt_variables.forEach((v) => {
      res[v.name] = inputs[v.key] ?? ''
    })
    let result = completionRes[task.id]
    if (typeof result === 'object')
      result = JSON.stringify(result)
    res[t('generation.completionResult', { ns: 'share' })] = result
    return res
  })

  // Clear batch state (used when switching to single-run mode)
  const clearBatchState = useCallback(() => {
    setIsCallBatchAPI(false)
    setAllTaskList([])
  }, [setAllTaskList])

  // Attempt to start a batch run. Returns true on success, false on validation failure.
  const startBatchRun = useCallback((data: string[][]): boolean => {
    const error = validateBatchData(data, promptConfig?.prompt_variables ?? [], t)
    if (error) {
      Toast.notify({ type: 'error', message: error })
      return false
    }
    if (!allTasksFinished) {
      Toast.notify({ type: 'info', message: t('errorMessage.waitForBatchResponse', { ns: 'appDebug' }) })
      return false
    }

    const payloadData = data.filter(row => !row.every(c => c === '')).slice(1)
    const varLen = promptConfig?.prompt_variables.length ?? 0

    const tasks: Task[] = payloadData.map((item, i) => {
      const inputs: Record<string, string | undefined> = {}
      if (varLen > 0) {
        item.slice(0, varLen).forEach((input, index) => {
          const varSchema = promptConfig?.prompt_variables[index]
          const key = varSchema?.key as string
          if (!input)
            inputs[key] = (varSchema?.type === 'string' || varSchema?.type === 'paragraph') ? '' : undefined
          else
            inputs[key] = input
        })
      }
      return {
        id: i + 1,
        status: i < BATCH_CONCURRENCY ? TaskStatus.running : TaskStatus.pending,
        params: { inputs },
      }
    })

    setAllTaskList(tasks)
    currGroupNumRef.current = 0
    batchCompletionResRef.current = {}
    setIsCallBatchAPI(true)
    return true
  }, [allTasksFinished, promptConfig?.prompt_variables, setAllTaskList, t])

  // Callback invoked when a single task completes; manages group concurrency.
  const handleCompleted = useCallback((completionRes: string, taskId?: number, isSuccess?: boolean) => {
    const latestTasks = allTaskListRef.current
    const latestCompletionRes = batchCompletionResRef.current
    const pending = latestTasks.filter(task => task.status === TaskStatus.pending)
    const doneCount = 1 + latestTasks.filter(task =>
      [TaskStatus.completed, TaskStatus.failed].includes(task.status),
    ).length
    const shouldAddNextGroup
      = currGroupNumRef.current !== doneCount
        && pending.length > 0
        && (doneCount % BATCH_CONCURRENCY === 0 || latestTasks.length - doneCount < BATCH_CONCURRENCY)

    if (shouldAddNextGroup)
      currGroupNumRef.current = doneCount

    const nextPendingIds = shouldAddNextGroup
      ? pending.slice(0, BATCH_CONCURRENCY).map(t => t.id)
      : []

    const updatedTasks = latestTasks.map((item) => {
      if (item.id === taskId)
        return { ...item, status: isSuccess ? TaskStatus.completed : TaskStatus.failed }
      if (shouldAddNextGroup && nextPendingIds.includes(item.id))
        return { ...item, status: TaskStatus.running }
      return item
    })

    setAllTaskList(updatedTasks)
    if (taskId) {
      batchCompletionResRef.current = {
        ...latestCompletionRes,
        [`${taskId}`]: completionRes,
      }
    }
  }, [setAllTaskList])

  const handleRetryAllFailedTask = useCallback(() => {
    setControlRetry(Date.now())
  }, [])

  return {
    isCallBatchAPI,
    controlRetry,
    allTaskList,
    showTaskList,
    noPendingTask,
    allSuccessTaskList,
    allFailedTaskList,
    allTasksRun,
    exportRes,
    clearBatchState,
    startBatchRun,
    handleCompleted,
    handleRetryAllFailedTask,
  }
}
