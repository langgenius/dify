import type { EnvironmentDeployment } from '@dify/contracts/enterprise-app-deploy/types.gen'
import {
  DeploymentStatus,
  EnvironmentStatus,
  OperatorType,
} from '@dify/contracts/enterprise-app-deploy/types.gen'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MOCK_PUBLISHED_VERSIONS } from '@/app/components/app/deploy/mock-data'
import { consoleQuery } from '@/service/client'
import {
  createConsoleQueryClient,
  renderWithConsoleQuery as render,
} from '@/test/console/query-data'
import { PublisherEnvironmentFlow } from '../environment-deployment-flow'

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return createReactI18nextMock({
    'common.appMenus.deploy': 'Deploy',
    'common.operation.back': 'Back',
    'common.operation.cancel': 'Cancel',
    'deployments.overview.chip.latest': 'Latest',
    'deployments.studio.accessPoint.goToPublish': 'Go to publish',
    'deployments.studio.allVersions': 'All versions',
    'deployments.studio.chooseVersionToDeploy': 'Choose a version to deploy',
    'deployments.studio.current': 'Current',
    'deployments.studio.deployConfiguration': 'Deploy configuration',
    'deployments.studio.deployConfigurationDescription':
      'Select credentials and complete environment variable values before deployment.',
    'deployments.studio.deployLatest': 'Deploy latest',
    'deployments.studio.deployOtherVersion': 'Deploy other version',
    'deployments.studio.accessPoint.noPublishedTitle': 'No published versions yet',
    'deployments.studio.publisher.noPublishedDescription':
      'Publish the app before deploying it to an environment.',
    'deployments.studio.publisher.notDeployedYet': 'Not deployed yet',
    'deployments.versions.deployTo': 'Deploy to {{name}}',
    'workflow.common.publishedBy': 'Published {{time}} by {{author}}',
  })
})

const latestVersion = MOCK_PUBLISHED_VERSIONS.find((version) => version.latest)!

function createDeployment({
  latest = false,
}: {
  latest?: boolean
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
      current_version: currentVersion,
      deployed_at: new Date().toISOString(),
      deployed_by: {
        display_name: 'Evan',
        id: 'user-1',
        type: OperatorType.OPERATOR_TYPE_ACCOUNT,
      },
      status: DeploymentStatus.DEPLOYMENT_STATUS_RUNNING,
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

function createFlowQueryClient(environmentId: string) {
  const queryClient = createConsoleQueryClient()
  MOCK_PUBLISHED_VERSIONS.forEach((version) => {
    const precheckQuery =
      consoleQuery.enterprise.appDeploy.deploymentService.precheckWorkflowDeployment.queryOptions({
        input: {
          params: {
            app_id: 'app-1',
            workflow_id: version.id,
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
              workflow_id: version.id,
            },
          },
          retry: false,
        },
      )

    queryClient.setQueryDefaults(precheckQuery.queryKey, { staleTime: Infinity })
    queryClient.setQueryData(precheckQuery.queryKey, {
      deployable: true,
      unsupported_nodes: [],
      unsupported_tool_providers: [],
    })
    queryClient.setQueryDefaults(deploymentOptionsQuery.queryKey, { staleTime: Infinity })
    queryClient.setQueryData(deploymentOptionsQuery.queryKey, {
      credential_slots: [],
      environment_variable_slots: [],
    })
  })

  return queryClient
}

function renderFlow(deployment = createDeployment()) {
  const queryClient = createFlowQueryClient(deployment.environment.id)

  return render(
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
    />,
    { queryClient },
  )
}

describe('PublisherEnvironmentFlow', () => {
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

  it('deploys the latest version directly and goes back to version selection', async () => {
    const user = userEvent.setup()
    renderFlow()

    await user.click(screen.getByRole('button', { name: 'Deploy latest' }))

    expect(screen.getByRole('heading', { name: 'Deploy configuration' })).toBeInTheDocument()
    expect(screen.getByText(latestVersion.name)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Back' }))

    expect(screen.getByRole('heading', { name: 'Deploy to Staging' })).toBeInTheDocument()
  })

  it('disables deploy latest and deploys another selected version when already latest', async () => {
    const user = userEvent.setup()
    renderFlow(createDeployment({ latest: true }))

    expect(screen.getByRole('button', { name: 'Deploy latest' })).toBeDisabled()
    expect(screen.getByText('Latest')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'All versions' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Deploy other version' }))
    await user.click(screen.getByRole('button', { name: /Sprint-35/ }))

    expect(screen.getByRole('heading', { name: 'Deploy configuration' })).toBeInTheDocument()
    expect(screen.getByText('Sprint-35')).toBeInTheDocument()
  })
})
