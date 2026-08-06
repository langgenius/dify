import { render } from 'vitest-browser-react'
import { StatusDot, StatusDotSkeleton } from '../index'

describe('StatusDot', () => {
  it('hides the visual indicator and its loading placeholder from assistive technology', async () => {
    const screen = await render(
      <>
        <StatusDot data-testid="dot" />
        <StatusDotSkeleton data-testid="skeleton" />
      </>,
    )

    await expect.element(screen.getByTestId('dot')).toHaveAttribute('aria-hidden', 'true')
    await expect.element(screen.getByTestId('skeleton')).toHaveAttribute('aria-hidden', 'true')
  })

  it('does not allow consumers to override the decorative contract', async () => {
    const screen = await render(
      <>
        {/* @ts-expect-error StatusDot is always decorative */}
        <StatusDot aria-hidden={false} data-testid="dot" />
        {/* @ts-expect-error Status semantics belong to the surrounding component */}
        <StatusDot aria-label="Active" data-testid="labelled-dot" />
        {/* @ts-expect-error StatusDotSkeleton is always decorative */}
        <StatusDotSkeleton aria-hidden={false} data-testid="skeleton" />
      </>,
    )

    await expect.element(screen.getByTestId('dot')).toHaveAttribute('aria-hidden', 'true')
    await expect.element(screen.getByTestId('labelled-dot')).toHaveAttribute('aria-hidden', 'true')
    await expect.element(screen.getByTestId('skeleton')).toHaveAttribute('aria-hidden', 'true')
  })
})
