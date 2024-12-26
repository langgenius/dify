import type { FC } from 'react'
import { RiArrowLeftLine } from '@remixicon/react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { Stepper, type StepperProps } from '../stepper'
import classNames from '@/utils/classnames'

export type TopbarProps = Pick<StepperProps, 'activeIndex'> & {
  className?: string
}

const STEP_T_MAP: Record<number, string> = {
  1: 'datasetCreation.steps.one',
  2: 'datasetCreation.steps.two',
  3: 'datasetCreation.steps.three',
}

export const Topbar: FC<TopbarProps> = (props) => {
  const { className, ...rest } = props
  const { t } = useTranslation()
  return <div className={classNames('flex shrink-0 h-[52px] items-center justify-between relative border-b border-b-divider-subtle', className)}>
    <Link href={'/datasets'} className="h-12 pl-2 pr-6 py-2 justify-start items-center gap-1 inline-flex">
      <div className='p-2'>
        <RiArrowLeftLine className='size-4 text-text-primary' />
      </div>
      <p className="text-text-primary system-sm-semibold-uppercase">
        {t('datasetCreation.steps.header.creation')}
      </p>
    </Link>
    <div className={
      'top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 absolute'
    }>
      <Stepper
        steps={Array.from({ length: 3 }, (_, i) => ({
          name: t(STEP_T_MAP[i + 1]),
        }))}
        {...rest}
      />
    </div>
  </div>
}
