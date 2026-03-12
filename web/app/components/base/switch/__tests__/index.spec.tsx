import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import Switch from '../index'
import { SwitchSkeleton } from '../skeleton'

const getThumb = (switchElement: HTMLElement) => switchElement.querySelector('span')

describe('Switch', () => {
  it('should render in unchecked state when value is false', () => {
    render(<Switch value={false} />)
    const switchElement = screen.getByRole('switch')
    expect(switchElement).toBeInTheDocument()
    expect(switchElement).toHaveAttribute('aria-checked', 'false')
    expect(switchElement).not.toHaveAttribute('data-checked')
  })

  it('should render in checked state when value is true', () => {
    render(<Switch value={true} />)
    const switchElement = screen.getByRole('switch')
    expect(switchElement).toHaveAttribute('aria-checked', 'true')
    expect(switchElement).toHaveAttribute('data-checked', '')
  })

  it('should call onChange with next value when clicked', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Switch value={false} onChange={onChange} />)

    const switchElement = screen.getByRole('switch')

    await user.click(switchElement)
    expect(onChange).toHaveBeenCalledWith(true)
    expect(onChange).toHaveBeenCalledTimes(1)

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
    expect(switchElement).toHaveClass('data-[disabled]:cursor-not-allowed')
    expect(switchElement).toHaveAttribute('data-disabled', '')

    await user.click(switchElement)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('should apply correct size classes', () => {
    const { rerender } = render(<Switch value={false} size="xs" />)
    const switchElement = screen.getByRole('switch')
    expect(switchElement).toHaveClass('h-2.5', 'w-3.5', 'rounded-[2px]')

    rerender(<Switch value={false} size="sm" />)
    expect(switchElement).toHaveClass('h-3', 'w-5')

    rerender(<Switch value={false} size="md" />)
    expect(switchElement).toHaveClass('h-4', 'w-7')

    rerender(<Switch value={false} size="lg" />)
    expect(switchElement).toHaveClass('h-5', 'w-9')
  })

  it('should apply custom className', () => {
    render(<Switch value={false} className="custom-test-class" />)
    expect(screen.getByRole('switch')).toHaveClass('custom-test-class')
  })

  it('should expose checked state styling hooks on the root and thumb', () => {
    const { rerender } = render(<Switch value={false} />)
    const switchElement = screen.getByRole('switch')
    const thumb = getThumb(switchElement)

    expect(switchElement).toHaveClass('bg-components-toggle-bg-unchecked', 'data-[checked]:bg-components-toggle-bg')
    expect(thumb).toHaveClass('data-[checked]:translate-x-[14px]')
    expect(thumb).not.toHaveAttribute('data-checked')

    rerender(<Switch value={true} />)
    expect(switchElement).toHaveAttribute('data-checked', '')
    expect(thumb).toHaveAttribute('data-checked', '')
  })

  it('should expose disabled state styling hooks instead of relying on opacity', () => {
    const { rerender } = render(<Switch value={false} disabled />)
    const switchElement = screen.getByRole('switch')

    expect(switchElement).toHaveClass(
      'data-[disabled]:bg-components-toggle-bg-unchecked-disabled',
      'data-[disabled]:data-[checked]:bg-components-toggle-bg-disabled',
    )
    expect(switchElement).toHaveAttribute('data-disabled', '')

    rerender(<Switch value={true} disabled />)
    expect(switchElement).toHaveAttribute('data-disabled', '')
    expect(switchElement).toHaveAttribute('data-checked', '')
  })

  it('should have focus-visible ring styles', () => {
    render(<Switch value={false} />)
    const switchElement = screen.getByRole('switch')
    expect(switchElement).toHaveClass('focus-visible:ring-2')
  })

  it('should respect prefers-reduced-motion', () => {
    render(<Switch value={false} />)
    const switchElement = screen.getByRole('switch')
    expect(switchElement).toHaveClass('motion-reduce:transition-none')
  })

  describe('loading state', () => {
    it('should render as disabled when loading', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()
      render(<Switch value={false} loading onChange={onChange} />)

      const switchElement = screen.getByRole('switch')
      expect(switchElement).toHaveClass('data-[disabled]:cursor-not-allowed')
      expect(switchElement).toHaveAttribute('aria-busy', 'true')
      expect(switchElement).toHaveAttribute('data-disabled', '')

      await user.click(switchElement)
      expect(onChange).not.toHaveBeenCalled()
    })

    it('should show spinner icon for md and lg sizes', () => {
      const { rerender, container } = render(<Switch value={false} loading size="md" />)
      expect(container.querySelector('span[aria-hidden="true"] i')).toBeInTheDocument()

      rerender(<Switch value={false} loading size="lg" />)
      expect(container.querySelector('span[aria-hidden="true"] i')).toBeInTheDocument()
    })

    it('should not show spinner for xs and sm sizes', () => {
      const { rerender, container } = render(<Switch value={false} loading size="xs" />)
      expect(container.querySelector('span[aria-hidden="true"] i')).not.toBeInTheDocument()

      rerender(<Switch value={false} loading size="sm" />)
      expect(container.querySelector('span[aria-hidden="true"] i')).not.toBeInTheDocument()
    })

    it('should apply disabled data-state hooks when loading', () => {
      const { rerender } = render(<Switch value={false} loading />)
      const switchElement = screen.getByRole('switch')

      expect(switchElement).toHaveAttribute('data-disabled', '')

      rerender(<Switch value={true} loading />)
      expect(switchElement).toHaveAttribute('data-disabled', '')
      expect(switchElement).toHaveAttribute('data-checked', '')
    })
  })
})

describe('SwitchSkeleton', () => {
  it('should render a plain div without switch role', () => {
    render(<SwitchSkeleton data-testid="skeleton-switch" />)
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.getByTestId('skeleton-switch')).toBeInTheDocument()
  })

  it('should apply skeleton styles', () => {
    render(<SwitchSkeleton data-testid="skeleton-switch" />)
    const el = screen.getByTestId('skeleton-switch')
    expect(el).toHaveClass('bg-text-quaternary', 'opacity-20')
  })

  it('should apply correct skeleton size classes', () => {
    const { rerender } = render(<SwitchSkeleton size="xs" data-testid="s" />)
    const el = screen.getByTestId('s')
    expect(el).toHaveClass('h-2.5', 'w-3.5', 'rounded-[2px]')

    rerender(<SwitchSkeleton size="lg" data-testid="s" />)
    expect(el).toHaveClass('h-5', 'w-9', 'rounded-[6px]')
  })

  it('should apply custom className to skeleton', () => {
    render(<SwitchSkeleton className="custom-class" data-testid="s" />)
    expect(screen.getByTestId('s')).toHaveClass('custom-class')
  })
})
