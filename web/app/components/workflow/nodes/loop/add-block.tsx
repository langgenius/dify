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
import type { LoopNodeType } from './types'
import cn from '@/utils/classnames'
import BlockSelector from '@/app/components/workflow/block-selector'

import type {
  OnSelectBlock,
} from '@/app/components/workflow/types'
import {
  BlockEnum,
} from '@/app/components/workflow/types'

type AddBlockProps = {
  loopNodeId: string
  loopNodeData: LoopNodeType
}
const AddBlock = ({
  loopNodeData,
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
        prevNodeId: loopNodeData.start_node_id,
        prevNodeSourceHandle: 'source',
      },
    )
  }, [handleNodeAdd, loopNodeData.start_node_id])

  const renderTriggerElement = useCallback((open: boolean) => {
    return (
      <div className={cn(
        'system-sm-medium relative inline-flex h-8 cursor-pointer items-center rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-3 text-components-button-secondary-text shadow-xs backdrop-blur-[5px] hover:bg-components-button-secondary-bg-hover',
        `${nodesReadOnly && '!cursor-not-allowed bg-components-button-secondary-bg-disabled'}`,
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
        <div className='absolute right-0 top-1/2 h-2 w-0.5 -translate-y-1/2 bg-primary-500'></div>
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
