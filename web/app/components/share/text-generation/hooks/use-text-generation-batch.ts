import type { Task } from '../types'
import type { PromptConfig } from '@/models/debug'
import { useCallback, useMemo, useRef, useState } from 'react'
import { BATCH_CONCURRENCY } from '@/config'
import { TaskStatus } from '../types'

type BatchNotify = (payload: { type: 'error' | 'info', message: string }) => void
type BatchTranslate = (key: string, options?: Record<string, unknown>) => string

type UseTextGenerationBatchOptions = {
  promptConfig: PromptConfig | null
  notify: BatchNotify
  t: BatchTranslate
}

type RunBatchCallbacks = {
  onStart: () => void
}

const GROUP_SIZE = BATCH_CONCURRENCY

export const useTextGenerationBatch = ({
  promptConfig,
  notify,
  t,
}: UseTextGenerationBatchOptions) => {
  const [isCallBatchAPI, setIsCallBatchAPI] = useState(false)
  const [controlRetry, setControlRetry] = useState(0)
  const [allTaskList, setAllTaskList] = useState<Task[]>([])
  const [batchCompletionMap, setBatchCompletionMap] = useState<Record<string, string>>({})
  const allTaskListRef = useRef<Task[]>([])
  const currGroupNumRef = useRef(0)
  const batchCompletionResRef = useRef<Record<string, string>>({})

  const updateAllTaskList = useCallback((taskList: Task[]) => {
    setAllTaskList(taskList)
    allTaskListRef.current = taskList
  }, [])

  const updateBatchCompletionRes = useCallback((res: Record<string, string>) => {
    batchCompletionResRef.current = res
    setBatchCompletionMap(res)
  }, [])

  const resetBatchExecution = useCallback(() => {
    updateAllTaskList([])
    updateBatchCompletionRes({})
    currGroupNumRef.current = 0
  }, [updateAllTaskList, updateBatchCompletionRes])

  const checkBatchInputs = useCallback((data: string[][]) => {
    if (!data || data.length === 0) {
      notify({ type: 'error', message: t('generation.errorMsg.empty', { ns: 'share' }) })
      return false
    }

    const promptVariables = promptConfig?.prompt_variables ?? []
    const headerData = data[0]
    let isMapVarName = true
    promptVariables.forEach((item, index) => {
      if (!isMapVarName)
        return

      if (item.name !== headerData[index])
        isMapVarName = false
    })

    if (!isMapVarName) {
      notify({ type: 'error', message: t('generation.errorMsg.fileStructNotMatch', { ns: 'share' }) })
      return false
    }

    let payloadData = data.slice(1)
    if (payloadData.length === 0) {
      notify({ type: 'error', message: t('generation.errorMsg.atLeastOne', { ns: 'share' }) })
      return false
    }

    const emptyLineIndexes = payloadData
      .filter(item => item.every(value => value === ''))
      .map(item => payloadData.indexOf(item))
    if (emptyLineIndexes.length > 0) {
      let hasMiddleEmptyLine = false
      let startIndex = emptyLineIndexes[0] - 1
      emptyLineIndexes.forEach((index) => {
        if (hasMiddleEmptyLine)
          return
        if (startIndex + 1 !== index) {
          hasMiddleEmptyLine = true
          return
        }
        startIndex += 1
      })

      if (hasMiddleEmptyLine) {
        notify({ type: 'error', message: t('generation.errorMsg.emptyLine', { ns: 'share', rowIndex: startIndex + 2 }) })
        return false
      }
    }

    payloadData = payloadData.filter(item => !item.every(value => value === ''))
    if (payloadData.length === 0) {
      notify({ type: 'error', message: t('generation.errorMsg.atLeastOne', { ns: 'share' }) })
      return false
    }

    let errorRowIndex = 0
    let requiredVarName = ''
    let tooLongVarName = ''
    let maxLength = 0

    for (const [index, item] of payloadData.entries()) {
      for (const [varIndex, varItem] of promptVariables.entries()) {
        const value = item[varIndex] ?? ''

        if (varItem.type === 'string' && varItem.max_length && value.length > varItem.max_length) {
          tooLongVarName = varItem.name
          maxLength = varItem.max_length
          errorRowIndex = index + 1
          break
        }

        if (varItem.required && value.trim() === '') {
          requiredVarName = varItem.name
          errorRowIndex = index + 1
          break
        }
      }

      if (errorRowIndex !== 0)
        break
    }

    if (errorRowIndex !== 0) {
      if (requiredVarName) {
        notify({
          type: 'error',
          message: t('generation.errorMsg.invalidLine', { ns: 'share', rowIndex: errorRowIndex + 1, varName: requiredVarName }),
        })
      }

      if (tooLongVarName) {
        notify({
          type: 'error',
          message: t('generation.errorMsg.moreThanMaxLengthLine', {
            ns: 'share',
            rowIndex: errorRowIndex + 1,
            varName: tooLongVarName,
            maxLength,
          }),
        })
      }

      return false
    }

    return true
  }, [notify, promptConfig, t])

  const handleRunBatch = useCallback((data: string[][], { onStart }: RunBatchCallbacks) => {
    if (!checkBatchInputs(data))
      return false

    const latestTaskList = allTaskListRef.current
    const allTasksFinished = latestTaskList.every(task => task.status === TaskStatus.completed)
    if (!allTasksFinished && latestTaskList.length > 0) {
      notify({ type: 'info', message: t('errorMessage.waitForBatchResponse', { ns: 'appDebug' }) })
      return false
    }

    const payloadData = data.filter(item => !item.every(value => value === '')).slice(1)
    const promptVariables = promptConfig?.prompt_variables ?? []
    const nextTaskList: Task[] = payloadData.map((item, index) => {
      const inputs: Record<string, string | boolean | undefined> = {}
      promptVariables.forEach((variable, varIndex) => {
        const input = item[varIndex]
        inputs[variable.key] = input
        if (!input)
          inputs[variable.key] = variable.type === 'string' || variable.type === 'paragraph' ? '' : undefined
      })

      return {
        id: index + 1,
        status: index < GROUP_SIZE ? TaskStatus.running : TaskStatus.pending,
        params: { inputs },
      }
    })

    setIsCallBatchAPI(true)
    updateAllTaskList(nextTaskList)
    updateBatchCompletionRes({})
    currGroupNumRef.current = 0
    onStart()
    return true
  }, [checkBatchInputs, notify, promptConfig, t, updateAllTaskList, updateBatchCompletionRes])

  const handleCompleted = useCallback((completionRes: string, taskId?: number, isSuccess?: boolean) => {
    if (!taskId)
      return

    const latestTaskList = allTaskListRef.current
    const latestBatchCompletionRes = batchCompletionResRef.current
    const pendingTaskList = latestTaskList.filter(task => task.status === TaskStatus.pending)
    const runTasksCount = 1 + latestTaskList.filter(task => [TaskStatus.completed, TaskStatus.failed].includes(task.status)).length
    const shouldStartNextGroup = currGroupNumRef.current !== runTasksCount
      && pendingTaskList.length > 0
      && (runTasksCount % GROUP_SIZE === 0 || (latestTaskList.length - runTasksCount < GROUP_SIZE))

    if (shouldStartNextGroup)
      currGroupNumRef.current = runTasksCount

    const nextPendingTaskIds = shouldStartNextGroup ? pendingTaskList.slice(0, GROUP_SIZE).map(item => item.id) : []
    updateAllTaskList(latestTaskList.map((task) => {
      if (task.id === taskId)
        return { ...task, status: isSuccess ? TaskStatus.completed : TaskStatus.failed }
      if (shouldStartNextGroup && nextPendingTaskIds.includes(task.id))
        return { ...task, status: TaskStatus.running }
      return task
    }))
    updateBatchCompletionRes({
      ...latestBatchCompletionRes,
      [taskId]: completionRes,
    })
  }, [updateAllTaskList, updateBatchCompletionRes])

  const handleRetryAllFailedTask = useCallback(() => {
    setControlRetry(Date.now())
  }, [])

  const pendingTaskList = allTaskList.filter(task => task.status === TaskStatus.pending)
  const showTaskList = allTaskList.filter(task => task.status !== TaskStatus.pending)
  const allSuccessTaskList = allTaskList.filter(task => task.status === TaskStatus.completed)
  const allFailedTaskList = allTaskList.filter(task => task.status === TaskStatus.failed)
  const allTasksFinished = allTaskList.every(task => task.status === TaskStatus.completed)
  const allTasksRun = allTaskList.every(task => [TaskStatus.completed, TaskStatus.failed].includes(task.status))

  const exportRes = useMemo(() => {
    return allTaskList.map((task) => {
      const result: Record<string, string> = {}
      promptConfig?.prompt_variables.forEach((variable) => {
        result[variable.name] = String(task.params.inputs[variable.key] ?? '')
      })

      const completionValue = batchCompletionMap[String(task.id)] ?? ''
      result[t('generation.completionResult', { ns: 'share' })] = completionValue
      return result
    })
  }, [allTaskList, batchCompletionMap, promptConfig, t])

  return {
    allFailedTaskList,
    allSuccessTaskList,
    allTaskList,
    allTasksFinished,
    allTasksRun,
    controlRetry,
    exportRes,
    handleCompleted,
    handleRetryAllFailedTask,
    handleRunBatch,
    isCallBatchAPI,
    noPendingTask: pendingTaskList.length === 0,
    resetBatchExecution,
    setIsCallBatchAPI,
    showTaskList,
  }
}
