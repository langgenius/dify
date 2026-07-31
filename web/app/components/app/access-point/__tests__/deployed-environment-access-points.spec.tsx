import type { AccessPoint } from '@/app/components/app/deploy/access-point'
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

vi.mock('../environment-service-api-card', () => ({
  EnvironmentServiceApiCard: (props: Record<string, unknown>) => {
    mocks.serviceApiCard(props)
    return <div data-testid="environment-service-api-card" />
  },
}))

vi.mock('../environment-web-app-card', () => ({
  EnvironmentWebAppCard: (props: Record<string, unknown>) => {
    mocks.webAppCard(props)
    return <div data-testid="environment-web-app-card" />
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
})
