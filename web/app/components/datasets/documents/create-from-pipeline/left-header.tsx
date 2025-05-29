import React from 'react'
import { RiArrowLeftLine } from '@remixicon/react'
import Button from '@/app/components/base/button'
import { useParams } from 'next/navigation'
import Effect from '@/app/components/base/effect'
import type { Step } from './step-indicator'
import StepIndicator from './step-indicator'
import Link from 'next/link'

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
    <div className='relative flex flex-col gap-y-0.5 pb-2 pt-4'>
      <div className='flex items-center gap-x-2'>
        <span className='system-2xs-semibold-uppercase bg-pipeline-add-documents-title-bg bg-clip-text text-transparent'>
          {title}
        </span>
        <span className='system-2xs-regular text-divider-regular'>/</span>
        <StepIndicator steps={steps} currentStep={currentStep} />
      </div>
      <div className='system-md-semibold text-text-primary'>
        {steps[currentStep - 1]?.label}
      </div>
      {currentStep !== steps.length && (
        <Link
          href={`/datasets/${datasetId}/documents`}
          replace
        >
          <Button
            variant='secondary-accent'
            className='absolute -left-11 top-3.5 size-9 rounded-full p-0'
          >
            <RiArrowLeftLine className='size-5 ' />
          </Button>
        </Link>
      )}
      <Effect className='left-8 top-[-34px] opacity-20' />
    </div>
  )
}

export default React.memo(LeftHeader)
