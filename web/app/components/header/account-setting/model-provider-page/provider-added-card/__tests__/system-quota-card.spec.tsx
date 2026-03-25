import { render, screen } from '@testing-library/react'
import SystemQuotaCard from '../system-quota-card'

describe('SystemQuotaCard', () => {
  // Renders container with children
  describe('Rendering', () => {
    it('should render children', () => {
      render(
        <SystemQuotaCard>
          <span>content</span>
        </SystemQuotaCard>,
      )

      expect(screen.getByText('content')).toBeInTheDocument()
    })

    it('should apply default variant styles', () => {
      const { container } = render(
        <SystemQuotaCard>
          <span>test</span>
        </SystemQuotaCard>,
      )

      const card = container.firstElementChild!
      expect(card.className).toContain('bg-white')
    })

    it('should apply destructive variant styles', () => {
      const { container } = render(
        <SystemQuotaCard variant="destructive">
          <span>test</span>
        </SystemQuotaCard>,
      )

      const card = container.firstElementChild!
      expect(card.className).toContain('border-state-destructive-border')
    })
  })

  // Label sub-component
  describe('Label', () => {
    it('should apply default variant text color when no className provided', () => {
      render(
        <SystemQuotaCard>
          <SystemQuotaCard.Label>Default label</SystemQuotaCard.Label>
        </SystemQuotaCard>,
      )

      expect(screen.getByText('Default label').className).toContain('text-text-secondary')
    })

    it('should apply destructive variant text color when no className provided', () => {
      render(
        <SystemQuotaCard variant="destructive">
          <SystemQuotaCard.Label>Error label</SystemQuotaCard.Label>
        </SystemQuotaCard>,
      )

      expect(screen.getByText('Error label').className).toContain('text-text-destructive')
    })

    it('should override variant color with custom className', () => {
      render(
        <SystemQuotaCard variant="destructive">
          <SystemQuotaCard.Label className="gap-1">Custom label</SystemQuotaCard.Label>
        </SystemQuotaCard>,
      )

      const label = screen.getByText('Custom label')
      expect(label.className).toContain('gap-1')
      expect(label.className).not.toContain('text-text-destructive')
    })
  })

  // Actions sub-component
  describe('Actions', () => {
    it('should render action children', () => {
      render(
        <SystemQuotaCard>
          <SystemQuotaCard.Actions>
            <button>Click me</button>
          </SystemQuotaCard.Actions>
        </SystemQuotaCard>,
      )

      expect(screen.getByRole('button', { name: /click me/i })).toBeInTheDocument()
    })
  })
})
