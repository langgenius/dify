import {
  memo,
  useCallback,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import { groupBy } from 'lodash-es'
import BlockIcon from '../block-icon'
import { BlockEnum } from '../types'
import type { NodeDefault } from '../types'
import { BLOCK_CLASSIFICATIONS } from './constants'
import type { ToolDefaultValue } from './types'
import Tooltip from '@/app/components/base/tooltip'
import Badge from '@/app/components/base/badge'

type BlocksProps = {
  searchText: string
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
  availableBlocksTypes?: BlockEnum[]
  blocks: NodeDefault[]
}
const Blocks = ({
  searchText,
  onSelect,
  availableBlocksTypes = [],
  blocks,
}: BlocksProps) => {
  const { t } = useTranslation()

  const groups = useMemo(() => {
    return BLOCK_CLASSIFICATIONS.reduce((acc, classification) => {
      const list = groupBy(blocks, 'classification')[classification].filter((block) => {
        return block.title.toLowerCase().includes(searchText.toLowerCase()) && availableBlocksTypes.includes(block.type)
      })

      return {
        ...acc,
        [classification]: list,
      }
    }, {} as Record<string, typeof blocks>)
  }, [blocks, searchText, availableBlocksTypes])
  const isEmpty = Object.values(groups).every(list => !list.length)

  const renderGroup = useCallback((classification: string) => {
    const list = groups[classification].sort((a, b) => a.sort - b.sort)

    return (
      <div
        key={classification}
        className='mb-1 last-of-type:mb-0'
      >
        {
          classification !== '-' && !!list.length && (
            <div className='flex h-[22px] items-start px-3 text-xs font-medium text-text-tertiary'>
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
                  <div className='system-md-medium mb-1 text-text-primary'>{block.title}</div>
                  <div className='system-xs-regular text-text-tertiary'>{block.description}</div>
                </div>
              )}
            >
              <div
                key={block.type}
                className='flex h-8 w-full cursor-pointer items-center rounded-lg px-3 hover:bg-state-base-hover'
                onClick={() => onSelect(block.type)}
              >
                <BlockIcon
                  className='mr-2 shrink-0'
                  type={block.type}
                />
                <div className='grow text-sm text-text-secondary'>{block.title}</div>
                {
                  block.type === BlockEnum.LoopEnd && (
                    <Badge
                      text={t('workflow.nodes.loop.loopNode')}
                      className='ml-2 shrink-0'
                    />
                  )
                }
              </div>
            </Tooltip>
          ))
        }
      </div>
    )
  }, [groups, onSelect, t])

  return (
    <div className='max-h-[480px] overflow-y-auto p-1'>
      {
        isEmpty && (
          <div className='flex h-[22px] items-center px-3 text-xs font-medium text-text-tertiary'>{t('workflow.tabs.noResult')}</div>
        )
      }
      {
        !isEmpty && BLOCK_CLASSIFICATIONS.map(renderGroup)
      }
    </div>
  )
}

export default memo(Blocks)
