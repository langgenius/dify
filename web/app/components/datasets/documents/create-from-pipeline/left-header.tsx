import type { Step } from './step-indicator'
import { cn } from '@langgenius/dify-ui/cn'
import { iconButtonVariants } from '@langgenius/dify-ui/icon-button'
import { RiArrowLeftLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Effect from '@/app/components/base/effect'
import Link from '@/next/link'
import { useParams } from '@/next/navigation'
import StepIndicator from './step-indicator'

type LeftHeaderProps = {
  steps: Array<Step>
  title: string
  currentStep: number
}

const LeftHeader = ({ steps, title, currentStep }: LeftHeaderProps) => {
  const { datasetId } = useParams()
  const { t } = useTranslation()

  return (
    <div className="relative flex flex-col gap-y-0.5 pt-4 pb-2">
      <div className="flex items-center gap-x-2">
        <span className="bg-pipeline-add-documents-title-bg bg-clip-text system-2xs-semibold-uppercase text-transparent">
          {title}
        </span>
        <span className="system-2xs-regular text-divider-regular">/</span>
        <StepIndicator steps={steps} currentStep={currentStep} />
      </div>
      <div className="system-md-semibold text-text-primary">{steps[currentStep - 1]?.label}</div>
      {currentStep !== steps.length && (
        <Link
          aria-label={t(($) => $['operation.back'], { ns: 'common' })}
          href={`/datasets/${datasetId}/documents`}
          replace
          className={cn(
            iconButtonVariants({ variant: 'secondary-accent', size: 'xl' }),
            'absolute top-3.5 -left-11 rounded-full',
          )}
        >
          <RiArrowLeftLine aria-hidden className="size-5" />
        </Link>
      )}
      <Effect className="-top-8.5 left-8 opacity-20" />
    </div>
  )
}

export default React.memo(LeftHeader)
