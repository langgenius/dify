import type { Dispatch, SetStateAction } from 'react'
import type { WorkflowProcess } from '@/app/components/base/chat/types'
import type { IOtherOptions } from '@/service/base'
import type { HumanInputFormTimeoutData, NodeTracing, WorkflowFinishedResponse } from '@/types/workflow'
import { produce } from 'immer'
import { getFilesInLogs } from '@/app/components/base/file-uploader/utils'
import { NodeRunningStatus, WorkflowRunningStatus } from '@/app/components/workflow/types'
import { sseGet } from '@/service/base'

type Notify = (payload: { type: 'error' | 'warning', message: string }) => void
type Translate = (key: string, options?: Record<string, unknown>) => string

type CreateWorkflowStreamHandlersParams = {
  getCompletionRes: () => string
  getWorkflowProcessData: () => WorkflowProcess | undefined
  isPublicAPI: boolean
  isTimedOut: () => boolean
  markEnded: () => void
  notify: Notify
  onCompleted: (completionRes: string, taskId?: number, success?: boolean) => void
  resetRunState: () => void
  setCompletionRes: (res: string) => void
  setCurrentTaskId: Dispatch<SetStateAction<string | null>>
  setIsStopping: Dispatch<SetStateAction<boolean>>
  setMessageId: Dispatch<SetStateAction<string | null>>
  setRespondingFalse: () => void
  setWorkflowProcessData: (data: WorkflowProcess | undefined) => void
  t: Translate
  taskId?: number
}

const createInitialWorkflowProcess = (): WorkflowProcess => ({
  status: WorkflowRunningStatus.Running,
  tracing: [],
  expand: false,
  resultText: '',
})

const updateWorkflowProcess = (
  current: WorkflowProcess | undefined,
  updater: (draft: WorkflowProcess) => void,
) => {
  return produce(current ?? createInitialWorkflowProcess(), updater)
}

const matchParallelTrace = (trace: WorkflowProcess['tracing'][number], data: NodeTracing) => {
  return trace.node_id === data.node_id
    && (trace.execution_metadata?.parallel_id === data.execution_metadata?.parallel_id
      || trace.parallel_id === data.execution_metadata?.parallel_id)
}

const ensureParallelTraceDetails = (details?: NodeTracing['details']) => {
  return details?.length ? details : [[]]
}

const appendParallelStart = (current: WorkflowProcess | undefined, data: NodeTracing) => {
  return updateWorkflowProcess(current, (draft) => {
    draft.expand = true
    draft.tracing.push({
      ...data,
      details: ensureParallelTraceDetails(data.details),
      status: NodeRunningStatus.Running,
      expand: true,
    })
  })
}

const appendParallelNext = (current: WorkflowProcess | undefined, data: NodeTracing) => {
  return updateWorkflowProcess(current, (draft) => {
    draft.expand = true
    const trace = draft.tracing.find(item => matchParallelTrace(item, data))
    if (!trace)
      return

    trace.details = ensureParallelTraceDetails(trace.details)
    trace.details.push([])
  })
}

const finishParallelTrace = (current: WorkflowProcess | undefined, data: NodeTracing) => {
  return updateWorkflowProcess(current, (draft) => {
    draft.expand = true
    const traceIndex = draft.tracing.findIndex(item => matchParallelTrace(item, data))
    if (traceIndex > -1) {
      draft.tracing[traceIndex] = {
        ...data,
        expand: !!data.error,
      }
    }
  })
}

const upsertWorkflowNode = (current: WorkflowProcess | undefined, data: NodeTracing) => {
  if (data.iteration_id || data.loop_id)
    return current

  return updateWorkflowProcess(current, (draft) => {
    draft.expand = true
    const currentIndex = draft.tracing.findIndex(item => item.node_id === data.node_id)
    const nextTrace = {
      ...data,
      status: NodeRunningStatus.Running,
      expand: true,
    }

    if (currentIndex > -1)
      draft.tracing[currentIndex] = nextTrace
    else
      draft.tracing.push(nextTrace)
  })
}

const finishWorkflowNode = (current: WorkflowProcess | undefined, data: NodeTracing) => {
  if (data.iteration_id || data.loop_id)
    return current

  return updateWorkflowProcess(current, (draft) => {
    const currentIndex = draft.tracing.findIndex(trace => matchParallelTrace(trace, data))
    if (currentIndex > -1) {
      draft.tracing[currentIndex] = {
        ...(draft.tracing[currentIndex].extras
          ? { extras: draft.tracing[currentIndex].extras }
          : {}),
        ...data,
        expand: !!data.error,
      }
    }
  })
}

const markNodesStopped = (traces?: WorkflowProcess['tracing']) => {
  if (!traces)
    return

  const markTrace = (trace: WorkflowProcess['tracing'][number]) => {
    if ([NodeRunningStatus.Running, NodeRunningStatus.Waiting].includes(trace.status as NodeRunningStatus))
      trace.status = NodeRunningStatus.Stopped

    trace.details?.forEach(detailGroup => detailGroup.forEach(markTrace))
    trace.retryDetail?.forEach(markTrace)
    trace.parallelDetail?.children?.forEach(markTrace)
  }

  traces.forEach(markTrace)
}

const applyWorkflowFinishedState = (
  current: WorkflowProcess | undefined,
  status: WorkflowRunningStatus,
) => {
  return updateWorkflowProcess(current, (draft) => {
    draft.status = status
    if ([WorkflowRunningStatus.Stopped, WorkflowRunningStatus.Failed].includes(status))
      markNodesStopped(draft.tracing)
  })
}

const applyWorkflowOutputs = (
  current: WorkflowProcess | undefined,
  outputs: WorkflowFinishedResponse['data']['outputs'],
) => {
  return updateWorkflowProcess(current, (draft) => {
    draft.status = WorkflowRunningStatus.Succeeded
    draft.files = getFilesInLogs(outputs || []) as unknown as WorkflowProcess['files']
  })
}

const appendResultText = (current: WorkflowProcess | undefined, text: string) => {
  return updateWorkflowProcess(current, (draft) => {
    draft.resultText = `${draft.resultText || ''}${text}`
  })
}

const replaceResultText = (current: WorkflowProcess | undefined, text: string) => {
  return updateWorkflowProcess(current, (draft) => {
    draft.resultText = text
  })
}

const updateHumanInputRequired = (
  current: WorkflowProcess | undefined,
  data: NonNullable<WorkflowProcess['humanInputFormDataList']>[number],
) => {
  return updateWorkflowProcess(current, (draft) => {
    if (!draft.humanInputFormDataList) {
      draft.humanInputFormDataList = [data]
    }
    else {
      const currentFormIndex = draft.humanInputFormDataList.findIndex(item => item.node_id === data.node_id)
      if (currentFormIndex > -1)
        draft.humanInputFormDataList[currentFormIndex] = data
      else
        draft.humanInputFormDataList.push(data)
    }

    const currentIndex = draft.tracing.findIndex(item => item.node_id === data.node_id)
    if (currentIndex > -1)
      draft.tracing[currentIndex].status = NodeRunningStatus.Paused
  })
}

const updateHumanInputFilled = (
  current: WorkflowProcess | undefined,
  data: NonNullable<WorkflowProcess['humanInputFilledFormDataList']>[number],
) => {
  return updateWorkflowProcess(current, (draft) => {
    if (draft.humanInputFormDataList?.length) {
      const currentFormIndex = draft.humanInputFormDataList.findIndex(item => item.node_id === data.node_id)
      if (currentFormIndex > -1)
        draft.humanInputFormDataList.splice(currentFormIndex, 1)
    }

    if (!draft.humanInputFilledFormDataList)
      draft.humanInputFilledFormDataList = [data]
    else
      draft.humanInputFilledFormDataList.push(data)
  })
}

const updateHumanInputTimeout = (
  current: WorkflowProcess | undefined,
  data: HumanInputFormTimeoutData,
) => {
  return updateWorkflowProcess(current, (draft) => {
    if (!draft.humanInputFormDataList?.length)
      return

    const currentFormIndex = draft.humanInputFormDataList.findIndex(item => item.node_id === data.node_id)
    if (currentFormIndex > -1)
      draft.humanInputFormDataList[currentFormIndex].expiration_time = data.expiration_time
  })
}

const applyWorkflowPaused = (current: WorkflowProcess | undefined) => {
  return updateWorkflowProcess(current, (draft) => {
    draft.expand = false
    draft.status = WorkflowRunningStatus.Paused
  })
}

const serializeWorkflowOutputs = (outputs: WorkflowFinishedResponse['data']['outputs']) => {
  if (outputs === undefined || outputs === null)
    return ''

  if (typeof outputs === 'string')
    return outputs

  try {
    return JSON.stringify(outputs) ?? ''
  }
  catch {
    return String(outputs)
  }
}

export const createWorkflowStreamHandlers = ({
  getCompletionRes,
  getWorkflowProcessData,
  isPublicAPI,
  isTimedOut,
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
  t,
  taskId,
}: CreateWorkflowStreamHandlersParams): IOtherOptions => {
  let tempMessageId = ''

  const finishWithFailure = () => {
    setRespondingFalse()
    resetRunState()
    onCompleted(getCompletionRes(), taskId, false)
    markEnded()
  }

  const finishWithSuccess = () => {
    setRespondingFalse()
    resetRunState()
    setMessageId(tempMessageId)
    onCompleted(getCompletionRes(), taskId, true)
    markEnded()
  }

  const otherOptions: IOtherOptions = {
    isPublicAPI,
    onWorkflowStarted: ({ workflow_run_id, task_id }) => {
      const workflowProcessData = getWorkflowProcessData()
      if (workflowProcessData?.tracing.length) {
        setWorkflowProcessData(updateWorkflowProcess(workflowProcessData, (draft) => {
          draft.expand = true
          draft.status = WorkflowRunningStatus.Running
        }))
        return
      }

      tempMessageId = workflow_run_id
      setCurrentTaskId(task_id || null)
      setIsStopping(false)
      setWorkflowProcessData(createInitialWorkflowProcess())
    },
    onIterationStart: ({ data }) => {
      setWorkflowProcessData(appendParallelStart(getWorkflowProcessData(), data))
    },
    onIterationNext: ({ data }) => {
      setWorkflowProcessData(appendParallelNext(getWorkflowProcessData(), data))
    },
    onIterationFinish: ({ data }) => {
      setWorkflowProcessData(finishParallelTrace(getWorkflowProcessData(), data))
    },
    onLoopStart: ({ data }) => {
      setWorkflowProcessData(appendParallelStart(getWorkflowProcessData(), data))
    },
    onLoopNext: ({ data }) => {
      setWorkflowProcessData(appendParallelNext(getWorkflowProcessData(), data))
    },
    onLoopFinish: ({ data }) => {
      setWorkflowProcessData(finishParallelTrace(getWorkflowProcessData(), data))
    },
    onNodeStarted: ({ data }) => {
      setWorkflowProcessData(upsertWorkflowNode(getWorkflowProcessData(), data))
    },
    onNodeFinished: ({ data }) => {
      setWorkflowProcessData(finishWorkflowNode(getWorkflowProcessData(), data))
    },
    onWorkflowFinished: ({ data }) => {
      if (isTimedOut()) {
        notify({ type: 'warning', message: t('warningMessage.timeoutExceeded', { ns: 'appDebug' }) })
        return
      }

      const workflowStatus = data.status as WorkflowRunningStatus | undefined
      if (workflowStatus === WorkflowRunningStatus.Stopped) {
        setWorkflowProcessData(applyWorkflowFinishedState(getWorkflowProcessData(), WorkflowRunningStatus.Stopped))
        finishWithFailure()
        return
      }

      if (data.error) {
        notify({ type: 'error', message: data.error })
        setWorkflowProcessData(applyWorkflowFinishedState(getWorkflowProcessData(), WorkflowRunningStatus.Failed))
        finishWithFailure()
        return
      }

      setWorkflowProcessData(applyWorkflowOutputs(getWorkflowProcessData(), data.outputs))
      const serializedOutputs = serializeWorkflowOutputs(data.outputs)
      setCompletionRes(serializedOutputs)
      if (data.outputs) {
        const outputKeys = Object.keys(data.outputs)
        const isStringOutput = outputKeys.length === 1 && typeof data.outputs[outputKeys[0]] === 'string'
        if (isStringOutput) {
          setWorkflowProcessData(updateWorkflowProcess(getWorkflowProcessData(), (draft) => {
            draft.resultText = data.outputs[outputKeys[0]]
          }))
        }
      }

      finishWithSuccess()
    },
    onTextChunk: ({ data: { text } }) => {
      setWorkflowProcessData(appendResultText(getWorkflowProcessData(), text))
    },
    onTextReplace: ({ data: { text } }) => {
      setWorkflowProcessData(replaceResultText(getWorkflowProcessData(), text))
    },
    onHumanInputRequired: ({ data }) => {
      setWorkflowProcessData(updateHumanInputRequired(getWorkflowProcessData(), data))
    },
    onHumanInputFormFilled: ({ data }) => {
      setWorkflowProcessData(updateHumanInputFilled(getWorkflowProcessData(), data))
    },
    onHumanInputFormTimeout: ({ data }) => {
      setWorkflowProcessData(updateHumanInputTimeout(getWorkflowProcessData(), data))
    },
    onWorkflowPaused: ({ data }) => {
      tempMessageId = data.workflow_run_id
      // WebApp workflows must keep using the public API namespace after pause/resume.
      void sseGet(`/workflow/${data.workflow_run_id}/events`, {}, otherOptions)
      setWorkflowProcessData(applyWorkflowPaused(getWorkflowProcessData()))
    },
  }

  return otherOptions
}

export {
  appendParallelNext,
  appendParallelStart,
  appendResultText,
  applyWorkflowFinishedState,
  applyWorkflowOutputs,
  applyWorkflowPaused,
  finishParallelTrace,
  finishWorkflowNode,
  markNodesStopped,
  replaceResultText,
  updateHumanInputFilled,
  updateHumanInputRequired,
  updateHumanInputTimeout,
  upsertWorkflowNode,
}
