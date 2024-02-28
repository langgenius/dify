import {
  memo,
  useCallback,
} from 'react'
import type {
  BlockEnum,
  CommonNodeType,
} from '../../../../types'
import BlockIcon from '../../../../block-icon'
import BlockSelector from '../../../../block-selector'
import { useWorkflow } from '../../../../hooks'
import Button from '@/app/components/base/button'

type ItemProps = {
  parentNodeId: string
  nodeId: string
  sourceHandle: string
  branchName?: string
  data: CommonNodeType
}
const Item = ({
  parentNodeId,
  nodeId,
  sourceHandle,
  branchName,
  data,
}: ItemProps) => {
  const { handleChangeCurrentNode } = useWorkflow()
  const handleSelect = useCallback((type: BlockEnum) => {
    handleChangeCurrentNode(parentNodeId, nodeId, type, sourceHandle)
  }, [parentNodeId, nodeId, sourceHandle, handleChangeCurrentNode])
  const renderTrigger = useCallback((open: boolean) => {
    return (
      <Button
        className={`
          hidden group-hover:flex px-2 py-0 h-6 bg-white text-xs text-gray-700 font-medium rounded-md 
          ${open && '!bg-gray-100 !flex'}
        `}
      >
        Change
      </Button>
    )
  }, [])

  return (
    <div
      className='relative group flex items-center mb-3 last-of-type:mb-0 px-2 h-9 rounded-lg border-[0.5px] border-gray-200 bg-white hover:bg-gray-50 shadow-xs text-xs text-gray-700 cursor-pointer'
    >
      {
        branchName && (
          <div className='absolute left-1 -top-[7.5px] flex items-center px-0.5 h-3 bg-white text-[10px] text-gray-500 font-semibold rounded-[5px]'>
            {branchName.toLocaleUpperCase()}
          </div>
        )
      }
      <BlockIcon
        type={data.type}
        className='shrink-0 mr-1.5'
      />
      <div className='grow'>{data.title}</div>
      <BlockSelector
        onSelect={handleSelect}
        placement='top-end'
        offset={{
          mainAxis: 6,
          crossAxis: 8,
        }}
        trigger={renderTrigger}
        popupClassName='!w-[328px]'
      />
    </div>
  )
}

export default memo(Item)
