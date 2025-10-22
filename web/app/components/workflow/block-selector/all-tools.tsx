import type {
  Dispatch,
  RefObject,
  SetStateAction,
} from 'react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import type {
  BlockEnum,
  ToolWithProvider,
} from '../types'
import type { ToolDefaultValue, ToolValue } from './types'
import { ToolTypeEnum } from './types'
import Tools from './tools'
import { useToolTabs } from './hooks'
import ViewTypeSelect, { ViewType } from './view-type-select'
import cn from '@/utils/classnames'
import Button from '@/app/components/base/button'
import { SearchMenu } from '@/app/components/base/icons/src/vender/line/general'
import { useGetLanguage } from '@/context/i18n'
import type { ListRef } from '@/app/components/workflow/block-selector/market-place-plugin/list'
import PluginList, { type ListProps } from '@/app/components/workflow/block-selector/market-place-plugin/list'
import { PluginCategoryEnum } from '../../plugins/types'
import { useMarketplacePlugins } from '../../plugins/marketplace/hooks'
import { useGlobalPublicStore } from '@/context/global-public-context'
import RAGToolSuggestions from './rag-tool-suggestions'
import FeaturedTools from './featured-tools'
import { useCheckInstalled, useRecommendedMarketplacePlugins } from '@/service/use-plugins'
import { useInvalidateAllBuiltInTools } from '@/service/use-tools'
import Link from 'next/link'

type AllToolsProps = {
  className?: string
  toolContentClassName?: string
  searchText: string
  tags: ListProps['tags']
  buildInTools: ToolWithProvider[]
  customTools: ToolWithProvider[]
  workflowTools: ToolWithProvider[]
  mcpTools: ToolWithProvider[]
  onSelect: (type: BlockEnum, tool: ToolDefaultValue) => void
  canNotSelectMultiple?: boolean
  onSelectMultiple?: (type: BlockEnum, tools: ToolDefaultValue[]) => void
  selectedTools?: ToolValue[]
  canChooseMCPTool?: boolean
  onTagsChange?: Dispatch<SetStateAction<string[]>>
  isInRAGPipeline?: boolean
}

const DEFAULT_TAGS: AllToolsProps['tags'] = []

const AllTools = ({
  className,
  toolContentClassName,
  searchText,
  tags = DEFAULT_TAGS,
  onSelect,
  canNotSelectMultiple,
  onSelectMultiple,
  buildInTools,
  workflowTools,
  customTools,
  mcpTools = [],
  selectedTools,
  canChooseMCPTool,
  onTagsChange,
  isInRAGPipeline = false,
}: AllToolsProps) => {
  const { t } = useTranslation()
  const language = useGetLanguage()
  const tabs = useToolTabs()
  const [activeTab, setActiveTab] = useState(ToolTypeEnum.All)
  const [activeView, setActiveView] = useState<ViewType>(ViewType.flat)
  const trimmedSearchText = searchText.trim()
  const hasSearchText = trimmedSearchText.length > 0
  const hasTags = tags.length > 0
  const hasFilter = hasSearchText || hasTags
  const isMatchingKeywords = (text: string, keywords: string) => {
    return text.toLowerCase().includes(keywords.toLowerCase())
  }
  const allProviders = useMemo(() => [...buildInTools, ...customTools, ...workflowTools, ...mcpTools], [buildInTools, customTools, workflowTools, mcpTools])
  const providerMap = useMemo(() => {
    const map = new Map<string, ToolWithProvider>()
    allProviders.forEach((provider) => {
      const key = provider.plugin_id || provider.id
      if (key)
        map.set(key, provider)
    })
    return map
  }, [allProviders])
  const tools = useMemo(() => {
    let mergedTools: ToolWithProvider[] = []
    if (activeTab === ToolTypeEnum.All)
      mergedTools = [...buildInTools, ...customTools, ...workflowTools, ...mcpTools]
    if (activeTab === ToolTypeEnum.BuiltIn)
      mergedTools = buildInTools
    if (activeTab === ToolTypeEnum.Custom)
      mergedTools = customTools
    if (activeTab === ToolTypeEnum.Workflow)
      mergedTools = workflowTools
    if (activeTab === ToolTypeEnum.MCP)
      mergedTools = mcpTools

    const normalizedSearch = trimmedSearchText.toLowerCase()

    if (!hasFilter || !normalizedSearch)
      return mergedTools.filter(toolWithProvider => toolWithProvider.tools.length > 0)

    return mergedTools.reduce<ToolWithProvider[]>((acc, toolWithProvider) => {
      const providerLabel = toolWithProvider.label?.[language] || ''
      const providerMatches = isMatchingKeywords(toolWithProvider.name, normalizedSearch)
        || (providerLabel && isMatchingKeywords(providerLabel, normalizedSearch))

      if (providerMatches) {
        if (toolWithProvider.tools.length > 0)
          acc.push(toolWithProvider)
        return acc
      }

      const matchedTools = toolWithProvider.tools.filter((tool) => {
        const toolLabel = tool.label?.[language] || ''
        const toolDescription = typeof tool.description === 'object' ? tool.description?.[language] : ''
        return (
          (toolLabel && toolLabel.toLowerCase().includes(normalizedSearch))
          || tool.name.toLowerCase().includes(normalizedSearch)
          || (typeof toolDescription === 'string' && toolDescription.toLowerCase().includes(normalizedSearch))
        )
      })

      if (matchedTools.length > 0) {
        acc.push({
          ...toolWithProvider,
          tools: matchedTools,
        })
      }

      return acc
    }, [])
  }, [activeTab, buildInTools, customTools, workflowTools, mcpTools, trimmedSearchText, language, hasFilter])

  const {
    queryPluginsWithDebounced: fetchPlugins,
    plugins: notInstalledPlugins = [],
  } = useMarketplacePlugins()

  const { enable_marketplace } = useGlobalPublicStore(s => s.systemFeatures)
  const {
    data: recommendedPlugins = [],
    isLoading: isLoadingRecommended,
  } = useRecommendedMarketplacePlugins({
    enabled: enable_marketplace,
  })
  const recommendedPluginIds = useMemo(
    () => recommendedPlugins.map(plugin => plugin.plugin_id),
    [recommendedPlugins],
  )
  const installedCheck = useCheckInstalled({
    pluginIds: recommendedPluginIds,
    enabled: recommendedPluginIds.length > 0,
  })
  const installedPluginIds = useMemo(
    () => new Set(installedCheck.data?.plugins.map(plugin => plugin.plugin_id) ?? []),
    [installedCheck.data],
  )
  const loadingRecommendedInstallStatus = installedCheck.isLoading || installedCheck.isRefetching
  const invalidateBuiltInTools = useInvalidateAllBuiltInTools()

  useEffect(() => {
    if (!enable_marketplace) return
    if (hasFilter) {
      fetchPlugins({
        query: searchText,
        tags,
        category: PluginCategoryEnum.tool,
      })
    }
  }, [searchText, tags, enable_marketplace, hasFilter, fetchPlugins])

  const pluginRef = useRef<ListRef>(null)
  const wrapElemRef = useRef<HTMLDivElement>(null)
  const isSupportGroupView = [ToolTypeEnum.All, ToolTypeEnum.BuiltIn].includes(activeTab)

  const isShowRAGRecommendations = isInRAGPipeline && activeTab === ToolTypeEnum.All && !hasFilter
  const hasToolsContent = tools.length > 0
  const hasPluginContent = enable_marketplace && notInstalledPlugins.length > 0
  const shouldShowEmptyState = hasFilter && !hasToolsContent && !hasPluginContent
  const shouldShowFeatured = enable_marketplace
    && activeTab === ToolTypeEnum.All
    && !hasFilter
    && !isLoadingRecommended
    && recommendedPlugins.length > 0

  return (
    <div className={cn('min-w-[400px] max-w-[500px]', className)}>
      <div className='flex items-center justify-between border-b border-divider-subtle px-3'>
        <div className='flex h-8 items-center space-x-1'>
          {
            tabs.map(tab => (
              <div
                className={cn(
                  'flex h-6 cursor-pointer items-center rounded-md px-2 hover:bg-state-base-hover',
                  'text-xs font-medium text-text-secondary',
                  activeTab === tab.key && 'bg-state-base-hover-alt',
                )}
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.name}
              </div>
            ))
          }
        </div>
        {isSupportGroupView && (
          <ViewTypeSelect viewType={activeView} onChange={setActiveView} />
        )}
      </div>
      <div
        ref={wrapElemRef}
        className='flex max-h-[464px] flex-col overflow-y-auto'
        onScroll={pluginRef.current?.handleScroll}
      >
        <div className={cn('flex-1', shouldShowEmptyState && 'hidden')}>
          {isShowRAGRecommendations && onTagsChange && (
            <RAGToolSuggestions
              viewType={isSupportGroupView ? activeView : ViewType.flat}
              onSelect={onSelect}
              onTagsChange={onTagsChange}
            />
          )}
          {shouldShowFeatured && (
            <FeaturedTools
              plugins={recommendedPlugins}
              providerMap={providerMap}
              onSelect={onSelect}
              selectedTools={selectedTools}
              canChooseMCPTool={canChooseMCPTool}
              installedPluginIds={installedPluginIds}
              loadingInstalledStatus={loadingRecommendedInstallStatus}
              onInstallSuccess={async () => {
                invalidateBuiltInTools()
                await installedCheck.refetch()
              }}
            />
          )}
          <Tools
            className={toolContentClassName}
            tools={tools}
            onSelect={onSelect}
            canNotSelectMultiple={canNotSelectMultiple}
            onSelectMultiple={onSelectMultiple}
            toolType={activeTab}
            viewType={isSupportGroupView ? activeView : ViewType.flat}
            hasSearchText={hasSearchText}
            selectedTools={selectedTools}
            canChooseMCPTool={canChooseMCPTool}
            isShowRAGRecommendations={isShowRAGRecommendations}
          />
          {/* Plugins from marketplace */}
          {enable_marketplace && (
            <PluginList
              ref={pluginRef}
              wrapElemRef={wrapElemRef as RefObject<HTMLElement>}
              list={notInstalledPlugins}
              searchText={searchText}
              toolContentClassName={toolContentClassName}
              tags={tags}
            />
          )}
        </div>

        {shouldShowEmptyState && (
          <div className='flex h-full flex-col items-center justify-center gap-3 py-12 text-center'>
            <SearchMenu className='h-8 w-8 text-text-quaternary' />
            <div className='text-sm font-medium text-text-secondary'>
              {t('workflow.tabs.noPluginsFound')}
            </div>
            <Link
              href='https://github.com/langgenius/dify-plugins/issues/new?template=plugin_request.yaml'
              target='_blank'
            >
              <Button
                size='small'
                variant='secondary-accent'
                className='h-6 cursor-pointer px-3 text-xs'
              >
                {t('workflow.tabs.requestToCommunity')}
              </Button>
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}

export default AllTools
