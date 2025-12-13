import React from 'react'
import { render, screen } from '@testing-library/react'
import Empty from './empty'

// Mock react-i18next
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'app.newApp.noAppsFound': 'No apps found',
      }
      return translations[key] || key
    },
  }),
}))

describe('Empty', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<Empty />)
      expect(screen.getByText(/no apps found/i)).toBeInTheDocument()
    })

    it('should render 36 placeholder cards', () => {
      const { container } = render(<Empty />)
      const placeholderCards = container.querySelectorAll('.bg-background-default-lighter')
      expect(placeholderCards).toHaveLength(36)
    })

    it('should display the no apps found message', () => {
      render(<Empty />)
      // Use pattern matching for resilient text assertions
      expect(screen.getByText(/no apps found/i)).toBeInTheDocument()
    })
  })

  describe('Styling', () => {
    it('should have correct container styling for overlay', () => {
      const { container } = render(<Empty />)
      const overlay = container.querySelector('.pointer-events-none')
      expect(overlay).toBeInTheDocument()
      expect(overlay).toHaveClass('absolute', 'inset-0', 'z-20')
    })

    it('should have correct styling for placeholder cards', () => {
      const { container } = render(<Empty />)
      const card = container.querySelector('.bg-background-default-lighter')
      expect(card).toHaveClass('inline-flex', 'h-[160px]', 'rounded-xl')
    })
  })

  describe('Edge Cases', () => {
    it('should handle multiple renders without issues', () => {
      const { rerender } = render(<Empty />)
      expect(screen.getByText(/no apps found/i)).toBeInTheDocument()

      rerender(<Empty />)
      expect(screen.getByText(/no apps found/i)).toBeInTheDocument()
    })
  })
})
