import { screen, within } from '@testing-library/react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { consoleQuery } from '@/service/console'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createAppDetailFixture, createAppSiteFixture } from '@/test/fixtures/app'
import { createTestQueryClient } from '@/test/query-client'
import { DeployedEnvironmentAccessPoints } from '../deployed-environment-access-points'
import { seedAccessPointQueries } from './access-point-query-fixtures'

function render(ui: React.ReactElement) {
  const queryClient = createTestQueryClient()
  seedAccessPointQueries(queryClient, 'app-1', ['staging'])
  queryClient.setQueryData(
    consoleQuery.apps.byAppId.get.queryKey({ input: { params: { app_id: 'app-1' } } }),
    createAppDetailFixture({ id: 'app-1', mode: 'workflow', site: createAppSiteFixture() }),
  )
  return renderWithConsoleQuery(<NuqsTestingAdapter>{ui}</NuqsTestingAdapter>, { queryClient })
}

describe('DeployedEnvironmentAccessPoints', () => {
  it('renders MCP and Trigger as unsupported without a permanent loading state', () => {
    render(
      <DeployedEnvironmentAccessPoints
        appId="app-1"
        environmentId="staging"
        canManageAccessPoint
      />,
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

  it.each([false, true])(
    'enforces management permission %s on deployed environment controls',
    (canManageAccessPoint) => {
      render(
        <DeployedEnvironmentAccessPoints
          appId="app-1"
          environmentId="staging"
          canManageAccessPoint={canManageAccessPoint}
        />,
      )

      for (const control of screen.getAllByRole('switch')) {
        expect(control).toBeChecked()
        if (canManageAccessPoint) expect(control).not.toHaveAttribute('aria-disabled', 'true')
        else expect(control).toHaveAttribute('aria-disabled', 'true')
      }
      expect(screen.getByText('https://staging.api.example.com/v1')).toBeInTheDocument()
      const settings = screen.getByRole('button', { name: 'navigation.settings.settings' })
      if (canManageAccessPoint) expect(settings).toBeEnabled()
      else expect(settings).toBeDisabled()
    },
  )
})
