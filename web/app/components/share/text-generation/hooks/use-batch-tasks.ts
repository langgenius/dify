import type { PromptConfig } from '@/models/debug'
import { useCallback, useMemo, useRef, useState } from 'react'
import { BATCH_CONCURRENCY, DEFAULT_VALUE_MAX_LEN } from '@/config'

const GROUP_SIZE = BATCH_CONCURRENCY // to avoid RPM(Request per minute) limit. The group task finished then the next group.

export enum TaskStatus {
  pending = 'pending',
  running = 'running',
  completed = 'completed',
  failed = 'failed',
}

type TaskParam = {
  inputs: Record<string, any>
}

export type Task = {
  id: number
  status: TaskStatus
  params: TaskParam
}

type UseBatchTasksParams = {
  promptConfig: PromptConfig | null
  notify: (payload: { type: string, message: string }) => void
  t: (key: string, options?: Record<string, any>) => string
  onBatchStart: () => void
}

type UseBatchTasksResult = {
  isCallBatchAPI: boolean
  setIsCallBatchAPI: (value: boolean) => void
  allTaskList: Task[]
  pendingTaskList: Task[]
  noPendingTask: boolean
  showTaskList: Task[]
  allSuccessTaskList: Task[]
  allFailedTaskList: Task[]
  allTasksFinished: boolean
  allTasksRun: boolean
  exportRes: Record<string, string>[]
  controlRetry: number
  handleRetryAllFailedTask: () => void
  handleRunBatch: (data: string[][]) => void
  handleCompleted: (completionRes: string, taskId?: number, isSuccess?: boolean) => void
  resetBatchTasks: () => void
}

export const useBatchTasks = ({
  promptConfig,
  notify,
  t,
  onBatchStart,
}: UseBatchTasksParams): UseBatchTasksResult => {
  const [isCallBatchAPI, setIsCallBatchAPI] = useState(false)
  const [controlRetry, setControlRetry] = useState(0)
  const [allTaskList, setAllTaskListState] = useState<Task[]>([])
  const allTaskListRef = useRef<Task[]>([])
  const currGroupNumRef = useRef(0)
  const batchCompletionResRef = useRef<Record<string, string>>({})

  const setAllTaskList = useCallback((taskList: Task[]) => {
    setAllTaskListState(taskList)
    allTaskListRef.current = taskList
  }, [])

  const getLatestTaskList = useCallback(() => allTaskListRef.current, [])

  const setCurrGroupNum = useCallback((num: number) => {
    currGroupNumRef.current = num
  }, [])

  const getCurrGroupNum = useCallback(() => currGroupNumRef.current, [])

  const setBatchCompletionRes = useCallback((res: Record<string, string>) => {
    batchCompletionResRef.current = res
  }, [])

  const getBatchCompletionRes = useCallback(() => batchCompletionResRef.current, [])

  const resetBatchTasks = useCallback(() => {
    setIsCallBatchAPI(false)
    setAllTaskList([])
    setCurrGroupNum(0)
    setBatchCompletionRes({})
  }, [setAllTaskList, setBatchCompletionRes, setCurrGroupNum])

  const pendingTaskList = useMemo(
    () => allTaskList.filter(task => task.status === TaskStatus.pending),
    [allTaskList],
  )
  const noPendingTask = pendingTaskList.length === 0
  const showTaskList = useMemo(
    () => allTaskList.filter(task => task.status !== TaskStatus.pending),
    [allTaskList],
  )
  const allSuccessTaskList = useMemo(
    () => allTaskList.filter(task => task.status === TaskStatus.completed),
    [allTaskList],
  )
  const allFailedTaskList = useMemo(
    () => allTaskList.filter(task => task.status === TaskStatus.failed),
    [allTaskList],
  )
  const allTasksFinished = useMemo(
    () => allTaskList.every(task => task.status === TaskStatus.completed),
    [allTaskList],
  )
  const allTasksRun = useMemo(
    () => allTaskList.every(task => [TaskStatus.completed, TaskStatus.failed].includes(task.status)),
    [allTaskList],
  )

  const exportRes = useMemo(() => {
    return allTaskList.map((task) => {
      const batchCompletionResLatest = getBatchCompletionRes()
      const res: Record<string, string> = {}
      const { inputs } = task.params
      promptConfig?.prompt_variables.forEach((v) => {
        res[v.name] = inputs[v.key]
      })
      let result = batchCompletionResLatest[task.id]
      // task might return multiple fields, should marshal object to string
      if (typeof batchCompletionResLatest[task.id] === 'object')
        result = JSON.stringify(result)

      res[t('generation.completionResult', { ns: 'share' })] = result
      return res
    })
  }, [allTaskList, getBatchCompletionRes, promptConfig, t])

  const checkBatchInputs = useCallback((data: string[][]) => {
    if (!data || data.length === 0) {
      notify({ type: 'error', message: t('generation.errorMsg.empty', { ns: 'share' }) })
      return false
    }
    const headerData = data[0]
    let isMapVarName = true
    promptConfig?.prompt_variables.forEach((item, index) => {
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

    // check middle empty line
    const allEmptyLineIndexes = payloadData.filter(item => item.every(i => i === '')).map(item => payloadData.indexOf(item))
    if (allEmptyLineIndexes.length > 0) {
      let hasMiddleEmptyLine = false
      let startIndex = allEmptyLineIndexes[0] - 1
      allEmptyLineIndexes.forEach((index) => {
        if (hasMiddleEmptyLine)
          return

        if (startIndex + 1 !== index) {
          hasMiddleEmptyLine = true
          return
        }
        startIndex++
      })

      if (hasMiddleEmptyLine) {
        notify({ type: 'error', message: t('generation.errorMsg.emptyLine', { ns: 'share', rowIndex: startIndex + 2 }) })
        return false
      }
    }

    // check row format
    payloadData = payloadData.filter(item => !item.every(i => i === ''))
    // after remove empty rows in the end, checked again
    if (payloadData.length === 0) {
      notify({ type: 'error', message: t('generation.errorMsg.atLeastOne', { ns: 'share' }) })
      return false
    }
    let errorRowIndex = 0
    let requiredVarName = ''
    let moreThanMaxLengthVarName = ''
    let maxLength = 0
    payloadData.forEach((item, index) => {
      if (errorRowIndex !== 0)
        return

      promptConfig?.prompt_variables.forEach((varItem, varIndex) => {
        if (errorRowIndex !== 0)
          return
        if (varItem.type === 'string') {
          const maxLen = varItem.max_length || DEFAULT_VALUE_MAX_LEN
          if (item[varIndex].length > maxLen) {
            moreThanMaxLengthVarName = varItem.name
            maxLength = maxLen
            errorRowIndex = index + 1
            return
          }
        }
        if (!varItem.required)
          return

        if (item[varIndex].trim() === '') {
          requiredVarName = varItem.name
          errorRowIndex = index + 1
        }
      })
    })

    if (errorRowIndex !== 0) {
      if (requiredVarName)
        notify({ type: 'error', message: t('generation.errorMsg.invalidLine', { ns: 'share', rowIndex: errorRowIndex + 1, varName: requiredVarName }) })

      if (moreThanMaxLengthVarName)
        notify({ type: 'error', message: t('generation.errorMsg.moreThanMaxLengthLine', { ns: 'share', rowIndex: errorRowIndex + 1, varName: moreThanMaxLengthVarName, maxLength }) })

      return false
    }
    return true
  }, [notify, promptConfig, t])

  const handleRunBatch = useCallback((data: string[][]) => {
    if (!checkBatchInputs(data))
      return
    if (!allTasksFinished) {
      notify({ type: 'info', message: t('errorMessage.waitForBatchResponse', { ns: 'appDebug' }) })
      return
    }

    const payloadData = data.filter(item => !item.every(i => i === '')).slice(1)
    const varLen = promptConfig?.prompt_variables.length || 0
    setIsCallBatchAPI(true)
    const allTaskList: Task[] = payloadData.map((item, i) => {
      const inputs: Record<string, any> = {}
      if (varLen > 0) {
        item.slice(0, varLen).forEach((input, index) => {
          const varSchema = promptConfig?.prompt_variables[index]
          inputs[varSchema?.key as string] = input
          if (!input) {
            if (varSchema?.type === 'string' || varSchema?.type === 'paragraph')
              inputs[varSchema?.key as string] = ''
            else
              inputs[varSchema?.key as string] = undefined
          }
        })
      }
      return {
        id: i + 1,
        status: i < GROUP_SIZE ? TaskStatus.running : TaskStatus.pending,
        params: {
          inputs,
        },
      }
    })
    setAllTaskList(allTaskList)
    setCurrGroupNum(0)
    onBatchStart()
  }, [allTasksFinished, checkBatchInputs, notify, onBatchStart, promptConfig, setAllTaskList, setCurrGroupNum, t])

  const handleCompleted = useCallback((completionRes: string, taskId?: number, isSuccess?: boolean) => {
    const allTaskListLatest = getLatestTaskList()
    const batchCompletionResLatest = getBatchCompletionRes()
    const pendingTaskList = allTaskListLatest.filter(task => task.status === TaskStatus.pending)
    const runTasksCount = 1 + allTaskListLatest.filter(task => [TaskStatus.completed, TaskStatus.failed].includes(task.status)).length
    const needToAddNextGroupTask = (getCurrGroupNum() !== runTasksCount) && pendingTaskList.length > 0 && (runTasksCount % GROUP_SIZE === 0 || (allTaskListLatest.length - runTasksCount < GROUP_SIZE))
    // avoid add many task at the same time
    if (needToAddNextGroupTask)
      setCurrGroupNum(runTasksCount)

    const nextPendingTaskIds = needToAddNextGroupTask ? pendingTaskList.slice(0, GROUP_SIZE).map(item => item.id) : []
    const newAllTaskList = allTaskListLatest.map((item) => {
      if (item.id === taskId) {
        return {
          ...item,
          status: isSuccess ? TaskStatus.completed : TaskStatus.failed,
        }
      }
      if (needToAddNextGroupTask && nextPendingTaskIds.includes(item.id)) {
        return {
          ...item,
          status: TaskStatus.running,
        }
      }
      return item
    })
    setAllTaskList(newAllTaskList)
    if (taskId) {
      setBatchCompletionRes({
        ...batchCompletionResLatest,
        [`${taskId}`]: completionRes,
      })
    }
  }, [getBatchCompletionRes, getCurrGroupNum, getLatestTaskList, setAllTaskList, setBatchCompletionRes, setCurrGroupNum])

  const handleRetryAllFailedTask = useCallback(() => {
    setControlRetry(Date.now())
  }, [])

  return {
    isCallBatchAPI,
    setIsCallBatchAPI,
    allTaskList,
    pendingTaskList,
    noPendingTask,
    showTaskList,
    allSuccessTaskList,
    allFailedTaskList,
    allTasksFinished,
    allTasksRun,
    exportRes,
    controlRetry,
    handleRetryAllFailedTask,
    handleRunBatch,
    handleCompleted,
    resetBatchTasks,
  }
}
