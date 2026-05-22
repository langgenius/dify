import type { PublishedSnippetListItem } from '../snippet-detail-card'
import { fireEvent, render, screen } from '@testing-library/react'
import SnippetListItem from '../snippet-list-item'

const createSnippet = (overrides: Partial<PublishedSnippetListItem> = {}): PublishedSnippetListItem => ({
  id: 'snippet-1',
  name: 'Customer Review',
  description: 'Snippet description',
  type: 'group',
  is_published: true,
  use_count: 3,
  tags: [],
  created_at: 1,
  created_by: 'user-1',
  updated_at: 2,
  updated_by: 'user-1',
  ...overrides,
})

describe('SnippetListItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render snippet name', () => {
      render(
        <SnippetListItem
          snippet={createSnippet()}
          isHovered={false}
          onMouseEnter={vi.fn()}
          onMouseLeave={vi.fn()}
        />,
      )

      expect(screen.getByText('Customer Review')).toBeInTheDocument()
    })

    it('should not render metadata when hovered', () => {
      render(
        <SnippetListItem
          snippet={createSnippet()}
          isHovered
          onMouseEnter={vi.fn()}
          onMouseLeave={vi.fn()}
        />,
      )

      expect(screen.getByText('Customer Review')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should forward click and hover handlers', () => {
      const handleClick = vi.fn()
      const handleMouseEnter = vi.fn()
      const handleMouseLeave = vi.fn()

      render(
        <SnippetListItem
          snippet={createSnippet()}
          isHovered={false}
          onClick={handleClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        />,
      )

      const item = screen.getByText('Customer Review').closest('div')!

      fireEvent.mouseEnter(item)
      fireEvent.mouseLeave(item)
      fireEvent.click(item)

      expect(handleMouseEnter).toHaveBeenCalledTimes(1)
      expect(handleMouseLeave).toHaveBeenCalledTimes(1)
      expect(handleClick).toHaveBeenCalledTimes(1)
    })
  })
})
