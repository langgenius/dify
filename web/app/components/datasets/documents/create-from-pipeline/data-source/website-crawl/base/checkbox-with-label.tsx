'use client'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { cn } from '@langgenius/dify-ui/cn'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { useId } from 'react'

type CheckboxWithLabelProps = {
  className?: string
  isChecked: boolean
  onChange: (isChecked: boolean) => void
  label: string
  labelClassName?: string
  tooltip?: string
}

export default function CheckboxWithLabel({
  className = '',
  isChecked,
  onChange,
  label,
  labelClassName,
  tooltip,
}: CheckboxWithLabelProps) {
  const labelId = useId()

  return (
    <div className={cn('flex items-center', className)}>
      <label className="flex min-w-0 cursor-pointer items-center">
        <Checkbox checked={isChecked} onCheckedChange={(checked) => onChange(checked)} />
        <span
          id={labelId}
          className={cn(
            'ml-2 min-w-0 text-left system-sm-medium text-text-secondary',
            labelClassName,
          )}
        >
          {label}
        </span>
      </label>
      <div className="ml-1 flex min-w-0 items-center">
        {tooltip && (
          <Infotip>
            <InfotipTrigger aria-labelledby={labelId} />
            <InfotipContent aria-labelledby={labelId} className="w-50">
              {tooltip}
            </InfotipContent>
          </Infotip>
        )}
      </div>
    </div>
  )
}
