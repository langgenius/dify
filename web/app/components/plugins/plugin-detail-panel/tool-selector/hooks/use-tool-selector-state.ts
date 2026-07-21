'use client'
import type { ReasoningConfigValue } from '../components/reasoning-config-form'
import type { ToolParameter } from '@/app/components/tools/types'
import type { ToolDefaultValue, ToolValue } from '@/app/components/workflow/block-selector/types'
import type { ResourceVarInputs } from '@/app/components/workflow/nodes/_base/types'
import { useCallback, useMemo, useState } from 'react'
import { CollectionType } from '@/app/components/tools/types'
import {
  generateFormValue,
  getPlainValue,
  getStructureValue,
  toolParametersToFormSchemas,
} from '@/app/components/tools/utils/to-form-schema'
import { useInvalidateInstalledPluginList } from '@/service/use-plugins'
import {
  useAllBuiltInTools,
  useAllCustomTools,
  useAllMCPTools,
  useAllWorkflowTools,
  useInvalidateAllBuiltInTools,
} from '@/service/use-tools'
import { getIconFromMarketPlace } from '@/utils/get-icon'
import { usePluginInstalledCheck } from './use-plugin-installed-check'

export type TabType = 'settings' | 'params'

type UseToolSelectorStateProps = {
  value?: ToolValue
  onSelect: (tool: ToolValue) => void
  onSelectMultiple?: (tool: ToolValue[]) => void
}

/**
 * Custom hook for managing tool selector state and computed values.
 * Consolidates state management, data fetching, and event handlers.
 */
export const useToolSelectorState = ({
  value,
  onSelect,
  onSelectMultiple,
}: UseToolSelectorStateProps) => {
  // Panel visibility states
  const [isShow, setIsShow] = useState(false)
  const [isShowChooseTool, setIsShowChooseTool] = useState(false)
  const [currType, setCurrType] = useState<TabType>('settings')

  // Fetch all tools data
  const buildInToolsQuery = useAllBuiltInTools()
  const customToolsQuery = useAllCustomTools()
  const workflowToolsQuery = useAllWorkflowTools()
  const mcpToolsQuery = useAllMCPTools()
  const { data: buildInTools } = buildInToolsQuery
  const { data: customTools } = customToolsQuery
  const { data: workflowTools } = workflowToolsQuery
  const { data: mcpTools } = mcpToolsQuery
  const invalidateAllBuiltinTools = useInvalidateAllBuiltInTools()
  const invalidateInstalledPluginList = useInvalidateInstalledPluginList()

  // Merge all tools and find current provider
  const currentProvider = useMemo(() => {
    const mergedTools = [
      ...(buildInTools || []),
      ...(customTools || []),
      ...(workflowTools || []),
      ...(mcpTools || []),
    ]
    return mergedTools.find((toolWithProvider) => toolWithProvider.id === value?.provider_name)
  }, [value, buildInTools, customTools, workflowTools, mcpTools])
  const areToolProvidersSettled = [
    buildInToolsQuery,
    customToolsQuery,
    workflowToolsQuery,
    mcpToolsQuery,
  ].every((toolProvidersQuery) => toolProvidersQuery.isFetched)

  // Current tool from provider
  const currentTool = useMemo(() => {
    return currentProvider?.tools.find((tool) => tool.name === value?.tool_name)
  }, [currentProvider?.tools, value?.tool_name])
  const providerPluginId = useMemo(() => {
    if (currentProvider) return currentProvider.plugin_id ?? value?.plugin_id ?? null

    if (value?.plugin_id) return value.plugin_id

    if (!areToolProvidersSettled || !value?.provider_name) return undefined

    // Legacy tool values may only carry the built-in provider id, which remains
    // enough to recover the underlying plugin id for marketplace-backed tools.
    if (value.type && value.type !== CollectionType.builtIn) return null

    const providerNameSegments = value.provider_name.split('/')
    if (providerNameSegments.length !== 3) return null

    return providerNameSegments.slice(0, 2).join('/')
  }, [
    areToolProvidersSettled,
    currentProvider,
    value?.plugin_id,
    value?.provider_name,
    value?.type,
  ])

  // Plugin info check
  const { inMarketPlace, manifest, pluginID } = usePluginInstalledCheck({
    providerPluginId,
    enabled:
      !!value?.provider_name &&
      (!currentProvider || !currentTool) &&
      (currentProvider !== undefined || areToolProvidersSettled || !!value?.plugin_id),
  })

  // Tool settings and params
  const currentToolSettings = useMemo(() => {
    if (!currentProvider) return []
    return (
      currentProvider.tools
        .find((tool) => tool.name === value?.tool_name)
        ?.parameters.filter((param) => param.form !== 'llm') || []
    )
  }, [currentProvider, value])

  const currentToolParams = useMemo(() => {
    if (!currentProvider) return []
    return (
      currentProvider.tools
        .find((tool) => tool.name === value?.tool_name)
        ?.parameters.filter((param) => param.form === 'llm') || []
    )
  }, [currentProvider, value])

  // Form schemas
  const settingsFormSchemas = useMemo(
    () => toolParametersToFormSchemas(currentToolSettings),
    [currentToolSettings],
  )
  const paramsFormSchemas = useMemo(
    () => toolParametersToFormSchemas(currentToolParams),
    [currentToolParams],
  )

  // Tab visibility flags
  const showTabSlider = currentToolSettings.length > 0 && currentToolParams.length > 0
  const userSettingsOnly = currentToolSettings.length > 0 && !currentToolParams.length
  const reasoningConfigOnly = currentToolParams.length > 0 && !currentToolSettings.length

  // Manifest icon URL
  const manifestIcon = useMemo(() => {
    if (!manifest || !pluginID) return ''
    return getIconFromMarketPlace(pluginID)
  }, [manifest, pluginID])

  // Convert tool default value to tool value format
  const getToolValue = useCallback((tool: ToolDefaultValue): ToolValue => {
    const settingValues = generateFormValue(
      tool.params,
      toolParametersToFormSchemas(
        (tool.paramSchemas as ToolParameter[]).filter((param) => param.form !== 'llm'),
      ),
    )
    const paramValues = generateFormValue(
      tool.params,
      toolParametersToFormSchemas(
        (tool.paramSchemas as ToolParameter[]).filter((param) => param.form === 'llm'),
      ),
      true,
    )
    return {
      provider_name: tool.provider_id,
      provider_show_name: tool.provider_name,
      plugin_id: tool.plugin_id,
      tool_name: tool.tool_name,
      tool_label: tool.tool_label,
      tool_description: tool.tool_description,
      settings: settingValues,
      parameters: paramValues,
      enabled: tool.is_team_authorization,
      extra: {
        description: tool.tool_description,
      },
      type: tool.provider_type,
    }
  }, [])

  // Event handlers
  const handleSelectTool = useCallback(
    (tool: ToolDefaultValue) => {
      const toolValue = getToolValue(tool)
      onSelect(toolValue)
    },
    [getToolValue, onSelect],
  )

  const handleSelectMultipleTool = useCallback(
    (tools: ToolDefaultValue[]) => {
      const toolValues = tools.map((item) => getToolValue(item))
      onSelectMultiple?.(toolValues)
    },
    [getToolValue, onSelectMultiple],
  )

  const handleDescriptionChange = useCallback(
    (description: string) => {
      if (!value) return
      onSelect({
        ...value,
        extra: {
          ...value.extra,
          description: description || '',
        },
      })
    },
    [value, onSelect],
  )

  const handleSettingsFormChange = useCallback(
    (v: ResourceVarInputs) => {
      if (!value) return
      const newValue = getStructureValue(v)
      onSelect({
        ...value,
        settings: newValue,
      })
    },
    [value, onSelect],
  )

  const handleParamsFormChange = useCallback(
    (v: ReasoningConfigValue) => {
      if (!value) return
      onSelect({
        ...value,
        parameters: v,
      })
    },
    [value, onSelect],
  )

  const handleEnabledChange = useCallback(
    (state: boolean) => {
      if (!value) return
      onSelect({
        ...value,
        enabled: state,
      })
    },
    [value, onSelect],
  )

  const handleAuthorizationItemClick = useCallback(
    (id: string) => {
      if (!value) return
      onSelect({
        ...value,
        credential_id: id,
      })
    },
    [value, onSelect],
  )

  const handleInstall = useCallback(async () => {
    try {
      await invalidateAllBuiltinTools()
    } catch (error) {
      console.error('Failed to invalidate built-in tools cache', error)
    }
    try {
      await invalidateInstalledPluginList()
    } catch (error) {
      console.error('Failed to invalidate installed plugin list cache', error)
    }
  }, [invalidateAllBuiltinTools, invalidateInstalledPluginList])

  const getSettingsValue = useCallback((): ResourceVarInputs => {
    return getPlainValue(
      (value?.settings || {}) as Record<string, { value: unknown }>,
    ) as ResourceVarInputs
  }, [value?.settings])

  return {
    // State
    isShow,
    setIsShow,
    isShowChooseTool,
    setIsShowChooseTool,
    currType,
    setCurrType,

    // Computed values
    currentProvider,
    currentTool,
    currentToolSettings,
    currentToolParams,
    settingsFormSchemas,
    paramsFormSchemas,
    showTabSlider,
    userSettingsOnly,
    reasoningConfigOnly,
    manifestIcon,
    inMarketPlace,
    manifest,

    // Event handlers
    handleSelectTool,
    handleSelectMultipleTool,
    handleDescriptionChange,
    handleSettingsFormChange,
    handleParamsFormChange,
    handleEnabledChange,
    handleAuthorizationItemClick,
    handleInstall,
    getSettingsValue,
  }
}
