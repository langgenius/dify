import { memo } from 'react'
import Tooltip from '@/app/components/base/tooltip'
import {
  NumberField,
  NumberFieldControls,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from '@/app/components/base/ui/number-field'

import { cn } from '@/utils/classnames'

type MaxIterationsProps = {
  value?: number
  onChange?: (value: number) => void
  className?: string
  disabled?: boolean
}
const MaxIterations = ({ value = 10, onChange, className, disabled }: MaxIterationsProps) => {
  return (
    <div className={cn('mt-3 flex h-10 items-center justify-between', className)}>
      <div className="flex items-center">
        <div className="mr-0.5 truncate uppercase text-text-secondary system-sm-semibold">Max Iterations</div>
        <Tooltip
          popupContent="Max Iterations is the maximum number of iterations to run the tool."
          triggerClassName="shrink-0 w-4 h-4"
        />
      </div>
      <NumberField
        value={value}
        onValueChange={v => (onChange ?? (() => {}))(v ?? 1)}
        min={1}
        step={1}
        disabled={disabled}
      >
        <NumberFieldGroup className={cn('w-20 shrink-0', disabled && 'opacity-50')}>
          <NumberFieldInput />
          <NumberFieldControls>
            <NumberFieldIncrement />
            <NumberFieldDecrement />
          </NumberFieldControls>
        </NumberFieldGroup>
      </NumberField>
    </div>
  )
}

export default memo(MaxIterations)
