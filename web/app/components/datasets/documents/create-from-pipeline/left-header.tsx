import type { Step } from './step-indicator'
import { RiArrowLeftLine } from '@remixicon/react'
import * as React from 'react'
import Effect from '@/app/components/base/effect'
import { Button } from '@/app/components/base/ui/button'
import Link from '@/next/link'
import { useParams } from '@/next/navigation'
import StepIndicator from './step-indicator'

type LeftHeaderProps = {
  steps: Array<Step>
  title: string
  currentStep: number
}

const LeftHeader = ({
  steps,
  title,
  currentStep,
}: LeftHeaderProps) => {
  const { datasetId } = useParams()

  return (
    <div className="relative flex flex-col gap-y-0.5 pt-4 pb-2">
      <div className="flex items-center gap-x-2">
        <span className="bg-pipeline-add-documents-title-bg bg-clip-text system-2xs-semibold-uppercase text-transparent">
          {title}
        </span>
        <span className="system-2xs-regular text-divider-regular">/</span>
        <StepIndicator steps={steps} currentStep={currentStep} />
      </div>
      <div className="system-md-semibold text-text-primary">
        {steps[currentStep - 1]?.label}
      </div>
      {currentStep !== steps.length && (
        <Link
          href={`/datasets/${datasetId}/documents`}
          replace
        >
          <Button
            variant="secondary-accent"
            className="absolute top-3.5 -left-11 size-9 rounded-full p-0"
          >
            <RiArrowLeftLine className="size-5" />
          </Button>
        </Link>
      )}
      <Effect className="top-[-34px] left-8 opacity-20" />
    </div>
  )
}

export default React.memo(LeftHeader)
