import {
  memo,
  useCallback,
} from 'react'
import produce from 'immer'
import cn from 'classnames'
import { useStoreApi } from 'reactflow'
import { useTranslation } from 'react-i18next'
import {
  generateNewNode,
} from '../../utils'
import {
  useNodesExtraData,
  useNodesReadOnly,
} from '../../hooks'
import { NODES_INITIAL_DATA } from '../../constants'
import BlockSelector from '@/app/components/workflow/block-selector'
import { Plus } from '@/app/components/base/icons/src/vender/line/general'
import { IterationStart } from '@/app/components/base/icons/src/vender/workflow'
import type {
  OnSelectBlock,
} from '@/app/components/workflow/types'
import {
  BlockEnum,
} from '@/app/components/workflow/types'
import TooltipPlus from '@/app/components/base/tooltip-plus'

type AddBlockProps = {
  iterationNodeId: string
}
const AddBlock = ({
  iterationNodeId,
}: AddBlockProps) => {
  const { t } = useTranslation()
  const store = useStoreApi()
  const nodesExtraData = useNodesExtraData()
  const { nodesReadOnly } = useNodesReadOnly()
  const availableNextNodes = nodesExtraData[BlockEnum.Start].availableNextNodes

  const handleSelect = useCallback<OnSelectBlock>((type, toolDefaultValue) => {
    const {
      getNodes,
      setNodes,
    } = store.getState()
    const nodes = getNodes()
    const nodesWithSameType = nodes.filter(node => node.data.type === type)
    const newNode = generateNewNode({
      data: {
        ...NODES_INITIAL_DATA[type],
        title: nodesWithSameType.length > 0 ? `${t(`workflow.blocks.${type}`)} ${nodesWithSameType.length + 1}` : t(`workflow.blocks.${type}`),
        ...(toolDefaultValue || {}),
        isIterationStart: true,
        isInIteration: true,
      },
      position: {
        x: 85,
        y: 87,
      },
      zIndex: 1001,
      parentId: iterationNodeId,
      extent: 'parent',
    })
    const newNodes = produce(nodes, (draft) => {
      draft.forEach((node) => {
        if (node.id === iterationNodeId) {
          node.data._children = [newNode.id]
          node.data.start_node_id = newNode.id
        }
      })
      draft.push(newNode)
    })
    setNodes(newNodes)
  }, [store, t, iterationNodeId])

  const renderTriggerElement = useCallback((open: boolean) => {
    return (
      <div className={cn(
        'relative inline-flex items-center px-3 h-8 rounded-lg border-[0.5px] border-gray-50 bg-white shadow-xs cursor-pointer hover:bg-gray-200 text-[13px] font-medium text-gray-700',
        `${nodesReadOnly && '!cursor-not-allowed opacity-50'}`,
        open && '!bg-gray-50',
      )}>
        <div className='absolute -left-[2px] top-1/2 -translate-y-1/2 w-0.5 h-2 bg-primary-500'></div>
        <Plus className='mr-1 w-4 h-4' />
        {t('workflow.common.addBlock')}
      </div>
    )
  }, [nodesReadOnly, t])

  return (
    <div className='relative flex items-center pt-[52px] pl-6 z-10'>
      <TooltipPlus popupContent={t('workflow.blocks.iteration-start')}>
        <div className='flex items-center justify-center w-6 h-6 rounded-full border-[0.5px] border-black/[0.02] shadow-md bg-primary-500'>
          <IterationStart className='w-4 h-4 text-white' />
        </div>
      </TooltipPlus>
      <div className='w-8 h-0.5 bg-gray-300'></div>
      <BlockSelector
        disabled={nodesReadOnly}
        onSelect={handleSelect}
        trigger={renderTriggerElement}
        triggerInnerClassName='inline-flex'
        popupClassName='!min-w-[256px]'
        availableBlocksTypes={availableNextNodes}
      />
    </div>
  )
}

export default memo(AddBlock)
