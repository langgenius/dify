import {
  memo,
  useCallback,
} from 'react'
import BlockSelector from '../../../../block-selector'
import { useWorkflow } from '../../../../hooks'
import type { BlockEnum } from '../../../../types'

type ChangeBlockProps = {
  nodeId: string
}
const ChangeBlock = ({
  nodeId,
}: ChangeBlockProps) => {
  const { handleChangeCurrentNode } = useWorkflow()

  const handleSelect = useCallback((type: BlockEnum) => {
    handleChangeCurrentNode(nodeId, type)
  }, [handleChangeCurrentNode, nodeId])

  const renderTrigger = useCallback(() => {
    return (
      <div className='flex items-center px-3 w-[232px] h-8 text-sm text-gray-700 rounded-lg cursor-pointer hover:bg-gray-50'>
        Change Block
      </div>
    )
  }, [])

  return (
    <BlockSelector
      placement='bottom-end'
      offset={{
        mainAxis: -36,
        crossAxis: 4,
      }}
      onSelect={handleSelect}
      trigger={renderTrigger}
    />
  )
}

export default memo(ChangeBlock)
