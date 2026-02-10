import type { ExternalKnowledgeBaseHitTesting, HitTestingChildChunk } from '@/models/datasets'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FileAppearanceTypeEnum } from '@/app/components/base/file-uploader/types'
import ChildChunksItem from './child-chunks-item'
import EmptyRecords from './empty-records'
import Mask from './mask'
import Textarea from './query-input/textarea'
import ResultItemExternal from './result-item-external'
import ResultItemFooter from './result-item-footer'
import ResultItemMeta from './result-item-meta'
import Score from './score'

let mockIsShowDetailModal = false
const mockShowDetailModal = vi.fn(() => {
  mockIsShowDetailModal = true
})
const mockHideDetailModal = vi.fn(() => {
  mockIsShowDetailModal = false
})

vi.mock('ahooks', () => ({
  useBoolean: (_initial: boolean) => {
    return [
      mockIsShowDetailModal,
      {
        setTrue: mockShowDetailModal,
        setFalse: mockHideDetailModal,
        toggle: vi.fn(),
        set: vi.fn(),
      },
    ]
  },
}))

const createExternalPayload = (
  overrides: Partial<ExternalKnowledgeBaseHitTesting> = {},
): ExternalKnowledgeBaseHitTesting => ({
  content: 'This is the chunk content for testing.',
  title: 'Test Document Title',
  score: 0.85,
  metadata: {
    'x-amz-bedrock-kb-source-uri': 's3://bucket/key',
    'x-amz-bedrock-kb-data-source-id': 'ds-123',
  },
  ...overrides,
})

const createChildChunkPayload = (
  overrides: Partial<HitTestingChildChunk> = {},
): HitTestingChildChunk => ({
  id: 'chunk-1',
  content: 'Child chunk content here',
  position: 1,
  score: 0.75,
  ...overrides,
})

describe('Score', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests for the score display component
  describe('Rendering', () => {
    it('should render score value with toFixed(2)', () => {
      // Arrange & Act
      render(<Score value={0.85} />)

      // Assert
      expect(screen.getByText('0.85')).toBeInTheDocument()
      expect(screen.getByText('score')).toBeInTheDocument()
    })

    it('should render score progress bar with correct width', () => {
      // Arrange & Act
      const { container } = render(<Score value={0.75} />)

      // Assert
      const progressBar = container.querySelector('[style]')
      expect(progressBar).toHaveStyle({ width: '75%' })
    })

    it('should render with besideChunkName styling', () => {
      // Arrange & Act
      const { container } = render(<Score value={0.5} besideChunkName />)

      // Assert
      const root = container.firstElementChild
      expect(root?.className).toContain('h-[20.5px]')
      expect(root?.className).toContain('border-l-0')
    })

    it('should render with default styling when besideChunkName is false', () => {
      // Arrange & Act
      const { container } = render(<Score value={0.5} />)

      // Assert
      const root = container.firstElementChild
      expect(root?.className).toContain('h-[20px]')
      expect(root?.className).toContain('rounded-md')
    })

    it('should remove right border when value is exactly 1', () => {
      // Arrange & Act
      const { container } = render(<Score value={1} />)

      // Assert
      const progressBar = container.querySelector('[style]')
      expect(progressBar?.className).toContain('border-r-0')
      expect(progressBar).toHaveStyle({ width: '100%' })
    })

    it('should show right border when value is less than 1', () => {
      // Arrange & Act
      const { container } = render(<Score value={0.5} />)

      // Assert
      const progressBar = container.querySelector('[style]')
      expect(progressBar?.className).not.toContain('border-r-0')
    })
  })

  // Null return tests for edge cases
  describe('Returns null', () => {
    it('should return null when value is null', () => {
      // Arrange & Act
      const { container } = render(<Score value={null} />)

      // Assert
      expect(container.innerHTML).toBe('')
    })

    it('should return null when value is 0', () => {
      // Arrange & Act
      const { container } = render(<Score value={0} />)

      // Assert
      expect(container.innerHTML).toBe('')
    })

    it('should return null when value is NaN', () => {
      // Arrange & Act
      const { container } = render(<Score value={Number.NaN} />)

      // Assert
      expect(container.innerHTML).toBe('')
    })
  })

  // Edge case tests
  describe('Edge Cases', () => {
    it('should render very small score values', () => {
      // Arrange & Act
      render(<Score value={0.01} />)

      // Assert
      expect(screen.getByText('0.01')).toBeInTheDocument()
    })

    it('should render score with many decimals truncated to 2', () => {
      // Arrange & Act
      render(<Score value={0.123456} />)

      // Assert
      expect(screen.getByText('0.12')).toBeInTheDocument()
    })
  })
})

// ============================================================================
// Mask Component Tests
// ============================================================================

describe('Mask', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests for the gradient overlay component
  describe('Rendering', () => {
    it('should render a gradient overlay div', () => {
      // Arrange & Act
      const { container } = render(<Mask />)

      // Assert
      const div = container.firstElementChild
      expect(div).toBeInTheDocument()
      expect(div?.className).toContain('h-12')
      expect(div?.className).toContain('bg-gradient-to-b')
    })

    it('should apply custom className', () => {
      // Arrange & Act
      const { container } = render(<Mask className="custom-mask" />)

      // Assert
      expect(container.firstElementChild?.className).toContain('custom-mask')
    })

    it('should render without custom className', () => {
      // Arrange & Act
      const { container } = render(<Mask />)

      // Assert
      expect(container.firstElementChild).toBeInTheDocument()
    })
  })
})

describe('EmptyRecords', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests for the empty state component
  describe('Rendering', () => {
    it('should render the "no recent" tip text', () => {
      // Arrange & Act
      render(<EmptyRecords />)

      // Assert
      expect(screen.getByText(/noRecentTip/i)).toBeInTheDocument()
    })

    it('should render the history icon', () => {
      // Arrange & Act
      const { container } = render(<EmptyRecords />)

      // Assert
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('should render inside a styled container', () => {
      // Arrange & Act
      const { container } = render(<EmptyRecords />)

      // Assert
      const wrapper = container.firstElementChild
      expect(wrapper?.className).toContain('rounded-2xl')
      expect(wrapper?.className).toContain('bg-workflow-process-bg')
    })
  })
})

// ============================================================================
// Textarea Component Tests
// ============================================================================

describe('Textarea', () => {
  const mockHandleTextChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests for the textarea with character count
  describe('Rendering', () => {
    it('should render a textarea element', () => {
      // Arrange & Act
      render(<Textarea text="" handleTextChange={mockHandleTextChange} />)

      // Assert
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('should display the current text', () => {
      // Arrange & Act
      render(<Textarea text="Hello world" handleTextChange={mockHandleTextChange} />)

      // Assert
      expect(screen.getByRole('textbox')).toHaveValue('Hello world')
    })

    it('should show character count', () => {
      // Arrange & Act
      render(<Textarea text="Hello" handleTextChange={mockHandleTextChange} />)

      // Assert
      expect(screen.getByText('5/200')).toBeInTheDocument()
    })

    it('should show 0/200 for empty text', () => {
      // Arrange & Act
      render(<Textarea text="" handleTextChange={mockHandleTextChange} />)

      // Assert
      expect(screen.getByText('0/200')).toBeInTheDocument()
    })

    it('should render placeholder text', () => {
      // Arrange & Act
      render(<Textarea text="" handleTextChange={mockHandleTextChange} />)

      // Assert
      expect(screen.getByRole('textbox')).toHaveAttribute('placeholder')
    })
  })

  // Warning state tests for exceeding character limit
  describe('Warning state (>200 chars)', () => {
    it('should apply warning border when text exceeds 200 characters', () => {
      // Arrange
      const longText = 'A'.repeat(201)

      // Act
      const { container } = render(
        <Textarea text={longText} handleTextChange={mockHandleTextChange} />,
      )

      // Assert
      const wrapper = container.firstElementChild
      expect(wrapper?.className).toContain('border-state-destructive-active')
    })

    it('should not apply warning border when text is at 200 characters', () => {
      // Arrange
      const text200 = 'A'.repeat(200)

      // Act
      const { container } = render(
        <Textarea text={text200} handleTextChange={mockHandleTextChange} />,
      )

      // Assert
      const wrapper = container.firstElementChild
      expect(wrapper?.className).not.toContain('border-state-destructive-active')
    })

    it('should not apply warning border when text is under 200 characters', () => {
      // Arrange & Act
      const { container } = render(
        <Textarea text="Short text" handleTextChange={mockHandleTextChange} />,
      )

      // Assert
      const wrapper = container.firstElementChild
      expect(wrapper?.className).not.toContain('border-state-destructive-active')
    })

    it('should show warning count with red styling when over 200 chars', () => {
      // Arrange
      const longText = 'B'.repeat(250)

      // Act
      render(<Textarea text={longText} handleTextChange={mockHandleTextChange} />)

      // Assert
      const countElement = screen.getByText('250/200')
      expect(countElement.className).toContain('text-util-colors-red-red-600')
    })

    it('should show normal count styling when at or under 200 chars', () => {
      // Arrange & Act
      render(<Textarea text="Short" handleTextChange={mockHandleTextChange} />)

      // Assert
      const countElement = screen.getByText('5/200')
      expect(countElement.className).toContain('text-text-tertiary')
    })

    it('should show red corner icon when over 200 chars', () => {
      // Arrange
      const longText = 'C'.repeat(201)

      // Act
      const { container } = render(
        <Textarea text={longText} handleTextChange={mockHandleTextChange} />,
      )

      // Assert - Corner icon should have red class
      const cornerWrapper = container.querySelector('.right-0.top-0')
      const cornerSvg = cornerWrapper?.querySelector('svg')
      expect(cornerSvg?.className.baseVal || cornerSvg?.getAttribute('class')).toContain('text-util-colors-red-red-100')
    })
  })

  // User interaction tests
  describe('User Interactions', () => {
    it('should call handleTextChange when text is entered', () => {
      // Arrange
      render(<Textarea text="" handleTextChange={mockHandleTextChange} />)

      // Act
      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: 'New text' },
      })

      // Assert
      expect(mockHandleTextChange).toHaveBeenCalledTimes(1)
    })
  })
})

// ============================================================================
// ResultItemFooter Component Tests
// ============================================================================

describe('ResultItemFooter', () => {
  const mockShowDetailModal = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests for the result item footer
  describe('Rendering', () => {
    it('should render the document title', () => {
      // Arrange & Act
      render(
        <ResultItemFooter
          docType={FileAppearanceTypeEnum.document}
          docTitle="My Document.pdf"
          showDetailModal={mockShowDetailModal}
        />,
      )

      // Assert
      expect(screen.getByText('My Document.pdf')).toBeInTheDocument()
    })

    it('should render the "open" button text', () => {
      // Arrange & Act
      render(
        <ResultItemFooter
          docType={FileAppearanceTypeEnum.pdf}
          docTitle="File.pdf"
          showDetailModal={mockShowDetailModal}
        />,
      )

      // Assert
      expect(screen.getByText(/open/i)).toBeInTheDocument()
    })

    it('should render the file icon', () => {
      // Arrange & Act
      const { container } = render(
        <ResultItemFooter
          docType={FileAppearanceTypeEnum.document}
          docTitle="File.txt"
          showDetailModal={mockShowDetailModal}
        />,
      )

      // Assert
      const icon = container.querySelector('svg')
      expect(icon).toBeInTheDocument()
    })
  })

  // User interaction tests
  describe('User Interactions', () => {
    it('should call showDetailModal when open button is clicked', () => {
      // Arrange
      render(
        <ResultItemFooter
          docType={FileAppearanceTypeEnum.document}
          docTitle="Doc"
          showDetailModal={mockShowDetailModal}
        />,
      )

      // Act
      const openButton = screen.getByText(/open/i).closest('.cursor-pointer') as HTMLElement
      fireEvent.click(openButton)

      // Assert
      expect(mockShowDetailModal).toHaveBeenCalledTimes(1)
    })
  })
})

// ============================================================================
// ResultItemMeta Component Tests
// ============================================================================

describe('ResultItemMeta', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests for the result item meta component
  describe('Rendering', () => {
    it('should render the segment index tag with prefix and position', () => {
      // Arrange & Act
      render(
        <ResultItemMeta
          labelPrefix="Chunk"
          positionId={3}
          wordCount={150}
          score={0.9}
        />,
      )

      // Assert
      expect(screen.getByText('Chunk-03')).toBeInTheDocument()
    })

    it('should render the word count', () => {
      // Arrange & Act
      render(
        <ResultItemMeta
          labelPrefix="Chunk"
          positionId={1}
          wordCount={250}
          score={0.8}
        />,
      )

      // Assert
      expect(screen.getByText(/250/)).toBeInTheDocument()
      expect(screen.getByText(/characters/i)).toBeInTheDocument()
    })

    it('should render the score component', () => {
      // Arrange & Act
      render(
        <ResultItemMeta
          labelPrefix="Chunk"
          positionId={1}
          wordCount={100}
          score={0.75}
        />,
      )

      // Assert
      expect(screen.getByText('0.75')).toBeInTheDocument()
      expect(screen.getByText('score')).toBeInTheDocument()
    })

    it('should apply custom className', () => {
      // Arrange & Act
      const { container } = render(
        <ResultItemMeta
          className="custom-meta"
          labelPrefix="Chunk"
          positionId={1}
          wordCount={100}
          score={0.5}
        />,
      )

      // Assert
      expect(container.firstElementChild?.className).toContain('custom-meta')
    })

    it('should render dot separator', () => {
      // Arrange & Act
      render(
        <ResultItemMeta
          labelPrefix="Chunk"
          positionId={1}
          wordCount={100}
          score={0.5}
        />,
      )

      // Assert
      expect(screen.getByText('·')).toBeInTheDocument()
    })
  })
})

// ============================================================================
// ChildChunksItem Component Tests
// ============================================================================

describe('ChildChunksItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests for child chunk items
  describe('Rendering', () => {
    it('should render the position label', () => {
      // Arrange
      const payload = createChildChunkPayload({ position: 3 })

      // Act
      render(<ChildChunksItem payload={payload} isShowAll={false} />)

      // Assert
      expect(screen.getByText(/C-/)).toBeInTheDocument()
      expect(screen.getByText(/3/)).toBeInTheDocument()
    })

    it('should render the score component', () => {
      // Arrange
      const payload = createChildChunkPayload({ score: 0.88 })

      // Act
      render(<ChildChunksItem payload={payload} isShowAll={false} />)

      // Assert
      expect(screen.getByText('0.88')).toBeInTheDocument()
    })

    it('should render the content text', () => {
      // Arrange
      const payload = createChildChunkPayload({ content: 'Sample chunk text' })

      // Act
      render(<ChildChunksItem payload={payload} isShowAll={false} />)

      // Assert
      expect(screen.getByText('Sample chunk text')).toBeInTheDocument()
    })

    it('should render with besideChunkName styling on Score', () => {
      // Arrange
      const payload = createChildChunkPayload({ score: 0.6 })

      // Act
      const { container } = render(
        <ChildChunksItem payload={payload} isShowAll={false} />,
      )

      // Assert - Score with besideChunkName has h-[20.5px] and border-l-0
      const scoreEl = container.querySelector('[class*="h-\\[20\\.5px\\]"]')
      expect(scoreEl).toBeInTheDocument()
    })
  })

  // Line clamping behavior tests
  describe('Line Clamping', () => {
    it('should apply line-clamp-2 when isShowAll is false', () => {
      // Arrange
      const payload = createChildChunkPayload()

      // Act
      const { container } = render(
        <ChildChunksItem payload={payload} isShowAll={false} />,
      )

      // Assert
      const root = container.firstElementChild
      expect(root?.className).toContain('line-clamp-2')
    })

    it('should not apply line-clamp-2 when isShowAll is true', () => {
      // Arrange
      const payload = createChildChunkPayload()

      // Act
      const { container } = render(
        <ChildChunksItem payload={payload} isShowAll={true} />,
      )

      // Assert
      const root = container.firstElementChild
      expect(root?.className).not.toContain('line-clamp-2')
    })
  })

  // Edge case tests
  describe('Edge Cases', () => {
    it('should render with score 0 (Score returns null)', () => {
      // Arrange
      const payload = createChildChunkPayload({ score: 0 })

      // Act
      render(<ChildChunksItem payload={payload} isShowAll={false} />)

      // Assert - content still renders, score returns null
      expect(screen.getByText('Child chunk content here')).toBeInTheDocument()
      expect(screen.queryByText('score')).not.toBeInTheDocument()
    })
  })
})

// ============================================================================
// ResultItemExternal Component Tests
// ============================================================================

describe('ResultItemExternal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsShowDetailModal = false
  })

  // Rendering tests for the external result item card
  describe('Rendering', () => {
    it('should render the content text', () => {
      // Arrange
      const payload = createExternalPayload({ content: 'External result content' })

      // Act
      render(<ResultItemExternal payload={payload} positionId={1} />)

      // Assert
      expect(screen.getByText('External result content')).toBeInTheDocument()
    })

    it('should render the meta info with position and score', () => {
      // Arrange
      const payload = createExternalPayload({ score: 0.92 })

      // Act
      render(<ResultItemExternal payload={payload} positionId={5} />)

      // Assert
      expect(screen.getByText('Chunk-05')).toBeInTheDocument()
      expect(screen.getByText('0.92')).toBeInTheDocument()
    })

    it('should render the footer with document title', () => {
      // Arrange
      const payload = createExternalPayload({ title: 'Knowledge Base Doc' })

      // Act
      render(<ResultItemExternal payload={payload} positionId={1} />)

      // Assert
      expect(screen.getByText('Knowledge Base Doc')).toBeInTheDocument()
    })

    it('should render the word count from content length', () => {
      // Arrange
      const content = 'Hello World' // 11 chars
      const payload = createExternalPayload({ content })

      // Act
      render(<ResultItemExternal payload={payload} positionId={1} />)

      // Assert
      expect(screen.getByText(/11/)).toBeInTheDocument()
    })
  })

  // Detail modal tests
  describe('Detail Modal', () => {
    it('should not render modal by default', () => {
      // Arrange
      const payload = createExternalPayload()

      // Act
      render(<ResultItemExternal payload={payload} positionId={1} />)

      // Assert
      expect(screen.queryByText(/chunkDetail/i)).not.toBeInTheDocument()
    })

    it('should call showDetailModal when card is clicked', () => {
      // Arrange
      const payload = createExternalPayload()
      mockIsShowDetailModal = false

      render(<ResultItemExternal payload={payload} positionId={1} />)

      // Act - click the card to open modal
      const card = screen.getByText(payload.content).closest('.cursor-pointer') as HTMLElement
      fireEvent.click(card)

      // Assert - showDetailModal (setTrue) was invoked
      expect(mockShowDetailModal).toHaveBeenCalled()
    })

    it('should render modal content when isShowDetailModal is true', () => {
      // Arrange - modal is already open
      const payload = createExternalPayload()
      mockIsShowDetailModal = true

      // Act
      render(<ResultItemExternal payload={payload} positionId={1} />)

      // Assert - modal title should appear
      expect(screen.getByText(/chunkDetail/i)).toBeInTheDocument()
    })

    it('should render full content in the modal', () => {
      // Arrange
      const payload = createExternalPayload({ content: 'Full modal content text' })
      mockIsShowDetailModal = true

      // Act
      render(<ResultItemExternal payload={payload} positionId={1} />)

      // Assert - content appears both in card and modal
      const contentElements = screen.getAllByText('Full modal content text')
      expect(contentElements.length).toBeGreaterThanOrEqual(2)
    })

    it('should render meta info in the modal', () => {
      // Arrange
      const payload = createExternalPayload({ score: 0.77 })
      mockIsShowDetailModal = true

      // Act
      render(<ResultItemExternal payload={payload} positionId={3} />)

      // Assert - meta appears in both card and modal
      const chunkTags = screen.getAllByText('Chunk-03')
      expect(chunkTags.length).toBe(2)
      const scores = screen.getAllByText('0.77')
      expect(scores.length).toBe(2)
    })
  })

  // Edge case tests
  describe('Edge Cases', () => {
    it('should render with empty content', () => {
      // Arrange
      const payload = createExternalPayload({ content: '' })

      // Act
      render(<ResultItemExternal payload={payload} positionId={1} />)

      // Assert - component still renders
      expect(screen.getByText('Test Document Title')).toBeInTheDocument()
    })

    it('should render with score of 0 (Score returns null)', () => {
      // Arrange
      const payload = createExternalPayload({ score: 0 })

      // Act
      render(<ResultItemExternal payload={payload} positionId={1} />)

      // Assert - no score displayed
      expect(screen.queryByText('score')).not.toBeInTheDocument()
    })

    it('should handle large positionId values', () => {
      // Arrange
      const payload = createExternalPayload()

      // Act
      render(<ResultItemExternal payload={payload} positionId={999} />)

      // Assert
      expect(screen.getByText('Chunk-999')).toBeInTheDocument()
    })
  })
})
