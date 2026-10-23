'use client'

import type { ToolWithProvider } from '@/app/components/workflow/types'
import type { AgentTool } from '@/features/agent-v2/agent-composer/form-state'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useMemo } from 'react'
import { CollectionType } from '@/app/components/tools/types'
import { selectToolsWithProvider } from '@/app/components/tools/utils/query-select'
import { API_PREFIX } from '@/config'
import { currentWorkspaceIdAtom } from '@/context/workspace-state'
import useTheme from '@/hooks/use-theme'
import { consoleQuery } from '@/service/console'
import { Theme } from '@/types/app'
import { basePath } from '@/utils/var'
import {
  createAgentToolProviderCatalog,
  getAgentProviderToolIcon,
} from '../../../tool-provider-catalog'

type ProviderTool = Extract<AgentTool, { kind: 'provider' }>

const hasUrlProtocol = (value: string) => /^[a-z][a-z\d+.-]*:/i.test(value)

function normalizeProviderIcon(icon: ToolWithProvider['icon'] | undefined, workspaceId: string) {
  if (!icon || typeof icon !== 'string') return icon

  if (hasUrlProtocol(icon)) return icon

  if (icon.startsWith('/')) {
    if (basePath && !icon.startsWith(`${basePath}/`)) return `${basePath}${icon}`

    return icon
  }

  if (!workspaceId) return icon

  return `${API_PREFIX}/workspaces/current/plugin/icon?tenant_id=${workspaceId}&filename=${icon}`
}

function getProviderByTool(providerById: Map<string, ToolWithProvider>, tool: ProviderTool) {
  return providerById.get(tool.id) ?? providerById.get(tool.name)
}

export function useAgentPromptToolIconResolver(
  providerTypes?: ReadonlySet<ProviderTool['providerType']>,
) {
  const { theme } = useTheme()
  const currentWorkspaceId = useAtomValue(currentWorkspaceIdAtom)
  const { data: builtInTools } = useQuery(
    consoleQuery.workspaces.current.tools.builtin.get.queryOptions({
      enabled:
        !providerTypes || providerTypes.has(CollectionType.builtIn) || providerTypes.has('plugin'),
      select: selectToolsWithProvider,
    }),
  )
  const { data: customTools } = useQuery(
    consoleQuery.workspaces.current.tools.api.get.queryOptions({
      enabled: !providerTypes || providerTypes.has(CollectionType.custom),
      select: selectToolsWithProvider,
    }),
  )
  const { data: workflowTools } = useQuery(
    consoleQuery.workspaces.current.tools.workflow.get.queryOptions({
      enabled: !providerTypes || providerTypes.has(CollectionType.workflow),
      select: selectToolsWithProvider,
    }),
  )
  const { data: mcpTools } = useQuery(
    consoleQuery.workspaces.current.tools.mcp.get.queryOptions({
      enabled: !providerTypes || providerTypes.has(CollectionType.mcp),
      select: selectToolsWithProvider,
    }),
  )

  const providerById = useMemo(
    () =>
      createAgentToolProviderCatalog({
        buildInTools: builtInTools,
        customTools,
        mcpTools,
        workflowTools,
      }).providerById,
    [builtInTools, customTools, mcpTools, workflowTools],
  )

  return useMemo(
    () => ({
      getProviderIcon: (provider: ToolWithProvider) => {
        const rawIcon =
          theme === Theme.dark && provider.icon_dark ? provider.icon_dark : provider.icon
        return normalizeProviderIcon(rawIcon, currentWorkspaceId)
      },
      getProviderIcons: (provider: ToolWithProvider) => ({
        icon: normalizeProviderIcon(provider.icon, currentWorkspaceId),
        iconDark: normalizeProviderIcon(provider.icon_dark, currentWorkspaceId),
      }),
      getConfiguredToolIcon: (tool: ProviderTool) => {
        const provider = getProviderByTool(providerById, tool)
        const rawIcon =
          theme === Theme.dark && (tool.iconDark ?? provider?.icon_dark)
            ? (tool.iconDark ?? provider?.icon_dark)
            : getAgentProviderToolIcon(tool, provider)

        return normalizeProviderIcon(rawIcon, currentWorkspaceId)
      },
    }),
    [currentWorkspaceId, providerById, theme],
  )
}
