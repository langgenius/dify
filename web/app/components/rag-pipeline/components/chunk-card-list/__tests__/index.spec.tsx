import type { GeneralChunks, ParentChildChunk, ParentChildChunks, QAChunk, QAChunks } from '../types'
import { render, screen } from '@testing-library/react'
import { ChunkingMode } from '@/models/datasets'
import ChunkCard from '../chunk-card'
import { ChunkCardList } from '../index'
import QAItem from '../q-a-item'
import { QAItemType } from '../types'

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

describe('QAItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render question type with Q prefix', () => {
      render(<QAItem type={QAItemType.Question} text="What is this?" />)

      expect(screen.getByText('Q')).toBeInTheDocument()
      expect(screen.getByText('What is this?')).toBeInTheDocument()
    })

    it('should render answer type with A prefix', () => {
      render(<QAItem type={QAItemType.Answer} text="This is the answer." />)

      expect(screen.getByText('A')).toBeInTheDocument()
      expect(screen.getByText('This is the answer.')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should render with empty text', () => {
      render(<QAItem type={QAItemType.Question} text="" />)

      expect(screen.getByText('Q')).toBeInTheDocument()
    })

    it('should render with long text content', () => {
      const longText = 'A'.repeat(1000)

      render(<QAItem type={QAItemType.Answer} text={longText} />)

      expect(screen.getByText(longText)).toBeInTheDocument()
    })

    it('should render with special characters in text', () => {
      const specialText = '<script>alert("xss")</script> & "quotes" \'apostrophe\''

      render(<QAItem type={QAItemType.Question} text={specialText} />)

      expect(screen.getByText(specialText)).toBeInTheDocument()
    })
  })

  describe('Memoization', () => {
    it('should be memoized with React.memo', () => {
      const { rerender } = render(<QAItem type={QAItemType.Question} text="Test" />)

      expect(screen.getByText('Q')).toBeInTheDocument()
      expect(screen.getByText('Test')).toBeInTheDocument()

      rerender(<QAItem type={QAItemType.Question} text="Test" />)
      expect(screen.getByText('Q')).toBeInTheDocument()
    })
  })
})

describe('ChunkCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render text chunk type correctly', () => {
      render(
        <ChunkCard
          chunkType={ChunkingMode.text}
          content={createGeneralChunks()[0]}
          wordCount={27}
          positionId={1}
        />,
      )

      expect(screen.getByText('This is the first chunk of text content.')).toBeInTheDocument()
      expect(screen.getByText(/Chunk-01/)).toBeInTheDocument()
    })

    it('should render QA chunk type with question and answer', () => {
      const qaContent: QAChunk = {
        question: 'What is React?',
        answer: 'React is a JavaScript library.',
      }

      render(
        <ChunkCard
          chunkType={ChunkingMode.qa}
          content={qaContent}
          wordCount={45}
          positionId={2}
        />,
      )

      expect(screen.getByText('Q')).toBeInTheDocument()
      expect(screen.getByText('What is React?')).toBeInTheDocument()
      expect(screen.getByText('A')).toBeInTheDocument()
      expect(screen.getByText('React is a JavaScript library.')).toBeInTheDocument()
    })

    it('should render parent-child chunk type with child contents', () => {
      const childContents = ['Child 1 content', 'Child 2 content']

      render(
        <ChunkCard
          chunkType={ChunkingMode.parentChild}
          parentMode="paragraph"
          content={createParentChildChunk({ child_contents: childContents })}
          wordCount={50}
          positionId={1}
        />,
      )

      expect(screen.getByText('Child 1 content')).toBeInTheDocument()
      expect(screen.getByText('Child 2 content')).toBeInTheDocument()
      expect(screen.getByText('C-1')).toBeInTheDocument()
      expect(screen.getByText('C-2')).toBeInTheDocument()
    })
  })

  describe('Parent Mode Variations', () => {
    it('should show Parent-Chunk label prefix for paragraph mode', () => {
      render(
        <ChunkCard
          chunkType={ChunkingMode.parentChild}
          parentMode="paragraph"
          content={createParentChildChunk({ child_contents: ['Child content'] })}
          wordCount={13}
          positionId={1}
        />,
      )

      expect(screen.getByText(/Parent-Chunk-01/)).toBeInTheDocument()
    })

    it('should hide segment index tag for full-doc mode', () => {
      render(
        <ChunkCard
          chunkType={ChunkingMode.parentChild}
          parentMode="full-doc"
          content={createParentChildChunk({ child_contents: ['Child content'] })}
          wordCount={13}
          positionId={1}
        />,
      )

      expect(screen.queryByText(/Chunk/)).not.toBeInTheDocument()
      expect(screen.queryByText(/Parent-Chunk/)).not.toBeInTheDocument()
    })

    it('should show Chunk label prefix for text mode', () => {
      render(
        <ChunkCard
          chunkType={ChunkingMode.text}
          content={createGeneralChunks()[0]}
          wordCount={12}
          positionId={5}
        />,
      )

      expect(screen.getByText(/Chunk-05/)).toBeInTheDocument()
    })
  })

  describe('Word Count Display', () => {
    it('should display formatted word count', () => {
      render(
        <ChunkCard
          chunkType={ChunkingMode.text}
          content={createGeneralChunks()[0]}
          wordCount={1234}
          positionId={1}
        />,
      )

      expect(screen.getByText(/1,234/)).toBeInTheDocument()
    })

    it('should display word count with character translation key', () => {
      render(
        <ChunkCard
          chunkType={ChunkingMode.text}
          content={createGeneralChunks()[0]}
          wordCount={100}
          positionId={1}
        />,
      )

      expect(screen.getByText(/100\s+(?:\S.*)?characters/)).toBeInTheDocument()
    })

    it('should not display word count info for full-doc mode', () => {
      render(
        <ChunkCard
          chunkType={ChunkingMode.parentChild}
          parentMode="full-doc"
          content={createParentChildChunk({ child_contents: ['Child'] })}
          wordCount={500}
          positionId={1}
        />,
      )

      expect(screen.queryByText(/500/)).not.toBeInTheDocument()
    })
  })

  describe('Position ID', () => {
    it('should handle numeric position ID', () => {
      render(
        <ChunkCard
          chunkType={ChunkingMode.text}
          content={createGeneralChunks()[0]}
          wordCount={7}
          positionId={42}
        />,
      )

      expect(screen.getByText(/Chunk-42/)).toBeInTheDocument()
    })

    it('should handle string position ID', () => {
      render(
        <ChunkCard
          chunkType={ChunkingMode.text}
          content={createGeneralChunks()[0]}
          wordCount={7}
          positionId="99"
        />,
      )

      expect(screen.getByText(/Chunk-99/)).toBeInTheDocument()
    })

    it('should pad single digit position ID', () => {
      render(
        <ChunkCard
          chunkType={ChunkingMode.text}
          content={createGeneralChunks()[0]}
          wordCount={7}
          positionId={3}
        />,
      )

      expect(screen.getByText(/Chunk-03/)).toBeInTheDocument()
    })
  })

  describe('Memoization', () => {
    it('should update isFullDoc memo when parentMode changes', () => {
      const { rerender } = render(
        <ChunkCard
          chunkType={ChunkingMode.parentChild}
          parentMode="paragraph"
          content={createParentChildChunk({ child_contents: ['Child'] })}
          wordCount={5}
          positionId={1}
        />,
      )

      expect(screen.getByText(/Parent-Chunk/)).toBeInTheDocument()

      rerender(
        <ChunkCard
          chunkType={ChunkingMode.parentChild}
          parentMode="full-doc"
          content={createParentChildChunk({ child_contents: ['Child'] })}
          wordCount={5}
          positionId={1}
        />,
      )

      expect(screen.queryByText(/Parent-Chunk/)).not.toBeInTheDocument()
    })

    it('should update contentElement memo when content changes', () => {
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

      expect(screen.getByText('Initial content')).toBeInTheDocument()

      rerender(
        <ChunkCard
          chunkType={ChunkingMode.text}
          content={updatedContent}
          wordCount={15}
          positionId={1}
        />,
      )

      expect(screen.getByText('Updated content')).toBeInTheDocument()
      expect(screen.queryByText('Initial content')).not.toBeInTheDocument()
    })

    it('should update contentElement memo when chunkType changes', () => {
      const textContent = { content: 'Text content' }
      const { rerender } = render(
        <ChunkCard
          chunkType={ChunkingMode.text}
          content={textContent}
          wordCount={12}
          positionId={1}
        />,
      )

      expect(screen.getByText('Text content')).toBeInTheDocument()

      const qaContent: QAChunk = { question: 'Q?', answer: 'A.' }
      rerender(
        <ChunkCard
          chunkType={ChunkingMode.qa}
          content={qaContent}
          wordCount={4}
          positionId={1}
        />,
      )

      expect(screen.getByText('Q')).toBeInTheDocument()
      expect(screen.getByText('Q?')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty child contents array', () => {
      render(
        <ChunkCard
          chunkType={ChunkingMode.parentChild}
          parentMode="paragraph"
          content={createParentChildChunk({ child_contents: [] })}
          wordCount={0}
          positionId={1}
        />,
      )

      expect(screen.getByText(/Parent-Chunk-01/)).toBeInTheDocument()
    })

    it('should handle QA chunk with empty strings', () => {
      const emptyQA: QAChunk = { question: '', answer: '' }

      render(
        <ChunkCard
          chunkType={ChunkingMode.qa}
          content={emptyQA}
          wordCount={0}
          positionId={1}
        />,
      )

      expect(screen.getByText('Q')).toBeInTheDocument()
      expect(screen.getByText('A')).toBeInTheDocument()
    })

    it('should handle very long content', () => {
      const longContent = 'A'.repeat(10000)
      const longContentChunk = { content: longContent }

      render(
        <ChunkCard
          chunkType={ChunkingMode.text}
          content={longContentChunk}
          wordCount={10000}
          positionId={1}
        />,
      )

      expect(screen.getByText(longContent)).toBeInTheDocument()
    })

    it('should handle zero word count', () => {
      render(
        <ChunkCard
          chunkType={ChunkingMode.text}
          content={createGeneralChunks()[0]}
          wordCount={0}
          positionId={1}
        />,
      )

      expect(screen.getByText(/0\s+(?:\S.*)?characters/)).toBeInTheDocument()
    })
  })
})

describe('ChunkCardList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render text chunks correctly', () => {
      const chunks = createGeneralChunks()

      render(
        <ChunkCardList
          chunkType={ChunkingMode.text}
          chunkInfo={chunks}
        />,
      )

      expect(screen.getByText(chunks[0].content)).toBeInTheDocument()
      expect(screen.getByText(chunks[1].content)).toBeInTheDocument()
      expect(screen.getByText(chunks[2].content)).toBeInTheDocument()
    })

    it('should render parent-child chunks correctly', () => {
      const chunks = createParentChildChunks()

      render(
        <ChunkCardList
          chunkType={ChunkingMode.parentChild}
          parentMode="paragraph"
          chunkInfo={chunks}
        />,
      )

      expect(screen.getByText('Child content 1')).toBeInTheDocument()
      expect(screen.getByText('Child content 2')).toBeInTheDocument()
      expect(screen.getByText('Another child 1')).toBeInTheDocument()
    })

    it('should render QA chunks correctly', () => {
      const chunks = createQAChunks()

      render(
        <ChunkCardList
          chunkType={ChunkingMode.qa}
          chunkInfo={chunks}
        />,
      )

      expect(screen.getByText('What is the answer to life?')).toBeInTheDocument()
      expect(screen.getByText('The answer is 42.')).toBeInTheDocument()
      expect(screen.getByText('How does this work?')).toBeInTheDocument()
      expect(screen.getByText('It works by processing data.')).toBeInTheDocument()
    })
  })

  describe('Memoization - chunkList', () => {
    it('should extract chunks from GeneralChunks for text mode', () => {
      const chunks: GeneralChunks = [
        { content: 'Chunk 1' },
        { content: 'Chunk 2' },
      ]

      render(
        <ChunkCardList
          chunkType={ChunkingMode.text}
          chunkInfo={chunks}
        />,
      )

      expect(screen.getByText('Chunk 1')).toBeInTheDocument()
      expect(screen.getByText('Chunk 2')).toBeInTheDocument()
    })

    it('should extract parent_child_chunks from ParentChildChunks for parentChild mode', () => {
      const chunks = createParentChildChunks({
        parent_child_chunks: [
          createParentChildChunk({ child_contents: ['Specific child'] }),
        ],
      })

      render(
        <ChunkCardList
          chunkType={ChunkingMode.parentChild}
          parentMode="paragraph"
          chunkInfo={chunks}
        />,
      )

      expect(screen.getByText('Specific child')).toBeInTheDocument()
    })

    it('should extract qa_chunks from QAChunks for qa mode', () => {
      const chunks: QAChunks = {
        qa_chunks: [
          { question: 'Specific Q', answer: 'Specific A' },
        ],
      }

      render(
        <ChunkCardList
          chunkType={ChunkingMode.qa}
          chunkInfo={chunks}
        />,
      )

      expect(screen.getByText('Specific Q')).toBeInTheDocument()
      expect(screen.getByText('Specific A')).toBeInTheDocument()
    })

    it('should update chunkList when chunkInfo changes', () => {
      const initialChunks = createGeneralChunks([{ content: 'Initial chunk' }])

      const { rerender } = render(
        <ChunkCardList
          chunkType={ChunkingMode.text}
          chunkInfo={initialChunks}
        />,
      )

      expect(screen.getByText('Initial chunk')).toBeInTheDocument()

      const updatedChunks = createGeneralChunks([{ content: 'Updated chunk' }])
      rerender(
        <ChunkCardList
          chunkType={ChunkingMode.text}
          chunkInfo={updatedChunks}
        />,
      )

      expect(screen.getByText('Updated chunk')).toBeInTheDocument()
      expect(screen.queryByText('Initial chunk')).not.toBeInTheDocument()
    })
  })

  describe('Word Count Calculation', () => {
    it('should calculate word count for text chunks using string length', () => {
      const chunks = createGeneralChunks([{ content: 'Hello' }])

      render(
        <ChunkCardList
          chunkType={ChunkingMode.text}
          chunkInfo={chunks}
        />,
      )

      expect(screen.getByText(/5\s+(?:\S.*)?characters/)).toBeInTheDocument()
    })

    it('should calculate word count for parent-child chunks using parent_content length', () => {
      const chunks = createParentChildChunks({
        parent_child_chunks: [
          createParentChildChunk({
            parent_content: 'Parent', // 6 characters
            child_contents: ['Child'],
          }),
        ],
      })

      render(
        <ChunkCardList
          chunkType={ChunkingMode.parentChild}
          parentMode="paragraph"
          chunkInfo={chunks}
        />,
      )

      expect(screen.getByText(/6\s+(?:\S.*)?characters/)).toBeInTheDocument()
    })

    it('should calculate word count for QA chunks using question + answer length', () => {
      const chunks: QAChunks = {
        qa_chunks: [
          { question: 'Hi', answer: 'Bye' },
        ],
      }

      render(
        <ChunkCardList
          chunkType={ChunkingMode.qa}
          chunkInfo={chunks}
        />,
      )

      expect(screen.getByText(/5\s+(?:\S.*)?characters/)).toBeInTheDocument()
    })
  })

  describe('Position ID', () => {
    it('should assign 1-based position IDs to chunks', () => {
      const chunks = createGeneralChunks([
        { content: 'First' },
        { content: 'Second' },
        { content: 'Third' },
      ])

      render(
        <ChunkCardList
          chunkType={ChunkingMode.text}
          chunkInfo={chunks}
        />,
      )

      expect(screen.getByText(/Chunk-01/)).toBeInTheDocument()
      expect(screen.getByText(/Chunk-02/)).toBeInTheDocument()
      expect(screen.getByText(/Chunk-03/)).toBeInTheDocument()
    })
  })

  describe('Custom className', () => {
    it('should apply custom className to container', () => {
      const chunks = createGeneralChunks([{ content: 'Test' }])

      const { container } = render(
        <ChunkCardList
          chunkType={ChunkingMode.text}
          chunkInfo={chunks}
          className="custom-class"
        />,
      )

      expect(container.firstChild).toHaveClass('custom-class')
    })

    it('should merge custom className with default classes', () => {
      const chunks = createGeneralChunks([{ content: 'Test' }])

      const { container } = render(
        <ChunkCardList
          chunkType={ChunkingMode.text}
          chunkInfo={chunks}
          className="my-custom-class"
        />,
      )

      expect(container.firstChild).toHaveClass('flex')
      expect(container.firstChild).toHaveClass('w-full')
      expect(container.firstChild).toHaveClass('flex-col')
      expect(container.firstChild).toHaveClass('my-custom-class')
    })

    it('should render without className prop', () => {
      const chunks = createGeneralChunks([{ content: 'Test' }])

      const { container } = render(
        <ChunkCardList
          chunkType={ChunkingMode.text}
          chunkInfo={chunks}
        />,
      )

      expect(container.firstChild).toHaveClass('flex')
      expect(container.firstChild).toHaveClass('w-full')
    })
  })

  describe('Parent Mode', () => {
    it('should pass parentMode to ChunkCard for parent-child type', () => {
      const chunks = createParentChildChunks()

      render(
        <ChunkCardList
          chunkType={ChunkingMode.parentChild}
          parentMode="paragraph"
          chunkInfo={chunks}
        />,
      )

      expect(screen.getAllByText(/Parent-Chunk/).length).toBeGreaterThan(0)
    })

    it('should handle full-doc parentMode', () => {
      const chunks = createParentChildChunks()

      render(
        <ChunkCardList
          chunkType={ChunkingMode.parentChild}
          parentMode="full-doc"
          chunkInfo={chunks}
        />,
      )

      expect(screen.queryByText(/Parent-Chunk/)).not.toBeInTheDocument()
      expect(screen.queryByText(/Chunk-/)).not.toBeInTheDocument()
    })

    it('should not use parentMode for text type', () => {
      const chunks = createGeneralChunks([{ content: 'Text' }])

      render(
        <ChunkCardList
          chunkType={ChunkingMode.text}
          parentMode="full-doc" // Should be ignored
          chunkInfo={chunks}
        />,
      )

      expect(screen.getByText(/Chunk-01/)).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty GeneralChunks array', () => {
      const chunks: GeneralChunks = []

      const { container } = render(
        <ChunkCardList
          chunkType={ChunkingMode.text}
          chunkInfo={chunks}
        />,
      )

      expect(container.firstChild).toBeInTheDocument()
      expect(container.firstChild?.childNodes.length).toBe(0)
    })

    it('should handle empty ParentChildChunks', () => {
      const chunks: ParentChildChunks = {
        parent_child_chunks: [],
        parent_mode: 'paragraph',
      }

      const { container } = render(
        <ChunkCardList
          chunkType={ChunkingMode.parentChild}
          parentMode="paragraph"
          chunkInfo={chunks}
        />,
      )

      expect(container.firstChild).toBeInTheDocument()
      expect(container.firstChild?.childNodes.length).toBe(0)
    })

    it('should handle empty QAChunks', () => {
      const chunks: QAChunks = {
        qa_chunks: [],
      }

      const { container } = render(
        <ChunkCardList
          chunkType={ChunkingMode.qa}
          chunkInfo={chunks}
        />,
      )

      expect(container.firstChild).toBeInTheDocument()
      expect(container.firstChild?.childNodes.length).toBe(0)
    })

    it('should handle single item in chunks', () => {
      const chunks = createGeneralChunks([{ content: 'Single chunk' }])

      render(
        <ChunkCardList
          chunkType={ChunkingMode.text}
          chunkInfo={chunks}
        />,
      )

      expect(screen.getByText('Single chunk')).toBeInTheDocument()
      expect(screen.getByText(/Chunk-01/)).toBeInTheDocument()
    })

    it('should handle large number of chunks', () => {
      const chunks = Array.from({ length: 100 }, (_, i) => ({ content: `Chunk number ${i + 1}` }))

      render(
        <ChunkCardList
          chunkType={ChunkingMode.text}
          chunkInfo={chunks}
        />,
      )

      expect(screen.getByText('Chunk number 1')).toBeInTheDocument()
      expect(screen.getByText('Chunk number 100')).toBeInTheDocument()
      expect(screen.getByText(/Chunk-100/)).toBeInTheDocument()
    })
  })

  describe('Key Generation', () => {
    it('should generate unique keys for chunks', () => {
      const chunks = createGeneralChunks([
        { content: 'Same content' },
        { content: 'Same content' },
        { content: 'Same content' },
      ])
      const { container } = render(
        <ChunkCardList
          chunkType={ChunkingMode.text}
          chunkInfo={chunks}
        />,
      )

      const chunkCards = container.querySelectorAll('.bg-components-panel-bg')
      expect(chunkCards.length).toBe(3)
    })
  })
})

describe('ChunkCardList Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Complete Workflows', () => {
    it('should render complete text chunking workflow', () => {
      const textChunks = createGeneralChunks([
        { content: 'First paragraph of the document.' },
        { content: 'Second paragraph with more information.' },
        { content: 'Final paragraph concluding the content.' },
      ])

      render(
        <ChunkCardList
          chunkType={ChunkingMode.text}
          chunkInfo={textChunks}
        />,
      )

      expect(screen.getByText('First paragraph of the document.')).toBeInTheDocument()
      expect(screen.getByText(/Chunk-01/)).toBeInTheDocument()
      expect(screen.getByText(/32\s+(?:\S.*)?characters/)).toBeInTheDocument()

      expect(screen.getByText('Second paragraph with more information.')).toBeInTheDocument()
      expect(screen.getByText(/Chunk-02/)).toBeInTheDocument()

      expect(screen.getByText('Final paragraph concluding the content.')).toBeInTheDocument()
      expect(screen.getByText(/Chunk-03/)).toBeInTheDocument()
    })

    it('should render complete parent-child chunking workflow', () => {
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

      render(
        <ChunkCardList
          chunkType={ChunkingMode.parentChild}
          parentMode="paragraph"
          chunkInfo={parentChildChunks}
        />,
      )

      expect(screen.getByText('React components are building blocks.')).toBeInTheDocument()
      expect(screen.getByText('Lifecycle methods control component behavior.')).toBeInTheDocument()
      expect(screen.getByText('C-1')).toBeInTheDocument()
      expect(screen.getByText('C-2')).toBeInTheDocument()
      expect(screen.getByText(/Parent-Chunk-01/)).toBeInTheDocument()
    })

    it('should render complete QA chunking workflow', () => {
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

      render(
        <ChunkCardList
          chunkType={ChunkingMode.qa}
          chunkInfo={qaChunks}
        />,
      )

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

  describe('Type Switching', () => {
    it('should handle switching from text to QA type', () => {
      const textChunks = createGeneralChunks([{ content: 'Text content' }])
      const qaChunks = createQAChunks()

      const { rerender } = render(
        <ChunkCardList
          chunkType={ChunkingMode.text}
          chunkInfo={textChunks}
        />,
      )

      expect(screen.getByText('Text content')).toBeInTheDocument()

      rerender(
        <ChunkCardList
          chunkType={ChunkingMode.qa}
          chunkInfo={qaChunks}
        />,
      )

      expect(screen.queryByText('Text content')).not.toBeInTheDocument()
      expect(screen.getByText('What is the answer to life?')).toBeInTheDocument()
    })

    it('should handle switching from text to parent-child type', () => {
      const textChunks = createGeneralChunks([{ content: 'Simple text' }])
      const parentChildChunks = createParentChildChunks()

      const { rerender } = render(
        <ChunkCardList
          chunkType={ChunkingMode.text}
          chunkInfo={textChunks}
        />,
      )

      expect(screen.getByText('Simple text')).toBeInTheDocument()
      expect(screen.getByText(/Chunk-01/)).toBeInTheDocument()

      rerender(
        <ChunkCardList
          chunkType={ChunkingMode.parentChild}
          parentMode="paragraph"
          chunkInfo={parentChildChunks}
        />,
      )

      expect(screen.queryByText('Simple text')).not.toBeInTheDocument()
      expect(screen.getAllByText(/Parent-Chunk/).length).toBeGreaterThan(0)
    })
  })
})
