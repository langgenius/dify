import { useCallback } from 'react'
import {
  useReactFlow,
  useStoreApi,
} from 'reactflow'
import { produce } from 'immer'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { useWorkflowUpdate } from '@/app/components/workflow/hooks/use-workflow-interactions'
import { useWorkflowRunEvent } from '@/app/components/workflow/hooks/use-workflow-run-event/use-workflow-run-event'
import type { IOtherOptions } from '@/service/base'
import { ssePost } from '@/service/base'
import { stopWorkflowRun } from '@/service/workflow'
import type { VersionHistory } from '@/types/workflow'
import { useNodesSyncDraft } from './use-nodes-sync-draft'
import { useSetWorkflowVarsWithValue } from '@/app/components/workflow/hooks/use-fetch-workflow-inspect-vars'
import { useInvalidAllLastRun } from '@/service/use-workflow'
import { FlowType } from '@/types/common'

export const usePipelineRun = () => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const reactflow = useReactFlow()
  const { doSyncWorkflowDraft } = useNodesSyncDraft()
  const { handleUpdateWorkflowCanvas } = useWorkflowUpdate()

  const {
    handleWorkflowStarted,
    handleWorkflowFinished,
    handleWorkflowFailed,
    handleWorkflowNodeStarted,
    handleWorkflowNodeFinished,
    handleWorkflowNodeIterationStarted,
    handleWorkflowNodeIterationNext,
    handleWorkflowNodeIterationFinished,
    handleWorkflowNodeLoopStarted,
    handleWorkflowNodeLoopNext,
    handleWorkflowNodeLoopFinished,
    handleWorkflowNodeRetry,
    handleWorkflowAgentLog,
    handleWorkflowTextChunk,
    handleWorkflowTextReplace,
  } = useWorkflowRunEvent()

  const handleBackupDraft = useCallback(() => {
    const {
      getNodes,
      edges,
    } = store.getState()
    const { getViewport } = reactflow
    const {
      backupDraft,
      setBackupDraft,
      environmentVariables,
    } = workflowStore.getState()

    if (!backupDraft) {
      setBackupDraft({
        nodes: getNodes(),
        edges,
        viewport: getViewport(),
        environmentVariables,
      })
      doSyncWorkflowDraft()
    }
  }, [reactflow, workflowStore, store, doSyncWorkflowDraft])

  const handleLoadBackupDraft = useCallback(() => {
    const {
      backupDraft,
      setBackupDraft,
      setEnvironmentVariables,
    } = workflowStore.getState()

    if (backupDraft) {
      const {
        nodes,
        edges,
        viewport,
        environmentVariables,
      } = backupDraft
      handleUpdateWorkflowCanvas({
        nodes,
        edges,
        viewport,
      })
      setEnvironmentVariables(environmentVariables)
      setBackupDraft(undefined)
    }
  }, [handleUpdateWorkflowCanvas, workflowStore])

  const pipelineId = useStore(s => s.pipelineId)
  const invalidAllLastRun = useInvalidAllLastRun(FlowType.ragPipeline, pipelineId)
  const { fetchInspectVars } = useSetWorkflowVarsWithValue({
    flowType: FlowType.ragPipeline,
    flowId: pipelineId!,
  })

  const handleRun = useCallback(async (
    params: any,
    callback?: IOtherOptions,
  ) => {
    const {
      getNodes,
      setNodes,
    } = store.getState()
    const newNodes = produce(getNodes(), (draft) => {
      draft.forEach((node) => {
        node.data.selected = false
        node.data._runningStatus = undefined
      })
    })
    setNodes(newNodes)
    await doSyncWorkflowDraft()

    const {
      onWorkflowStarted,
      onWorkflowFinished,
      onNodeStarted,
      onNodeFinished,
      onIterationStart,
      onIterationNext,
      onIterationFinish,
      onLoopStart,
      onLoopNext,
      onLoopFinish,
      onNodeRetry,
      onAgentLog,
      onError,
      ...restCallback
    } = callback || {}
    const { pipelineId } = workflowStore.getState()
    workflowStore.setState({ historyWorkflowData: undefined })
    const workflowContainer = document.getElementById('workflow-container')

    const {
      clientWidth,
      clientHeight,
    } = workflowContainer!

    const url = `/rag/pipelines/${pipelineId}/workflows/draft/run`

    const {
      setWorkflowRunningData,
    } = workflowStore.getState()
    setWorkflowRunningData({
      result: {
        inputs_truncated: false,
        process_data_truncated: false,
        outputs_truncated: false,
        status: WorkflowRunningStatus.Running,
      },
      tracing: [],
      resultText: '',
    })

    ssePost(
      url,
      {
        body: params,
      },
      {
        onWorkflowStarted: (params) => {
          handleWorkflowStarted(params)

          if (onWorkflowStarted)
            onWorkflowStarted(params)
        },
        onWorkflowFinished: (params) => {
          handleWorkflowFinished(params)
          fetchInspectVars({})
          invalidAllLastRun()

          if (onWorkflowFinished)
            onWorkflowFinished(params)
        },
        onError: (params) => {
          handleWorkflowFailed()

          if (onError)
            onError(params)
        },
        onNodeStarted: (params) => {
          handleWorkflowNodeStarted(
            params,
            {
              clientWidth,
              clientHeight,
            },
          )

          if (onNodeStarted)
            onNodeStarted(params)
        },
        onNodeFinished: (params) => {
          handleWorkflowNodeFinished(params)

          if (onNodeFinished)
            onNodeFinished(params)
        },
        onIterationStart: (params) => {
          handleWorkflowNodeIterationStarted(
            params,
            {
              clientWidth,
              clientHeight,
            },
          )

          if (onIterationStart)
            onIterationStart(params)
        },
        onIterationNext: (params) => {
          handleWorkflowNodeIterationNext(params)

          if (onIterationNext)
            onIterationNext(params)
        },
        onIterationFinish: (params) => {
          handleWorkflowNodeIterationFinished(params)

          if (onIterationFinish)
            onIterationFinish(params)
        },
        onLoopStart: (params) => {
          handleWorkflowNodeLoopStarted(
            params,
            {
              clientWidth,
              clientHeight,
            },
          )

          if (onLoopStart)
            onLoopStart(params)
        },
        onLoopNext: (params) => {
          handleWorkflowNodeLoopNext(params)

          if (onLoopNext)
            onLoopNext(params)
        },
        onLoopFinish: (params) => {
          handleWorkflowNodeLoopFinished(params)

          if (onLoopFinish)
            onLoopFinish(params)
        },
        onNodeRetry: (params) => {
          handleWorkflowNodeRetry(params)

          if (onNodeRetry)
            onNodeRetry(params)
        },
        onAgentLog: (params) => {
          handleWorkflowAgentLog(params)

          if (onAgentLog)
            onAgentLog(params)
        },
        onTextChunk: (params) => {
          handleWorkflowTextChunk(params)
        },
        onTextReplace: (params) => {
          handleWorkflowTextReplace(params)
        },
        ...restCallback,
      },
    )
  }, [
    store,
    workflowStore,
    doSyncWorkflowDraft,
    handleWorkflowStarted,
    handleWorkflowFinished,
    handleWorkflowFailed,
    handleWorkflowNodeStarted,
    handleWorkflowNodeFinished,
    handleWorkflowNodeIterationStarted,
    handleWorkflowNodeIterationNext,
    handleWorkflowNodeIterationFinished,
    handleWorkflowNodeLoopStarted,
    handleWorkflowNodeLoopNext,
    handleWorkflowNodeLoopFinished,
    handleWorkflowNodeRetry,
    handleWorkflowTextChunk,
    handleWorkflowTextReplace,
    handleWorkflowAgentLog,
  ],
  )

  const handleStopRun = useCallback((taskId: string) => {
    const { pipelineId } = workflowStore.getState()

    stopWorkflowRun(`/rag/pipelines/${pipelineId}/workflow-runs/tasks/${taskId}/stop`)
  }, [workflowStore])

  const handleRestoreFromPublishedWorkflow = useCallback((publishedWorkflow: VersionHistory) => {
    const nodes = publishedWorkflow.graph.nodes.map(node => ({ ...node, selected: false, data: { ...node.data, selected: false } }))
    const edges = publishedWorkflow.graph.edges
    const viewport = publishedWorkflow.graph.viewport!
    handleUpdateWorkflowCanvas({
      nodes,
      edges,
      viewport,
    })

    workflowStore.getState().setEnvironmentVariables(publishedWorkflow.environment_variables || [])
    workflowStore.getState().setRagPipelineVariables?.(publishedWorkflow.rag_pipeline_variables || [])
  }, [handleUpdateWorkflowCanvas, workflowStore])

  return {
    handleBackupDraft,
    handleLoadBackupDraft,
    handleRun,
    handleStopRun,
    handleRestoreFromPublishedWorkflow,
  }
}
