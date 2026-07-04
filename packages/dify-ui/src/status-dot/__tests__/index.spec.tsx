import { render } from 'vitest-browser-react'
import { StatusDot, StatusDotSkeleton } from '../index'

describe('StatusDot', () => {
  it('is hidden from assistive tech by default', async () => {
    const screen = await render(<StatusDot data-testid="dot" />)

    await expect.element(screen.getByTestId('dot')).toHaveAttribute('aria-hidden', 'true')
  })

  it('keeps an explicit accessible label visible to assistive tech', async () => {
    const screen = await render(<StatusDot aria-label="Active" data-testid="dot" />)

    await expect.element(screen.getByTestId('dot')).toHaveAttribute('aria-label', 'Active')
    await expect.element(screen.getByTestId('dot')).not.toHaveAttribute('aria-hidden')
  })

  it('renders the skeleton placeholder', async () => {
    const screen = await render(<StatusDotSkeleton data-testid="dot" />)

    await expect.element(screen.getByTestId('dot')).toBeInTheDocument()
  })
})
