import type { IterationNodeType } from './types'
import type { OnSelectBlock } from '@/app/components/workflow/types'
import { Button } from '@langgenius/dify-ui/button'
import { RiAddLine } from '@remixicon/react'
import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import BlockSelector from '@/app/components/workflow/block-selector'
import { BlockEnum } from '@/app/components/workflow/types'
import { useAvailableBlocks } from '../../hooks/use-available-blocks'
import { useNodesInteractions } from '../../hooks/use-nodes-interactions'
import { useNodesReadOnly } from '../../hooks/use-workflow'

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

  const triggerElement = (
    <Button
      variant="secondary"
      size="medium"
      className="relative data-popup-open:bg-components-button-secondary-bg-hover"
    >
      <RiAddLine aria-hidden className="size-4" />
      {t(($) => $['common.addBlock'], { ns: 'workflow' })}
    </Button>
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
        trigger={triggerElement}
        popupClassName="min-w-[256px]!"
        availableBlocksTypes={availableNextBlocks}
      />
    </div>
  )
}

export default memo(AddBlock)
