import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useStoreApi } from 'reactflow'
import { BlockEnum, type OnSelectBlock } from '../types'
import BlockSelector from '../block-selector'
import { NODES_INITIAL_DATA } from '../constants'
import { useAvailableBlocks } from '../hooks'
import { useWorkflowStore } from '../store'
import { generateNewNode } from '../utils'

const OperatorSider = () => {
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
    console.log(newNode)
    workflowStore.setState({
      candidateNode: newNode,
    })
  }, [store, workflowStore, t])
  return <div className="shrink-0 flex flex-col w-[326px] border-r border-divider-burn transition-all h-full relative">

    {/* <div className="shrink-0 flex flex-col w-[1px]  border-r border-divider-burn transition-all h-full relative"> */}
    <BlockSelector
      open={true}
      onSelect={handleSelect}
      placement="left-end"
      popupClassName='!min-w-[326px] h-full'
      availableBlocksTypes={availableNextBlocks}
      absolute={false}
    />
    {/* </div> */}
  </div>
}
export default OperatorSider
