import { render } from 'vitest-browser-react'
import { Switch, SwitchSkeleton } from '../index'

const asHTMLElement = (element: HTMLElement | SVGElement) => element as HTMLElement
const getThumb = (switchElement: HTMLElement | SVGElement) => switchElement.querySelector('span')

describe('Switch', () => {
  it('should render in unchecked state when checked is false', async () => {
    const screen = await render(<Switch checked={false} />)
    const switchElement = screen.getByRole('switch')

    await expect.element(switchElement).toBeInTheDocument()
    await expect.element(switchElement).toHaveAttribute('aria-checked', 'false')
    await expect.element(switchElement).not.toHaveAttribute('data-checked')
  })

  it('should render in checked state when checked is true', async () => {
    const screen = await render(<Switch checked={true} />)
    const switchElement = screen.getByRole('switch')

    await expect.element(switchElement).toHaveAttribute('aria-checked', 'true')
    await expect.element(switchElement).toHaveAttribute('data-checked', '')
  })

  it('should call onCheckedChange with next value when clicked', async () => {
    const onCheckedChange = vi.fn()
    const screen = await render(<Switch checked={false} onCheckedChange={onCheckedChange} />)

    const switchElement = screen.getByRole('switch')
    asHTMLElement(switchElement.element()).click()

    expect(onCheckedChange).toHaveBeenCalledWith(true)
    expect(onCheckedChange).toHaveBeenCalledTimes(1)
    await expect.element(switchElement).toHaveAttribute('aria-checked', 'false')
  })

  it('should work in controlled mode with checked prop', async () => {
    const onCheckedChange = vi.fn()
    const screen = await render(<Switch checked={false} onCheckedChange={onCheckedChange} />)
    const switchElement = screen.getByRole('switch')

    await expect.element(switchElement).toHaveAttribute('aria-checked', 'false')

    asHTMLElement(switchElement.element()).click()
    expect(onCheckedChange).toHaveBeenCalledWith(true)
    await expect.element(switchElement).toHaveAttribute('aria-checked', 'false')

    await screen.rerender(<Switch checked={true} onCheckedChange={onCheckedChange} />)
    await expect.element(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
  })

  it('should not call onCheckedChange when disabled', async () => {
    const onCheckedChange = vi.fn()
    const screen = await render(<Switch checked={false} disabled onCheckedChange={onCheckedChange} />)

    const switchElement = screen.getByRole('switch')
    await expect.element(switchElement).toHaveClass('data-disabled:cursor-not-allowed')
    await expect.element(switchElement).toHaveAttribute('data-disabled', '')

    asHTMLElement(switchElement.element()).click()
    expect(onCheckedChange).not.toHaveBeenCalled()
  })

  it('should apply correct size classes', async () => {
    const screen = await render(<Switch checked={false} size="xs" />)

    await expect.element(screen.getByRole('switch')).toHaveClass('h-2.5', 'w-3.5', 'rounded-xs')

    await screen.rerender(<Switch checked={false} size="sm" />)
    await expect.element(screen.getByRole('switch')).toHaveClass('h-3', 'w-5')

    await screen.rerender(<Switch checked={false} size="md" />)
    await expect.element(screen.getByRole('switch')).toHaveClass('h-4', 'w-7')

    await screen.rerender(<Switch checked={false} size="lg" />)
    await expect.element(screen.getByRole('switch')).toHaveClass('h-5', 'w-9')
  })

  it('should apply custom className', async () => {
    const screen = await render(<Switch checked={false} className="custom-test-class" />)
    await expect.element(screen.getByRole('switch')).toHaveClass('custom-test-class')
  })

  it('should expose checked state styling hooks on the root and thumb', async () => {
    const screen = await render(<Switch checked={false} />)
    const switchElement = screen.getByRole('switch').element()
    const thumb = getThumb(switchElement)

    expect(switchElement).toHaveClass('bg-components-toggle-bg-unchecked', 'data-checked:bg-components-toggle-bg')
    expect(thumb).toHaveClass('data-checked:translate-x-[14px]')
    expect(thumb).not.toHaveAttribute('data-checked')

    await screen.rerender(<Switch checked={true} />)

    await expect.element(screen.getByRole('switch')).toHaveAttribute('data-checked', '')
    expect(getThumb(screen.getByRole('switch').element())).toHaveAttribute('data-checked', '')
  })

  it('should expose disabled state styling hooks instead of relying on opacity', async () => {
    const screen = await render(<Switch checked={false} disabled />)

    await expect.element(screen.getByRole('switch')).toHaveClass(
      'data-disabled:bg-components-toggle-bg-unchecked-disabled',
      'data-disabled:data-checked:bg-components-toggle-bg-disabled',
    )
    await expect.element(screen.getByRole('switch')).toHaveAttribute('data-disabled', '')

    await screen.rerender(<Switch checked={true} disabled />)
    await expect.element(screen.getByRole('switch')).toHaveAttribute('data-disabled', '')
    await expect.element(screen.getByRole('switch')).toHaveAttribute('data-checked', '')
  })

  it('should have focus-visible ring-3 styles', async () => {
    const screen = await render(<Switch checked={false} />)
    await expect.element(screen.getByRole('switch')).toHaveClass('focus-visible:ring-2')
  })

  it('should respect prefers-reduced-motion', async () => {
    const screen = await render(<Switch checked={false} />)
    await expect.element(screen.getByRole('switch')).toHaveClass('motion-reduce:transition-none')
  })

  describe('loading state', () => {
    it('should render as disabled when loading', async () => {
      const onCheckedChange = vi.fn()
      const screen = await render(<Switch checked={false} loading onCheckedChange={onCheckedChange} />)

      const switchElement = screen.getByRole('switch')
      await expect.element(switchElement).toHaveClass('data-disabled:cursor-not-allowed')
      await expect.element(switchElement).toHaveAttribute('aria-busy', 'true')
      await expect.element(switchElement).toHaveAttribute('data-disabled', '')

      asHTMLElement(switchElement.element()).click()
      expect(onCheckedChange).not.toHaveBeenCalled()
    })

    it('should show spinner icon for md and lg sizes', async () => {
      const screen = await render(<Switch checked={false} loading size="md" />)
      expect(screen.container.querySelector('span[aria-hidden="true"] i')).toBeInTheDocument()

      await screen.rerender(<Switch checked={false} loading size="lg" />)
      expect(screen.container.querySelector('span[aria-hidden="true"] i')).toBeInTheDocument()
    })

    it('should not show spinner for xs and sm sizes', async () => {
      const screen = await render(<Switch checked={false} loading size="xs" />)
      expect(screen.container.querySelector('span[aria-hidden="true"] i')).not.toBeInTheDocument()

      await screen.rerender(<Switch checked={false} loading size="sm" />)
      expect(screen.container.querySelector('span[aria-hidden="true"] i')).not.toBeInTheDocument()
    })

    it('should apply disabled data-state hooks when loading', async () => {
      const screen = await render(<Switch checked={false} loading />)

      await expect.element(screen.getByRole('switch')).toHaveAttribute('data-disabled', '')

      await screen.rerender(<Switch checked={true} loading />)
      await expect.element(screen.getByRole('switch')).toHaveAttribute('data-disabled', '')
      await expect.element(screen.getByRole('switch')).toHaveAttribute('data-checked', '')
    })
  })
})

describe('SwitchSkeleton', () => {
  it('should render a plain div without switch role', async () => {
    const screen = await render(<SwitchSkeleton data-testid="skeleton-switch" />)
    expect(screen.container.querySelector('[role="switch"]')).not.toBeInTheDocument()
    await expect.element(screen.getByTestId('skeleton-switch')).toBeInTheDocument()
  })

  it('should apply skeleton styles', async () => {
    const screen = await render(<SwitchSkeleton data-testid="skeleton-switch" />)
    await expect.element(screen.getByTestId('skeleton-switch')).toHaveClass('bg-text-quaternary', 'opacity-20')
  })

  it('should apply correct skeleton size classes', async () => {
    const screen = await render(<SwitchSkeleton size="xs" data-testid="s" />)
    await expect.element(screen.getByTestId('s')).toHaveClass('h-2.5', 'w-3.5', 'rounded-xs')

    await screen.rerender(<SwitchSkeleton size="lg" data-testid="s" />)
    await expect.element(screen.getByTestId('s')).toHaveClass('h-5', 'w-9', 'rounded-md')
  })

  it('should apply custom className to skeleton', async () => {
    const screen = await render(<SwitchSkeleton className="custom-class" data-testid="s" />)
    await expect.element(screen.getByTestId('s')).toHaveClass('custom-class')
  })
})
