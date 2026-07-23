import type { IterationNodeType } from './types'
import type { OnSelectBlock } from '@/app/components/workflow/types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { RiAddLine } from '@remixicon/react'
import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import BlockSelector from '@/app/components/workflow/block-selector'
import { BlockEnum } from '@/app/components/workflow/types'
import { useAvailableBlocks, useNodesInteractions, useNodesReadOnly } from '../../hooks'

type AddBlockProps = {
  iterationNodeId: string
  iterationNodeData: IterationNodeType
}
const AddBlock = ({ iterationNodeData }: AddBlockProps) => {
  const { t } = useTranslation()
  const { nodesReadOnly } = useNodesReadOnly()
  const { handleNodeAdd } = useNodesInteractions()
  const { availableNextBlocks } = useAvailableBlocks(BlockEnum.Start, true)

  const handleSelect = useCallback<OnSelectBlock>(
    (type, pluginDefaultValue) => {
      handleNodeAdd(
        {
          nodeType: type,
          pluginDefaultValue,
        },
        {
          prevNodeId: iterationNodeData.start_node_id,
          prevNodeSourceHandle: 'source',
        },
      )
    },
    [handleNodeAdd, iterationNodeData.start_node_id],
  )

  const renderTriggerElement = useCallback(
    (open: boolean) => {
      return (
        <Button
          variant="secondary"
          size="medium"
          className={cn('relative', open && 'bg-components-button-secondary-bg-hover')}
        >
          <RiAddLine aria-hidden className="mr-1 size-4" />
          {t(($) => $['common.addBlock'], { ns: 'workflow' })}
        </Button>
      )
    },
    [nodesReadOnly, t],
  )

  return (
    <div className="absolute top-7 left-14 z-10 flex h-8 items-center">
      <div className="group/insert relative h-0.5 w-16 bg-gray-300">
        <div className="absolute top-1/2 right-0 h-2 w-0.5 -translate-y-1/2 bg-primary-500"></div>
      </div>
      <BlockSelector
        disabled={nodesReadOnly}
        onSelect={handleSelect}
        snippetInsertPayload={{
          prevNodeId: iterationNodeData.start_node_id,
          prevNodeSourceHandle: 'source',
        }}
        trigger={renderTriggerElement}
        popupClassName="min-w-[256px]!"
        availableBlocksTypes={availableNextBlocks}
      />
    </div>
  )
}

export default memo(AddBlock)
