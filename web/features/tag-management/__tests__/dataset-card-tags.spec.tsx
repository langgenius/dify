import type { Tag } from '@/contract/console/tags'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DatasetCardTags } from '../components/dataset-card-tags'

vi.mock('@/features/tag-management/components/tag-selector', () => ({
  TagSelector: ({ value, onOpenTagManagement }: {
    value: Tag[]
    onOpenTagManagement?: () => void
  }) => (
    <div role="group" aria-label="Tag selector mock">
      <div>{value.map(tag => tag.id).join(',')}</div>
      <div>
        {value.length}
        {' '}
        tags
      </div>
      <button onClick={onOpenTagManagement}>
        Open Management
      </button>
    </div>
  ),
}))

describe('DatasetCardTags', () => {
  const mockTags: Tag[] = [
    { id: 'tag-1', name: 'Tag 1', type: 'knowledge', binding_count: 0 },
    { id: 'tag-2', name: 'Tag 2', type: 'knowledge', binding_count: 0 },
  ]

  const defaultProps = {
    datasetId: 'dataset-1',
    embeddingAvailable: true,
    tags: mockTags,
    onClick: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<DatasetCardTags {...defaultProps} />)
      expect(screen.getByRole('group', { name: 'Tag selector mock' })).toBeInTheDocument()
    })

    it('should render TagSelector with correct value', () => {
      render(<DatasetCardTags {...defaultProps} />)
      expect(screen.getByText('tag-1,tag-2')).toBeInTheDocument()
    })

    it('should display selected tags count', () => {
      render(<DatasetCardTags {...defaultProps} />)
      expect(screen.getByText('2 tags')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should pass dataset id to TagSelector', () => {
      render(<DatasetCardTags {...defaultProps} datasetId="custom-dataset-id" />)
      expect(screen.getByRole('group', { name: 'Tag selector mock' })).toBeInTheDocument()
    })

    it('should render with empty tags', () => {
      render(<DatasetCardTags {...defaultProps} tags={[]} />)
      expect(screen.getByText('0 tags')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onClick when container is clicked', () => {
      const onClick = vi.fn()
      const { container } = render(<DatasetCardTags {...defaultProps} onClick={onClick} />)

      const wrapper = container.firstElementChild
      if (!wrapper)
        throw new Error('Expected dataset card tag wrapper')
      fireEvent.click(wrapper)

      expect(onClick).toHaveBeenCalledTimes(1)
    })

    it('should open tag management when requested', () => {
      const onOpenTagManagement = vi.fn()
      render(<DatasetCardTags {...defaultProps} onOpenTagManagement={onOpenTagManagement} />)

      fireEvent.click(screen.getByText('Open Management'))

      expect(onOpenTagManagement).toHaveBeenCalledTimes(1)
    })
  })

  describe('Styles', () => {
    it('should have opacity class when embedding is not available', () => {
      const { container } = render(<DatasetCardTags {...defaultProps} embeddingAvailable={false} />)
      const wrapper = container.firstElementChild
      if (!wrapper)
        throw new Error('Expected dataset card tag wrapper')
      expect(wrapper).toHaveClass('opacity-30')
    })

    it('should not have opacity class when embedding is available', () => {
      const { container } = render(<DatasetCardTags {...defaultProps} embeddingAvailable={true} />)
      const wrapper = container.firstElementChild
      if (!wrapper)
        throw new Error('Expected dataset card tag wrapper')
      expect(wrapper).not.toHaveClass('opacity-30')
    })

    it('should hide mask with CSS when the tag area is hovered', () => {
      const { container } = render(<DatasetCardTags {...defaultProps} />)
      const maskDiv = container.querySelector('.bg-tag-selector-mask-bg')
      expect(maskDiv).toBeInTheDocument()
      expect(maskDiv).toHaveClass('group-hover/tag-area:hidden')
      expect(maskDiv).toHaveClass('group-focus-within/tag-area:hidden')
      expect(maskDiv).toHaveClass('group-hover:bg-tag-selector-mask-hover-bg')
    })

    it('should keep TagSelector visible when tags are empty', () => {
      const { container } = render(<DatasetCardTags {...defaultProps} tags={[]} />)
      const tagSelectorWrapper = screen.getByRole('group', { name: 'Tag selector mock' }).parentElement

      expect(tagSelectorWrapper).toBeInTheDocument()
      expect(tagSelectorWrapper).toHaveClass('w-full')
      expect(tagSelectorWrapper).not.toHaveClass('invisible')
      expect(container.querySelector('.invisible')).not.toBeInTheDocument()
    })

    it('should keep TagSelector visible when tags exist', () => {
      const { container } = render(<DatasetCardTags {...defaultProps} />)
      const tagSelectorWrapper = screen.getByRole('group', { name: 'Tag selector mock' }).parentElement

      expect(tagSelectorWrapper).toBeInTheDocument()
      expect(tagSelectorWrapper).toHaveClass('w-full')
      expect(container.querySelector('.invisible')).not.toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle undefined onOpenTagManagement', () => {
      render(<DatasetCardTags {...defaultProps} onOpenTagManagement={undefined} />)
      expect(() => fireEvent.click(screen.getByText('Open Management'))).not.toThrow()
    })

    it('should handle many tags', () => {
      const manyTags: Tag[] = Array.from({ length: 20 }, (_, i): Tag => ({
        id: `tag-${i}`,
        name: `Tag ${i}`,
        type: 'knowledge',
        binding_count: 0,
      }))
      render(<DatasetCardTags {...defaultProps} tags={manyTags} />)
      expect(screen.getByText('20 tags')).toBeInTheDocument()
    })
  })
})
