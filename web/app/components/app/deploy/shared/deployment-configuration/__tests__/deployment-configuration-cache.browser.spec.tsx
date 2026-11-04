import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
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

beforeEach(async () => {
  await page.viewport(1000, 800)
  onTestFinished(() => {
    vi.restoreAllMocks()
  })
})

describe('DeploymentConfiguration query freshness', () => {
  it('fetches precheck and deployment options again whenever the form is reopened', async () => {
    const requestCounts = {
      deploymentOptions: 0,
      precheck: 0,
    }
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const pathname = new URL(request.url).pathname

      if (
        pathname.endsWith(`/enterprise/app-deploy/apps/${APP_ID}/workflows/${WORKFLOW_ID}:precheck`)
      ) {
        requestCounts.precheck += 1
        return new Response(JSON.stringify({ unsupported_nodes: [] }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        })
      }

      if (
        pathname.endsWith(
          `/enterprise/app-deploy/apps/${APP_ID}/workflows/${WORKFLOW_ID}/environments/${ENVIRONMENT_ID}/deployment-options`,
        )
      ) {
        requestCounts.deploymentOptions += 1
        return new Response(
          JSON.stringify({ credential_slots: [], environment_variable_groups: [] }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
          },
        )
      }

      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })

    await renderConfiguration()
    const deploy = page.getByRole('button', { name: 'common.appMenus.deploy' })
    await expect.element(deploy).toBeEnabled()
    expect(requestCounts).toEqual({ deploymentOptions: 1, precheck: 1 })

    await page.getByRole('button', { name: 'common.operation.cancel' }).click()
    await expect
      .element(page.getByRole('heading', { name: 'deployments.studio.deployConfiguration' }))
      .not.toBeInTheDocument()
    await page.getByRole('button', { name: 'Configure deployment' }).click()

    await expect.element(deploy).toBeEnabled()
    await expect.poll(() => requestCounts).toEqual({ deploymentOptions: 2, precheck: 2 })
  })

  it('shows the backend message when precheck fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const pathname = new URL(request.url).pathname

      if (
        pathname.endsWith(`/enterprise/app-deploy/apps/${APP_ID}/workflows/${WORKFLOW_ID}:precheck`)
      ) {
        return new Response(
          JSON.stringify({
            code: 422,
            message: 'workflow tool dependencies form a cycle',
            metadata: {},
            reason: 'APPDEPLOY_WORKFLOW_NOT_DEPLOYABLE',
          }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 422,
          },
        )
      }

      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })

    await renderConfiguration()

    await expect
      .element(page.getByRole('alert').getByText('workflow tool dependencies form a cycle'))
      .toBeVisible()
  })

  it('shows the backend message when deployment options fail', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const pathname = new URL(request.url).pathname

      if (
        pathname.endsWith(`/enterprise/app-deploy/apps/${APP_ID}/workflows/${WORKFLOW_ID}:precheck`)
      ) {
        return new Response(JSON.stringify({ unsupported_nodes: [] }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        })
      }

      if (
        pathname.endsWith(
          `/enterprise/app-deploy/apps/${APP_ID}/workflows/${WORKFLOW_ID}/environments/${ENVIRONMENT_ID}/deployment-options`,
        )
      ) {
        return new Response(
          JSON.stringify({
            code: 422,
            message: 'workflow deployment options are invalid',
            metadata: {},
            reason: 'APPDEPLOY_WORKFLOW_NOT_DEPLOYABLE',
          }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 422,
          },
        )
      }

      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })

    await renderConfiguration()

    await expect
      .element(page.getByRole('alert').getByText('workflow deployment options are invalid'))
      .toBeVisible()
  })
})
