import type { TFunction } from 'i18next'
import type { WorkflowProcess } from '@/app/components/base/chat/types'
import type { VisionFile } from '@/types/app'
import type { NodeTracing, WorkflowFinishedResponse } from '@/types/workflow'
import { produce } from 'immer'
import {
  getFilesInLogs,
} from '@/app/components/base/file-uploader/utils'
import { NodeRunningStatus, WorkflowRunningStatus } from '@/app/components/workflow/types'

type WorkflowFinishedData = WorkflowFinishedResponse['data']

type TraceItem = WorkflowProcess['tracing'][number]

function findTraceIndex(
  tracing: WorkflowProcess['tracing'],
  nodeId: string,
  parallelId?: string,
): number {
  return tracing.findIndex(item =>
    item.node_id === nodeId
    && (item.execution_metadata?.parallel_id === parallelId || item.parallel_id === parallelId),
  )
}

function findTrace(
  tracing: WorkflowProcess['tracing'],
  nodeId: string,
  parallelId?: string,
): TraceItem | undefined {
  return tracing.find(item =>
    item.node_id === nodeId
    && (item.execution_metadata?.parallel_id === parallelId || item.parallel_id === parallelId),
  )
}

function markNodesStopped(traces?: WorkflowProcess['tracing']) {
  if (!traces)
    return
  const mark = (trace: TraceItem) => {
    if ([NodeRunningStatus.Running, NodeRunningStatus.Waiting].includes(trace.status as NodeRunningStatus))
      trace.status = NodeRunningStatus.Stopped
    trace.details?.forEach(group => group.forEach(mark))
    trace.retryDetail?.forEach(mark)
    trace.parallelDetail?.children?.forEach(mark)
  }
  traces.forEach(mark)
}

export type WorkflowCallbackDeps = {
  getProcessData: () => WorkflowProcess | undefined
  setProcessData: (data: WorkflowProcess) => void
  setCurrentTaskId: (id: string | null) => void
  setIsStopping: (v: boolean) => void
  getCompletionRes: () => string
  setCompletionRes: (res: string) => void
  setRespondingFalse: () => void
  resetRunState: () => void
  setMessageId: (id: string | null) => void
  isTimeoutRef: { current: boolean }
  isEndRef: { current: boolean }
  tempMessageIdRef: { current: string }
  taskId?: number
  onCompleted: (completionRes: string, taskId?: number, success?: boolean) => void
  notify: (options: { type: 'error' | 'info' | 'success' | 'warning', message: string }) => void
  t: TFunction
  // The outer request data object passed to sendWorkflowMessage.
  // Used by group next handlers to match traces (mirrors original closure behavior).
  requestData: { inputs: Record<string, string | number | boolean | object>, files?: VisionFile[], node_id?: string, execution_metadata?: { parallel_id?: string } }
}

export function createWorkflowCallbacks(deps: WorkflowCallbackDeps) {
  const {
    getProcessData,
    setProcessData,
    setCurrentTaskId,
    setIsStopping,
    getCompletionRes,
    setCompletionRes,
    setRespondingFalse,
    resetRunState,
    setMessageId,
    isTimeoutRef,
    isEndRef,
    tempMessageIdRef,
    taskId,
    onCompleted,
    notify,
    t,
    requestData,
  } = deps

  const updateProcessData = (updater: (draft: WorkflowProcess) => void) => {
    setProcessData(produce(getProcessData()!, updater))
  }

  const handleGroupStart = ({ data }: { data: NodeTracing }) => {
    updateProcessData((draft) => {
      draft.expand = true
      draft.tracing!.push({ ...data, status: NodeRunningStatus.Running, expand: true })
    })
  }

  const handleGroupNext = () => {
    if (!requestData.node_id)
      return
    updateProcessData((draft) => {
      draft.expand = true
      const group = findTrace(
        draft.tracing,
        requestData.node_id!,
        requestData.execution_metadata?.parallel_id,
      )
      group?.details!.push([])
    })
  }

  const handleGroupFinish = ({ data }: { data: NodeTracing }) => {
    updateProcessData((draft) => {
      draft.expand = true
      const idx = findTraceIndex(draft.tracing, data.node_id, data.execution_metadata?.parallel_id)
      draft.tracing[idx] = { ...data, expand: !!data.error }
    })
  }

  const handleWorkflowEnd = (status: WorkflowRunningStatus, error?: string) => {
    if (error)
      notify({ type: 'error', message: error })
    updateProcessData((draft) => {
      draft.status = status
      markNodesStopped(draft.tracing)
    })
    setRespondingFalse()
    resetRunState()
    onCompleted(getCompletionRes(), taskId, false)
    isEndRef.current = true
  }

  return {
    onWorkflowStarted: ({ workflow_run_id, task_id }: { workflow_run_id: string, task_id?: string }) => {
      tempMessageIdRef.current = workflow_run_id
      setCurrentTaskId(task_id || null)
      setIsStopping(false)
      setProcessData({
        status: WorkflowRunningStatus.Running,
        tracing: [],
        expand: false,
        resultText: '',
      })
    },

    onIterationStart: handleGroupStart,
    onIterationNext: handleGroupNext,
    onIterationFinish: handleGroupFinish,
    onLoopStart: handleGroupStart,
    onLoopNext: handleGroupNext,
    onLoopFinish: handleGroupFinish,

    onNodeStarted: ({ data }: { data: NodeTracing }) => {
      if (data.iteration_id || data.loop_id)
        return
      updateProcessData((draft) => {
        draft.expand = true
        draft.tracing!.push({ ...data, status: NodeRunningStatus.Running, expand: true })
      })
    },

    onNodeFinished: ({ data }: { data: NodeTracing }) => {
      if (data.iteration_id || data.loop_id)
        return
      updateProcessData((draft) => {
        const idx = findTraceIndex(draft.tracing!, data.node_id, data.execution_metadata?.parallel_id)
        if (idx > -1 && draft.tracing) {
          draft.tracing[idx] = {
            ...(draft.tracing[idx].extras ? { extras: draft.tracing[idx].extras } : {}),
            ...data,
            expand: !!data.error,
          }
        }
      })
    },

    onWorkflowFinished: ({ data }: { data: WorkflowFinishedData }) => {
      if (isTimeoutRef.current) {
        notify({ type: 'warning', message: t('warningMessage.timeoutExceeded', { ns: 'appDebug' }) })
        return
      }

      if (data.status === WorkflowRunningStatus.Stopped) {
        handleWorkflowEnd(WorkflowRunningStatus.Stopped)
        return
      }

      if (data.error) {
        handleWorkflowEnd(WorkflowRunningStatus.Failed, data.error)
        return
      }

      updateProcessData((draft) => {
        draft.status = WorkflowRunningStatus.Succeeded
        // eslint-disable-next-line ts/no-explicit-any
        draft.files = getFilesInLogs(data.outputs || []) as any[]
      })

      if (data.outputs) {
        setCompletionRes(data.outputs)
        const keys = Object.keys(data.outputs)
        if (keys.length === 1 && typeof data.outputs[keys[0]] === 'string') {
          updateProcessData((draft) => {
            draft.resultText = data.outputs[keys[0]]
          })
        }
      }
      else {
        setCompletionRes('')
      }

      setRespondingFalse()
      resetRunState()
      setMessageId(tempMessageIdRef.current)
      onCompleted(getCompletionRes(), taskId, true)
      isEndRef.current = true
    },

    onTextChunk: (params: { data: { text: string } }) => {
      updateProcessData((draft) => {
        draft.resultText += params.data.text
      })
    },

    onTextReplace: (params: { data: { text: string } }) => {
      updateProcessData((draft) => {
        draft.resultText = params.data.text
      })
    },
  }
}
