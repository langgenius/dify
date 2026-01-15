import type { Mock } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { useAppContext } from '@/context/app-context'
import Toast from '../../../../base/toast'
import { contactSalesUrl, getStartedWithCommunityUrl, getWithPremiumUrl } from '../../../config'
import { SelfHostedPlan } from '../../../type'
import SelfHostedPlanItem from './index'

const featuresTranslations: Record<string, string[]> = {
  'billing.plans.community.features': ['community-feature-1', 'community-feature-2'],
  'billing.plans.premium.features': ['premium-feature-1'],
  'billing.plans.enterprise.features': ['enterprise-feature-1'],
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const prefix = options?.ns ? `${options.ns}.` : ''
      if (options?.returnObjects)
        return featuresTranslations[`${prefix}${key}`] || []
      return `${prefix}${key}`
    },
  }),
  Trans: ({ i18nKey, ns }: { i18nKey: string, ns?: string }) => <span>{ns ? `${ns}.${i18nKey}` : i18nKey}</span>,
}))

vi.mock('../../../../base/toast', () => ({
  default: {
    notify: vi.fn(),
  },
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: vi.fn(),
}))

vi.mock('../../assets', () => ({
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

afterAll(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: originalLocation,
  })
})

beforeEach(() => {
  vi.clearAllMocks()
  mockUseAppContext.mockReturnValue({ isCurrentWorkspaceManager: true })
  assignedHref = ''
})

describe('SelfHostedPlanItem', () => {
  // Copy rendering for each plan
  describe('Rendering', () => {
    it('should display community plan info', () => {
      render(<SelfHostedPlanItem plan={SelfHostedPlan.community} />)

      expect(screen.getByText('billing.plans.community.name')).toBeInTheDocument()
      expect(screen.getByText('billing.plans.community.description')).toBeInTheDocument()
      expect(screen.getByText('billing.plans.community.price')).toBeInTheDocument()
      expect(screen.getByText('billing.plans.community.includesTitle')).toBeInTheDocument()
      expect(screen.getByText('community-feature-1')).toBeInTheDocument()
    })

    it('should show premium extras such as cloud provider notice', () => {
      render(<SelfHostedPlanItem plan={SelfHostedPlan.premium} />)

      expect(screen.getByText('billing.plans.premium.price')).toBeInTheDocument()
      expect(screen.getByText('billing.plans.premium.comingSoon')).toBeInTheDocument()
    })
  })

  // CTA behavior for each plan
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
