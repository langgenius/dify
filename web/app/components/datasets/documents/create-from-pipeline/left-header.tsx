import React from 'react'
import { RiArrowLeftLine } from '@remixicon/react'
import Button from '@/app/components/base/button'
import { useParams } from 'next/navigation'
import Effect from '@/app/components/base/effect'
import { useAddDocumentsSteps } from './hooks'
import StepIndicator from './step-indicator'

type LeftHeaderProps = {
  title: string
  currentStep: number
}

const LeftHeader = ({
  title,
  currentStep,
}: LeftHeaderProps) => {
  const { datasetId } = useParams()
  const steps = useAddDocumentsSteps()

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
      <a
        className='absolute -left-11 top-3.5'
        href={`/datasets/${datasetId}/documents`}
      >
        <Button variant='secondary-accent' className='size-9 rounded-full p-0'>
          <RiArrowLeftLine className='size-5 ' />
        </Button>
      </a>
      <Effect className='left-8 top-[-34px] opacity-20' />
    </div>
  )
}

export default React.memo(LeftHeader)
