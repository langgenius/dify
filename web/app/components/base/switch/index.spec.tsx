import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import Switch from './index'

describe('Switch', () => {
  it('should render in unchecked state by default', () => {
    render(<Switch />)
    const switchElement = screen.getByRole('switch')
    expect(switchElement).toBeInTheDocument()
    expect(switchElement).toHaveAttribute('aria-checked', 'false')
  })

  it('should render in checked state when defaultValue is true', () => {
    render(<Switch defaultValue={true} />)
    const switchElement = screen.getByRole('switch')
    expect(switchElement).toHaveAttribute('aria-checked', 'true')
  })

  it('should toggle state and call onChange when clicked', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Switch onChange={onChange} />)

    const switchElement = screen.getByRole('switch')

    await user.click(switchElement)
    expect(switchElement).toHaveAttribute('aria-checked', 'true')
    expect(onChange).toHaveBeenCalledWith(true)
    expect(onChange).toHaveBeenCalledTimes(1)

    await user.click(switchElement)
    expect(switchElement).toHaveAttribute('aria-checked', 'false')
    expect(onChange).toHaveBeenCalledWith(false)
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('should not call onChange when disabled', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Switch disabled onChange={onChange} />)

    const switchElement = screen.getByRole('switch')
    expect(switchElement).toHaveClass('!cursor-not-allowed', '!opacity-50')

    await user.click(switchElement)
    // Note: aria-checked might still change due to HeadlessUI behavior
    // The important part is onChange shouldn't be called
    expect(onChange).not.toHaveBeenCalled()
  })

  it('should sync internal state when defaultValue prop changes', () => {
    const { rerender } = render(<Switch defaultValue={false} />)
    const switchElement = screen.getByRole('switch')
    expect(switchElement).toHaveAttribute('aria-checked', 'false')

    rerender(<Switch defaultValue={true} />)
    expect(switchElement).toHaveAttribute('aria-checked', 'true')
  })

  it('should apply correct size classes', () => {
    const { rerender } = render(<Switch size="xs" />)
    let switchElement = screen.getByRole('switch')
    expect(switchElement).toHaveClass('h-2.5', 'w-3.5', 'rounded-sm')

    rerender(<Switch size="sm" />)
    switchElement = screen.getByRole('switch')
    expect(switchElement).toHaveClass('h-3', 'w-5')

    rerender(<Switch size="md" />)
    switchElement = screen.getByRole('switch')
    expect(switchElement).toHaveClass('h-4', 'w-7')

    rerender(<Switch size="l" />)
    switchElement = screen.getByRole('switch')
    expect(switchElement).toHaveClass('h-5', 'w-9')

    rerender(<Switch size="lg" />)
    switchElement = screen.getByRole('switch')
    expect(switchElement).toHaveClass('h-6', 'w-11')
  })

  it('should apply custom className', () => {
    render(<Switch className="custom-test-class" />)
    expect(screen.getByRole('switch')).toHaveClass('custom-test-class')
  })

  // NEW: Test background color changes
  it('should apply correct background colors based on state', async () => {
    const user = userEvent.setup()
    render(<Switch />)
    const switchElement = screen.getByRole('switch')

    expect(switchElement).toHaveClass('bg-components-toggle-bg-unchecked')

    await user.click(switchElement)
    expect(switchElement).toHaveClass('bg-components-toggle-bg')
  })
})
