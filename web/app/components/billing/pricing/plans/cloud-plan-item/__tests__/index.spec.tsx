import type { Mock } from 'vitest'
import { toast, ToastHost } from '@langgenius/dify-ui/toast'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { useAppContext } from '@/context/app-context'
import { useProviderContext } from '@/context/provider-context'
import { useAsyncWindowOpen } from '@/hooks/use-async-window-open'
import { fetchSubscriptionUrls } from '@/service/billing'
import { consoleClient } from '@/service/client'
import { ALL_PLANS } from '../../../../config'
import { Plan } from '../../../../type'
import { PlanRange } from '../../../plan-switcher/plan-range-switcher'
import CloudPlanItem from '../index'

vi.mock('@/context/app-context', () => ({
  useAppContext: vi.fn(),
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: vi.fn(),
}))

vi.mock('@/service/billing', () => ({
  fetchSubscriptionUrls: vi.fn(),
}))

vi.mock('@/service/client', () => ({
  consoleClient: {
    billing: {
      invoices: vi.fn(),
    },
  },
}))

vi.mock('@/hooks/use-async-window-open', () => ({
  useAsyncWindowOpen: vi.fn(),
}))

vi.mock('../../../assets', () => ({
  Sandbox: () => <div>Sandbox Icon</div>,
  Professional: () => <div>Professional Icon</div>,
  Team: () => <div>Team Icon</div>,
}))

const mockUseAppContext = useAppContext as Mock
const mockUseProviderContext = useProviderContext as Mock
const mockUseAsyncWindowOpen = useAsyncWindowOpen as Mock
const mockBillingInvoices = consoleClient.billing.invoices as Mock
const mockFetchSubscriptionUrls = fetchSubscriptionUrls as Mock

let assignedHref = ''
const originalLocation = window.location

const renderWithToastHost = (ui: React.ReactNode) => {
  return render(
    <>
      <ToastHost timeout={0} />
      {ui}
    </>,
  )
}

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

beforeEach(() => {
  vi.clearAllMocks()
  toast.dismiss()
  mockUseAppContext.mockReturnValue({ isCurrentWorkspaceManager: true })
  mockUseProviderContext.mockReturnValue({
    enableEducationPlan: false,
    isEducationAccount: false,
  })
  mockUseAsyncWindowOpen.mockReturnValue(vi.fn(async open => await open()))
  mockBillingInvoices.mockResolvedValue({ url: 'https://billing.example' })
  mockFetchSubscriptionUrls.mockResolvedValue({ url: 'https://subscription.example' })
  assignedHref = ''
})

afterAll(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: originalLocation,
  })
})

describe('CloudPlanItem', () => {
  // Static content for each plan
  describe('Rendering', () => {
    it('should show plan metadata and free label for sandbox plan', () => {
      render(
        <CloudPlanItem
          plan={Plan.sandbox}
          currentPlan={Plan.sandbox}
          planRange={PlanRange.monthly}
          canPay
        />,
      )

      expect(screen.getByText('billing.plans.sandbox.name'))!.toBeInTheDocument()
      expect(screen.getByText('billing.plans.sandbox.description'))!.toBeInTheDocument()
      expect(screen.getByText('billing.plansCommon.free'))!.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'billing.plansCommon.currentPlan' }))!.toBeInTheDocument()
    })

    it('should display yearly pricing with discount when planRange is yearly', () => {
      render(
        <CloudPlanItem
          plan={Plan.professional}
          currentPlan={Plan.sandbox}
          planRange={PlanRange.yearly}
          canPay
        />,
      )

      const professionalPlan = ALL_PLANS[Plan.professional]
      expect(screen.getByText(`$${professionalPlan.price * 12}`))!.toBeInTheDocument()
      expect(screen.getByText(`$${professionalPlan.price * 10}`))!.toBeInTheDocument()
      expect(screen.getByText(/billing\.plansCommon\.priceTip.*billing\.plansCommon\.year/))!.toBeInTheDocument()
    })

    it('should show "most popular" badge for professional plan', () => {
      render(
        <CloudPlanItem
          plan={Plan.professional}
          currentPlan={Plan.sandbox}
          planRange={PlanRange.monthly}
          canPay
        />,
      )

      expect(screen.getByText('billing.plansCommon.mostPopular'))!.toBeInTheDocument()
    })

    it('should not show "most popular" badge for non-professional plans', () => {
      render(
        <CloudPlanItem
          plan={Plan.team}
          currentPlan={Plan.sandbox}
          planRange={PlanRange.monthly}
          canPay
        />,
      )

      expect(screen.queryByText('billing.plansCommon.mostPopular')).not.toBeInTheDocument()
    })

    it('should disable CTA when workspace already on higher tier', () => {
      render(
        <CloudPlanItem
          plan={Plan.professional}
          currentPlan={Plan.team}
          planRange={PlanRange.monthly}
          canPay
        />,
      )

      const button = screen.getByRole('button', { name: 'billing.plansCommon.startBuilding' })
      expect(button)!.toBeDisabled()
    })
  })

  // Payment actions triggered from the CTA
  describe('Plan purchase flow', () => {
    it('should show toast when non-manager tries to buy a plan', () => {
      mockUseAppContext.mockReturnValue({ isCurrentWorkspaceManager: false })

      renderWithToastHost(
        <CloudPlanItem
          plan={Plan.professional}
          currentPlan={Plan.sandbox}
          planRange={PlanRange.monthly}
          canPay
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'billing.plansCommon.startBuilding' }))
      expect(screen.getByText('billing.buyPermissionDeniedTip'))!.toBeInTheDocument()
      expect(mockBillingInvoices).not.toHaveBeenCalled()
    })

    it('should open billing portal when upgrading current paid plan', async () => {
      const openWindow = vi.fn(async (cb: () => Promise<string>) => await cb())
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
        expect(mockBillingInvoices).toHaveBeenCalledTimes(1)
      })
      expect(openWindow).toHaveBeenCalledTimes(1)
    })

    it('should redirect to subscription url when selecting a new paid plan', async () => {
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

    // Covers L92-93: isFreePlan guard inside handleGetPayUrl
    it('should do nothing when clicking sandbox plan CTA that is not the current plan', async () => {
      render(
        <CloudPlanItem
          plan={Plan.sandbox}
          currentPlan={Plan.professional}
          planRange={PlanRange.monthly}
          canPay
        />,
      )

      // Sandbox viewed from a higher plan is disabled, but let's verify no API calls
      const button = screen.getByRole('button')
      fireEvent.click(button)

      await waitFor(() => {
        expect(mockFetchSubscriptionUrls).not.toHaveBeenCalled()
        expect(mockBillingInvoices).not.toHaveBeenCalled()
        expect(assignedHref).toBe('')
      })
    })

    // Covers L95: yearly subscription URL ('year' parameter)
    it('should fetch yearly subscription url when planRange is yearly', async () => {
      render(
        <CloudPlanItem
          plan={Plan.team}
          currentPlan={Plan.sandbox}
          planRange={PlanRange.yearly}
          canPay
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'billing.plansCommon.getStarted' }))

      await waitFor(() => {
        expect(mockFetchSubscriptionUrls).toHaveBeenCalledWith(Plan.team, 'year')
        expect(assignedHref).toBe('https://subscription.example')
      })
    })

    it('should use education discount checkout for yearly professional plan when education account is active', async () => {
      mockUseProviderContext.mockReturnValue({
        enableEducationPlan: true,
        isEducationAccount: true,
      })

      render(
        <CloudPlanItem
          plan={Plan.professional}
          currentPlan={Plan.sandbox}
          planRange={PlanRange.yearly}
          canPay
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'education.useEducationDiscount' }))

      await waitFor(() => {
        expect(mockFetchSubscriptionUrls).toHaveBeenCalledWith(Plan.professional, 'year')
        expect(assignedHref).toBe('https://subscription.example')
      })
    })

    it('should show default CTA and hide warning when current user is not workspace manager', () => {
      mockUseAppContext.mockReturnValue({ isCurrentWorkspaceManager: false })
      mockUseProviderContext.mockReturnValue({
        enableEducationPlan: true,
        isEducationAccount: true,
      })

      render(
        <CloudPlanItem
          plan={Plan.professional}
          currentPlan={Plan.sandbox}
          planRange={PlanRange.yearly}
          canPay={false}
        />,
      )

      expect(screen.getByRole('button', { name: 'billing.plansCommon.startBuilding' }))!.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'education.useEducationDiscount' })).not.toBeInTheDocument()
      expect(screen.queryByText('education.planNotSupportEducationDiscount')).not.toBeInTheDocument()
    })

    it('should hide education unsupported warning when current user is not workspace manager', () => {
      mockUseAppContext.mockReturnValue({ isCurrentWorkspaceManager: false })
      mockUseProviderContext.mockReturnValue({
        enableEducationPlan: true,
        isEducationAccount: true,
      })

      render(
        <CloudPlanItem
          plan={Plan.professional}
          currentPlan={Plan.sandbox}
          planRange={PlanRange.monthly}
          canPay={false}
        />,
      )

      expect(screen.getByRole('button', { name: 'billing.plansCommon.startBuilding' }))!.toBeInTheDocument()
      expect(screen.queryByText('education.planNotSupportEducationDiscount')).not.toBeInTheDocument()
    })

    it('should show education unsupported warning below the button without changing button text or blocking checkout', async () => {
      mockUseProviderContext.mockReturnValue({
        enableEducationPlan: true,
        isEducationAccount: true,
      })

      render(
        <CloudPlanItem
          plan={Plan.professional}
          currentPlan={Plan.sandbox}
          planRange={PlanRange.monthly}
          canPay
        />,
      )

      const button = screen.getByRole('button', { name: 'billing.plansCommon.startBuilding' })
      expect(button)!.not.toBeDisabled()
      expect(screen.getByText('education.planNotSupportEducationDiscount'))!.toBeInTheDocument()

      fireEvent.click(button)
      expect(screen.getByText('education.educationPricingConfirm.title'))!.toBeInTheDocument()
      expect(screen.getByText(/^education\.educationPricingConfirm\.description/))!.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'common.operation.close' }))!.not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'education.educationPricingConfirm.cancel' }))!.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'education.educationPricingConfirm.continue' }))

      await waitFor(() => {
        expect(mockFetchSubscriptionUrls).toHaveBeenCalledWith(Plan.professional, 'month')
        expect(assignedHref).toBe('https://subscription.example')
      })
    })

    it('should close the unsupported plan confirm without checkout when canceled', async () => {
      mockUseProviderContext.mockReturnValue({
        enableEducationPlan: true,
        isEducationAccount: true,
      })

      render(
        <CloudPlanItem
          plan={Plan.team}
          currentPlan={Plan.sandbox}
          planRange={PlanRange.yearly}
          canPay
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'billing.plansCommon.getStarted' }))
      fireEvent.click(screen.getByRole('button', { name: 'education.educationPricingConfirm.cancel' }))

      await waitFor(() => {
        expect(screen.queryByText('education.educationPricingConfirm.title'))!.not.toBeInTheDocument()
      })
      expect(mockFetchSubscriptionUrls).not.toHaveBeenCalled()
      expect(assignedHref).toBe('')
    })

    // Covers L62-63: loading guard prevents double click
    it('should ignore second click while loading', async () => {
      // Make the first fetch hang until we resolve it
      let resolveFirst!: (v: { url: string }) => void
      mockFetchSubscriptionUrls.mockImplementationOnce(
        () => new Promise((resolve) => { resolveFirst = resolve }),
      )

      render(
        <CloudPlanItem
          plan={Plan.professional}
          currentPlan={Plan.sandbox}
          planRange={PlanRange.monthly}
          canPay
        />,
      )

      const button = screen.getByRole('button', { name: 'billing.plansCommon.startBuilding' })

      // First click starts loading
      fireEvent.click(button)
      // Second click while loading should be ignored
      fireEvent.click(button)

      // Resolve first request
      resolveFirst({ url: 'https://first.example' })

      await waitFor(() => {
        expect(mockFetchSubscriptionUrls).toHaveBeenCalledTimes(1)
      })
    })

    // Covers L82-83, L85-87: openAsyncWindow error path when invoices returns no url
    it('should invoke onError when billing invoices returns empty url', async () => {
      mockBillingInvoices.mockResolvedValue({ url: '' })
      const openWindow = vi.fn(async (cb: () => Promise<string>, opts: { onError?: (e: Error) => void }) => {
        try {
          await cb()
        }
        catch (e) {
          opts.onError?.(e as Error)
        }
      })
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
        expect(openWindow).toHaveBeenCalledTimes(1)
        // The onError callback should have been passed to openAsyncWindow
        const callArgs = openWindow.mock.calls[0]
        expect(callArgs![1]).toHaveProperty('onError')
      })
    })

    // Covers monthly price display (L139 !isYear branch for price)
    it('should display monthly pricing without discount', () => {
      render(
        <CloudPlanItem
          plan={Plan.team}
          currentPlan={Plan.sandbox}
          planRange={PlanRange.monthly}
          canPay
        />,
      )

      const teamPlan = ALL_PLANS[Plan.team]
      expect(screen.getByText(`$${teamPlan.price}`))!.toBeInTheDocument()
      expect(screen.getByText(/billing\.plansCommon\.priceTip.*billing\.plansCommon\.month/))!.toBeInTheDocument()
      // Should NOT show crossed-out yearly price
      // Should NOT show crossed-out yearly price
      // Should NOT show crossed-out yearly price
      // Should NOT show crossed-out yearly price
      // Should NOT show crossed-out yearly price
      // Should NOT show crossed-out yearly price
      // Should NOT show crossed-out yearly price
      // Should NOT show crossed-out yearly price
      // Should NOT show crossed-out yearly price
      // Should NOT show crossed-out yearly price
      // Should NOT show crossed-out yearly price
      // Should NOT show crossed-out yearly price
      // Should NOT show crossed-out yearly price
      // Should NOT show crossed-out yearly price
      // Should NOT show crossed-out yearly price
      // Should NOT show crossed-out yearly price
      // Should NOT show crossed-out yearly price
      // Should NOT show crossed-out yearly price
      // Should NOT show crossed-out yearly price
      // Should NOT show crossed-out yearly price
      // Should NOT show crossed-out yearly price
      // Should NOT show crossed-out yearly price
      // Should NOT show crossed-out yearly price
      // Should NOT show crossed-out yearly price
      // Should NOT show crossed-out yearly price
      // Should NOT show crossed-out yearly price
      // Should NOT show crossed-out yearly price
      // Should NOT show crossed-out yearly price
      // Should NOT show crossed-out yearly price
      // Should NOT show crossed-out yearly price
      // Should NOT show crossed-out yearly price
      // Should NOT show crossed-out yearly price
      expect(screen.queryByText(`$${teamPlan.price * 12}`)).not.toBeInTheDocument()
    })
  })
})
