'use client'
import type { Emoji, WorkflowToolProviderParameter, WorkflowToolProviderRequest, WorkflowToolProviderResponse } from '@/app/components/tools/types'
import type { InputVar, Variable } from '@/app/components/workflow/types'
import type { PublishWorkflowParams } from '@/types/workflow'
import { useBoolean } from 'ahooks'
import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Toast from '@/app/components/base/toast'
import { useInvalidateAllWorkflowTools } from '@/service/use-tools'
import {
  useCreateWorkflowTool,
  useInvalidateWorkflowToolDetail,
  useUpdateWorkflowTool,
  useWorkflowToolDetail,
} from './use-workflow-tool'

export type ConfigureButtonProps = {
  published: boolean
  detailNeedUpdate?: boolean
  workflowAppId: string
  icon: Emoji
  name: string
  description: string
  inputs?: InputVar[]
  outputs?: Variable[]
  handlePublish: (params?: PublishWorkflowParams) => Promise<void>
  onRefreshData?: () => void
}

// Type for parameter building context
type ParameterBuildContext = {
  inputs: InputVar[] | undefined
  outputs: Variable[] | undefined
  detail: WorkflowToolProviderResponse | undefined
  published: boolean
}

/**
 * Check if tool parameters are outdated compared to workflow inputs
 */
function checkOutdated(detail: WorkflowToolProviderResponse | undefined, inputs: InputVar[] | undefined): boolean {
  if (!detail)
    return false

  const toolParams = detail.tool.parameters
  const inputList = inputs ?? []

  if (toolParams.length !== inputList.length)
    return true

  return inputList.some((item) => {
    const param = toolParams.find(p => p.name === item.variable)
    if (!param || param.required !== item.required)
      return true

    const isTextType = item.type === 'paragraph' || item.type === 'text-input'
    return isTextType && param.type !== 'string'
  })
}

/**
 * Build input parameters based on context
 */
function buildInputParameters(ctx: ParameterBuildContext): WorkflowToolProviderParameter[] {
  const inputList = ctx.inputs ?? []

  if (!ctx.published || !ctx.detail?.tool) {
    return inputList.map(item => ({
      name: item.variable,
      description: '',
      form: 'llm',
      required: item.required,
      type: item.type,
    }))
  }

  const existingParams = ctx.detail.tool.parameters
  return inputList.map((item) => {
    const existing = existingParams.find(p => p.name === item.variable)
    return {
      name: item.variable,
      required: item.required,
      type: item.type === 'paragraph' ? 'string' : item.type,
      description: existing?.llm_description ?? '',
      form: existing?.form ?? 'llm',
    }
  })
}

/**
 * Build output parameters
 */
function buildOutputParameters(outputs: Variable[] | undefined, detail?: WorkflowToolProviderResponse) {
  return (outputs ?? []).map((item) => {
    const found = detail?.tool.output_schema?.properties?.[item.variable]
    return {
      name: item.variable,
      description: found?.description ?? '',
      type: item.value_type,
    }
  })
}

/**
 * Custom hook for managing configure button state and logic
 */
export const useConfigureButton = ({
  published,
  detailNeedUpdate,
  workflowAppId,
  icon,
  name,
  description,
  inputs,
  outputs,
  handlePublish,
  onRefreshData,
}: ConfigureButtonProps) => {
  const { t } = useTranslation()
  const [showModal, { setTrue: openModal, setFalse: closeModal }] = useBoolean(false)

  // Data fetching with React Query
  const {
    data: detail,
    isLoading,
    refetch: refetchDetail,
  } = useWorkflowToolDetail(workflowAppId, published)

  // Refetch detail when external updates occur
  useEffect(() => {
    if (detailNeedUpdate)
      refetchDetail()
  }, [detailNeedUpdate, refetchDetail])

  // Mutations
  const { mutateAsync: createTool } = useCreateWorkflowTool()
  const { mutateAsync: updateTool } = useUpdateWorkflowTool()
  const invalidateAllWorkflowTools = useInvalidateAllWorkflowTools()
  const invalidateDetail = useInvalidateWorkflowToolDetail()

  // Check if parameters are outdated
  const outdated = useMemo(
    () => checkOutdated(detail, inputs),
    [detail, inputs],
  )

  // Build payload for modal
  const payload = useMemo(() => {
    const ctx: ParameterBuildContext = { inputs, outputs, detail, published }
    const parameters = buildInputParameters(ctx)
    const outputParameters = buildOutputParameters(outputs, detail)

    return {
      icon: detail?.icon ?? icon,
      label: detail?.label ?? name,
      name: detail?.name ?? '',
      description: detail?.description ?? description,
      parameters,
      outputParameters,
      labels: detail?.tool?.labels ?? [],
      privacy_policy: detail?.privacy_policy ?? '',
      tool: detail?.tool,
      ...(published
        ? { workflow_tool_id: detail?.workflow_tool_id }
        : { workflow_app_id: workflowAppId }),
    }
  }, [detail, published, workflowAppId, icon, name, description, inputs, outputs])

  // Common cache invalidation logic
  const invalidateCaches = useCallback(() => {
    invalidateAllWorkflowTools()
    invalidateDetail(workflowAppId)
    onRefreshData?.()
    refetchDetail()
  }, [invalidateAllWorkflowTools, invalidateDetail, workflowAppId, onRefreshData, refetchDetail])

  // Common success handler
  const handleSuccess = useCallback(() => {
    Toast.notify({ type: 'success', message: t('api.actionSuccess', { ns: 'common' }) })
    closeModal()
  }, [t, closeModal])

  // Handler for creating new workflow tool
  const handleCreate = useCallback(async (data: WorkflowToolProviderRequest & { workflow_app_id: string }) => {
    try {
      await createTool(data)
      invalidateCaches()
      handleSuccess()
    }
    catch (e) {
      Toast.notify({ type: 'error', message: (e as Error).message })
    }
  }, [createTool, invalidateCaches, handleSuccess])

  // Handler for updating workflow tool
  const handleUpdate = useCallback(async (data: WorkflowToolProviderRequest & Partial<{
    workflow_app_id: string
    workflow_tool_id: string
  }>) => {
    try {
      await handlePublish()
      await updateTool(data)
      invalidateCaches()
      handleSuccess()
    }
    catch (e) {
      Toast.notify({ type: 'error', message: (e as Error).message })
    }
  }, [handlePublish, updateTool, invalidateCaches, handleSuccess])

  return {
    showModal,
    isLoading,
    detail,
    outdated,
    payload,
    openModal,
    closeModal,
    handleCreate,
    handleUpdate,
  }
}
