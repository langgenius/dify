import type { ReactNode, RefObject } from 'react'
import type { Plugin } from '../../plugins/types'
import type { BlockEnum, ToolWithProvider } from '../types'
import type { ToolDefaultValue, ToolValue } from './types'
import type {
  ListProps,
  ListRef,
} from '@/app/components/workflow/block-selector/marketplace-plugin/list'
import type { OnSelectBlock } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import { buildIntegrationPath } from '@/app/components/integrations/routes'
import { useMarketplacePlugins } from '@/app/components/plugins/marketplace/query'
import { getMarketplaceCategoryUrl } from '@/app/components/plugins/marketplace/utils'
import PluginList from '@/app/components/workflow/block-selector/marketplace-plugin/list'
import { useGetLanguage } from '@/context/i18n'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import Link from '@/next/link'
import { PluginCategoryEnum } from '../../plugins/types'
import FeaturedTools from './featured-tools'
import { useToolTabs } from './hooks'
import { RAGToolRecommendations } from './rag-tool-recommendations'
import Tools from './tools'
import { ToolType, ViewType } from './types'
import ViewTypeSelect from './view-type-select'

const marketplaceFooterClassName =
  'system-sm-medium flex h-8 flex-none items-center border-t border-divider-subtle bg-components-panel-bg-blur px-4 py-1'

function ToolsEmptyState({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-3 px-4 py-12 text-center">
      <span
        aria-hidden
        className="i-custom-vender-line-general-search-menu size-8 text-text-quaternary"
      />
      <div aria-live="polite" className="system-sm-medium text-text-secondary">
        {title}
      </div>
      {action}
    </div>
  )
}

function ToolCategoryEmptyState({ type }: { type: ToolType }) {
  const { t } = useTranslation()
  const title = t(($) => $[`addToolModal.${type}.title`], { ns: 'tools' })
  const tip = t(($) => $[`addToolModal.${type}.tip`], { ns: 'tools' })
  const href = (() => {
    if (type === ToolType.Custom) return buildIntegrationPath('custom-tool')
    if (type === ToolType.Workflow) return buildIntegrationPath('workflow-tool')
    if (type === ToolType.MCP) return buildIntegrationPath('mcp')
    return undefined
  })()

  return (
    <ToolsEmptyState
      title={title}
      action={
        href && tip ? (
          <Link
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-md system-xs-regular text-text-tertiary hover:text-text-accent focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          >
            <span>{tip}</span>
            <span aria-hidden className="ml-0.5 i-ri-arrow-right-up-line size-3" />
          </Link>
        ) : undefined
      }
    />
  )
}

type ToolBrowserProps = {
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
  onTagsChange?: (tags: string[]) => void
  isInRAGPipeline?: boolean
  featuredPlugins?: Plugin[]
  featuredLoading?: boolean
  showFeatured?: boolean
  onFeaturedInstallSuccess?: () => Promise<void> | void
}

const DEFAULT_TAGS: ToolBrowserProps['tags'] = []

function ToolBrowser({
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
  onTagsChange,
  isInRAGPipeline = false,
  featuredPlugins = [],
  featuredLoading = false,
  showFeatured = false,
  onFeaturedInstallSuccess,
}: ToolBrowserProps) {
  const { t } = useTranslation()
  const language = useGetLanguage()
  const tabs = useToolTabs()
  const [activeTab, setActiveTab] = useState<ToolType>(ToolType.All)
  const [activeView, setActiveView] = useState<ViewType>(ViewType.flat)
  const trimmedSearchText = searchText.trim()
  const hasSearchText = trimmedSearchText.length > 0
  const hasTags = tags.length > 0
  const hasFilter = hasSearchText || hasTags
  const marketplaceFilters = useMemo(
    () => ({ query: trimmedSearchText, tags }),
    [tags, trimmedSearchText],
  )
  const debouncedMarketplaceFilters = useDebounce(marketplaceFilters, { wait: 500 })
  const isMarketplaceSearchSettled = debouncedMarketplaceFilters === marketplaceFilters
  const handleLoadMoreRAGTools = () => {
    if (!onTagsChange || tags.includes('rag')) return
    onTagsChange([...tags, 'rag'])
  }
  const isMatchingKeywords = (text: string, keywords: string) => {
    return text.toLowerCase().includes(keywords.toLowerCase())
  }
  const allProviders = useMemo(
    () => [...buildInTools, ...customTools, ...workflowTools, ...mcpTools],
    [buildInTools, customTools, workflowTools, mcpTools],
  )
  const providerMap = useMemo(() => {
    const map = new Map<string, ToolWithProvider>()
    allProviders.forEach((provider) => {
      const key = provider.plugin_id || provider.id
      if (key) map.set(key, provider)
    })
    return map
  }, [allProviders])
  const tools = useMemo(() => {
    let mergedTools: ToolWithProvider[] = []
    if (activeTab === ToolType.All)
      mergedTools = [...buildInTools, ...customTools, ...workflowTools, ...mcpTools]
    if (activeTab === ToolType.BuiltIn) mergedTools = buildInTools
    if (activeTab === ToolType.Custom) mergedTools = customTools
    if (activeTab === ToolType.Workflow) mergedTools = workflowTools
    if (activeTab === ToolType.MCP) mergedTools = mcpTools

    const normalizedSearch = trimmedSearchText.toLowerCase()
    const getLocalizedText = (text?: Record<string, string> | null) => {
      if (!text) return ''

      if (text[language]) return text[language]

      if (text['en-US']) return text['en-US']

      const firstValue = Object.values(text).find(Boolean)
      return firstValue || ''
    }

    if (!hasFilter || !normalizedSearch)
      return mergedTools.filter((toolWithProvider) => toolWithProvider.tools.length > 0)

    return mergedTools.reduce<ToolWithProvider[]>((acc, toolWithProvider) => {
      const providerLabel = getLocalizedText(toolWithProvider.label)
      const providerMatches = [toolWithProvider.name, providerLabel].some((text) =>
        isMatchingKeywords(text || '', normalizedSearch),
      )

      if (providerMatches) {
        if (toolWithProvider.tools.length > 0) acc.push(toolWithProvider)
        return acc
      }

      const matchedTools = toolWithProvider.tools.filter((tool) => {
        const toolLabel = getLocalizedText(tool.label)
        return [tool.name, toolLabel].some((text) =>
          isMatchingKeywords(text || '', normalizedSearch),
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
  }, [
    activeTab,
    buildInTools,
    customTools,
    workflowTools,
    mcpTools,
    trimmedSearchText,
    hasFilter,
    language,
  ])

  const { data: enable_marketplace } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: (s) => s.enable_marketplace,
  })
  const marketplaceSearchParams = useMemo(
    () =>
      enable_marketplace && hasFilter && isMarketplaceSearchSettled
        ? {
            query: debouncedMarketplaceFilters.query,
            tags: debouncedMarketplaceFilters.tags,
            category: PluginCategoryEnum.tool,
          }
        : undefined,
    [debouncedMarketplaceFilters, enable_marketplace, hasFilter, isMarketplaceSearchSettled],
  )
  const { data: marketplacePluginsData, isFetching: isMarketplaceFetching } =
    useMarketplacePlugins(marketplaceSearchParams)
  const notInstalledPlugins = useMemo(
    () => marketplacePluginsData?.pages.flatMap((page) => page.plugins) ?? [],
    [marketplacePluginsData?.pages],
  )

  const pluginRef = useRef<ListRef>(null)
  const wrapElemRef = useRef<HTMLDivElement>(null)
  const isSupportGroupView = activeTab === ToolType.All || activeTab === ToolType.BuiltIn

  const isShowRAGRecommendations = isInRAGPipeline && activeTab === ToolType.All && !hasFilter
  const hasToolsListContent = tools.length > 0 || isShowRAGRecommendations
  const hasPluginContent = enable_marketplace && notInstalledPlugins.length > 0
  const isMarketplaceSearchPending =
    enable_marketplace && hasFilter && (!isMarketplaceSearchSettled || isMarketplaceFetching)
  const shouldShowEmptyState =
    hasFilter && !isMarketplaceSearchPending && !hasToolsListContent && !hasPluginContent
  const shouldShowCategoryEmptyState =
    !hasFilter && activeTab !== ToolType.All && !hasToolsListContent
  const shouldShowFeatured =
    showFeatured &&
    enable_marketplace &&
    !isInRAGPipeline &&
    activeTab === ToolType.All &&
    !hasFilter
  const shouldShowMarketplaceFooter = enable_marketplace && !hasFilter

  const handleRAGSelect = useCallback<OnSelectBlock>(
    (type, pluginDefaultValue) => {
      if (!pluginDefaultValue) return
      onSelect(type, pluginDefaultValue as ToolDefaultValue)
    },
    [onSelect],
  )
  const toolsListTitle = useMemo(() => {
    if (activeTab === ToolType.BuiltIn) return t(($) => $.allToolPlugins, { ns: 'tools' })
    if (activeTab === ToolType.Custom) return t(($) => $.allSwaggerAPIAsTool, { ns: 'tools' })
    if (activeTab === ToolType.Workflow) return t(($) => $.allWorkflowAsTool, { ns: 'tools' })
    if (activeTab === ToolType.MCP) return t(($) => $.allMCP, { ns: 'tools' })
    return t(($) => $.allTools, { ns: 'tools' })
  }, [activeTab, t])

  return (
    <div className={cn('max-w-125', className)}>
      <div className="flex items-center justify-between border-b border-divider-subtle px-3">
        <div className="flex h-8 items-center space-x-1">
          {tabs.map((tab) => (
            <button
              type="button"
              className={cn(
                'flex h-6 cursor-pointer items-center rounded-md border-0 bg-transparent px-2 hover:bg-state-base-hover focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid focus-visible:outline-hidden',
                'text-xs font-medium text-text-secondary',
                activeTab === tab.key && 'bg-state-base-hover-alt',
              )}
              key={tab.key}
              aria-pressed={activeTab === tab.key}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.name}
            </button>
          ))}
        </div>
        {isSupportGroupView && <ViewTypeSelect viewType={activeView} onChange={setActiveView} />}
      </div>
      <div className="flex max-h-116 flex-col">
        <div
          ref={wrapElemRef}
          className="flex-1 overflow-y-auto"
          onScroll={() => pluginRef.current?.handleScroll()}
        >
          <div className={cn(shouldShowEmptyState && 'hidden')}>
            {isShowRAGRecommendations && onTagsChange && (
              <RAGToolRecommendations
                viewType={isSupportGroupView ? activeView : ViewType.flat}
                onSelect={handleRAGSelect}
                onLoadMore={handleLoadMoreRAGTools}
              />
            )}
            {shouldShowFeatured && (
              <>
                <FeaturedTools
                  plugins={featuredPlugins}
                  providerMap={providerMap}
                  onSelect={onSelect}
                  selectedTools={selectedTools}
                  isLoading={featuredLoading}
                  onInstallSuccess={async () => {
                    await onFeaturedInstallSuccess?.()
                  }}
                />
                <div className="px-3">
                  <Divider className="h-px!" />
                </div>
              </>
            )}
            {hasToolsListContent && (
              <>
                <div className="px-3 pt-2 pb-1">
                  <span className="system-xs-medium text-text-primary">{toolsListTitle}</span>
                </div>
                <Tools
                  className={toolContentClassName}
                  tools={tools}
                  onSelect={onSelect}
                  canNotSelectMultiple={canNotSelectMultiple}
                  onSelectMultiple={onSelectMultiple}
                  viewType={isSupportGroupView ? activeView : ViewType.flat}
                  hasSearchText={hasSearchText}
                  selectedTools={selectedTools}
                />
              </>
            )}
            {shouldShowCategoryEmptyState && <ToolCategoryEmptyState type={activeTab} />}
            {enable_marketplace && (
              <PluginList
                ref={pluginRef}
                wrapElemRef={wrapElemRef as RefObject<HTMLElement>}
                list={notInstalledPlugins}
                searchText={trimmedSearchText}
                category={PluginCategoryEnum.tool}
                toolContentClassName={toolContentClassName}
                tags={tags}
                hideFindMoreFooter
              />
            )}
          </div>

          {shouldShowEmptyState && (
            <ToolsEmptyState
              title={t(($) => $['tabs.noPluginsFound'], { ns: 'workflow' })}
              action={
                <Link
                  href="https://github.com/langgenius/dify-plugins/issues/new?template=plugin_request.yaml"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-6 items-center justify-center rounded-md border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-3 text-xs font-medium text-components-button-secondary-accent-text shadow-xs hover:border-components-button-secondary-border-hover hover:bg-components-button-secondary-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
                >
                  {t(($) => $['tabs.requestToCommunity'], { ns: 'workflow' })}
                </Link>
              }
            />
          )}
        </div>
        {shouldShowMarketplaceFooter && (
          <footer className={marketplaceFooterClassName}>
            <Link
              className="inline-flex items-center rounded-md text-text-accent-light-mode-only focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
              href={getMarketplaceCategoryUrl(PluginCategoryEnum.tool)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span>{t(($) => $.findMoreInMarketplace, { ns: 'plugin' })}</span>
              <span aria-hidden className="ml-0.5 i-ri-arrow-right-up-line size-3" />
            </Link>
          </footer>
        )}
      </div>
    </div>
  )
}

export default ToolBrowser
