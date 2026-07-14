import type { PublishedSnippetListItem } from '../snippet-detail-card'
import { fireEvent, render, screen } from '@testing-library/react'
import SnippetListItem from '../snippet-list-item'

const createSnippet = (
  overrides: Partial<PublishedSnippetListItem> = {},
): PublishedSnippetListItem => ({
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
  version: overrides.version ?? 1,
})

describe('SnippetListItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render snippet title and description', () => {
      render(
        <SnippetListItem
          snippet={createSnippet()}
          isHovered={false}
          onMouseEnter={vi.fn()}
          onMouseLeave={vi.fn()}
        />,
      )

      expect(screen.getByText('Customer Review')).toBeInTheDocument()
      expect(screen.getByText('Snippet description')).toBeInTheDocument()
    })

    it('should not render metadata or tags', () => {
      render(
        <SnippetListItem
          snippet={createSnippet({
            tags: [{ id: 'tag-1', name: 'Search', type: 'snippet', binding_count: '' }],
          })}
          isHovered={false}
          onMouseEnter={vi.fn()}
          onMouseLeave={vi.fn()}
        />,
      )

      expect(screen.getByText('Customer Review')).toBeInTheDocument()
      expect(screen.queryByText('Search')).not.toBeInTheDocument()
      expect(screen.queryByText('3')).not.toBeInTheDocument()
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
