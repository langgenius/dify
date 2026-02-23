import { render, screen } from '@testing-library/react'
import { DaysOfWeek } from './days-of-week'

describe('DaysOfWeek', () => {
  // Rendering test
  describe('Rendering', () => {
    it('should render 7 day labels', () => {
      render(<DaysOfWeek />)

      // The global i18n mock returns keys like "time.daysInWeek.Sun"
      const dayElements = screen.getAllByText(/daysInWeek/)
      expect(dayElements).toHaveLength(7)
    })

    it('should render each day of the week', () => {
      render(<DaysOfWeek />)

      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      days.forEach((day) => {
        expect(screen.getByText(new RegExp(day))).toBeInTheDocument()
      })
    })
  })
})
