import { memo } from 'react'
import { InputNumber } from '@/app/components/base/input-number'
import Tooltip from '@/app/components/base/tooltip'

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
      <InputNumber
        className={cn('w-14 shrink-0', disabled && 'opacity-50')}
        value={value}
        onChange={onChange ?? (() => {})}
        min={1}
        step={1}
        disabled={disabled}
      />
    </div>
  )
}

export default memo(MaxIterations)
