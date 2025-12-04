import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import PlanComp from './index'
import { Plan, type UsagePlanInfo, type UsageResetInfo } from '../type'
import { NUM_INFINITE } from '../config'
import { getDaysUntilEndOfMonth } from '@/utils/time'
import { EDUCATION_VERIFYING_LOCALSTORAGE_ITEM } from '@/app/education-apply/constants'

const pushMock = jest.fn()
let pathnameMock = '/'
const setShowAccountSettingModal = jest.fn() as (value: unknown) => void
const mutateAsync = jest.fn<Promise<{ token: string }>, []>()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => pathnameMock,
}))

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

type MockPlan = {
  type: Plan
  usage: UsagePlanInfo
  total: UsagePlanInfo
  reset: UsageResetInfo
}

type PlanOverrides = {
  type?: Plan
  usage?: Partial<UsagePlanInfo>
  total?: Partial<UsagePlanInfo>
  reset?: Partial<UsageResetInfo>
}

type MockProviderContext = {
  plan: MockPlan
  enableEducationPlan: boolean
  allowRefreshEducationVerify: boolean
  isEducationAccount: boolean
}

type ProviderOverrides = {
  plan?: PlanOverrides
  enableEducationPlan?: boolean
  allowRefreshEducationVerify?: boolean
  isEducationAccount?: boolean
}

const baseUsage: UsagePlanInfo = {
  buildApps: 1,
  teamMembers: 2,
  annotatedResponse: 3,
  documentsUploadQuota: 4,
  apiRateLimit: 5,
  triggerEvents: 6,
  vectorSpace: 7,
}

const baseReset: UsageResetInfo = {
  apiRateLimit: 2,
  triggerEvents: 3,
}

const createProviderValue = (overrides?: ProviderOverrides): MockProviderContext => {
  const planOverrides = overrides?.plan ?? {}
  return {
    plan: {
      type: planOverrides.type ?? Plan.professional,
      usage: { ...baseUsage, ...planOverrides.usage },
      total: { ...baseUsage, ...planOverrides.total },
      reset: { ...baseReset, ...planOverrides.reset },
    },
    enableEducationPlan: overrides?.enableEducationPlan ?? false,
    allowRefreshEducationVerify: overrides?.allowRefreshEducationVerify ?? false,
    isEducationAccount: overrides?.isEducationAccount ?? false,
  }
}

let providerValue = createProviderValue()

jest.mock('@/context/provider-context', () => ({
  useProviderContext: jest.fn(() => providerValue),
}))

jest.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    userProfile: { email: 'user@example.com' },
  }),
}))

jest.mock('@/context/modal-context', () => ({
  useModalContextSelector: jest.fn((selector: (state: { setShowAccountSettingModal: typeof setShowAccountSettingModal }) => unknown) =>
    selector({ setShowAccountSettingModal })),
}))

jest.mock('@/service/use-education', () => ({
  useEducationVerify: jest.fn(() => ({
    mutateAsync,
    isPending: false,
  })),
}))

type UsageInfoProps = {
  name: string
  resetInDays?: number
}

const usageInfoMock = jest.fn((props: UsageInfoProps) => (
  <div data-testid={`usage-${props.name}`}>{String(props.resetInDays ?? 'none')}</div>
))

jest.mock('@/app/components/billing/usage-info', () => (props: UsageInfoProps) => usageInfoMock(props))
jest.mock('../usage-info/vector-space-info', () => () => <div data-testid='vector-space-info' />)
jest.mock('../usage-info/apps-info', () => () => <div data-testid='apps-info' />)
jest.mock('../upgrade-btn', () => (props: Record<string, unknown>) => <button data-testid='upgrade-btn' {...props} />)
jest.mock('@/app/education-apply/verify-state-modal', () => (props: { isShow: boolean }) => (
  <div data-testid='verify-modal'>{String(props.isShow)}</div>
))

const renderComponent = (loc = 'from-test') => render(<PlanComp loc={loc} />)

describe('PlanComp', () => {
  // Reset shared mocks and default provider state
  beforeEach(() => {
    jest.clearAllMocks()
    localStorage.clear()
    pathnameMock = '/'
    providerValue = createProviderValue()
    mutateAsync.mockReset()
  })

  describe('quota reset display', () => {
    // Shows reset countdowns for quotas when present
    it('should render reset days for professional plan quotas', () => {
      renderComponent()

      expect(screen.getByTestId('usage-billing.usagePage.triggerEvents')).toHaveTextContent('3')
      expect(screen.getByTestId('usage-billing.plansCommon.apiRateLimit')).toHaveTextContent('2')
    })

    // Falls back to end-of-month reset for sandbox API limit without explicit reset
    it('should fallback to end-of-month reset for sandbox api rate limit', () => {
      providerValue = createProviderValue({
        plan: {
          type: Plan.sandbox,
          total: { apiRateLimit: 10 } as UsagePlanInfo,
          reset: { apiRateLimit: undefined },
        },
      })

      renderComponent()

      expect(screen.getByTestId('usage-billing.plansCommon.apiRateLimit')).toHaveTextContent(
        String(getDaysUntilEndOfMonth()),
      )
    })

    // Hides reset countdown when trigger events are unlimited
    it('should omit reset days when trigger events are unlimited', () => {
      providerValue = createProviderValue({
        plan: {
          total: { triggerEvents: NUM_INFINITE } as UsagePlanInfo,
        },
      })

      renderComponent()

      expect(screen.getByTestId('usage-billing.usagePage.triggerEvents')).toHaveTextContent('none')
    })
  })

  describe('education verification flow', () => {
    // Navigates to education verify page after successful verification
    it('should navigate to education apply when verification succeeds', async () => {
      providerValue = createProviderValue({
        enableEducationPlan: true,
        isEducationAccount: false,
      })
      mutateAsync.mockResolvedValueOnce({ token: 'abc123' })
      localStorage.setItem(EDUCATION_VERIFYING_LOCALSTORAGE_ITEM, 'true')

      renderComponent()

      fireEvent.click(screen.getByRole('button', { name: 'education.toVerified' }))

      await waitFor(() => {
        expect(pushMock).toHaveBeenCalledWith('/education-apply?token=abc123')
      })
      expect(localStorage.getItem(EDUCATION_VERIFYING_LOCALSTORAGE_ITEM)).toBeNull()
    })

    // Shows rejection modal when verification fails
    it('should show verify modal when verification fails', async () => {
      providerValue = createProviderValue({
        enableEducationPlan: true,
        allowRefreshEducationVerify: true,
      })
      mutateAsync.mockRejectedValueOnce(new Error('fail'))

      renderComponent()

      fireEvent.click(screen.getByRole('button', { name: 'education.toVerified' }))

      await waitFor(() => {
        expect(screen.getByTestId('verify-modal')).toHaveTextContent('true')
      })
      expect(pushMock).not.toHaveBeenCalled()
    })
  })

  describe('navigation guard for education apply path', () => {
    // Clears account setting modal when already on education apply pages
    it('should clear account setting modal when on education apply path', () => {
      pathnameMock = '/education-apply/step'

      renderComponent()

      expect(setShowAccountSettingModal).toHaveBeenCalledWith(null)
    })
  })
})
