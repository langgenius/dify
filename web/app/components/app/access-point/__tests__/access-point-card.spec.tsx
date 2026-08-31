import type { AccessPointStatus } from '../shared/access-point-status'
import { screen } from '@testing-library/react'
import { render } from '@/test/console/render'
import { AccessPointCard } from '../shared/access-point-card'

describe('AccessPointCard', () => {
  it('marks the card when it is the highlighted access point', () => {
    render(
      <AccessPointCard
        title="Web App"
        description="Web application access"
        icon="i-ri-robot-2-line"
        status="inService"
        highlighted
      >
        Access URL
      </AccessPointCard>,
    )

    expect(screen.getByRole('region', { name: 'Web App' })).toHaveAttribute(
      'data-highlighted',
      'true',
    )
  })

  it.each<[AccessPointStatus, string, boolean]>([
    ['loading', 'common.loading', true],
    ['unsupported', 'deployments.studio.accessPoint.notSupported', false],
    ['unavailable', 'deployments.health.ENVIRONMENT_STATUS_FAILED', false],
  ])('renders the %s state independently', (status, label, busy) => {
    render(
      <AccessPointCard
        title="Web App"
        description="Web application access"
        icon="i-ri-robot-2-line"
        status={status}
        onEnabledChange={vi.fn()}
      >
        Access URL
      </AccessPointCard>,
    )

    expect(screen.getByText(label)).toBeInTheDocument()
    const card = screen.getByRole('region', { name: 'Web App' })
    if (busy) expect(card).toHaveAttribute('aria-busy', 'true')
    else expect(card).not.toHaveAttribute('aria-busy')
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })
})
