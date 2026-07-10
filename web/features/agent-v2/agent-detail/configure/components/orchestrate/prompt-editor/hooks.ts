'use client'

import type { ToolWithProvider } from '@/app/components/workflow/types'
import type { AgentTool } from '@/features/agent-v2/agent-composer/form-state'
import { useAtomValue } from 'jotai'
import { useMemo } from 'react'
import { API_PREFIX } from '@/config'
import { currentWorkspaceIdAtom } from '@/context/workspace-state'
import useTheme from '@/hooks/use-theme'
import {
  useAllBuiltInTools,
  useAllCustomTools,
  useAllMCPTools,
  useAllWorkflowTools,
} from '@/service/use-tools'
import { Theme } from '@/types/app'
import { basePath } from '@/utils/var'

type ProviderTool = Extract<AgentTool, { kind: 'provider' }>

const hasUrlProtocol = (value: string) => /^[a-z][a-z\d+.-]*:/i.test(value)

function normalizeProviderIcon(
  icon: ToolWithProvider['icon'] | undefined,
  workspaceId: string,
) {
  if (!icon || typeof icon !== 'string')
    return icon

  if (hasUrlProtocol(icon))
    return icon

  if (icon.startsWith('/')) {
    if (basePath && !icon.startsWith(`${basePath}/`))
      return `${basePath}${icon}`

    return icon
  }

  if (!workspaceId)
    return icon

  return `${API_PREFIX}/workspaces/current/plugin/icon?tenant_id=${workspaceId}&filename=${icon}`
}

function getProviderByTool(
  providerById: Map<string, ToolWithProvider>,
  tool: ProviderTool,
) {
  return providerById.get(tool.id)
    ?? providerById.get(tool.name)
}

function createProviderMap(providers: ToolWithProvider[]) {
  const providerById = new Map<string, ToolWithProvider>()

  providers.forEach((provider) => {
    providerById.set(provider.id, provider)
    providerById.set(provider.name, provider)
    if (provider.plugin_id) {
      providerById.set(provider.plugin_id, provider)
      providerById.set(`${provider.plugin_id}/${provider.name}`, provider)
    }
  })

  return providerById
}

export function useAgentPromptToolIconResolver() {
  const { theme } = useTheme()
  const currentWorkspaceId = useAtomValue(currentWorkspaceIdAtom)
  const { data: builtInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()
  const { data: mcpTools } = useAllMCPTools()

  const providerById = useMemo(() => {
    const allProviders = [
      ...(Array.isArray(builtInTools) ? builtInTools : []),
      ...(Array.isArray(customTools) ? customTools : []),
      ...(Array.isArray(workflowTools) ? workflowTools : []),
      ...(Array.isArray(mcpTools) ? mcpTools : []),
    ]

    return createProviderMap(allProviders)
  }, [builtInTools, customTools, mcpTools, workflowTools])

  return useMemo(() => ({
    getProviderIcon: (provider: ToolWithProvider) => {
      const rawIcon = theme === Theme.dark && provider.icon_dark ? provider.icon_dark : provider.icon
      return normalizeProviderIcon(rawIcon, currentWorkspaceId)
    },
    getProviderIcons: (provider: ToolWithProvider) => ({
      icon: normalizeProviderIcon(provider.icon, currentWorkspaceId),
      iconDark: normalizeProviderIcon(provider.icon_dark, currentWorkspaceId),
    }),
    getConfiguredToolIcon: (tool: ProviderTool) => {
      const provider = getProviderByTool(providerById, tool)
      const rawIcon = theme === Theme.dark && (tool.iconDark ?? provider?.icon_dark)
        ? tool.iconDark ?? provider?.icon_dark
        : tool.icon ?? provider?.icon

      return normalizeProviderIcon(rawIcon, currentWorkspaceId)
    },
  }), [currentWorkspaceId, providerById, theme])
}
