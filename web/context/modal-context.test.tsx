import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useQueryState } from 'nuqs'
import * as React from 'react'
import { defaultPlan } from '@/app/components/billing/config'
import { Plan } from '@/app/components/billing/type'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import {
  settingsQueryParamName,
  settingsQueryParser,
} from '@/app/components/header/account-setting/query-params'
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

vi.mock('@/app/components/header/account-setting', () => ({
  default: ({ activeTab, onCancelAction }: { activeTab: string; onCancelAction: () => void }) => (
    <>
      <div role="status" aria-label="active account setting tab">
        {activeTab}
      </div>
      <button type="button" onClick={onCancelAction}>
        cancel account setting
      </button>
    </>
  ),
}))

vi.mock('@/app/components/integrations/modal', () => ({
  default: ({
    section,
    onCancel,
    onSectionChange,
  }: {
    section: string
    onCancel: () => void
    onSectionChange: (section: 'data-source') => void
  }) => (
    <>
      <div role="status" aria-label="active integration setting section">
        {section}
      </div>
      <button type="button" onClick={() => onSectionChange('data-source')}>
        switch integration section
      </button>
      <button type="button" onClick={onCancel}>
        cancel integration setting
      </button>
    </>
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

const renderProvider = (
  children: React.ReactNode = <div data-testid="modal-context-test-child" />,
  searchParams = '',
) => {
  const { wrapper: QueryWrapper } = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: 'CLOUD' },
  })
  const { wrapper: NuqsWrapper, onUrlUpdate } = createNuqsTestWrapper({ searchParams })
  const wrapper = ({ children: wrapperChildren }: { children: React.ReactNode }) => (
    <QueryWrapper>
      <NuqsWrapper>{wrapperChildren}</NuqsWrapper>
    </QueryWrapper>
  )

  return {
    ...render(<ModalContextProvider>{children}</ModalContextProvider>, { wrapper }),
    onUrlUpdate,
  }
}

const PreferencesOpener = () => {
  const [, setSettingsDestination] = useQueryState(settingsQueryParamName, settingsQueryParser)

  return (
    <button type="button" onClick={() => setSettingsDestination(ACCOUNT_SETTING_TAB.PREFERENCES)}>
      open preferences
    </button>
  )
}

const BlockingModalProbe = () => {
  const hasBlockingModalOpen = useModalContextSelector((state) => state.hasBlockingModalOpen)

  return <div data-testid="has-blocking-modal-open">{String(hasBlockingModalOpen)}</div>
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

  it('opens settings with push and closes them with replace', async () => {
    mockUseProviderContext.mockReturnValue({
      plan: createPlan(),
      isFetchedPlan: true,
    })
    const user = userEvent.setup()

    const { onUrlUpdate } = renderProvider(
      <>
        <BlockingModalProbe />
        <PreferencesOpener />
      </>,
    )

    expect(screen.getByTestId('has-blocking-modal-open')).toHaveTextContent('false')

    await user.click(screen.getByRole('button', { name: 'open preferences' }))

    expect(
      await screen.findByRole('status', { name: 'active account setting tab' }),
    ).toHaveTextContent(ACCOUNT_SETTING_TAB.PREFERENCES)
    expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('settings')).toBe('preferences')
    expect(onUrlUpdate.mock.calls.at(-1)?.[0].options.history).toBe('push')
    expect(onUrlUpdate.mock.calls.at(-1)?.[0].options.shallow).toBe(false)
    expect(screen.getByTestId('has-blocking-modal-open')).toHaveTextContent('true')

    await user.click(screen.getByRole('button', { name: 'cancel account setting' }))

    await waitFor(() => {
      expect(screen.getByTestId('has-blocking-modal-open')).toHaveTextContent('false')
    })
    expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.has('settings')).toBe(false)
    expect(onUrlUpdate.mock.calls.at(-1)?.[0].options.history).toBe('replace')
    expect(onUrlUpdate.mock.calls.at(-1)?.[0].options.shallow).toBe(true)
  })

  it('renders an integration destination and replaces history when switching sections', async () => {
    mockUseProviderContext.mockReturnValue({
      plan: createPlan(),
      isFetchedPlan: true,
    })
    const user = userEvent.setup()

    const { onUrlUpdate } = renderProvider(<BlockingModalProbe />, '?settings=provider')

    expect(
      await screen.findByRole('status', { name: 'active integration setting section' }),
    ).toHaveTextContent('provider')
    expect(screen.getByTestId('has-blocking-modal-open')).toHaveTextContent('true')

    await user.click(screen.getByRole('button', { name: 'switch integration section' }))

    expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('settings')).toBe('data-source')
    expect(onUrlUpdate.mock.calls.at(-1)?.[0].options.history).toBe('replace')
    expect(onUrlUpdate.mock.calls.at(-1)?.[0].options.shallow).toBe(true)
  })

  it('ignores invalid settings destinations', () => {
    mockUseProviderContext.mockReturnValue({
      plan: createPlan(),
      isFetchedPlan: true,
    })

    renderProvider(<BlockingModalProbe />, '?settings=unknown')

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByTestId('has-blocking-modal-open')).toHaveTextContent('false')
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

    await waitFor(() =>
      expect(screen.getByText('billing.plansCommon.mostPopular')).toBeInTheDocument(),
    )
    expect(screen.queryByText('400')).not.toBeInTheDocument()
  })
})
