'use client'
import type { FC } from 'react'
import type { LLMNodeType, ToolSetting } from '../types'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import type { Locale } from '@/i18n-config/language'
import { useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import AppIcon from '@/app/components/base/app-icon'
import { DefaultToolIcon } from '@/app/components/base/icons/src/public/other'
import { ArrowDownRoundFill } from '@/app/components/base/icons/src/vender/solid/general'
import Switch from '@/app/components/base/switch'
import { useNodeCurdKit } from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import useTheme from '@/hooks/use-theme'
import { getLanguage } from '@/i18n-config/language'
import { consoleClient, consoleQuery } from '@/service/client'
import { useAllBuiltInTools, useAllCustomTools, useAllMCPTools, useAllWorkflowTools } from '@/service/use-tools'
import { cn } from '@/utils/classnames'
import { getIconFromMarketPlace } from '@/utils/get-icon'

type ReferenceToolConfigProps = {
  readonly: boolean
  enabled: boolean
  nodeId: string
  toolSettings?: ToolSetting[]
  promptTemplateKey: string
}

type ToolDependency = {
  type: string
  provider: string
  tool_name: string
}

type ToolProviderGroup = {
  id: string
  actions: ToolDependency[]
}

const ReferenceToolConfig: FC<ReferenceToolConfigProps> = ({
  readonly,
  enabled,
  nodeId,
  toolSettings,
  promptTemplateKey,
}) => {
  const isDisabled = readonly || !enabled
  const { i18n } = useTranslation()
  const appId = useAppStore(s => s.appDetail?.id)
  const { handleNodeDataUpdate } = useNodeCurdKit<LLMNodeType>(nodeId)
  const { theme } = useTheme()
  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()
  const { data: mcpTools } = useAllMCPTools()
  const locale = useMemo(() => getLanguage(i18n.language as Locale), [i18n.language])

  const queryKey = useMemo(() => {
    return [
      ...consoleQuery.workflowDraft.nodeSkills.queryKey({
        input: {
          params: {
            appId: appId ?? '',
            nodeId,
          },
        },
      }),
      promptTemplateKey,
    ]
  }, [appId, nodeId, promptTemplateKey])

  const { data } = useQuery({
    queryKey,
    queryFn: () => consoleClient.workflowDraft.nodeSkills({
      params: {
        appId: appId ?? '',
        nodeId,
      },
    }),
    enabled: !!appId && !!nodeId,
    placeholderData: previous => previous,
  })

  const toolDependencies = useMemo<ToolDependency[]>(() => data?.tool_dependencies ?? [], [data?.tool_dependencies])

  const providers = useMemo<ToolProviderGroup[]>(() => {
    const map = new Map<string, ToolDependency[]>()
    toolDependencies.forEach((tool) => {
      const key = tool.provider || tool.tool_name || tool.type
      const group = map.get(key)
      if (group)
        group.push(tool)
      else
        map.set(key, [tool])
    })
    return Array.from(map.entries()).map(([id, actions]) => ({
      id,
      actions,
    }))
  }, [toolDependencies])

  const mergedTools = useMemo(() => {
    return [
      ...(buildInTools || []),
      ...(customTools || []),
      ...(workflowTools || []),
      ...(mcpTools || []),
    ]
  }, [buildInTools, customTools, workflowTools, mcpTools])

  const findProviderMeta = useCallback((providerId: string) => {
    return mergedTools.find(toolWithProvider =>
      toolWithProvider.name === providerId
      || toolWithProvider.id === providerId
      || toolWithProvider.provider === providerId,
    )
  }, [mergedTools])

  const resolveI18nLabel = useCallback((label: ToolWithProvider['label'] | undefined) => {
    if (!label)
      return ''
    if (typeof label === 'string')
      return label
    return label[locale] ?? label.en_US ?? Object.values(label)[0] ?? ''
  }, [locale])

  const providerIcons = useMemo(() => {
    const icons = new Map<string, ToolWithProvider['icon']>()
    providers.forEach((provider) => {
      const matched = findProviderMeta(provider.id)
      let icon = matched
        ? (theme === 'dark' && matched.icon_dark ? matched.icon_dark : matched.icon)
        : undefined
      if (!icon && provider.id.includes('/'))
        icon = getIconFromMarketPlace(provider.id)
      if (icon)
        icons.set(provider.id, icon)
    })
    return icons
  }, [findProviderMeta, providers, theme])

  const providerLabels = useMemo(() => {
    const labels = new Map<string, string>()
    providers.forEach((provider) => {
      const matched = findProviderMeta(provider.id)
      const label = resolveI18nLabel(matched?.label)
      if (label)
        labels.set(provider.id, label)
    })
    return labels
  }, [findProviderMeta, providers, resolveI18nLabel])

  const actionLabels = useMemo(() => {
    const labels = new Map<string, string>()
    providers.forEach((provider) => {
      const matched = findProviderMeta(provider.id)
      if (!matched?.tools)
        return
      matched.tools.forEach((tool) => {
        const label = resolveI18nLabel(tool.label)
        if (label)
          labels.set(`${provider.id}::${tool.name}`, label)
      })
    })
    return labels
  }, [findProviderMeta, providers, resolveI18nLabel])

  const resolveToolEnabled = useCallback((tool: ToolDependency) => {
    const matched = toolSettings?.find(setting =>
      setting.type === tool.type
      && setting.provider === tool.provider
      && setting.tool_name === tool.tool_name,
    )
    return matched?.enabled !== false
  }, [toolSettings])

  const handleToolEnabledChange = useCallback((tool: ToolDependency, isEnabled: boolean) => {
    const nextSettings = (toolSettings ?? []).filter(setting => setting.enabled === false)
    const index = nextSettings.findIndex(setting =>
      setting.type === tool.type
      && setting.provider === tool.provider
      && setting.tool_name === tool.tool_name,
    )
    if (isEnabled) {
      if (index >= 0)
        nextSettings.splice(index, 1)
    }
    else if (index >= 0) {
      nextSettings[index] = {
        ...nextSettings[index],
        enabled: false,
      }
    }
    else {
      nextSettings.push({
        ...tool,
        enabled: false,
      })
    }
    handleNodeDataUpdate({
      tool_settings: nextSettings.length ? nextSettings : [],
    })
  }, [handleNodeDataUpdate, toolSettings])

  const [openMap, setOpenMap] = useState<Record<string, boolean>>({})
  const [iconErrorMap, setIconErrorMap] = useState<Record<string, boolean>>({})
  const handleToggleProvider = useCallback((providerId: string) => {
    setOpenMap(prev => ({
      ...prev,
      [providerId]: !prev[providerId],
    }))
  }, [])

  const renderProviderIcon = useCallback((providerId: string) => {
    const icon = providerIcons.get(providerId)
    if (!icon || iconErrorMap[providerId])
      return <DefaultToolIcon className="h-4 w-4 text-text-primary" />
    if (typeof icon === 'string') {
      return (
        <img
          src={icon}
          alt={providerId}
          className="h-full w-full object-cover"
          width={24}
          height={24}
          onError={() => setIconErrorMap(prev => ({ ...prev, [providerId]: true }))}
        />
      )
    }
    return (
      <AppIcon
        className="h-full w-full object-cover"
        icon={icon.content}
        background={icon.background}
      />
    )
  }, [iconErrorMap, providerIcons])

  return (
    <div className={cn('flex flex-col gap-2', isDisabled && 'opacity-50')}>
      {providers.map((provider) => {
        const isOpen = openMap[provider.id] ?? false
        return (
          <div
            key={provider.id}
            className="flex flex-col gap-1 rounded-lg border border-components-panel-border-subtle bg-components-panel-bg p-1 shadow-xs"
          >
            <div className="flex items-center rounded-lg p-1">
              <div className="flex min-w-0 items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-md">
                  {renderProviderIcon(provider.id)}
                </div>
                <div className="system-sm-medium truncate text-text-primary">
                  {providerLabels.get(provider.id) ?? provider.id}
                </div>
              </div>
              <button
                type="button"
                className="group/collapse-btn flex h-6 w-6 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-state-base-hover"
                onClick={() => handleToggleProvider(provider.id)}
                aria-expanded={isOpen}
              >
                <ArrowDownRoundFill className={cn('h-4 w-4 text-text-quaternary group-hover/collapse-btn:text-text-secondary', isOpen ? 'rotate-0' : '-rotate-90')} />
              </button>
            </div>
            {isOpen && (
              <div className="pb-1">
                {provider.actions.map(action => (
                  <div
                    key={`${action.type}-${action.provider}-${action.tool_name}`}
                    className={cn(
                      'relative flex h-7 items-center justify-between rounded-md pl-9 pr-2',
                      !isDisabled && 'hover:bg-state-base-hover',
                    )}
                  >
                    <div className="absolute left-[15px] top-0 h-full w-[2px] bg-divider-subtle" />
                    <div className="flex min-w-0 flex-1 items-center">
                      <span className="system-sm-regular truncate text-text-secondary">
                        {actionLabels.get(`${provider.id}::${action.tool_name}`) ?? action.tool_name}
                      </span>
                    </div>
                    <Switch
                      size="md"
                      disabled={isDisabled}
                      defaultValue={resolveToolEnabled(action)}
                      onChange={value => handleToolEnabledChange(action, value)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default React.memo(ReferenceToolConfig)
