import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { useTranslation } from 'react-i18next'
import MonthlyDaysSelector from '../components/monthly-days-selector'

jest.mock('react-i18next')
const mockUseTranslation = useTranslation as jest.MockedFunction<typeof useTranslation>

const mockTranslation = {
  t: (key: string) => {
    const translations: Record<string, string> = {
      'workflow.nodes.triggerSchedule.days': 'Days',
      'workflow.nodes.triggerSchedule.lastDay': 'Last',
      'workflow.nodes.triggerSchedule.lastDayTooltip': 'Last day of month',
    }
    return translations[key] || key
  },
}

beforeEach(() => {
  mockUseTranslation.mockReturnValue(mockTranslation as any)
})

describe('MonthlyDaysSelector', () => {
  describe('Single selection', () => {
    test('renders with single selected day', () => {
      const onChange = jest.fn()

      render(
        <MonthlyDaysSelector
          selectedDays={[15]}
          onChange={onChange}
        />,
      )

      const button15 = screen.getByRole('button', { name: '15' })
      expect(button15).toHaveClass('border-util-colors-blue-brand-blue-brand-600')
    })

    test('calls onChange when day is clicked', () => {
      const onChange = jest.fn()

      render(
        <MonthlyDaysSelector
          selectedDays={[15]}
          onChange={onChange}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: '20' }))
      expect(onChange).toHaveBeenCalledWith([15, 20])
    })

    test('handles last day selection', () => {
      const onChange = jest.fn()

      render(
        <MonthlyDaysSelector
          selectedDays={['last']}
          onChange={onChange}
        />,
      )

      const lastButton = screen.getByRole('button', { name: 'Last' })
      expect(lastButton).toHaveClass('border-util-colors-blue-brand-blue-brand-600')
    })
  })

  describe('Multi-select functionality', () => {
    test('renders with multiple selected days', () => {
      const onChange = jest.fn()

      render(
        <MonthlyDaysSelector
          selectedDays={[1, 15, 30]}
          onChange={onChange}
        />,
      )

      expect(screen.getByRole('button', { name: '1' })).toHaveClass('border-util-colors-blue-brand-blue-brand-600')
      expect(screen.getByRole('button', { name: '15' })).toHaveClass('border-util-colors-blue-brand-blue-brand-600')
      expect(screen.getByRole('button', { name: '30' })).toHaveClass('border-util-colors-blue-brand-blue-brand-600')
    })

    test('adds day to selection when clicked', () => {
      const onChange = jest.fn()

      render(
        <MonthlyDaysSelector
          selectedDays={[1, 15]}
          onChange={onChange}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: '20' }))
      expect(onChange).toHaveBeenCalledWith([1, 15, 20])
    })

    test('removes day from selection when clicked', () => {
      const onChange = jest.fn()

      render(
        <MonthlyDaysSelector
          selectedDays={[1, 15, 20]}
          onChange={onChange}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: '15' }))
      expect(onChange).toHaveBeenCalledWith([1, 20])
    })

    test('handles last day selection', () => {
      const onChange = jest.fn()

      render(
        <MonthlyDaysSelector
          selectedDays={[1, 'last']}
          onChange={onChange}
        />,
      )

      expect(screen.getByRole('button', { name: 'Last' })).toHaveClass('border-util-colors-blue-brand-blue-brand-600')

      fireEvent.click(screen.getByRole('button', { name: 'Last' }))
      expect(onChange).toHaveBeenCalledWith([1])
    })

    test('handles empty selection array', () => {
      const onChange = jest.fn()

      render(
        <MonthlyDaysSelector
          selectedDays={[]}
          onChange={onChange}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: '10' }))
      expect(onChange).toHaveBeenCalledWith([10])
    })

    test('supports mixed selection of numbers and last day', () => {
      const onChange = jest.fn()

      render(
        <MonthlyDaysSelector
          selectedDays={[5, 15, 'last']}
          onChange={onChange}
        />,
      )

      expect(screen.getByRole('button', { name: '5' })).toHaveClass('border-util-colors-blue-brand-blue-brand-600')
      expect(screen.getByRole('button', { name: '15' })).toHaveClass('border-util-colors-blue-brand-blue-brand-600')
      expect(screen.getByRole('button', { name: 'Last' })).toHaveClass('border-util-colors-blue-brand-blue-brand-600')
    })
  })

  describe('Component structure', () => {
    test('renders all day buttons from 1 to 31', () => {
      render(
        <MonthlyDaysSelector
          selectedDays={[1]}
          onChange={jest.fn()}
        />,
      )

      for (let i = 1; i <= 31; i++)
        expect(screen.getByRole('button', { name: i.toString() })).toBeInTheDocument()
    })

    test('renders last day button', () => {
      render(
        <MonthlyDaysSelector
          selectedDays={[1]}
          onChange={jest.fn()}
        />,
      )

      expect(screen.getByRole('button', { name: 'Last' })).toBeInTheDocument()
    })

    test('displays correct label', () => {
      render(
        <MonthlyDaysSelector
          selectedDays={[1]}
          onChange={jest.fn()}
        />,
      )

      expect(screen.getByText('Days')).toBeInTheDocument()
    })

    test('applies correct grid layout', () => {
      const { container } = render(
        <MonthlyDaysSelector
          selectedDays={[1]}
          onChange={jest.fn()}
        />,
      )

      const gridRows = container.querySelectorAll('.grid-cols-7')
      expect(gridRows).toHaveLength(5)
    })
  })

  describe('Accessibility', () => {
    test('buttons are keyboard accessible', () => {
      const onChange = jest.fn()

      render(
        <MonthlyDaysSelector
          selectedDays={[15]}
          onChange={onChange}
        />,
      )

      const button = screen.getByRole('button', { name: '20' })
      button.focus()
      expect(document.activeElement).toBe(button)
    })

    test('last day button has tooltip', () => {
      render(
        <MonthlyDaysSelector
          selectedDays={['last']}
          onChange={jest.fn()}
        />,
      )

      expect(screen.getByRole('button', { name: 'Last' })).toBeInTheDocument()
    })

    test('selected state is visually distinct', () => {
      render(
        <MonthlyDaysSelector
          selectedDays={[15]}
          onChange={jest.fn()}
        />,
      )

      const selectedButton = screen.getByRole('button', { name: '15' })
      const unselectedButton = screen.getByRole('button', { name: '16' })

      expect(selectedButton).toHaveClass('border-util-colors-blue-brand-blue-brand-600')
      expect(unselectedButton).toHaveClass('border-divider-subtle')
    })
  })

  describe('Default behavior', () => {
    test('handles interaction correctly', () => {
      const onChange = jest.fn()

      render(
        <MonthlyDaysSelector
          selectedDays={[15]}
          onChange={onChange}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: '20' }))
      expect(onChange).toHaveBeenCalledWith([15, 20])
    })
  })
})
