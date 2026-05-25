import { render } from 'vitest-browser-react'
import { StatusDot, StatusDotSkeleton } from '../index'

describe('StatusDot', () => {
  it('renders a medium success dot by default', async () => {
    const screen = await render(<StatusDot data-testid="dot" />)

    const root = screen.getByTestId('dot').element() as HTMLElement

    await expect.element(screen.getByTestId('dot')).toHaveAttribute('aria-hidden', 'true')
    expect(root.className).toContain('size-2')
    expect(root.className).toContain('bg-components-badge-status-light-success-bg')
    expect(root.className).toContain('border-components-badge-status-light-success-border-inner')
    expect(root.className).toContain('shadow-status-indicator-green-shadow')
  })

  it('uses small dot geometry', async () => {
    const screen = await render(<StatusDot size="small" data-testid="dot" />)

    const root = screen.getByTestId('dot').element() as HTMLElement

    expect(root.className).toContain('size-1.5')
    expect(root.className).toContain('rounded-xs')
  })

  it.each([
    ['warning', 'bg-components-badge-status-light-warning-bg', 'border-components-badge-status-light-warning-border-inner'],
    ['error', 'bg-components-badge-status-light-error-bg', 'border-components-badge-status-light-error-border-inner'],
    ['normal', 'bg-components-badge-status-light-normal-bg', 'border-components-badge-status-light-normal-border-inner'],
    ['disabled', 'bg-components-badge-status-light-disabled-bg', 'border-components-badge-status-light-disabled-border-inner'],
  ] as const)('applies %s status tokens', async (status, backgroundClass, borderClass) => {
    const screen = await render(<StatusDot status={status} data-testid="dot" />)

    const dot = screen.getByTestId('dot').element() as HTMLElement

    expect(dot.className).toContain(backgroundClass)
    expect(dot.className).toContain(borderClass)
  })

  it('keeps an explicit accessible label visible to assistive tech', async () => {
    const screen = await render(<StatusDot aria-label="Active" data-testid="dot" />)

    await expect.element(screen.getByTestId('dot')).toHaveAttribute('aria-label', 'Active')
    await expect.element(screen.getByTestId('dot')).not.toHaveAttribute('aria-hidden')
  })

  it('renders skeleton styling without status color', async () => {
    const screen = await render(<StatusDotSkeleton data-testid="dot" />)

    const dot = screen.getByTestId('dot').element() as HTMLElement

    expect(dot.className).toContain('bg-text-primary')
    expect(dot.className).toContain('opacity-30')
    expect(dot.className).not.toContain('bg-components-badge-status-light-success-bg')
    expect(dot.className).not.toContain('border-components-badge-status-light-success-border-inner')
  })
})
