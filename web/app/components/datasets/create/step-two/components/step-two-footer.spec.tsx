import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StepTwoFooter } from './step-two-footer'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@remixicon/react', () => ({
  RiArrowLeftLine: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid="arrow-left" {...props} />,
}))

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
    expect(screen.getByText('stepTwo.previousStep')).toBeInTheDocument()
    expect(screen.getByText('stepTwo.nextStep')).toBeInTheDocument()
  })

  it('should render save and cancel buttons when isSetting', () => {
    render(<StepTwoFooter {...defaultProps} isSetting />)
    expect(screen.getByText('stepTwo.save')).toBeInTheDocument()
    expect(screen.getByText('stepTwo.cancel')).toBeInTheDocument()
  })

  it('should call onPrevious on previous button click', () => {
    render(<StepTwoFooter {...defaultProps} />)
    fireEvent.click(screen.getByText('stepTwo.previousStep'))
    expect(defaultProps.onPrevious).toHaveBeenCalledOnce()
  })

  it('should call onCreate on next button click', () => {
    render(<StepTwoFooter {...defaultProps} />)
    fireEvent.click(screen.getByText('stepTwo.nextStep'))
    expect(defaultProps.onCreate).toHaveBeenCalledOnce()
  })

  it('should call onCancel on cancel button click in settings mode', () => {
    render(<StepTwoFooter {...defaultProps} isSetting />)
    fireEvent.click(screen.getByText('stepTwo.cancel'))
    expect(defaultProps.onCancel).toHaveBeenCalledOnce()
  })
})
