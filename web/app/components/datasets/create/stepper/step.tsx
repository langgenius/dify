import type { FC } from 'react'
import classNames from '@/utils/classnames'

export type Step = {
  name: string
}

export type StepperStepProps = Step & {
  index: number
  activeIndex: number
}

export const StepperStep: FC<StepperStepProps> = (props) => {
  const { name, activeIndex, index } = props
  const isActive = index === activeIndex
  const isDisabled = activeIndex < index
  const label = isActive ? `STEP ${index + 1}` : `${index + 1}`
  return <div className='flex items-center gap-2'>
    <div className={classNames(
      'h-5 px-2 py-1 rounded-3xl flex-col justify-center items-center gap-2 inline-flex',
      isActive
        ? 'bg-state-accent-solid'
        : !isDisabled
          ? 'border border-text-quaternary'
          : 'border border-divider-deep',
    )}>
      <div className={classNames(
        'text-center system-2xs-semibold-uppercase',
        isActive
          ? 'text-text-primary-on-surface'
          : !isDisabled
            ? 'text-text-tertiary'
            : 'text-text-quaternary',
      )}>
        {label}
      </div>
    </div>
    <div className={classNames('system-xs-medium-uppercase',
      isActive
        ? 'text-text-accent system-xs-semibold-uppercase'
        : !isDisabled
          ? 'text-text-tertiary'
          : 'text-text-quaternary',
    )}>{name}</div>
  </div>
}
