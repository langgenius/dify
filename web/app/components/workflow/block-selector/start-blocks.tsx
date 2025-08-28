import {
  memo,
  useCallback,
  useEffect,
  useMemo,
} from 'react'
import { useNodes } from 'reactflow'
import { useTranslation } from 'react-i18next'
import BlockIcon from '../block-icon'
import type { BlockEnum, CommonNodeType } from '../types'
import { BlockEnum as BlockEnumValues } from '../types'
import { useNodesExtraData } from '../hooks'
import { START_BLOCKS } from './constants'
import type { ToolDefaultValue } from './types'
import Tooltip from '@/app/components/base/tooltip'

type StartBlocksProps = {
  searchText: string
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
  availableBlocksTypes?: BlockEnum[]
  onContentStateChange?: (hasContent: boolean) => void
}

const StartBlocks = ({
  searchText,
  onSelect,
  availableBlocksTypes = [],
  onContentStateChange,
}: StartBlocksProps) => {
  const { t } = useTranslation()
  const nodes = useNodes()
  const nodesExtraData = useNodesExtraData()

  const filteredBlocks = useMemo(() => {
    // Check if Start node already exists in workflow
    const hasStartNode = nodes.some(node => (node.data as CommonNodeType)?.type === BlockEnumValues.Start)

    return START_BLOCKS.filter((block) => {
      // Hide User Input (Start) if it already exists in workflow
      if (block.type === BlockEnumValues.Start && hasStartNode)
        return false

      // Filter by search text
      if (!block.title.toLowerCase().includes(searchText.toLowerCase()))
        return false

      // availableBlocksTypes now contains properly filtered entry node types from parent
      return availableBlocksTypes.includes(block.type)
    })
  }, [searchText, availableBlocksTypes, nodes])

  const isEmpty = filteredBlocks.length === 0

  useEffect(() => {
    onContentStateChange?.(!isEmpty)
  }, [isEmpty, onContentStateChange])

  const renderBlock = useCallback((block: typeof START_BLOCKS[0]) => (
    <Tooltip
      key={block.type}
      position='right'
      popupClassName='w-[200px] rounded-xl'
      needsDelay={false}
      popupContent={(
        <div>
          <BlockIcon
            size='md'
            className='mb-2'
            type={block.type}
          />
          <div className='system-md-medium mb-1 text-text-primary'>{block.title}</div>
          <div className='system-xs-regular text-text-secondary'>{nodesExtraData[block.type].about}</div>
          {(block.type === BlockEnumValues.TriggerWebhook || block.type === BlockEnumValues.TriggerSchedule) && (
            <div className='system-xs-regular mb-1 mt-1 text-text-tertiary'>
              {t('tools.author')} {t('workflow.difyTeam')}
            </div>
          )}
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
        <div className='flex w-0 grow items-center justify-between text-sm text-text-secondary'>
          <span className='truncate'>{block.title}</span>
          {block.type === BlockEnumValues.Start && (
            <span className='system-xs-regular ml-2 shrink-0 text-text-quaternary'>{t('workflow.blocks.originalStartNode')}</span>
          )}
        </div>
      </div>
    </Tooltip>
  ), [nodesExtraData, onSelect, t])

  if (isEmpty)
    return null

  return (
    <div className='p-1'>
      <div className='mb-1'>
        {filteredBlocks.map((block, index) => (
          <div key={block.type}>
            {renderBlock(block)}
            {block.type === BlockEnumValues.Start && index < filteredBlocks.length - 1 && (
              <div className='my-1 px-3'>
                <div className='border-t border-divider-subtle' />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default memo(StartBlocks)
