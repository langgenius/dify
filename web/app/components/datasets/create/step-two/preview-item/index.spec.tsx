import type { IPreviewItemProps } from './index'
import { render, screen } from '@testing-library/react'
import * as React from 'react'
import PreviewItem, { PreviewType } from './index'

// Test data builder for props
const createDefaultProps = (overrides?: Partial<IPreviewItemProps>): IPreviewItemProps => ({
  type: PreviewType.TEXT,
  index: 1,
  content: 'Test content',
  ...overrides,
})

const createQAProps = (overrides?: Partial<IPreviewItemProps>): IPreviewItemProps => ({
  type: PreviewType.QA,
  index: 1,
  qa: {
    question: 'Test question',
    answer: 'Test answer',
  },
  ...overrides,
})

describe('PreviewItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ==========================================
  // Rendering Tests - Verify component renders correctly
  // ==========================================
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<PreviewItem {...props} />)

      // Assert
      expect(screen.getByText('Test content')).toBeInTheDocument()
    })

    it('should render with TEXT type', () => {
      // Arrange
      const props = createDefaultProps({ content: 'Sample text content' })

      // Act
      render(<PreviewItem {...props} />)

      // Assert
      expect(screen.getByText('Sample text content')).toBeInTheDocument()
    })

    it('should render with QA type', () => {
      // Arrange
      const props = createQAProps()

      // Act
      render(<PreviewItem {...props} />)

      // Assert
      expect(screen.getByText('Q')).toBeInTheDocument()
      expect(screen.getByText('A')).toBeInTheDocument()
      expect(screen.getByText('Test question')).toBeInTheDocument()
      expect(screen.getByText('Test answer')).toBeInTheDocument()
    })

    it('should render sharp icon (#) with formatted index', () => {
      // Arrange
      const props = createDefaultProps({ index: 5 })

      // Act
      const { container } = render(<PreviewItem {...props} />)

      // Assert - Index should be padded to 3 digits
      expect(screen.getByText('005')).toBeInTheDocument()
      // Sharp icon SVG should exist
      const svgElements = container.querySelectorAll('svg')
      expect(svgElements.length).toBeGreaterThanOrEqual(1)
    })

    it('should render character count for TEXT type', () => {
      // Arrange
      const content = 'Hello World' // 11 characters
      const props = createDefaultProps({ content })

      // Act
      render(<PreviewItem {...props} />)

      // Assert - Shows character count with translation key
      expect(screen.getByText(/11/)).toBeInTheDocument()
      expect(screen.getByText(/datasetCreation.stepTwo.characters/)).toBeInTheDocument()
    })

    it('should render character count for QA type', () => {
      // Arrange
      const props = createQAProps({
        qa: {
          question: 'Hello', // 5 characters
          answer: 'World', // 5 characters - total 10
        },
      })

      // Act
      render(<PreviewItem {...props} />)

      // Assert - Shows combined character count
      expect(screen.getByText(/10/)).toBeInTheDocument()
    })

    it('should render text icon SVG', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      const { container } = render(<PreviewItem {...props} />)

      // Assert - Should have SVG icons
      const svgElements = container.querySelectorAll('svg')
      expect(svgElements.length).toBe(2) // Sharp icon and text icon
    })
  })

  // ==========================================
  // Props Testing - Verify all prop variations work correctly
  // ==========================================
  describe('Props', () => {
    describe('type prop', () => {
      it('should render TEXT content when type is TEXT', () => {
        // Arrange
        const props = createDefaultProps({ type: PreviewType.TEXT, content: 'Text mode content' })

        // Act
        render(<PreviewItem {...props} />)

        // Assert
        expect(screen.getByText('Text mode content')).toBeInTheDocument()
        expect(screen.queryByText('Q')).not.toBeInTheDocument()
        expect(screen.queryByText('A')).not.toBeInTheDocument()
      })

      it('should render QA content when type is QA', () => {
        // Arrange
        const props = createQAProps({
          type: PreviewType.QA,
          qa: { question: 'My question', answer: 'My answer' },
        })

        // Act
        render(<PreviewItem {...props} />)

        // Assert
        expect(screen.getByText('Q')).toBeInTheDocument()
        expect(screen.getByText('A')).toBeInTheDocument()
        expect(screen.getByText('My question')).toBeInTheDocument()
        expect(screen.getByText('My answer')).toBeInTheDocument()
      })

      it('should use TEXT as default type when type is "text"', () => {
        // Arrange
        const props = createDefaultProps({ type: 'text' as PreviewType, content: 'Default type content' })

        // Act
        render(<PreviewItem {...props} />)

        // Assert
        expect(screen.getByText('Default type content')).toBeInTheDocument()
      })

      it('should use QA type when type is "QA"', () => {
        // Arrange
        const props = createQAProps({ type: 'QA' as PreviewType })

        // Act
        render(<PreviewItem {...props} />)

        // Assert
        expect(screen.getByText('Q')).toBeInTheDocument()
        expect(screen.getByText('A')).toBeInTheDocument()
      })
    })

    describe('index prop', () => {
      it.each([
        [1, '001'],
        [5, '005'],
        [10, '010'],
        [99, '099'],
        [100, '100'],
        [999, '999'],
        [1000, '1000'],
      ])('should format index %i as %s', (index, expected) => {
        // Arrange
        const props = createDefaultProps({ index })

        // Act
        render(<PreviewItem {...props} />)

        // Assert
        expect(screen.getByText(expected)).toBeInTheDocument()
      })

      it('should handle index 0', () => {
        // Arrange
        const props = createDefaultProps({ index: 0 })

        // Act
        render(<PreviewItem {...props} />)

        // Assert
        expect(screen.getByText('000')).toBeInTheDocument()
      })

      it('should handle large index numbers', () => {
        // Arrange
        const props = createDefaultProps({ index: 12345 })

        // Act
        render(<PreviewItem {...props} />)

        // Assert
        expect(screen.getByText('12345')).toBeInTheDocument()
      })
    })

    describe('content prop', () => {
      it('should render content when provided', () => {
        // Arrange
        const props = createDefaultProps({ content: 'Custom content here' })

        // Act
        render(<PreviewItem {...props} />)

        // Assert
        expect(screen.getByText('Custom content here')).toBeInTheDocument()
      })

      it('should handle multiline content', () => {
        // Arrange
        const multilineContent = 'Line 1\nLine 2\nLine 3'
        const props = createDefaultProps({ content: multilineContent })

        // Act
        const { container } = render(<PreviewItem {...props} />)

        // Assert - Check content is rendered (multiline text is in pre-line div)
        const contentDiv = container.querySelector('[style*="white-space: pre-line"]')
        expect(contentDiv?.textContent).toContain('Line 1')
        expect(contentDiv?.textContent).toContain('Line 2')
        expect(contentDiv?.textContent).toContain('Line 3')
      })

      it('should preserve whitespace with pre-line style', () => {
        // Arrange
        const props = createDefaultProps({ content: 'Text with  spaces' })

        // Act
        const { container } = render(<PreviewItem {...props} />)

        // Assert - Check for whiteSpace: pre-line style
        const contentDiv = container.querySelector('[style*="white-space: pre-line"]')
        expect(contentDiv).toBeInTheDocument()
      })
    })

    describe('qa prop', () => {
      it('should render question and answer when qa is provided', () => {
        // Arrange
        const props = createQAProps({
          qa: {
            question: 'What is testing?',
            answer: 'Testing is verification.',
          },
        })

        // Act
        render(<PreviewItem {...props} />)

        // Assert
        expect(screen.getByText('What is testing?')).toBeInTheDocument()
        expect(screen.getByText('Testing is verification.')).toBeInTheDocument()
      })

      it('should render Q and A labels', () => {
        // Arrange
        const props = createQAProps()

        // Act
        render(<PreviewItem {...props} />)

        // Assert
        expect(screen.getByText('Q')).toBeInTheDocument()
        expect(screen.getByText('A')).toBeInTheDocument()
      })

      it('should handle multiline question', () => {
        // Arrange
        const props = createQAProps({
          qa: {
            question: 'Question line 1\nQuestion line 2',
            answer: 'Answer',
          },
        })

        // Act
        const { container } = render(<PreviewItem {...props} />)

        // Assert - Check content is in pre-line div
        const preLineDivs = container.querySelectorAll('[style*="white-space: pre-line"]')
        const questionDiv = Array.from(preLineDivs).find(div => div.textContent?.includes('Question line 1'))
        expect(questionDiv).toBeTruthy()
        expect(questionDiv?.textContent).toContain('Question line 2')
      })

      it('should handle multiline answer', () => {
        // Arrange
        const props = createQAProps({
          qa: {
            question: 'Question',
            answer: 'Answer line 1\nAnswer line 2',
          },
        })

        // Act
        const { container } = render(<PreviewItem {...props} />)

        // Assert - Check content is in pre-line div
        const preLineDivs = container.querySelectorAll('[style*="white-space: pre-line"]')
        const answerDiv = Array.from(preLineDivs).find(div => div.textContent?.includes('Answer line 1'))
        expect(answerDiv).toBeTruthy()
        expect(answerDiv?.textContent).toContain('Answer line 2')
      })
    })
  })

  // ==========================================
  // Component Memoization - Test React.memo behavior
  // ==========================================
  describe('Memoization', () => {
    it('should be wrapped with React.memo', () => {
      // Assert - Check component has memo wrapper
      expect(PreviewItem.$$typeof).toBe(Symbol.for('react.memo'))
    })

    it('should not re-render when props remain the same', () => {
      // Arrange
      const props = createDefaultProps()
      const renderSpy = vi.fn()

      // Create a wrapper component to track renders
      const TrackedPreviewItem: React.FC<IPreviewItemProps> = (trackedProps) => {
        renderSpy()
        return <PreviewItem {...trackedProps} />
      }
      const MemoizedTracked = React.memo(TrackedPreviewItem)

      // Act
      const { rerender } = render(<MemoizedTracked {...props} />)
      rerender(<MemoizedTracked {...props} />)

      // Assert - Should only render once due to same props
      expect(renderSpy).toHaveBeenCalledTimes(1)
    })

    it('should re-render when content changes', () => {
      // Arrange
      const props = createDefaultProps({ content: 'Initial content' })

      // Act
      const { rerender } = render(<PreviewItem {...props} />)
      expect(screen.getByText('Initial content')).toBeInTheDocument()

      rerender(<PreviewItem {...props} content="Updated content" />)

      // Assert
      expect(screen.getByText('Updated content')).toBeInTheDocument()
    })

    it('should re-render when index changes', () => {
      // Arrange
      const props = createDefaultProps({ index: 1 })

      // Act
      const { rerender } = render(<PreviewItem {...props} />)
      expect(screen.getByText('001')).toBeInTheDocument()

      rerender(<PreviewItem {...props} index={99} />)

      // Assert
      expect(screen.getByText('099')).toBeInTheDocument()
    })

    it('should re-render when type changes', () => {
      // Arrange
      const props = createDefaultProps({ type: PreviewType.TEXT, content: 'Text content' })

      // Act
      const { rerender } = render(<PreviewItem {...props} />)
      expect(screen.getByText('Text content')).toBeInTheDocument()
      expect(screen.queryByText('Q')).not.toBeInTheDocument()

      rerender(<PreviewItem type={PreviewType.QA} index={1} qa={{ question: 'Q1', answer: 'A1' }} />)

      // Assert
      expect(screen.getByText('Q')).toBeInTheDocument()
      expect(screen.getByText('A')).toBeInTheDocument()
    })

    it('should re-render when qa prop changes', () => {
      // Arrange
      const props = createQAProps({
        qa: { question: 'Original question', answer: 'Original answer' },
      })

      // Act
      const { rerender } = render(<PreviewItem {...props} />)
      expect(screen.getByText('Original question')).toBeInTheDocument()

      rerender(<PreviewItem {...props} qa={{ question: 'New question', answer: 'New answer' }} />)

      // Assert
      expect(screen.getByText('New question')).toBeInTheDocument()
      expect(screen.getByText('New answer')).toBeInTheDocument()
    })
  })

  // ==========================================
  // Edge Cases - Test boundary conditions and error handling
  // ==========================================
  describe('Edge Cases', () => {
    describe('Empty/Undefined values', () => {
      it('should handle undefined content gracefully', () => {
        // Arrange
        const props = createDefaultProps({ content: undefined })

        // Act
        render(<PreviewItem {...props} />)

        // Assert - Should show 0 characters (use more specific text match)
        expect(screen.getByText(/^0 datasetCreation/)).toBeInTheDocument()
      })

      it('should handle empty string content', () => {
        // Arrange
        const props = createDefaultProps({ content: '' })

        // Act
        render(<PreviewItem {...props} />)

        // Assert - Should show 0 characters (use more specific text match)
        expect(screen.getByText(/^0 datasetCreation/)).toBeInTheDocument()
      })

      it('should handle undefined qa gracefully', () => {
        // Arrange
        const props: IPreviewItemProps = {
          type: PreviewType.QA,
          index: 1,
          qa: undefined,
        }

        // Act
        render(<PreviewItem {...props} />)

        // Assert - Should render Q and A labels but with empty content
        expect(screen.getByText('Q')).toBeInTheDocument()
        expect(screen.getByText('A')).toBeInTheDocument()
        // Character count should be 0 (use more specific text match)
        expect(screen.getByText(/^0 datasetCreation/)).toBeInTheDocument()
      })

      it('should handle undefined question in qa', () => {
        // Arrange
        const props: IPreviewItemProps = {
          type: PreviewType.QA,
          index: 1,
          qa: {
            question: undefined as unknown as string,
            answer: 'Only answer',
          },
        }

        // Act
        render(<PreviewItem {...props} />)

        // Assert
        expect(screen.getByText('Only answer')).toBeInTheDocument()
      })

      it('should handle undefined answer in qa', () => {
        // Arrange
        const props: IPreviewItemProps = {
          type: PreviewType.QA,
          index: 1,
          qa: {
            question: 'Only question',
            answer: undefined as unknown as string,
          },
        }

        // Act
        render(<PreviewItem {...props} />)

        // Assert
        expect(screen.getByText('Only question')).toBeInTheDocument()
      })

      it('should handle empty question and answer strings', () => {
        // Arrange
        const props = createQAProps({
          qa: { question: '', answer: '' },
        })

        // Act
        render(<PreviewItem {...props} />)

        // Assert - Should show 0 characters (use more specific text match)
        expect(screen.getByText(/^0 datasetCreation/)).toBeInTheDocument()
        expect(screen.getByText('Q')).toBeInTheDocument()
        expect(screen.getByText('A')).toBeInTheDocument()
      })
    })

    describe('Character count calculation', () => {
      it('should calculate correct character count for TEXT type', () => {
        // Arrange - 'Test' has 4 characters
        const props = createDefaultProps({ content: 'Test' })

        // Act
        render(<PreviewItem {...props} />)

        // Assert
        expect(screen.getByText(/4/)).toBeInTheDocument()
      })

      it('should calculate correct character count for QA type (question + answer)', () => {
        // Arrange - 'ABC' (3) + 'DEFGH' (5) = 8 characters
        const props = createQAProps({
          qa: { question: 'ABC', answer: 'DEFGH' },
        })

        // Act
        render(<PreviewItem {...props} />)

        // Assert
        expect(screen.getByText(/8/)).toBeInTheDocument()
      })

      it('should count special characters correctly', () => {
        // Arrange - Content with special characters
        const props = createDefaultProps({ content: '你好世界' }) // 4 Chinese characters

        // Act
        render(<PreviewItem {...props} />)

        // Assert
        expect(screen.getByText(/4/)).toBeInTheDocument()
      })

      it('should count newlines in character count', () => {
        // Arrange - 'a\nb' has 3 characters
        const props = createDefaultProps({ content: 'a\nb' })

        // Act
        render(<PreviewItem {...props} />)

        // Assert
        expect(screen.getByText(/3/)).toBeInTheDocument()
      })

      it('should count spaces in character count', () => {
        // Arrange - 'a b' has 3 characters
        const props = createDefaultProps({ content: 'a b' })

        // Act
        render(<PreviewItem {...props} />)

        // Assert
        expect(screen.getByText(/3/)).toBeInTheDocument()
      })
    })

    describe('Boundary conditions', () => {
      it('should handle very long content', () => {
        // Arrange
        const longContent = 'A'.repeat(10000)
        const props = createDefaultProps({ content: longContent })

        // Act
        render(<PreviewItem {...props} />)

        // Assert - Should show correct character count
        expect(screen.getByText(/10000/)).toBeInTheDocument()
      })

      it('should handle very long index', () => {
        // Arrange
        const props = createDefaultProps({ index: 999999999 })

        // Act
        render(<PreviewItem {...props} />)

        // Assert
        expect(screen.getByText('999999999')).toBeInTheDocument()
      })

      it('should handle negative index', () => {
        // Arrange
        const props = createDefaultProps({ index: -1 })

        // Act
        render(<PreviewItem {...props} />)

        // Assert - padStart pads from the start, so -1 becomes 0-1
        expect(screen.getByText('0-1')).toBeInTheDocument()
      })

      it('should handle content with only whitespace', () => {
        // Arrange
        const props = createDefaultProps({ content: '   ' }) // 3 spaces

        // Act
        render(<PreviewItem {...props} />)

        // Assert
        expect(screen.getByText(/3/)).toBeInTheDocument()
      })

      it('should handle content with HTML-like characters', () => {
        // Arrange
        const props = createDefaultProps({ content: '<div>Test</div>' })

        // Act
        render(<PreviewItem {...props} />)

        // Assert - Should render as text, not HTML
        expect(screen.getByText('<div>Test</div>')).toBeInTheDocument()
      })

      it('should handle content with emojis', () => {
        // Arrange - Emojis can have complex character lengths
        const props = createDefaultProps({ content: '😀👍' })

        // Act
        render(<PreviewItem {...props} />)

        // Assert - Emoji length depends on JS string length
        expect(screen.getByText('😀👍')).toBeInTheDocument()
      })
    })

    describe('Type edge cases', () => {
      it('should ignore qa prop when type is TEXT', () => {
        // Arrange - Both content and qa provided, but type is TEXT
        const props: IPreviewItemProps = {
          type: PreviewType.TEXT,
          index: 1,
          content: 'Text content',
          qa: { question: 'Should not show', answer: 'Also should not show' },
        }

        // Act
        render(<PreviewItem {...props} />)

        // Assert
        expect(screen.getByText('Text content')).toBeInTheDocument()
        expect(screen.queryByText('Should not show')).not.toBeInTheDocument()
        expect(screen.queryByText('Also should not show')).not.toBeInTheDocument()
      })

      it('should use content length for TEXT type even when qa is provided', () => {
        // Arrange
        const props: IPreviewItemProps = {
          type: PreviewType.TEXT,
          index: 1,
          content: 'Hi', // 2 characters
          qa: { question: 'Question', answer: 'Answer' }, // Would be 14 characters if used
        }

        // Act
        render(<PreviewItem {...props} />)

        // Assert - Should show 2, not 14
        expect(screen.getByText(/2/)).toBeInTheDocument()
      })

      it('should ignore content prop when type is QA', () => {
        // Arrange
        const props: IPreviewItemProps = {
          type: PreviewType.QA,
          index: 1,
          content: 'Should not display',
          qa: { question: 'Q text', answer: 'A text' },
        }

        // Act
        render(<PreviewItem {...props} />)

        // Assert
        expect(screen.queryByText('Should not display')).not.toBeInTheDocument()
        expect(screen.getByText('Q text')).toBeInTheDocument()
        expect(screen.getByText('A text')).toBeInTheDocument()
      })
    })
  })

  // ==========================================
  // PreviewType Enum - Test exported enum values
  // ==========================================
  describe('PreviewType Enum', () => {
    it('should have TEXT value as "text"', () => {
      expect(PreviewType.TEXT).toBe('text')
    })

    it('should have QA value as "QA"', () => {
      expect(PreviewType.QA).toBe('QA')
    })
  })

  // ==========================================
  // Styling Tests - Verify correct CSS classes applied
  // ==========================================
  describe('Styling', () => {
    it('should have rounded container with gray background', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      const { container } = render(<PreviewItem {...props} />)

      // Assert
      const rootDiv = container.firstChild as HTMLElement
      expect(rootDiv).toHaveClass('rounded-xl', 'bg-gray-50', 'p-4')
    })

    it('should have proper header styling', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      const { container } = render(<PreviewItem {...props} />)

      // Assert - Check header div styling
      const headerDiv = container.querySelector('.flex.h-5.items-center.justify-between')
      expect(headerDiv).toBeInTheDocument()
    })

    it('should have index badge styling', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      const { container } = render(<PreviewItem {...props} />)

      // Assert
      const indexBadge = container.querySelector('.border.border-gray-200')
      expect(indexBadge).toBeInTheDocument()
      expect(indexBadge).toHaveClass('rounded-md', 'italic', 'font-medium')
    })

    it('should have content area with line-clamp', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      const { container } = render(<PreviewItem {...props} />)

      // Assert
      const contentArea = container.querySelector('.line-clamp-6')
      expect(contentArea).toBeInTheDocument()
      expect(contentArea).toHaveClass('max-h-[120px]', 'overflow-hidden')
    })

    it('should have Q/A labels with gray color', () => {
      // Arrange
      const props = createQAProps()

      // Act
      const { container } = render(<PreviewItem {...props} />)

      // Assert
      const labels = container.querySelectorAll('.text-gray-400')
      expect(labels.length).toBeGreaterThanOrEqual(2) // Q and A labels
    })
  })

  // ==========================================
  // i18n Translation - Test translation integration
  // ==========================================
  describe('i18n Translation', () => {
    it('should use translation key for characters label', () => {
      // Arrange
      const props = createDefaultProps({ content: 'Test' })

      // Act
      render(<PreviewItem {...props} />)

      // Assert - The mock returns the key as-is
      expect(screen.getByText(/datasetCreation.stepTwo.characters/)).toBeInTheDocument()
    })
  })
})
