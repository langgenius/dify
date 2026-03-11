import { render, screen } from '@testing-library/react'
import WithIconCardItem from './with-icon-card-item'

vi.mock('next/image', () => ({
  default: ({ unoptimized: _unoptimized, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { unoptimized?: boolean }) => <img {...props} />,
}))

describe('WithIconCardItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Verify icon image and content rendering.
  describe('rendering', () => {
    it('should render icon image and children content', () => {
      render(
        <WithIconCardItem icon="https://example.com/icon.png">
          <span>Card item content</span>
        </WithIconCardItem>,
      )

      const icon = screen.getByAltText('icon')
      expect(icon).toBeInTheDocument()
      expect(icon).toHaveAttribute('src', 'https://example.com/icon.png')
      expect(icon).toHaveClass('object-contain')
      expect(screen.getByText('Card item content')).toBeInTheDocument()
    })
  })
})
