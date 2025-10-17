'use client'
import React from 'react'
import cn from '@/utils/classnames'
import Checkbox from '@/app/components/base/checkbox'
import Tooltip from '@/app/components/base/tooltip'

type CheckboxWithLabelProps = {
  className?: string
  isChecked: boolean
  onChange: (isChecked: boolean) => void
  label: string
  labelClassName?: string
  tooltip?: string
}

const CheckboxWithLabel = ({
  className = '',
  isChecked,
  onChange,
  label,
  labelClassName,
  tooltip,
}: CheckboxWithLabelProps) => {
  return (
    <label className={cn('flex items-center space-x-2', className)}>
      <Checkbox checked={isChecked} onCheck={() => onChange(!isChecked)} />
      <div className={cn('system-sm-medium text-text-secondary', labelClassName)}>{label}</div>
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
