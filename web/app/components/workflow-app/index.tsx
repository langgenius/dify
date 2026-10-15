'use client'

import type { Features as FeaturesData } from '@/app/components/base/features/types'
import type { InjectWorkflowStoreSliceFn } from '@/app/components/workflow/store'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useEffect, useMemo } from 'react'
import { isWorkflowAppMode } from '@/app/components/apps/app-type'
import { FeaturesProvider } from '@/app/components/base/features'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import WorkflowWithDefaultContext from '@/app/components/workflow'
import { WorkflowContextProvider } from '@/app/components/workflow/context'
import { EditorResourceScope } from '@/app/components/workflow/editor-resource/provider'
import { workflowAppIdentityAtom } from '@/app/components/workflow/editor-resource/state'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { useTriggerStatusStore } from '@/app/components/workflow/store/trigger-status'
import { initialEdges, initialNodes } from '@/app/components/workflow/utils'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { currentWorkspaceAtom, currentWorkspaceLoadingAtom } from '@/context/workspace-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { useParams, useSearchParams } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { fetchRunDetail } from '@/service/log'
import { useAppTriggers } from '@/service/use-tools'
import { getAppACLCapabilities } from '@/utils/permission'
import WorkflowAppMain from './components/workflow-main'
import { useGetRunAndTraceUrl } from './hooks/use-get-run-and-trace-url'
import { useWorkflowInit } from './hooks/use-workflow-init'
import { createWorkflowSlice } from './store/workflow/workflow-slice'
import { buildInitialFeatures, buildTriggerStatusMap, coerceReplayUserInputs } from './utils'

const WorkflowAppWithAdditionalContext = () => {
  const { data, isLoading, fileUploadConfigResponse } = useWorkflowInit()
  const workflowStore = useWorkflowStore()
  const isLoadingCurrentWorkspace = useAtomValue(currentWorkspaceLoadingAtom)
  const currentWorkspace = useAtomValue(currentWorkspaceAtom)
  const { data: currentUserId } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.id,
  })
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)

  // Initialize trigger status at application level
  const { setTriggerStatuses } = useTriggerStatusStore()
  const { appId } = useAtomValue(workflowAppIdentityAtom)
  const { data: appDetail } = useSuspenseQuery(
    consoleQuery.apps.byAppId.get.queryOptions({ input: { params: { app_id: appId } } }),
  )
  const appACLCapabilities = useMemo(
    () =>
      getAppACLCapabilities(appDetail.permission_keys, {
        currentUserId,
        resourceMaintainer: appDetail.maintainer,
        workspacePermissionKeys,
      }),
    [appDetail.maintainer, appDetail.permission_keys, currentUserId, workspacePermissionKeys],
  )
  const isWorkflowMode = appDetail.mode === 'workflow'
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
    if (!replayRunId || !appACLCapabilities.canTestAndRun) return
    const { runUrl } = getWorkflowRunAndTraceUrl(replayRunId)
    if (!runUrl) return
    fetchRunDetail(runUrl).then((res) => {
      const { setInputs, setShowInputsPanel, setShowDebugAndPreviewPanel } =
        workflowStore.getState()
      const rawInputs = res.inputs
      let parsedInputs: unknown = rawInputs

      if (typeof rawInputs === 'string') {
        try {
          parsedInputs = JSON.parse(rawInputs) as unknown
        } catch (error) {
          console.error('Failed to parse workflow run inputs', error)
          return
        }
      }

      const userInputs = coerceReplayUserInputs(parsedInputs)

      if (!userInputs || !Object.keys(userInputs).length) return

      setInputs(userInputs)
      setShowInputsPanel(true)
      setShowDebugAndPreviewPanel(true)
    })
  }, [appACLCapabilities.canTestAndRun, replayRunId, workflowStore, getWorkflowRunAndTraceUrl])

  if (!data || isLoading || isLoadingCurrentWorkspace || !currentWorkspace.id) {
    return (
      <div className="relative flex size-full items-center justify-center">
        <LoadingPlaceholder />
      </div>
    )
  }

  const initialFeatures: FeaturesData = buildInitialFeatures(
    data.features,
    fileUploadConfigResponse,
  )

  return (
    <WorkflowWithDefaultContext edges={edgesData} nodes={nodesData}>
      <FeaturesProvider features={initialFeatures}>
        <WorkflowAppMain nodes={nodesData} edges={edgesData} viewport={data.graph.viewport} />
      </FeaturesProvider>
    </WorkflowWithDefaultContext>
  )
}

const WorkflowAppWrapper = () => {
  const { appId } = useParams<{ appId: string }>()
  const { data: mode } = useSuspenseQuery(
    consoleQuery.apps.byAppId.get.queryOptions({
      input: { params: { app_id: appId } },
      select: (app) => app.mode,
    }),
  )
  if (!isWorkflowAppMode(mode)) throw new Error('This app does not have a workflow editor')

  return (
    <EditorResourceScope identity={{ kind: 'app', appId }}>
      <WorkflowContextProvider
        injectWorkflowStoreSliceFn={createWorkflowSlice as InjectWorkflowStoreSliceFn}
      >
        <WorkflowAppWithAdditionalContext />
      </WorkflowContextProvider>
    </EditorResourceScope>
  )
}

export default WorkflowAppWrapper
