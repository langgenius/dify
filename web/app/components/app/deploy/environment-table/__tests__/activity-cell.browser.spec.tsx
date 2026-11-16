import type { EnvironmentDeploymentOperation } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { ReactElement } from 'react'
import {
  DeploymentOperationStatus,
  DeploymentOperationType,
  OperatorType,
} from '@dify/contracts/enterprise-app-deploy/types.gen'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { page } from 'vite-plus/test/browser'
import { render as renderBrowser } from 'vitest-browser-react'
import deployments from '@/i18n/locales/en-US/deployments.json'
import workflowHistory from '@/i18n/locales/en-US/workflow-history.json'
import workflow from '@/i18n/locales/en-US/workflow.json'
import { ActivityCell } from '../activity-cell'

vi.unmock('react-i18next')

async function render(ui: ReactElement) {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { deployments, workflow, workflowHistory } },
    keySeparator: false,
  })
  const screen = await renderBrowser(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>)
  return {
    rerender: (next: ReactElement) =>
      screen.rerender(<I18nextProvider i18n={i18n}>{next}</I18nextProvider>),
  }
}

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
    vi.setSystemTime(new Date(1_800_000_000_000))
  })

  afterEach(() => vi.useRealTimers())

  it.each([
    [DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_SUCCEEDED, 'succeeded'],
    [DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_FAILED, 'failed'],
  ] as const)('announces deployment result %s with its environment', async (status, result) => {
    const { rerender } = await render(<ActivityCell activity={activity} environmentName="Canary" />)
    const announcement = page.getByRole('status')
    await expect.element(announcement).toHaveTextContent('Canary: Deploy Release 1')

    await rerender(<ActivityCell activity={{ ...activity, status }} environmentName="Canary" />)

    await expect
      .element(page.getByRole('status'))
      .toHaveTextContent(`Canary: Deploy Release 1 ${result}`)
  })

  it.each([
    [DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_SUCCEEDED, 'Success'],
    [DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_FAILED, 'Failed'],
  ] as const)('announces undeployment result %s with its environment', async (status, result) => {
    const undeploy = {
      ...activity,
      type: DeploymentOperationType.DEPLOYMENT_OPERATION_TYPE_UNDEPLOY,
    }
    const { rerender } = await render(<ActivityCell activity={undeploy} environmentName="Canary" />)
    await expect.element(page.getByRole('status')).toHaveTextContent('Canary: Undeploying')

    await rerender(<ActivityCell activity={{ ...undeploy, status }} environmentName="Canary" />)

    await expect.element(page.getByRole('status')).toHaveTextContent(`Canary: Undeploy · ${result}`)
  })

  it('does not announce an unspecified undeployment as in progress', async () => {
    await render(
      <ActivityCell
        activity={{
          ...activity,
          type: DeploymentOperationType.DEPLOYMENT_OPERATION_TYPE_UNDEPLOY,
          status: DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_UNSPECIFIED,
        }}
        environmentName="Canary"
      />,
    )

    await expect.element(page.getByRole('status')).toHaveTextContent('Canary: Undeploy')
  })

  it('keeps the live region mounted when the first activity arrives', async () => {
    const { rerender } = await render(<ActivityCell environmentName="Canary" />)
    const announcement = page.getByRole('status').element()

    await rerender(<ActivityCell activity={activity} environmentName="Canary" />)

    expect(page.getByRole('status').element()).toBe(announcement)
    await expect.element(announcement).toHaveTextContent('Canary: Deploy Release 1')
  })

  it('keeps relative time updates outside the live region', async () => {
    const { rerender } = await render(<ActivityCell activity={activity} environmentName="Canary" />)
    await expect.element(page.getByText('by Evan · a few seconds ago')).toBeVisible()
    await expect.element(page.getByRole('status')).not.toMatchTextContent('a few seconds ago')

    vi.setSystemTime(new Date(1_800_000_060_000))
    await rerender(<ActivityCell activity={activity} environmentName="Canary" />)

    await expect.element(page.getByText('by Evan · a minute ago')).toBeVisible()
    await expect.element(page.getByRole('status')).toHaveTextContent('Canary: Deploy Release 1')
    await expect.element(page.getByRole('status')).not.toMatchTextContent('a minute ago')
  })
})
