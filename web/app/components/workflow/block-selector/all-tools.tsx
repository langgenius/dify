import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type {
  OnSelectBlock,
  ToolWithProvider,
} from '../types'
import type { ToolValue } from './types'
import { ToolTypeEnum } from './types'
import Tools from './tools'
import { useToolTabs } from './hooks'
import ViewTypeSelect, { ViewType } from './view-type-select'
import cn from '@/utils/classnames'
import { useGetLanguage } from '@/context/i18n'
import PluginList from '@/app/components/workflow/block-selector/market-place-plugin/list'
import ActionButton from '../../base/action-button'
import { RiAddLine } from '@remixicon/react'
import { PluginType } from '../../plugins/types'
import { useMarketplacePlugins } from '../../plugins/marketplace/hooks'

type AllToolsProps = {
  className?: string
  toolContentClassName?: string
  searchText: string
  tags: string[]
  buildInTools: ToolWithProvider[]
  customTools: ToolWithProvider[]
  workflowTools: ToolWithProvider[]
  onSelect: OnSelectBlock
  supportAddCustomTool?: boolean
  onAddedCustomTool?: () => void
  onShowAddCustomCollectionModal?: () => void
  selectedTools?: ToolValue[]
}
const AllTools = ({
  className,
  toolContentClassName,
  searchText,
  tags = [],
  onSelect,
  buildInTools,
  workflowTools,
  customTools,
  supportAddCustomTool,
  onShowAddCustomCollectionModal,
  selectedTools,
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
      mergedTools = [...buildInTools, ...customTools, ...workflowTools]
    if (activeTab === ToolTypeEnum.BuiltIn)
      mergedTools = buildInTools
    if (activeTab === ToolTypeEnum.Custom)
      mergedTools = customTools
    if (activeTab === ToolTypeEnum.Workflow)
      mergedTools = workflowTools

    if (!hasFilter)
      return mergedTools.filter(toolWithProvider => toolWithProvider.tools.length > 0)

    return mergedTools.filter((toolWithProvider) => {
      return isMatchingKeywords(toolWithProvider.name, searchText) || toolWithProvider.tools.some((tool) => {
        return tool.label[language].toLowerCase().includes(searchText.toLowerCase()) || tool.name.toLowerCase().includes(searchText.toLowerCase())
      })
    })
  }, [activeTab, buildInTools, customTools, workflowTools, searchText, language, hasFilter])

  const {
    queryPluginsWithDebounced: fetchPlugins,
    plugins: notInstalledPlugins = [],
  } = useMarketplacePlugins()

  useEffect(() => {
    if (searchText || tags.length > 0) {
      fetchPlugins({
        query: searchText,
        tags,
        category: PluginType.tool,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText, tags])

  const pluginRef = useRef(null)
  const wrapElemRef = useRef<HTMLDivElement>(null)

  return (
    <div className={cn(className)}>
      <div className='bg-background-default-hover border-divider-subtle shadow-xs flex items-center justify-between border-b-[0.5px] px-3'>
        <div className='flex h-8 items-center space-x-1'>
          {
            tabs.map(tab => (
              <div
                className={cn(
                  'hover:bg-state-base-hover flex h-6 cursor-pointer items-center rounded-md px-2',
                  'text-text-secondary text-xs font-medium',
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
        <ViewTypeSelect viewType={activeView} onChange={setActiveView} />
        {supportAddCustomTool && (
          <div className='flex items-center'>
            <div className='bg-divider-regular mr-1.5 h-3.5  w-px'></div>
            <ActionButton
              className='bg-components-button-primary-bg hover:bg-components-button-primary-bg text-components-button-primary-text hover:text-components-button-primary-text'
              onClick={onShowAddCustomCollectionModal}
            >
              <RiAddLine className='h-4 w-4' />
            </ActionButton>
          </div>
        )}
      </div>
      <div
        ref={wrapElemRef}
        className='max-h-[464px] overflow-y-auto'
        onScroll={(pluginRef.current as any)?.handleScroll}
      >
        <Tools
          className={toolContentClassName}
          showWorkflowEmpty={activeTab === ToolTypeEnum.Workflow}
          tools={tools}
          onSelect={onSelect}
          viewType={activeView}
          hasSearchText={!!searchText}
          selectedTools={selectedTools}
        />
        {/* Plugins from marketplace */}
        <PluginList
          wrapElemRef={wrapElemRef}
          list={notInstalledPlugins as any} ref={pluginRef}
          searchText={searchText}
          toolContentClassName={toolContentClassName}
          tags={tags}
        />
      </div>
    </div>
  )
}

export default AllTools
