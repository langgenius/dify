import { render, screen } from '@testing-library/react'
import * as React from 'react'
import Empty from '../empty'

const defaultMessage = 'workflow.tabs.noSnippetsFound'

describe('Empty', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<Empty message={defaultMessage} />)
      expect(screen.getByText(defaultMessage)).toBeInTheDocument()
    })

    it('should render 36 placeholder cards', () => {
      const { container } = render(<Empty message={defaultMessage} />)
      const placeholderCards = container.querySelectorAll('.bg-background-default-lighter')
      expect(placeholderCards).toHaveLength(36)
    })

    it('should display the provided message', () => {
      render(<Empty message="app.newApp.noAppsFound" />)
      expect(screen.getByText('app.newApp.noAppsFound')).toBeInTheDocument()
    })
  })

  describe('Styling', () => {
    it('should have correct container styling for overlay', () => {
      const { container } = render(<Empty message={defaultMessage} />)
      const overlay = container.querySelector('.pointer-events-none')
      expect(overlay).toBeInTheDocument()
      expect(overlay).toHaveClass('absolute', 'inset-0', 'z-20')
    })

    it('should have correct styling for placeholder cards', () => {
      const { container } = render(<Empty message={defaultMessage} />)
      const card = container.querySelector('.bg-background-default-lighter')
      expect(card).toHaveClass('inline-flex', 'h-[160px]', 'rounded-xl')
    })
  })

  describe('Edge Cases', () => {
    it('should handle multiple renders without issues', () => {
      const { rerender } = render(<Empty message={defaultMessage} />)
      expect(screen.getByText(defaultMessage)).toBeInTheDocument()

      rerender(<Empty message="app.newApp.noAppsFound" />)
      expect(screen.getByText('app.newApp.noAppsFound')).toBeInTheDocument()
    })
  })
})
