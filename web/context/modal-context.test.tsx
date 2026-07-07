import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { defaultPlan } from '@/app/components/billing/config'
import { Plan } from '@/app/components/billing/type'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { useModalContextSelector } from '@/context/modal-context'
import { ModalContextProvider } from '@/context/modal-context-provider'
import { renderWithNuqs } from '@/test/nuqs-testing'

const mockSetEducationVerifying = vi.hoisted(() => vi.fn())

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>()
  return {
    ...actual,
    IS_CLOUD_EDITION: true,
  }
})

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}))

vi.mock('@/app/components/billing/pricing', () => ({
  default: () => <div>billing.plansCommon.mostPopular</div>,
}))

vi.mock('@/app/components/header/account-setting', () => ({
  default: ({ activeTab, onCancelAction }: { activeTab: string, onCancelAction: () => void }) => (
    <>
      <div data-testid="account-setting-active-tab">{activeTab}</div>
      <button type="button" onClick={onCancelAction}>cancel account setting</button>
    </>
  ),
}))

vi.mock('@/app/education-apply/storage', () => ({
  useSetEducationVerifying: () => mockSetEducationVerifying,
}))

const mockUseProviderContext = vi.fn()
vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => mockUseProviderContext(),
}))

const mockUseAppContext = vi.fn()
vi.mock('@/context/app-context', () => ({
  useAppContext: () => mockUseAppContext(),
}))

type DefaultPlanShape = typeof defaultPlan
type ResetShape = {
  apiRateLimit: number | null
  triggerEvents: number | null
}
type PlanShape = Omit<DefaultPlanShape, 'reset'> & { reset: ResetShape }
type PlanOverrides = Partial<Omit<DefaultPlanShape, 'usage' | 'total' | 'reset'>> & {
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

const renderProvider = (children: React.ReactNode = <div data-testid="modal-context-test-child" />) => renderWithNuqs(
  <ModalContextProvider>
    {children}
  </ModalContextProvider>,
)

const AccountSettingOpener = () => {
  const setShowAccountSettingModal = useModalContextSelector(state => state.setShowAccountSettingModal)

  return (
    <button
      type="button"
      onClick={() => setShowAccountSettingModal({ payload: ACCOUNT_SETTING_TAB.BILLING })}
    >
      open account setting
    </button>
  )
}

const PreferencesOpener = () => {
  const setShowAccountSettingModal = useModalContextSelector(state => state.setShowAccountSettingModal)

  return (
    <button
      type="button"
      onClick={() => setShowAccountSettingModal({ payload: ACCOUNT_SETTING_TAB.PREFERENCES })}
    >
      open preferences
    </button>
  )
}

const BlockingModalProbe = () => {
  const hasBlockingModalOpen = useModalContextSelector(state => state.hasBlockingModalOpen)

  return <div data-testid="has-blocking-modal-open">{String(hasBlockingModalOpen)}</div>
}

describe('ModalContextProvider trigger events limit modal', () => {
  beforeEach(() => {
    mockUseAppContext.mockReset()
    mockUseProviderContext.mockReset()
    mockSetEducationVerifying.mockReset()
    window.localStorage.clear()
    mockUseAppContext.mockReturnValue({
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
      type: Plan.professional,
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

    await user.click(screen.getByRole('button', { name: 'billing.triggerLimitModal.dismiss' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => {
      expect(setItemSpy.mock.calls.length).toBeGreaterThan(0)
    })
    const [key, value] = (setItemSpy.mock.calls[0] ?? []) as [string, string]
    expect(key).toContain('trigger-events-limit-dismissed-workspace-1-professional-3000-')
    expect(value).toBe('1')
  })

  it('clears the education verifying flag when account settings are canceled', async () => {
    mockUseProviderContext.mockReturnValue({
      plan: createPlan(),
      isFetchedPlan: true,
    })
    const user = userEvent.setup()

    renderProvider(<AccountSettingOpener />)

    await user.click(screen.getByRole('button', { name: 'open account setting' }))
    await user.click(await screen.findByRole('button', { name: 'cancel account setting' }))

    expect(mockSetEducationVerifying).toHaveBeenCalledWith(expect.any(Function))
    const updater = mockSetEducationVerifying.mock.calls[0]?.[0] as (educationVerifying: string) => string | null
    expect(updater('yes')).toBeNull()
    expect(updater('no')).toBe('no')
  })

  it('opens preferences in the account settings shell', async () => {
    mockUseProviderContext.mockReturnValue({
      plan: createPlan(),
      isFetchedPlan: true,
    })
    const user = userEvent.setup()

    renderProvider(
      <>
        <BlockingModalProbe />
        <PreferencesOpener />
      </>,
    )

    expect(screen.getByTestId('has-blocking-modal-open')).toHaveTextContent('false')

    await user.click(screen.getByRole('button', { name: 'open preferences' }))

    expect(await screen.findByTestId('account-setting-active-tab')).toHaveTextContent(ACCOUNT_SETTING_TAB.PREFERENCES)
    expect(screen.getByTestId('has-blocking-modal-open')).toHaveTextContent('true')

    await user.click(screen.getByRole('button', { name: 'cancel account setting' }))

    await waitFor(() => {
      expect(screen.getByTestId('has-blocking-modal-open')).toHaveTextContent('false')
    })
  })

  it('relies on the in-memory guard when localStorage reads throw', async () => {
    const plan = createPlan({
      type: Plan.professional,
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

    renderProvider()

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'billing.triggerLimitModal.dismiss' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  it('falls back to the in-memory guard when localStorage.setItem fails', async () => {
    const plan = createPlan({
      type: Plan.professional,
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

    renderProvider()

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'billing.triggerLimitModal.dismiss' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('closes the trigger events limit modal and opens pricing when upgrading', async () => {
    const plan = createPlan({
      type: Plan.professional,
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

    await waitFor(() => expect(screen.getByText('billing.plansCommon.mostPopular')).toBeInTheDocument())
    expect(screen.queryByText('400')).not.toBeInTheDocument()
  })
})
