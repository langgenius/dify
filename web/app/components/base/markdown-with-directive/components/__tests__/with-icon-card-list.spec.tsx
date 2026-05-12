import { render, screen } from '@testing-library/react'
import WithIconCardList from '../with-icon-card-list'

describe('WithIconCardList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Verify baseline rendering and className merge behavior.
  describe('rendering', () => {
    it('should render children and merge custom className with base class', () => {
      const { container } = render(
        <WithIconCardList className="custom-list-class">
          <span>List child</span>
        </WithIconCardList>,
      )

      expect(screen.getByText('List child')).toBeInTheDocument()
      expect(container.firstElementChild).toHaveClass('space-y-1')
      expect(container.firstElementChild).toHaveClass('custom-list-class')
    })

    it('should keep base class when className is not provided', () => {
      const { container } = render(
        <WithIconCardList>
          <span>Only base class</span>
        </WithIconCardList>,
      )

      expect(screen.getByText('Only base class')).toBeInTheDocument()
      expect(container.firstElementChild).toHaveClass('space-y-1')
    })
  })
})
