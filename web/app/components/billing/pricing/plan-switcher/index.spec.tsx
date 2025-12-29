import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { CategoryEnum } from '../index'
import PlanSwitcher from './index'
import { PlanRange } from './plan-range-switcher'

let mockTranslations: Record<string, string> = {}

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, options?: { ns?: string }) => {
        if (key in mockTranslations)
          return mockTranslations[key]
        const prefix = options?.ns ? `${options.ns}.` : ''
        return `${prefix}${key}`
      },
    }),
  }
})

describe('PlanSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTranslations = {}
  })

  // Rendering behavior
  describe('Rendering', () => {
    it('should render category tabs and plan range switcher for cloud', () => {
      // Arrange
      render(
        <PlanSwitcher
          currentCategory={CategoryEnum.CLOUD}
          currentPlanRange={PlanRange.monthly}
          onChangeCategory={vi.fn()}
          onChangePlanRange={vi.fn()}
        />,
      )

      // Assert
      expect(screen.getByText('billing.plansCommon.cloud')).toBeInTheDocument()
      expect(screen.getByText('billing.plansCommon.self')).toBeInTheDocument()
      expect(screen.getByRole('switch')).toBeInTheDocument()
    })
  })

  // Prop-driven behavior
  describe('Props', () => {
    it('should call onChangeCategory when selecting a tab', () => {
      // Arrange
      const handleChangeCategory = vi.fn()
      render(
        <PlanSwitcher
          currentCategory={CategoryEnum.CLOUD}
          currentPlanRange={PlanRange.monthly}
          onChangeCategory={handleChangeCategory}
          onChangePlanRange={vi.fn()}
        />,
      )

      // Act
      fireEvent.click(screen.getByText('billing.plansCommon.self'))

      // Assert
      expect(handleChangeCategory).toHaveBeenCalledTimes(1)
      expect(handleChangeCategory).toHaveBeenCalledWith(CategoryEnum.SELF)
    })

    it('should hide plan range switcher when category is self-hosted', () => {
      // Arrange
      render(
        <PlanSwitcher
          currentCategory={CategoryEnum.SELF}
          currentPlanRange={PlanRange.yearly}
          onChangeCategory={vi.fn()}
          onChangePlanRange={vi.fn()}
        />,
      )

      // Assert
      expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    })
  })

  // Edge case rendering behavior
  describe('Edge Cases', () => {
    it('should render tabs when translation strings are empty', () => {
      // Arrange
      mockTranslations = {
        'plansCommon.cloud': '',
        'plansCommon.self': '',
      }

      // Act
      const { container } = render(
        <PlanSwitcher
          currentCategory={CategoryEnum.SELF}
          currentPlanRange={PlanRange.monthly}
          onChangeCategory={vi.fn()}
          onChangePlanRange={vi.fn()}
        />,
      )

      // Assert
      const labels = container.querySelectorAll('span')
      expect(labels).toHaveLength(2)
      expect(labels[0]?.textContent).toBe('')
      expect(labels[1]?.textContent).toBe('')
    })
  })
})
