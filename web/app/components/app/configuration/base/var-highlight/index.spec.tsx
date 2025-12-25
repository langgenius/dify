import { render, screen } from '@testing-library/react'
import VarHighlight, { varHighlightHTML } from './index'

describe('VarHighlight', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering highlighted variable tags
  describe('Rendering', () => {
    it('should render braces around the variable name with default styles', () => {
      // Arrange
      const props = { name: 'userInput' }

      // Act
      const { container } = render(<VarHighlight {...props} />)

      // Assert
      expect(screen.getByText('userInput')).toBeInTheDocument()
      expect(screen.getAllByText('{{')[0]).toBeInTheDocument()
      expect(screen.getAllByText('}}')[0]).toBeInTheDocument()
      // CSS modules add a hash to class names, so we check that the class attribute contains 'item'
      const firstChild = container.firstChild as HTMLElement
      expect(firstChild.className).toContain('item')
    })

    it('should apply custom class names when provided', () => {
      // Arrange
      const props = { name: 'custom', className: 'mt-2' }

      // Act
      const { container } = render(<VarHighlight {...props} />)

      // Assert
      expect(container.firstChild).toHaveClass('mt-2')
    })
  })

  // Escaping HTML via helper
  describe('varHighlightHTML', () => {
    it('should escape dangerous characters before returning HTML string', () => {
      // Arrange
      const props = { name: '<script>alert(\'xss\')</script>' }

      // Act
      const html = varHighlightHTML(props)

      // Assert
      expect(html).toContain('&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;')
      expect(html).not.toContain('<script>')
    })

    it('should include custom class names in the wrapper element', () => {
      // Arrange
      const props = { name: 'data', className: 'text-primary' }

      // Act
      const html = varHighlightHTML(props)

      // Assert
      // CSS modules add a hash to class names, so the class attribute may contain _item_xxx
      expect(html).toContain('text-primary')
      expect(html).toContain('item')
    })
  })
})
