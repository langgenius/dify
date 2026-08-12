import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { defaultPlan } from '@/app/components/billing/config'
import { PluginCategoryEnum, PluginSource } from '@/app/components/plugins/types'
import { useModalContextSelector } from '@/context/modal-context'
import { ModalContextProvider } from '@/context/modal-context-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { render } from '@/test/console/render'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}))

vi.mock('@/app/components/billing/pricing', () => ({
  default: () => <div>billing.plansCommon.mostPopular</div>,
}))

vi.mock('@/app/components/plugins/update-plugin', () => ({
  default: ({ onSave }: { onSave: () => void | Promise<void> }) => (
    <button data-testid="save-plugin-update" onClick={onSave}>
      Save plugin update
    </button>
  ),
}))

const mockUseProviderContext = vi.fn()
vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => mockUseProviderContext(),
}))

const mockConsoleStateReader = vi.fn()

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => mockConsoleStateReader())
})

type DefaultPlanShape = typeof defaultPlan
type ResetShape = {
  apiRateLimit: number | null
  triggerEvents: number | null
}
type PlanShape = Omit<DefaultPlanShape, 'type' | 'reset'> & {
  type: CloudPlan
  reset: ResetShape
}
type PlanOverrides = Partial<Omit<DefaultPlanShape, 'type' | 'usage' | 'total' | 'reset'>> & {
  type?: CloudPlan
  usage?: Partial<DefaultPlanShape['usage']>
  total?: Partial<DefaultPlanShape['total']>
  reset?: Partial<ResetShape>
}

const createPlan = (overrides: PlanOverrides = {}): PlanShape => ({
  ...defaultPlan,
  ...overrides,
  usage: {
    ...defaultPlan.usage,
    ...overrides.usage,
  },
  total: {
    ...defaultPlan.total,
    ...overrides.total,
  },
  reset: {
    ...defaultPlan.reset,
    ...overrides.reset,
  },
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

const renderProvider = (children: React.ReactNode = <ModalBlockingState />) => {
  const { wrapper: QueryWrapper } = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: 'CLOUD' },
  })
  const { wrapper: NuqsWrapper } = createNuqsTestWrapper()
  const wrapper = ({ children: wrapperChildren }: { children: React.ReactNode }) => (
    <QueryWrapper>
      <NuqsWrapper>{wrapperChildren}</NuqsWrapper>
    </QueryWrapper>
  )

  return render(<ModalContextProvider>{children}</ModalContextProvider>, { wrapper })
}

describe('ModalContextProvider trigger events limit modal', () => {
  beforeEach(() => {
    mockConsoleStateReader.mockReset()
    mockUseProviderContext.mockReset()
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

  it('opens the trigger events limit modal and persists dismissal in localStorage', async () => {
    const plan = createPlan({
      type: 'professional',
      usage: { triggerEvents: 3000 },
      total: { triggerEvents: 3000 },
      reset: { triggerEvents: 5 },
    })
    mockUseProviderContext.mockReturnValue({
      plan,
      isFetchedPlan: true,
    })
    // Note: vitest.setup.ts replaces localStorage with a mock object that has vi.fn() methods
    // We need to spy on the mock's setItem, not Storage.prototype.setItem
    const setItemSpy = vi.spyOn(localStorage, 'setItem')
    const user = userEvent.setup()

    renderProvider()

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
    const plan = createPlan({
      type: 'professional',
      usage: { triggerEvents: 200 },
      total: { triggerEvents: 200 },
      reset: { triggerEvents: 3 },
    })
    mockUseProviderContext.mockReturnValue({
      plan,
      isFetchedPlan: true,
    })
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('Storage disabled')
    })
    const setItemSpy = vi.spyOn(localStorage, 'setItem')
    const user = userEvent.setup()

    const { rerender } = renderProvider()

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
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  it('falls back to the in-memory guard when localStorage.setItem fails', async () => {
    const plan = createPlan({
      type: 'professional',
      usage: { triggerEvents: 120 },
      total: { triggerEvents: 120 },
      reset: { triggerEvents: 2 },
    })
    mockUseProviderContext.mockReturnValue({
      plan,
      isFetchedPlan: true,
    })
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded')
    })
    const user = userEvent.setup()

    const { rerender } = renderProvider()

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
    const plan = createPlan({
      type: 'professional',
      usage: { triggerEvents: 400 },
      total: { triggerEvents: 400 },
      reset: { triggerEvents: 6 },
    })
    mockUseProviderContext.mockReturnValue({
      plan,
      isFetchedPlan: true,
    })
    const user = userEvent.setup()

    renderProvider()

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
    mockUseProviderContext.mockReset()
    mockConsoleStateReader.mockReturnValue({
      currentWorkspace: {
        id: 'workspace-1',
      },
    })
    mockUseProviderContext.mockReturnValue({
      plan: createPlan(),
      isFetchedPlan: false,
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
