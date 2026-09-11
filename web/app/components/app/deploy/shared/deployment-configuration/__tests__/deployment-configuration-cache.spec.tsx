import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
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

function renderConfiguration(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
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
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  )
}

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

    const queryClient = createQueryClient()
    const firstRender = renderConfiguration(queryClient)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'common.appMenus.deploy' })).toBeEnabled()
    })
    expect(requestCounts).toEqual({ deploymentOptions: 1, precheck: 1 })

    firstRender.unmount()
    await waitFor(() => {
      expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
    })

    renderConfiguration(queryClient)

    await waitFor(() => {
      expect(requestCounts).toEqual({ deploymentOptions: 2, precheck: 2 })
      expect(screen.getByRole('button', { name: 'common.appMenus.deploy' })).toBeEnabled()
    })
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

    const view = renderConfiguration(createQueryClient())

    const alert = await within(view.container).findByRole('alert')
    expect(alert).toHaveTextContent('workflow tool dependencies form a cycle')
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

    const view = renderConfiguration(createQueryClient())

    const alert = await within(view.container).findByRole('alert')
    expect(alert).toHaveTextContent('workflow deployment options are invalid')
  })
})
