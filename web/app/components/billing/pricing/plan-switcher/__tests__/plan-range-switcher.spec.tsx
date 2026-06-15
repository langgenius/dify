import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import PlanRangeSwitcher, { PlanRange } from '../plan-range-switcher'

describe('PlanRangeSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render the annual billing label', () => {
      render(<PlanRangeSwitcher value={PlanRange.monthly} onChange={vi.fn()} />)

      expect(screen.getByText(/billing\.plansCommon\.annualBilling/)).toBeInTheDocument()
      expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
    })
  })

  describe('Props', () => {
    it('should switch to yearly when toggled from monthly', () => {
      const handleChange = vi.fn()
      render(<PlanRangeSwitcher value={PlanRange.monthly} onChange={handleChange} />)

      fireEvent.click(screen.getByRole('switch'))

      expect(handleChange).toHaveBeenCalledTimes(1)
      expect(handleChange).toHaveBeenCalledWith(PlanRange.yearly)
    })

    it('should switch to monthly when toggled from yearly', () => {
      const handleChange = vi.fn()
      render(<PlanRangeSwitcher value={PlanRange.yearly} onChange={handleChange} />)

      fireEvent.click(screen.getByRole('switch'))

      expect(handleChange).toHaveBeenCalledTimes(1)
      expect(handleChange).toHaveBeenCalledWith(PlanRange.monthly)
    })
  })

  describe('Edge Cases', () => {
    it('should render label with translation key and params', () => {
      render(<PlanRangeSwitcher value={PlanRange.monthly} onChange={vi.fn()} />)

      const label = screen.getByText(/billing\.plansCommon\.annualBilling/)
      expect(label).toBeInTheDocument()
      expect(label.textContent).toContain('percent')
    })
  })
})
