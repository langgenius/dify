import type { WorkflowResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { EnvironmentDeployment } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { QueryClient } from '@tanstack/react-query'
import {
  DeploymentOperationStatus,
  DeploymentOperationType,
  DeploymentStatus,
  EnvironmentStatus,
  EnvVarValueType,
  OperatorType,
} from '@dify/contracts/enterprise-app-deploy/types.gen'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider, useAtomValue, useSetAtom } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { useEffect } from 'react'
import { consoleQuery } from '@/service/client'
import {
  createConsoleQueryClient,
  renderWithConsoleQuery as render,
} from '@/test/console/query-data'
import { PublisherEnvironmentFlow } from '../environment-deployment-flow'
import { useRefreshAppEnvironmentsAfterPublisherDeploymentPolling } from '../hooks/use-refresh-app-environments-after-deployment-polling'
import {
  appPublisherEnvironmentsAtom,
  appPublisherOpenAtom,
  AppPublisherStateBoundary,
  publisherEnvironmentDeploymentPollingAtom,
  selectedPublisherEnvironmentIdAtom,
} from '../state'

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return createReactI18nextMock({
    'common.appMenus.accessPoint': 'Access Point',
    'common.appMenus.deploy': 'Deploy',
    'common.operation.back': 'Back',
    'common.operation.cancel': 'Cancel',
    'deployments.overview.chip.latest': 'Latest',
    'deployments.deployDrawer.deploying': 'Deploying...',
    'deployments.deployDrawer.envVars': 'Environment Variables',
    'deployments.deployDrawer.runtimeCredentials': 'Credentials',
    'deployments.studio.accessPoint.goToPublish': 'Go to publish',
    'deployments.studio.allVersions': 'All versions',
    'deployments.studio.chooseVersionToDeploy': 'Choose a version to deploy',
    'deployments.studio.current': 'Current',
    'deployments.studio.deployAnotherVersion': 'Deploy another version',
    'deployments.studio.deployConfiguration': 'Deploy configuration',
    'deployments.studio.deployLatest': 'Deploy latest',
    'deployments.studio.precheck.description': 'It contains node types that are not yet supported:',
    'deployments.studio.precheck.supportMessage':
      'Support for these node types is coming in a future release.',
    'deployments.studio.precheck.title': "This version can't be deployed to this environment",
    'deployments.studio.accessPoint.noPublishedTitle': 'No published versions yet',
    'deployments.studio.publisher.noPublishedDescription':
      'Publish the app before deploying it to an environment.',
    'deployments.studio.publisher.deployingVersion': 'Deploying: {{version}}',
    'deployments.studio.publisher.notDeployedYet': 'Not deployed yet',
    'deployments.versions.deployTo': 'Deploy to {{name}}',
    'workflow.common.publishedBy': 'Published {{time}} by {{author}}',
  })
})

vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({
    formatTimeFromNow: (time: number) => `relative:${time}`,
  }),
}))

vi.mock('@/service/use-tools', () => ({
  useAllBuiltInTools: () => ({ data: [] }),
  useAllCustomTools: () => ({ data: [] }),
  useAllMCPTools: () => ({ data: [] }),
  useAllWorkflowTools: () => ({ data: [] }),
}))

function publishedWorkflowVersion({
  id,
  name,
  publishedBy = 'Alice',
}: {
  id: string
  name: string
  publishedBy?: string
}): WorkflowResponse {
  return {
    conversation_variables: [],
    created_at: 1_710_000_100,
    created_by: {
      email: `${publishedBy.toLowerCase()}@example.com`,
      id: `user-${publishedBy.toLowerCase()}`,
      name: publishedBy,
    },
    environment_variables: [],
    features: {},
    graph: {},
    hash: `hash-${id}`,
    id,
    marked_comment: `${name} notes`,
    marked_name: name,
    rag_pipeline_variables: [],
    tool_published: false,
    updated_at: 1_710_000_100,
    version: `2026-07-30.${id}`,
  }
}

const PUBLISHED_WORKFLOW_VERSIONS = [
  publishedWorkflowVersion({
    id: 'workflow-version-7',
    name: 'Release 7',
  }),
  publishedWorkflowVersion({
    id: 'workflow-version-6',
    name: 'Release 6',
    publishedBy: 'Carol',
  }),
  publishedWorkflowVersion({
    id: 'sprint-42',
    name: 'Sprint-42',
    publishedBy: 'Evan',
  }),
  publishedWorkflowVersion({
    id: 'sprint-35',
    name: 'Sprint-35',
    publishedBy: 'Evan',
  }),
]

const latestPublishedWorkflow = PUBLISHED_WORKFLOW_VERSIONS[0]!
const latestVersion = {
  description: latestPublishedWorkflow.marked_comment || undefined,
  id: latestPublishedWorkflow.id,
  latest: true,
  name: latestPublishedWorkflow.marked_name || latestPublishedWorkflow.version,
  publishedAt: latestPublishedWorkflow.created_at * 1000,
  publishedBy: latestPublishedWorkflow.created_by?.name,
}

function createDeployment({
  deployed = true,
  latest = false,
  status = DeploymentStatus.DEPLOYMENT_STATUS_RUNNING,
}: {
  deployed?: boolean
  latest?: boolean
  status?: NonNullable<EnvironmentDeployment['deployment']>['status']
} = {}): EnvironmentDeployment {
  const currentVersion = latest
    ? {
        id: latestVersion.id,
        marked_comment: latestVersion.description ?? '',
        marked_name: latestVersion.name,
        version: latestVersion.name,
      }
    : {
        id: 'sprint-42',
        marked_comment: '',
        marked_name: 'Sprint-42',
        version: 'Sprint-42',
      }

  return {
    access: {
      enable_api: true,
      enable_site: true,
    },
    deployment: {
      current_version: deployed ? currentVersion : undefined,
      deployed_at: Math.floor(Date.now() / 1000),
      deployed_by: {
        display_name: 'Evan',
        id: 'user-1',
        type: OperatorType.OPERATOR_TYPE_ACCOUNT,
      },
      status,
      versions_behind: latest ? 0 : 1,
    },
    environment: {
      description: '',
      display_name: 'Staging',
      id: 'staging',
      status: EnvironmentStatus.ENVIRONMENT_STATUS_READY,
    },
  }
}

function createFlowQueryClient(environmentId: string, environmentInUse = false) {
  const queryClient = createConsoleQueryClient()
  PUBLISHED_WORKFLOW_VERSIONS.forEach((workflow) => {
    const precheckQuery =
      consoleQuery.enterprise.appDeploy.deploymentService.precheckWorkflowDeployment.queryOptions({
        input: {
          params: {
            app_id: 'app-1',
            workflow_id: workflow.id,
          },
        },
        retry: false,
      })
    const deploymentOptionsQuery =
      consoleQuery.enterprise.appDeploy.deploymentService.getWorkflowDeploymentOptions.queryOptions(
        {
          input: {
            params: {
              app_id: 'app-1',
              environment_id: environmentId,
              workflow_id: workflow.id,
            },
          },
          retry: false,
        },
      )

    queryClient.setQueryDefaults(precheckQuery.queryKey, { staleTime: Infinity })
    queryClient.setQueryData(precheckQuery.queryKey, {
      unsupported_nodes: [],
    })
    queryClient.setQueryDefaults(deploymentOptionsQuery.queryKey, { staleTime: Infinity })
    queryClient.setQueryData(deploymentOptionsQuery.queryKey, {
      credential_slots: [],
      environment_variable_slots: [],
    })
  })

  seedPublishedWorkflowQueries(queryClient)
  const appEnvironmentsQuery =
    consoleQuery.enterprise.appDeploy.deploymentService.listAppEnvironments.queryOptions({
      enabled: true,
      input: {
        params: {
          app_id: 'app-1',
        },
      },
    })
  queryClient.setQueryData(appEnvironmentsQuery.queryKey, {
    data: [
      {
        description: '',
        display_name: 'Staging',
        id: 'staging',
        in_use: environmentInUse,
        status: EnvironmentStatus.ENVIRONMENT_STATUS_READY,
      },
    ],
  })

  return queryClient
}

function seedPublishedWorkflowQueries(queryClient: QueryClient) {
  const latestPublishedWorkflowQuery = consoleQuery.apps.byAppId.workflows.publish.get.queryOptions(
    {
      input: {
        params: {
          app_id: 'app-1',
        },
      },
    },
  )
  const workflowVersionsQuery = consoleQuery.apps.byAppId.workflows.get.infiniteOptions({
    input: (pageParam) => ({
      params: {
        app_id: 'app-1',
      },
      query: {
        limit: 10,
        page: Number(pageParam),
      },
    }),
    getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.page + 1 : undefined),
    initialPageParam: 1,
  })

  queryClient.setQueryData(latestPublishedWorkflowQuery.queryKey, latestPublishedWorkflow)
  queryClient.setQueryData(workflowVersionsQuery.queryKey, {
    pageParams: [1],
    pages: [
      {
        has_more: false,
        items: PUBLISHED_WORKFLOW_VERSIONS,
        limit: 10,
        page: 1,
      },
    ],
  })
}

function renderFlow(
  deployment = createDeployment(),
  { isDeploymentError = false }: { isDeploymentError?: boolean } = {},
) {
  const queryClient = createFlowQueryClient(deployment.environment.id)

  return render(
    <PublisherEnvironmentFlow
      appId="app-1"
      deployment={deployment}
      environmentId={deployment.environment.id}
      environmentName={deployment.environment.display_name}
      environmentTabs={<div>Environment tabs</div>}
      isEnvironmentInUse
      isDeploymentError={isDeploymentError}
      isDeploymentLoading={false}
      latestVersion={latestVersion}
      onGoToPublish={vi.fn()}
    />,
    { queryClient },
  )
}

function PublisherPollingObserver() {
  useRefreshAppEnvironmentsAfterPublisherDeploymentPolling('app-1')
  useAtomValue(appPublisherEnvironmentsAtom)
  const polling = useAtomValue(publisherEnvironmentDeploymentPollingAtom)
  const selectEnvironment = useSetAtom(selectedPublisherEnvironmentIdAtom)

  useEffect(() => {
    selectEnvironment('staging')
  }, [selectEnvironment])

  return <div>{`Polling: ${polling?.operationId ?? 'none'}`}</div>
}

function renderFlowWithPolling(deployment = createDeployment()) {
  const queryClient = createFlowQueryClient(deployment.environment.id, true)
  const store = createStore()
  store.set(queryClientAtom, queryClient)
  store.set(appPublisherOpenAtom, true)

  return render(
    <Provider store={store}>
      <AppPublisherStateBoundary appId="app-1" environmentQueryEnabled>
        <PublisherPollingObserver />
        <PublisherEnvironmentFlow
          appId="app-1"
          deployment={deployment}
          environmentId={deployment.environment.id}
          environmentName={deployment.environment.display_name}
          environmentTabs={<div>Environment tabs</div>}
          isEnvironmentInUse
          isDeploymentError={false}
          isDeploymentLoading={false}
          latestVersion={latestVersion}
          onGoToPublish={vi.fn()}
        />
      </AppPublisherStateBoundary>
    </Provider>,
    { queryClient },
  )
}

function captureDeploymentRequests() {
  const requests: Request[] = []
  let deploymentSubmitted = false

  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init)
    requests.push(request.clone())

    if (request.url.includes('/deployment:deploy')) {
      deploymentSubmitted = true
      return new Response(
        JSON.stringify({
          operation: {
            id: 'operation-staging',
            status: DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_IN_PROGRESS,
            type: DeploymentOperationType.DEPLOYMENT_OPERATION_TYPE_DEPLOY,
          },
        }),
        {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        },
      )
    }

    if (request.url.includes('/workflows/environment-deployments/staging')) {
      const currentDeployment = createDeployment({ latest: deploymentSubmitted })
      return new Response(
        JSON.stringify({
          environment_deployment: {
            ...currentDeployment,
            deployment: {
              ...currentDeployment.deployment,
              ...(deploymentSubmitted && {
                latest_operation: {
                  activity_at: 1_785_456_000,
                  id: 'operation-staging',
                  operator: {
                    display_name: 'Evan',
                    id: 'user-1',
                    type: OperatorType.OPERATOR_TYPE_ACCOUNT,
                  },
                  status: DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_SUCCEEDED,
                  target_version: {
                    id: latestVersion.id,
                    marked_comment: latestVersion.description ?? '',
                    marked_name: latestVersion.name,
                    version: latestVersion.name,
                  },
                  type: DeploymentOperationType.DEPLOYMENT_OPERATION_TYPE_DEPLOY,
                },
              }),
            },
          },
        }),
        {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        },
      )
    }

    if (new URL(request.url).pathname.endsWith('/enterprise/app-deploy/apps/app-1/environments')) {
      return new Response(
        JSON.stringify({
          data: [
            {
              description: '',
              display_name: 'Staging',
              id: 'staging',
              in_use: true,
              status: EnvironmentStatus.ENVIRONMENT_STATUS_READY,
            },
          ],
        }),
        {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        },
      )
    }

    throw new Error(`Unexpected request: ${request.method} ${request.url}`)
  })

  return requests
}

async function expectDeploymentRequest(
  requests: Request[],
  workflowId: string,
  environmentId = 'staging',
) {
  await waitFor(() => {
    expect(requests.some((request) => request.url.includes('/deployment:deploy'))).toBe(true)
  })

  const deployRequest = requests.find((request) => request.url.includes('/deployment:deploy'))
  if (!deployRequest) throw new Error('Expected the workflow deployment request.')

  expect(deployRequest.method).toBe('POST')
  expect(new URL(deployRequest.url).pathname).toBe(
    `/console/api/enterprise/app-deploy/apps/app-1/workflows/${workflowId}/environments/${environmentId}/deployment:deploy`,
  )
  expect(await deployRequest.json()).toEqual({
    credentials: [],
    environment_variables: [],
  })
}

describe('PublisherEnvironmentFlow', () => {
  it('formats deployed_at as a Unix timestamp in seconds', () => {
    const deployment = createDeployment()
    const deployedAt = deployment.deployment?.deployed_at
    if (deployedAt === undefined) throw new Error('Expected a deployed environment fixture')

    renderFlow(deployment)

    expect(screen.getByText(`Published relative:${deployedAt * 1000} by Evan`)).toBeInTheDocument()
  })

  it('shows the publish action when an undeployed environment has no published versions', async () => {
    const user = userEvent.setup()
    const onGoToPublish = vi.fn()

    render(
      <PublisherEnvironmentFlow
        appId="app-1"
        environmentId="development"
        environmentName="Development"
        environmentTabs={<div>Environment tabs</div>}
        isEnvironmentInUse={false}
        isDeploymentError={false}
        isDeploymentLoading={false}
        latestVersion={null}
        onGoToPublish={onGoToPublish}
      />,
    )

    expect(screen.getByText('No published versions yet')).toBeInTheDocument()
    expect(
      screen.getByText('Publish the app before deploying it to an environment.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Not deployed yet')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Deploy latest' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'All versions' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Go to publish' }))
    expect(onGoToPublish).toHaveBeenCalledOnce()
  })

  it('offers the latest version actions when an undeployed environment has a published version', async () => {
    const user = userEvent.setup()
    const queryClient = createFlowQueryClient('development')

    render(
      <PublisherEnvironmentFlow
        appId="app-1"
        environmentId="development"
        environmentName="Development"
        environmentTabs={<div>Environment tabs</div>}
        isEnvironmentInUse={false}
        isDeploymentError={false}
        isDeploymentLoading={false}
        latestVersion={latestVersion}
        onGoToPublish={vi.fn()}
      />,
      { queryClient },
    )

    expect(screen.getByText('Not deployed yet')).toBeInTheDocument()
    expect(
      screen.queryByText('Publish the app before deploying it to an environment.'),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Go to publish' })).not.toBeInTheDocument()
    expect(screen.getByText('Latest').parentElement).toHaveTextContent(
      `Latest: ${latestVersion.name}`,
    )

    await user.click(screen.getByRole('button', { name: 'All versions' }))
    expect(screen.getByRole('heading', { name: 'Deploy to Development' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Release 6/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /#5/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(screen.getByRole('button', { name: 'Deploy latest' }))
    expect(screen.getByRole('heading', { name: 'Deploy configuration' })).toBeInTheDocument()
    expect(screen.getByText(latestVersion.name)).toBeInTheDocument()
  })

  it('opens all versions and returns to the original publisher', async () => {
    const user = userEvent.setup()
    renderFlow()

    await user.click(screen.getByRole('button', { name: 'All versions' }))

    expect(screen.getByRole('heading', { name: 'Deploy to Staging' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Back' }))

    expect(screen.getByText('Environment tabs')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All versions' })).toBeInTheDocument()
  })

  it.each([
    DeploymentStatus.DEPLOYMENT_STATUS_DEPLOYING,
    DeploymentStatus.DEPLOYMENT_STATUS_UNDEPLOYING,
  ])(
    'disables deployment triggers but keeps environment navigation available while the status is %s',
    (status) => {
      renderFlow(createDeployment({ deployed: false, status }))

      const deployButtonName =
        status === DeploymentStatus.DEPLOYMENT_STATUS_DEPLOYING ? 'Deploying...' : 'Deploy latest'
      expect(screen.getByRole('button', { name: deployButtonName })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'All versions' })).toBeDisabled()
      expect(screen.getByRole('link', { name: 'Access Point' })).toHaveAttribute(
        'href',
        '/app/app-1/access-point?environment=staging',
      )
      expect(screen.getByRole('link', { name: 'Deploy' })).toHaveAttribute(
        'href',
        '/app/app-1/deploy?environment=staging',
      )
    },
  )

  it('keeps the deployment target and progress controls when a deploying status refresh fails', () => {
    const deployment = createDeployment({
      status: DeploymentStatus.DEPLOYMENT_STATUS_DEPLOYING,
    })
    deployment.deployment!.latest_operation = {
      activity_at: 1_785_456_000,
      id: 'operation-staging',
      operator: {
        display_name: 'Evan',
        id: 'user-1',
        type: OperatorType.OPERATOR_TYPE_ACCOUNT,
      },
      status: DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_IN_PROGRESS,
      target_version: {
        id: latestVersion.id,
        marked_comment: latestVersion.description ?? '',
        marked_name: latestVersion.name,
        version: latestVersion.name,
      },
      type: DeploymentOperationType.DEPLOYMENT_OPERATION_TYPE_DEPLOY,
    }

    renderFlow(deployment, { isDeploymentError: true })

    expect(screen.getByRole('button', { name: 'Deploying...' })).toBeDisabled()
    expect(screen.getByText(`Deploying: ${latestVersion.name}`)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All versions' })).toBeDisabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Deploy latest' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Deploy another version' })).not.toBeInTheDocument()
  })

  it('keeps current and latest version information when a status refresh fails outside deployment', () => {
    renderFlow(createDeployment(), { isDeploymentError: true })

    expect(screen.getByText('Sprint-42')).toBeInTheDocument()
    expect(screen.getByText('Latest').parentElement).toHaveTextContent(
      `Latest: ${latestVersion.name}`,
    )
    expect(screen.getByRole('button', { name: 'Deploy latest' })).toBeEnabled()
    expect(screen.queryByText('Deploying...')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it.each([
    DeploymentStatus.DEPLOYMENT_STATUS_UNDEPLOYED,
    DeploymentStatus.DEPLOYMENT_STATUS_FAILED,
  ])('shows the undeployed state when terminal status %s has no current version', (status) => {
    renderFlow(createDeployment({ deployed: false, status }))

    expect(screen.getByText('Not deployed yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Deploy latest' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'All versions' })).toBeEnabled()
  })

  it('deploys the latest version directly and goes back to version selection', async () => {
    const user = userEvent.setup()
    renderFlow()

    await user.click(screen.getByRole('button', { name: 'Deploy latest' }))

    expect(screen.getByRole('heading', { name: 'Deploy configuration' })).toBeInTheDocument()
    expect(screen.getByText(latestVersion.name)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Back' }))

    expect(screen.getByRole('heading', { name: 'Deploy to Staging' })).toBeInTheDocument()
  })

  it('hides the environment variables section when deployment options have no slots', async () => {
    const user = userEvent.setup()
    renderFlow()

    await user.click(screen.getByRole('button', { name: 'Deploy latest' }))

    expect(screen.getByRole('button', { name: 'Deploy' })).toBeEnabled()
    expect(screen.queryByRole('heading', { name: 'Environment Variables' })).not.toBeInTheDocument()
  })

  it('hides the credentials section when deployment options only have environment variables', async () => {
    const user = userEvent.setup()
    const view = renderFlow()
    const deploymentOptionsQuery =
      consoleQuery.enterprise.appDeploy.deploymentService.getWorkflowDeploymentOptions.queryOptions(
        {
          input: {
            params: {
              app_id: 'app-1',
              environment_id: 'staging',
              workflow_id: latestVersion.id,
            },
          },
          retry: false,
        },
      )
    view.queryClient.setQueryData(deploymentOptionsQuery.queryKey, {
      credential_slots: [],
      environment_variable_slots: [
        {
          configured_value: 'production',
          description: '',
          has_configured_value: true,
          has_last_deployed_value: false,
          key: 'ENVIRONMENT',
          value_type: EnvVarValueType.ENV_VAR_VALUE_TYPE_STRING,
        },
      ],
    })

    await user.click(screen.getByRole('button', { name: 'Deploy latest' }))

    expect(screen.queryByRole('heading', { name: 'Credentials' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Environment Variables' })).toBeInTheDocument()
  })

  it('shows unsupported node titles when the latest version fails precheck', async () => {
    const user = userEvent.setup()
    const view = renderFlow()
    const precheckQuery =
      consoleQuery.enterprise.appDeploy.deploymentService.precheckWorkflowDeployment.queryOptions({
        input: {
          params: {
            app_id: 'app-1',
            workflow_id: latestVersion.id,
          },
        },
        retry: false,
      })
    view.queryClient.setQueryData(precheckQuery.queryKey, {
      unsupported_nodes: [
        {
          id: 'knowledge-node',
          title: 'Knowledge Retrieval',
          type: 'knowledge-retrieval',
        },
        {
          id: 'notion-node',
          provider: {
            plugin_id: 'langgenius/notion',
            provider_id: 'notion',
            provider_name: 'Notion',
            provider_type: 'mcp',
          },
          title: 'Notion MCP',
          type: 'tool',
        },
      ],
    })

    await user.click(screen.getByRole('button', { name: 'Deploy latest' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("This version can't be deployed to this environment")
    expect(within(alert).getByText('Knowledge Retrieval')).toBeInTheDocument()
    expect(within(alert).getByText('Notion MCP')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Deploy' })).toBeDisabled()
  })

  it('submits the latest version through the deployment API', async () => {
    const user = userEvent.setup()
    const requests = captureDeploymentRequests()
    renderFlow()

    await user.click(screen.getByRole('button', { name: 'Deploy latest' }))
    await user.click(screen.getByRole('button', { name: 'Deploy' }))

    await expectDeploymentRequest(requests, latestVersion.id)
    expect(await screen.findByRole('button', { name: 'All versions' })).toBeInTheDocument()
  })

  it('polls the environment deployment after submit and refreshes environments on success', async () => {
    const user = userEvent.setup()
    const requests = captureDeploymentRequests()
    renderFlowWithPolling()

    await user.click(screen.getByRole('button', { name: 'Deploy latest' }))
    await user.click(screen.getByRole('button', { name: 'Deploy' }))

    await waitFor(() => {
      expect(
        requests.some(
          (request) =>
            request.method === 'GET' &&
            new URL(request.url).pathname.endsWith(
              '/enterprise/app-deploy/apps/app-1/workflows/environment-deployments/staging',
            ),
        ),
      ).toBe(true)
    })
    await waitFor(() => {
      expect(
        requests.some(
          (request) =>
            request.method === 'GET' &&
            new URL(request.url).pathname.endsWith(
              '/enterprise/app-deploy/apps/app-1/environments',
            ),
        ),
      ).toBe(true)
    })
    expect(screen.getByText('Polling: none')).toBeInTheDocument()
  })

  it('submits a version selected from all versions through the deployment API', async () => {
    const user = userEvent.setup()
    const requests = captureDeploymentRequests()
    renderFlow()

    await user.click(screen.getByRole('button', { name: 'All versions' }))
    await user.click(screen.getByRole('button', { name: /Release 6/ }))
    await user.click(screen.getByRole('button', { name: 'Deploy' }))

    await expectDeploymentRequest(requests, 'workflow-version-6')
    expect(await screen.findByRole('button', { name: 'All versions' })).toBeInTheDocument()
  })

  it('disables deploy latest and submits another selected version when already latest', async () => {
    const user = userEvent.setup()
    const requests = captureDeploymentRequests()
    renderFlow(createDeployment({ latest: true }))

    expect(screen.getByRole('button', { name: 'Deploy latest' })).toBeDisabled()
    expect(screen.getByText('Latest')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'All versions' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Deploy another version' }))
    await user.click(screen.getByRole('button', { name: /Sprint-35/ }))

    expect(screen.getByRole('heading', { name: 'Deploy configuration' })).toBeInTheDocument()
    expect(screen.getByText('Sprint-35')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Deploy' }))

    await expectDeploymentRequest(requests, 'sprint-35')
    expect(
      await screen.findByRole('button', { name: 'Deploy another version' }),
    ).toBeInTheDocument()
  })
})
