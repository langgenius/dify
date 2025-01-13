'use client'
import type { FC } from 'react'
import React from 'react'
import cn from '@/utils/classnames'
import Checkbox from '@/app/components/base/checkbox'
import Tooltip from '@/app/components/base/tooltip'

type Props = {
  className?: string
  isChecked: boolean
  onChange: (isChecked: boolean) => void
  label: string
  labelClassName?: string
  tooltip?: string
}

const CheckboxWithLabel: FC<Props> = ({
  className = '',
  isChecked,
  onChange,
  label,
  labelClassName,
  tooltip,
}) => {
  return (
    <label className={cn(className, 'flex items-center h-7 space-x-2')}>
      <Checkbox checked={isChecked} onCheck={() => onChange(!isChecked)} />
      <div className={cn(labelClassName, 'text-sm font-normal text-gray-800')}>{label}</div>
      {tooltip && (
        <Tooltip
          popupContent={
            <div className='w-[200px]'>{tooltip}</div>
          }
          triggerClassName='ml-0.5 w-4 h-4'
        />
      )}
    </label>
  )
}
export default React.memo(CheckboxWithLabel)
