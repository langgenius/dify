import type { Emoji, WorkflowToolProviderOutputParameter, WorkflowToolProviderParameter, WorkflowToolProviderRequest, WorkflowToolProviderResponse } from '@/app/components/tools/types'
import type { InputVar, Variable } from '@/app/components/workflow/types'
import type { PublishWorkflowParams } from '@/types/workflow'
import { toast } from '@langgenius/dify-ui/toast'
import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppContext } from '@/context/app-context'
import { createWorkflowToolProvider, saveWorkflowToolProvider } from '@/service/tools'
import { useInvalidateAllWorkflowTools, useInvalidateWorkflowToolDetailByAppID, useWorkflowToolDetailByAppID } from '@/service/use-tools'

// region Pure helpers

/**
 * Check if workflow tool parameters are outdated compared to current inputs.
 * Uses flat early-return style to reduce cyclomatic complexity.
 */
export function isParametersOutdated(
  detail: WorkflowToolProviderResponse | undefined,
  inputs: InputVar[] | undefined,
): boolean {
  if (!detail)
    return false
  if (detail.tool.parameters.length !== (inputs?.length ?? 0))
    return true

  for (const item of inputs || []) {
    const param = detail.tool.parameters.find(p => p.name === item.variable)
    if (!param)
      return true
    if (param.required !== item.required)
      return true
    const needsStringType = item.type === 'paragraph' || item.type === 'text-input'
    if (needsStringType && param.type !== 'string')
      return true
  }

  return false
}

function buildNewParameters(inputs?: InputVar[]): WorkflowToolProviderParameter[] {
  return (inputs || []).map(item => ({
    name: item.variable,
    description: '',
    form: 'llm',
    required: item.required,
    type: item.type,
  }))
}

function buildExistingParameters(
  inputs: InputVar[] | undefined,
  detail: WorkflowToolProviderResponse,
): WorkflowToolProviderParameter[] {
  return (inputs || []).map((item) => {
    const matched = detail.tool.parameters.find(p => p.name === item.variable)
    return {
      name: item.variable,
      required: item.required,
      type: item.type === 'paragraph' ? 'string' : item.type,
      description: matched?.llm_description || '',
      form: matched?.form || 'llm',
    }
  })
}

function buildNewOutputParameters(outputs?: Variable[]): WorkflowToolProviderOutputParameter[] {
  return (outputs || []).map(item => ({
    name: item.variable,
    description: '',
    type: item.value_type,
  }))
}

function buildExistingOutputParameters(
  outputs: Variable[] | undefined,
  detail: WorkflowToolProviderResponse,
): WorkflowToolProviderOutputParameter[] {
  return (outputs || []).map((item) => {
    const found = detail.tool.output_schema?.properties?.[item.variable]
    return {
      name: item.variable,
      description: found ? found.description : '',
      type: item.value_type,
    }
  })
}

// endregion

type UseConfigureButtonOptions = {
  enabled: boolean
  published: boolean
  detailNeedUpdate: boolean
  workflowAppId: string
  icon: Emoji
  name: string
  description: string
  inputs?: InputVar[]
  outputs?: Variable[]
  handlePublish: (params?: PublishWorkflowParams) => Promise<void>
  onRefreshData?: () => void
  onConfigured?: () => void
}

export function useConfigureButton(options: UseConfigureButtonOptions) {
  const {
    enabled,
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
    onConfigured,
  } = options

  const { t } = useTranslation()
  const { isCurrentWorkspaceManager } = useAppContext()

  // Data fetching via React Query
  const { data: detail, isLoading } = useWorkflowToolDetailByAppID(workflowAppId, enabled && published)

  // Invalidation functions (store in ref for stable effect dependency)
  const invalidateDetail = useInvalidateWorkflowToolDetailByAppID()
  const invalidateAllWorkflowTools = useInvalidateAllWorkflowTools()

  const invalidateDetailRef = useRef(invalidateDetail)
  invalidateDetailRef.current = invalidateDetail

  // Refetch when detailNeedUpdate becomes true
  useEffect(() => {
    if (enabled && detailNeedUpdate)
      invalidateDetailRef.current(workflowAppId)
  }, [detailNeedUpdate, enabled, workflowAppId])

  // Computed values
  const outdated = useMemo(
    () => isParametersOutdated(detail, inputs),
    [detail, inputs],
  )

  const payload = useMemo(() => {
    const hasPublishedDetail = published && detail?.tool

    const parameters = !published
      ? buildNewParameters(inputs)
      : hasPublishedDetail
        ? buildExistingParameters(inputs, detail)
        : []

    const outputParameters = !published
      ? buildNewOutputParameters(outputs)
      : hasPublishedDetail
        ? buildExistingOutputParameters(outputs, detail)
        : []

    return {
      icon: detail?.icon || icon,
      label: detail?.label || name,
      name: detail?.name || '',
      description: detail?.description || description,
      parameters,
      outputParameters,
      labels: detail?.tool?.labels || [],
      privacy_policy: detail?.privacy_policy || '',
      ...(published
        ? { workflow_tool_id: detail?.workflow_tool_id }
        : { workflow_app_id: workflowAppId }),
    }
  }, [detail, published, workflowAppId, icon, name, description, inputs, outputs])

  // Mutation handlers (not memoized — only used in conditionally-rendered modal)
  const handleCreate = async (data: WorkflowToolProviderRequest & { workflow_app_id: string }) => {
    try {
      await createWorkflowToolProvider(data)
      invalidateAllWorkflowTools()
      onRefreshData?.()
      invalidateDetail(workflowAppId)
      toast.success(t('api.actionSuccess', { ns: 'common' }))
      onConfigured?.()
    }
    catch (e) {
      toast.error((e as Error).message)
    }
  }

  const handleUpdate = async (data: WorkflowToolProviderRequest & Partial<{
    workflow_app_id: string
    workflow_tool_id: string
  }>) => {
    try {
      await handlePublish()
      await saveWorkflowToolProvider(data)
      onRefreshData?.()
      invalidateAllWorkflowTools()
      invalidateDetail(workflowAppId)
      onConfigured?.()
    }
    catch (e) {
      toast.error((e as Error).message)
    }
  }

  return {
    isLoading,
    outdated,
    payload,
    isCurrentWorkspaceManager,
    handleCreate,
    handleUpdate,
  }
}
