import type { QA } from '@/models/datasets'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChunkContainer, ChunkLabel, QAPreview } from '../chunk'

vi.mock('../../base/icons/src/public/knowledge', () => ({
  SelectionMod: (props: React.ComponentProps<'svg'>) => (
    <svg data-testid="selection-mod-icon" {...props} />
  ),
}))

function createQA(overrides: Partial<QA> = {}): QA {
  return {
    question: 'What is Dify?',
    answer: 'Dify is an open-source LLM app development platform.',
    ...overrides,
  }
}

describe('ChunkLabel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render the label text', () => {
      render(<ChunkLabel label="Chunk #1" characterCount={100} />)

      expect(screen.getByText('Chunk #1')).toBeInTheDocument()
    })

    it('should render the character count with unit', () => {
      render(<ChunkLabel label="Chunk #1" characterCount={256} />)

      expect(screen.getByText('256 characters')).toBeInTheDocument()
    })

    it('should render the SelectionMod icon', () => {
      render(<ChunkLabel label="Chunk" characterCount={10} />)

      expect(screen.getByTestId('selection-mod-icon')).toBeInTheDocument()
    })

    it('should render a middle dot separator between label and count', () => {
      render(<ChunkLabel label="Chunk" characterCount={10} />)

      expect(screen.getByText('·')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should display zero character count', () => {
      render(<ChunkLabel label="Empty Chunk" characterCount={0} />)

      expect(screen.getByText('0 characters')).toBeInTheDocument()
    })

    it('should display large character counts', () => {
      render(<ChunkLabel label="Large" characterCount={999999} />)

      expect(screen.getByText('999999 characters')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should render with empty label', () => {
      render(<ChunkLabel label="" characterCount={50} />)

      expect(screen.getByText('50 characters')).toBeInTheDocument()
    })

    it('should render with special characters in label', () => {
      render(<ChunkLabel label="Chunk <#1> & 'test'" characterCount={10} />)

      expect(screen.getByText('Chunk <#1> & \'test\'')).toBeInTheDocument()
    })
  })
})

// Tests for ChunkContainer - wraps ChunkLabel with children content area
describe('ChunkContainer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render ChunkLabel with correct props', () => {
      render(
        <ChunkContainer label="Chunk #1" characterCount={200}>
          Content here
        </ChunkContainer>,
      )

      expect(screen.getByText('Chunk #1')).toBeInTheDocument()
      expect(screen.getByText('200 characters')).toBeInTheDocument()
    })

    it('should render children in the content area', () => {
      render(
        <ChunkContainer label="Chunk" characterCount={50}>
          <p>Paragraph content</p>
        </ChunkContainer>,
      )

      expect(screen.getByText('Paragraph content')).toBeInTheDocument()
    })

    it('should render the SelectionMod icon via ChunkLabel', () => {
      render(
        <ChunkContainer label="Chunk" characterCount={10}>
          Content
        </ChunkContainer>,
      )

      expect(screen.getByTestId('selection-mod-icon')).toBeInTheDocument()
    })
  })

  describe('Structure', () => {
    it('should have space-y-2 on the outer container', () => {
      const { container } = render(
        <ChunkContainer label="Chunk" characterCount={10}>Content</ChunkContainer>,
      )

      expect(container.firstElementChild).toHaveClass('space-y-2')
    })

    it('should render children inside a styled content div', () => {
      render(
        <ChunkContainer label="Chunk" characterCount={10}>
          <span>Test child</span>
        </ChunkContainer>,
      )

      const contentDiv = screen.getByText('Test child').parentElement
      expect(contentDiv).toHaveClass('body-md-regular', 'text-text-secondary')
    })
  })

  describe('Edge Cases', () => {
    it('should render without children', () => {
      const { container } = render(
        <ChunkContainer label="Empty" characterCount={0} />,
      )

      expect(container.firstElementChild).toBeInTheDocument()
      expect(screen.getByText('Empty')).toBeInTheDocument()
    })

    it('should render multiple children', () => {
      render(
        <ChunkContainer label="Multi" characterCount={100}>
          <span>First</span>
          <span>Second</span>
        </ChunkContainer>,
      )

      expect(screen.getByText('First')).toBeInTheDocument()
      expect(screen.getByText('Second')).toBeInTheDocument()
    })

    it('should render with string children', () => {
      render(
        <ChunkContainer label="Text" characterCount={5}>
          Plain text content
        </ChunkContainer>,
      )

      expect(screen.getByText('Plain text content')).toBeInTheDocument()
    })
  })
})

// Tests for QAPreview - displays question and answer pair
describe('QAPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render the question text', () => {
      const qa = createQA()
      render(<QAPreview qa={qa} />)

      expect(screen.getByText('What is Dify?')).toBeInTheDocument()
    })

    it('should render the answer text', () => {
      const qa = createQA()
      render(<QAPreview qa={qa} />)

      expect(screen.getByText('Dify is an open-source LLM app development platform.')).toBeInTheDocument()
    })

    it('should render Q and A labels', () => {
      const qa = createQA()
      render(<QAPreview qa={qa} />)

      expect(screen.getByText('Q')).toBeInTheDocument()
      expect(screen.getByText('A')).toBeInTheDocument()
    })
  })

  describe('Structure', () => {
    it('should render Q label as a label element', () => {
      const qa = createQA()
      render(<QAPreview qa={qa} />)

      const qLabel = screen.getByText('Q')
      expect(qLabel.tagName).toBe('LABEL')
    })

    it('should render A label as a label element', () => {
      const qa = createQA()
      render(<QAPreview qa={qa} />)

      const aLabel = screen.getByText('A')
      expect(aLabel.tagName).toBe('LABEL')
    })

    it('should render question in a p element', () => {
      const qa = createQA()
      render(<QAPreview qa={qa} />)

      const questionEl = screen.getByText(qa.question)
      expect(questionEl.tagName).toBe('P')
    })

    it('should render answer in a p element', () => {
      const qa = createQA()
      render(<QAPreview qa={qa} />)

      const answerEl = screen.getByText(qa.answer)
      expect(answerEl.tagName).toBe('P')
    })

    it('should have the outer container with flex column layout', () => {
      const qa = createQA()
      const { container } = render(<QAPreview qa={qa} />)

      expect(container.firstElementChild).toHaveClass('flex', 'flex-col', 'gap-y-2')
    })

    it('should apply text styling classes to question paragraph', () => {
      const qa = createQA()
      render(<QAPreview qa={qa} />)

      const questionEl = screen.getByText(qa.question)
      expect(questionEl).toHaveClass('body-md-regular', 'text-text-secondary')
    })

    it('should apply text styling classes to answer paragraph', () => {
      const qa = createQA()
      render(<QAPreview qa={qa} />)

      const answerEl = screen.getByText(qa.answer)
      expect(answerEl).toHaveClass('body-md-regular', 'text-text-secondary')
    })
  })

  describe('Edge Cases', () => {
    it('should render with empty question', () => {
      const qa = createQA({ question: '' })
      render(<QAPreview qa={qa} />)

      expect(screen.getByText('Q')).toBeInTheDocument()
      expect(screen.getByText('A')).toBeInTheDocument()
    })

    it('should render with empty answer', () => {
      const qa = createQA({ answer: '' })
      render(<QAPreview qa={qa} />)

      expect(screen.getByText('Q')).toBeInTheDocument()
      expect(screen.getByText(qa.question)).toBeInTheDocument()
    })

    it('should render with long text', () => {
      const longText = 'x'.repeat(1000)
      const qa = createQA({ question: longText, answer: longText })
      render(<QAPreview qa={qa} />)

      const elements = screen.getAllByText(longText)
      expect(elements).toHaveLength(2)
    })

    it('should render with special characters in question and answer', () => {
      const qa = createQA({
        question: 'What about <html> & "quotes"?',
        answer: 'It handles \'single\' & "double" quotes.',
      })
      render(<QAPreview qa={qa} />)

      expect(screen.getByText('What about <html> & "quotes"?')).toBeInTheDocument()
      expect(screen.getByText('It handles \'single\' & "double" quotes.')).toBeInTheDocument()
    })

    it('should render with multiline text', () => {
      const qa = createQA({
        question: 'Line1\nLine2',
        answer: 'Answer1\nAnswer2',
      })
      render(<QAPreview qa={qa} />)

      expect(screen.getByText(/Line1/)).toBeInTheDocument()
      expect(screen.getByText(/Answer1/)).toBeInTheDocument()
    })
  })
})
