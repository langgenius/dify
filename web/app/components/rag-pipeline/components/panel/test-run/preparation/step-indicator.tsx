import Divider from '@/app/components/base/divider'
import cn from '@/utils/classnames'
import React from 'react'

type Step = {
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
    <div className='flex items-center gap-x-2 px-4 pb-2'>
      {steps.map((step, index) => {
        const isCurrentStep = index === currentStep - 1
        const isLastStep = index === steps.length - 1
        return (
          <div key={index} className='flex items-center gap-x-2'>
            <div
              className={cn('flex items-center gap-x-1', isCurrentStep ? 'text-state-accent-solid' : 'text-text-tertiary')}
            >
              {isCurrentStep && <div className='size-1 rounded-full bg-state-accent-solid' />}
              <span className='system-2xs-semibold-uppercase'>{step.label}</span>
            </div>
            {!isLastStep && (
              <div className='flex items-center'>
                <Divider type='horizontal' className='h-px w-3 bg-divider-deep' />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default React.memo(StepIndicator)
