import {
  memo,
  useCallback,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import BlockIcon from '../block-icon'
import type { BlockEnum } from '../types'
import { useNodesExtraData } from '../hooks'
import { START_BLOCKS } from './constants'
import type { ToolDefaultValue } from './types'
import TriggerPluginSelector from './trigger-plugin-selector'
import Tooltip from '@/app/components/base/tooltip'

type StartBlocksProps = {
  searchText: string
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
  availableBlocksTypes?: BlockEnum[]
}

const StartBlocks = ({
  searchText,
  onSelect,
  availableBlocksTypes = [],
}: StartBlocksProps) => {
  const { t } = useTranslation()
  const nodesExtraData = useNodesExtraData()

  const filteredBlocks = useMemo(() => {
    return START_BLOCKS.filter((block) => {
      return block.title.toLowerCase().includes(searchText.toLowerCase())
             && availableBlocksTypes.includes(block.type)
    })
  }, [searchText, availableBlocksTypes])

  const isEmpty = filteredBlocks.length === 0

  const renderBlock = useCallback((block: typeof START_BLOCKS[0]) => (
    <Tooltip
      key={block.type}
      position='right'
      popupClassName='w-[200px]'
      needsDelay={false}
      popupContent={(
        <div>
          <BlockIcon
            size='md'
            className='mb-2'
            type={block.type}
          />
          <div className='system-md-medium mb-1 text-text-primary'>{block.title}</div>
          <div className='system-xs-regular text-text-tertiary'>{nodesExtraData[block.type].about}</div>
        </div>
      )}
    >
      <div
        className='flex h-8 w-full cursor-pointer items-center rounded-lg px-3 hover:bg-state-base-hover'
        onClick={() => onSelect(block.type)}
      >
        <BlockIcon
          className='mr-2 shrink-0'
          type={block.type}
        />
        <div className='grow text-sm text-text-secondary'>{block.title}</div>
      </div>
    </Tooltip>
  ), [nodesExtraData, onSelect])

  return (
    <div className='min-w-[400px] max-w-[500px] p-1'>
      {isEmpty && (
        <div className='flex h-[22px] items-center px-3 text-xs font-medium text-text-tertiary'>
          {t('workflow.tabs.noResult')}
        </div>
      )}
      {!isEmpty && (
        <div className='mb-1'>
          {filteredBlocks.map(renderBlock)}
        </div>
      )}
      <TriggerPluginSelector
        onSelect={onSelect}
        searchText={searchText}
      />
    </div>
  )
}

export default memo(StartBlocks)
