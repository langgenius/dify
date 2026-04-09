import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import NextStepButton from '../next-step-button'

describe('NextStepButton', () => {
  const defaultProps = {
    disabled: false,
    onClick: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render button text', () => {
    render(<NextStepButton {...defaultProps} />)
    expect(screen.getByText('datasetCreation.stepOne.button')).toBeInTheDocument()
  })

  it('should render a primary variant button', () => {
    render(<NextStepButton {...defaultProps} />)
    const btn = screen.getByRole('button')
    expect(btn).toBeInTheDocument()
  })

  it('should call onClick when clicked', () => {
    render(<NextStepButton {...defaultProps} />)
    fireEvent.click(screen.getByRole('button'))
    expect(defaultProps.onClick).toHaveBeenCalledOnce()
  })

  it('should be disabled when disabled prop is true', () => {
    render(<NextStepButton disabled onClick={defaultProps.onClick} />)
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('should not call onClick when disabled', () => {
    render(<NextStepButton disabled onClick={defaultProps.onClick} />)
    fireEvent.click(screen.getByRole('button'))
    expect(defaultProps.onClick).not.toHaveBeenCalled()
  })

  it('should render arrow icon', () => {
    const { container } = render(<NextStepButton {...defaultProps} />)
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
  })
})
