import type { FC } from 'react'
import {
  memo,
  useMemo,
} from 'react'
import { getOutgoers } from 'reactflow'
import BlockIcon from '../../../block-icon'
import type { Node } from '../../../types'
import { useWorkflowContext } from '../../../context'
import BlockSelector from '../../../block-selector'
import { Plus } from '@/app/components/base/icons/src/vender/line/general'
import Button from '@/app/components/base/button'

type NextStepProps = {
  selectedNode: Node
}
const NextStep: FC<NextStepProps> = ({
  selectedNode,
}) => {
  const {
    nodes,
    edges,
  } = useWorkflowContext()
  const outgoers = useMemo(() => {
    return getOutgoers(selectedNode, nodes, edges)
  }, [selectedNode, nodes, edges])

  return (
    <div className='flex py-1'>
      <div className='shrink-0 relative flex items-center justify-center w-9 h-9 bg-white rounded-lg border-[0.5px] border-gray-200 shadow-xs'>
        <BlockIcon type={selectedNode.data.type} />
      </div>
      <div className='shrink-0 w-6'></div>
      <div className='grow'>
        {
          !outgoers.length && (
            <BlockSelector>
              <div className='flex items-center px-2 w-[328px] h-9 rounded-lg border border-dashed border-gray-200 bg-gray-50 hover:bg-gray-100 text-xs text-gray-500 cursor-pointer'>
                <div className='flex items-center justify-center mr-1.5 w-5 h-5 rounded-[5px] bg-gray-200'>
                  <Plus className='w-3 h-3' />
                </div>
                SELECT NEXT BLOCK
              </div>
            </BlockSelector>
          )
        }
        {
          !!outgoers.length && outgoers.map(outgoer => (
            <div
              key={outgoer.id}
              className='group flex items-center mb-3 last-of-type:mb-0 px-2 h-9 rounded-lg border-[0.5px] border-gray-200 bg-white hover:bg-gray-50 shadow-xs text-xs text-gray-700 cursor-pointer'
            >
              <BlockIcon
                type={outgoer.data.type}
                className='shrink-0 mr-1.5'
              />
              <div className='grow'>{outgoer.data.name}</div>
              <BlockSelector>
                <Button className='hidden group-hover:flex px-2 py-0 h-6 bg-white text-xs text-gray-700 font-medium rounded-md'>
                  Change
                </Button>
              </BlockSelector>
            </div>
          ))
        }
      </div>
    </div>
  )
}

export default memo(NextStep)
