import {
  memo,
  useCallback,
} from 'react'
import BlockSelector from '@/app/components/workflow/block-selector'
import { useWorkflow } from '@/app/components/workflow/hooks'
import type { OnSelectBlock } from '@/app/components/workflow/types'

type ChangeBlockProps = {
  nodeId: string
  sourceHandle: string
}
const ChangeBlock = ({
  nodeId,
  sourceHandle,
}: ChangeBlockProps) => {
  const { handleNodeChange } = useWorkflow()

  const handleSelect = useCallback<OnSelectBlock>((type, toolDefaultValue) => {
    handleNodeChange(nodeId, type, sourceHandle, toolDefaultValue)
  }, [handleNodeChange, nodeId, sourceHandle])

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
