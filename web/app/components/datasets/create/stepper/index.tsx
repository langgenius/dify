import type { FC } from 'react'
import type { Step } from './step'
import { StepperStep } from './step'

export type StepperProps = {
  steps: Step[]
  activeStepIndex: number
}

function join<T, R = T>(array: T[], sep: R): Array<T | R> {
  return array.reduce((acc, item, index) => {
    if (index === 0)
      return [item]

    return acc.concat([sep, item])
  }, [] as Array<T | R>)
}

export const Stepper: FC<StepperProps> = (props) => {
  const { steps, activeStepIndex } = props
  return <div className='flex items-center gap-3'>
    {join(
      steps.map((step, index) => (
        <StepperStep
          key={index}
          {...step}
          isActive={index === activeStepIndex}
          index={index}
        />
      )),
      <div className="w-4 h-px bg-[#101828]/30" />,
    )}
  </div>
}
