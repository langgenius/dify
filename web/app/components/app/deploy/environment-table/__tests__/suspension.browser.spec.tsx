import type { EnvironmentDeployment } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { EnvironmentStatus, RuntimeState } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import deployments from '@/i18n/locales/en-US/deployments.json'
import workflowHistory from '@/i18n/locales/en-US/workflow-history.json'
import workflow from '@/i18n/locales/en-US/workflow.json'
import { consoleQuery } from '@/service/console'
import { SuspensionNotice } from '../../shared/suspension-notice'
import { EnvironmentRow } from '../row'

vi.unmock('react-i18next')

it('shows pause provenance and allows resuming a failed initial deployment', async () => {
  await page.viewport(1440, 900)
  const requests: Request[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    requests.push(input instanceof Request ? input : new Request(input, init))
    return new Response('{}', { headers: { 'Content-Type': 'application/json' } })
  })
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { deployments, workflow, workflowHistory } },
    keySeparator: false,
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const row: EnvironmentDeployment = {
    deployment_id: 'deployment',
    environment: {
      id: 'production',
      display_name: 'Production',
      description: '',
      status: EnvironmentStatus.ENVIRONMENT_STATUS_READY,
    },
    access: { enable_api: true, enable_site: true },
    deployment: {
      runtimeState: RuntimeState.RUNTIME_STATE_RUNNING,
      current_version: { id: 'release', marked_name: 'Release 2', version: '2' },
      suspended_at: 1800000000,
      suspended_by: { id: 'admin', display_name: 'Minco', type: 'OPERATOR_TYPE_ACCOUNT' },
    },
  }
  const content = (value: EnvironmentDeployment) => (
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <table className="w-full min-w-260 table-fixed">
          <tbody>
            <EnvironmentRow
              appId="app"
              canViewAccessPoint={false}
              row={value}
              onOpenDeployment={() => {}}
              onOpenUndeploy={() => {}}
            />
          </tbody>
        </table>
      </I18nextProvider>
    </QueryClientProvider>
  )
  const screen = await render(content(row))
  await expect.element(page.getByRole('button', { name: 'Resume', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Paused', exact: true }).click()
  await expect.element(page.getByText(/Paused by Minco ·/)).toBeVisible()
  await page.getByRole('button', { name: 'Paused', exact: true }).click()
  await screen.rerender(
    content({
      ...row,
      deployment: {
        suspended_at: row.deployment!.suspended_at,
        suspended_by: {
          id: 'admin',
          display_name: 'Minco',
          type: 'OPERATOR_TYPE_DASHBOARD_ACCOUNT',
        },
        runtimeState: RuntimeState.RUNTIME_STATE_UNDEPLOYED,
        latest_operation: {
          id: 'failed-deploy',
          type: 'DEPLOYMENT_OPERATION_TYPE_DEPLOY',
          status: 'DEPLOYMENT_OPERATION_STATUS_FAILED',
          target_version: { id: 'release', marked_name: 'Release 2', version: '2' },
          operator: { id: 'deployer', display_name: 'Deployer', type: 'OPERATOR_TYPE_ACCOUNT' },
          activity_at: 1800000001,
        },
      },
    }),
  )
  await page.getByRole('button', { name: 'Paused', exact: true }).click()
  await expect.element(page.getByText(/Paused from Admin Dashboard ·/)).toBeVisible()
  await page.getByRole('button', { name: 'Paused', exact: true }).click()
  await expect.element(page.getByRole('button', { name: 'Resume', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Resume', exact: true }).click()
  await vi.waitFor(() => expect(requests).toHaveLength(1))
  expect(requests[0]!.method).toBe('POST')
  expect(new URL(requests[0]!.url).pathname).toBe(
    '/console/api/enterprise/app-deploy/apps/app/workflows/release/environments/production/deployment:resume',
  )
})

it('explains paused access without blocking existing requests and links to Deploy', async () => {
  const i18n = createInstance()
  await i18n.init({ lng: 'en-US', resources: { 'en-US': { deployments } }, keySeparator: false })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(
    consoleQuery.enterprise.appDeploy.deploymentService.listAppEnvironments.queryKey({
      input: { params: { app_id: 'app' } },
    }),
    {
      data: [
        {
          id: 'production',
          display_name: 'Production',
          description: '',
          status: EnvironmentStatus.ENVIRONMENT_STATUS_READY,
          in_use: true,
          suspended_at: 1800000000,
        },
      ],
    },
  )
  const content = (accessPoint: boolean, canDeploy = true) => (
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <SuspensionNotice
          appId="app"
          environmentId="production"
          accessPoint={accessPoint}
          canDeploy={canDeploy}
        />
      </I18nextProvider>
    </QueryClientProvider>
  )
  const screen = await render(content(true))
  await expect.element(page.getByText('This environment is paused')).toBeVisible()
  await expect
    .element(
      page.getByText(/New runs are paused. Existing runs and other requests remain available/),
    )
    .toBeVisible()
  await expect
    .element(page.getByRole('link', { name: 'Go to Deploy' }))
    .toHaveAttribute('href', '/app/app/deploy')
  await screen.rerender(content(false))
  await expect.element(page.getByText("Deploying won't resume the service.")).toBeVisible()
  await screen.rerender(content(true, false))
  await expect.element(page.getByText('This environment is paused')).toBeVisible()
  await expect.element(page.getByRole('link', { name: 'Go to Deploy' })).not.toBeInTheDocument()
})
