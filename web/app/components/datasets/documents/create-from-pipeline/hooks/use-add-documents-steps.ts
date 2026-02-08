import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AddDocumentsStep } from '../types'

/**
 * Hook for managing add documents wizard steps
 */
export const useAddDocumentsSteps = () => {
  const { t } = useTranslation()
  const [currentStep, setCurrentStep] = useState(1)

  const handleNextStep = useCallback(() => {
    setCurrentStep(preStep => preStep + 1)
  }, [])

  const handleBackStep = useCallback(() => {
    setCurrentStep(preStep => preStep - 1)
  }, [])

  const steps = [
    {
      label: t('addDocuments.steps.chooseDatasource', { ns: 'datasetPipeline' }),
      value: AddDocumentsStep.dataSource,
    },
    {
      label: t('addDocuments.steps.processDocuments', { ns: 'datasetPipeline' }),
      value: AddDocumentsStep.processDocuments,
    },
    {
      label: t('addDocuments.steps.processingDocuments', { ns: 'datasetPipeline' }),
      value: AddDocumentsStep.processingDocuments,
    },
  ]

  return {
    steps,
    currentStep,
    handleNextStep,
    handleBackStep,
  }
}
