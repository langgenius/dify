import type {
  Dispatch,
  RefObject,
  SetStateAction,
} from 'react'
import type { Plugin } from '../../plugins/types'
import type {
  BlockEnum,
  ToolWithProvider,
} from '../types'
import type { ToolDefaultValue, ToolValue } from './types'
import type { ListProps, ListRef } from '@/app/components/workflow/block-selector/market-place-plugin/list'
import type { OnSelectBlock } from '@/app/components/workflow/types'
import { RiArrowRightUpLine } from '@remixicon/react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Divider from '@/app/components/base/divider'
import { SearchMenu } from '@/app/components/base/icons/src/vender/line/general'
import PluginList from '@/app/components/workflow/block-selector/market-place-plugin/list'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useGetLanguage } from '@/context/i18n'
import { cn } from '@/utils/classnames'
import { getMarketplaceUrl } from '@/utils/var'
import { useMarketplacePlugins } from '../../plugins/marketplace/hooks'
import { PluginCategoryEnum } from '../../plugins/types'
import FeaturedTools from './featured-tools'
import { useToolTabs } from './hooks'
import RAGToolRecommendations from './rag-tool-recommendations'
import Tools from './tools'
import { ToolTypeEnum } from './types'
import ViewTypeSelect, { ViewType } from './view-type-select'

const marketplaceFooterClassName = 'system-sm-medium z-10 flex h-8 flex-none cursor-pointer items-center rounded-b-lg border-[0.5px] border-t border-components-panel-border bg-components-panel-bg-blur px-4 py-1 text-text-accent-light-mode-only shadow-lg'

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
  onTagsChange?: Dispatch<SetStateAction<string[]>>
  isInRAGPipeline?: boolean
  featuredPlugins?: Plugin[]
  featuredLoading?: boolean
  showFeatured?: boolean
  onFeaturedInstallSuccess?: () => Promise<void> | void
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
  onTagsChange,
  isInRAGPipeline = false,
  featuredPlugins = [],
  featuredLoading = false,
  showFeatured = false,
  onFeaturedInstallSuccess,
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
    const getLocalizedText = (text?: Record<string, string> | null) => {
      if (!text)
        return ''

      if (text[language])
        return text[language]

      if (text['en-US'])
        return text['en-US']

      const firstValue = Object.values(text).find(Boolean)
      return firstValue || ''
    }

    if (!hasFilter || !normalizedSearch)
      return mergedTools.filter(toolWithProvider => toolWithProvider.tools.length > 0)

    return mergedTools.reduce<ToolWithProvider[]>((acc, toolWithProvider) => {
      const providerLabel = getLocalizedText(toolWithProvider.label)
      const providerMatches = [
        toolWithProvider.name,
        providerLabel,
      ].some(text => isMatchingKeywords(text || '', normalizedSearch))

      if (providerMatches) {
        if (toolWithProvider.tools.length > 0)
          acc.push(toolWithProvider)
        return acc
      }

      const matchedTools = toolWithProvider.tools.filter((tool) => {
        const toolLabel = getLocalizedText(tool.label)
        return [
          tool.name,
          toolLabel,
        ].some(text => isMatchingKeywords(text || '', normalizedSearch))
      })

      if (matchedTools.length > 0) {
        acc.push({
          ...toolWithProvider,
          tools: matchedTools,
        })
      }

      return acc
    }, [])
  }, [activeTab, buildInTools, customTools, workflowTools, mcpTools, trimmedSearchText, hasFilter, language])

  const {
    queryPluginsWithDebounced: fetchPlugins,
    plugins: notInstalledPlugins = [],
  } = useMarketplacePlugins()

  const { enable_marketplace } = useGlobalPublicStore(s => s.systemFeatures)

  useEffect(() => {
    if (!enable_marketplace)
      return
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
  const hasToolsListContent = tools.length > 0 || isShowRAGRecommendations
  const hasPluginContent = enable_marketplace && notInstalledPlugins.length > 0
  const shouldShowEmptyState = hasFilter && !hasToolsListContent && !hasPluginContent
  const shouldShowFeatured = showFeatured
    && enable_marketplace
    && !isInRAGPipeline
    && activeTab === ToolTypeEnum.All
    && !hasFilter
  const shouldShowMarketplaceFooter = enable_marketplace && !hasFilter

  const handleRAGSelect = useCallback<OnSelectBlock>((type, pluginDefaultValue) => {
    if (!pluginDefaultValue)
      return
    onSelect(type, pluginDefaultValue as ToolDefaultValue)
  }, [onSelect])

  return (
    <div className={cn('max-w-[500px]', className)}>
      <div className="flex items-center justify-between border-b border-divider-subtle px-3">
        <div className="flex h-8 items-center space-x-1">
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
      <div className="flex max-h-[464px] flex-col">
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
                onTagsChange={onTagsChange}
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
                  <Divider className="!h-px" />
                </div>
              </>
            )}
            {hasToolsListContent && (
              <>
                <div className="px-3 pb-1 pt-2">
                  <span className="system-xs-medium text-text-primary">{t('allTools', { ns: 'tools' })}</span>
                </div>
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
                />
              </>
            )}
            {enable_marketplace && (
              <PluginList
                ref={pluginRef}
                wrapElemRef={wrapElemRef as RefObject<HTMLElement>}
                list={notInstalledPlugins}
                searchText={searchText}
                category={PluginCategoryEnum.tool}
                toolContentClassName={toolContentClassName}
                tags={tags}
                hideFindMoreFooter
              />
            )}
          </div>

          {shouldShowEmptyState && (
            <div className="flex h-full flex-col items-center justify-center gap-3 py-12 text-center">
              <SearchMenu className="h-8 w-8 text-text-quaternary" />
              <div className="text-sm font-medium text-text-secondary">
                {t('tabs.noPluginsFound', { ns: 'workflow' })}
              </div>
              <Link
                href="https://github.com/langgenius/dify-plugins/issues/new?template=plugin_request.yaml"
                target="_blank"
              >
                <Button
                  size="small"
                  variant="secondary-accent"
                  className="h-6 cursor-pointer px-3 text-xs"
                >
                  {t('tabs.requestToCommunity', { ns: 'workflow' })}
                </Button>
              </Link>
            </div>
          )}
        </div>
        {shouldShowMarketplaceFooter && (
          <Link
            className={marketplaceFooterClassName}
            href={getMarketplaceUrl('', { category: PluginCategoryEnum.tool })}
            target="_blank"
          >
            <span>{t('findMoreInMarketplace', { ns: 'plugin' })}</span>
            <RiArrowRightUpLine className="ml-0.5 h-3 w-3" />
          </Link>
        )}
      </div>
    </div>
  )
}

export default AllTools
