import { act, render, screen, waitFor } from '@testing-library/react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import * as React from 'react'
import { defaultPlan } from '@/app/components/billing/config'
import { Plan } from '@/app/components/billing/type'
import { ModalContextProvider } from '@/context/modal-context'

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>()
  return {
    ...actual,
    IS_CLOUD_EDITION: true,
  }
})

vi.mock('next/navigation', () => ({
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

let latestTriggerEventsModalProps: any = null
const triggerEventsLimitModalMock = vi.fn((props: any) => {
  latestTriggerEventsModalProps = props
  return (
    <div data-testid="trigger-limit-modal">
      <button type="button" onClick={props.onClose}>dismiss</button>
      <button type="button" onClick={props.onUpgrade}>upgrade</button>
    </div>
  )
})

vi.mock('@/app/components/billing/trigger-events-limit-modal', () => ({
  default: (props: any) => triggerEventsLimitModalMock(props),
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

const renderProvider = () => render(
  <NuqsTestingAdapter>
    <ModalContextProvider>
      <div data-testid="modal-context-test-child" />
    </ModalContextProvider>
  </NuqsTestingAdapter>,
)

describe('ModalContextProvider trigger events limit modal', () => {
  beforeEach(() => {
    latestTriggerEventsModalProps = null
    triggerEventsLimitModalMock.mockClear()
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

    renderProvider()

    await waitFor(() => expect(screen.getByTestId('trigger-limit-modal')).toBeInTheDocument())
    expect(latestTriggerEventsModalProps).toMatchObject({
      usage: 3000,
      total: 3000,
      resetInDays: 5,
    })

    act(() => {
      latestTriggerEventsModalProps.onClose()
    })

    await waitFor(() => expect(screen.queryByTestId('trigger-limit-modal')).not.toBeInTheDocument())
    await waitFor(() => {
      expect(setItemSpy.mock.calls.length).toBeGreaterThan(0)
    })
    const [key, value] = setItemSpy.mock.calls[0]
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

    renderProvider()

    await waitFor(() => expect(screen.getByTestId('trigger-limit-modal')).toBeInTheDocument())

    act(() => {
      latestTriggerEventsModalProps.onClose()
    })

    await waitFor(() => expect(screen.queryByTestId('trigger-limit-modal')).not.toBeInTheDocument())
    expect(setItemSpy).not.toHaveBeenCalled()
    await waitFor(() => expect(triggerEventsLimitModalMock).toHaveBeenCalledTimes(1))
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

    renderProvider()

    await waitFor(() => expect(screen.getByTestId('trigger-limit-modal')).toBeInTheDocument())

    act(() => {
      latestTriggerEventsModalProps.onClose()
    })

    await waitFor(() => expect(screen.queryByTestId('trigger-limit-modal')).not.toBeInTheDocument())
    await waitFor(() => expect(triggerEventsLimitModalMock).toHaveBeenCalledTimes(1))
  })
})
