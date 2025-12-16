import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import SelfHostedPlanItem from './index'
import { SelfHostedPlan } from '../../../type'
import { contactSalesUrl, getStartedWithCommunityUrl, getWithPremiumUrl } from '../../../config'
import { useAppContext } from '@/context/app-context'
import Toast from '../../../../base/toast'

const featuresTranslations: Record<string, string[]> = {
  'billing.plans.community.features': ['community-feature-1', 'community-feature-2'],
  'billing.plans.premium.features': ['premium-feature-1'],
  'billing.plans.enterprise.features': ['enterprise-feature-1'],
}

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (options?.returnObjects)
        return featuresTranslations[key] || []
      return key
    },
  }),
  Trans: ({ i18nKey }: { i18nKey: string }) => <span>{i18nKey}</span>,
}))

jest.mock('../../../../base/toast', () => ({
  __esModule: true,
  default: {
    notify: jest.fn(),
  },
}))

jest.mock('@/context/app-context', () => ({
  useAppContext: jest.fn(),
}))

jest.mock('../../assets', () => ({
  Community: () => <div>Community Icon</div>,
  Premium: () => <div>Premium Icon</div>,
  Enterprise: () => <div>Enterprise Icon</div>,
  PremiumNoise: () => <div>PremiumNoise</div>,
  EnterpriseNoise: () => <div>EnterpriseNoise</div>,
}))

jest.mock('@/app/components/base/icons/src/public/billing', () => ({
  Azure: () => <div>Azure</div>,
  GoogleCloud: () => <div>Google Cloud</div>,
  AwsMarketplaceDark: () => <div>AwsMarketplaceDark</div>,
  AwsMarketplaceLight: () => <div>AwsMarketplaceLight</div>,
}))

const mockUseAppContext = useAppContext as jest.Mock
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
  assignedHref = ''
})

describe('SelfHostedPlanItem', () => {
  // Copy rendering for each plan
  describe('Rendering', () => {
    test('should display community plan info', () => {
      render(<SelfHostedPlanItem plan={SelfHostedPlan.community} />)

      expect(screen.getByText('billing.plans.community.name')).toBeInTheDocument()
      expect(screen.getByText('billing.plans.community.description')).toBeInTheDocument()
      expect(screen.getByText('billing.plans.community.price')).toBeInTheDocument()
      expect(screen.getByText('billing.plans.community.includesTitle')).toBeInTheDocument()
      expect(screen.getByText('community-feature-1')).toBeInTheDocument()
    })

    test('should show premium extras such as cloud provider notice', () => {
      render(<SelfHostedPlanItem plan={SelfHostedPlan.premium} />)

      expect(screen.getByText('billing.plans.premium.price')).toBeInTheDocument()
      expect(screen.getByText('billing.plans.premium.comingSoon')).toBeInTheDocument()
      expect(screen.getByText('Azure')).toBeInTheDocument()
      expect(screen.getByText('Google Cloud')).toBeInTheDocument()
    })
  })

  // CTA behavior for each plan
  describe('CTA interactions', () => {
    test('should show toast when non-manager tries to proceed', () => {
      mockUseAppContext.mockReturnValue({ isCurrentWorkspaceManager: false })

      render(<SelfHostedPlanItem plan={SelfHostedPlan.premium} />)
      fireEvent.click(screen.getByRole('button', { name: /billing\.plans\.premium\.btnText/ }))

      expect(mockToastNotify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'error',
        message: 'billing.buyPermissionDeniedTip',
      }))
    })

    test('should redirect to community url when community plan button clicked', () => {
      render(<SelfHostedPlanItem plan={SelfHostedPlan.community} />)

      fireEvent.click(screen.getByRole('button', { name: 'billing.plans.community.btnText' }))
      expect(assignedHref).toBe(getStartedWithCommunityUrl)
    })

    test('should redirect to premium marketplace url when premium button clicked', () => {
      render(<SelfHostedPlanItem plan={SelfHostedPlan.premium} />)

      fireEvent.click(screen.getByRole('button', { name: /billing\.plans\.premium\.btnText/ }))
      expect(assignedHref).toBe(getWithPremiumUrl)
    })

    test('should redirect to contact sales form when enterprise button clicked', () => {
      render(<SelfHostedPlanItem plan={SelfHostedPlan.enterprise} />)

      fireEvent.click(screen.getByRole('button', { name: 'billing.plans.enterprise.btnText' }))
      expect(assignedHref).toBe(contactSalesUrl)
    })
  })
})
