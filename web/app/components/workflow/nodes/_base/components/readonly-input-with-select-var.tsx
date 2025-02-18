'use client'
import type { FC } from 'react'
import React from 'react'
import cn from 'classnames'
import { useWorkflow } from '../../../hooks'
import { BlockEnum } from '../../../types'
import { VarBlockIcon } from '../../../block-icon'
import { getNodeInfoById, isConversationVar, isENV, isSystemVar } from './variable/utils'
import { Line3 } from '@/app/components/base/icons/src/public/common'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import { BubbleX, Env } from '@/app/components/base/icons/src/vender/line/others'
type Props = {
  nodeId: string
  value: string
  className?: string
}

const VAR_PLACEHOLDER = '@#!@#!'

const ReadonlyInputWithSelectVar: FC<Props> = ({
  nodeId,
  value,
  className,
}) => {
  const { getBeforeNodesInSameBranchIncludeParent } = useWorkflow()
  const availableNodes = getBeforeNodesInSameBranchIncludeParent(nodeId)
  const startNode = availableNodes.find((node: any) => {
    return node.data.type === BlockEnum.Start
  })

  const res = (() => {
    const vars: string[] = []
    const strWithVarPlaceholder = value.replaceAll(/{{#([^#]*)#}}/g, (_match, p1) => {
      vars.push(p1)
      return VAR_PLACEHOLDER
    })

    const html: React.JSX.Element[] = strWithVarPlaceholder.split(VAR_PLACEHOLDER).map((str, index) => {
      if (!vars[index])
        return <span className='relative top-[-3px] leading-[16px]' key={index}>{str}</span>

      const value = vars[index].split('.')
      const isSystem = isSystemVar(value)
      const isEnv = isENV(value)
      const isChatVar = isConversationVar(value)
      const node = (isSystem ? startNode : getNodeInfoById(availableNodes, value[0]))?.data
      const varName = `${isSystem ? 'sys.' : ''}${value[value.length - 1]}`

      return (<span key={index}>
        <span className='relative top-[-3px] leading-[16px]'>{str}</span>
        <div className=' inline-flex h-[16px] items-center rounded-[5px] bg-white px-1.5'>
          {!isEnv && !isChatVar && (
            <div className='flex items-center'>
              <div className='p-[1px]'>
                <VarBlockIcon
                  className='!text-gray-900'
                  type={node?.type || BlockEnum.Start}
                />
              </div>
              <div className='mx-0.5 max-w-[60px] truncate text-xs font-medium text-gray-700' title={node?.title}>{node?.title}</div>
              <Line3 className='mr-0.5'></Line3>
            </div>
          )}
          <div className='text-primary-600 flex items-center'>
            {!isEnv && !isChatVar && <Variable02 className='h-3.5 w-3.5 shrink-0' />}
            {isEnv && <Env className='text-util-colors-violet-violet-600 h-3.5 w-3.5 shrink-0' />}
            {isChatVar && <BubbleX className='text-util-colors-teal-teal-700 h-3.5 w-3.5' />}
            <div className={cn('ml-0.5 max-w-[50px] truncate text-xs font-medium', (isEnv || isChatVar) && 'text-gray-900')} title={varName}>{varName}</div>
          </div>
        </div>
      </span>)
    })
    return html
  })()

  return (
    <div className={cn('break-all text-xs', className)}>
      {res}
    </div>
  )
}
export default React.memo(ReadonlyInputWithSelectVar)
