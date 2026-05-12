'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useId } from 'react'
import Checkbox from '@/app/components/base/checkbox'
import { Infotip } from '@/app/components/base/infotip'

type Props = {
  className?: string
  isChecked: boolean
  onChange: (isChecked: boolean) => void
  label: string
  labelClassName?: string
  tooltip?: string
  testId?: string
}

const CheckboxWithLabel: FC<Props> = ({
  className = '',
  isChecked,
  onChange,
  label,
  labelClassName,
  tooltip,
  testId,
}) => {
  const labelId = useId()
  const handleToggle = () => onChange(!isChecked)

  return (
    <div className={cn(className, 'flex h-7 items-center')}>
      <Checkbox checked={isChecked} onCheck={handleToggle} id={testId} ariaLabelledBy={labelId} />
      <div className="ml-2 flex min-w-0 items-center gap-1">
        <button
          type="button"
          id={labelId}
          className={cn('min-w-0 cursor-pointer border-0 bg-transparent p-0 text-left text-sm font-normal text-text-secondary', labelClassName)}
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
