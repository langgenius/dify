'use client'

import type { MarketplacePlugin } from '@dify/contracts/marketplace'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import type { AgentProviderTool, AgentTool } from '@/features/agent-v2/agent-composer/form-state'
import { useMemo } from 'react'
import { CollectionType } from '@/app/components/tools/types'
import { useGetLanguage } from '@/context/i18n'
import { useFetchPluginsInMarketPlaceByInfo } from '@/service/use-plugins'
import {
  useAllBuiltInTools,
  useAllCustomTools,
  useAllMCPTools,
  useAllWorkflowTools,
} from '@/service/use-tools'

type AgentToolPresentationProvider = Pick<
  AgentProviderTool,
  'kind' | 'id' | 'name' | 'displayName' | 'pluginId' | 'providerType'
>
type AgentToolPresentationSource = AgentTool | AgentToolPresentationProvider

export type AgentToolProviderCatalog = {
  providerById: Map<string, ToolWithProvider>
  resolvedProviderTypes: Set<AgentProviderTool['providerType']>
}

export function createAgentToolProviderCatalog({
  buildInTools,
  customTools,
  mcpTools,
  workflowTools,
}: {
  buildInTools?: ToolWithProvider[]
  customTools?: ToolWithProvider[]
  mcpTools?: ToolWithProvider[]
  workflowTools?: ToolWithProvider[]
}): AgentToolProviderCatalog {
  const providers = new Map<string, ToolWithProvider>()
  const resolvedProviderTypes = new Set<AgentProviderTool['providerType']>()
  const buildInToolList = Array.isArray(buildInTools) ? buildInTools : []
  const customToolList = Array.isArray(customTools) ? customTools : []
  const workflowToolList = Array.isArray(workflowTools) ? workflowTools : []
  const mcpToolList = Array.isArray(mcpTools) ? mcpTools : []
  const allProviders = [...buildInToolList, ...customToolList, ...workflowToolList, ...mcpToolList]

  if (Array.isArray(buildInTools)) {
    resolvedProviderTypes.add(CollectionType.builtIn)
    resolvedProviderTypes.add('plugin')
  }
  if (Array.isArray(customTools)) resolvedProviderTypes.add(CollectionType.custom)
  if (Array.isArray(workflowTools)) resolvedProviderTypes.add(CollectionType.workflow)
  if (Array.isArray(mcpTools)) resolvedProviderTypes.add(CollectionType.mcp)

  allProviders.forEach((provider) => {
    providers.set(provider.id, provider)
    providers.set(provider.name, provider)
    if (provider.plugin_id) {
      providers.set(provider.plugin_id, provider)
      providers.set(`${provider.plugin_id}/${provider.name}`, provider)
    }
  })

  return {
    providerById: providers,
    resolvedProviderTypes,
  }
}

export function useAgentToolProviderCatalog(): AgentToolProviderCatalog {
  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()
  const { data: mcpTools } = useAllMCPTools()

  return useMemo(
    () => createAgentToolProviderCatalog({ buildInTools, customTools, mcpTools, workflowTools }),
    [buildInTools, customTools, mcpTools, workflowTools],
  )
}

export function getLocalizedText(
  text: Partial<Record<string, string>> | undefined,
  language: string,
) {
  return text?.[language] ?? text?.en_US ?? text?.zh_Hans
}

export function getAgentProviderPluginId(tool: AgentToolPresentationProvider) {
  if (tool.pluginId) return tool.pluginId

  if (tool.providerType !== 'plugin' && tool.providerType !== CollectionType.builtIn) return ''

  const providerIdSegments = tool.id.split('/')
  if (providerIdSegments.length !== 3) return ''

  return providerIdSegments.slice(0, 2).join('/')
}

function getMarketplacePluginInfo(pluginId: string) {
  const [organization, plugin, ...remainingSegments] = pluginId.split('/')
  if (!organization || !plugin || remainingSegments.length > 0) return undefined

  return {
    organization,
    plugin,
  }
}

function getProviderFallbackDisplayName(tool: AgentToolPresentationProvider) {
  const providerIdSegments = tool.name.split('/').filter(Boolean)
  return providerIdSegments.at(-1) ?? tool.name
}

export function getAgentProviderToolDisplayName({
  language,
  marketplacePlugin,
  provider,
  tool,
}: {
  language: string
  marketplacePlugin?: MarketplacePlugin
  provider?: ToolWithProvider
  tool: AgentToolPresentationProvider
}) {
  if (provider) return tool.displayName ?? getLocalizedText(provider.label, language) ?? tool.name

  return (
    tool.displayName ??
    getLocalizedText(marketplacePlugin?.label ?? marketplacePlugin?.labels, language) ??
    marketplacePlugin?.name ??
    getProviderFallbackDisplayName(tool)
  )
}

export function useAgentToolPresentation(
  tools: AgentToolPresentationSource[],
  { providerById, resolvedProviderTypes }: AgentToolProviderCatalog,
) {
  const language = useGetLanguage()
  const missingMarketplacePluginInfos = useMemo(() => {
    const pluginIds = new Set<string>()

    tools.forEach((tool) => {
      if (
        tool.kind !== 'provider' ||
        !resolvedProviderTypes.has(tool.providerType) ||
        providerById.has(tool.id) ||
        providerById.has(tool.name)
      )
        return

      const pluginId = getAgentProviderPluginId(tool)
      if (pluginId) pluginIds.add(pluginId)
    })

    return Array.from(pluginIds).flatMap((pluginId) => {
      const info = getMarketplacePluginInfo(pluginId)
      return info ? [info] : []
    })
  }, [providerById, resolvedProviderTypes, tools])
  const { data: missingMarketplacePluginsData } = useFetchPluginsInMarketPlaceByInfo(
    missingMarketplacePluginInfos,
  )
  const marketplacePluginById = useMemo(
    () =>
      new Map(
        (missingMarketplacePluginsData?.data.list ?? []).map(({ plugin }) => [
          plugin.plugin_id,
          plugin,
        ]),
      ),
    [missingMarketplacePluginsData],
  )
  const toolDisplayNameById = useMemo(() => {
    const displayNames = new Map<string, string>()

    tools.forEach((tool) => {
      if (tool.kind !== 'provider') return

      const provider = providerById.get(tool.id) ?? providerById.get(tool.name)
      const marketplacePlugin = marketplacePluginById.get(getAgentProviderPluginId(tool))
      displayNames.set(
        tool.id,
        getAgentProviderToolDisplayName({ language, marketplacePlugin, provider, tool }),
      )
    })

    return displayNames
  }, [language, marketplacePluginById, providerById, tools])

  return {
    language,
    marketplacePluginById,
    toolDisplayNameById,
  }
}

export function getProviderCredentialType(
  provider?: ToolWithProvider,
): AgentProviderTool['credentialType'] {
  if (!provider) return undefined

  if (Object.keys(provider.team_credentials ?? {}).length > 0) return 'api-key'

  if (provider.type === CollectionType.builtIn && provider.allow_delete) return 'oauth2'

  return undefined
}

export function getProviderCredentialVariant(
  tool: AgentProviderTool,
  provider: ToolWithProvider,
  providerCredentialType: AgentProviderTool['credentialType'],
) {
  if (!providerCredentialType) return 'none' as const

  if (tool.credentialVariant !== 'none') return tool.credentialVariant

  return tool.credentialId || provider.is_team_authorization
    ? ('authorized' as const)
    : ('unauthorized' as const)
}

export type AgentToolPublishIssue = {
  type: 'uninstalled' | 'unauthorized'
  tool: AgentProviderTool
}

export function getAgentToolPublishIssues(
  tools: AgentTool[],
  { providerById, resolvedProviderTypes }: AgentToolProviderCatalog,
): AgentToolPublishIssue[] {
  const issues: AgentToolPublishIssue[] = []

  for (const tool of tools) {
    if (tool.kind !== 'provider') continue

    const provider = providerById.get(tool.id) ?? providerById.get(tool.name)
    if (!provider) {
      if (resolvedProviderTypes.has(tool.providerType)) {
        issues.push({
          type: 'uninstalled',
          tool,
        })
      }
      continue
    }

    const providerCredentialType = getProviderCredentialType(provider)
    if (getProviderCredentialVariant(tool, provider, providerCredentialType) === 'unauthorized') {
      issues.push({
        type: 'unauthorized',
        tool,
      })
    }
  }

  return issues
}

export function getAgentToolPublishIssue(
  tools: AgentTool[],
  catalog: AgentToolProviderCatalog,
): AgentToolPublishIssue | undefined {
  return getAgentToolPublishIssues(tools, catalog)[0]
}
