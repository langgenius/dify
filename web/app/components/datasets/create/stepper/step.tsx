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
          ? 'border border-text-tertiary'
          : 'border border-divider-deep',
    )}>
      <div className={classNames(
        'text-center text-[10px] font-semibold uppercase leading-3',
        isActive
          ? 'text-text-primary-on-surface'
          : !isDisabled
            ? 'text-text-tertiary'
            : 'text-text-tertiary opacity-30',
      )}>
        {label}
      </div>
    </div>
    <div className={classNames(
      ' text-xs font-medium uppercase leading-none',
      isActive
        ? 'text-text-accent'
        : !isDisabled
          ? 'text-text-tertiary'
          : 'text-text-tertiary opacity-30',
    )}>{name}</div>
  </div>
}
