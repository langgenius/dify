import { fireEvent, render, screen } from '@testing-library/react'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChunkingMode } from '@/models/datasets'
import ChunkContent from '../chunk-content'

// Mock ResizeObserver
const OriginalResizeObserver = globalThis.ResizeObserver
class MockResizeObserver {
  observe = vi.fn()
  disconnect = vi.fn()
  unobserve = vi.fn()
}

beforeAll(() => {
  globalThis.ResizeObserver = MockResizeObserver as typeof ResizeObserver
})

afterAll(() => {
  globalThis.ResizeObserver = OriginalResizeObserver
})

describe('ChunkContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const defaultProps = {
    question: 'Test question content',
    onQuestionChange: vi.fn(),
    docForm: ChunkingMode.text,
  }

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(<ChunkContent {...defaultProps} />)

      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render textarea in edit mode with text docForm', () => {
      render(<ChunkContent {...defaultProps} isEditMode={true} />)

      const textarea = screen.getByRole('textbox')
      expect(textarea).toBeInTheDocument()
    })

    it('should render Markdown content in view mode with text docForm', () => {
      const { container } = render(<ChunkContent {...defaultProps} isEditMode={false} />)

      // Assert - In view mode, textarea should not be present, Markdown renders instead
      expect(container.querySelector('textarea')).not.toBeInTheDocument()
    })
  })

  // QA mode tests
  describe('QA Mode', () => {
    it('should render QA layout when docForm is qa', () => {
      render(
        <ChunkContent
          {...defaultProps}
          docForm={ChunkingMode.qa}
          answer="Test answer"
          onAnswerChange={vi.fn()}
          isEditMode={true}
        />,
      )

      // Assert - QA mode has QUESTION and ANSWER labels
      expect(screen.getByText('QUESTION')).toBeInTheDocument()
      expect(screen.getByText('ANSWER')).toBeInTheDocument()
    })

    it('should display question value in QA mode', () => {
      render(
        <ChunkContent
          {...defaultProps}
          docForm={ChunkingMode.qa}
          question="My question"
          answer="My answer"
          onAnswerChange={vi.fn()}
          isEditMode={true}
        />,
      )

      const textareas = screen.getAllByRole('textbox')
      expect(textareas[0]).toHaveValue('My question')
    })

    it('should display answer value in QA mode', () => {
      render(
        <ChunkContent
          {...defaultProps}
          docForm={ChunkingMode.qa}
          question="My question"
          answer="My answer"
          onAnswerChange={vi.fn()}
          isEditMode={true}
        />,
      )

      const textareas = screen.getAllByRole('textbox')
      expect(textareas[1]).toHaveValue('My answer')
    })
  })

  describe('User Interactions', () => {
    it('should call onQuestionChange when textarea value changes in text mode', () => {
      const mockOnQuestionChange = vi.fn()
      render(
        <ChunkContent
          {...defaultProps}
          isEditMode={true}
          onQuestionChange={mockOnQuestionChange}
        />,
      )

      const textarea = screen.getByRole('textbox')
      fireEvent.change(textarea, { target: { value: 'New content' } })

      expect(mockOnQuestionChange).toHaveBeenCalledWith('New content')
    })

    it('should call onQuestionChange when question textarea changes in QA mode', () => {
      const mockOnQuestionChange = vi.fn()
      render(
        <ChunkContent
          {...defaultProps}
          docForm={ChunkingMode.qa}
          isEditMode={true}
          onQuestionChange={mockOnQuestionChange}
          onAnswerChange={vi.fn()}
        />,
      )

      const textareas = screen.getAllByRole('textbox')
      fireEvent.change(textareas[0], { target: { value: 'New question' } })

      expect(mockOnQuestionChange).toHaveBeenCalledWith('New question')
    })

    it('should call onAnswerChange when answer textarea changes in QA mode', () => {
      const mockOnAnswerChange = vi.fn()
      render(
        <ChunkContent
          {...defaultProps}
          docForm={ChunkingMode.qa}
          isEditMode={true}
          answer="Old answer"
          onAnswerChange={mockOnAnswerChange}
        />,
      )

      const textareas = screen.getAllByRole('textbox')
      fireEvent.change(textareas[1], { target: { value: 'New answer' } })

      expect(mockOnAnswerChange).toHaveBeenCalledWith('New answer')
    })

    it('should disable textarea when isEditMode is false in text mode', () => {
      const { container } = render(
        <ChunkContent {...defaultProps} isEditMode={false} />,
      )

      // Assert - In view mode, Markdown is rendered instead of textarea
      expect(container.querySelector('textarea')).not.toBeInTheDocument()
    })

    it('should disable textareas when isEditMode is false in QA mode', () => {
      render(
        <ChunkContent
          {...defaultProps}
          docForm={ChunkingMode.qa}
          isEditMode={false}
          answer="Answer"
          onAnswerChange={vi.fn()}
        />,
      )

      const textareas = screen.getAllByRole('textbox')
      textareas.forEach((textarea) => {
        expect(textarea).toBeDisabled()
      })
    })
  })

  // DocForm variations
  describe('DocForm Variations', () => {
    it('should handle ChunkingMode.text', () => {
      render(<ChunkContent {...defaultProps} docForm={ChunkingMode.text} isEditMode={true} />)

      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('should handle ChunkingMode.qa', () => {
      render(
        <ChunkContent
          {...defaultProps}
          docForm={ChunkingMode.qa}
          answer="answer"
          onAnswerChange={vi.fn()}
          isEditMode={true}
        />,
      )

      // Assert - QA mode should show both question and answer
      expect(screen.getByText('QUESTION')).toBeInTheDocument()
      expect(screen.getByText('ANSWER')).toBeInTheDocument()
    })

    it('should handle ChunkingMode.parentChild similar to text mode', () => {
      render(
        <ChunkContent
          {...defaultProps}
          docForm={ChunkingMode.parentChild}
          isEditMode={true}
        />,
      )

      // Assert - parentChild should render like text mode
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty question', () => {
      render(
        <ChunkContent
          {...defaultProps}
          question=""
          isEditMode={true}
        />,
      )

      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveValue('')
    })

    it('should handle empty answer in QA mode', () => {
      render(
        <ChunkContent
          {...defaultProps}
          docForm={ChunkingMode.qa}
          question="question"
          answer=""
          onAnswerChange={vi.fn()}
          isEditMode={true}
        />,
      )

      const textareas = screen.getAllByRole('textbox')
      expect(textareas[1]).toHaveValue('')
    })

    it('should handle undefined answer in QA mode', () => {
      render(
        <ChunkContent
          {...defaultProps}
          docForm={ChunkingMode.qa}
          isEditMode={true}
        />,
      )

      // Assert - should render without crashing
      expect(screen.getByText('QUESTION')).toBeInTheDocument()
    })

    it('should maintain structure when rerendered', () => {
      const { rerender } = render(
        <ChunkContent {...defaultProps} question="Initial" isEditMode={true} />,
      )

      rerender(
        <ChunkContent {...defaultProps} question="Updated" isEditMode={true} />,
      )

      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveValue('Updated')
    })
  })
})
