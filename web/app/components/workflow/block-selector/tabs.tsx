import type { FC } from 'react'
import { memo } from 'react'
import { useAllBuiltInTools, useAllCustomTools, useAllMCPTools, useAllWorkflowTools } from '@/service/use-tools'
import type { BlockEnum } from '../types'
import { useTabs } from './hooks'
import type { ToolDefaultValue } from './types'
import { TabsEnum } from './types'
import Blocks from './blocks'
import AllStartBlocks from './all-start-blocks'
import AllTools from './all-tools'
import cn from '@/utils/classnames'

export type TabsProps = {
  activeTab: TabsEnum
  onActiveTabChange: (activeTab: TabsEnum) => void
  searchText: string
  tags: string[]
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
  availableBlocksTypes?: BlockEnum[]
  filterElem: React.ReactNode
  noBlocks?: boolean
  showStartTab?: boolean
  forceShowStartContent?: boolean // Force show Start content even when noBlocks=true
}
const Tabs: FC<TabsProps> = ({
  activeTab,
  onActiveTabChange,
  tags,
  searchText,
  onSelect,
  availableBlocksTypes,
  filterElem,
  noBlocks,
  showStartTab = false,
  forceShowStartContent = false,
}) => {
  const tabs = useTabs(showStartTab)
  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()
  const { data: mcpTools } = useAllMCPTools()

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
            />
          </div>
        )
      }
      {
        activeTab === TabsEnum.Tools && (
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
          />
        )
      }
    </div>
  )
}

export default memo(Tabs)
