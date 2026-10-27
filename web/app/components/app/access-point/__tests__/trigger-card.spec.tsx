import type { WorkflowTriggerResponse } from '@dify/contracts/api/console/apps/types.gen'
import { QueryClientProvider } from '@tanstack/react-query'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { render } from '@/test/console/render'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { createTestQueryClient } from '@/test/query-client'
import { TriggerAccessPointCard } from '../built-in-access-points/trigger-card'

const mocks = vi.hoisted(() => ({
  setTriggerStatuses: vi.fn(),
  getTriggers: vi.fn(),
  triggerQuery: {
    data: undefined as { data: WorkflowTriggerResponse[] } | undefined,
    isLoading: false,
  },
  updateTriggerStatus: vi.fn(),
}))

vi.mock('@/app/notifications', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('@/app/components/workflow/store/trigger-status', () => ({
  useTriggerStatusStore: (
    selector: (state: { setTriggerStatuses: typeof mocks.setTriggerStatuses }) => unknown,
  ) =>
    selector({
      setTriggerStatuses: mocks.setTriggerStatuses,
    }),
}))

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.example.test/en${path}`,
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.triggers.get': async (input) => {
        mocks.getTriggers(input)
        return mocks.triggerQuery.data ?? { data: [] }
      },
      'apps.byAppId.triggerEnable.post': async (input) => {
        await mocks.updateTriggerStatus(input)
        const body = (input as { body: { trigger_id: string; enable_trigger: boolean } }).body
        if (mocks.triggerQuery.data)
          mocks.triggerQuery.data = {
            data: mocks.triggerQuery.data.data.map((trigger) =>
              trigger.id === body.trigger_id
                ? { ...trigger, status: body.enable_trigger ? 'enabled' : 'disabled' }
                : trigger,
            ),
          }
      },
    }),
  }
})

vi.mock('@/service/use-triggers', () => ({
  useAllTriggerPlugins: () => ({ data: [] }),
}))

const appInfo = createAppDetailFixture({
  id: 'app-1',
  mode: 'workflow' as const,
})

function createTrigger(
  id: string,
  status: WorkflowTriggerResponse['status'],
): WorkflowTriggerResponse {
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

const triggersQueryKey = consoleQuery.apps.byAppId.triggers.get.queryKey({
  input: { params: { app_id: 'app-1' } },
})

function renderCard(availability: 'available' | 'loading' | 'unavailable') {
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(triggersQueryKey, mocks.triggerQuery.data ?? { data: [] })

  render(
    <QueryClientProvider client={queryClient}>
      <TriggerAccessPointCard appInfo={appInfo} availability={availability} canManageAccessPoint />
    </QueryClientProvider>,
  )
  return queryClient
}

function createDeferredPromise<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, reject, resolve }
}

describe('TriggerAccessPointCard', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.triggerQuery.data = undefined
    mocks.triggerQuery.isLoading = false
    mocks.updateTriggerStatus.mockResolvedValue(undefined)
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

  it('keeps successful trigger changes silent', async () => {
    const user = userEvent.setup()
    mocks.triggerQuery.data = {
      data: [createTrigger('disabled', 'disabled')],
    }
    renderCard('available')

    await user.click(screen.getByRole('switch', { name: 'Trigger disabled' }))

    await waitFor(() => {
      expect(mocks.updateTriggerStatus).toHaveBeenCalledWith({
        params: {
          app_id: 'app-1',
        },
        body: {
          trigger_id: 'disabled',
          enable_trigger: true,
        },
      })
      expect(mocks.getTriggers).toHaveBeenCalledWith({ params: { app_id: 'app-1' } })
      expect(screen.getByRole('switch', { name: 'Trigger disabled' })).toBeChecked()
    })
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('shows an error toast when a trigger change fails', async () => {
    const user = userEvent.setup()
    mocks.triggerQuery.data = {
      data: [createTrigger('enabled', 'enabled')],
    }
    mocks.updateTriggerStatus.mockRejectedValueOnce(new Error('request failed'))
    renderCard('available')

    await user.click(screen.getByRole('switch', { name: 'Trigger enabled' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('common.actionMsg.modifiedUnsuccessfully')
    })
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('optimistically serializes rapid changes for each trigger without disabling its switch', async () => {
    const user = userEvent.setup()
    const firstToggle = createDeferredPromise<void>()
    const secondToggle = createDeferredPromise<void>()
    mocks.triggerQuery.data = {
      data: [createTrigger('enabled', 'enabled')],
    }
    mocks.updateTriggerStatus
      .mockReturnValueOnce(firstToggle.promise)
      .mockReturnValueOnce(secondToggle.promise)
    const queryClient = renderCard('available')
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    const triggerSwitch = screen.getByRole('switch', { name: 'Trigger enabled' })
    await user.click(triggerSwitch)

    expect(triggerSwitch).toHaveAttribute('aria-checked', 'false')
    expect(triggerSwitch).toBeEnabled()

    await user.click(triggerSwitch)

    expect(triggerSwitch).toHaveAttribute('aria-checked', 'true')
    expect(mocks.updateTriggerStatus).toHaveBeenCalledTimes(1)

    firstToggle.resolve()

    await waitFor(() => {
      expect(mocks.updateTriggerStatus).toHaveBeenCalledTimes(2)
    })

    secondToggle.resolve()

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledTimes(2)
    })
    expect(triggerSwitch).toHaveAttribute('aria-checked', 'true')
  })
})
