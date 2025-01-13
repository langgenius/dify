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
            <div className='flex items-start px-3 h-[22px] text-xs font-medium text-text-tertiary'>
              {t(`workflow.tabs.${classification}`)}
            </div>
          )
        }
        {
          list.map(block => (
            <Tooltip
              key={block.type}
              position='right'
              popupClassName='w-[200px]'
              popupContent={(
                <div>
                  <BlockIcon
                    size='md'
                    className='mb-2'
                    type={block.type}
                  />
                  <div className='mb-1 system-md-medium text-text-primary'>{block.title}</div>
                  <div className='text-text-tertiary system-xs-regular'>{nodesExtraData[block.type].about}</div>
                </div>
              )}
            >
              <div
                key={block.type}
                className='flex items-center px-3 w-full h-8 rounded-lg hover:bg-state-base-hover cursor-pointer'
                onClick={() => onSelect(block.type)}
              >
                <BlockIcon
                  className='mr-2 shrink-0'
                  type={block.type}
                />
                <div className='text-sm text-text-secondary'>{block.title}</div>
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
          <div className='flex items-center px-3 h-[22px] text-xs font-medium text-text-tertiary'>{t('workflow.tabs.noResult')}</div>
        )
      }
      {
        !isEmpty && BLOCK_CLASSIFICATIONS.map(renderGroup)
      }
    </div>
  )
}

export default memo(Blocks)
