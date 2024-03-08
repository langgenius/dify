import type { FC } from 'react'
import {
  memo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { groupBy } from 'lodash-es'
import BlockIcon from '../block-icon'
import { BlockEnum } from '../types'
import { useIsChatMode } from '../hooks'
import { BLOCK_CLASSIFICATIONS } from './constants'
import {
  useBlocks,
  useTabs,
} from './hooks'
import type { ToolDefaultValue } from './types'
import { TabsEnum } from './types'
import Tools from './tools'

export type TabsProps = {
  searchText: string
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
}
const Tabs: FC<TabsProps> = ({
  searchText,
  onSelect,
}) => {
  const { t } = useTranslation()
  const isChatMode = useIsChatMode()
  const blocks = useBlocks()
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
          <div className='p-1'>
            {
              BLOCK_CLASSIFICATIONS.map(classification => (
                <div
                  key={classification}
                  className='mb-1 last-of-type:mb-0'
                >
                  {
                    classification !== '-' && (
                      <div className='flex items-start px-3 h-[22px] text-xs font-medium text-gray-500'>
                        {t(`workflow.tabs.${classification}`)}
                      </div>
                    )
                  }
                  {
                    groupBy(blocks, 'classification')[classification].filter((block) => {
                      if (block.type === BlockEnum.DirectAnswer && !isChatMode)
                        return false

                      return true
                    }).map(block => (
                      <div
                        key={block.type}
                        className='flex items-center px-3 h-8 rounded-lg hover:bg-gray-50 cursor-pointer'
                        onClick={() => onSelect(block.type)}
                      >
                        <BlockIcon
                          className='mr-2'
                          type={block.type}
                        />
                        <div className='text-sm text-gray-900'>{block.title}</div>
                      </div>
                    ))
                  }
                </div>
              ))
            }
          </div>
        )
      }
      {
        activeTab === TabsEnum.BuiltInTool && (
          <Tools onSelect={onSelect} />
        )
      }
      {
        activeTab === TabsEnum.CustomTool && (
          <Tools
            isCustom
            onSelect={onSelect}
          />
        )
      }
    </div>
  )
}

export default memo(Tabs)
