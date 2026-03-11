'use client'
import type { FC } from 'react'
import { cn } from '@/utils/classnames'

type Props = {
  value: boolean
  onChange: (value: boolean) => void
}

const FormInputBoolean: FC<Props> = ({
  value,
  onChange,
}) => {
  return (
    <div className="flex w-full space-x-1">
      <div
        className={cn(
          'system-sm-regular flex h-8 grow cursor-default items-center justify-center rounded-md border border-components-option-card-option-border bg-components-option-card-option-bg px-2 text-text-secondary',
          !value && 'cursor-pointer hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover hover:shadow-xs',
          value && 'system-sm-medium border-[1.5px] border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg shadow-xs',
        )}
        onClick={() => onChange(true)}
      >
        True
      </div>
      <div
        className={cn(
          'system-sm-regular flex h-8 grow cursor-default items-center justify-center rounded-md border border-components-option-card-option-border bg-components-option-card-option-bg px-2 text-text-secondary',
          value && 'cursor-pointer hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover hover:shadow-xs',
          !value && 'system-sm-medium border-[1.5px] border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg shadow-xs',
        )}
        onClick={() => onChange(false)}
      >
        False
      </div>
    </div>
  )
}
export default FormInputBoolean
