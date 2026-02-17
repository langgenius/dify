import type { Mock } from 'vitest'
import type { UsagePlanInfo } from '../../type'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { useAppContext } from '@/context/app-context'
import { useGetPricingPageLanguage } from '@/context/i18n'
import { useProviderContext } from '@/context/provider-context'
import { Plan } from '../../type'
import Pricing from '../index'

let mockLanguage: string | null = 'en'

vi.mock('../plans/self-hosted-plan-item/list', () => ({
  default: ({ plan }: { plan: string }) => (
    <div data-testid={`list-${plan}`}>
      List for
      {plan}
    </div>
  ),
}))

vi.mock('next/link', () => ({
  default: ({ children, href, className, target }: { children: React.ReactNode, href: string, className?: string, target?: string }) => (
    <a href={href} className={className} target={target} data-testid="pricing-link">
      {children}
    </a>
  ),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: vi.fn(),
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: vi.fn(),
}))

vi.mock('@/context/i18n', () => ({
  useGetPricingPageLanguage: vi.fn(),
}))

const buildUsage = (): UsagePlanInfo => ({
  buildApps: 0,
  teamMembers: 0,
  annotatedResponse: 0,
  documentsUploadQuota: 0,
  apiRateLimit: 0,
  triggerEvents: 0,
  vectorSpace: 0,
})

describe('Pricing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLanguage = 'en'
    ;(useAppContext as Mock).mockReturnValue({ isCurrentWorkspaceManager: true })
    ;(useProviderContext as Mock).mockReturnValue({
      plan: {
        type: Plan.sandbox,
        usage: buildUsage(),
        total: buildUsage(),
      },
    })
    ;(useGetPricingPageLanguage as Mock).mockImplementation(() => mockLanguage)
  })

  describe('Rendering', () => {
    it('should render pricing header and localized footer link', () => {
      render(<Pricing onCancel={vi.fn()} />)

      expect(screen.getByText('billing.plansCommon.title.plans')).toBeInTheDocument()
      expect(screen.getByTestId('pricing-link')).toHaveAttribute('href', 'https://dify.ai/en/pricing#plans-and-features')
    })
  })

  describe('Props', () => {
    it('should allow switching categories and handle esc key', () => {
      const handleCancel = vi.fn()
      render(<Pricing onCancel={handleCancel} />)

      fireEvent.click(screen.getByText('billing.plansCommon.self'))
      expect(screen.queryByRole('switch')).not.toBeInTheDocument()

      fireEvent.keyDown(window, { key: 'Escape', keyCode: 27 })
      expect(handleCancel).toHaveBeenCalled()
    })
  })

  describe('Edge Cases', () => {
    it('should fall back to default pricing URL when language is empty', () => {
      mockLanguage = ''
      render(<Pricing onCancel={vi.fn()} />)

      expect(screen.getByTestId('pricing-link')).toHaveAttribute('href', 'https://dify.ai/pricing#plans-and-features')
    })
  })
})
