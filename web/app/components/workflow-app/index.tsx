'use client'

import type { Features as FeaturesData } from '@/app/components/base/features/types'
import type { InjectWorkflowStoreSliceFn } from '@/app/components/workflow/store'
import {
  useEffect,
  useMemo,
} from 'react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { FeaturesProvider } from '@/app/components/base/features'
import Loading from '@/app/components/base/loading'
import WorkflowWithDefaultContext from '@/app/components/workflow'
import {
  WorkflowContextProvider,
} from '@/app/components/workflow/context'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { useTriggerStatusStore } from '@/app/components/workflow/store/trigger-status'
import {
  initialEdges,
  initialNodes,
} from '@/app/components/workflow/utils'
import { useAppContext } from '@/context/app-context'
import { useSearchParams } from '@/next/navigation'
import { fetchRunDetail } from '@/service/log'
import { useAppTriggers } from '@/service/use-tools'
import { AppModeEnum } from '@/types/app'
import WorkflowAppMain from './components/workflow-main'

import { useGetRunAndTraceUrl } from './hooks/use-get-run-and-trace-url'
import {
  useWorkflowInit,
} from './hooks/use-workflow-init'
import { createWorkflowSlice } from './store/workflow/workflow-slice'
import {
  buildInitialFeatures,
  buildTriggerStatusMap,
  coerceReplayUserInputs,
} from './utils'

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
      setTriggerStatuses(buildTriggerStatusMap(triggersResponse.data))
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
    if (data) {
      const processedNodes = initialNodes(data.graph.nodes, data.graph.edges)
      return processedNodes
    }
    return []
  }, [data])

  const edgesData = useMemo(() => {
    if (data) {
      const processedEdges = initialEdges(data.graph.edges, data.graph.nodes)
      return processedEdges
    }
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
      let parsedInputs: unknown = rawInputs

      if (typeof rawInputs === 'string') {
        try {
          parsedInputs = JSON.parse(rawInputs) as unknown
        }
        catch (error) {
          console.error('Failed to parse workflow run inputs', error)
          return
        }
      }

      const userInputs = coerceReplayUserInputs(parsedInputs)

      if (!userInputs || !Object.keys(userInputs).length)
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

  const initialFeatures: FeaturesData = buildInitialFeatures(data.features, fileUploadConfigResponse)

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
