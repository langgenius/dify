import {
  memo,
  useCallback,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { OffsetOptions } from '@floating-ui/react'
import { useStoreApi } from 'reactflow'

import BlockSelector from '@/app/components/workflow/block-selector'
import type {
  OnSelectBlock,
} from '@/app/components/workflow/types'
import {
  BlockEnum,
} from '@/app/components/workflow/types'
import { useAvailableBlocks, useNodesMetaData, useNodesReadOnly, usePanelInteractions } from '../../hooks'
import type { IterationNodeType } from './types'
import { useWorkflowStore } from '../../store'
import { generateNewNode, getNodeCustomTypeByNodeDataType } from '../../utils'
import { ITERATION_CHILDREN_Z_INDEX } from '../../constants'

type AddBlockProps = {
  renderTrigger?: (open: boolean) => React.ReactNode
  offset?: OffsetOptions
  iterationNodeData: IterationNodeType
  onClosePopup: () => void
}
const AddBlock = ({
  offset,
  iterationNodeData,
  onClosePopup,
}: AddBlockProps) => {
  const { t } = useTranslation()
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const { nodesReadOnly } = useNodesReadOnly()
  const { handlePaneContextmenuCancel } = usePanelInteractions()
  const [open, setOpen] = useState(false)
  const { availableNextBlocks } = useAvailableBlocks(BlockEnum.Start, false)
  const { nodesMap: nodesMetaDataMap } = useNodesMetaData()

  const handleOpenChange = useCallback((open: boolean) => {
    setOpen(open)
    if (!open)
      handlePaneContextmenuCancel()
  }, [handlePaneContextmenuCancel])

  const handleSelect = useCallback<OnSelectBlock>((type, toolDefaultValue) => {
    const { getNodes } = store.getState()
    const nodes = getNodes()
    const nodesWithSameType = nodes.filter(node => node.data.type === type)
    const { defaultValue } = nodesMetaDataMap![type]

    // Find the parent iteration node
    const parentIterationNode = nodes.find(node => node.data.start_node_id === iterationNodeData.start_node_id)

    const { newNode } = generateNewNode({
      type: getNodeCustomTypeByNodeDataType(type),
      data: {
        ...(defaultValue as any),
        title: nodesWithSameType.length > 0 ? `${defaultValue.title} ${nodesWithSameType.length + 1}` : defaultValue.title,
        ...toolDefaultValue,
        _isCandidate: true,
        // Set iteration-specific properties
        isInIteration: true,
        iteration_id: parentIterationNode?.id,
      },
      position: {
        x: 0,
        y: 0,
      },
    })

    // Set parent and z-index for iteration child
    if (parentIterationNode) {
      newNode.parentId = parentIterationNode.id
      newNode.extent = 'parent' as any
      newNode.zIndex = ITERATION_CHILDREN_Z_INDEX
    }

    workflowStore.setState({
      candidateNode: newNode,
    })
    onClosePopup()
  }, [store, workflowStore, nodesMetaDataMap, iterationNodeData.start_node_id, onClosePopup])

  const renderTrigger = () => {
    return (
      <div
        className='flex h-8 cursor-pointer items-center justify-between rounded-lg px-3 text-sm text-text-secondary hover:bg-state-base-hover'
      >
        {t('workflow.common.addBlock')}
      </div>
    )
  }

  return (
    <BlockSelector
      open={open}
      onOpenChange={handleOpenChange}
      disabled={nodesReadOnly}
      onSelect={handleSelect}
      placement='right-start'
      offset={offset ?? {
        mainAxis: 4,
        crossAxis: -8,
      }}
      trigger={renderTrigger}
      popupClassName='!min-w-[256px]'
      availableBlocksTypes={availableNextBlocks}
    />
  )
}

export default memo(AddBlock)
