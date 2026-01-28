'use client'
import type { FC } from 'react'
import type { LLMNodeType, ToolSetting } from '../types'
import { RiArrowDownSLine } from '@remixicon/react'
import { useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useCallback, useMemo } from 'react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { DefaultToolIcon } from '@/app/components/base/icons/src/public/other'
import Switch from '@/app/components/base/switch'
import { useNodeCurdKit } from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import { consoleClient, consoleQuery } from '@/service/client'
import { cn } from '@/utils/classnames'

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
  const appId = useAppStore(s => s.appDetail?.id)
  const { handleNodeDataUpdate } = useNodeCurdKit<LLMNodeType>(nodeId)

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

  return (
    <div className={cn('flex flex-col gap-2', isDisabled && 'opacity-50')}>
      {providers.map(provider => (
        <div
          key={provider.id}
          className="flex flex-col gap-1 rounded-lg border border-components-panel-border-subtle bg-components-panel-bg p-1 shadow-xs"
        >
          <div className="flex items-center gap-2 rounded-lg px-2 py-1.5">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-md border border-divider-subtle bg-background-default">
                <DefaultToolIcon className="h-4 w-4 text-text-primary" />
              </div>
              <div className="system-sm-medium truncate text-text-primary">
                {provider.id}
              </div>
              <RiArrowDownSLine className="h-4 w-4 text-text-tertiary" />
            </div>
          </div>
          {provider.actions.map(action => (
            <div
              key={`${action.type}-${action.provider}-${action.tool_name}`}
              className="relative flex items-center gap-2 rounded-md px-2 py-1"
            >
              <div className="absolute left-3 top-0 h-full w-px bg-divider-subtle" />
              <div className="flex min-w-0 flex-1 items-center pl-5">
                <span className="system-sm-regular truncate text-text-secondary">
                  {action.tool_name}
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
      ))}
    </div>
  )
}

export default React.memo(ReferenceToolConfig)
