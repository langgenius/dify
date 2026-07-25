'use client'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { cn } from '@langgenius/dify-ui/cn'
import { Infotip } from '@/app/components/base/infotip'

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
  return (
    <div className={cn('flex items-center', className)}>
      <label className="flex min-w-0 cursor-pointer items-center">
        <Checkbox checked={isChecked} onCheckedChange={(checked) => onChange(checked)} />
        <span
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
          <Infotip aria-label={tooltip} popupClassName="w-[200px]">
            {tooltip}
          </Infotip>
        )}
      </div>
    </div>
  )
}
