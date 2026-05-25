import type { IOtherOptions } from '@/service/base'
import type { SnippetDraftRunPayload } from '@/types/snippet'
import type { VersionHistory } from '@/types/workflow'
import { produce } from 'immer'
import { useCallback, useRef } from 'react'
import {
  useReactFlow,
  useStoreApi,
} from 'reactflow'
import { useSetWorkflowVarsWithValue } from '@/app/components/workflow/hooks/use-fetch-workflow-inspect-vars'
import { useWorkflowUpdate } from '@/app/components/workflow/hooks/use-workflow-interactions'
import { useWorkflowRunEvent } from '@/app/components/workflow/hooks/use-workflow-run-event/use-workflow-run-event'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { ssePost } from '@/service/base'
import { useInvalidAllLastRun, useInvalidateWorkflowRunHistory } from '@/service/use-workflow'
import { stopWorkflowRun } from '@/service/workflow'
import { FlowType } from '@/types/common'
import { useNodesSyncDraft } from './use-nodes-sync-draft'

export const useSnippetRun = (snippetId: string) => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const reactflow = useReactFlow()
  const { doSyncWorkflowDraft } = useNodesSyncDraft(snippetId)
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

  const abortControllerRef = useRef<AbortController | null>(null)

  const handleBackupDraft = useCallback(() => {
    const {
      getNodes,
      edges,
    } = store.getState()
    const { getViewport } = reactflow
    const {
      backupDraft,
      setBackupDraft,
    } = workflowStore.getState()

    if (!backupDraft) {
      setBackupDraft({
        nodes: getNodes(),
        edges,
        viewport: getViewport(),
        environmentVariables: [],
      })
      doSyncWorkflowDraft()
    }
  }, [doSyncWorkflowDraft, reactflow, store, workflowStore])

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
      } = backupDraft
      handleUpdateWorkflowCanvas({
        nodes,
        edges,
        viewport,
      })
      setEnvironmentVariables([])
      setBackupDraft(undefined)
    }
  }, [handleUpdateWorkflowCanvas, workflowStore])

  const invalidAllLastRun = useInvalidAllLastRun(FlowType.snippet, snippetId)
  const invalidateRunHistory = useInvalidateWorkflowRunHistory()
  const { fetchInspectVars } = useSetWorkflowVarsWithValue({
    flowType: FlowType.snippet,
    flowId: snippetId,
  })

  const handleRun = useCallback(async (
    params: SnippetDraftRunPayload,
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
    const runHistoryUrl = `/snippets/${snippetId}/workflow-runs`
    workflowStore.setState({ historyWorkflowData: undefined })
    const workflowContainer = document.getElementById('workflow-container')

    const {
      clientWidth,
      clientHeight,
    } = workflowContainer!

    const url = `/snippets/${snippetId}/workflows/draft/run`

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

    abortControllerRef.current?.abort()
    abortControllerRef.current = null

    ssePost(
      url,
      {
        body: params,
      },
      {
        getAbortController: (controller: AbortController) => {
          abortControllerRef.current = controller
        },
        onWorkflowStarted: (params) => {
          handleWorkflowStarted(params)
          invalidateRunHistory(runHistoryUrl)

          onWorkflowStarted?.(params)
        },
        onWorkflowFinished: (params) => {
          handleWorkflowFinished(params)
          invalidateRunHistory(runHistoryUrl)
          fetchInspectVars({})
          invalidAllLastRun()

          onWorkflowFinished?.(params)
        },
        onError: (params) => {
          handleWorkflowFailed()
          invalidateRunHistory(runHistoryUrl)

          onError?.(params)
        },
        onNodeStarted: (params) => {
          handleWorkflowNodeStarted(
            params,
            {
              clientWidth,
              clientHeight,
            },
          )

          onNodeStarted?.(params)
        },
        onNodeFinished: (params) => {
          handleWorkflowNodeFinished(params)

          onNodeFinished?.(params)
        },
        onIterationStart: (params) => {
          handleWorkflowNodeIterationStarted(
            params,
            {
              clientWidth,
              clientHeight,
            },
          )

          onIterationStart?.(params)
        },
        onIterationNext: (params) => {
          handleWorkflowNodeIterationNext(params)

          onIterationNext?.(params)
        },
        onIterationFinish: (params) => {
          handleWorkflowNodeIterationFinished(params)

          onIterationFinish?.(params)
        },
        onLoopStart: (params) => {
          handleWorkflowNodeLoopStarted(
            params,
            {
              clientWidth,
              clientHeight,
            },
          )

          onLoopStart?.(params)
        },
        onLoopNext: (params) => {
          handleWorkflowNodeLoopNext(params)

          onLoopNext?.(params)
        },
        onLoopFinish: (params) => {
          handleWorkflowNodeLoopFinished(params)

          onLoopFinish?.(params)
        },
        onNodeRetry: (params) => {
          handleWorkflowNodeRetry(params)

          onNodeRetry?.(params)
        },
        onAgentLog: (params) => {
          handleWorkflowAgentLog(params)

          onAgentLog?.(params)
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
  }, [doSyncWorkflowDraft, fetchInspectVars, handleWorkflowAgentLog, handleWorkflowFailed, handleWorkflowFinished, handleWorkflowNodeFinished, handleWorkflowNodeIterationFinished, handleWorkflowNodeIterationNext, handleWorkflowNodeIterationStarted, handleWorkflowNodeLoopFinished, handleWorkflowNodeLoopNext, handleWorkflowNodeLoopStarted, handleWorkflowNodeRetry, handleWorkflowNodeStarted, handleWorkflowStarted, handleWorkflowTextChunk, handleWorkflowTextReplace, invalidAllLastRun, invalidateRunHistory, snippetId, store, workflowStore])

  const handleStopRun = useCallback((taskId: string) => {
    stopWorkflowRun(`/snippets/${snippetId}/workflow-runs/tasks/${taskId}/stop`)

    if (abortControllerRef.current)
      abortControllerRef.current.abort()

    abortControllerRef.current = null
  }, [snippetId])

  const handleRestoreFromPublishedWorkflow = useCallback((publishedWorkflow: VersionHistory) => {
    const nodes = publishedWorkflow.graph.nodes.map(node => ({ ...node, selected: false, data: { ...node.data, selected: false } }))
    const edges = publishedWorkflow.graph.edges
    const viewport = publishedWorkflow.graph.viewport!
    handleUpdateWorkflowCanvas({
      nodes,
      edges,
      viewport,
    })

    workflowStore.getState().setEnvironmentVariables([])
  }, [handleUpdateWorkflowCanvas, workflowStore])

  return {
    handleBackupDraft,
    handleLoadBackupDraft,
    handleRun,
    handleStopRun,
    handleRestoreFromPublishedWorkflow,
  }
}
