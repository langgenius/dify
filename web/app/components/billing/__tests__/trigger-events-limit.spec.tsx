import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import dayjs from 'dayjs'
import { TriggerEventsLimitPrompt } from '@/app/components/billing/trigger-events-limit-modal/prompt'
import { createConsoleQueryWrapper, seedFeatures } from '@/test/console/query-data'
import { render } from '@/test/console/render'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}))

const renderProvider = (
  features: Parameters<typeof seedFeatures>[1] = {},
  edition: DeploymentEdition = 'CLOUD',
) => {
  const { wrapper: QueryWrapper, queryClient } = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: edition },
    currentWorkspace: { id: 'workspace-1' },
  })
  seedFeatures(queryClient, features)
  const { wrapper: NuqsWrapper, onUrlUpdate } = createNuqsTestWrapper()
  const wrapper = ({ children: wrapperChildren }: { children: React.ReactNode }) => (
    <QueryWrapper>
      <NuqsWrapper>{wrapperChildren}</NuqsWrapper>
    </QueryWrapper>
  )

  return {
    queryClient,
    onUrlUpdate,
    ...render(<TriggerEventsLimitPrompt />, { wrapper }),
  }
}

describe('Trigger events limit prompt', () => {
  beforeEach(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('trigger-events-limit-dismissed-workspace-1-'))
        localStorage.removeItem(key)
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('updates the visible quota and closes the modal when usage drops below the limit', async () => {
    const features = {
      billing: { subscription: { plan: 'professional' as const } },
      trigger_event: { usage: 200, limit: 200, reset_date: dayjs().add(3, 'day').unix() },
    }
    const { queryClient } = renderProvider(features)

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    act(() => {
      seedFeatures(queryClient, {
        ...features,
        trigger_event: { ...features.trigger_event, usage: 250 },
      })
    })
    expect(await screen.findByText('250')).toBeInTheDocument()

    act(() => {
      seedFeatures(queryClient, {
        ...features,
        trigger_event: { ...features.trigger_event, usage: 100 },
      })
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it.each(['COMMUNITY', 'ENTERPRISE'] as const)(
    'does not show Cloud quota prompts in %s',
    (edition) => {
      renderProvider(
        {
          billing: { subscription: { plan: 'sandbox' } },
          trigger_event: { usage: 200, limit: 200 },
        },
        edition,
      )

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    },
  )

  it('opens the trigger events limit modal and persists dismissal in localStorage', async () => {
    const features = {
      billing: { subscription: { plan: 'professional' as const } },
      trigger_event: { usage: 3000, limit: 3000, reset_date: dayjs().add(5, 'day').unix() },
    }
    const dismissalKey = `trigger-events-limit-dismissed-workspace-1-professional-3000-${dayjs().add(5, 'day').format('YYYY-MM-DD')}`
    const user = userEvent.setup()

    renderProvider(features)

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    expect(screen.getAllByText('3000')).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: 'billing.triggerLimitModal.dismiss' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(localStorage.getItem(dismissalKey)).toBe('1')
  })

  it('relies on the in-memory guard when localStorage reads throw', async () => {
    const features = {
      billing: { subscription: { plan: 'professional' as const } },
      trigger_event: { usage: 200, limit: 200, reset_date: dayjs().add(3, 'day').unix() },
    }
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('Storage disabled')
    })
    const user = userEvent.setup()

    const { rerender } = renderProvider(features)

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'billing.triggerLimitModal.dismiss' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    rerender(<TriggerEventsLimitPrompt />)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('falls back to the in-memory guard when localStorage.setItem fails', async () => {
    const features = {
      billing: { subscription: { plan: 'professional' as const } },
      trigger_event: { usage: 120, limit: 120, reset_date: dayjs().add(2, 'day').unix() },
    }
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded')
    })
    const user = userEvent.setup()

    const { rerender } = renderProvider(features)

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'billing.triggerLimitModal.dismiss' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    rerender(<TriggerEventsLimitPrompt />)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('closes the trigger events limit modal and opens pricing when upgrading', async () => {
    const features = {
      billing: { subscription: { plan: 'professional' as const } },
      trigger_event: { usage: 400, limit: 400, reset_date: dayjs().add(6, 'day').unix() },
    }
    const user = userEvent.setup()

    const { onUrlUpdate } = renderProvider(features)

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())

    await user.click(screen.getByText('billing.triggerLimitModal.upgrade'))

    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
    expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get('pricing')).toBe('open')
    expect(screen.queryByText('400')).not.toBeInTheDocument()
  })
})
