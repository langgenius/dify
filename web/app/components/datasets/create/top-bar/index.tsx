import type { FC } from 'react'
import { RiArrowLeftLine } from '@remixicon/react'
import { Stepper, type StepperProps } from '../stepper'
import classNames from '@/utils/classnames'

export type TopbarProps = Pick<StepperProps, 'activeStepIndex'> & {
  className?: string
}

export const Topbar: FC<TopbarProps> = (props) => {
  const { className, ...rest } = props
  return <div className={classNames('flex items-center justify-between relative', className)}>
    <div className="h-12 pl-2 pr-6 py-2 justify-start items-center gap-1 inline-flex">
      <RiArrowLeftLine className='size-4 mr-2' />
      <div className="text-[#101827] text-[13px] font-semibold uppercase leading-none">
        Create Knowledge
      </div>
    </div>
    <div className={
      'top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 absolute'
    }>
      <Stepper
        steps={[
          { name: 'Data Source' },
          { name: 'Document Processing' },
          { name: 'Execute & Finish' },
        ]}
        {...rest}
      />
    </div>
  </div>
}
