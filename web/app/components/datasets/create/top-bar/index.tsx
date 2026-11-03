import type { FC } from 'react'
import type { StepperProps } from '../stepper'
import { cn } from '@langgenius/dify-ui/cn'
import { RiArrowLeftLine } from '@remixicon/react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Link from '@/next/link'
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
  const { t } = useTranslation(['datasetCreation'])

  const fallbackRoute = useMemo(() => {
    return datasetId ? `/datasets/${datasetId}/documents` : '/datasets'
  }, [datasetId])

  return (
    <div
      className={cn(
        'relative flex shrink-0 flex-col items-stretch border-b border-b-divider-subtle xl:min-h-13 xl:flex-row xl:items-center xl:justify-between',
        className,
      )}
    >
      <Link
        href={fallbackRoute}
        replace
        className="inline-flex h-12 items-center justify-start gap-1 py-2 pr-6 pl-2"
      >
        <div className="p-2">
          <RiArrowLeftLine className="size-4 text-text-primary" />
        </div>
        <p className="system-sm-semibold-uppercase text-text-primary">
          {t(($) => $['steps.header.fallbackRoute'], { ns: 'datasetCreation' })}
        </p>
      </Link>
      <div className="min-w-0 px-4 pb-3 xl:absolute xl:top-1/2 xl:left-1/2 xl:-translate-1/2 xl:p-0">
        <Stepper
          steps={Array.from({ length: 3 }, (_, i) => ({
            name: t(($) => $[STEP_T_MAP[(i + 1) as keyof typeof STEP_T_MAP]], {
              ns: 'datasetCreation',
            }),
          }))}
          {...rest}
        />
      </div>
    </div>
  )
}
