import type { AppEnvironment } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { EnvironmentStatus } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { seedCurrentWorkspaceQuery } from '@/test/console/current-workspace'
import { seedSystemFeatures } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { seedWorkspacePermissionsQuery } from '@/test/console/workspace-permissions'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { createTestQueryClient } from '@/test/query-client'
import { AppACLPermission } from '@/utils/permission'
import AccessPoint from '..'
import { seedAccessPointQueries } from './access-point-query-fixtures'

const builtInName = 'workflow.nodes.common.memories.builtIn'

async function renderAccessPoint(names = ['test-1']) {
  const queryClient = createTestQueryClient()
  seedAccountProfileQuery(queryClient)
  seedCurrentWorkspaceQuery(queryClient)
  seedSystemFeatures(queryClient)
  seedWorkspacePermissionsQuery(queryClient)
  queryClient.setQueryData(
    consoleQuery.apps.byAppId.get.queryKey({ input: { params: { app_id: 'app-1' } } }),
    createAppDetailFixture({
      id: 'app-1',
      mode: 'workflow',
      maintainer: 'user-2',
      permission_keys: [AppACLPermission.AccessPointView],
    }),
  )
  const environments: AppEnvironment[] = names.map((name, index) => ({
    id: `environment-${index}`,
    display_name: name,
    description: '',
    status: EnvironmentStatus.ENVIRONMENT_STATUS_READY,
    in_use: true,
  }))
  queryClient.setQueryData(
    consoleQuery.enterprise.appDeploy.deploymentService.listAppEnvironments.queryKey({
      input: { params: { app_id: 'app-1' } },
    }),
    { data: environments },
  )
  seedAccessPointQueries(
    queryClient,
    'app-1',
    environments.map(({ id }) => id),
  )
  const onUrlUpdate = vi.fn()
  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <NuqsTestingAdapter onUrlUpdate={onUrlUpdate}>
        <div style={{ width: 320, height: 480 }}>
          <AccessPoint appId="app-1" />
        </div>
      </NuqsTestingAdapter>
    </QueryClientTestProvider>,
  )
  return { screen, onUrlUpdate }
}

it('moves focus and activates the focused environment only with Enter', async () => {
  const { screen, onUrlUpdate } = await renderAccessPoint()
  const builtIn = screen.getByRole('tab', { name: builtInName })
  const deployed = screen.getByRole('tab', { name: 'test-1' })
  await userEvent.tab()
  await expect.element(builtIn).toHaveFocus()

  await userEvent.keyboard('{ArrowRight}')
  await expect.element(deployed).toHaveFocus()
  await expect.element(builtIn).toHaveAttribute('aria-selected', 'true')
  await expect.element(deployed).toHaveAttribute('aria-selected', 'false')
  expect(onUrlUpdate).not.toHaveBeenCalled()

  await userEvent.keyboard('{ArrowLeft}')
  await expect.element(builtIn).toHaveFocus()
  await userEvent.keyboard('{ArrowRight}')
  await expect.element(deployed).toHaveFocus()
  expect(onUrlUpdate).not.toHaveBeenCalled()

  await userEvent.keyboard('{Enter}')
  await expect.element(deployed).toHaveAttribute('aria-selected', 'true')
  await expect
    .element(
      screen.getByRole('heading', { name: 'agentV2.agentDetail.access.webApp.title', level: 2 }),
    )
    .toBeVisible()
  await expect
    .element(
      screen.getByText('deployments.studio.accessPoint.unsupportedInDeployedEnvironment').nth(0),
    )
    .toBeVisible()
  expect(onUrlUpdate).toHaveBeenCalledWith(
    expect.objectContaining({ queryString: '?environment=environment-0' }),
  )
})

it('focuses the first and last tabs with Home and End without activating them', async () => {
  await page.viewport(320, 640)
  const { screen, onUrlUpdate } = await renderAccessPoint([
    'Staging',
    'Canary',
    'Production with long name',
  ])
  await userEvent.tab()
  await userEvent.keyboard('{End}')
  const lastTab = screen.getByRole('tab', { name: 'Production with long name' })
  await expect.element(lastTab).toHaveFocus()
  await expect.element(lastTab).toHaveAttribute('aria-selected', 'false')
  expect(onUrlUpdate).not.toHaveBeenCalled()

  await userEvent.keyboard('{Home}')
  const firstTab = screen.getByRole('tab', { name: builtInName })
  await expect.element(firstTab).toHaveFocus()
  expect(onUrlUpdate).not.toHaveBeenCalled()
})
