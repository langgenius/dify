import type { AccessPointAppInfo } from '../shared/utils'
import type { AppTrigger } from '@/service/use-tools'
import { screen } from '@testing-library/react'
import { render } from '@/test/console/render'
import { AppModeEnum } from '@/types/app'
import { TriggerAccessPointCard } from '../built-in-access-points/trigger-card'

const mocks = vi.hoisted(() => ({
  invalidateTriggers: vi.fn(),
  setTriggerStatus: vi.fn(),
  setTriggerStatuses: vi.fn(),
  triggerQuery: {
    data: undefined as { data: AppTrigger[] } | undefined,
    isLoading: false,
  },
  updateTriggerStatus: vi.fn(),
}))

vi.mock('@/app/components/workflow/store/trigger-status', () => ({
  useTriggerStatusStore: () => ({
    setTriggerStatus: mocks.setTriggerStatus,
    setTriggerStatuses: mocks.setTriggerStatuses,
  }),
}))

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.example.test/en${path}`,
}))

vi.mock('@/service/use-tools', () => ({
  useAppTriggers: () => mocks.triggerQuery,
  useInvalidateAppTriggers: () => mocks.invalidateTriggers,
  useUpdateTriggerStatus: () => ({
    isPending: false,
    mutateAsync: mocks.updateTriggerStatus,
  }),
}))

vi.mock('@/service/use-triggers', () => ({
  useAllTriggerPlugins: () => ({ data: [] }),
}))

vi.mock('@/app/components/workflow/block-icon', () => ({
  default: () => null,
}))

const appInfo = {
  id: 'app-1',
  mode: AppModeEnum.WORKFLOW,
} as AccessPointAppInfo

function createTrigger(id: string, status: AppTrigger['status']): AppTrigger {
  return {
    id,
    trigger_type: 'trigger-webhook',
    title: `Trigger ${id}`,
    node_id: `node-${id}`,
    provider_name: 'Webhook',
    icon: '',
    status,
    created_at: '2026-08-04T00:00:00Z',
    updated_at: '2026-08-04T00:00:00Z',
  }
}

function renderCard(availability: 'available' | 'loading' | 'unavailable') {
  render(
    <TriggerAccessPointCard
      appInfo={appInfo}
      availability={availability}
      canEdit
      onToggleResult={vi.fn()}
    />,
  )
}

describe('TriggerAccessPointCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.triggerQuery.data = undefined
    mocks.triggerQuery.isLoading = false
  })

  it('shows loading without reporting an environment failure', () => {
    renderCard('loading')

    const card = screen.getByRole('region', { name: /settings\.trigger/ })
    expect(card).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('common.loading')).toBeInTheDocument()
    expect(
      screen.queryByText('deployments.health.ENVIRONMENT_STATUS_FAILED'),
    ).not.toBeInTheDocument()
  })

  it('shows every non-enabled trigger as disabled with its switch off', () => {
    mocks.triggerQuery.data = {
      data: [
        createTrigger('enabled', 'enabled'),
        createTrigger('disabled', 'disabled'),
        createTrigger('unauthorized', 'unauthorized'),
      ],
    }

    renderCard('available')

    expect(
      screen.getByText(
        'deployments.studio.accessPoint.triggerEnabledCount:{"enabled":1,"total":3}',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('agentV2.agentDetail.access.status.inService')).toBeInTheDocument()
    expect(screen.getAllByText('appOverview.overview.status.disable')).toHaveLength(2)
    expect(
      screen.queryByText('deployments.studio.accessPoint.triggerDisconnected'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('deployments.studio.accessPoint.triggerMuted'),
    ).not.toBeInTheDocument()

    const [enabledSwitch, disabledSwitch, unauthorizedSwitch] = screen.getAllByRole('switch')
    expect(enabledSwitch).toBeChecked()
    expect(disabledSwitch).not.toBeChecked()
    expect(unauthorizedSwitch).not.toBeChecked()
  })

  it('uses the overview empty-state copy and documentation interaction', () => {
    renderCard('unavailable')

    expect(
      screen.getByText('appOverview.overview.triggerInfo.triggerStatusDescription'),
    ).toBeInTheDocument()
    const learnLink = screen.getByRole('link', {
      name: 'appOverview.overview.triggerInfo.learnAboutTriggers',
    })
    expect(learnLink).toHaveAttribute(
      'href',
      'https://docs.example.test/en/use-dify/nodes/trigger/overview',
    )
    expect(learnLink).toHaveAttribute('target', '_blank')
    expect(learnLink).toHaveAttribute('rel', 'noopener noreferrer')
    expect(
      screen.queryByText('deployments.studio.accessPoint.triggerServiceModeUnavailable'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('deployments.studio.accessPoint.noTriggerNodes'),
    ).not.toBeInTheDocument()
  })
})
