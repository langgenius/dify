import type { GeneralChunks, ParentChildChunk, ParentChildChunks, QAChunk, QAChunks } from './types'
import { render, screen } from '@testing-library/react'
import { ChunkingMode } from '@/models/datasets'
import ChunkCard from './chunk-card'
import { ChunkCardList } from './index'
import QAItem from './q-a-item'
import { QAItemType } from './types'

// =============================================================================
// Test Data Factories
// =============================================================================

const createGeneralChunks = (overrides: GeneralChunks = []): GeneralChunks => {
  if (overrides.length > 0)
    return overrides
  return [
    { content: 'This is the first chunk of text content.' },
    { content: 'This is the second chunk with different content.' },
    { content: 'Third chunk here with more text.' },
  ]
}

const createParentChildChunk = (overrides: Partial<ParentChildChunk> = {}): ParentChildChunk => ({
  child_contents: ['Child content 1', 'Child content 2'],
  parent_content: 'This is the parent content that contains the children.',
  parent_mode: 'paragraph',
  ...overrides,
})

const createParentChildChunks = (overrides: Partial<ParentChildChunks> = {}): ParentChildChunks => ({
  parent_child_chunks: [
    createParentChildChunk(),
    createParentChildChunk({
      child_contents: ['Another child 1', 'Another child 2', 'Another child 3'],
      parent_content: 'Another parent content here.',
    }),
  ],
  parent_mode: 'paragraph',
  ...overrides,
})

const createQAChunk = (overrides: Partial<QAChunk> = {}): QAChunk => ({
  question: 'What is the answer to life?',
  answer: 'The answer is 42.',
  ...overrides,
})

const createQAChunks = (overrides: Partial<QAChunks> = {}): QAChunks => ({
  qa_chunks: [
    createQAChunk(),
    createQAChunk({
      question: 'How does this work?',
      answer: 'It works by processing data.',
    }),
  ],
  ...overrides,
})

// =============================================================================
// QAItem Component Tests
// =============================================================================

describe('QAItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Tests for basic rendering of QAItem component
  describe('Rendering', () => {
    it('should render question type with Q prefix', () => {
      // Arrange & Act
      render(<QAItem type={QAItemType.Question} text="What is this?" />)

      // Assert
      expect(screen.getByText('Q')).toBeInTheDocument()
      expect(screen.getByText('What is this?')).toBeInTheDocument()
    })

    it('should render answer type with A prefix', () => {
      // Arrange & Act
      render(<QAItem type={QAItemType.Answer} text="This is the answer." />)

      // Assert
      expect(screen.getByText('A')).toBeInTheDocument()
      expect(screen.getByText('This is the answer.')).toBeInTheDocument()
    })
  })

  // Tests for different prop variations
  describe('Props', () => {
    it('should render with empty text', () => {
      // Arrange & Act
      render(<QAItem type={QAItemType.Question} text="" />)

      // Assert
      expect(screen.getByText('Q')).toBeInTheDocument()
    })

    it('should render with long text content', () => {
      // Arrange
      const longText = 'A'.repeat(1000)

      // Act
      render(<QAItem type={QAItemType.Answer} text={longText} />)

      // Assert
      expect(screen.getByText(longText)).toBeInTheDocument()
    })

    it('should render with special characters in text', () => {
      // Arrange
      const specialText = '<script>alert("xss")</script> & "quotes" \'apostrophe\''

      // Act
      render(<QAItem type={QAItemType.Question} text={specialText} />)

      // Assert
      expect(screen.getByText(specialText)).toBeInTheDocument()
    })
  })

  // Tests for memoization behavior
  describe('Memoization', () => {
    it('should be memoized with React.memo', () => {
      // Arrange & Act
      const { rerender } = render(<QAItem type={QAItemType.Question} text="Test" />)

      // Assert - component should render consistently
      expect(screen.getByText('Q')).toBeInTheDocument()
      expect(screen.getByText('Test')).toBeInTheDocument()

      // Rerender with same props - should not cause issues
      rerender(<QAItem type={QAItemType.Question} text="Test" />)
      expect(screen.getByText('Q')).toBeInTheDocument()
    })
  })
})

// =============================================================================
// ChunkCard Component Tests
// =============================================================================

describe('ChunkCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Tests for basic rendering with different chunk types
  describe('Rendering', () => {
    it('should render text chunk type correctly', () => {
      // Arrange & Act
      render(
        <ChunkCard
          chunkType={ChunkingMode.text}
          content={createGeneralChunks()[0]}
          wordCount={27}
          positionId={1}
        />,
      )

      // Assert
      expect(screen.getByText('This is the first chunk of text content.')).toBeInTheDocument()
      expect(screen.getByText(/Chunk-01/)).toBeInTheDocument()
    })

    it('should render QA chunk type with question and answer', () => {
      // Arrange
      const qaContent: QAChunk = {
        question: 'What is React?',
        answer: 'React is a JavaScript library.',
      }

      // Act
      render(
        <ChunkCard
          chunkType={ChunkingMode.qa}
          content={qaContent}
          wordCount={45}
          positionId={2}
        />,
      )

      // Assert
      expect(screen.getByText('Q')).toBeInTheDocument()
      expect(screen.getByText('What is React?')).toBeInTheDocument()
      expect(screen.getByText('A')).toBeInTheDocument()
      expect(screen.getByText('React is a JavaScript library.')).toBeInTheDocument()
    })

    it('should render parent-child chunk type with child contents', () => {
      // Arrange
      const childContents = ['Child 1 content', 'Child 2 content']

      // Act
      render(
        <ChunkCard
          chunkType={ChunkingMode.parentChild}
          parentMode="paragraph"
          content={createParentChildChunk({ child_contents: childContents })}
          wordCount={50}
          positionId={1}
        />,
      )

      // Assert
      expect(screen.getByText('Child 1 content')).toBeInTheDocument()
      expect(screen.getByText('Child 2 content')).toBeInTheDocument()
      expect(screen.getByText('C-1')).toBeInTheDocument()
      expect(screen.getByText('C-2')).toBeInTheDocument()
    })
  })

  // Tests for parent mode variations
  describe('Parent Mode Variations', () => {
    it('should show Parent-Chunk label prefix for paragraph mode', () => {
      // Arrange & Act
      render(
        <ChunkCard
          chunkType={ChunkingMode.parentChild}
          parentMode="paragraph"
          content={createParentChildChunk({ child_contents: ['Child content'] })}
          wordCount={13}
          positionId={1}
        />,
      )

      // Assert
      expect(screen.getByText(/Parent-Chunk-01/)).toBeInTheDocument()
    })

    it('should hide segment index tag for full-doc mode', () => {
      // Arrange & Act
      render(
        <ChunkCard
          chunkType={ChunkingMode.parentChild}
          parentMode="full-doc"
          content={createParentChildChunk({ child_contents: ['Child content'] })}
          wordCount={13}
          positionId={1}
        />,
      )

      // Assert - should not show Chunk or Parent-Chunk label
      expect(screen.queryByText(/Chunk/)).not.toBeInTheDocument()
      expect(screen.queryByText(/Parent-Chunk/)).not.toBeInTheDocument()
    })

    it('should show Chunk label prefix for text mode', () => {
      // Arrange & Act
      render(
        <ChunkCard
          chunkType={ChunkingMode.text}
          content={createGeneralChunks()[0]}
          wordCount={12}
          positionId={5}
        />,
      )

      // Assert
      expect(screen.getByText(/Chunk-05/)).toBeInTheDocument()
    })
  })

  // Tests for word count display
  describe('Word Count Display', () => {
    it('should display formatted word count', () => {
      // Arrange & Act
      render(
        <ChunkCard
          chunkType={ChunkingMode.text}
          content={createGeneralChunks()[0]}
          wordCount={1234}
          positionId={1}
        />,
      )

      // Assert - formatNumber(1234) returns '1,234'
      expect(screen.getByText(/1,234/)).toBeInTheDocument()
    })

    it('should display word count with character translation key', () => {
      // Arrange & Act
      render(
        <ChunkCard
          chunkType={ChunkingMode.text}
          content={createGeneralChunks()[0]}
          wordCount={100}
          positionId={1}
        />,
      )

      // Assert - translation key is returned as-is by mock
      expect(screen.getByText(/100\s+(?:\S.*)?characters/)).toBeInTheDocument()
    })

    it('should not display word count info for full-doc mode', () => {
      // Arrange & Act
      render(
        <ChunkCard
          chunkType={ChunkingMode.parentChild}
          parentMode="full-doc"
          content={createParentChildChunk({ child_contents: ['Child'] })}
          wordCount={500}
          positionId={1}
        />,
      )

      // Assert - the header with word count should be hidden
      expect(screen.queryByText(/500/)).not.toBeInTheDocument()
    })
  })

  // Tests for position ID variations
  describe('Position ID', () => {
    it('should handle numeric position ID', () => {
      // Arrange & Act
      render(
        <ChunkCard
          chunkType={ChunkingMode.text}
          content={createGeneralChunks()[0]}
          wordCount={7}
          positionId={42}
        />,
      )

      // Assert
      expect(screen.getByText(/Chunk-42/)).toBeInTheDocument()
    })

    it('should handle string position ID', () => {
      // Arrange & Act
      render(
        <ChunkCard
          chunkType={ChunkingMode.text}
          content={createGeneralChunks()[0]}
          wordCount={7}
          positionId="99"
        />,
      )

      // Assert
      expect(screen.getByText(/Chunk-99/)).toBeInTheDocument()
    })

    it('should pad single digit position ID', () => {
      // Arrange & Act
      render(
        <ChunkCard
          chunkType={ChunkingMode.text}
          content={createGeneralChunks()[0]}
          wordCount={7}
          positionId={3}
        />,
      )

      // Assert
      expect(screen.getByText(/Chunk-03/)).toBeInTheDocument()
    })
  })

  // Tests for memoization dependencies
  describe('Memoization', () => {
    it('should update isFullDoc memo when parentMode changes', () => {
      // Arrange
      const { rerender } = render(
        <ChunkCard
          chunkType={ChunkingMode.parentChild}
          parentMode="paragraph"
          content={createParentChildChunk({ child_contents: ['Child'] })}
          wordCount={5}
          positionId={1}
        />,
      )

      // Assert - paragraph mode shows label
      expect(screen.getByText(/Parent-Chunk/)).toBeInTheDocument()

      // Act - change to full-doc
      rerender(
        <ChunkCard
          chunkType={ChunkingMode.parentChild}
          parentMode="full-doc"
          content={createParentChildChunk({ child_contents: ['Child'] })}
          wordCount={5}
          positionId={1}
        />,
      )

      // Assert - full-doc mode hides label
      expect(screen.queryByText(/Parent-Chunk/)).not.toBeInTheDocument()
    })

    it('should update contentElement memo when content changes', () => {
      // Arrange
      const initialContent = { content: 'Initial content' }
      const updatedContent = { content: 'Updated content' }

      const { rerender } = render(
        <ChunkCard
          chunkType={ChunkingMode.text}
          content={initialContent}
          wordCount={15}
          positionId={1}
        />,
      )

      // Assert
      expect(screen.getByText('Initial content')).toBeInTheDocument()

      // Act
      rerender(
        <ChunkCard
          chunkType={ChunkingMode.text}
          content={updatedContent}
          wordCount={15}
          positionId={1}
        />,
      )

      // Assert
      expect(screen.getByText('Updated content')).toBeInTheDocument()
      expect(screen.queryByText('Initial content')).not.toBeInTheDocument()
    })

    it('should update contentElement memo when chunkType changes', () => {
      // Arrange
      const textContent = { content: 'Text content' }
      const { rerender } = render(
        <ChunkCard
          chunkType={ChunkingMode.text}
          content={textContent}
          wordCount={12}
          positionId={1}
        />,
      )

      // Assert
      expect(screen.getByText('Text content')).toBeInTheDocument()

      // Act - change to QA type
      const qaContent: QAChunk = { question: 'Q?', answer: 'A.' }
      rerender(
        <ChunkCard
          chunkType={ChunkingMode.qa}
          content={qaContent}
          wordCount={4}
          positionId={1}
        />,
      )

      // Assert
      expect(screen.getByText('Q')).toBeInTheDocument()
      expect(screen.getByText('Q?')).toBeInTheDocument()
    })
  })

  // Tests for edge cases
  describe('Edge Cases', () => {
    it('should handle empty child contents array', () => {
      // Arrange & Act
      render(
        <ChunkCard
          chunkType={ChunkingMode.parentChild}
          parentMode="paragraph"
          content={createParentChildChunk({ child_contents: [] })}
          wordCount={0}
          positionId={1}
        />,
      )

      // Assert - should render without errors
      expect(screen.getByText(/Parent-Chunk-01/)).toBeInTheDocument()
    })

    it('should handle QA chunk with empty strings', () => {
      // Arrange
      const emptyQA: QAChunk = { question: '', answer: '' }

      // Act
      render(
        <ChunkCard
          chunkType={ChunkingMode.qa}
          content={emptyQA}
          wordCount={0}
          positionId={1}
        />,
      )

      // Assert
      expect(screen.getByText('Q')).toBeInTheDocument()
      expect(screen.getByText('A')).toBeInTheDocument()
    })

    it('should handle very long content', () => {
      // Arrange
      const longContent = 'A'.repeat(10000)
      const longContentChunk = { content: longContent }

      // Act
      render(
        <ChunkCard
          chunkType={ChunkingMode.text}
          content={longContentChunk}
          wordCount={10000}
          positionId={1}
        />,
      )

      // Assert
      expect(screen.getByText(longContent)).toBeInTheDocument()
    })

    it('should handle zero word count', () => {
      // Arrange & Act
      render(
        <ChunkCard
          chunkType={ChunkingMode.text}
          content={createGeneralChunks()[0]}
          wordCount={0}
          positionId={1}
        />,
      )

      // Assert - formatNumber returns falsy for 0, so it shows 0
      expect(screen.getByText(/0\s+(?:\S.*)?characters/)).toBeInTheDocument()
    })
  })
})

// =============================================================================
// ChunkCardList Component Tests
// =============================================================================

describe('ChunkCardList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Tests for rendering with different chunk types
  describe('Rendering', () => {
    it('should render text chunks correctly', () => {
      // Arrange
      const chunks = createGeneralChunks()

      // Act
      render(
        <ChunkCardList
          chunkType={ChunkingMode.text}
          chunkInfo={chunks}
        />,
      )

      // Assert
      expect(screen.getByText(chunks[0].content)).toBeInTheDocument()
      expect(screen.getByText(chunks[1].content)).toBeInTheDocument()
      expect(screen.getByText(chunks[2].content)).toBeInTheDocument()
    })

    it('should render parent-child chunks correctly', () => {
      // Arrange
      const chunks = createParentChildChunks()

      // Act
      render(
        <ChunkCardList
          chunkType={ChunkingMode.parentChild}
          parentMode="paragraph"
          chunkInfo={chunks}
        />,
      )

      // Assert - should render child contents from parent-child chunks
      expect(screen.getByText('Child content 1')).toBeInTheDocument()
      expect(screen.getByText('Child content 2')).toBeInTheDocument()
      expect(screen.getByText('Another child 1')).toBeInTheDocument()
    })

    it('should render QA chunks correctly', () => {
      // Arrange
      const chunks = createQAChunks()

      // Act
      render(
        <ChunkCardList
          chunkType={ChunkingMode.qa}
          chunkInfo={chunks}
        />,
      )

      // Assert
      expect(screen.getByText('What is the answer to life?')).toBeInTheDocument()
      expect(screen.getByText('The answer is 42.')).toBeInTheDocument()
      expect(screen.getByText('How does this work?')).toBeInTheDocument()
      expect(screen.getByText('It works by processing data.')).toBeInTheDocument()
    })
  })

  // Tests for chunkList memoization
  describe('Memoization - chunkList', () => {
    it('should extract chunks from GeneralChunks for text mode', () => {
      // Arrange
      const chunks: GeneralChunks = [
        { content: 'Chunk 1' },
        { content: 'Chunk 2' },
      ]

      // Act
      render(
        <ChunkCardList
          chunkType={ChunkingMode.text}
          chunkInfo={chunks}
        />,
      )

      // Assert
      expect(screen.getByText('Chunk 1')).toBeInTheDocument()
      expect(screen.getByText('Chunk 2')).toBeInTheDocument()
    })

    it('should extract parent_child_chunks from ParentChildChunks for parentChild mode', () => {
      // Arrange
      const chunks = createParentChildChunks({
        parent_child_chunks: [
          createParentChildChunk({ child_contents: ['Specific child'] }),
        ],
      })

      // Act
      render(
        <ChunkCardList
          chunkType={ChunkingMode.parentChild}
          parentMode="paragraph"
          chunkInfo={chunks}
        />,
      )

      // Assert
      expect(screen.getByText('Specific child')).toBeInTheDocument()
    })

    it('should extract qa_chunks from QAChunks for qa mode', () => {
      // Arrange
      const chunks: QAChunks = {
        qa_chunks: [
          { question: 'Specific Q', answer: 'Specific A' },
        ],
      }

      // Act
      render(
        <ChunkCardList
          chunkType={ChunkingMode.qa}
          chunkInfo={chunks}
        />,
      )

      // Assert
      expect(screen.getByText('Specific Q')).toBeInTheDocument()
      expect(screen.getByText('Specific A')).toBeInTheDocument()
    })

    it('should update chunkList when chunkInfo changes', () => {
      // Arrange
      const initialChunks = createGeneralChunks([{ content: 'Initial chunk' }])

      const { rerender } = render(
        <ChunkCardList
          chunkType={ChunkingMode.text}
          chunkInfo={initialChunks}
        />,
      )

      // Assert initial state
      expect(screen.getByText('Initial chunk')).toBeInTheDocument()

      // Act - update chunks
      const updatedChunks = createGeneralChunks([{ content: 'Updated chunk' }])
      rerender(
        <ChunkCardList
          chunkType={ChunkingMode.text}
          chunkInfo={updatedChunks}
        />,
      )

      // Assert updated state
      expect(screen.getByText('Updated chunk')).toBeInTheDocument()
      expect(screen.queryByText('Initial chunk')).not.toBeInTheDocument()
    })
  })

  // Tests for getWordCount function
  describe('Word Count Calculation', () => {
    it('should calculate word count for text chunks using string length', () => {
      // Arrange - "Hello" has 5 characters
      const chunks = createGeneralChunks([{ content: 'Hello' }])

      // Act
      render(
        <ChunkCardList
          chunkType={ChunkingMode.text}
          chunkInfo={chunks}
        />,
      )

      // Assert - word count should be 5 (string length)
      expect(screen.getByText(/5\s+(?:\S.*)?characters/)).toBeInTheDocument()
    })

    it('should calculate word count for parent-child chunks using parent_content length', () => {
      // Arrange - parent_content length determines word count
      const chunks = createParentChildChunks({
        parent_child_chunks: [
          createParentChildChunk({
            parent_content: 'Parent', // 6 characters
            child_contents: ['Child'],
          }),
        ],
      })

      // Act
      render(
        <ChunkCardList
          chunkType={ChunkingMode.parentChild}
          parentMode="paragraph"
          chunkInfo={chunks}
        />,
      )

      // Assert - word count should be 6 (parent_content length)
      expect(screen.getByText(/6\s+(?:\S.*)?characters/)).toBeInTheDocument()
    })

    it('should calculate word count for QA chunks using question + answer length', () => {
      // Arrange - "Hi" (2) + "Bye" (3) = 5
      const chunks: QAChunks = {
        qa_chunks: [
          { question: 'Hi', answer: 'Bye' },
        ],
      }

      // Act
      render(
        <ChunkCardList
          chunkType={ChunkingMode.qa}
          chunkInfo={chunks}
        />,
      )

      // Assert - word count should be 5 (question.length + answer.length)
      expect(screen.getByText(/5\s+(?:\S.*)?characters/)).toBeInTheDocument()
    })
  })

  // Tests for position ID assignment
  describe('Position ID', () => {
    it('should assign 1-based position IDs to chunks', () => {
      // Arrange
      const chunks = createGeneralChunks([
        { content: 'First' },
        { content: 'Second' },
        { content: 'Third' },
      ])

      // Act
      render(
        <ChunkCardList
          chunkType={ChunkingMode.text}
          chunkInfo={chunks}
        />,
      )

      // Assert - position IDs should be 1, 2, 3
      expect(screen.getByText(/Chunk-01/)).toBeInTheDocument()
      expect(screen.getByText(/Chunk-02/)).toBeInTheDocument()
      expect(screen.getByText(/Chunk-03/)).toBeInTheDocument()
    })
  })

  // Tests for className prop
  describe('Custom className', () => {
    it('should apply custom className to container', () => {
      // Arrange
      const chunks = createGeneralChunks([{ content: 'Test' }])

      // Act
      const { container } = render(
        <ChunkCardList
          chunkType={ChunkingMode.text}
          chunkInfo={chunks}
          className="custom-class"
        />,
      )

      // Assert
      expect(container.firstChild).toHaveClass('custom-class')
    })

    it('should merge custom className with default classes', () => {
      // Arrange
      const chunks = createGeneralChunks([{ content: 'Test' }])

      // Act
      const { container } = render(
        <ChunkCardList
          chunkType={ChunkingMode.text}
          chunkInfo={chunks}
          className="my-custom-class"
        />,
      )

      // Assert - should have both default and custom classes
      expect(container.firstChild).toHaveClass('flex')
      expect(container.firstChild).toHaveClass('w-full')
      expect(container.firstChild).toHaveClass('flex-col')
      expect(container.firstChild).toHaveClass('my-custom-class')
    })

    it('should render without className prop', () => {
      // Arrange
      const chunks = createGeneralChunks([{ content: 'Test' }])

      // Act
      const { container } = render(
        <ChunkCardList
          chunkType={ChunkingMode.text}
          chunkInfo={chunks}
        />,
      )

      // Assert - should have default classes
      expect(container.firstChild).toHaveClass('flex')
      expect(container.firstChild).toHaveClass('w-full')
    })
  })

  // Tests for parentMode prop
  describe('Parent Mode', () => {
    it('should pass parentMode to ChunkCard for parent-child type', () => {
      // Arrange
      const chunks = createParentChildChunks()

      // Act
      render(
        <ChunkCardList
          chunkType={ChunkingMode.parentChild}
          parentMode="paragraph"
          chunkInfo={chunks}
        />,
      )

      // Assert - paragraph mode shows Parent-Chunk label
      expect(screen.getAllByText(/Parent-Chunk/).length).toBeGreaterThan(0)
    })

    it('should handle full-doc parentMode', () => {
      // Arrange
      const chunks = createParentChildChunks()

      // Act
      render(
        <ChunkCardList
          chunkType={ChunkingMode.parentChild}
          parentMode="full-doc"
          chunkInfo={chunks}
        />,
      )

      // Assert - full-doc mode hides chunk labels
      expect(screen.queryByText(/Parent-Chunk/)).not.toBeInTheDocument()
      expect(screen.queryByText(/Chunk-/)).not.toBeInTheDocument()
    })

    it('should not use parentMode for text type', () => {
      // Arrange
      const chunks = createGeneralChunks([{ content: 'Text' }])

      // Act
      render(
        <ChunkCardList
          chunkType={ChunkingMode.text}
          parentMode="full-doc" // Should be ignored
          chunkInfo={chunks}
        />,
      )

      // Assert - should show Chunk label, not affected by parentMode
      expect(screen.getByText(/Chunk-01/)).toBeInTheDocument()
    })
  })

  // Tests for edge cases
  describe('Edge Cases', () => {
    it('should handle empty GeneralChunks array', () => {
      // Arrange
      const chunks: GeneralChunks = []

      // Act
      const { container } = render(
        <ChunkCardList
          chunkType={ChunkingMode.text}
          chunkInfo={chunks}
        />,
      )

      // Assert - should render empty container
      expect(container.firstChild).toBeInTheDocument()
      expect(container.firstChild?.childNodes.length).toBe(0)
    })

    it('should handle empty ParentChildChunks', () => {
      // Arrange
      const chunks: ParentChildChunks = {
        parent_child_chunks: [],
        parent_mode: 'paragraph',
      }

      // Act
      const { container } = render(
        <ChunkCardList
          chunkType={ChunkingMode.parentChild}
          parentMode="paragraph"
          chunkInfo={chunks}
        />,
      )

      // Assert
      expect(container.firstChild).toBeInTheDocument()
      expect(container.firstChild?.childNodes.length).toBe(0)
    })

    it('should handle empty QAChunks', () => {
      // Arrange
      const chunks: QAChunks = {
        qa_chunks: [],
      }

      // Act
      const { container } = render(
        <ChunkCardList
          chunkType={ChunkingMode.qa}
          chunkInfo={chunks}
        />,
      )

      // Assert
      expect(container.firstChild).toBeInTheDocument()
      expect(container.firstChild?.childNodes.length).toBe(0)
    })

    it('should handle single item in chunks', () => {
      // Arrange
      const chunks = createGeneralChunks([{ content: 'Single chunk' }])

      // Act
      render(
        <ChunkCardList
          chunkType={ChunkingMode.text}
          chunkInfo={chunks}
        />,
      )

      // Assert
      expect(screen.getByText('Single chunk')).toBeInTheDocument()
      expect(screen.getByText(/Chunk-01/)).toBeInTheDocument()
    })

    it('should handle large number of chunks', () => {
      // Arrange
      const chunks = Array.from({ length: 100 }, (_, i) => ({ content: `Chunk number ${i + 1}` }))

      // Act
      render(
        <ChunkCardList
          chunkType={ChunkingMode.text}
          chunkInfo={chunks}
        />,
      )

      // Assert
      expect(screen.getByText('Chunk number 1')).toBeInTheDocument()
      expect(screen.getByText('Chunk number 100')).toBeInTheDocument()
      expect(screen.getByText(/Chunk-100/)).toBeInTheDocument()
    })
  })

  // Tests for key uniqueness
  describe('Key Generation', () => {
    it('should generate unique keys for chunks', () => {
      // Arrange - chunks with same content
      const chunks = createGeneralChunks([
        { content: 'Same content' },
        { content: 'Same content' },
        { content: 'Same content' },
      ])
      // Act
      const { container } = render(
        <ChunkCardList
          chunkType={ChunkingMode.text}
          chunkInfo={chunks}
        />,
      )

      // Assert - all three should render (keys are based on chunkType-index)
      const chunkCards = container.querySelectorAll('.bg-components-panel-bg')
      expect(chunkCards.length).toBe(3)
    })
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('ChunkCardList Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Tests for complete workflow scenarios
  describe('Complete Workflows', () => {
    it('should render complete text chunking workflow', () => {
      // Arrange
      const textChunks = createGeneralChunks([
        { content: 'First paragraph of the document.' },
        { content: 'Second paragraph with more information.' },
        { content: 'Final paragraph concluding the content.' },
      ])

      // Act
      render(
        <ChunkCardList
          chunkType={ChunkingMode.text}
          chunkInfo={textChunks}
        />,
      )

      // Assert
      expect(screen.getByText('First paragraph of the document.')).toBeInTheDocument()
      expect(screen.getByText(/Chunk-01/)).toBeInTheDocument()
      // "First paragraph of the document." = 32 characters
      expect(screen.getByText(/32\s+(?:\S.*)?characters/)).toBeInTheDocument()

      expect(screen.getByText('Second paragraph with more information.')).toBeInTheDocument()
      expect(screen.getByText(/Chunk-02/)).toBeInTheDocument()

      expect(screen.getByText('Final paragraph concluding the content.')).toBeInTheDocument()
      expect(screen.getByText(/Chunk-03/)).toBeInTheDocument()
    })

    it('should render complete parent-child chunking workflow', () => {
      // Arrange
      const parentChildChunks = createParentChildChunks({
        parent_child_chunks: [
          {
            parent_content: 'Main section about React components and their lifecycle.',
            child_contents: [
              'React components are building blocks.',
              'Lifecycle methods control component behavior.',
            ],
            parent_mode: 'paragraph',
          },
        ],
      })

      // Act
      render(
        <ChunkCardList
          chunkType={ChunkingMode.parentChild}
          parentMode="paragraph"
          chunkInfo={parentChildChunks}
        />,
      )

      // Assert
      expect(screen.getByText('React components are building blocks.')).toBeInTheDocument()
      expect(screen.getByText('Lifecycle methods control component behavior.')).toBeInTheDocument()
      expect(screen.getByText('C-1')).toBeInTheDocument()
      expect(screen.getByText('C-2')).toBeInTheDocument()
      expect(screen.getByText(/Parent-Chunk-01/)).toBeInTheDocument()
    })

    it('should render complete QA chunking workflow', () => {
      // Arrange
      const qaChunks = createQAChunks({
        qa_chunks: [
          {
            question: 'What is Dify?',
            answer: 'Dify is an open-source LLM application development platform.',
          },
          {
            question: 'How do I get started?',
            answer: 'You can start by installing the platform using Docker.',
          },
        ],
      })

      // Act
      render(
        <ChunkCardList
          chunkType={ChunkingMode.qa}
          chunkInfo={qaChunks}
        />,
      )

      // Assert
      const qLabels = screen.getAllByText('Q')
      const aLabels = screen.getAllByText('A')
      expect(qLabels.length).toBe(2)
      expect(aLabels.length).toBe(2)

      expect(screen.getByText('What is Dify?')).toBeInTheDocument()
      expect(screen.getByText('Dify is an open-source LLM application development platform.')).toBeInTheDocument()
      expect(screen.getByText('How do I get started?')).toBeInTheDocument()
      expect(screen.getByText('You can start by installing the platform using Docker.')).toBeInTheDocument()
    })
  })

  // Tests for type switching scenarios
  describe('Type Switching', () => {
    it('should handle switching from text to QA type', () => {
      // Arrange
      const textChunks = createGeneralChunks([{ content: 'Text content' }])
      const qaChunks = createQAChunks()

      const { rerender } = render(
        <ChunkCardList
          chunkType={ChunkingMode.text}
          chunkInfo={textChunks}
        />,
      )

      // Assert initial text state
      expect(screen.getByText('Text content')).toBeInTheDocument()

      // Act - switch to QA
      rerender(
        <ChunkCardList
          chunkType={ChunkingMode.qa}
          chunkInfo={qaChunks}
        />,
      )

      // Assert QA state
      expect(screen.queryByText('Text content')).not.toBeInTheDocument()
      expect(screen.getByText('What is the answer to life?')).toBeInTheDocument()
    })

    it('should handle switching from text to parent-child type', () => {
      // Arrange
      const textChunks = createGeneralChunks([{ content: 'Simple text' }])
      const parentChildChunks = createParentChildChunks()

      const { rerender } = render(
        <ChunkCardList
          chunkType={ChunkingMode.text}
          chunkInfo={textChunks}
        />,
      )

      // Assert initial state
      expect(screen.getByText('Simple text')).toBeInTheDocument()
      expect(screen.getByText(/Chunk-01/)).toBeInTheDocument()

      // Act - switch to parent-child
      rerender(
        <ChunkCardList
          chunkType={ChunkingMode.parentChild}
          parentMode="paragraph"
          chunkInfo={parentChildChunks}
        />,
      )

      // Assert parent-child state
      expect(screen.queryByText('Simple text')).not.toBeInTheDocument()
      // Multiple Parent-Chunk elements exist, so use getAllByText
      expect(screen.getAllByText(/Parent-Chunk/).length).toBeGreaterThan(0)
    })
  })
})
