'use client'
import type { FC } from 'react'
import React from 'react'
import cn from 'classnames'
import { BlockEnum } from '@/app/components/workflow/types'
import type { ValueSelector } from '@/app/components/workflow/types'
import { VarBlockIcon } from '@/app/components/workflow/block-icon'
type Props = {
  className?: string
  isShowNodeName: boolean
  readonly: boolean
  value: ValueSelector
  onChange: (value: ValueSelector) => void
}

const getNodeInfoById = () => {

}

const VarReferencePicker: FC<Props> = ({
  className,
  isShowNodeName,
  value,
}) => {
  const valueNotSet = value.length === 0
  const nodeName = !valueNotSet ? value[0] : ''
  const varName = !valueNotSet ? value[value.length - 1] : ''
  // TODO: get var type through node and  value
  const getVarType = () => {
    return 'string'
  }
  return (
    <div className={cn(className)}>
      <div className='flex items-center'>
        {isShowNodeName && (
          <VarBlockIcon
            className='!text-gray-900'
            type={BlockEnum.Start}
          />
        )} /
        {!valueNotSet ? (`${varName} / ${getVarType()}`) : ''}
      </div>
    </div>
  )
}
export default React.memo(VarReferencePicker)
