import { render, screen } from '@testing-library/react'
import SectionHeader from './section-header'

describe('SectionHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render title and description text when valid props are provided', () => {
      render(
        <SectionHeader
          title="Templates"
          description="Choose a template to start quickly"
        />,
      )

      expect(screen.getByRole('heading', { level: 2, name: 'Templates' })).toBeInTheDocument()
      expect(screen.getByText('Choose a template to start quickly')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should apply custom className on the header element when className is provided', () => {
      const { container } = render(
        <SectionHeader
          title="Title"
          description="Desc"
          className="mt-1"
        />,
      )

      expect(container.querySelector('header')).toHaveClass('mt-1')
    })
  })

  describe('Edge Cases', () => {
    it('should render an empty description paragraph when description is empty', () => {
      const { container } = render(
        <SectionHeader
          title="Templates"
          description=""
        />,
      )

      const paragraph = container.querySelector('p')
      expect(paragraph).toBeInTheDocument()
      expect(paragraph).toBeEmptyDOMElement()
    })
  })
})
