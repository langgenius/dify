'use client'
import type { FC } from 'react'
import React from 'react'
import { useWorkflow } from '../../../hooks'
import type { ValueSelector } from '../../../types'
import { BlockEnum, VarType } from '../../../types'
import { VarBlockIcon } from '../../../block-icon'
import { getNodeInfoById, isSystemVar } from './variable/utils'
import { Line3 } from '@/app/components/base/icons/src/public/common'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
type Props = {
  nodeId: string
  value: string
}

const VAR_PLACEHOLDER = '@#!@#!'

const ReadonlyInputWithSelectVar: FC<Props> = ({
  nodeId,
  value,
}) => {
  const { getBeforeNodesInSameBranch } = useWorkflow()
  const availableNodes = getBeforeNodesInSameBranch(nodeId)
  const startNode = availableNodes.find((node: any) => {
    return node.data.type === BlockEnum.Start
  })

  const res = (() => {
    const vars: string[] = []
    const strWithVarPlaceholder = value.replaceAll(/{{#([^#]*)#}}/g, (_match, p1) => {
      vars.push(p1)
      return VAR_PLACEHOLDER
    })

    const html: JSX.Element[] = strWithVarPlaceholder.split(VAR_PLACEHOLDER).map((str, index) => {
      if (!vars[index])
        return <span className='leading-[20px]' key={index}>{str}</span>

      const value = vars[index].split('.')
      const isSystem = isSystemVar(value)
      const node = (isSystem ? startNode : getNodeInfoById(availableNodes, value[0]))?.data
      const varName = `${isSystem ? 'sys.' : ''}${value[value.length - 1]}`
      const type = (() => {
        let type = VarType.string
        let curr: any = node?.vars
        if (!curr)
          return type

        if (isSystem) {
          return curr.find((v: any) => v.variable === (value as ValueSelector).join('.'))?.type
        }
        else {
          (value as ValueSelector).slice(1).forEach((key, i) => {
            const isLast = i === value.length - 2
            curr = curr.find((v: any) => v.variable === key)
            if (isLast) {
              type = curr?.type
            }
            else {
              if (curr.type === VarType.object)
                curr = curr.children
            }
          })
          return type
        }
      })()
      return (<span key={index}>
        <span className='leading-[20px]'>{str}</span>
        <div className=' inline-flex h-[26px] items-center px-1.5 rounded-[5px] bg-white'>
          <div className='flex items-center'>
            <div className='p-[1px]'>
              <VarBlockIcon
                className='!text-gray-900'
                type={node?.type || BlockEnum.Start}
              />
            </div>
            <div className='mx-0.5 text-xs font-medium text-gray-700 truncate' title={node?.title}>{node?.title}</div>
            <Line3 className='mr-0.5'></Line3>
          </div>
          <div className='flex items-center text-primary-600'>
            <Variable02 className='w-3.5 h-3.5' />
            <div className='ml-0.5 text-xs font-medium truncate' title={varName}>{varName}</div>
          </div>
          <div className='ml-0.5 text-xs font-normal text-gray-500 capitalize truncate' title={type} >{type}</div>
        </div>
      </span>)
    })
    return html
  })()

  return (
    <div className='break-all'>
      {res}
    </div>
  )
}
export default React.memo(ReadonlyInputWithSelectVar)
