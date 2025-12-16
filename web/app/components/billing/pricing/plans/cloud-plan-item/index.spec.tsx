import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import CloudPlanItem from './index'
import { Plan } from '../../../type'
import { PlanRange } from '../../plan-switcher/plan-range-switcher'
import { useAppContext } from '@/context/app-context'
import { useAsyncWindowOpen } from '@/hooks/use-async-window-open'
import { fetchBillingUrl, fetchSubscriptionUrls } from '@/service/billing'
import Toast from '../../../../base/toast'
import { ALL_PLANS } from '../../../config'

jest.mock('../../../../base/toast', () => ({
  __esModule: true,
  default: {
    notify: jest.fn(),
  },
}))

jest.mock('@/context/app-context', () => ({
  useAppContext: jest.fn(),
}))

jest.mock('@/service/billing', () => ({
  fetchBillingUrl: jest.fn(),
  fetchSubscriptionUrls: jest.fn(),
}))

jest.mock('@/hooks/use-async-window-open', () => ({
  useAsyncWindowOpen: jest.fn(),
}))

jest.mock('../../assets', () => ({
  Sandbox: () => <div>Sandbox Icon</div>,
  Professional: () => <div>Professional Icon</div>,
  Team: () => <div>Team Icon</div>,
}))

const mockUseAppContext = useAppContext as jest.Mock
const mockUseAsyncWindowOpen = useAsyncWindowOpen as jest.Mock
const mockFetchBillingUrl = fetchBillingUrl as jest.Mock
const mockFetchSubscriptionUrls = fetchSubscriptionUrls as jest.Mock
const mockToastNotify = Toast.notify as jest.Mock

let assignedHref = ''
const originalLocation = window.location

beforeAll(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      get href() {
        return assignedHref
      },
      set href(value: string) {
        assignedHref = value
      },
    } as unknown as Location,
  })
})

afterAll(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: originalLocation,
  })
})

beforeEach(() => {
  jest.clearAllMocks()
  mockUseAppContext.mockReturnValue({ isCurrentWorkspaceManager: true })
  mockUseAsyncWindowOpen.mockReturnValue(jest.fn(async open => await open()))
  mockFetchBillingUrl.mockResolvedValue({ url: 'https://billing.example' })
  mockFetchSubscriptionUrls.mockResolvedValue({ url: 'https://subscription.example' })
  assignedHref = ''
})

describe('CloudPlanItem', () => {
  // Static content for each plan
  describe('Rendering', () => {
    test('should show plan metadata and free label for sandbox plan', () => {
      render(
        <CloudPlanItem
          plan={Plan.sandbox}
          currentPlan={Plan.sandbox}
          planRange={PlanRange.monthly}
          canPay
        />,
      )

      expect(screen.getByText('billing.plans.sandbox.name')).toBeInTheDocument()
      expect(screen.getByText('billing.plans.sandbox.description')).toBeInTheDocument()
      expect(screen.getByText('billing.plansCommon.free')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'billing.plansCommon.currentPlan' })).toBeInTheDocument()
    })

    test('should display yearly pricing with discount when planRange is yearly', () => {
      render(
        <CloudPlanItem
          plan={Plan.professional}
          currentPlan={Plan.sandbox}
          planRange={PlanRange.yearly}
          canPay
        />,
      )

      const professionalPlan = ALL_PLANS[Plan.professional]
      expect(screen.getByText(`$${professionalPlan.price * 12}`)).toBeInTheDocument()
      expect(screen.getByText(`$${professionalPlan.price * 10}`)).toBeInTheDocument()
      expect(screen.getByText(/billing\.plansCommon\.priceTip.*billing\.plansCommon\.year/)).toBeInTheDocument()
    })

    test('should disable CTA when workspace already on higher tier', () => {
      render(
        <CloudPlanItem
          plan={Plan.professional}
          currentPlan={Plan.team}
          planRange={PlanRange.monthly}
          canPay
        />,
      )

      const button = screen.getByRole('button', { name: 'billing.plansCommon.startBuilding' })
      expect(button).toBeDisabled()
    })
  })

  // Payment actions triggered from the CTA
  describe('Plan purchase flow', () => {
    test('should show toast when non-manager tries to buy a plan', () => {
      mockUseAppContext.mockReturnValue({ isCurrentWorkspaceManager: false })

      render(
        <CloudPlanItem
          plan={Plan.professional}
          currentPlan={Plan.sandbox}
          planRange={PlanRange.monthly}
          canPay
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'billing.plansCommon.startBuilding' }))
      expect(mockToastNotify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'error',
        message: 'billing.buyPermissionDeniedTip',
      }))
      expect(mockFetchBillingUrl).not.toHaveBeenCalled()
    })

    test('should open billing portal when upgrading current paid plan', async () => {
      const openWindow = jest.fn(async (cb: () => Promise<string>) => await cb())
      mockUseAsyncWindowOpen.mockReturnValue(openWindow)

      render(
        <CloudPlanItem
          plan={Plan.professional}
          currentPlan={Plan.professional}
          planRange={PlanRange.monthly}
          canPay
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'billing.plansCommon.currentPlan' }))

      await waitFor(() => {
        expect(mockFetchBillingUrl).toHaveBeenCalledTimes(1)
      })
      expect(openWindow).toHaveBeenCalledTimes(1)
    })

    test('should redirect to subscription url when selecting a new paid plan', async () => {
      render(
        <CloudPlanItem
          plan={Plan.professional}
          currentPlan={Plan.sandbox}
          planRange={PlanRange.monthly}
          canPay
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'billing.plansCommon.startBuilding' }))

      await waitFor(() => {
        expect(mockFetchSubscriptionUrls).toHaveBeenCalledWith(Plan.professional, 'month')
        expect(assignedHref).toBe('https://subscription.example')
      })
    })
  })
})
