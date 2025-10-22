import type { Dispatch, FC, SetStateAction } from 'react'
import { memo, useEffect, useMemo } from 'react'
import { useAllBuiltInTools, useAllCustomTools, useAllMCPTools, useAllWorkflowTools, useInvalidateAllBuiltInTools } from '@/service/use-tools'
import type {
  BlockEnum,
  NodeDefault,
  OnSelectBlock,
  ToolWithProvider,
} from '../types'
import { TabsEnum } from './types'
import Blocks from './blocks'
import AllStartBlocks from './all-start-blocks'
import AllTools from './all-tools'
import DataSources from './data-sources'
import cn from '@/utils/classnames'
import { useFeaturedToolsRecommendations } from '@/service/use-plugins'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useWorkflowStore } from '../store'
import { basePath } from '@/utils/var'

export type TabsProps = {
  activeTab: TabsEnum
  onActiveTabChange: (activeTab: TabsEnum) => void
  searchText: string
  tags: string[]
  onTagsChange: Dispatch<SetStateAction<string[]>>
  onSelect: OnSelectBlock
  availableBlocksTypes?: BlockEnum[]
  blocks: NodeDefault[]
  dataSources?: ToolWithProvider[]
  tabs: Array<{
    key: TabsEnum
    name: string
  }>
  filterElem: React.ReactNode
  noBlocks?: boolean
  noTools?: boolean
  forceShowStartContent?: boolean // Force show Start content even when noBlocks=true
}
const Tabs: FC<TabsProps> = ({
  activeTab,
  onActiveTabChange,
  tags,
  onTagsChange,
  searchText,
  onSelect,
  availableBlocksTypes,
  blocks,
  dataSources = [],
  tabs = [],
  filterElem,
  noBlocks,
  noTools,
  forceShowStartContent = false,
}) => {
  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()
  const { data: mcpTools } = useAllMCPTools()
  const invalidateBuiltInTools = useInvalidateAllBuiltInTools()
  const { enable_marketplace } = useGlobalPublicStore(s => s.systemFeatures)
  const workflowStore = useWorkflowStore()
  const inRAGPipeline = dataSources.length > 0
  const {
    plugins: featuredPlugins = [],
    isLoading: isFeaturedLoading,
  } = useFeaturedToolsRecommendations(enable_marketplace && !inRAGPipeline)

  const normalizeToolList = useMemo(() => {
    return (list?: ToolWithProvider[]) => {
      if (!list)
        return list
      if (!basePath)
        return list
      let changed = false
      const normalized = list.map((provider) => {
        if (typeof provider.icon === 'string' && provider.icon && !provider.icon.includes(basePath)) {
          changed = true
          return {
            ...provider,
            icon: `${basePath}${provider.icon}`,
          }
        }
        return provider
      })
      return changed ? normalized : list
    }
  }, [basePath])

  useEffect(() => {
    workflowStore.setState((state) => {
      const updates: Partial<typeof state> = {}
      const normalizedBuiltIn = normalizeToolList(buildInTools)
      const normalizedCustom = normalizeToolList(customTools)
      const normalizedWorkflow = normalizeToolList(workflowTools)
      const normalizedMCP = normalizeToolList(mcpTools)

      if (normalizedBuiltIn !== undefined && state.buildInTools !== normalizedBuiltIn)
        updates.buildInTools = normalizedBuiltIn
      if (normalizedCustom !== undefined && state.customTools !== normalizedCustom)
        updates.customTools = normalizedCustom
      if (normalizedWorkflow !== undefined && state.workflowTools !== normalizedWorkflow)
        updates.workflowTools = normalizedWorkflow
      if (normalizedMCP !== undefined && state.mcpTools !== normalizedMCP)
        updates.mcpTools = normalizedMCP
      if (!Object.keys(updates).length)
        return state
      return {
        ...state,
        ...updates,
      }
    })
  }, [workflowStore, normalizeToolList, buildInTools, customTools, workflowTools, mcpTools])

  return (
    <div onClick={e => e.stopPropagation()}>
      {
        !noBlocks && (
          <div className='relative flex bg-background-section-burn pl-1 pt-1'>
            {
              tabs.map(tab => (
                <div
                  key={tab.key}
                  className={cn(
                    'system-sm-medium relative mr-0.5 flex h-8 cursor-pointer  items-center rounded-t-lg px-3 ',
                    activeTab === tab.key
                      ? 'sm-no-bottom cursor-default bg-components-panel-bg text-text-accent'
                      : 'text-text-tertiary',
                  )}
                  onClick={() => onActiveTabChange(tab.key)}
                >
                  {tab.name}
                </div>
              ))
            }
          </div>
        )
      }
      {filterElem}
      {
        activeTab === TabsEnum.Start && (!noBlocks || forceShowStartContent) && (
          <div className='border-t border-divider-subtle'>
            <AllStartBlocks
              searchText={searchText}
              onSelect={onSelect}
              availableBlocksTypes={availableBlocksTypes}
              tags={tags}
            />
          </div>
        )
      }
      {
        activeTab === TabsEnum.Blocks && !noBlocks && (
          <div className='border-t border-divider-subtle'>
            <Blocks
              searchText={searchText}
              onSelect={onSelect}
              availableBlocksTypes={availableBlocksTypes}
              blocks={blocks}
            />
          </div>
        )
      }
      {
        activeTab === TabsEnum.Sources && !!dataSources.length && (
          <div className='border-t border-divider-subtle'>
            <DataSources
              searchText={searchText}
              onSelect={onSelect}
              dataSources={dataSources}
            />
          </div>
        )
      }
      {
        activeTab === TabsEnum.Tools && !noTools && (
          <AllTools
            searchText={searchText}
            onSelect={onSelect}
            tags={tags}
            canNotSelectMultiple
            buildInTools={buildInTools || []}
            customTools={customTools || []}
            workflowTools={workflowTools || []}
            mcpTools={mcpTools || []}
            canChooseMCPTool
            onTagsChange={onTagsChange}
            isInRAGPipeline={inRAGPipeline}
            featuredPlugins={featuredPlugins}
            featuredLoading={isFeaturedLoading}
            showFeatured={enable_marketplace && !inRAGPipeline}
            onFeaturedInstallSuccess={async () => {
              invalidateBuiltInTools()
            }}
          />
        )
      }
    </div>
  )
}

export default memo(Tabs)
