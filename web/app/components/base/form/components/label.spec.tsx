import { fireEvent, render, screen } from '@testing-library/react'
import Label from './label'

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

describe('Label Component', () => {
  const defaultProps = {
    htmlFor: 'test-input',
    label: 'Test Label',
  }

  it('renders basic label correctly', () => {
    render(<Label {...defaultProps} />)
    const label = screen.getByTestId('label')
    expect(label).toBeInTheDocument()
    expect(label).toHaveAttribute('for', 'test-input')
  })

  it('shows optional text when showOptional is true', () => {
    render(<Label {...defaultProps} showOptional />)
    expect(screen.getByText('common.label.optional')).toBeInTheDocument()
  })

  it('shows required asterisk when isRequired is true', () => {
    render(<Label {...defaultProps} isRequired />)
    expect(screen.getByText('*')).toBeInTheDocument()
  })

  it('renders tooltip when tooltip prop is provided', () => {
    const tooltipText = 'Test Tooltip'
    render(<Label {...defaultProps} tooltip={tooltipText} />)
    const trigger = screen.getByTestId('test-input-tooltip')
    fireEvent.mouseEnter(trigger)
    expect(screen.getByText(tooltipText)).toBeInTheDocument()
  })

  it('applies custom className when provided', () => {
    const customClass = 'custom-label'
    render(<Label {...defaultProps} className={customClass} />)
    const label = screen.getByTestId('label')
    expect(label).toHaveClass(customClass)
  })

  it('does not show optional text and required asterisk simultaneously', () => {
    render(<Label {...defaultProps} isRequired showOptional />)
    expect(screen.queryByText('common.label.optional')).not.toBeInTheDocument()
    expect(screen.getByText('*')).toBeInTheDocument()
  })
})
