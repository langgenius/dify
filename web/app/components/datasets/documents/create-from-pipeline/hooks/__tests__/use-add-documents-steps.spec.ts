import { act, renderHook } from '@testing-library/react'
import { useAddDocumentsSteps } from '../use-add-documents-steps'

it('navigates the document wizard from datasource selection to processing and back', () => {
  const { result } = renderHook(() => useAddDocumentsSteps())
  expect(result.current.currentStep).toBe(1)
  expect(result.current.steps.map((step) => step.label)).toEqual([
    'datasetPipeline.addDocuments.steps.chooseDatasource',
    'datasetPipeline.addDocuments.steps.processDocuments',
    'datasetPipeline.addDocuments.steps.processingDocuments',
  ])
  act(() => result.current.handleNextStep())
  expect(result.current.currentStep).toBe(2)
  act(() => result.current.handleNextStep())
  expect(result.current.currentStep).toBe(3)
  act(() => result.current.handleBackStep())
  expect(result.current.currentStep).toBe(2)
})
