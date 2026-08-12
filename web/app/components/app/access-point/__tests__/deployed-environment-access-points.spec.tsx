import type { AccessPoint } from '@/app/components/app/deploy/access-point'
import { screen, within } from '@testing-library/react'
import { render } from '@/test/console/render'
import { DeployedEnvironmentAccessPoints } from '../deployed-environment-access-points'

const mocks = vi.hoisted(() => ({
  serviceApiCard: vi.fn(),
  webAppCard: vi.fn(),
}))

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return createReactI18nextMock()
})

vi.mock('../deployed-environment-access-points/environment-service-api-card', () => ({
  EnvironmentServiceApiCard: (props: Record<string, unknown>) => {
    mocks.serviceApiCard(props)
    return null
  },
}))

vi.mock('../deployed-environment-access-points/environment-web-app-card', () => ({
  EnvironmentWebAppCard: (props: Record<string, unknown>) => {
    mocks.webAppCard(props)
    return null
  },
}))

describe('DeployedEnvironmentAccessPoints', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each<AccessPoint>(['webApp', 'serviceApi'])(
    'highlights only the targeted %s card',
    (highlightedAccessPoint) => {
      render(
        <DeployedEnvironmentAccessPoints
          appId="app-1"
          environmentId="staging"
          canEdit
          canManage
          highlightedAccessPoint={highlightedAccessPoint}
        />,
      )

      expect(mocks.webAppCard).toHaveBeenCalledWith(
        expect.objectContaining({ highlighted: highlightedAccessPoint === 'webApp' }),
      )
      expect(mocks.serviceApiCard).toHaveBeenCalledWith(
        expect.objectContaining({ highlighted: highlightedAccessPoint === 'serviceApi' }),
      )
    },
  )

  it('renders MCP and Trigger as unsupported without a permanent loading state', () => {
    render(
      <DeployedEnvironmentAccessPoints appId="app-1" environmentId="staging" canEdit canManage />,
    )

    const mcpCard = screen.getByRole('region', { name: /mcp\.server\.title/ })
    const triggerCard = screen.getByRole('region', { name: /settings\.trigger/ })

    for (const card of [mcpCard, triggerCard]) {
      expect(
        within(card).getByText('deployments.studio.accessPoint.notSupported'),
      ).toBeInTheDocument()
      expect(
        within(card).getByText('deployments.studio.accessPoint.unsupportedInDeployedEnvironment'),
      ).toBeInTheDocument()
      expect(
        within(card).queryByText('deployments.health.ENVIRONMENT_STATUS_FAILED'),
      ).not.toBeInTheDocument()
      expect(card).not.toHaveAttribute('aria-busy')
      expect(card.querySelector('[aria-busy="true"]')).not.toBeInTheDocument()
    }
  })
})
