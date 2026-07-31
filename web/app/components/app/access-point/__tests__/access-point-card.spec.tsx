import { screen } from '@testing-library/react'
import { render } from '@/test/console/render'
import { AccessPointCard } from '../access-point-card'

describe('AccessPointCard', () => {
  it('marks the card when it is the highlighted access point', () => {
    render(
      <AccessPointCard
        title="Web App"
        description="Web application access"
        icon="i-ri-robot-2-line"
        status="inService"
        statusLabel="In service"
        highlighted
      >
        Access URL
      </AccessPointCard>,
    )

    expect(screen.getByRole('article', { name: 'Web App' })).toHaveAttribute(
      'data-highlighted',
      'true',
    )
  })
})
