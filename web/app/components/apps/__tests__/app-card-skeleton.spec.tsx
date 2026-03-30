import { render } from '@testing-library/react'

import { AppCardSkeleton } from '../app-card-skeleton'

describe('AppCardSkeleton', () => {
  it('should render six skeleton cards by default', () => {
    const { container } = render(<AppCardSkeleton />)

    expect(container.querySelectorAll('.bg-components-card-bg')).toHaveLength(6)
  })

  it('should render the configured number of skeleton cards', () => {
    const { container } = render(<AppCardSkeleton count={2} />)

    expect(container.querySelectorAll('.bg-components-card-bg')).toHaveLength(2)
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(10)
  })

  it('should render nothing when count is zero', () => {
    const { container } = render(<AppCardSkeleton count={0} />)

    expect(container.firstChild).toBeNull()
  })

  it('should expose a stable display name', () => {
    expect(AppCardSkeleton.displayName).toBe('AppCardSkeleton')
  })
})
