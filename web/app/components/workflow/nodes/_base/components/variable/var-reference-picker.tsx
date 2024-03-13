'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import cn from 'classnames'
import VarReferencePopup from './var-reference-popup'
import { toNodeOutputVars } from './utils'
import type { ValueSelector } from '@/app/components/workflow/types'
import { VarType } from '@/app/components/workflow/types'
import { VarBlockIcon } from '@/app/components/workflow/block-icon'
import { Line3 } from '@/app/components/base/icons/src/public/common'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { useWorkflow } from '@/app/components/workflow/hooks'

type Props = {
  className?: string
  nodeId: string
  isShowNodeName: boolean
  readonly: boolean
  value: ValueSelector
  onChange: (value: ValueSelector) => void
}

export const getNodeInfoById = (nodes: any, id: string) => {
  return nodes.find((node: any) => node.id === id)
}

const VarReferencePicker: FC<Props> = ({
  nodeId,
  readonly,
  className,
  isShowNodeName,
  value,
  onChange,
}) => {
  const { getTreeLeafNodes, getBeforeNodesInSameBranch } = useWorkflow()
  const availableNodes = getBeforeNodesInSameBranch(nodeId)
  const outputVars = toNodeOutputVars(availableNodes)
  const [open, setOpen] = useState(false)
  const hasValue = value.length > 0
  const outputVarNodeId = hasValue ? value[0] : ''
  const outputVarNode = hasValue ? getNodeInfoById(availableNodes, outputVarNodeId)?.data : null
  const varName = hasValue ? value[value.length - 1] : ''

  const getVarType = () => {
    const targetVar = outputVars.find(v => v.nodeId === outputVarNodeId)
    if (!targetVar)
      return 'undefined'

    let type: VarType = VarType.string
    let curr: any = targetVar.vars
    value.slice(1).forEach((key, i) => {
      const isLast = i === value.length - 2
      curr = curr.find((v: any) => v.variable === key)
      if (isLast) {
        type = curr.type
      }
      else {
        if (curr.type === VarType.object)
          curr = curr.children
      }
    })
    return type
  }

  return (
    <div className={cn(className, !readonly && 'cursor-pointer')}>
      <PortalToFollowElem
        open={open}
        onOpenChange={setOpen}
        placement='bottom-start'
      >
        <PortalToFollowElemTrigger onClick={() => setOpen(!open)} className='!flex'>
          <div className={cn('w-full h-8 p-1 rounded-lg bg-gray-100')}>
            <div className={cn('inline-flex h-full items-center px-1.5 rounded-[5px]', hasValue && 'bg-white')}>
              {hasValue && (
                <>
                  {isShowNodeName && (
                    <div className='flex items-center'>
                      <div className='p-[1px]'>
                        <VarBlockIcon
                          className='!text-gray-900'
                          type={outputVarNode?.type}
                        />
                      </div>
                      <div className='mx-0.5 text-xs font-medium text-gray-700'>{outputVarNode?.title}</div>
                      <Line3 className='mr-0.5'></Line3>
                    </div>
                  )}
                  <div className='flex items-center text-primary-600'>
                    <Variable02 className='w-3.5 h-3.5' />
                    <div className='ml-0.5 text-xs font-medium'>{varName}</div>
                  </div>
                  <div className='ml-0.5 text-xs font-normal text-gray-500 capitalize'>{getVarType()}</div>
                </>
              )}
            </div>
          </div>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent style={{
          zIndex: 100,
          minWidth: 227,
        }}>
          <VarReferencePopup
            vars={outputVars}
            onChange={(value) => {
              onChange(value)
              setOpen(false)
            }}
          />
        </PortalToFollowElemContent>
      </PortalToFollowElem>
    </div>
  )
}
export default React.memo(VarReferencePicker)
