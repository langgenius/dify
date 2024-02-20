'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import cn from 'classnames'
import { mockNodeOutputVars, mockNodesData } from '../../../mock'
import VarReferencePopup from './var-reference-popup'
import type { ValueSelector } from '@/app/components/workflow/types'
import { VarBlockIcon } from '@/app/components/workflow/block-icon'
import { Line3 } from '@/app/components/base/icons/src/public/common'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'

type Props = {
  className?: string
  isShowNodeName: boolean
  readonly: boolean
  value: ValueSelector
  onChange: (value: ValueSelector) => void
}

// const toShowVarType = (type: string) => {
//   if (['text-input', 'paragraph', 'select', 'url'].includes(type))
//     return 'String'

//   return type.charAt(0).toUpperCase() + type.substring(1)
// }

// TODO: get data from context
const getNodeInfoById = (id: string) => {
  return mockNodesData[id]
}

const VarReferencePicker: FC<Props> = ({
  readonly,
  className,
  isShowNodeName,
  value,
}) => {
  const [open, setOpen] = useState(false)
  const hasValue = value.length > 0
  const node = hasValue ? getNodeInfoById(value[0]) : null
  const varName = hasValue ? value[value.length - 1] : ''
  // TODO: get var type through node and  value
  const getVarType = () => {
    return 'string'
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
                          type={node?.type}
                        />
                      </div>
                      <div className='mx-0.5 text-xs font-medium text-gray-700'>{node?.title}</div>
                      <Line3 className='mr-0.5'></Line3>
                    </div>
                  )}
                  <div className='flex items-center text-primary-600'>
                    <Variable02 className='w-3.5 h-3.5' />
                    <div className='ml-0.5 text-xs font-medium'>{varName}</div>
                  </div>
                  <div className='ml-0.5 text-xs font-normal text-gray-500'>{getVarType()}</div>
                </>
              )}
            </div>
          </div>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent style={{
          zIndex: 100,
          minWidth: 227,
        }}>
          <VarReferencePopup vars={mockNodeOutputVars} />
        </PortalToFollowElemContent>
      </PortalToFollowElem>
    </div>
  )
}
export default React.memo(VarReferencePicker)
