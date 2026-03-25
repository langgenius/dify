import * as React from 'react'
import { cn } from '@/utils/classnames'

export type Step = {
  label: string
  value: string
}

type StepIndicatorProps = {
  currentStep: number
  steps: Step[]
}

const StepIndicator = ({
  currentStep,
  steps,
}: StepIndicatorProps) => {
  return (
    <div className="flex gap-x-1">
      {steps.map((step, index) => {
        const isActive = index === currentStep - 1
        return (
          <div
            key={step.value}
            className={cn('h-1 w-1 rounded-lg bg-divider-solid', isActive && 'w-2 bg-state-accent-solid')}
          />
        )
      })}
    </div>
  )
}

export default React.memo(StepIndicator)
