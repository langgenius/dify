import { memo, useCallback } from 'react'
import BlockSelector from './block-selector'
import type { OnSelectBlock } from './types'
import { BlockEnum } from './types'
import { useTranslation } from 'react-i18next'
import { useStoreApi } from 'reactflow'
import { useWorkflowStore } from './store'
import { useAvailableBlocks } from './hooks'
import { generateNewNode } from './utils'
import { NODES_INITIAL_DATA } from './constants'

const ToolSider = () => {
  const { t } = useTranslation()
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const { availableNextBlocks } = useAvailableBlocks(BlockEnum.Start, false)
  const handleSelect = useCallback<OnSelectBlock>((type, toolDefaultValue) => {
    const {
      getNodes,
    } = store.getState()
    const nodes = getNodes()
    const nodesWithSameType = nodes.filter(node => node.data.type === type)
    const { newNode } = generateNewNode({
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
  return <div className='w-[328px] h-full'>
    <BlockSelector
      open={true}
      onSelect={handleSelect}
      placement='top'
      offset={0}
      absolute={false}
      popupClassName='!w-[328px]'
      availableBlocksTypes={availableNextBlocks}
    />
  </div>
}
export default memo(ToolSider)
