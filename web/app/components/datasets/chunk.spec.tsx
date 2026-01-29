import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ChunkContainer, ChunkLabel, QAPreview } from './chunk'

afterEach(() => {
  cleanup()
})

describe('ChunkLabel', () => {
  it('should render label text', () => {
    render(<ChunkLabel label="Chunk 1" characterCount={100} />)
    expect(screen.getByText('Chunk 1')).toBeInTheDocument()
  })

  it('should render character count', () => {
    render(<ChunkLabel label="Chunk 1" characterCount={150} />)
    expect(screen.getByText('150 characters')).toBeInTheDocument()
  })

  it('should render separator dot', () => {
    render(<ChunkLabel label="Chunk 1" characterCount={100} />)
    expect(screen.getByText('·')).toBeInTheDocument()
  })

  it('should render with zero character count', () => {
    render(<ChunkLabel label="Empty Chunk" characterCount={0} />)
    expect(screen.getByText('0 characters')).toBeInTheDocument()
  })

  it('should render with large character count', () => {
    render(<ChunkLabel label="Large Chunk" characterCount={999999} />)
    expect(screen.getByText('999999 characters')).toBeInTheDocument()
  })
})

describe('ChunkContainer', () => {
  it('should render label and character count', () => {
    render(<ChunkContainer label="Container 1" characterCount={200}>Content</ChunkContainer>)
    expect(screen.getByText('Container 1')).toBeInTheDocument()
    expect(screen.getByText('200 characters')).toBeInTheDocument()
  })

  it('should render children content', () => {
    render(<ChunkContainer label="Container 1" characterCount={200}>Test Content</ChunkContainer>)
    expect(screen.getByText('Test Content')).toBeInTheDocument()
  })

  it('should render with complex children', () => {
    render(
      <ChunkContainer label="Container" characterCount={100}>
        <div data-testid="child-div">
          <span>Nested content</span>
        </div>
      </ChunkContainer>,
    )
    expect(screen.getByTestId('child-div')).toBeInTheDocument()
    expect(screen.getByText('Nested content')).toBeInTheDocument()
  })

  it('should render empty children', () => {
    render(<ChunkContainer label="Empty" characterCount={0}>{null}</ChunkContainer>)
    expect(screen.getByText('Empty')).toBeInTheDocument()
  })
})

describe('QAPreview', () => {
  const mockQA = {
    question: 'What is the meaning of life?',
    answer: 'The meaning of life is 42.',
  }

  it('should render question text', () => {
    render(<QAPreview qa={mockQA} />)
    expect(screen.getByText('What is the meaning of life?')).toBeInTheDocument()
  })

  it('should render answer text', () => {
    render(<QAPreview qa={mockQA} />)
    expect(screen.getByText('The meaning of life is 42.')).toBeInTheDocument()
  })

  it('should render Q label', () => {
    render(<QAPreview qa={mockQA} />)
    expect(screen.getByText('Q')).toBeInTheDocument()
  })

  it('should render A label', () => {
    render(<QAPreview qa={mockQA} />)
    expect(screen.getByText('A')).toBeInTheDocument()
  })

  it('should render with empty strings', () => {
    render(<QAPreview qa={{ question: '', answer: '' }} />)
    expect(screen.getByText('Q')).toBeInTheDocument()
    expect(screen.getByText('A')).toBeInTheDocument()
  })

  it('should render with long text', () => {
    const longQuestion = 'Q'.repeat(500)
    const longAnswer = 'A'.repeat(500)
    render(<QAPreview qa={{ question: longQuestion, answer: longAnswer }} />)
    expect(screen.getByText(longQuestion)).toBeInTheDocument()
    expect(screen.getByText(longAnswer)).toBeInTheDocument()
  })

  it('should render with special characters', () => {
    render(<QAPreview qa={{ question: 'What about <script>?', answer: '& special chars!' }} />)
    expect(screen.getByText('What about <script>?')).toBeInTheDocument()
    expect(screen.getByText('& special chars!')).toBeInTheDocument()
  })
})
