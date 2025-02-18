import type { FC } from 'react'
import { memo } from 'react'
import { useAllBuiltInTools, useAllCustomTools, useAllWorkflowTools } from '@/service/use-tools'
import type { BlockEnum } from '../types'
import { useTabs } from './hooks'
import type { ToolDefaultValue } from './types'
import { TabsEnum } from './types'
import Blocks from './blocks'
import AllTools from './all-tools'
import cn from '@/utils/classnames'

export type TabsProps = {
  activeTab: TabsEnum
  onActiveTabChange: (activeTab: TabsEnum) => void
  searchText: string
  tags: string[]
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
  availableBlocksTypes?: BlockEnum[]
  noBlocks?: boolean
}
const Tabs: FC<TabsProps> = ({
  activeTab,
  onActiveTabChange,
  tags,
  searchText,
  onSelect,
  availableBlocksTypes,
  noBlocks,
}) => {
  const tabs = useTabs()
  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()

  return (
    <div onClick={e => e.stopPropagation()}>
      {
        !noBlocks && (
          <div className='border-divider-subtle flex items-center border-b-[0.5px] px-3'>
            {
              tabs.map(tab => (
                <div
                  key={tab.key}
                  className={cn(
                    'system-sm-medium relative mr-4 cursor-pointer pb-2 pt-1',
                    activeTab === tab.key
                      ? 'text-text-primary after:bg-util-colors-blue-brand-blue-brand-600 after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-full'
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
      {
        activeTab === TabsEnum.Blocks && !noBlocks && (
          <Blocks
            searchText={searchText}
            onSelect={onSelect}
            availableBlocksTypes={availableBlocksTypes}
          />
        )
      }
      {
        activeTab === TabsEnum.Tools && (
          <AllTools
            className='w-[315px]'
            searchText={searchText}
            onSelect={onSelect}
            tags={tags}
            buildInTools={buildInTools || []}
            customTools={customTools || []}
            workflowTools={workflowTools || []}
          />
        )
      }
    </div>
  )
}

export default memo(Tabs)
