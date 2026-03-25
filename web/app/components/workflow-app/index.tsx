'use client'

import type { ReactNode } from 'react'
import type { Features as FeaturesData } from '@/app/components/base/features/types'
import type { InjectWorkflowStoreSliceFn } from '@/app/components/workflow/store'
import { useQueryState } from 'nuqs'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { FeaturesProvider } from '@/app/components/base/features'
import Loading from '@/app/components/base/loading'
import WorkflowWithDefaultContext from '@/app/components/workflow'
import { useCollaboration } from '@/app/components/workflow/collaboration'
import { collaborationManager } from '@/app/components/workflow/collaboration/core/collaboration-manager'
import {
  WorkflowContextProvider,
} from '@/app/components/workflow/context'
import { HeaderShell } from '@/app/components/workflow/header'
import OnlineUsers from '@/app/components/workflow/header/online-users'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import { useTriggerStatusStore } from '@/app/components/workflow/store/trigger-status'
import {
  BlockEnum,
  ViewType,
} from '@/app/components/workflow/types'
import {
  initialEdges,
  initialNodes,
} from '@/app/components/workflow/utils'
import { useAppContext } from '@/context/app-context'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import dynamic from '@/next/dynamic'
import { useSearchParams } from '@/next/navigation'
import { upgradeAppRuntime } from '@/service/apps'
import { fetchRunDetail } from '@/service/log'
import { useAppTriggers } from '@/service/use-tools'
import { AppModeEnum } from '@/types/app'
import { useFeatures } from '../base/features/hooks'
import ViewPicker from '../workflow/view-picker'
import SandboxMigrationModal from './components/sandbox-migration-modal'
import UpgradedFromBanner from './components/upgraded-from-banner'
import WorkflowAppMain from './components/workflow-main'
import { useGetRunAndTraceUrl } from './hooks/use-get-run-and-trace-url'
import { useNodesSyncDraft } from './hooks/use-nodes-sync-draft'
import {
  useWorkflowInit,
} from './hooks/use-workflow-init'
import { parseAsViewType, WORKFLOW_VIEW_PARAM_KEY } from './search-params'
import { createWorkflowSlice } from './store/workflow/workflow-slice'
import { getSandboxMigrationDismissed, setSandboxMigrationDismissed } from './utils/sandbox-migration-storage'
import {
  buildInitialFeatures,
  buildTriggerStatusMap,
  coerceReplayUserInputs,
} from './utils'

const SkillMain = dynamic(() => import('@/app/components/workflow/skill/main'), {
  ssr: false,
})

const CollaborationSession = () => {
  const appId = useStore(s => s.appId)
  useCollaboration(appId || '')
  return null
}

type WorkflowViewContentProps = {
  renderGraph: (headerLeftSlot: ReactNode) => ReactNode
  reload: () => Promise<void>
}

const WorkflowViewContent = ({
  renderGraph,
  reload,
}: WorkflowViewContentProps) => {
  const features = useFeatures(s => s.features)
  const isSupportSandbox = !!features.sandbox?.enabled
  const isResponding = useStore(s => s.isResponding)
  const [viewType, doSetViewType] = useQueryState(WORKFLOW_VIEW_PARAM_KEY, parseAsViewType)
  const { syncWorkflowDraftImmediately } = useNodesSyncDraft()
  const pendingSyncRef = useRef<Promise<void> | null>(null)
  const [isGraphRefreshing, setIsGraphRefreshing] = useState(false)

  const refreshGraph = useCallback(() => {
    setIsGraphRefreshing(true)
    return reload().finally(() => {
      setIsGraphRefreshing(false)
    })
  }, [reload])

  const handleViewTypeChange = useCallback((type: ViewType) => {
    if (viewType === ViewType.graph && type !== viewType)
      pendingSyncRef.current = syncWorkflowDraftImmediately(true).catch(() => { })

    doSetViewType(type)
    if (type === ViewType.graph) {
      const pending = pendingSyncRef.current
      if (pending) {
        pending.finally(() => {
          refreshGraph()
        })
        pendingSyncRef.current = null
      }
      else {
        refreshGraph()
      }
    }
  }, [doSetViewType, refreshGraph, syncWorkflowDraftImmediately, viewType])

  useEffect(() => {
    if (!isSupportSandbox) {
      collaborationManager.emitGraphViewActive(true)
      return () => {
        collaborationManager.emitGraphViewActive(false)
      }
    }

    collaborationManager.emitGraphViewActive(viewType === ViewType.graph)
    return () => {
      collaborationManager.emitGraphViewActive(false)
    }
  }, [isSupportSandbox, viewType])

  if (!isSupportSandbox)
    return renderGraph(null)

  const viewPicker = (
    <ViewPicker
      value={viewType}
      onChange={handleViewTypeChange}
      disabled={isResponding}
    />
  )
  const viewPickerDock = (
    <HeaderShell>
      <div className="flex w-full items-center justify-between">
        <div className="flex items-center gap-2">
          {viewPicker}
        </div>
        <div className="flex items-center gap-2">
          <OnlineUsers />
        </div>
      </div>
    </HeaderShell>
  )

  return (
    <div className="relative h-full w-full">
      {viewType === ViewType.graph
        ? (
            isGraphRefreshing
              ? (
                  <>
                    {viewPickerDock}
                    <div className="relative flex h-full w-full items-center justify-center">
                      <Loading />
                    </div>
                  </>
                )
              : renderGraph(viewPicker)
          )
        : (
            <>
              {viewPickerDock}
              <SkillMain />
            </>
          )}
    </div>
  )
}

const WorkflowAppWithAdditionalContext = () => {
  const {
    data,
    isLoading,
    fileUploadConfigResponse,
    reload,
  } = useWorkflowInit()
  const workflowStore = useWorkflowStore()
  const { isLoadingCurrentWorkspace, currentWorkspace } = useAppContext()
  const [showMigrationModal, setShowMigrationModal] = useState(false)
  const [isUpgrading, setIsUpgrading] = useState(false)
  const lastCheckedAppIdRef = useRef<string | null>(null)

  // Initialize trigger status at application level
  const { setTriggerStatuses } = useTriggerStatusStore()
  const appDetail = useAppStore(s => s.appDetail)
  const appId = appDetail?.id
  const handleCloseMigrationModal = useCallback(() => {
    setSandboxMigrationDismissed(appId)
    setShowMigrationModal(false)
  }, [appId])

  const { eventEmitter } = useEventEmitterContextContext()
  eventEmitter?.useSubscription((v) => {
    if (typeof v === 'object' && v?.type === 'upgrade-runtime-click')
      setShowMigrationModal(true)
  })

  const showUpgradeRuntimeModal = useStore(s => s.showUpgradeRuntimeModal)
  const setShowUpgradeRuntimeModal = useStore(s => s.setShowUpgradeRuntimeModal)
  useEffect(() => {
    if (showUpgradeRuntimeModal) {
      // eslint-disable-next-line react/set-state-in-effect
      setShowMigrationModal(true)
      setShowUpgradeRuntimeModal(false)
    }
  }, [showUpgradeRuntimeModal, setShowUpgradeRuntimeModal])

  const handleUpgradeRuntime = useCallback(async () => {
    if (!appId || isUpgrading)
      return
    setIsUpgrading(true)
    try {
      const res = await upgradeAppRuntime(appId)
      if (res.result === 'success' && res.new_app_id) {
        const appName = appDetail?.name || ''
        const params = new URLSearchParams({
          upgraded_from: appId,
          upgraded_from_name: appName,
        })
        window.location.href = `/app/${res.new_app_id}/workflow?${params.toString()}`
      }
    }
    finally {
      setIsUpgrading(false)
    }
  }, [appId, appDetail?.name, isUpgrading])
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
        (debouncedSyncWorkflowDraft as { cancel: () => void }).cancel()
    }
  }, [workflowStore])

  const isSandboxRuntime = appDetail?.runtime_type === 'sandboxed'
  const isSandboxFeatureEnabled = data?.features?.sandbox?.enabled === true
  const isSandboxed = isSandboxRuntime || isSandboxFeatureEnabled

  const nodesData = useMemo(() => {
    if (data) {
      const processedNodes = initialNodes(data.graph.nodes, data.graph.edges)
      const resolvedNodes = isSandboxed
        ? processedNodes.map((node) => {
            if (node.data.type !== BlockEnum.LLM)
              return node

            return {
              ...node,
              data: {
                ...node.data,
                _iconTypeOverride: BlockEnum.Agent,
              },
            }
          })
        : processedNodes
      collaborationManager.setNodes([], resolvedNodes)
      return resolvedNodes
    }
    return []
  }, [data, isSandboxed])

  const edgesData = useMemo(() => {
    if (data) {
      const processedEdges = initialEdges(data.graph.edges, data.graph.nodes)
      collaborationManager.setEdges([], processedEdges)
      return processedEdges
    }
    return []
  }, [data])

  const searchParams = useSearchParams()
  const { getWorkflowRunAndTraceUrl } = useGetRunAndTraceUrl()
  const replayRunId = searchParams.get('replayRunId')
  const upgradedFromId = searchParams.get('upgraded_from')
  const upgradedFromName = searchParams.get('upgraded_from_name')

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

  const isDataReady = !(!data || isLoading || isLoadingCurrentWorkspace || !currentWorkspace.id)
  const sandboxEnabled = isSandboxFeatureEnabled

  const setNeedsRuntimeUpgrade = useAppStore(s => s.setNeedsRuntimeUpgrade)
  useEffect(() => {
    if (!isDataReady || !appId)
      return
    setNeedsRuntimeUpgrade(!sandboxEnabled)
    if (lastCheckedAppIdRef.current !== appId) {
      lastCheckedAppIdRef.current = appId
      const dismissed = getSandboxMigrationDismissed(appId)
      // eslint-disable-next-line react/set-state-in-effect
      setShowMigrationModal(!sandboxEnabled && !dismissed)
    }
  }, [appId, isDataReady, sandboxEnabled, setNeedsRuntimeUpgrade])
  const renderGraph = useCallback((headerLeftSlot: ReactNode) => {
    if (!isDataReady)
      return null

    return (
      <WorkflowAppMain
        nodes={nodesData}
        edges={edgesData}
        viewport={data.graph.viewport}
        headerLeftSlot={headerLeftSlot}
      />
    )
  }, [isDataReady, nodesData, edgesData, data])

  if (!isDataReady) {
    return (
      <div className="relative flex h-full w-full items-center justify-center">
        <Loading />
      </div>
    )
  }

  const initialFeatures: FeaturesData = buildInitialFeatures(data.features, fileUploadConfigResponse)

  return (
    <>
      <CollaborationSession />
      <SandboxMigrationModal
        show={showMigrationModal}
        onClose={handleCloseMigrationModal}
        onUpgrade={handleUpgradeRuntime}
      />
      {upgradedFromId && (
        <UpgradedFromBanner
          fromAppId={upgradedFromId}
          fromAppName={upgradedFromName || upgradedFromId}
        />
      )}
      <WorkflowWithDefaultContext
        edges={edgesData}
        nodes={nodesData}
      >
        <FeaturesProvider features={initialFeatures}>
          <WorkflowViewContent
            renderGraph={renderGraph}
            reload={reload}
          />
        </FeaturesProvider>
      </WorkflowWithDefaultContext>
    </>
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
