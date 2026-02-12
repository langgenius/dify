import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StepTwoFooter } from '../step-two-footer'

describe('StepTwoFooter', () => {
  const defaultProps = {
    isCreating: false,
    onPrevious: vi.fn(),
    onCreate: vi.fn(),
    onCancel: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render previous and next buttons when not isSetting', () => {
    render(<StepTwoFooter {...defaultProps} />)
    expect(screen.getByText('datasetCreation.stepTwo.previousStep')).toBeInTheDocument()
    expect(screen.getByText('datasetCreation.stepTwo.nextStep')).toBeInTheDocument()
  })

  it('should render save and cancel buttons when isSetting', () => {
    render(<StepTwoFooter {...defaultProps} isSetting />)
    expect(screen.getByText('datasetCreation.stepTwo.save')).toBeInTheDocument()
    expect(screen.getByText('datasetCreation.stepTwo.cancel')).toBeInTheDocument()
  })

  it('should call onPrevious on previous button click', () => {
    render(<StepTwoFooter {...defaultProps} />)
    fireEvent.click(screen.getByText('datasetCreation.stepTwo.previousStep'))
    expect(defaultProps.onPrevious).toHaveBeenCalledOnce()
  })

  it('should call onCreate on next button click', () => {
    render(<StepTwoFooter {...defaultProps} />)
    fireEvent.click(screen.getByText('datasetCreation.stepTwo.nextStep'))
    expect(defaultProps.onCreate).toHaveBeenCalledOnce()
  })

  it('should call onCancel on cancel button click in settings mode', () => {
    render(<StepTwoFooter {...defaultProps} isSetting />)
    fireEvent.click(screen.getByText('datasetCreation.stepTwo.cancel'))
    expect(defaultProps.onCancel).toHaveBeenCalledOnce()
  })
})
