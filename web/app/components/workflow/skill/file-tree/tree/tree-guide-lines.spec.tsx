import { render } from '@testing-library/react'
import TreeGuideLines from './tree-guide-lines'

describe('TreeGuideLines', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering behavior for root-level and nested nodes.
  describe('Rendering', () => {
    it('should render nothing when level is 0', () => {
      // Arrange
      const { container } = render(<TreeGuideLines level={0} />)

      // Assert
      expect(container.firstChild).toBeNull()
    })

    it('should render one guideline per level with default spacing', () => {
      // Arrange
      const { container } = render(<TreeGuideLines level={3} />)

      // Act
      const guides = container.querySelectorAll('.border-divider-subtle')

      // Assert
      expect(guides).toHaveLength(3)
      expect(guides[0]).toHaveStyle({ left: '10px' })
      expect(guides[1]).toHaveStyle({ left: '30px' })
      expect(guides[2]).toHaveStyle({ left: '50px' })
    })
  })

  // Custom spacing props should influence guideline position.
  describe('Props', () => {
    it('should apply custom indentSize and lineOffset when provided', () => {
      // Arrange
      const { container } = render(
        <TreeGuideLines level={2} indentSize={24} lineOffset={4} />,
      )

      // Act
      const guides = container.querySelectorAll('.border-divider-subtle')

      // Assert
      expect(guides).toHaveLength(2)
      expect(guides[0]).toHaveStyle({ left: '20px' })
      expect(guides[1]).toHaveStyle({ left: '44px' })
    })
  })
})
