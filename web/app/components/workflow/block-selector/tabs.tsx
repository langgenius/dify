import type { FC } from 'react'
import {
  memo,
  useState,
} from 'react'
import type { BlockEnum } from '../types'
import { useTabs } from './hooks'
import type { ToolDefaultValue } from './types'
import { TabsEnum } from './types'
import Tools from './tools'
import Blocks from './blocks'

export type TabsProps = {
  searchText: string
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
  availableBlocksTypes?: BlockEnum[]
}
const Tabs: FC<TabsProps> = ({
  searchText,
  onSelect,
  availableBlocksTypes,
}) => {
  const tabs = useTabs()
  const [activeTab, setActiveTab] = useState(tabs[0].key)

  return (
    <div onClick={e => e.stopPropagation()}>
      <div className='flex items-center px-3 border-b-[0.5px] border-b-black/5'>
        {
          tabs.map(tab => (
            <div
              key={tab.key}
              className={`
              relative mr-4 h-[34px] leading-[34px] text-[13px] font-medium cursor-pointer
              ${activeTab === tab.key
              ? 'text-gray-700 after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-full after:bg-primary-600'
              : 'text-gray-500'}
              `}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.name}
            </div>
          ))
        }
      </div>
      {
        activeTab === TabsEnum.Blocks && (
          <Blocks
            searchText={searchText}
            onSelect={onSelect}
            availableBlocksTypes={availableBlocksTypes}
          />
        )
      }
      {
        activeTab === TabsEnum.BuiltInTool && (
          <Tools
            onSelect={onSelect}
            searchText={searchText}
          />
        )
      }
      {
        activeTab === TabsEnum.CustomTool && (
          <Tools
            isCustom
            searchText={searchText}
            onSelect={onSelect}
          />
        )
      }
    </div>
  )
}

export default memo(Tabs)
