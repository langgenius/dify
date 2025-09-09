'use client'

import {
  useEffect,
  useMemo,
} from 'react'
import useSWR from 'swr'
import {
  SupportUploadFileTypes,
} from '@/app/components/workflow/types'
import {
  useWorkflowInit,
} from './hooks'
import { useAppTriggers } from '@/service/use-tools'
import { useTriggerStatusStore } from '@/app/components/workflow/store/trigger-status'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useWorkflowStore } from '@/app/components/workflow/store'
import {
  initialEdges,
  initialNodes,
} from '@/app/components/workflow/utils'
import Loading from '@/app/components/base/loading'
import { FeaturesProvider } from '@/app/components/base/features'
import type { Features as FeaturesData } from '@/app/components/base/features/types'
import { FILE_EXTS } from '@/app/components/base/prompt-editor/constants'
import { fetchFileUploadConfig } from '@/service/common'
import { useAppContext } from '@/context/app-context'
import WorkflowWithDefaultContext from '@/app/components/workflow'
import {
  WorkflowContextProvider,
} from '@/app/components/workflow/context'
import { createWorkflowSlice } from './store/workflow/workflow-slice'
import WorkflowAppMain from './components/workflow-main'

const WorkflowAppWithAdditionalContext = () => {
  const {
    data,
    isLoading,
  } = useWorkflowInit()
  const workflowStore = useWorkflowStore()
  const { isLoadingCurrentWorkspace, currentWorkspace } = useAppContext()
  const { data: fileUploadConfigResponse } = useSWR({ url: '/files/upload' }, fetchFileUploadConfig)

  // Initialize trigger status at application level
  const { setTriggerStatuses } = useTriggerStatusStore()
  const appDetail = useAppStore(s => s.appDetail)
  const appId = appDetail?.id
  const isWorkflowMode = appDetail?.mode === 'workflow'
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

  if (!data || isLoading || isLoadingCurrentWorkspace || !currentWorkspace.id) {
    return (
      <div className='relative flex h-full w-full items-center justify-center'>
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
      injectWorkflowStoreSliceFn={createWorkflowSlice}
    >
      <WorkflowAppWithAdditionalContext />
    </WorkflowContextProvider>
  )
}

export default WorkflowAppWrapper
