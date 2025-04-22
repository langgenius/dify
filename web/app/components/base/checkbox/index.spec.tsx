import { fireEvent, render, screen } from '@testing-library/react'
import Checkbox from './index'

describe('Checkbox Component', () => {
  const mockProps = {
    id: 'test',
  }

  it('renders unchecked checkbox by default', () => {
    render(<Checkbox {...mockProps} />)
    const checkbox = screen.getByTestId('checkbox-test')
    expect(checkbox).toBeInTheDocument()
    expect(checkbox).not.toHaveClass('bg-components-checkbox-bg')
  })

  it('renders checked checkbox when checked prop is true', () => {
    render(<Checkbox {...mockProps} checked />)
    const checkbox = screen.getByTestId('checkbox-test')
    expect(checkbox).toHaveClass('bg-components-checkbox-bg')
    expect(screen.getByTestId('check-icon-test')).toBeInTheDocument()
  })

  it('renders indeterminate state correctly', () => {
    render(<Checkbox {...mockProps} indeterminate />)
    expect(screen.getByTestId('indeterminate-icon')).toBeInTheDocument()
  })

  it('handles click events when not disabled', () => {
    const onCheck = jest.fn()
    render(<Checkbox {...mockProps} onCheck={onCheck} />)
    const checkbox = screen.getByTestId('checkbox-test')

    fireEvent.click(checkbox)
    expect(onCheck).toHaveBeenCalledTimes(1)
  })

  it('does not handle click events when disabled', () => {
    const onCheck = jest.fn()
    render(<Checkbox {...mockProps} disabled onCheck={onCheck} />)
    const checkbox = screen.getByTestId('checkbox-test')

    fireEvent.click(checkbox)
    expect(onCheck).not.toHaveBeenCalled()
    expect(checkbox).toHaveClass('cursor-not-allowed')
  })

  it('applies custom className when provided', () => {
    const customClass = 'custom-class'
    render(<Checkbox {...mockProps} className={customClass} />)
    const checkbox = screen.getByTestId('checkbox-test')
    expect(checkbox).toHaveClass(customClass)
  })

  it('applies correct styles for disabled checked state', () => {
    render(<Checkbox {...mockProps} checked disabled />)
    const checkbox = screen.getByTestId('checkbox-test')
    expect(checkbox).toHaveClass('bg-components-checkbox-bg-disabled-checked')
    expect(checkbox).toHaveClass('cursor-not-allowed')
  })

  it('applies correct styles for disabled unchecked state', () => {
    render(<Checkbox {...mockProps} disabled />)
    const checkbox = screen.getByTestId('checkbox-test')
    expect(checkbox).toHaveClass('bg-components-checkbox-bg-disabled')
    expect(checkbox).toHaveClass('cursor-not-allowed')
  })
})
