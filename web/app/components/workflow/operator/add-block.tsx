import {
  memo,
  useCallback,
  useState,
} from 'react'
import cn from 'classnames'
import { useStoreApi } from 'reactflow'
import { useTranslation } from 'react-i18next'
import {
  generateNewNode,
} from '../utils'
import { NODES_INITIAL_DATA } from '../constants'
import { useWorkflowStore } from '../store'
import TipPopup from './tip-popup'
import {
  useNodesExtraData,
  useNodesReadOnly,
} from '@/app/components/workflow/hooks'
import BlockSelector from '@/app/components/workflow/block-selector'
import { Plus } from '@/app/components/base/icons/src/vender/line/general'
import type {
  OnSelectBlock,
} from '@/app/components/workflow/types'
import {
  BlockEnum,
} from '@/app/components/workflow/types'

const AddBlock = () => {
  const { t } = useTranslation()
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const nodesExtraData = useNodesExtraData()
  const { nodesReadOnly } = useNodesReadOnly()
  const [open, setOpen] = useState(false)
  const availableNextNodes = nodesExtraData[BlockEnum.Start].availableNextNodes

  const handleSelect = useCallback<OnSelectBlock>((type, toolDefaultValue) => {
    const {
      getNodes,
    } = store.getState()
    const nodes = getNodes()
    const nodesWithSameType = nodes.filter(node => node.data.type === type)
    const newNode = generateNewNode({
      data: {
        ...NODES_INITIAL_DATA[type],
        title: nodesWithSameType.length > 0 ? `${t(`workflow.blocks.${type}`)} ${nodesWithSameType.length + 1}` : t(`workflow.blocks.${type}`),
        ...(toolDefaultValue || {}),
        _isCandidate: true,
      },
      position: {
        x: 0,
        y: 0,
      },
    })
    workflowStore.setState({
      candidateNode: newNode,
    })
  }, [store, workflowStore, t])

  const renderTrigger = useCallback((open: boolean) => {
    return (
      <TipPopup
        title={t('workflow.common.addBlock')}
      >
        <div className={cn(
          'flex items-center justify-center w-8 h-8 rounded-lg hover:bg-black/5 hover:text-gray-700 cursor-pointer',
          `${nodesReadOnly && '!cursor-not-allowed opacity-50'}`,
          open && '!bg-black/5',
        )}>
          <Plus className='w-4 h-4' />
        </div>
      </TipPopup>
    )
  }, [nodesReadOnly, t])

  return (
    <BlockSelector
      open={open}
      onOpenChange={setOpen}
      disabled={nodesReadOnly}
      onSelect={handleSelect}
      placement='top-start'
      offset={{
        mainAxis: 4,
        crossAxis: -8,
      }}
      trigger={renderTrigger}
      popupClassName='!min-w-[256px]'
      availableBlocksTypes={availableNextNodes}
    />
  )
}

export default memo(AddBlock)
