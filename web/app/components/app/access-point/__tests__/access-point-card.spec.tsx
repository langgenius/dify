import type { AccessPointStatus } from '@/app/components/base/access-point/status'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
    expect(screen.getByRole('heading', { name: 'Web App' })).toHaveAttribute('title', 'Web App')
    expect(screen.getByText('Web application access')).toHaveAttribute(
      'title',
      'Web application access',
    )
  })

  it.each<[AccessPointStatus, string, boolean]>([
    ['loading', 'common.loading', true],
    ['unsupported', 'deployments.studio.accessPoint.notSupported', false],
    ['unavailable', 'deployments.health.ENVIRONMENT_STATUS_FAILED', false],
  ])('renders the %s state independently', (status, label, isLoading) => {
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
    if (isLoading) expect(card).toHaveAttribute('aria-busy', 'true')
    else expect(card).not.toHaveAttribute('aria-busy')
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })

  it('keeps an unavailable switch focusable and explains why it is disabled', async () => {
    const user = userEvent.setup()
    const onEnabledChange = vi.fn()
    render(
      <AccessPointCard
        title="Web App"
        description="Web application access"
        icon="i-ri-robot-2-line"
        status="disabled"
        statusLabel="Disabled"
        switchDisabled
        switchDisabledReason="Publish first"
        switchLabel="Toggle Web App"
        onEnabledChange={onEnabledChange}
      >
        Access URL
      </AccessPointCard>,
    )

    const accessSwitch = screen.getByRole('switch', { name: 'Toggle Web App' })
    expect(accessSwitch).toHaveAttribute('aria-disabled', 'true')

    await user.tab()
    expect(accessSwitch).toHaveFocus()
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Publish first')

    await user.click(accessSwitch)
    expect(onEnabledChange).not.toHaveBeenCalled()
  })
})
