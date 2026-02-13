import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAddDocumentsSteps } from '../use-add-documents-steps'

describe('useAddDocumentsSteps', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should initialize with step 1', () => {
    const { result } = renderHook(() => useAddDocumentsSteps())
    expect(result.current.currentStep).toBe(1)
  })

  it('should return 3 steps', () => {
    const { result } = renderHook(() => useAddDocumentsSteps())
    expect(result.current.steps).toHaveLength(3)
  })

  it('should have correct step labels', () => {
    const { result } = renderHook(() => useAddDocumentsSteps())
    const labels = result.current.steps.map(s => s.label)
    expect(labels[0]).toContain('chooseDatasource')
    expect(labels[1]).toContain('processDocuments')
    expect(labels[2]).toContain('processingDocuments')
  })

  it('should increment step on handleNextStep', () => {
    const { result } = renderHook(() => useAddDocumentsSteps())
    act(() => {
      result.current.handleNextStep()
    })
    expect(result.current.currentStep).toBe(2)
  })

  it('should decrement step on handleBackStep', () => {
    const { result } = renderHook(() => useAddDocumentsSteps())
    act(() => {
      result.current.handleNextStep()
    })
    act(() => {
      result.current.handleNextStep()
    })
    expect(result.current.currentStep).toBe(3)
    act(() => {
      result.current.handleBackStep()
    })
    expect(result.current.currentStep).toBe(2)
  })
})
