import type { Mock } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { useAppContext } from '@/context/app-context'
import Toast from '../../../../../base/toast'
import { contactSalesUrl, getStartedWithCommunityUrl, getWithPremiumUrl } from '../../../../config'
import { SelfHostedPlan } from '../../../../type'
import SelfHostedPlanItem from '../index'

vi.mock('../list', () => ({
  default: ({ plan }: { plan: string }) => (
    <div data-testid={`list-${plan}`}>
      List for
      {plan}
    </div>
  ),
}))

vi.mock('../../../../../base/toast', () => ({
  default: {
    notify: vi.fn(),
  },
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: vi.fn(),
}))

vi.mock('../../../assets', () => ({
  Community: () => <div>Community Icon</div>,
  Premium: () => <div>Premium Icon</div>,
  Enterprise: () => <div>Enterprise Icon</div>,
  PremiumNoise: () => <div>PremiumNoise</div>,
  EnterpriseNoise: () => <div>EnterpriseNoise</div>,
}))

const mockUseAppContext = useAppContext as Mock
const mockToastNotify = Toast.notify as Mock

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

beforeEach(() => {
  vi.clearAllMocks()
  mockUseAppContext.mockReturnValue({ isCurrentWorkspaceManager: true })
  assignedHref = ''
})

afterAll(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: originalLocation,
  })
})

describe('SelfHostedPlanItem', () => {
  describe('Rendering', () => {
    it('should display community plan info', () => {
      render(<SelfHostedPlanItem plan={SelfHostedPlan.community} />)

      expect(screen.getByText('billing.plans.community.name')).toBeInTheDocument()
      expect(screen.getByText('billing.plans.community.description')).toBeInTheDocument()
      expect(screen.getByText('billing.plans.community.price')).toBeInTheDocument()
      expect(screen.getByTestId('list-community')).toBeInTheDocument()
    })

    it('should show premium extras such as cloud provider notice', () => {
      render(<SelfHostedPlanItem plan={SelfHostedPlan.premium} />)

      expect(screen.getByText('billing.plans.premium.price')).toBeInTheDocument()
      expect(screen.getByText('billing.plans.premium.comingSoon')).toBeInTheDocument()
    })
  })

  describe('CTA interactions', () => {
    it('should show toast when non-manager tries to proceed', () => {
      mockUseAppContext.mockReturnValue({ isCurrentWorkspaceManager: false })

      render(<SelfHostedPlanItem plan={SelfHostedPlan.premium} />)
      fireEvent.click(screen.getByRole('button', { name: /billing\.plans\.premium\.btnText/ }))

      expect(mockToastNotify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'error',
        message: 'billing.buyPermissionDeniedTip',
      }))
    })

    it('should redirect to community url when community plan button clicked', () => {
      render(<SelfHostedPlanItem plan={SelfHostedPlan.community} />)

      fireEvent.click(screen.getByRole('button', { name: 'billing.plans.community.btnText' }))
      expect(assignedHref).toBe(getStartedWithCommunityUrl)
    })

    it('should redirect to premium marketplace url when premium button clicked', () => {
      render(<SelfHostedPlanItem plan={SelfHostedPlan.premium} />)

      fireEvent.click(screen.getByRole('button', { name: /billing\.plans\.premium\.btnText/ }))
      expect(assignedHref).toBe(getWithPremiumUrl)
    })

    it('should redirect to contact sales form when enterprise button clicked', () => {
      render(<SelfHostedPlanItem plan={SelfHostedPlan.enterprise} />)

      fireEvent.click(screen.getByRole('button', { name: 'billing.plans.enterprise.btnText' }))
      expect(assignedHref).toBe(contactSalesUrl)
    })
  })
})
