import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import dayjs from 'dayjs'
import * as React from 'react'
import { PluginCategoryEnum, PluginSource } from '@/app/components/plugins/types'
import { useModalContextSelector } from '@/context/modal-context'
import { ModalContextProvider } from '@/context/modal-context-provider'
import { createConsoleQueryWrapper, seedFeatures } from '@/test/console/query-data'
import { render } from '@/test/console/render'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}))

vi.mock('@/app/components/billing/pricing', () => ({
  Pricing: () => <div>billing.plansCommon.mostPopular</div>,
}))

vi.mock('@/app/components/plugins/update-plugin', () => ({
  default: ({ onSave }: { onSave: () => void | Promise<void> }) => (
    <button data-testid="save-plugin-update" onClick={onSave}>
      Save plugin update
    </button>
  ),
}))

const mockConsoleStateReader = vi.fn()

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => mockConsoleStateReader())
})

const ModalBlockingState = () => {
  const hasBlockingModalOpen = useModalContextSelector((state) => state.hasBlockingModalOpen)

  return <output>{hasBlockingModalOpen ? 'blocked' : 'clear'}</output>
}

const UpdatePluginTrigger = ({
  onSave,
  category = PluginCategoryEnum.model,
}: {
  onSave: () => void | Promise<void>
  category?: PluginCategoryEnum
}) => {
  const setShowUpdatePluginModal = useModalContextSelector(
    (state) => state.setShowUpdatePluginModal,
  )

  return (
    <button
      onClick={() =>
        setShowUpdatePluginModal({
          onSaveCallback: onSave,
          payload: {
            type: PluginSource.github,
            category,
            github: {
              originalPackageInfo: {
                id: 'plugin@1.0.0',
                repo: 'owner/repo',
                version: '1.0.0',
                package: 'plugin.difypkg',
                releases: [],
              },
            },
          },
        })
      }
    >
      Open plugin update
    </button>
  )
}

const renderProvider = (
  children: React.ReactNode = <ModalBlockingState />,
  features: Parameters<typeof seedFeatures>[1] = {},
  edition: DeploymentEdition = 'CLOUD',
) => {
  const { wrapper: QueryWrapper, queryClient } = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: edition },
  })
  seedFeatures(queryClient, features)
  const { wrapper: NuqsWrapper } = createNuqsTestWrapper()
  const wrapper = ({ children: wrapperChildren }: { children: React.ReactNode }) => (
    <QueryWrapper>
      <NuqsWrapper>{wrapperChildren}</NuqsWrapper>
    </QueryWrapper>
  )

  return {
    queryClient,
    ...render(<ModalContextProvider>{children}</ModalContextProvider>, { wrapper }),
  }
}

describe('ModalContextProvider trigger events limit modal', () => {
  beforeEach(() => {
    mockConsoleStateReader.mockReset()
    window.localStorage.clear()
    mockConsoleStateReader.mockReturnValue({
      currentWorkspace: {
        id: 'workspace-1',
      },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('updates the visible quota and closes the modal when usage drops below the limit', async () => {
    const features = {
      billing: { subscription: { plan: 'professional' as const } },
      trigger_event: { usage: 200, limit: 200, reset_date: dayjs().add(3, 'day').unix() },
    }
    const { queryClient } = renderProvider(undefined, features)

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
    expect(screen.getByText('clear')).toBeInTheDocument()
  })

  it.each(['COMMUNITY', 'ENTERPRISE'] as const)(
    'does not show Cloud quota prompts in %s',
    (edition) => {
      renderProvider(
        undefined,
        {
          billing: { subscription: { plan: 'sandbox' } },
          trigger_event: { usage: 200, limit: 200 },
        },
        edition,
      )

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.getByText('clear')).toBeInTheDocument()
    },
  )

  it('opens the trigger events limit modal and persists dismissal in localStorage', async () => {
    const features = {
      billing: { subscription: { plan: 'professional' as const } },
      trigger_event: { usage: 3000, limit: 3000, reset_date: dayjs().add(5, 'day').unix() },
    }
    // Note: vitest.setup.ts replaces localStorage with a mock object that has vi.fn() methods
    // We need to spy on the mock's setItem, not Storage.prototype.setItem
    const setItemSpy = vi.spyOn(localStorage, 'setItem')
    const user = userEvent.setup()

    renderProvider(undefined, features)

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    expect(screen.getAllByText('3000')).toHaveLength(2)
    expect(screen.getByText('blocked')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'billing.triggerLimitModal.dismiss' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText('clear')).toBeInTheDocument()
    await waitFor(() => {
      expect(setItemSpy.mock.calls.length).toBeGreaterThan(0)
    })
    const [key, value] = (setItemSpy.mock.calls[0] ?? []) as [string, string]
    expect(key).toContain('trigger-events-limit-dismissed-workspace-1-professional-3000-')
    expect(value).toBe('1')
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

    const { rerender } = renderProvider(undefined, features)

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'billing.triggerLimitModal.dismiss' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    rerender(
      <ModalContextProvider>
        <ModalBlockingState />
      </ModalContextProvider>,
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText('clear')).toBeInTheDocument()
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

    const { rerender } = renderProvider(undefined, features)

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'billing.triggerLimitModal.dismiss' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    rerender(
      <ModalContextProvider>
        <ModalBlockingState />
      </ModalContextProvider>,
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText('clear')).toBeInTheDocument()
  })

  it('closes the trigger events limit modal and opens pricing when upgrading', async () => {
    const features = {
      billing: { subscription: { plan: 'professional' as const } },
      trigger_event: { usage: 400, limit: 400, reset_date: dayjs().add(6, 'day').unix() },
    }
    const user = userEvent.setup()

    renderProvider(undefined, features)

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())

    await user.click(screen.getByText('billing.triggerLimitModal.upgrade'))

    await waitFor(() =>
      expect(screen.getByText('billing.plansCommon.mostPopular')).toBeInTheDocument(),
    )
    expect(screen.queryByText('400')).not.toBeInTheDocument()
    expect(screen.getByText('blocked')).toBeInTheDocument()
  })
})

describe('ModalContextProvider plugin update modal', () => {
  beforeEach(() => {
    mockConsoleStateReader.mockReset()
    mockConsoleStateReader.mockReturnValue({
      currentWorkspace: {
        id: 'workspace-1',
      },
    })
  })

  it('keeps a model plugin update open until its refresh callback finishes', async () => {
    let resolveSave: (() => void) | undefined
    const onSave = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve
        }),
    )
    const user = userEvent.setup()

    renderProvider(<UpdatePluginTrigger onSave={onSave} />)

    await user.click(screen.getByRole('button', { name: 'Open plugin update' }))
    await user.click(screen.getByTestId('save-plugin-update'))

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('save-plugin-update')).toBeInTheDocument()

    resolveSave?.()

    await waitFor(() => {
      expect(screen.queryByTestId('save-plugin-update')).not.toBeInTheDocument()
    })
  })

  it('closes a non-model plugin update immediately after saving', async () => {
    const onSave = vi.fn()
    const user = userEvent.setup()

    renderProvider(<UpdatePluginTrigger onSave={onSave} category={PluginCategoryEnum.tool} />)

    await user.click(screen.getByRole('button', { name: 'Open plugin update' }))
    await user.click(screen.getByTestId('save-plugin-update'))

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('save-plugin-update')).not.toBeInTheDocument()
  })
})
