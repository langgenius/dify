import { useCallback } from 'react'
import {
  useReactFlow,
  useStoreApi,
} from 'reactflow'
import produce from 'immer'
import { v4 as uuidV4 } from 'uuid'
import { usePathname } from 'next/navigation'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { useWorkflowUpdate } from '@/app/components/workflow/hooks/use-workflow-interactions'
import { useWorkflowRunEvent } from '@/app/components/workflow/hooks/use-workflow-run-event/use-workflow-run-event'
import { useStore as useAppStore } from '@/app/components/app/store'
import type { IOtherOptions } from '@/service/base'
import { ssePost } from '@/service/base'
import { stopWorkflowRun } from '@/service/workflow'
import { useFeaturesStore } from '@/app/components/base/features/hooks'
import { AudioPlayerManager } from '@/app/components/base/audio-btn/audio.player.manager'
import type { VersionHistory } from '@/types/workflow'
import { noop } from 'lodash-es'
import { useNodesSyncDraft } from './use-nodes-sync-draft'
import { useInvalidAllLastRun } from '@/service/use-workflow'
import { useSetWorkflowVarsWithValue } from '../../workflow/hooks/use-fetch-workflow-inspect-vars'
import { useConfigsMap } from './use-configs-map'

export const useWorkflowRun = () => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const reactflow = useReactFlow()
  const featuresStore = useFeaturesStore()
  const { doSyncWorkflowDraft } = useNodesSyncDraft()
  const { handleUpdateWorkflowCanvas } = useWorkflowUpdate()
  const pathname = usePathname()
  const appId = useAppStore.getState().appDetail?.id
  const invalidAllLastRun = useInvalidAllLastRun(appId as string)
  const configsMap = useConfigsMap()
  const { fetchInspectVars } = useSetWorkflowVarsWithValue({
    flowId: appId as string,
    ...configsMap,
  })

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
    const { features } = featuresStore!.getState()

    if (!backupDraft) {
      setBackupDraft({
        nodes: getNodes(),
        edges,
        viewport: getViewport(),
        features,
        environmentVariables,
      })
      doSyncWorkflowDraft()
    }
  }, [reactflow, workflowStore, store, featuresStore, doSyncWorkflowDraft])

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
        features,
        environmentVariables,
      } = backupDraft
      handleUpdateWorkflowCanvas({
        nodes,
        edges,
        viewport,
      })
      setEnvironmentVariables(environmentVariables)
      featuresStore!.setState({ features })
      setBackupDraft(undefined)
    }
  }, [handleUpdateWorkflowCanvas, workflowStore, featuresStore])

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
    workflowStore.setState({ historyWorkflowData: undefined })
    const appDetail = useAppStore.getState().appDetail
    const workflowContainer = document.getElementById('workflow-container')

    const {
      clientWidth,
      clientHeight,
    } = workflowContainer!

    const isInWorkflowDebug = appDetail?.mode === 'workflow'

    let url = ''
    if (appDetail?.mode === 'advanced-chat')
      url = `/apps/${appDetail.id}/advanced-chat/workflows/draft/run`

    if (isInWorkflowDebug)
      url = `/apps/${appDetail.id}/workflows/draft/run`

    const {
      setWorkflowRunningData,
    } = workflowStore.getState()
    setWorkflowRunningData({
      result: {
        status: WorkflowRunningStatus.Running,
      },
      tracing: [],
      resultText: '',
    })

    let ttsUrl = ''
    let ttsIsPublic = false
    if (params.token) {
      ttsUrl = '/text-to-audio'
      ttsIsPublic = true
    }
    else if (params.appId) {
      if (pathname.search('explore/installed') > -1)
        ttsUrl = `/installed-apps/${params.appId}/text-to-audio`
      else
        ttsUrl = `/apps/${params.appId}/text-to-audio`
    }
    const player = AudioPlayerManager.getInstance().getAudioPlayer(ttsUrl, ttsIsPublic, uuidV4(), 'none', 'none', noop)

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

          if (onWorkflowFinished)
            onWorkflowFinished(params)
          if (isInWorkflowDebug) {
            fetchInspectVars()
            invalidAllLastRun()
          }
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
        onTTSChunk: (messageId: string, audio: string) => {
          if (!audio || audio === '')
            return
          player.playAudioWithAudio(audio, true)
          AudioPlayerManager.getInstance().resetMsgId(messageId)
        },
        onTTSEnd: (messageId: string, audio: string) => {
          player.playAudioWithAudio(audio, false)
        },
        ...restCallback,
      },
    )
  }, [store, doSyncWorkflowDraft, workflowStore, pathname, handleWorkflowStarted, handleWorkflowFinished, fetchInspectVars, invalidAllLastRun, handleWorkflowFailed, handleWorkflowNodeStarted, handleWorkflowNodeFinished, handleWorkflowNodeIterationStarted, handleWorkflowNodeIterationNext, handleWorkflowNodeIterationFinished, handleWorkflowNodeLoopStarted, handleWorkflowNodeLoopNext, handleWorkflowNodeLoopFinished, handleWorkflowNodeRetry, handleWorkflowAgentLog, handleWorkflowTextChunk, handleWorkflowTextReplace],
  )

  const handleStopRun = useCallback((taskId: string) => {
    const appId = useAppStore.getState().appDetail?.id

    stopWorkflowRun(`/apps/${appId}/workflow-runs/tasks/${taskId}/stop`)
  }, [])

  const handleRestoreFromPublishedWorkflow = useCallback((publishedWorkflow: VersionHistory) => {
    const nodes = publishedWorkflow.graph.nodes.map(node => ({ ...node, selected: false, data: { ...node.data, selected: false } }))
    const edges = publishedWorkflow.graph.edges
    const viewport = publishedWorkflow.graph.viewport!
    handleUpdateWorkflowCanvas({
      nodes,
      edges,
      viewport,
    })
    const mappedFeatures = {
      opening: {
        enabled: !!publishedWorkflow.features.opening_statement || !!publishedWorkflow.features.suggested_questions.length,
        opening_statement: publishedWorkflow.features.opening_statement,
        suggested_questions: publishedWorkflow.features.suggested_questions,
      },
      suggested: publishedWorkflow.features.suggested_questions_after_answer,
      text2speech: publishedWorkflow.features.text_to_speech,
      speech2text: publishedWorkflow.features.speech_to_text,
      citation: publishedWorkflow.features.retriever_resource,
      moderation: publishedWorkflow.features.sensitive_word_avoidance,
      file: publishedWorkflow.features.file_upload,
    }

    featuresStore?.setState({ features: mappedFeatures })
    workflowStore.getState().setEnvironmentVariables(publishedWorkflow.environment_variables || [])
  }, [featuresStore, handleUpdateWorkflowCanvas, workflowStore])

  return {
    handleBackupDraft,
    handleLoadBackupDraft,
    handleRun,
    handleStopRun,
    handleRestoreFromPublishedWorkflow,
  }
}
