import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { defaultPlan } from '@/app/components/billing/config'
import { Plan } from '@/app/components/billing/type'
import { ModalContextProvider } from '@/context/modal-context-provider'
import { renderWithNuqs } from '@/test/nuqs-testing'

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>()
  return {
    ...actual,
    IS_CLOUD_EDITION: true,
  }
})

vi.mock('@/next/navigation', () => ({
  useSearchParams: vi.fn(() => new URLSearchParams()),
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

const renderProvider = () => renderWithNuqs(
  <ModalContextProvider>
    <div data-testid="modal-context-test-child" />
  </ModalContextProvider>,
)

describe('ModalContextProvider trigger events limit modal', () => {
  beforeEach(() => {
    mockUseAppContext.mockReset()
    mockUseProviderContext.mockReset()
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
