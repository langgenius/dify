import { render, screen } from '@testing-library/react'
import ModelBadge from './index'

describe('ModelBadge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering behavior for user-visible content.
  describe('Rendering', () => {
    it('should render provided text', () => {
      render(<ModelBadge>Provider</ModelBadge>)

      expect(screen.getByText(/provider/i)).toBeInTheDocument()
    })

    it('should render without text when children is null', () => {
      const { container } = render(<ModelBadge>{null}</ModelBadge>)

      expect(container.textContent).toBe('')
    })

    it('should render nested content', () => {
      render(
        <ModelBadge>
          <span>Badge Label</span>
        </ModelBadge>,
      )

      expect(screen.getByText(/badge label/i)).toBeInTheDocument()
    })
  })
})
