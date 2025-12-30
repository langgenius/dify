import { render, screen } from '@testing-library/react'
import * as React from 'react'
import { CategoryEnum } from '.'
import Footer from './footer'

let mockTranslations: Record<string, string> = {}

vi.mock('next/link', () => ({
  default: ({ children, href, className, target }: { children: React.ReactNode, href: string, className?: string, target?: string }) => (
    <a href={href} className={className} target={target} data-testid="pricing-link">
      {children}
    </a>
  ),
}))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, options?: { ns?: string }) => {
        if (mockTranslations[key])
          return mockTranslations[key]
        const prefix = options?.ns ? `${options.ns}.` : ''
        return `${prefix}${key}`
      },
    }),
  }
})

describe('Footer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTranslations = {}
  })

  // Rendering behavior
  describe('Rendering', () => {
    it('should render tax tips and comparison link when in cloud category', () => {
      // Arrange
      render(<Footer pricingPageURL="https://dify.ai/pricing#plans-and-features" currentCategory={CategoryEnum.CLOUD} />)

      // Assert
      expect(screen.getByText('billing.plansCommon.taxTip')).toBeInTheDocument()
      expect(screen.getByText('billing.plansCommon.taxTipSecond')).toBeInTheDocument()
      expect(screen.getByTestId('pricing-link')).toHaveAttribute('href', 'https://dify.ai/pricing#plans-and-features')
      expect(screen.getByText('billing.plansCommon.comparePlanAndFeatures')).toBeInTheDocument()
    })
  })

  // Prop-driven behavior
  describe('Props', () => {
    it('should hide tax tips when category is self-hosted', () => {
      // Arrange
      render(<Footer pricingPageURL="https://dify.ai/pricing#plans-and-features" currentCategory={CategoryEnum.SELF} />)

      // Assert
      expect(screen.queryByText('billing.plansCommon.taxTip')).not.toBeInTheDocument()
      expect(screen.queryByText('billing.plansCommon.taxTipSecond')).not.toBeInTheDocument()
    })
  })

  // Edge case rendering behavior
  describe('Edge Cases', () => {
    it('should render link even when pricing URL is empty', () => {
      // Arrange
      render(<Footer pricingPageURL="" currentCategory={CategoryEnum.CLOUD} />)

      // Assert
      expect(screen.getByTestId('pricing-link')).toHaveAttribute('href', '')
    })
  })
})
