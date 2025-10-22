import type { Dispatch, FC, SetStateAction } from 'react'
import { memo } from 'react'
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
  const inRAGPipeline = dataSources.length > 0
  const {
    plugins: featuredPlugins = [],
    isLoading: isFeaturedLoading,
    installedIds: featuredInstalledIds,
    installStatusLoading: featuredInstallLoading,
    refetchInstallStatus: refetchFeaturedInstallStatus,
  } = useFeaturedToolsRecommendations(enable_marketplace && !inRAGPipeline)

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
            featuredInstalledPluginIds={featuredInstalledIds}
            featuredInstallLoading={featuredInstallLoading}
            showFeatured={enable_marketplace && !inRAGPipeline}
            onFeaturedInstallSuccess={async () => {
              invalidateBuiltInTools()
              await refetchFeaturedInstallStatus()
            }}
          />
        )
      }
    </div>
  )
}

export default memo(Tabs)
