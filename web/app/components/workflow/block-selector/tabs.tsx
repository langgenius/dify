import type { FC } from 'react'
import { memo } from 'react'
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
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
  availableBlocksTypes?: BlockEnum[]
  noBlocks?: boolean
}
const Tabs: FC<TabsProps> = ({
  activeTab,
  onActiveTabChange,
  searchText,
  onSelect,
  availableBlocksTypes,
  noBlocks,
}) => {
  const tabs = useTabs()

  return (
    <div onClick={e => e.stopPropagation()}>
      {
        !noBlocks && (
          <div className='flex items-center px-3 border-b-[0.5px] border-b-black/5'>
            {
              tabs.map(tab => (
                <div
                  key={tab.key}
                  className={cn(
                    'relative mr-4 h-[34px] text-[13px] leading-[34px] font-medium cursor-pointer',
                    activeTab === tab.key
                      ? 'text-gray-700 after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-full after:bg-primary-600'
                      : 'text-gray-500',
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
            searchText={searchText}
            onSelect={onSelect}
          />
        )
      }
    </div>
  )
}

export default memo(Tabs)
