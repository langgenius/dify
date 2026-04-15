import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import Switch from '../index'
import { SwitchSkeleton } from '../skeleton'

const getThumb = (switchElement: HTMLElement) => switchElement.querySelector('span')

describe('Switch', () => {
  it('should render in unchecked state when checked is false', () => {
    render(<Switch checked={false} />)
    const switchElement = screen.getByRole('switch')
    expect(switchElement).toBeInTheDocument()
    expect(switchElement).toHaveAttribute('aria-checked', 'false')
    expect(switchElement).not.toHaveAttribute('data-checked')
  })

  it('should render in checked state when checked is true', () => {
    render(<Switch checked={true} />)
    const switchElement = screen.getByRole('switch')
    expect(switchElement).toHaveAttribute('aria-checked', 'true')
    expect(switchElement).toHaveAttribute('data-checked', '')
  })

  it('should call onCheckedChange with next value when clicked', async () => {
    const onCheckedChange = vi.fn()
    const user = userEvent.setup()
    render(<Switch checked={false} onCheckedChange={onCheckedChange} />)

    const switchElement = screen.getByRole('switch')

    await user.click(switchElement)
    expect(onCheckedChange).toHaveBeenCalledWith(true)
    expect(onCheckedChange).toHaveBeenCalledTimes(1)

    expect(switchElement).toHaveAttribute('aria-checked', 'false')
  })

  it('should work in controlled mode with checked prop', async () => {
    const onCheckedChange = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(<Switch checked={false} onCheckedChange={onCheckedChange} />)
    const switchElement = screen.getByRole('switch')

    expect(switchElement).toHaveAttribute('aria-checked', 'false')

    await user.click(switchElement)
    expect(onCheckedChange).toHaveBeenCalledWith(true)
    expect(switchElement).toHaveAttribute('aria-checked', 'false')

    rerender(<Switch checked={true} onCheckedChange={onCheckedChange} />)
    expect(switchElement).toHaveAttribute('aria-checked', 'true')
  })

  it('should not call onCheckedChange when disabled', async () => {
    const onCheckedChange = vi.fn()
    const user = userEvent.setup()
    render(<Switch checked={false} disabled onCheckedChange={onCheckedChange} />)

    const switchElement = screen.getByRole('switch')
    expect(switchElement).toHaveClass('data-disabled:cursor-not-allowed')
    expect(switchElement).toHaveAttribute('data-disabled', '')

    await user.click(switchElement)
    expect(onCheckedChange).not.toHaveBeenCalled()
  })

  it('should apply correct size classes', () => {
    const { rerender } = render(<Switch checked={false} size="xs" />)
    const switchElement = screen.getByRole('switch')
    expect(switchElement).toHaveClass('h-2.5', 'w-3.5', 'rounded-xs')

    rerender(<Switch checked={false} size="sm" />)
    expect(switchElement).toHaveClass('h-3', 'w-5')

    rerender(<Switch checked={false} size="md" />)
    expect(switchElement).toHaveClass('h-4', 'w-7')

    rerender(<Switch checked={false} size="lg" />)
    expect(switchElement).toHaveClass('h-5', 'w-9')
  })

  it('should apply custom className', () => {
    render(<Switch checked={false} className="custom-test-class" />)
    expect(screen.getByRole('switch')).toHaveClass('custom-test-class')
  })

  it('should expose checked state styling hooks on the root and thumb', () => {
    const { rerender } = render(<Switch checked={false} />)
    const switchElement = screen.getByRole('switch')
    const thumb = getThumb(switchElement)

    expect(switchElement).toHaveClass('bg-components-toggle-bg-unchecked', 'data-checked:bg-components-toggle-bg')
    expect(thumb).toHaveClass('data-checked:translate-x-[14px]')
    expect(thumb).not.toHaveAttribute('data-checked')

    rerender(<Switch checked={true} />)
    expect(switchElement).toHaveAttribute('data-checked', '')
    expect(thumb).toHaveAttribute('data-checked', '')
  })

  it('should expose disabled state styling hooks instead of relying on opacity', () => {
    const { rerender } = render(<Switch checked={false} disabled />)
    const switchElement = screen.getByRole('switch')

    expect(switchElement).toHaveClass(
      'data-disabled:bg-components-toggle-bg-unchecked-disabled',
      'data-disabled:data-checked:bg-components-toggle-bg-disabled',
    )
    expect(switchElement).toHaveAttribute('data-disabled', '')

    rerender(<Switch checked={true} disabled />)
    expect(switchElement).toHaveAttribute('data-disabled', '')
    expect(switchElement).toHaveAttribute('data-checked', '')
  })

  it('should have focus-visible ring-3 styles', () => {
    render(<Switch checked={false} />)
    const switchElement = screen.getByRole('switch')
    expect(switchElement).toHaveClass('focus-visible:ring-2')
  })

  it('should respect prefers-reduced-motion', () => {
    render(<Switch checked={false} />)
    const switchElement = screen.getByRole('switch')
    expect(switchElement).toHaveClass('motion-reduce:transition-none')
  })

  describe('loading state', () => {
    it('should render as disabled when loading', async () => {
      const onCheckedChange = vi.fn()
      const user = userEvent.setup()
      render(<Switch checked={false} loading onCheckedChange={onCheckedChange} />)

      const switchElement = screen.getByRole('switch')
      expect(switchElement).toHaveClass('data-disabled:cursor-not-allowed')
      expect(switchElement).toHaveAttribute('aria-busy', 'true')
      expect(switchElement).toHaveAttribute('data-disabled', '')

      await user.click(switchElement)
      expect(onCheckedChange).not.toHaveBeenCalled()
    })

    it('should show spinner icon for md and lg sizes', () => {
      const { rerender, container } = render(<Switch checked={false} loading size="md" />)
      expect(container.querySelector('span[aria-hidden="true"] i')).toBeInTheDocument()

      rerender(<Switch checked={false} loading size="lg" />)
      expect(container.querySelector('span[aria-hidden="true"] i')).toBeInTheDocument()
    })

    it('should not show spinner for xs and sm sizes', () => {
      const { rerender, container } = render(<Switch checked={false} loading size="xs" />)
      expect(container.querySelector('span[aria-hidden="true"] i')).not.toBeInTheDocument()

      rerender(<Switch checked={false} loading size="sm" />)
      expect(container.querySelector('span[aria-hidden="true"] i')).not.toBeInTheDocument()
    })

    it('should apply disabled data-state hooks when loading', () => {
      const { rerender } = render(<Switch checked={false} loading />)
      const switchElement = screen.getByRole('switch')

      expect(switchElement).toHaveAttribute('data-disabled', '')

      rerender(<Switch checked={true} loading />)
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
    expect(el).toHaveClass('h-2.5', 'w-3.5', 'rounded-xs')

    rerender(<SwitchSkeleton size="lg" data-testid="s" />)
    expect(el).toHaveClass('h-5', 'w-9', 'rounded-md')
  })

  it('should apply custom className to skeleton', () => {
    render(<SwitchSkeleton className="custom-class" data-testid="s" />)
    expect(screen.getByTestId('s')).toHaveClass('custom-class')
  })
})
