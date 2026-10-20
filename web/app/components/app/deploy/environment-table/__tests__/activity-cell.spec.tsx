import type { EnvironmentDeploymentOperation } from '@dify/contracts/enterprise-app-deploy/types.gen'
import {
  DeploymentOperationStatus,
  DeploymentOperationType,
  OperatorType,
} from '@dify/contracts/enterprise-app-deploy/types.gen'
import { render, screen } from '@testing-library/react'
import { ActivityCell } from '../activity-cell'

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return createReactI18nextMock({
    'deployments.studio.activity.deploy': 'Deploy {{target}}',
    'deployments.studio.activity.deployFailed': 'Deploy {{target}} failed',
    'deployments.studio.activity.deploySucceeded': 'Deploy {{target}} succeeded',
    'deployments.studio.activity.meta': 'by {{name}} · {{time}}',
    'deployments.deployTab.undeploy': 'Undeploy',
    'deployments.status.RUNTIME_INSTANCE_STATUS_UNDEPLOYING': 'Undeploying',
    'workflow.tracing.status.failed': 'Failed',
    'workflow.tracing.status.succeeded': 'Success',
  })
})

const { formatTimeFromNow } = vi.hoisted(() => ({ formatTimeFromNow: vi.fn() }))

vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({ formatTimeFromNow }),
}))

const activity: EnvironmentDeploymentOperation = {
  activity_at: 1_800_000_000,
  id: 'deploy-release-1',
  operator: { display_name: 'Evan', id: 'operator-1', type: OperatorType.OPERATOR_TYPE_ACCOUNT },
  status: DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_IN_PROGRESS,
  target_version: { id: 'release-1', marked_name: 'Release 1', version: '1' },
  type: DeploymentOperationType.DEPLOYMENT_OPERATION_TYPE_DEPLOY,
}

describe('ActivityCell announcements', () => {
  beforeEach(() => {
    formatTimeFromNow.mockReturnValue('just now')
  })

  it.each([
    [DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_SUCCEEDED, 'succeeded'],
    [DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_FAILED, 'failed'],
  ] as const)('announces deployment result %s with its environment', (status, result) => {
    const { rerender } = render(<ActivityCell activity={activity} environmentName="Canary" />)
    const announcement = screen.getByRole('status')
    expect(announcement).toHaveTextContent('Canary: Deploy Release 1')

    rerender(<ActivityCell activity={{ ...activity, status }} environmentName="Canary" />)

    expect(screen.getByRole('status')).toHaveTextContent(`Canary: Deploy Release 1 ${result}`)
  })

  it.each([
    [DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_SUCCEEDED, 'Success'],
    [DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_FAILED, 'Failed'],
  ] as const)('announces undeployment result %s with its environment', (status, result) => {
    const undeploy = {
      ...activity,
      type: DeploymentOperationType.DEPLOYMENT_OPERATION_TYPE_UNDEPLOY,
    }
    const { rerender } = render(<ActivityCell activity={undeploy} environmentName="Canary" />)
    expect(screen.getByRole('status')).toHaveTextContent('Canary: Undeploying')

    rerender(<ActivityCell activity={{ ...undeploy, status }} environmentName="Canary" />)

    expect(screen.getByRole('status')).toHaveTextContent(`Canary: Undeploy · ${result}`)
  })

  it('does not announce an unspecified undeployment as in progress', () => {
    render(
      <ActivityCell
        activity={{
          ...activity,
          type: DeploymentOperationType.DEPLOYMENT_OPERATION_TYPE_UNDEPLOY,
          status: DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_UNSPECIFIED,
        }}
        environmentName="Canary"
      />,
    )

    expect(screen.getByRole('status').textContent).toBe('Canary: Undeploy')
  })

  it('keeps the live region mounted when the first activity arrives', () => {
    const { rerender } = render(<ActivityCell environmentName="Canary" />)
    const announcement = screen.getByRole('status')

    rerender(<ActivityCell activity={activity} environmentName="Canary" />)

    expect(screen.getByRole('status')).toBe(announcement)
    expect(announcement).toHaveTextContent('Canary: Deploy Release 1')
  })

  it('keeps relative time updates outside the live region', () => {
    const { rerender } = render(<ActivityCell activity={activity} environmentName="Canary" />)
    expect(screen.getByText('by Evan · just now')).toBeInTheDocument()
    expect(screen.getByRole('status')).not.toHaveTextContent('just now')

    formatTimeFromNow.mockReturnValue('one minute ago')
    rerender(<ActivityCell activity={activity} environmentName="Canary" />)

    expect(screen.getByText('by Evan · one minute ago')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Canary: Deploy Release 1')
    expect(screen.getByRole('status')).not.toHaveTextContent('one minute ago')
  })
})
