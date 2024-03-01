import {
  memo,
  useCallback,
} from 'react'
import BlockSelector from '../../../../block-selector'
import { useWorkflow } from '../../../../hooks'
import type { BlockEnum } from '../../../../types'
import { Plus } from '@/app/components/base/icons/src/vender/line/general'

type AddProps = {
  nodeId: string
  sourceHandle: string
  branchName?: string
}
const Add = ({
  nodeId,
  sourceHandle,
  branchName,
}: AddProps) => {
  const { handleNodeAddNext } = useWorkflow()

  const handleSelect = useCallback((type: BlockEnum) => {
    handleNodeAddNext(nodeId, type, sourceHandle)
  }, [nodeId, sourceHandle, handleNodeAddNext])

  const renderTrigger = useCallback((open: boolean) => {
    return (
      <div
        className={`
          relative flex items-center px-2 w-[328px] h-9 rounded-lg border border-dashed border-gray-200 bg-gray-50 
          hover:bg-gray-100 text-xs text-gray-500 cursor-pointer
          ${open && '!bg-gray-100'}
        `}
      >
        {
          branchName && (
            <div className='absolute left-1 -top-[7.5px] flex items-center px-0.5 h-3 bg-white text-[10px] text-gray-500 font-semibold rounded-[5px]'>
              {branchName.toLocaleUpperCase()}
            </div>
          )
        }
        <div className='flex items-center justify-center mr-1.5 w-5 h-5 rounded-[5px] bg-gray-200'>
          <Plus className='w-3 h-3' />
        </div>
        SELECT NEXT BLOCK
      </div>
    )
  }, [branchName])

  return (
    <BlockSelector
      onSelect={handleSelect}
      placement='top'
      offset={0}
      trigger={renderTrigger}
      popupClassName='!w-[328px]'
    />
  )
}

export default memo(Add)
