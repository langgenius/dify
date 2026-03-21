'use client'
import type { AppDetailResponse } from '@/models/app'
import type { AppSSO } from '@/types/app'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { BlockEnum } from '@/app/components/workflow/types'
import { useAppContext } from '@/context/app-context'
import { fetchAppDetail } from '@/service/apps'
import {
  useInvalidateMCPServerDetail,
  useMCPServerDetail,
  useRefreshMCPServerCode,
  useUpdateMCPServer,
} from '@/service/use-tools'
import { useAppWorkflow } from '@/service/use-workflow'
import { AppModeEnum } from '@/types/app'

const BASIC_APP_CONFIG_KEY = 'basicAppConfig'

type AppInfo = AppDetailResponse & Partial<AppSSO>

type BasicAppConfig = {
  updated_at?: string
  user_input_form?: Array<Record<string, unknown>>
}

export const useMCPServiceCardState = (
  appInfo: AppInfo,
  triggerModeDisabled: boolean,
) => {
  const appId = appInfo.id
  const queryClient = useQueryClient()

  // API hooks
  const { mutateAsync: updateMCPServer } = useUpdateMCPServer()
  const { mutateAsync: refreshMCPServerCode, isPending: genLoading } = useRefreshMCPServerCode()
  const invalidateMCPServerDetail = useInvalidateMCPServerDetail()

  // Context
  const { isCurrentWorkspaceManager, isCurrentWorkspaceEditor } = useAppContext()

  // UI state
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)
  const [showMCPServerModal, setShowMCPServerModal] = useState(false)

  // Derived app type values
  const isAdvancedApp = appInfo?.mode === AppModeEnum.ADVANCED_CHAT || appInfo?.mode === AppModeEnum.WORKFLOW
  const isBasicApp = !isAdvancedApp
  const isWorkflowApp = appInfo.mode === AppModeEnum.WORKFLOW

  // Workflow data for advanced apps
  const { data: currentWorkflow } = useAppWorkflow(isAdvancedApp ? appId : '')

  // Basic app config fetch using React Query
  const { data: basicAppConfig = {} } = useQuery<BasicAppConfig>({
    queryKey: [BASIC_APP_CONFIG_KEY, appId],
    queryFn: async () => {
      const res = await fetchAppDetail({ url: '/apps', id: appId })
      return (res?.model_config as BasicAppConfig) || {}
    },
    enabled: isBasicApp && !!appId,
  })

  // MCP server detail
  const { data: detail } = useMCPServerDetail(appId)
  const { id, status, server_code } = detail ?? {}

  // Server state
  const serverPublished = !!id
  const serverActivated = status === 'active'
  const serverURL = serverPublished
    ? `${appInfo.api_base_url.replace('/v1', '')}/mcp/server/${server_code}/mcp`
    : '***********'

  // App state checks
  const appUnpublished = isAdvancedApp ? !currentWorkflow?.graph : !basicAppConfig.updated_at
  const hasStartNode = currentWorkflow?.graph?.nodes?.some(node => node.data.type === BlockEnum.Start)
  const missingStartNode = isWorkflowApp && !hasStartNode
  const hasInsufficientPermissions = !isCurrentWorkspaceEditor
  const toggleDisabled = hasInsufficientPermissions || appUnpublished || missingStartNode || triggerModeDisabled
  const isMinimalState = appUnpublished || missingStartNode

  // Basic app input form
  const basicAppInputForm = useMemo(() => {
    if (!isBasicApp || !basicAppConfig?.user_input_form)
      return []
    return (basicAppConfig.user_input_form as Array<Record<string, unknown>>).map((item) => {
      const type = Object.keys(item)[0]
      return {
        ...(item[type] as object),
        type: type || 'text-input',
      }
    })
  }, [basicAppConfig?.user_input_form, isBasicApp])

  // Latest params for modal
  const latestParams = useMemo(() => {
    if (isAdvancedApp) {
      if (!currentWorkflow?.graph)
        return []
      type StartNodeData = { type: string, variables?: Array<{ variable: string, label: string }> }
      const startNode = currentWorkflow?.graph.nodes.find(node => node.data.type === BlockEnum.Start) as { data: StartNodeData } | undefined
      return startNode?.data.variables || []
    }
    return basicAppInputForm
  }, [currentWorkflow, basicAppInputForm, isAdvancedApp])

  // Handlers
  const handleGenCode = useCallback(async () => {
    await refreshMCPServerCode(detail?.id || '')
    invalidateMCPServerDetail(appId)
  }, [refreshMCPServerCode, detail?.id, invalidateMCPServerDetail, appId])

  const handleStatusChange = useCallback(async (state: boolean) => {
    if (state && !serverPublished) {
      setShowMCPServerModal(true)
      return { activated: false }
    }

    await updateMCPServer({
      appID: appId,
      id: id || '',
      description: detail?.description || '',
      parameters: detail?.parameters || {},
      status: state ? 'active' : 'inactive',
    })
    invalidateMCPServerDetail(appId)
    return { activated: state }
  }, [serverPublished, updateMCPServer, appId, id, detail, invalidateMCPServerDetail])

  const handleServerModalHide = useCallback((wasActivated: boolean) => {
    setShowMCPServerModal(false)
    // If server wasn't activated before opening modal, keep it deactivated
    return { shouldDeactivate: !wasActivated }
  }, [])

  const openConfirmDelete = useCallback(() => setShowConfirmDelete(true), [])
  const closeConfirmDelete = useCallback(() => setShowConfirmDelete(false), [])
  const openServerModal = useCallback(() => setShowMCPServerModal(true), [])

  const invalidateBasicAppConfig = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: [BASIC_APP_CONFIG_KEY, appId] })
  }, [queryClient, appId])

  return {
    // Loading states
    genLoading,
    isLoading: isAdvancedApp ? !currentWorkflow : false,

    // Server state
    serverPublished,
    serverActivated,
    serverURL,
    detail,

    // Permission & validation flags
    isCurrentWorkspaceManager,
    toggleDisabled,
    isMinimalState,
    appUnpublished,
    missingStartNode,

    // UI state
    showConfirmDelete,
    showMCPServerModal,

    // Data
    latestParams,

    // Handlers
    handleGenCode,
    handleStatusChange,
    handleServerModalHide,
    openConfirmDelete,
    closeConfirmDelete,
    openServerModal,
    invalidateBasicAppConfig,
  }
}
