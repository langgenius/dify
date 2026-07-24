'use client'

import type { Features as FeaturesData } from '@/app/components/base/features/types'
import type { InjectWorkflowStoreSliceFn } from '@/app/components/workflow/store'
import { useSearchParams } from 'next/navigation'
import {
  useEffect,
  useMemo,
} from 'react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { FeaturesProvider } from '@/app/components/base/features'
import Loading from '@/app/components/base/loading'
import { FILE_EXTS } from '@/app/components/base/prompt-editor/constants'
import WorkflowWithDefaultContext from '@/app/components/workflow'
import {
  WorkflowContextProvider,
} from '@/app/components/workflow/context'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { useTriggerStatusStore } from '@/app/components/workflow/store/trigger-status'
import {
  SupportUploadFileTypes,
} from '@/app/components/workflow/types'
import {
  initialEdges,
  initialNodes,
} from '@/app/components/workflow/utils'
import { useAppContext } from '@/context/app-context'
import { fetchRunDetail } from '@/service/log'
import { useAppTriggers } from '@/service/use-tools'
import { AppModeEnum } from '@/types/app'
import WorkflowAppMain from './components/workflow-main'

import { useGetRunAndTraceUrl } from './hooks/use-get-run-and-trace-url'
import {
  useWorkflowInit,
} from './hooks/use-workflow-init'
import { createWorkflowSlice } from './store/workflow/workflow-slice'

const WorkflowAppWithAdditionalContext = () => {
  const {
    data,
    isLoading,
    fileUploadConfigResponse,
  } = useWorkflowInit()
  const workflowStore = useWorkflowStore()
  const { isLoadingCurrentWorkspace, currentWorkspace } = useAppContext()

  // Initialize trigger status at application level
  const { setTriggerStatuses } = useTriggerStatusStore()
  const appDetail = useAppStore(s => s.appDetail)
  const appId = appDetail?.id
  const isWorkflowMode = appDetail?.mode === AppModeEnum.WORKFLOW
  const { data: triggersResponse } = useAppTriggers(isWorkflowMode ? appId : undefined, {
    staleTime: 5 * 60 * 1000, // 5 minutes cache
    refetchOnWindowFocus: false,
  })

  // Sync trigger statuses to store when data loads
  useEffect(() => {
    if (triggersResponse?.data) {
      // Map API status to EntryNodeStatus: 'enabled' stays 'enabled', all others become 'disabled'
      const statusMap = triggersResponse.data.reduce((acc, trigger) => {
        acc[trigger.node_id] = trigger.status === 'enabled' ? 'enabled' : 'disabled'
        return acc
      }, {} as Record<string, 'enabled' | 'disabled'>)

      setTriggerStatuses(statusMap)
    }
  }, [triggersResponse?.data, setTriggerStatuses])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Reset the loaded flag when component unmounts
      workflowStore.setState({ isWorkflowDataLoaded: false })

      // Cancel any pending debounced sync operations
      const { debouncedSyncWorkflowDraft } = workflowStore.getState()
      // The debounced function from lodash has a cancel method
      if (debouncedSyncWorkflowDraft && 'cancel' in debouncedSyncWorkflowDraft)
        (debouncedSyncWorkflowDraft as any).cancel()
    }
  }, [workflowStore])

  const nodesData = useMemo(() => {
    if (data)
      return initialNodes(data.graph.nodes, data.graph.edges)

    return []
  }, [data])
  const edgesData = useMemo(() => {
    if (data)
      return initialEdges(data.graph.edges, data.graph.nodes)

    return []
  }, [data])

  const searchParams = useSearchParams()
  const { getWorkflowRunAndTraceUrl } = useGetRunAndTraceUrl()
  const replayRunId = searchParams.get('replayRunId')

  useEffect(() => {
    if (!replayRunId)
      return
    const { runUrl } = getWorkflowRunAndTraceUrl(replayRunId)
    if (!runUrl)
      return
    fetchRunDetail(runUrl).then((res) => {
      const { setInputs, setShowInputsPanel, setShowDebugAndPreviewPanel } = workflowStore.getState()
      const rawInputs = res.inputs
      let parsedInputs: Record<string, unknown> | null = null

      if (typeof rawInputs === 'string') {
        try {
          const maybeParsed = JSON.parse(rawInputs) as unknown
          if (maybeParsed && typeof maybeParsed === 'object' && !Array.isArray(maybeParsed))
            parsedInputs = maybeParsed as Record<string, unknown>
        }
        catch (error) {
          console.error('Failed to parse workflow run inputs', error)
        }
      }
      else if (rawInputs && typeof rawInputs === 'object' && !Array.isArray(rawInputs)) {
        parsedInputs = rawInputs as Record<string, unknown>
      }

      if (!parsedInputs)
        return

      const userInputs: Record<string, string | number | boolean> = {}
      Object.entries(parsedInputs).forEach(([key, value]) => {
        if (key.startsWith('sys.'))
          return

        if (value == null) {
          userInputs[key] = ''
          return
        }

        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          userInputs[key] = value
          return
        }

        try {
          userInputs[key] = JSON.stringify(value)
        }
        catch {
          userInputs[key] = String(value)
        }
      })

      if (!Object.keys(userInputs).length)
        return

      setInputs(userInputs)
      setShowInputsPanel(true)
      setShowDebugAndPreviewPanel(true)
    })
  }, [replayRunId, workflowStore, getWorkflowRunAndTraceUrl])

  if (!data || isLoading || isLoadingCurrentWorkspace || !currentWorkspace.id) {
    return (
      <div className="relative flex h-full w-full items-center justify-center">
        <Loading />
      </div>
    )
  }

  const features = data.features || {}
  const initialFeatures: FeaturesData = {
    file: {
      image: {
        enabled: !!features.file_upload?.image?.enabled,
        number_limits: features.file_upload?.image?.number_limits || 3,
        transfer_methods: features.file_upload?.image?.transfer_methods || ['local_file', 'remote_url'],
      },
      enabled: !!(features.file_upload?.enabled || features.file_upload?.image?.enabled),
      allowed_file_types: features.file_upload?.allowed_file_types || [SupportUploadFileTypes.image],
      allowed_file_extensions: features.file_upload?.allowed_file_extensions || FILE_EXTS[SupportUploadFileTypes.image].map(ext => `.${ext}`),
      allowed_file_upload_methods: features.file_upload?.allowed_file_upload_methods || features.file_upload?.image?.transfer_methods || ['local_file', 'remote_url'],
      number_limits: features.file_upload?.number_limits || features.file_upload?.image?.number_limits || 3,
      fileUploadConfig: fileUploadConfigResponse,
    },
    opening: {
      enabled: !!features.opening_statement,
      opening_statement: features.opening_statement,
      suggested_questions: features.suggested_questions,
    },
    suggested: features.suggested_questions_after_answer || { enabled: false },
    speech2text: features.speech_to_text || { enabled: false },
    text2speech: features.text_to_speech || { enabled: false },
    citation: features.retriever_resource || { enabled: false },
    moderation: features.sensitive_word_avoidance || { enabled: false },
  }

  return (
    <WorkflowWithDefaultContext
      edges={edgesData}
      nodes={nodesData}
    >
      <FeaturesProvider features={initialFeatures}>
        <WorkflowAppMain
          nodes={nodesData}
          edges={edgesData}
          viewport={data.graph.viewport}
        />
      </FeaturesProvider>
    </WorkflowWithDefaultContext>
  )
}

const WorkflowAppWrapper = () => {
  return (
    <WorkflowContextProvider
      injectWorkflowStoreSliceFn={createWorkflowSlice as InjectWorkflowStoreSliceFn}
    >
      <WorkflowAppWithAdditionalContext />
    </WorkflowContextProvider>
  )
}

export default WorkflowAppWrapper
