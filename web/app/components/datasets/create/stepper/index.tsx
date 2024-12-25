import { type FC, Fragment } from 'react'
import type { Step } from './step'
import { StepperStep } from './step'

export type StepperProps = {
  steps: Step[]
  activeIndex: number
}

export const Stepper: FC<StepperProps> = (props) => {
  const { steps, activeIndex } = props
  return <div className='flex items-center gap-3'>
    {steps.map((step, index) => {
      const isLast = index === steps.length - 1
      return (
        <Fragment key={index}>
          <StepperStep
            {...step}
            activeIndex={activeIndex}
            index={index}
          />
          {!isLast && <div className='w-4 h-px bg-divider-deep' />}
        </Fragment>
      )
    })}
  </div>
}
