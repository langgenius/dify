'use client'

import type { ReactNode } from 'react'
import type { Features as FeaturesData } from '@/app/components/base/features/types'
import type { InjectWorkflowStoreSliceFn } from '@/app/components/workflow/store'
import dynamic from 'next/dynamic'
import { useSearchParams } from 'next/navigation'
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
import { FILE_EXTS } from '@/app/components/base/prompt-editor/constants'
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
  SupportUploadFileTypes,
  ViewType,
} from '@/app/components/workflow/types'
import {
  initialEdges,
  initialNodes,
} from '@/app/components/workflow/utils'
import { useAppContext } from '@/context/app-context'
import { fetchRunDetail } from '@/service/log'
import { useAppTriggers } from '@/service/use-tools'
import { AppModeEnum } from '@/types/app'
import { useFeatures } from '../base/features/hooks'
import ViewPicker from '../workflow/view-picker'
import SandboxMigrationModal from './components/sandbox-migration-modal'
import WorkflowAppMain from './components/workflow-main'
import { useGetRunAndTraceUrl } from './hooks/use-get-run-and-trace-url'
import { useNodesSyncDraft } from './hooks/use-nodes-sync-draft'
import {
  useWorkflowInit,
} from './hooks/use-workflow-init'
import { parseAsViewType, WORKFLOW_VIEW_PARAM_KEY } from './search-params'
import { createWorkflowSlice } from './store/workflow/workflow-slice'
import { getSandboxMigrationDismissed, setSandboxMigrationDismissed } from './utils/sandbox-migration-storage'

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
  const notSupportMigration = true // wait for backend support
  const [showMigrationModal, setShowMigrationModal] = useState(false)
  const lastCheckedAppIdRef = useRef<string | null>(null)

  // Initialize trigger status at application level
  const { setTriggerStatuses } = useTriggerStatusStore()
  const appDetail = useAppStore(s => s.appDetail)
  const appId = appDetail?.id
  const handleCloseMigrationModal = useCallback(() => {
    setSandboxMigrationDismissed(appId)
    setShowMigrationModal(false)
  }, [appId])
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

  const isDataReady = !(!data || isLoading || isLoadingCurrentWorkspace || !currentWorkspace.id)
  const sandboxEnabled = isSandboxFeatureEnabled

  useEffect(() => {
    if (!isDataReady || !appId)
      return
    if (lastCheckedAppIdRef.current !== appId) {
      lastCheckedAppIdRef.current = appId
      const dismissed = getSandboxMigrationDismissed(appId)
      // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
      setShowMigrationModal(!sandboxEnabled && !dismissed)
    }
  }, [appId, isDataReady, sandboxEnabled])
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
    sandbox: features.sandbox || { enabled: false },
  }

  return (
    <>
      <CollaborationSession />
      <SandboxMigrationModal
        show={showMigrationModal && !notSupportMigration}
        onClose={handleCloseMigrationModal}
      />
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
