import { useTranslation } from 'react-i18next'
import { AddDocumentsStep } from './types'

export const useAddDocumentsSteps = () => {
  const { t } = useTranslation()
  const steps = [
    {
      label: t('datasetPipeline.addDocuments.steps.chooseDatasource'),
      value: AddDocumentsStep.dataSource,
    },
    {
      label: t('datasetPipeline.addDocuments.steps.ProcessDocuments'),
      value: AddDocumentsStep.processDocuments,
    },
    {
      label: t('datasetPipeline.addDocuments.steps.ProcessingDocuments'),
      value: AddDocumentsStep.processingDocuments,
    },
  ]
  return steps
}
