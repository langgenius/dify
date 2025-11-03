import type {
  Dispatch,
  SetStateAction,
} from 'react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type {
  BlockEnum,
  OnSelectBlock,
  ToolWithProvider,
} from '../types'
import type { ToolDefaultValue, ToolValue } from './types'
import { ToolTypeEnum } from './types'
import Tools from './tools'
import { useToolTabs } from './hooks'
import ViewTypeSelect, { ViewType } from './view-type-select'
import cn from '@/utils/classnames'
import { useGetLanguage } from '@/context/i18n'
import type { ListRef } from '@/app/components/workflow/block-selector/market-place-plugin/list'
import PluginList, { type ListProps } from '@/app/components/workflow/block-selector/market-place-plugin/list'
import { PluginType } from '../../plugins/types'
import { useMarketplacePlugins } from '../../plugins/marketplace/hooks'
import { useGlobalPublicStore } from '@/context/global-public-context'
import RAGToolRecommendations from './rag-tool-recommendations'

type AllToolsProps = {
  className?: string
  toolContentClassName?: string
  searchText: string
  tags: ListProps['tags']
  buildInTools: ToolWithProvider[]
  customTools: ToolWithProvider[]
  workflowTools: ToolWithProvider[]
  mcpTools: ToolWithProvider[]
  onSelect: OnSelectBlock
  canNotSelectMultiple?: boolean
  onSelectMultiple?: (type: BlockEnum, tools: ToolDefaultValue[]) => void
  selectedTools?: ToolValue[]
  canChooseMCPTool?: boolean
  onTagsChange: Dispatch<SetStateAction<string[]>>
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
  const language = useGetLanguage()
  const tabs = useToolTabs()
  const [activeTab, setActiveTab] = useState(ToolTypeEnum.All)
  const [activeView, setActiveView] = useState<ViewType>(ViewType.flat)
  const hasFilter = searchText || tags.length > 0
  const isMatchingKeywords = (text: string, keywords: string) => {
    return text.toLowerCase().includes(keywords.toLowerCase())
  }
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

    if (!hasFilter)
      return mergedTools.filter(toolWithProvider => toolWithProvider.tools.length > 0)

    return mergedTools.filter((toolWithProvider) => {
      return isMatchingKeywords(toolWithProvider.name, searchText) || toolWithProvider.tools.some((tool) => {
        return tool.label[language].toLowerCase().includes(searchText.toLowerCase()) || tool.name.toLowerCase().includes(searchText.toLowerCase())
      })
    })
  }, [activeTab, buildInTools, customTools, workflowTools, mcpTools, searchText, language, hasFilter])

  const {
    queryPluginsWithDebounced: fetchPlugins,
    plugins: notInstalledPlugins = [],
  } = useMarketplacePlugins()

  const { enable_marketplace } = useGlobalPublicStore(s => s.systemFeatures)
  useEffect(() => {
    if (!enable_marketplace) return
    if (searchText || tags.length > 0) {
      fetchPlugins({
        query: searchText,
        tags,
        category: PluginType.tool,
      })
    }
  }, [searchText, tags, enable_marketplace])

  const pluginRef = useRef<ListRef>(null)
  const wrapElemRef = useRef<HTMLDivElement>(null)
  const isSupportGroupView = [ToolTypeEnum.All, ToolTypeEnum.BuiltIn].includes(activeTab)

  const isShowRAGRecommendations = isInRAGPipeline && activeTab === ToolTypeEnum.All && !hasFilter

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
        className='max-h-[464px] overflow-y-auto'
        onScroll={pluginRef.current?.handleScroll}
      >
        {isShowRAGRecommendations && (
          <RAGToolRecommendations
            viewType={isSupportGroupView ? activeView : ViewType.flat}
            onSelect={onSelect}
            onTagsChange={onTagsChange}
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
          hasSearchText={!!searchText}
          selectedTools={selectedTools}
          canChooseMCPTool={canChooseMCPTool}
          isShowRAGRecommendations={isShowRAGRecommendations}
        />
        {/* Plugins from marketplace */}
        {enable_marketplace && (
          <PluginList
            ref={pluginRef}
            wrapElemRef={wrapElemRef}
            list={notInstalledPlugins}
            searchText={searchText}
            toolContentClassName={toolContentClassName}
            tags={tags}
          />
        )}
      </div>
    </div>
  )
}

export default AllTools
