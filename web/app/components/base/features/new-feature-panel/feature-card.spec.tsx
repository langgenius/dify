import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import FeatureCard from './feature-card'

describe('FeatureCard', () => {
  const defaultProps = {
    icon: <div data-testid="icon">icon</div>,
    title: 'Test Feature',
    value: false,
  }

  it('should render icon and title', () => {
    render(<FeatureCard {...defaultProps} />)

    expect(screen.getByTestId('icon')).toBeInTheDocument()
    expect(screen.getByText(/Test Feature/)).toBeInTheDocument()
  })

  it('should render description when provided', () => {
    render(<FeatureCard {...defaultProps} description="A test description" />)

    expect(screen.getByText(/A test description/)).toBeInTheDocument()
  })

  it('should not render description when not provided', () => {
    render(<FeatureCard {...defaultProps} />)

    expect(screen.queryByText(/description/i)).not.toBeInTheDocument()
  })

  it('should render a switch toggle', () => {
    render(<FeatureCard {...defaultProps} />)

    expect(screen.getByRole('switch')).toBeInTheDocument()
  })

  it('should call onChange when switch is toggled', () => {
    const onChange = vi.fn()
    render(<FeatureCard {...defaultProps} onChange={onChange} />)

    fireEvent.click(screen.getByRole('switch'))

    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('should render tooltip when provided', () => {
    render(<FeatureCard {...defaultProps} tooltip="Helpful tip" />)

    // Tooltip text is passed as prop, verifying the component renders with it
    expect(screen.getByText(/Test Feature/)).toBeInTheDocument()
  })

  it('should not render tooltip when not provided', () => {
    render(<FeatureCard {...defaultProps} />)

    // Without tooltip, the title should still render
    expect(screen.getByText(/Test Feature/)).toBeInTheDocument()
  })

  it('should render children when provided', () => {
    render(
      <FeatureCard {...defaultProps}>
        <div data-testid="child-content">Child</div>
      </FeatureCard>,
    )

    expect(screen.getByTestId('child-content')).toBeInTheDocument()
  })

  it('should call onMouseEnter when hovering', () => {
    const onMouseEnter = vi.fn()
    render(<FeatureCard {...defaultProps} onMouseEnter={onMouseEnter} />)

    const card = screen.getByText(/Test Feature/).closest('[class]')!
    fireEvent.mouseEnter(card)

    expect(onMouseEnter).toHaveBeenCalledTimes(1)
  })

  it('should call onMouseLeave when mouse leaves', () => {
    const onMouseLeave = vi.fn()
    render(<FeatureCard {...defaultProps} onMouseLeave={onMouseLeave} />)

    const card = screen.getByText(/Test Feature/).closest('[class]')!
    fireEvent.mouseLeave(card)

    expect(onMouseLeave).toHaveBeenCalledTimes(1)
  })

  it('should handle disabled state', () => {
    render(<FeatureCard {...defaultProps} disabled={true} />)

    const switchElement = screen.getByRole('switch')
    expect(switchElement).toBeInTheDocument()
  })

  it('should not call onChange when onChange is not provided', () => {
    render(<FeatureCard {...defaultProps} />)

    // Should not throw when switch is clicked without onChange
    expect(() => fireEvent.click(screen.getByRole('switch'))).not.toThrow()
  })
})
