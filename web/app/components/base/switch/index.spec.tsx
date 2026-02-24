import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import Switch from './index'

describe('Switch', () => {
  it('should render in unchecked state when value is false', () => {
    render(<Switch value={false} />)
    const switchElement = screen.getByRole('switch')
    expect(switchElement).toBeInTheDocument()
    expect(switchElement).toHaveAttribute('aria-checked', 'false')
  })

  it('should render in checked state when value is true', () => {
    render(<Switch value={true} />)
    const switchElement = screen.getByRole('switch')
    expect(switchElement).toHaveAttribute('aria-checked', 'true')
  })

  it('should call onChange with next value when clicked', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Switch value={false} onChange={onChange} />)

    const switchElement = screen.getByRole('switch')

    await user.click(switchElement)
    expect(onChange).toHaveBeenCalledWith(true)
    expect(onChange).toHaveBeenCalledTimes(1)

    // Controlled component stays the same until parent updates value.
    expect(switchElement).toHaveAttribute('aria-checked', 'false')
  })

  it('should work in controlled mode with value prop', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(<Switch value={false} onChange={onChange} />)
    const switchElement = screen.getByRole('switch')

    expect(switchElement).toHaveAttribute('aria-checked', 'false')

    await user.click(switchElement)
    expect(onChange).toHaveBeenCalledWith(true)
    expect(switchElement).toHaveAttribute('aria-checked', 'false')

    rerender(<Switch value={true} onChange={onChange} />)
    expect(switchElement).toHaveAttribute('aria-checked', 'true')
  })

  it('should not call onChange when disabled', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Switch value={false} disabled onChange={onChange} />)

    const switchElement = screen.getByRole('switch')
    expect(switchElement).toHaveClass('!cursor-not-allowed', '!opacity-50')

    await user.click(switchElement)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('should apply correct size classes', () => {
    const { rerender } = render(<Switch value={false} size="xs" />)
    // We only need to find the element once
    const switchElement = screen.getByRole('switch')
    expect(switchElement).toHaveClass('h-2.5', 'w-3.5', 'rounded-sm')

    rerender(<Switch value={false} size="sm" />)
    expect(switchElement).toHaveClass('h-3', 'w-5')

    rerender(<Switch value={false} size="md" />)
    expect(switchElement).toHaveClass('h-4', 'w-7')

    rerender(<Switch value={false} size="l" />)
    expect(switchElement).toHaveClass('h-5', 'w-9')

    rerender(<Switch value={false} size="lg" />)
    expect(switchElement).toHaveClass('h-6', 'w-11')
  })

  it('should apply custom className', () => {
    render(<Switch value={false} className="custom-test-class" />)
    expect(screen.getByRole('switch')).toHaveClass('custom-test-class')
  })

  it('should apply correct background colors based on value prop', () => {
    const { rerender } = render(<Switch value={false} />)
    const switchElement = screen.getByRole('switch')

    expect(switchElement).toHaveClass('bg-components-toggle-bg-unchecked')

    rerender(<Switch value={true} />)
    expect(switchElement).toHaveClass('bg-components-toggle-bg')
  })
})
