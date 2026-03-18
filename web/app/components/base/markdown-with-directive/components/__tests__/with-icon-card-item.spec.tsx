import { render, screen } from '@testing-library/react'
import WithIconCardItem from '../with-icon-card-item'

describe('WithIconCardItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('should render a decorative icon and children content by default', () => {
      const { container } = render(
        <WithIconCardItem icon="https://example.com/icon.png">
          <span>Card item content</span>
        </WithIconCardItem>,
      )

      const icon = container.querySelector('img')
      expect(icon).toBeInTheDocument()
      expect(icon).toHaveAttribute('src', 'https://example.com/icon.png')
      expect(icon).toHaveAttribute('alt', '')
      expect(icon).toHaveAttribute('aria-hidden', 'true')
      expect(icon).toHaveClass('object-contain')
      expect(screen.getByText('Card item content')).toBeInTheDocument()
    })

    it('should expose alt text when iconAlt is provided', () => {
      render(
        <WithIconCardItem icon="https://example.com/icon.png" iconAlt="Card icon">
          <span>Accessible card item content</span>
        </WithIconCardItem>,
      )

      const icon = screen.getByAltText('Card icon')
      expect(icon).toBeInTheDocument()
      expect(icon).not.toHaveAttribute('aria-hidden')
      expect(screen.getByText('Accessible card item content')).toBeInTheDocument()
    })
  })
})
