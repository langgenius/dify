import type { FC } from 'react'
import React from 'react'
import type { EndNodeType } from './types'
import type { NodeProps, Variable } from '@/app/components/workflow/types'
import { getVarType, isSystemVar } from '@/app/components/workflow/nodes/_base/components/variable/utils'
import {
  useIsChatMode,
  useWorkflow,
} from '@/app/components/workflow/hooks'
import { VarBlockIcon } from '@/app/components/workflow/block-icon'
import { Line3 } from '@/app/components/base/icons/src/public/common'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import { BlockEnum } from '@/app/components/workflow/types'

const Node: FC<NodeProps<EndNodeType>> = ({
  id,
  data,
}) => {
  const { getBeforeNodesInSameBranch } = useWorkflow()
  const availableNodes = getBeforeNodesInSameBranch(id)
  const isChatMode = useIsChatMode()

  const startNode = availableNodes.find((node: any) => {
    return node.data.type === BlockEnum.Start
  })

  const getNode = (id: string) => {
    return availableNodes.find(node => node.id === id) || startNode
  }

  const { outputs } = data
  const filteredOutputs = (outputs as Variable[]).filter(({ value_selector }) => value_selector.length > 0)

  if (!filteredOutputs.length)
    return null

  return (
    <div className='mb-1 px-3 py-1 space-y-0.5'>
      {filteredOutputs.map(({ value_selector }, index) => {
        const node = getNode(value_selector[0])
        const isSystem = isSystemVar(value_selector)
        const varName = isSystem ? `sys.${value_selector[value_selector.length - 1]}` : value_selector[value_selector.length - 1]
        const varType = getVarType({
          valueSelector: value_selector,
          availableNodes,
          isChatMode,
        })
        return (
          <div key={index} className='flex items-center h-6 justify-between bg-gray-100 rounded-md  px-1 space-x-1 text-xs font-normal text-gray-700'>
            <div className='flex items-center text-xs font-medium text-gray-500'>
              <div className='p-[1px]'>
                <VarBlockIcon
                  className='!text-gray-900'
                  type={node?.data.type || BlockEnum.Start}
                />
              </div>
              <div className='max-w-[75px] truncate'>{node?.data.title}</div>
              <Line3 className='mr-0.5'></Line3>
              <div className='flex items-center text-primary-600'>
                <Variable02 className='w-3.5 h-3.5' />
                <div className='max-w-[50px] ml-0.5 text-xs font-medium truncate'>{varName}</div>
              </div>
            </div>
            <div className='text-xs font-normal text-gray-700'>
              <div className='max-w-[42px] ml-0.5 text-xs font-normal text-gray-500 capitalize truncate' title={varType}>{varType}</div>
            </div>
          </div>
        )
      })}

    </div>
  )
}

export default React.memo(Node)
