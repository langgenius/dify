import type { useNodesSyncDraft } from './use-nodes-sync-draft'
import type { StreamCallbacks } from '@/service/event-stream'
import type { WorkflowVersionListItem } from '@/service/workflow-queries'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { produce } from 'immer'
import { useAtomValue } from 'jotai'
import { useCallback, useRef } from 'react'
import { useReactFlow, useStoreApi } from 'reactflow'
import {
  editorResourceAtom,
  knowledgePipelineIdentityAtom,
} from '@/app/components/workflow/editor-resource/state'
import { useSetWorkflowVarsWithValue } from '@/app/components/workflow/hooks/use-fetch-workflow-inspect-vars'
import { useWorkflowRunEvent } from '@/app/components/workflow/hooks/use-workflow-run-event/use-workflow-run-event'
import { useWorkflowUpdate } from '@/app/components/workflow/hooks/use-workflow-update'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import {
  toEnvironmentVariables,
  toGraphEdges,
  toGraphNodes,
  toStoredViewport,
} from '@/app/components/workflow/utils/published-workflow'
import { consoleClient, consoleQuery } from '@/service/console'
import { streamEvents } from '@/service/event-stream'
import { lastRunQueryKey, workflowRunHistoryQueryOptions } from '@/service/workflow-queries'
import { toPipelineVariables } from '../utils/query-select'
import { useNodesSyncDraftByCanEdit } from './use-nodes-sync-draft'

type DoSyncWorkflowDraft = ReturnType<typeof useNodesSyncDraft>['doSyncWorkflowDraft']

const usePipelineRunBase = (doSyncWorkflowDraft: DoSyncWorkflowDraft) => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const reactflow = useReactFlow()
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
    const { getNodes, edges } = store.getState()
    const { getViewport } = reactflow
    const { backupDraft, setBackupDraft, environmentVariables, ragPipelineVariables } =
      workflowStore.getState()

    if (!backupDraft) {
      setBackupDraft({
        nodes: getNodes(),
        edges,
        viewport: getViewport(),
        environmentVariables,
        ragPipelineVariables,
      })
      doSyncWorkflowDraft()
    }
  }, [reactflow, workflowStore, store, doSyncWorkflowDraft])

  const handleLoadBackupDraft = useCallback(() => {
    const { backupDraft, setBackupDraft, setEnvironmentVariables, setRagPipelineVariables } =
      workflowStore.getState()

    if (backupDraft) {
      const { nodes, edges, viewport, environmentVariables, ragPipelineVariables } = backupDraft
      handleUpdateWorkflowCanvas({
        nodes,
        edges,
        viewport,
      })
      setEnvironmentVariables(environmentVariables)
      if (ragPipelineVariables) setRagPipelineVariables?.(ragPipelineVariables)
      setBackupDraft(undefined)
    }
  }, [handleUpdateWorkflowCanvas, workflowStore])

  const pipelineId = useAtomValue(knowledgePipelineIdentityAtom).pipelineId
  const resource = useAtomValue(editorResourceAtom)
  const queryClient = useQueryClient()
  const invalidAllLastRun = useCallback(
    () => queryClient.invalidateQueries({ queryKey: lastRunQueryKey(resource) }),
    [queryClient, resource],
  )
  const invalidateRunHistory = useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: workflowRunHistoryQueryOptions(resource).queryKey,
      }),
    [queryClient, resource],
  )
  const { fetchInspectVars } = useSetWorkflowVarsWithValue()

  const handleRun = useCallback(
    async (params: any, callback?: StreamCallbacks) => {
      const { getNodes, setNodes } = store.getState()
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

      workflowStore.setState({ historyWorkflowData: undefined })
      const workflowContainer = document.getElementById('workflow-container')

      const { clientWidth, clientHeight } = workflowContainer!

      const { setWorkflowRunningData } = workflowStore.getState()
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

      streamEvents(
        (options) =>
          consoleClient.rag.pipelines.byPipelineId.workflows.draft.run.post(
            { params: { pipeline_id: pipelineId }, body: params },
            options,
          ),
        {
          getAbortController: (controller: AbortController) => {
            abortControllerRef.current = controller
          },
          onWorkflowStarted: (params) => {
            handleWorkflowStarted(params)
            invalidateRunHistory()

            if (onWorkflowStarted) onWorkflowStarted(params)
          },
          onWorkflowFinished: (params) => {
            handleWorkflowFinished(params)
            invalidateRunHistory()
            fetchInspectVars({})
            invalidAllLastRun()

            if (onWorkflowFinished) onWorkflowFinished(params)
          },
          onError: (params) => {
            handleWorkflowFailed()
            invalidateRunHistory()

            if (onError) onError(params)
          },
          onNodeStarted: (params) => {
            handleWorkflowNodeStarted(params, {
              clientWidth,
              clientHeight,
            })

            if (onNodeStarted) onNodeStarted(params)
          },
          onNodeFinished: (params) => {
            handleWorkflowNodeFinished(params)

            if (onNodeFinished) onNodeFinished(params)
          },
          onIterationStart: (params) => {
            handleWorkflowNodeIterationStarted(params, {
              clientWidth,
              clientHeight,
            })

            if (onIterationStart) onIterationStart(params)
          },
          onIterationNext: (params) => {
            handleWorkflowNodeIterationNext(params)

            if (onIterationNext) onIterationNext(params)
          },
          onIterationFinish: (params) => {
            handleWorkflowNodeIterationFinished(params)

            if (onIterationFinish) onIterationFinish(params)
          },
          onLoopStart: (params) => {
            handleWorkflowNodeLoopStarted(params, {
              clientWidth,
              clientHeight,
            })

            if (onLoopStart) onLoopStart(params)
          },
          onLoopNext: (params) => {
            handleWorkflowNodeLoopNext(params)

            if (onLoopNext) onLoopNext(params)
          },
          onLoopFinish: (params) => {
            handleWorkflowNodeLoopFinished(params)

            if (onLoopFinish) onLoopFinish(params)
          },
          onNodeRetry: (params) => {
            handleWorkflowNodeRetry(params)

            if (onNodeRetry) onNodeRetry(params)
          },
          onAgentLog: (params) => {
            handleWorkflowAgentLog(params)

            if (onAgentLog) onAgentLog(params)
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
    },
    [
      store,
      doSyncWorkflowDraft,
      workflowStore,
      handleWorkflowStarted,
      handleWorkflowFinished,
      fetchInspectVars,
      invalidAllLastRun,
      invalidateRunHistory,
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
      pipelineId,
    ],
  )

  const { mutate: stopRun } = useMutation(
    consoleQuery.rag.pipelines.byPipelineId.workflowRuns.tasks.byTaskId.stop.post.mutationOptions(),
  )

  const handleStopRun = useCallback(
    (taskId: string) => {
      stopRun({ params: { pipeline_id: pipelineId, task_id: taskId } })

      if (abortControllerRef.current) abortControllerRef.current.abort()

      abortControllerRef.current = null
    },
    [pipelineId, stopRun],
  )

  const handleRestoreFromPublishedWorkflow = useCallback(
    (publishedWorkflow: WorkflowVersionListItem) => {
      const nodes = toGraphNodes(publishedWorkflow.graph).map((node) => ({
        ...node,
        selected: false,
        data: { ...node.data, selected: false },
      }))
      const edges = toGraphEdges(publishedWorkflow.graph)
      const viewport = toStoredViewport(publishedWorkflow.graph)
      handleUpdateWorkflowCanvas({
        nodes,
        edges,
        viewport,
      })

      workflowStore
        .getState()
        .setEnvironmentVariables(toEnvironmentVariables(publishedWorkflow.environment_variables))
      workflowStore
        .getState()
        .setRagPipelineVariables?.(toPipelineVariables(publishedWorkflow.rag_pipeline_variables))
    },
    [handleUpdateWorkflowCanvas, workflowStore],
  )

  return {
    handleBackupDraft,
    handleLoadBackupDraft,
    handleRun,
    handleStopRun,
    handleRestoreFromPublishedWorkflow,
  }
}

export const usePipelineRunByCanEdit = (canEdit: boolean) => {
  const { doSyncWorkflowDraft } = useNodesSyncDraftByCanEdit(canEdit)

  return usePipelineRunBase(doSyncWorkflowDraft)
}
