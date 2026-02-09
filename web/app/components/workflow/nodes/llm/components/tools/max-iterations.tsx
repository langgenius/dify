import { memo } from 'react'
import { InputNumber } from '@/app/components/base/input-number'
import Slider from '@/app/components/base/slider'
import Tooltip from '@/app/components/base/tooltip'

import { cn } from '@/utils/classnames'

type MaxIterationsProps = {
  value?: number
  onChange?: (value: number) => void
  className?: string
}
const MaxIterations = ({ value = 10, onChange, className }: MaxIterationsProps) => {
  return (
    <div className={cn('mt-3 flex h-10 items-center', className)}>
      <div className="system-sm-semibold mr-0.5 truncate uppercase text-text-secondary">Max Iterations</div>
      <Tooltip
        popupContent="Max Iterations is the maximum number of iterations to run the tool."
        triggerClassName="shrink-0 w-4 h-4"
      />
      <div className="mr-3 flex grow items-center justify-end">
        <Slider
          className="w-[124px]"
          value={value}
          onChange={onChange ?? (() => {})}
          min={1}
          max={99}
          step={1}
        />
      </div>
      <InputNumber
        className="w-10 shrink-0"
        value={value}
        onChange={onChange ?? (() => {})}
        min={1}
        max={99}
        step={1}
      />
    </div>
  )
}

export default memo(MaxIterations)
