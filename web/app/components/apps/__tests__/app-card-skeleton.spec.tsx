import { render } from '@testing-library/react'
import { AppCardSkeleton } from '../app-card-skeleton'

describe('AppCardSkeleton', () => {
  it('should render six skeleton cards by default', () => {
    const { container } = render(<AppCardSkeleton />)

    expect(container.childElementCount).toBe(6)
    expect(AppCardSkeleton.displayName).toBe('AppCardSkeleton')
  })

  it('should respect the custom skeleton count and card classes', () => {
    const { container } = render(<AppCardSkeleton count={2} />)

    expect(container.childElementCount).toBe(2)
    expect(container.firstElementChild).toHaveClass(
      'h-[160px]',
      'rounded-xl',
      'border-[0.5px]',
      'bg-components-card-bg',
      'p-4',
    )
  })
})
