import {
  memo,
  useCallback,
} from 'react'
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
import type {
  OnSelectBlock,
} from '@/app/components/workflow/types'
import {
  BlockEnum,
} from '@/app/components/workflow/types'

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
      },
      position: {
        x: 0,
        y: 0,
      },
      parentNode: iterationNodeId,
      extent: 'parent',
    })
    setNodes([...nodes, newNode])
  }, [store, t, iterationNodeId])

  const renderTriggerElement = useCallback((open: boolean) => {
    return (
      <div className={cn(
        'inline-flex items-center px-3 h-8 rounded-lg border-[0.5px] border-gray-50 bg-white shadow-xs cursor-pointer hover:bg-gray-200 text-[13px] font-medium text-gray-700',
        `${nodesReadOnly && '!cursor-not-allowed opacity-50'}`,
        open && '!bg-gray-50',
      )}>
        <Plus className='mr-1 w-4 h-4' />
        {t('workflow.common.addBlock')}
      </div>
    )
  }, [nodesReadOnly, t])

  return (
    <BlockSelector
      disabled={nodesReadOnly}
      onSelect={handleSelect}
      trigger={renderTriggerElement}
      triggerInnerClassName='inline-flex'
      popupClassName='!min-w-[256px]'
      availableBlocksTypes={availableNextNodes}
    />
  )
}

export default memo(AddBlock)
