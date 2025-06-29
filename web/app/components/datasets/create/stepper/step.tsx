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
      'inline-flex h-5 flex-col items-center justify-center gap-2 rounded-3xl py-1',
      isActive
        ? 'bg-state-accent-solid px-2'
        : !isDisabled
          ? 'w-5 border border-text-quaternary'
          : 'w-5 border border-divider-deep',
    )}>
      <div className={classNames(
        'system-2xs-semibold-uppercase text-center',
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
        ? 'system-xs-semibold-uppercase text-text-accent'
        : !isDisabled
          ? 'text-text-tertiary'
          : 'text-text-quaternary',
    )}>{name}</div>
  </div>
}
