import React from 'react'
import { useTranslation } from 'react-i18next'
import StepIndicator from './step-indicator'

type HeaderProps = {
  steps: { label: string; value: string }[]
  currentStep: number
}

const Header = ({
  steps,
  currentStep,
}: HeaderProps) => {
  const { t } = useTranslation()

  return (
    <div className='flex flex-col gap-y-0.5 px-3 pb-2 pt-3.5'>
      <div className='system-md-semibold-uppercase flex items-center gap-x-1 pl-1 pr-8 text-text-primary'>
        {t('datasetPipeline.testRun.title')}
      </div>
      <StepIndicator steps={steps} currentStep={currentStep} />
    </div>
  )
}

export default React.memo(Header)
