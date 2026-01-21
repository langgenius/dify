import type { FC } from 'react'
import type { StepperProps } from '../stepper'
import { RiArrowLeftLine } from '@remixicon/react'
import Link from 'next/link'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'
import { Stepper } from '../stepper'

export type TopBarProps = Pick<StepperProps, 'activeIndex'> & {
  className?: string
  datasetId?: string
}

const STEP_T_MAP = {
  1: 'steps.one',
  2: 'steps.two',
  3: 'steps.three',
} as const

export const TopBar: FC<TopBarProps> = (props) => {
  const { className, datasetId, ...rest } = props
  const { t } = useTranslation()

  const fallbackRoute = useMemo(() => {
    return datasetId ? `/datasets/${datasetId}/documents` : '/datasets'
  }, [datasetId])

  return (
    <div className={cn('relative flex h-[52px] shrink-0 items-center justify-between border-b border-b-divider-subtle', className)}>
      <Link href={fallbackRoute} replace className="inline-flex h-12 items-center justify-start gap-1 py-2 pl-2 pr-6">
        <div className="p-2">
          <RiArrowLeftLine className="size-4 text-text-primary" />
        </div>
        <p className="system-sm-semibold-uppercase text-text-primary">
          {t('steps.header.fallbackRoute', { ns: 'datasetCreation' })}
        </p>
      </Link>
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <Stepper
          steps={Array.from({ length: 3 }, (_, i) => ({
            name: t(STEP_T_MAP[(i + 1) as keyof typeof STEP_T_MAP], { ns: 'datasetCreation' }),
          }))}
          {...rest}
        />
      </div>
    </div>
  )
}
