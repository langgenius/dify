import type { MockEnvironmentDeployment } from '@/app/components/app/deploy/mock-data'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MOCK_PUBLISHED_VERSIONS } from '@/app/components/app/deploy/mock-data'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { PublisherEnvironmentFlow } from '../environment-deployment-flow'

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return createReactI18nextMock({
    'common.appMenus.deploy': 'Deploy',
    'common.operation.back': 'Back',
    'common.operation.cancel': 'Cancel',
    'deployments.overview.chip.latest': 'Latest',
    'deployments.studio.allVersions': 'All versions',
    'deployments.studio.chooseVersionToDeploy': 'Choose a version to deploy',
    'deployments.studio.current': 'Current',
    'deployments.studio.deployConfiguration': 'Deploy configuration',
    'deployments.studio.deployConfigurationDescription':
      'Select credentials and complete environment variable values before deployment.',
    'deployments.studio.deployLatest': 'Deploy latest',
    'deployments.studio.deployOtherVersion': 'Deploy other version',
    'deployments.versions.deployTo': 'Deploy to {{name}}',
    'workflow.common.publishedBy': 'Published {{time}} by {{author}}',
  })
})

const latestVersion = MOCK_PUBLISHED_VERSIONS.find((version) => version.latest)!

function createDeployment({
  latest = false,
}: {
  latest?: boolean
} = {}): MockEnvironmentDeployment {
  return {
    accessPoints: ['webApp'],
    action: { kind: 'deployLatest' },
    activity: {
      actor: 'Evan',
      occurredAt: Date.now(),
      result: 'succeeded',
      target: 'Sprint-42',
    },
    id: 'staging',
    name: 'Staging',
    status: 'running',
    version: {
      behind: latest ? undefined : 1,
      latest,
      name: 'Sprint-42',
      publishedAt: Date.now(),
      publishedBy: 'Evan',
    },
  }
}

function renderFlow(deployment = createDeployment()) {
  return render(
    <PublisherEnvironmentFlow
      appId="app-1"
      deployment={deployment}
      environmentId={deployment.id}
      environmentTabs={<div>Environment tabs</div>}
      latestVersion={latestVersion}
      onGoToPublish={vi.fn()}
    />,
  )
}

describe('PublisherEnvironmentFlow', () => {
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
