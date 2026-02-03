import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import PlanRangeSwitcher, { PlanRange } from './plan-range-switcher'

let mockTranslations: Record<string, string> = {}

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

describe('PlanRangeSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTranslations = {}
  })

  // Rendering behavior
  describe('Rendering', () => {
    it('should render the annual billing label', () => {
      // Arrange
      render(<PlanRangeSwitcher value={PlanRange.monthly} onChange={vi.fn()} />)

      // Assert
      expect(screen.getByText('billing.plansCommon.annualBilling')).toBeInTheDocument()
      expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
    })
  })

  // Prop-driven behavior
  describe('Props', () => {
    it('should switch to yearly when toggled from monthly', () => {
      // Arrange
      const handleChange = vi.fn()
      render(<PlanRangeSwitcher value={PlanRange.monthly} onChange={handleChange} />)

      // Act
      fireEvent.click(screen.getByRole('switch'))

      // Assert
      expect(handleChange).toHaveBeenCalledTimes(1)
      expect(handleChange).toHaveBeenCalledWith(PlanRange.yearly)
    })

    it('should switch to monthly when toggled from yearly', () => {
      // Arrange
      const handleChange = vi.fn()
      render(<PlanRangeSwitcher value={PlanRange.yearly} onChange={handleChange} />)

      // Act
      fireEvent.click(screen.getByRole('switch'))

      // Assert
      expect(handleChange).toHaveBeenCalledTimes(1)
      expect(handleChange).toHaveBeenCalledWith(PlanRange.monthly)
    })
  })

  // Edge case rendering behavior
  describe('Edge Cases', () => {
    it('should render when the translation string is empty', () => {
      // Arrange
      mockTranslations = {
        'billing.plansCommon.annualBilling': '',
      }

      // Act
      const { container } = render(<PlanRangeSwitcher value={PlanRange.monthly} onChange={vi.fn()} />)

      // Assert
      const label = container.querySelector('span')
      expect(label).toBeInTheDocument()
      expect(label?.textContent).toBe('')
    })
  })
})
