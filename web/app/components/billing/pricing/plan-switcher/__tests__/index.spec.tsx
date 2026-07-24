import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { CategoryEnum } from '../../index'
import PlanSwitcher from '../index'
import { PlanRange } from '../plan-range-switcher'

describe('PlanSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render category tabs and plan range switcher for cloud', () => {
      render(
        <PlanSwitcher
          currentCategory={CategoryEnum.CLOUD}
          currentPlanRange={PlanRange.monthly}
          onChangeCategory={vi.fn()}
          onChangePlanRange={vi.fn()}
        />,
      )

      expect(screen.getByText('billing.plansCommon.cloud')).toBeInTheDocument()
      expect(screen.getByText('billing.plansCommon.self')).toBeInTheDocument()
      expect(screen.getByRole('switch')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should call onChangeCategory when selecting a tab', () => {
      const handleChangeCategory = vi.fn()
      render(
        <PlanSwitcher
          currentCategory={CategoryEnum.CLOUD}
          currentPlanRange={PlanRange.monthly}
          onChangeCategory={handleChangeCategory}
          onChangePlanRange={vi.fn()}
        />,
      )

      fireEvent.click(screen.getByText('billing.plansCommon.self'))

      expect(handleChangeCategory).toHaveBeenCalledTimes(1)
      expect(handleChangeCategory).toHaveBeenCalledWith(CategoryEnum.SELF)
    })

    it('should hide plan range switcher when category is self-hosted', () => {
      render(
        <PlanSwitcher
          currentCategory={CategoryEnum.SELF}
          currentPlanRange={PlanRange.yearly}
          onChangeCategory={vi.fn()}
          onChangePlanRange={vi.fn()}
        />,
      )

      expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should render tabs with translation keys', () => {
      const { container } = render(
        <PlanSwitcher
          currentCategory={CategoryEnum.SELF}
          currentPlanRange={PlanRange.monthly}
          onChangeCategory={vi.fn()}
          onChangePlanRange={vi.fn()}
        />,
      )

      const labels = container.querySelectorAll('span')
      expect(labels).toHaveLength(2)
      expect(labels[0]?.textContent).toBe('billing.plansCommon.cloud')
      expect(labels[1]?.textContent).toBe('billing.plansCommon.self')
    })
  })
})
