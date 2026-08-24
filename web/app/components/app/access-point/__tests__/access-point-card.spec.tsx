import type { AccessPointStatus } from '@/app/components/base/access-point/status'
import { screen } from '@testing-library/react'
import { AccessPointCard } from '@/app/components/base/access-point/card'
import { render } from '@/test/console/render'

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
        statusLabel={label}
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
