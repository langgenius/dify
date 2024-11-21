import type { FC } from 'react'
import classNames from '@/utils/classnames'

export type Step = {
  name: string
}

export type StepperStepProps = Step & {
  index: number
  isActive: boolean
}

export const StepperStep: FC<StepperStepProps> = (props) => {
  const { name, isActive, index } = props
  const label = isActive ? `STEP ${index + 1}` : `${index + 1}`
  return <div className='flex items-center gap-2'>
    <div className={classNames(
      'h-5 px-2 py-1 rounded-3xl flex-col justify-center items-center gap-2 inline-flex',
      isActive ? 'bg-[#296cff]' : 'border border-[#101828]/30',
    )}>
      <div className={classNames(
        'text-center text-[10px] font-semibold uppercase leading-3',
        isActive ? 'text-white' : 'text-[#676f83]',
      )}>
        {label}
      </div>
    </div>
    <div className={classNames(
      ' text-xs font-medium uppercase leading-none',
      isActive ? 'text-[#155aef]' : 'text-[#676f83]',
    )}>{name}</div>
  </div>
}
