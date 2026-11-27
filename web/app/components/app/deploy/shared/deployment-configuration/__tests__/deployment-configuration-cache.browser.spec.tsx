import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { apiError, setupFakeApi } from '@/test/fake-api'
import { DeploymentConfiguration } from '../index'

const APP_ID = 'app-1'
const ENVIRONMENT_ID = 'staging'
const WORKFLOW_ID = 'workflow-1'

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: {
        retry: false,
        staleTime: 5 * 60 * 1000,
      },
    },
  })
}

function ConfigurationSession() {
  const [open, setOpen] = useState(true)
  return open ? (
    <DeploymentConfiguration
      appId={APP_ID}
      embedded
      request={{
        environment: 'Staging',
        environmentId: ENVIRONMENT_ID,
        initialVersion: { id: WORKFLOW_ID, name: 'Release 1' },
        kind: 'deployLatest',
      }}
      version={{ id: WORKFLOW_ID, name: 'Release 1' }}
      onClose={() => setOpen(false)}
    />
  ) : (
    <button type="button" onClick={() => setOpen(true)}>
      Configure deployment
    </button>
  )
}

async function renderConfiguration() {
  const queryClient = createQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <ConfigurationSession />
    </QueryClientProvider>,
  )
}

const notDeployable = (message: string) =>
  apiError({
    status: 422,
    message,
    code: 'APPDEPLOY_WORKFLOW_NOT_DEPLOYABLE',
    details: { metadata: {}, reason: 'APPDEPLOY_WORKFLOW_NOT_DEPLOYABLE' },
  })

const fake = setupFakeApi({
  console: {
    enterprise: {
      appDeploy: {
        deploymentService: {
          precheckWorkflowDeployment: () => ({ unsupported_nodes: [] }),
          getWorkflowDeploymentOptions: () => ({
            credential_slots: [],
            environment_variable_groups: [],
          }),
        },
      },
    },
  },
})

beforeEach(async () => {
  await page.viewport(1000, 800)
})

describe('DeploymentConfiguration query freshness', () => {
  it('fetches precheck and deployment options again whenever the form is reopened', async () => {
    const { precheckWorkflowDeployment, getWorkflowDeploymentOptions } =
      fake.console.enterprise.appDeploy.deploymentService
    const optionsParams = {
      app_id: APP_ID,
      workflow_id: WORKFLOW_ID,
      environment_id: ENVIRONMENT_ID,
    }

    await renderConfiguration()
    const deploy = page.getByRole('button', { name: 'common.appMenus.deploy' })
    await expect.element(deploy).toBeEnabled()
    expect(precheckWorkflowDeployment.mock.calls).toEqual([
      [{ params: { app_id: APP_ID, workflow_id: WORKFLOW_ID } }],
    ])
    expect(getWorkflowDeploymentOptions.mock.calls).toEqual([[{ params: optionsParams }]])

    await page.getByRole('button', { name: 'common.operation.cancel' }).click()
    await expect
      .element(page.getByRole('heading', { name: 'deployments.studio.deployConfiguration' }))
      .not.toBeInTheDocument()
    await page.getByRole('button', { name: 'Configure deployment' }).click()

    await expect.element(deploy).toBeEnabled()
    await expect.poll(() => precheckWorkflowDeployment).toHaveBeenCalledTimes(2)
    await expect.poll(() => getWorkflowDeploymentOptions).toHaveBeenCalledTimes(2)
    expect(getWorkflowDeploymentOptions).toHaveBeenLastCalledWith({ params: optionsParams })
  })

  it('shows the backend message when precheck fails', async () => {
    fake.console.enterprise.appDeploy.deploymentService.precheckWorkflowDeployment.mockImplementation(
      () => {
        throw notDeployable('workflow tool dependencies form a cycle')
      },
    )

    await renderConfiguration()

    await expect
      .element(page.getByRole('alert').getByText('workflow tool dependencies form a cycle'))
      .toBeVisible()
  })

  it('shows the backend message when deployment options fail', async () => {
    fake.console.enterprise.appDeploy.deploymentService.getWorkflowDeploymentOptions.mockImplementation(
      () => {
        throw notDeployable('workflow deployment options are invalid')
      },
    )

    await renderConfiguration()

    await expect
      .element(page.getByRole('alert').getByText('workflow deployment options are invalid'))
      .toBeVisible()
  })
})
