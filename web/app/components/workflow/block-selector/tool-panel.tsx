import type { RagPipelineDatasourceProviderResponse } from '@dify/contracts/api/console/rag/types.gen'
import type { OnSelectBlock, ToolWithProvider } from '../types'
import { Button } from '@langgenius/dify-ui/button'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import dynamic from 'next/dynamic'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { selectToolsWithProvider } from '@/app/components/tools/utils/query-select'
import { useMarketplace } from '@/features/marketplace/client'
import { consoleQuery } from '@/service/console'
import { marketplaceCollectionPluginsQueryOptions } from '@/service/plugin-list-queries'
import { useOwnedQueryErrors } from '@/service/use-owned-query-error'
import { useRequestErrorMessage } from '@/service/use-request-error-message'
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
  const { t } = useTranslation(['workflow', 'common'])
  const buildInToolsQuery = useQuery(
    consoleQuery.workspaces.current.tools.builtin.get.queryOptions({
      select: selectToolsWithProvider,
    }),
  )
  const buildInTools = buildInToolsQuery.data
  const customToolsQuery = useQuery(
    consoleQuery.workspaces.current.tools.api.get.queryOptions({
      select: selectToolsWithProvider,
    }),
  )
  const customTools = customToolsQuery.data
  const workflowToolsQuery = useQuery(
    consoleQuery.workspaces.current.tools.workflow.get.queryOptions({
      select: selectToolsWithProvider,
    }),
  )
  const workflowTools = workflowToolsQuery.data
  const mcpToolsQuery = useQuery(
    consoleQuery.workspaces.current.tools.mcp.get.queryOptions({
      select: selectToolsWithProvider,
    }),
  )
  const mcpTools = mcpToolsQuery.data
  const toolsLoad = useOwnedQueryErrors([
    buildInToolsQuery,
    customToolsQuery,
    workflowToolsQuery,
    mcpToolsQuery,
  ])
  const toolsLoadErrorMessage = useRequestErrorMessage(
    toolsLoad?.error,
    t(($) => $['common.loadFailed'], { ns: 'workflow' }),
  )
  const queryClient = useQueryClient()
  const enableMarketplace = useMarketplace() !== null
  const workflowStore = useWorkflowStore()
  const inRAGPipeline = dataSources.length > 0
  const { data: featuredPlugins = [], isLoading: isFeaturedLoading } = useQuery(
    marketplaceCollectionPluginsQueryOptions({
      collection: '__recommended-plugins-tools',
      enabled: enableMarketplace && !inRAGPipeline,
    }),
  )
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
    <>
      {toolsLoad && (
        <div
          role="alert"
          className="mx-3 my-1 flex items-center gap-1 system-xs-regular text-text-destructive"
        >
          <span className="min-w-0 wrap-break-word">{toolsLoadErrorMessage}</span>
          <Button
            size="small"
            variant="ghost"
            loading={toolsLoad.retrying}
            onClick={toolsLoad.retry}
          >
            {t(($) => $['operation.retry'], { ns: 'common' })}
          </Button>
        </div>
      )}
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
    </>
  )
}
