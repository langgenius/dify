'use client'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useId } from 'react'
import Checkbox from '@/app/components/base/checkbox'
import { Infotip } from '@/app/components/base/infotip'

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
  const labelId = useId()
  const handleToggle = () => onChange(!isChecked)

  return (
    <div className={cn('flex items-center', className)}>
      <Checkbox checked={isChecked} onCheck={handleToggle} ariaLabelledBy={labelId} />
      <div className="ml-2 flex min-w-0 items-center gap-1">
        <button
          type="button"
          id={labelId}
          className={cn('min-w-0 cursor-pointer border-0 bg-transparent p-0 text-left system-sm-medium text-text-secondary', labelClassName)}
          onClick={handleToggle}
        >
          {label}
        </button>
        {tooltip && (
          <Infotip aria-label={tooltip} popupClassName="w-[200px]">
            {tooltip}
          </Infotip>
        )}
      </div>
    </div>
  )
}
export default React.memo(CheckboxWithLabel)
