import type { RagPipelineDatasourceProviderResponse } from '@dify/contracts/api/console/rag/types.gen'
import type { OnSelectBlock, ToolWithProvider } from '../types'
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import dynamic from 'next/dynamic'
import { useEffect, useMemo } from 'react'
import { selectToolsWithProvider } from '@/app/components/tools/utils/query-select'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { consoleQuery } from '@/service/console'
import { useFeaturedToolsRecommendations } from '@/service/use-plugins'
import { basePath } from '@/utils/var'
import { useWorkflowStore } from '../store'

const ToolBrowser = dynamic(() => import('./tool-browser'), {
  loading: () => <div className="h-24 animate-pulse rounded-lg bg-background-section" />,
})

function normalizeToolList(list: ToolWithProvider[] | undefined, currentBasePath?: string) {
  if (!list || !currentBasePath) return list

  let changed = false
  const normalized = list.map((provider) => {
    if (typeof provider.icon !== 'string') return provider

    const shouldPrefix =
      provider.icon.startsWith('/') && !provider.icon.startsWith(`${currentBasePath}/`)

    if (!shouldPrefix) return provider

    changed = true
    return {
      ...provider,
      icon: `${currentBasePath}${provider.icon}`,
    }
  })

  return changed ? normalized : list
}

function getStoreToolUpdates({
  state,
  buildInTools,
  customTools,
  workflowTools,
  mcpTools,
}: {
  state: {
    buildInTools?: ToolWithProvider[]
    customTools?: ToolWithProvider[]
    workflowTools?: ToolWithProvider[]
    mcpTools?: ToolWithProvider[]
  }
  buildInTools?: ToolWithProvider[]
  customTools?: ToolWithProvider[]
  workflowTools?: ToolWithProvider[]
  mcpTools?: ToolWithProvider[]
}) {
  const updates: Partial<typeof state> = {}

  if (buildInTools !== undefined && state.buildInTools !== buildInTools)
    updates.buildInTools = buildInTools
  if (customTools !== undefined && state.customTools !== customTools)
    updates.customTools = customTools
  if (workflowTools !== undefined && state.workflowTools !== workflowTools)
    updates.workflowTools = workflowTools
  if (mcpTools !== undefined && state.mcpTools !== mcpTools) updates.mcpTools = mcpTools

  return updates
}

export function ToolPanel({
  searchText,
  tags,
  onTagsChange,
  onSelect,
  dataSources,
}: {
  searchText: string
  tags: string[]
  onTagsChange: (tags: string[]) => void
  onSelect: OnSelectBlock
  dataSources: RagPipelineDatasourceProviderResponse[]
}) {
  const { data: buildInTools } = useQuery(
    consoleQuery.workspaces.current.tools.builtin.get.queryOptions({
      select: selectToolsWithProvider,
    }),
  )
  const { data: customTools } = useQuery(
    consoleQuery.workspaces.current.tools.api.get.queryOptions({ select: selectToolsWithProvider }),
  )
  const { data: workflowTools } = useQuery(
    consoleQuery.workspaces.current.tools.workflow.get.queryOptions({
      select: selectToolsWithProvider,
    }),
  )
  const { data: mcpTools } = useQuery(
    consoleQuery.workspaces.current.tools.mcp.get.queryOptions({ select: selectToolsWithProvider }),
  )
  const queryClient = useQueryClient()
  const { data: enableMarketplace } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: (systemFeatures) => systemFeatures.enable_marketplace,
  })
  const workflowStore = useWorkflowStore()
  const inRAGPipeline = dataSources.length > 0
  const { plugins: featuredPlugins = [], isLoading: isFeaturedLoading } =
    useFeaturedToolsRecommendations(enableMarketplace && !inRAGPipeline)
  const normalizedBuiltInTools = useMemo(
    () => normalizeToolList(buildInTools, basePath),
    [buildInTools],
  )
  const normalizedCustomTools = useMemo(
    () => normalizeToolList(customTools, basePath),
    [customTools],
  )
  const normalizedWorkflowTools = useMemo(
    () => normalizeToolList(workflowTools, basePath),
    [workflowTools],
  )
  const normalizedMcpTools = useMemo(() => normalizeToolList(mcpTools, basePath), [mcpTools])

  useEffect(() => {
    workflowStore.setState((state) => {
      const updates = getStoreToolUpdates({
        state,
        buildInTools: normalizedBuiltInTools,
        customTools: normalizedCustomTools,
        workflowTools: normalizedWorkflowTools,
        mcpTools: normalizedMcpTools,
      })
      if (!Object.keys(updates).length) return state
      return {
        ...state,
        ...updates,
      }
    })
  }, [
    normalizedBuiltInTools,
    normalizedCustomTools,
    normalizedMcpTools,
    normalizedWorkflowTools,
    workflowStore,
  ])

  return (
    <ToolBrowser
      searchText={searchText}
      onSelect={onSelect}
      tags={tags}
      canNotSelectMultiple
      buildInTools={normalizedBuiltInTools || []}
      customTools={normalizedCustomTools || []}
      workflowTools={normalizedWorkflowTools || []}
      mcpTools={normalizedMcpTools || []}
      onTagsChange={onTagsChange}
      isInRAGPipeline={inRAGPipeline}
      featuredPlugins={featuredPlugins}
      featuredLoading={isFeaturedLoading}
      showFeatured={enableMarketplace && !inRAGPipeline}
      onFeaturedInstallSuccess={() =>
        queryClient.invalidateQueries({
          queryKey: consoleQuery.workspaces.current.tools.builtin.get.queryKey(),
        })
      }
    />
  )
}
