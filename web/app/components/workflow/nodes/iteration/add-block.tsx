import {
  memo,
  useCallback,
} from 'react'
import {
  RiAddLine,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import {
  useAvailableBlocks,
  useNodesInteractions,
  useNodesReadOnly,
} from '../../hooks'
import type { IterationNodeType } from './types'
import cn from '@/utils/classnames'
import BlockSelector from '@/app/components/workflow/block-selector'
import type {
  OnSelectBlock,
} from '@/app/components/workflow/types'
import {
  BlockEnum,
} from '@/app/components/workflow/types'

type AddBlockProps = {
  iterationNodeId: string
  iterationNodeData: IterationNodeType
}
const AddBlock = ({
  iterationNodeData,
}: AddBlockProps) => {
  const { t } = useTranslation()
  const { nodesReadOnly } = useNodesReadOnly()
  const { handleNodeAdd } = useNodesInteractions()
  const { availableNextBlocks } = useAvailableBlocks(BlockEnum.Start, true)

  const handleSelect = useCallback<OnSelectBlock>((type, toolDefaultValue) => {
    handleNodeAdd(
      {
        nodeType: type,
        toolDefaultValue,
      },
      {
        prevNodeId: iterationNodeData.start_node_id,
        prevNodeSourceHandle: 'source',
      },
    )
  }, [handleNodeAdd, iterationNodeData.start_node_id])

  const renderTriggerElement = useCallback((open: boolean) => {
    return (
      <div className={cn(
        'relative inline-flex items-center px-3 h-8 rounded-lg border-[0.5px] border-gray-50 bg-white shadow-xs cursor-pointer hover:bg-gray-200 text-[13px] font-medium text-gray-700',
        `${nodesReadOnly && '!cursor-not-allowed opacity-50'}`,
        open && '!bg-gray-50',
      )}>
        <RiAddLine className='mr-1 w-4 h-4' />
        {t('workflow.common.addBlock')}
      </div>
    )
  }, [nodesReadOnly, t])

  return (
    <div className='absolute top-7 left-14 flex items-center h-8 z-10'>
      <div className='group/insert relative w-16 h-0.5 bg-gray-300'>
        <div className='absolute right-0 top-1/2 -translate-y-1/2 w-0.5 h-2 bg-primary-500'></div>
      </div>
      <BlockSelector
        disabled={nodesReadOnly}
        onSelect={handleSelect}
        trigger={renderTriggerElement}
        triggerInnerClassName='inline-flex'
        popupClassName='!min-w-[256px]'
        availableBlocksTypes={availableNextBlocks}
      />
    </div>
  )
}

export default memo(AddBlock)
