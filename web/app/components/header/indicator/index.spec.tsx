import { render, screen } from '@testing-library/react'
import Indicator from './index'

describe('Indicator', () => {
  it('should render with default props', () => {
    render(<Indicator />)
    const indicator = screen.getByTestId('status-indicator')
    expect(indicator).toBeInTheDocument()
    expect(indicator).toHaveClass(
      'bg-components-badge-status-light-success-bg',
    )
    expect(indicator).toHaveClass(
      'border-components-badge-status-light-success-border-inner',
    )
    expect(indicator).toHaveClass('shadow-status-indicator-green-shadow')
  })

  it('should render with orange color', () => {
    render(<Indicator color="orange" />)
    const indicator = screen.getByTestId('status-indicator')
    expect(indicator).toHaveClass(
      'bg-components-badge-status-light-warning-bg',
    )
    expect(indicator).toHaveClass(
      'border-components-badge-status-light-warning-border-inner',
    )
    expect(indicator).toHaveClass('shadow-status-indicator-warning-shadow')
  })

  it('should render with red color', () => {
    render(<Indicator color="red" />)
    const indicator = screen.getByTestId('status-indicator')
    expect(indicator).toHaveClass('bg-components-badge-status-light-error-bg')
    expect(indicator).toHaveClass(
      'border-components-badge-status-light-error-border-inner',
    )
    expect(indicator).toHaveClass('shadow-status-indicator-red-shadow')
  })

  it('should render with blue color', () => {
    render(<Indicator color="blue" />)
    const indicator = screen.getByTestId('status-indicator')
    expect(indicator).toHaveClass('bg-components-badge-status-light-normal-bg')
    expect(indicator).toHaveClass(
      'border-components-badge-status-light-normal-border-inner',
    )
    expect(indicator).toHaveClass('shadow-status-indicator-blue-shadow')
  })

  it('should render with yellow color', () => {
    render(<Indicator color="yellow" />)
    const indicator = screen.getByTestId('status-indicator')
    expect(indicator).toHaveClass(
      'bg-components-badge-status-light-warning-bg',
    )
    expect(indicator).toHaveClass(
      'border-components-badge-status-light-warning-border-inner',
    )
    expect(indicator).toHaveClass('shadow-status-indicator-warning-shadow')
  })

  it('should render with gray color', () => {
    render(<Indicator color="gray" />)
    const indicator = screen.getByTestId('status-indicator')
    expect(indicator).toHaveClass(
      'bg-components-badge-status-light-disabled-bg',
    )
    expect(indicator).toHaveClass(
      'border-components-badge-status-light-disabled-border-inner',
    )
    expect(indicator).toHaveClass('shadow-status-indicator-gray-shadow')
  })

  it('should apply custom className', () => {
    render(<Indicator className="custom-class" />)
    const indicator = screen.getByTestId('status-indicator')
    expect(indicator).toHaveClass('custom-class')
  })
})
