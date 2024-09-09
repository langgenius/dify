import {
  memo,
  useCallback,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import { groupBy } from 'lodash-es'
import BlockIcon from '../block-icon'
import { BlockEnum } from '../types'
import {
  useIsChatMode,
  useNodesExtraData,
} from '../hooks'
import { BLOCK_CLASSIFICATIONS } from './constants'
import { useBlocks } from './hooks'
import type { ToolDefaultValue } from './types'
import Tooltip from '@/app/components/base/tooltip'

type BlocksProps = {
  searchText: string
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
  availableBlocksTypes?: BlockEnum[]
}
const Blocks = ({
  searchText,
  onSelect,
  availableBlocksTypes = [],
}: BlocksProps) => {
  const { t } = useTranslation()
  const isChatMode = useIsChatMode()
  const nodesExtraData = useNodesExtraData()
  const blocks = useBlocks()

  const groups = useMemo(() => {
    return BLOCK_CLASSIFICATIONS.reduce((acc, classification) => {
      const list = groupBy(blocks, 'classification')[classification].filter((block) => {
        if (block.type === BlockEnum.Answer && !isChatMode)
          return false

        return block.title.toLowerCase().includes(searchText.toLowerCase()) && availableBlocksTypes.includes(block.type)
      })

      return {
        ...acc,
        [classification]: list,
      }
    }, {} as Record<string, typeof blocks>)
  }, [blocks, isChatMode, searchText, availableBlocksTypes])
  const isEmpty = Object.values(groups).every(list => !list.length)

  const renderGroup = useCallback((classification: string) => {
    const list = groups[classification]

    return (
      <div
        key={classification}
        className='mb-1 last-of-type:mb-0'
      >
        {
          classification !== '-' && !!list.length && (
            <div className='flex items-start px-3 h-[22px] text-xs font-medium text-gray-500'>
              {t(`workflow.tabs.${classification}`)}
            </div>
          )
        }
        {
          list.map(block => (
            <Tooltip
              key={block.type}
              position='right'
              popupClassName='!p-0 !px-3 !py-2.5 !w-[200px] !leading-[18px] !text-xs !text-gray-700 !border-[0.5px] !border-black/5 !rounded-xl !shadow-lg'
              popupContent={(
                <div>
                  <BlockIcon
                    size='md'
                    className='mb-2'
                    type={block.type}
                  />
                  <div className='mb-1 text-sm leading-5 text-gray-900'>{block.title}</div>
                  <div className='text-xs text-gray-700 leading-[18px]'>{nodesExtraData[block.type].about}</div>
                </div>
              )}
            >
              <div
                key={block.type}
                className='flex items-center px-3 w-full h-8 rounded-lg hover:bg-gray-50 cursor-pointer'
                onClick={() => onSelect(block.type)}
              >
                <BlockIcon
                  className='mr-2 shrink-0'
                  type={block.type}
                />
                <div className='text-sm text-gray-900'>{block.title}</div>
              </div>
            </Tooltip>
          ))
        }
      </div>
    )
  }, [groups, nodesExtraData, onSelect, t])

  return (
    <div className='p-1'>
      {
        isEmpty && (
          <div className='flex items-center px-3 h-[22px] text-xs font-medium text-gray-500'>{t('workflow.tabs.noResult')}</div>
        )
      }
      {
        !isEmpty && BLOCK_CLASSIFICATIONS.map(renderGroup)
      }
    </div>
  )
}

export default memo(Blocks)
