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
        'border-components-button-secondary-border bg-components-button-secondary-bg shadow-xs hover:bg-components-button-secondary-bg-hover system-sm-medium text-components-button-secondary-text relative inline-flex h-8 cursor-pointer items-center rounded-lg border-[0.5px] px-3 backdrop-blur-[5px]',
        `${nodesReadOnly && 'bg-components-button-secondary-bg-disabled !cursor-not-allowed'}`,
        open && 'bg-components-button-secondary-bg-hover',
      )}>
        <RiAddLine className='mr-1 h-4 w-4' />
        {t('workflow.common.addBlock')}
      </div>
    )
  }, [nodesReadOnly, t])

  return (
    <div className='absolute left-14 top-7 z-10 flex h-8 items-center'>
      <div className='group/insert relative h-0.5 w-16 bg-gray-300'>
        <div className='bg-primary-500 absolute right-0 top-1/2 h-2 w-0.5 -translate-y-1/2'></div>
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
