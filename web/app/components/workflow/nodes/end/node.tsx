import type { FC } from 'react'
import React from 'react'
import cn from 'classnames'
import type { EndNodeType } from './types'
import type { NodeProps, Variable } from '@/app/components/workflow/types'
import { isConversationVar, isENV, isSystemVar } from '@/app/components/workflow/nodes/_base/components/variable/utils'
import {
  useIsChatMode,
  useWorkflow,
  useWorkflowVariables,
} from '@/app/components/workflow/hooks'
import { VarBlockIcon } from '@/app/components/workflow/block-icon'
import { Line3 } from '@/app/components/base/icons/src/public/common'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import { BubbleX, Env } from '@/app/components/base/icons/src/vender/line/others'
import { BlockEnum } from '@/app/components/workflow/types'

const Node: FC<NodeProps<EndNodeType>> = ({
  id,
  data,
}) => {
  const { getBeforeNodesInSameBranch } = useWorkflow()
  const availableNodes = getBeforeNodesInSameBranch(id)
  const { getCurrentVariableType } = useWorkflowVariables()
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
    <div className='mb-1 space-y-0.5 px-3 py-1'>
      {filteredOutputs.map(({ value_selector }, index) => {
        const node = getNode(value_selector[0])
        const isSystem = isSystemVar(value_selector)
        const isEnv = isENV(value_selector)
        const isChatVar = isConversationVar(value_selector)
        const varName = isSystem ? `sys.${value_selector[value_selector.length - 1]}` : value_selector[value_selector.length - 1]
        const varType = getCurrentVariableType({
          valueSelector: value_selector,
          availableNodes,
          isChatMode,
        })
        return (
          <div key={index} className='flex h-6 items-center justify-between space-x-1 rounded-md  bg-workflow-block-parma-bg px-1 text-xs font-normal text-text-secondary'>
            <div className='flex items-center text-xs font-medium text-text-tertiary'>
              {!isEnv && !isChatVar && (
                <>
                  <div className='p-[1px]'>
                    <VarBlockIcon
                      className='!text-text-primary'
                      type={node?.data.type || BlockEnum.Start}
                    />
                  </div>
                  <div className='max-w-[75px] truncate'>{node?.data.title}</div>
                  <Line3 className='mr-0.5'></Line3>
                </>
              )}
              <div className='flex items-center text-text-accent'>
                {!isEnv && !isChatVar && <Variable02 className='h-3.5 w-3.5 shrink-0 text-text-accent' />}
                {isEnv && <Env className='h-3.5 w-3.5 shrink-0 text-util-colors-violet-violet-600' />}
                {isChatVar && <BubbleX className='h-3.5 w-3.5 text-util-colors-teal-teal-700' />}

                <div className={cn('ml-0.5 max-w-[50px] truncate text-xs font-medium', (isEnv || isChatVar) && '!max-w-[70px] text-text-primary')}>{varName}</div>
              </div>
            </div>
            <div className='text-xs font-normal text-text-secondary'>
              <div className='ml-0.5 max-w-[42px] truncate text-xs font-normal capitalize text-text-tertiary' title={varType}>{varType}</div>
            </div>
          </div>
        )
      })}

    </div>
  )
}

export default React.memo(Node)
