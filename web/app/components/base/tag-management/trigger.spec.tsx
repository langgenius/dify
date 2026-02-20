import { render, screen } from '@testing-library/react'
import Trigger from './trigger'

describe('Trigger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering behavior for empty and populated states.
  describe('Rendering', () => {
    it('should render add-tag placeholder when tags are empty', () => {
      render(<Trigger tags={[]} />)

      expect(screen.getByText('common.tag.addTag')).toBeInTheDocument()
    })

    it('should render all tags when tags are provided', () => {
      render(<Trigger tags={['Frontend', 'Backend']} />)

      expect(screen.getByText('Frontend')).toBeInTheDocument()
      expect(screen.getByText('Backend')).toBeInTheDocument()
      expect(screen.queryByText('common.tag.addTag')).not.toBeInTheDocument()
    })
  })

  // Prop-driven rendering updates.
  describe('Props', () => {
    it('should update from placeholder to tag badges when tags prop changes', () => {
      const { rerender } = render(<Trigger tags={[]} />)
      expect(screen.getByText('common.tag.addTag')).toBeInTheDocument()

      rerender(<Trigger tags={['Database']} />)

      expect(screen.getByText('Database')).toBeInTheDocument()
      expect(screen.queryByText('common.tag.addTag')).not.toBeInTheDocument()
    })
  })

  // Edge behavior for unusual but valid tag arrays.
  describe('Edge Cases', () => {
    it('should render a badge even when a tag label is an empty string', () => {
      render(<Trigger tags={['']} />)

      // One outer container + one tag badge.
      expect(screen.getAllByTestId(/^tag-badge-/)).toHaveLength(1)
      expect(screen.queryByText('common.tag.addTag')).not.toBeInTheDocument()
    })

    it('should render one badge per tag for longer tag lists', () => {
      const tags = ['A', 'B', 'C', 'D', 'E']
      render(<Trigger tags={tags} />)

      tags.forEach(tag => expect(screen.getByText(tag)).toBeInTheDocument())
      expect(screen.getAllByTestId(/^tag-badge-/)).toHaveLength(tags.length)
    })
  })
})
