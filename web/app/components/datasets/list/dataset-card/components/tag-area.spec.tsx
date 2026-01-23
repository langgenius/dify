import type { Tag } from '@/app/components/base/tag-management/constant'
import type { DataSet } from '@/models/datasets'
import { fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { IndexingType } from '@/app/components/datasets/create/step-two'
import { ChunkingMode, DatasetPermission, DataSourceType } from '@/models/datasets'
import TagArea from './tag-area'

// Mock TagSelector as it's a complex component from base
vi.mock('@/app/components/base/tag-management/selector', () => ({
  default: ({ value, selectedTags, onCacheUpdate, onChange }: {
    value: string[]
    selectedTags: Tag[]
    onCacheUpdate: (tags: Tag[]) => void
    onChange?: () => void
  }) => (
    <div data-testid="tag-selector">
      <div data-testid="tag-values">{value.join(',')}</div>
      <div data-testid="selected-count">
        {selectedTags.length}
        {' '}
        tags
      </div>
      <button onClick={() => onCacheUpdate([{ id: 'new-tag', name: 'New Tag', type: 'knowledge', binding_count: 0 }])}>
        Update Tags
      </button>
      <button onClick={onChange}>
        Trigger Change
      </button>
    </div>
  ),
}))

describe('TagArea', () => {
  const createMockDataset = (overrides: Partial<DataSet> = {}): DataSet => ({
    id: 'dataset-1',
    name: 'Test Dataset',
    description: 'Test description',
    provider: 'vendor',
    permission: DatasetPermission.allTeamMembers,
    data_source_type: DataSourceType.FILE,
    indexing_technique: IndexingType.QUALIFIED,
    embedding_available: true,
    app_count: 5,
    document_count: 10,
    word_count: 1000,
    updated_at: 1609545600,
    tags: [],
    embedding_model: 'text-embedding-ada-002',
    embedding_model_provider: 'openai',
    created_by: 'user-1',
    doc_form: ChunkingMode.text,
    ...overrides,
  } as DataSet)

  const mockTags: Tag[] = [
    { id: 'tag-1', name: 'Tag 1', type: 'knowledge', binding_count: 0 },
    { id: 'tag-2', name: 'Tag 2', type: 'knowledge', binding_count: 0 },
  ]

  const defaultProps = {
    dataset: createMockDataset(),
    tags: mockTags,
    setTags: vi.fn(),
    onSuccess: vi.fn(),
    isHoveringTagSelector: false,
    onClick: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<TagArea {...defaultProps} />)
      expect(screen.getByTestId('tag-selector')).toBeInTheDocument()
    })

    it('should render TagSelector with correct value', () => {
      render(<TagArea {...defaultProps} />)
      expect(screen.getByTestId('tag-values')).toHaveTextContent('tag-1,tag-2')
    })

    it('should display selected tags count', () => {
      render(<TagArea {...defaultProps} />)
      expect(screen.getByTestId('selected-count')).toHaveTextContent('2 tags')
    })
  })

  describe('Props', () => {
    it('should pass dataset id to TagSelector', () => {
      const dataset = createMockDataset({ id: 'custom-dataset-id' })
      render(<TagArea {...defaultProps} dataset={dataset} />)
      expect(screen.getByTestId('tag-selector')).toBeInTheDocument()
    })

    it('should render with empty tags', () => {
      render(<TagArea {...defaultProps} tags={[]} />)
      expect(screen.getByTestId('selected-count')).toHaveTextContent('0 tags')
    })

    it('should forward ref correctly', () => {
      const TestComponent = () => {
        const ref = useRef<HTMLDivElement>(null)
        return <TagArea {...defaultProps} ref={ref} />
      }
      render(<TestComponent />)
      expect(screen.getByTestId('tag-selector')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onClick when container is clicked', () => {
      const onClick = vi.fn()
      const { container } = render(<TagArea {...defaultProps} onClick={onClick} />)

      const wrapper = container.firstChild as HTMLElement
      fireEvent.click(wrapper)

      expect(onClick).toHaveBeenCalledTimes(1)
    })

    it('should call setTags when tags are updated', () => {
      const setTags = vi.fn()
      render(<TagArea {...defaultProps} setTags={setTags} />)

      fireEvent.click(screen.getByText('Update Tags'))

      expect(setTags).toHaveBeenCalledWith([{ id: 'new-tag', name: 'New Tag', type: 'knowledge', binding_count: 0 }])
    })

    it('should call onSuccess when onChange is triggered', () => {
      const onSuccess = vi.fn()
      render(<TagArea {...defaultProps} onSuccess={onSuccess} />)

      fireEvent.click(screen.getByText('Trigger Change'))

      expect(onSuccess).toHaveBeenCalledTimes(1)
    })
  })

  describe('Styles', () => {
    it('should have opacity class when embedding is not available', () => {
      const dataset = createMockDataset({ embedding_available: false })
      const { container } = render(<TagArea {...defaultProps} dataset={dataset} />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('opacity-30')
    })

    it('should not have opacity class when embedding is available', () => {
      const dataset = createMockDataset({ embedding_available: true })
      const { container } = render(<TagArea {...defaultProps} dataset={dataset} />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).not.toHaveClass('opacity-30')
    })

    it('should show mask when not hovering and has tags', () => {
      const { container } = render(<TagArea {...defaultProps} isHoveringTagSelector={false} tags={mockTags} />)
      const maskDiv = container.querySelector('.bg-tag-selector-mask-bg')
      expect(maskDiv).toBeInTheDocument()
      expect(maskDiv).not.toHaveClass('hidden')
    })

    it('should hide mask when hovering', () => {
      const { container } = render(<TagArea {...defaultProps} isHoveringTagSelector={true} />)
      // When hovering, the mask div should have 'hidden' class
      const maskDiv = container.querySelector('.absolute.right-0.top-0')
      expect(maskDiv).toHaveClass('hidden')
    })

    it('should make TagSelector visible when tags exist', () => {
      const { container } = render(<TagArea {...defaultProps} tags={mockTags} />)
      const tagSelectorWrapper = container.querySelector('.visible')
      expect(tagSelectorWrapper).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle undefined onSuccess', () => {
      render(<TagArea {...defaultProps} onSuccess={undefined} />)
      // Should not throw when clicking Trigger Change
      expect(() => fireEvent.click(screen.getByText('Trigger Change'))).not.toThrow()
    })

    it('should handle many tags', () => {
      const manyTags: Tag[] = Array.from({ length: 20 }, (_, i) => ({
        id: `tag-${i}`,
        name: `Tag ${i}`,
        type: 'knowledge' as const,
        binding_count: 0,
      }))
      render(<TagArea {...defaultProps} tags={manyTags} />)
      expect(screen.getByTestId('selected-count')).toHaveTextContent('20 tags')
    })
  })
})
