import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IndicatorButton } from '../indicator-button'

const defaultProps = {
  index: 0,
  label: '01 First banner',
  isCurrent: false,
  isNextSlide: false,
  autoplayDelay: 5000,
  isPaused: false,
  onClick: vi.fn(),
}

describe('IndicatorButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(cleanup)

  it('renders a named Dify UI button with a padded slide number', () => {
    render(<IndicatorButton {...defaultProps} index={4} label="Fifth banner" />)

    const button = screen.getByRole('button', { name: 'Fifth banner' })
    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveTextContent('05')
  })

  it('selects an inactive slide', () => {
    const onClick = vi.fn()
    render(<IndicatorButton {...defaultProps} onClick={onClick} />)

    fireEvent.click(screen.getByRole('button', { name: '01 First banner' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('exposes the current slide without disabling its pagination action', () => {
    const onClick = vi.fn()
    render(<IndicatorButton {...defaultProps} isCurrent onClick={onClick} />)

    const button = screen.getByRole('button', { name: '01 First banner' })
    expect(button).toHaveAttribute('aria-current', 'true')
    expect(button).toBeEnabled()
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('marks the visual progress ring as decorative', () => {
    const { container, rerender } = render(<IndicatorButton {...defaultProps} isNextSlide />)

    expect(container.querySelector('[data-progress-ring]')).toHaveAttribute('aria-hidden', 'true')

    rerender(<IndicatorButton {...defaultProps} isNextSlide isPaused />)
    expect(container.querySelector('[data-progress-ring]')).not.toBeInTheDocument()
  })
})
