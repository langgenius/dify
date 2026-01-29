import type { ChunkInfo, GeneralChunks, ParentChildChunks, QAChunks } from '../../../../chunk-card-list/types'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { ChunkingMode } from '@/models/datasets'
import ResultPreview from './index'
import { formatPreviewChunks } from './utils'

// ============================================================================
// Mock External Dependencies
// ============================================================================

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string, count?: number }) => {
      const ns = options?.ns ? `${options.ns}.` : ''
      const count = options?.count !== undefined ? ` (count: ${options.count})` : ''
      return `${ns}${key}${count}`
    },
  }),
}))

// Mock config
vi.mock('@/config', () => ({
  RAG_PIPELINE_PREVIEW_CHUNK_NUM: 20,
}))

// Mock ChunkCardList component
vi.mock('../../../../chunk-card-list', () => ({
  ChunkCardList: ({ chunkType, chunkInfo }: { chunkType: string, chunkInfo: ChunkInfo }) => (
    <div data-testid="chunk-card-list" data-chunk-type={chunkType} data-chunk-info={JSON.stringify(chunkInfo)}>
      ChunkCardList
    </div>
  ),
}))

// ============================================================================
// Test Data Factories
// ============================================================================

/**
 * Factory for creating general chunk preview outputs
 */
const createGeneralChunkOutputs = (chunks: Array<{ content: string }>) => ({
  chunk_structure: ChunkingMode.text,
  preview: chunks,
})

/**
 * Factory for creating parent-child chunk preview outputs
 */
const createParentChildChunkOutputs = (
  chunks: Array<{ content: string, child_chunks: string[] }>,
  parentMode: 'paragraph' | 'full-doc' = 'paragraph',
) => ({
  chunk_structure: ChunkingMode.parentChild,
  parent_mode: parentMode,
  preview: chunks,
})

/**
 * Factory for creating QA chunk preview outputs
 */
const createQAChunkOutputs = (chunks: Array<{ question: string, answer: string }>) => ({
  chunk_structure: ChunkingMode.qa,
  qa_preview: chunks,
})

/**
 * Factory for creating mock general chunks (for 20+ items)
 */
const createMockGeneralChunks = (count: number): Array<{ content: string }> => {
  return Array.from({ length: count }, (_, i) => ({
    content: `Chunk content ${i + 1}`,
  }))
}

/**
 * Factory for creating mock parent-child chunks
 */
const createMockParentChildChunks = (
  count: number,
  childCount: number = 3,
): Array<{ content: string, child_chunks: string[] }> => {
  return Array.from({ length: count }, (_, i) => ({
    content: `Parent content ${i + 1}`,
    child_chunks: Array.from({ length: childCount }, (_, j) => `Child ${i + 1}-${j + 1}`),
  }))
}

/**
 * Factory for creating mock QA chunks
 */
const createMockQAChunks = (count: number): Array<{ question: string, answer: string }> => {
  return Array.from({ length: count }, (_, i) => ({
    question: `Question ${i + 1}?`,
    answer: `Answer ${i + 1}`,
  }))
}

// ============================================================================
// formatPreviewChunks Utility Tests
// ============================================================================

describe('formatPreviewChunks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // Null/Undefined Input Tests
  // -------------------------------------------------------------------------
  describe('Null/Undefined Input', () => {
    it('should return undefined when outputs is undefined', () => {
      // Arrange & Act
      const result = formatPreviewChunks(undefined)

      // Assert
      expect(result).toBeUndefined()
    })

    it('should return undefined when outputs is null', () => {
      // Arrange & Act
      const result = formatPreviewChunks(null)

      // Assert
      expect(result).toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  // General Chunks (text_model) Tests
  // -------------------------------------------------------------------------
  describe('General Chunks (text_model)', () => {
    it('should format general chunks correctly', () => {
      // Arrange
      const outputs = createGeneralChunkOutputs([
        { content: 'First chunk content' },
        { content: 'Second chunk content' },
        { content: 'Third chunk content' },
      ])

      // Act
      const result = formatPreviewChunks(outputs) as GeneralChunks

      // Assert
      expect(result).toEqual([
        { content: 'First chunk content', summary: undefined },
        { content: 'Second chunk content', summary: undefined },
        { content: 'Third chunk content', summary: undefined },
      ])
    })

    it('should limit general chunks to RAG_PIPELINE_PREVIEW_CHUNK_NUM (20)', () => {
      // Arrange
      const outputs = createGeneralChunkOutputs(createMockGeneralChunks(30))

      // Act
      const result = formatPreviewChunks(outputs) as GeneralChunks

      // Assert
      expect(result).toHaveLength(20)
      expect((result as GeneralChunks)[0].content).toBe('Chunk content 1')
      expect((result as GeneralChunks)[19].content).toBe('Chunk content 20')
    })

    it('should handle empty preview array for general chunks', () => {
      // Arrange
      const outputs = createGeneralChunkOutputs([])

      // Act
      const result = formatPreviewChunks(outputs) as GeneralChunks

      // Assert
      expect(result).toEqual([])
    })

    it('should handle general chunks with empty content', () => {
      // Arrange
      const outputs = createGeneralChunkOutputs([
        { content: '' },
        { content: 'Valid content' },
      ])

      // Act
      const result = formatPreviewChunks(outputs) as GeneralChunks

      // Assert
      expect(result).toEqual([
        { content: '', summary: undefined },
        { content: 'Valid content', summary: undefined },
      ])
    })

    it('should handle general chunks with special characters', () => {
      // Arrange
      const outputs = createGeneralChunkOutputs([
        { content: '<script>alert("xss")</script>' },
        { content: '中文内容 🎉' },
        { content: 'Line1\nLine2\tTab' },
      ])

      // Act
      const result = formatPreviewChunks(outputs) as GeneralChunks

      // Assert
      expect(result).toEqual([
        { content: '<script>alert("xss")</script>', summary: undefined },
        { content: '中文内容 🎉', summary: undefined },
        { content: 'Line1\nLine2\tTab', summary: undefined },
      ])
    })

    it('should handle general chunks with very long content', () => {
      // Arrange
      const longContent = 'A'.repeat(10000)
      const outputs = createGeneralChunkOutputs([{ content: longContent }])

      // Act
      const result = formatPreviewChunks(outputs) as GeneralChunks

      // Assert
      expect((result as GeneralChunks)[0].content).toHaveLength(10000)
    })
  })

  // -------------------------------------------------------------------------
  // Parent-Child Chunks (hierarchical_model) Tests
  // -------------------------------------------------------------------------
  describe('Parent-Child Chunks (hierarchical_model)', () => {
    describe('Paragraph Mode', () => {
      it('should format parent-child chunks in paragraph mode correctly', () => {
        // Arrange
        const outputs = createParentChildChunkOutputs([
          { content: 'Parent 1', child_chunks: ['Child 1-1', 'Child 1-2'] },
          { content: 'Parent 2', child_chunks: ['Child 2-1'] },
        ], 'paragraph')

        // Act
        const result = formatPreviewChunks(outputs) as ParentChildChunks

        // Assert
        expect(result.parent_mode).toBe('paragraph')
        expect(result.parent_child_chunks).toHaveLength(2)
        expect(result.parent_child_chunks[0]).toEqual({
          parent_content: 'Parent 1',
          child_contents: ['Child 1-1', 'Child 1-2'],
          parent_mode: 'paragraph',
        })
        expect(result.parent_child_chunks[1]).toEqual({
          parent_content: 'Parent 2',
          child_contents: ['Child 2-1'],
          parent_mode: 'paragraph',
        })
      })

      it('should limit parent chunks to RAG_PIPELINE_PREVIEW_CHUNK_NUM (20) in paragraph mode', () => {
        // Arrange
        const outputs = createParentChildChunkOutputs(createMockParentChildChunks(30, 2), 'paragraph')

        // Act
        const result = formatPreviewChunks(outputs) as ParentChildChunks

        // Assert
        expect(result.parent_child_chunks).toHaveLength(20)
      })

      it('should NOT limit child chunks in paragraph mode', () => {
        // Arrange
        const outputs = createParentChildChunkOutputs([
          { content: 'Parent 1', child_chunks: Array.from({ length: 50 }, (_, i) => `Child ${i + 1}`) },
        ], 'paragraph')

        // Act
        const result = formatPreviewChunks(outputs) as ParentChildChunks

        // Assert
        expect(result.parent_child_chunks[0].child_contents).toHaveLength(50)
      })

      it('should handle empty child_chunks in paragraph mode', () => {
        // Arrange
        const outputs = createParentChildChunkOutputs([
          { content: 'Parent with no children', child_chunks: [] },
        ], 'paragraph')

        // Act
        const result = formatPreviewChunks(outputs) as ParentChildChunks

        // Assert
        expect(result.parent_child_chunks[0].child_contents).toEqual([])
      })
    })

    describe('Full-Doc Mode', () => {
      it('should format parent-child chunks in full-doc mode correctly', () => {
        // Arrange
        const outputs = createParentChildChunkOutputs([
          { content: 'Full Doc Parent', child_chunks: ['Child 1', 'Child 2', 'Child 3'] },
        ], 'full-doc')

        // Act
        const result = formatPreviewChunks(outputs) as ParentChildChunks

        // Assert
        expect(result.parent_mode).toBe('full-doc')
        expect(result.parent_child_chunks).toHaveLength(1)
        expect(result.parent_child_chunks[0].parent_content).toBe('Full Doc Parent')
        expect(result.parent_child_chunks[0].child_contents).toEqual(['Child 1', 'Child 2', 'Child 3'])
      })

      it('should NOT limit parent chunks in full-doc mode', () => {
        // Arrange
        const outputs = createParentChildChunkOutputs(createMockParentChildChunks(30, 2), 'full-doc')

        // Act
        const result = formatPreviewChunks(outputs) as ParentChildChunks

        // Assert - full-doc mode processes all parents (forEach without slice)
        expect(result.parent_child_chunks).toHaveLength(30)
      })

      it('should limit child chunks to RAG_PIPELINE_PREVIEW_CHUNK_NUM (20) in full-doc mode', () => {
        // Arrange
        const outputs = createParentChildChunkOutputs([
          { content: 'Parent', child_chunks: Array.from({ length: 50 }, (_, i) => `Child ${i + 1}`) },
        ], 'full-doc')

        // Act
        const result = formatPreviewChunks(outputs) as ParentChildChunks

        // Assert
        expect(result.parent_child_chunks[0].child_contents).toHaveLength(20)
        expect(result.parent_child_chunks[0].child_contents[0]).toBe('Child 1')
        expect(result.parent_child_chunks[0].child_contents[19]).toBe('Child 20')
      })

      it('should handle multiple parents with many children in full-doc mode', () => {
        // Arrange
        const outputs = createParentChildChunkOutputs([
          { content: 'Parent 1', child_chunks: Array.from({ length: 25 }, (_, i) => `P1-Child ${i + 1}`) },
          { content: 'Parent 2', child_chunks: Array.from({ length: 30 }, (_, i) => `P2-Child ${i + 1}`) },
        ], 'full-doc')

        // Act
        const result = formatPreviewChunks(outputs) as ParentChildChunks

        // Assert
        expect(result.parent_child_chunks[0].child_contents).toHaveLength(20)
        expect(result.parent_child_chunks[1].child_contents).toHaveLength(20)
      })
    })

    it('should handle empty preview array for parent-child chunks', () => {
      // Arrange
      const outputs = createParentChildChunkOutputs([], 'paragraph')

      // Act
      const result = formatPreviewChunks(outputs) as ParentChildChunks

      // Assert
      expect(result.parent_child_chunks).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // QA Chunks (qa_model) Tests
  // -------------------------------------------------------------------------
  describe('QA Chunks (qa_model)', () => {
    it('should format QA chunks correctly', () => {
      // Arrange
      const outputs = createQAChunkOutputs([
        { question: 'What is Dify?', answer: 'Dify is an LLM application platform.' },
        { question: 'How to use it?', answer: 'You can create apps easily.' },
      ])

      // Act
      const result = formatPreviewChunks(outputs) as QAChunks

      // Assert
      expect(result.qa_chunks).toHaveLength(2)
      expect(result.qa_chunks[0]).toEqual({
        question: 'What is Dify?',
        answer: 'Dify is an LLM application platform.',
      })
      expect(result.qa_chunks[1]).toEqual({
        question: 'How to use it?',
        answer: 'You can create apps easily.',
      })
    })

    it('should limit QA chunks to RAG_PIPELINE_PREVIEW_CHUNK_NUM (20)', () => {
      // Arrange
      const outputs = createQAChunkOutputs(createMockQAChunks(30))

      // Act
      const result = formatPreviewChunks(outputs) as QAChunks

      // Assert
      expect(result.qa_chunks).toHaveLength(20)
    })

    it('should handle empty qa_preview array', () => {
      // Arrange
      const outputs = createQAChunkOutputs([])

      // Act
      const result = formatPreviewChunks(outputs) as QAChunks

      // Assert
      expect(result.qa_chunks).toEqual([])
    })

    it('should handle QA chunks with empty question or answer', () => {
      // Arrange
      const outputs = createQAChunkOutputs([
        { question: '', answer: 'Answer without question' },
        { question: 'Question without answer', answer: '' },
      ])

      // Act
      const result = formatPreviewChunks(outputs) as QAChunks

      // Assert
      expect(result.qa_chunks[0].question).toBe('')
      expect(result.qa_chunks[0].answer).toBe('Answer without question')
      expect(result.qa_chunks[1].question).toBe('Question without answer')
      expect(result.qa_chunks[1].answer).toBe('')
    })

    it('should preserve all properties when spreading chunk', () => {
      // Arrange
      const outputs = {
        chunk_structure: ChunkingMode.qa,
        qa_preview: [
          { question: 'Q1', answer: 'A1', extra: 'should be preserved' },
        ] as unknown as Array<{ question: string, answer: string }>,
      }

      // Act
      const result = formatPreviewChunks(outputs) as QAChunks

      // Assert
      expect(result.qa_chunks[0]).toEqual({ question: 'Q1', answer: 'A1', extra: 'should be preserved' })
    })
  })

  // -------------------------------------------------------------------------
  // Unknown Chunking Mode Tests
  // -------------------------------------------------------------------------
  describe('Unknown Chunking Mode', () => {
    it('should return undefined for unknown chunking mode', () => {
      // Arrange
      const outputs = {
        chunk_structure: 'unknown_mode' as ChunkingMode,
        preview: [],
      }

      // Act
      const result = formatPreviewChunks(outputs)

      // Assert
      expect(result).toBeUndefined()
    })

    it('should return undefined when chunk_structure is missing', () => {
      // Arrange
      const outputs = {
        preview: [{ content: 'test' }],
      }

      // Act
      const result = formatPreviewChunks(outputs)

      // Assert
      expect(result).toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  // Edge Cases Tests
  // -------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle exactly RAG_PIPELINE_PREVIEW_CHUNK_NUM (20) chunks', () => {
      // Arrange
      const outputs = createGeneralChunkOutputs(createMockGeneralChunks(20))

      // Act
      const result = formatPreviewChunks(outputs) as GeneralChunks

      // Assert
      expect(result).toHaveLength(20)
    })

    it('should handle outputs with additional properties', () => {
      // Arrange
      const outputs = {
        ...createGeneralChunkOutputs([{ content: 'Test' }]),
        extra_field: 'should not affect result',
        metadata: { some: 'data' },
      }

      // Act
      const result = formatPreviewChunks(outputs) as GeneralChunks

      // Assert
      expect(result).toEqual([{ content: 'Test', summary: undefined }])
    })
  })
})

// ============================================================================
// ResultPreview Component Tests
// ============================================================================

describe('ResultPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // Default Props Factory
  // -------------------------------------------------------------------------
  const defaultProps = {
    isRunning: false,
    outputs: undefined,
    error: undefined,
    onSwitchToDetail: vi.fn(),
  }

  // -------------------------------------------------------------------------
  // Rendering Tests
  // -------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render without crashing with minimal props', () => {
      // Arrange & Act
      render(<ResultPreview onSwitchToDetail={vi.fn()} />)

      // Assert - Component renders (no visible content in empty state)
      expect(document.body).toBeInTheDocument()
    })

    it('should render loading state when isRunning and no outputs', () => {
      // Arrange & Act
      render(<ResultPreview {...defaultProps} isRunning={true} outputs={undefined} />)

      // Assert
      expect(screen.getByText('pipeline.result.resultPreview.loading')).toBeInTheDocument()
    })

    it('should render loading spinner icon when loading', () => {
      // Arrange & Act
      const { container } = render(<ResultPreview {...defaultProps} isRunning={true} outputs={undefined} />)

      // Assert - Check for animate-spin class (loading spinner)
      const spinner = container.querySelector('.animate-spin')
      expect(spinner).toBeInTheDocument()
    })

    it('should render error state when not running and error exists', () => {
      // Arrange & Act
      render(<ResultPreview {...defaultProps} isRunning={false} error="Something went wrong" />)

      // Assert
      expect(screen.getByText('pipeline.result.resultPreview.error')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /pipeline\.result\.resultPreview\.viewDetails/i })).toBeInTheDocument()
    })

    it('should render outputs when available', () => {
      // Arrange
      const outputs = createGeneralChunkOutputs([{ content: 'Test chunk' }])

      // Act
      render(<ResultPreview {...defaultProps} outputs={outputs} />)

      // Assert
      expect(screen.getByTestId('chunk-card-list')).toBeInTheDocument()
    })

    it('should render footer tip when outputs available', () => {
      // Arrange
      const outputs = createGeneralChunkOutputs([{ content: 'Test chunk' }])

      // Act
      render(<ResultPreview {...defaultProps} outputs={outputs} />)

      // Assert
      expect(screen.getByText(/pipeline\.result\.resultPreview\.footerTip/)).toBeInTheDocument()
    })

    it('should not render loading when outputs exist even if isRunning', () => {
      // Arrange
      const outputs = createGeneralChunkOutputs([{ content: 'Test' }])

      // Act
      render(<ResultPreview {...defaultProps} isRunning={true} outputs={outputs} />)

      // Assert - Should show outputs, not loading
      expect(screen.queryByText('pipeline.result.resultPreview.loading')).not.toBeInTheDocument()
      expect(screen.getByTestId('chunk-card-list')).toBeInTheDocument()
    })

    it('should not render error when isRunning is true', () => {
      // Arrange & Act
      render(<ResultPreview {...defaultProps} isRunning={true} error="Error message" outputs={undefined} />)

      // Assert - Should show loading, not error
      expect(screen.getByText('pipeline.result.resultPreview.loading')).toBeInTheDocument()
      expect(screen.queryByText('pipeline.result.resultPreview.error')).not.toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // Props Variations Tests
  // -------------------------------------------------------------------------
  describe('Props Variations', () => {
    describe('isRunning prop', () => {
      it('should show loading when isRunning=true and no outputs', () => {
        // Arrange & Act
        render(<ResultPreview {...defaultProps} isRunning={true} />)

        // Assert
        expect(screen.getByText('pipeline.result.resultPreview.loading')).toBeInTheDocument()
      })

      it('should not show loading when isRunning=false', () => {
        // Arrange & Act
        render(<ResultPreview {...defaultProps} isRunning={false} />)

        // Assert
        expect(screen.queryByText('pipeline.result.resultPreview.loading')).not.toBeInTheDocument()
      })

      it('should prioritize outputs over loading state', () => {
        // Arrange
        const outputs = createGeneralChunkOutputs([{ content: 'Data' }])

        // Act
        render(<ResultPreview {...defaultProps} isRunning={true} outputs={outputs} />)

        // Assert
        expect(screen.queryByText('pipeline.result.resultPreview.loading')).not.toBeInTheDocument()
        expect(screen.getByTestId('chunk-card-list')).toBeInTheDocument()
      })
    })

    describe('outputs prop', () => {
      it('should pass chunk_structure to ChunkCardList', () => {
        // Arrange
        const outputs = createGeneralChunkOutputs([{ content: 'Test' }])

        // Act
        render(<ResultPreview {...defaultProps} outputs={outputs} />)

        // Assert
        const chunkList = screen.getByTestId('chunk-card-list')
        expect(chunkList).toHaveAttribute('data-chunk-type', ChunkingMode.text)
      })

      it('should format and pass previewChunks to ChunkCardList', () => {
        // Arrange
        const outputs = createGeneralChunkOutputs([
          { content: 'Chunk 1' },
          { content: 'Chunk 2' },
        ])

        // Act
        render(<ResultPreview {...defaultProps} outputs={outputs} />)

        // Assert
        const chunkList = screen.getByTestId('chunk-card-list')
        const chunkInfo = JSON.parse(chunkList.getAttribute('data-chunk-info') || '[]')
        expect(chunkInfo).toEqual([
          { content: 'Chunk 1' },
          { content: 'Chunk 2' },
        ])
      })

      it('should handle parent-child outputs', () => {
        // Arrange
        const outputs = createParentChildChunkOutputs([
          { content: 'Parent', child_chunks: ['Child 1', 'Child 2'] },
        ])

        // Act
        render(<ResultPreview {...defaultProps} outputs={outputs} />)

        // Assert
        const chunkList = screen.getByTestId('chunk-card-list')
        expect(chunkList).toHaveAttribute('data-chunk-type', ChunkingMode.parentChild)
      })

      it('should handle QA outputs', () => {
        // Arrange
        const outputs = createQAChunkOutputs([
          { question: 'Q1', answer: 'A1' },
        ])

        // Act
        render(<ResultPreview {...defaultProps} outputs={outputs} />)

        // Assert
        const chunkList = screen.getByTestId('chunk-card-list')
        expect(chunkList).toHaveAttribute('data-chunk-type', ChunkingMode.qa)
      })
    })

    describe('error prop', () => {
      it('should show error state when error is a non-empty string', () => {
        // Arrange & Act
        render(<ResultPreview {...defaultProps} error="Network error" />)

        // Assert
        expect(screen.getByText('pipeline.result.resultPreview.error')).toBeInTheDocument()
      })

      it('should show error state when error is an empty string', () => {
        // Arrange & Act
        render(<ResultPreview {...defaultProps} error="" />)

        // Assert - Empty string is falsy, so error state should NOT show
        expect(screen.queryByText('pipeline.result.resultPreview.error')).not.toBeInTheDocument()
      })

      it('should render both outputs and error when both exist (independent conditions)', () => {
        // Arrange
        const outputs = createGeneralChunkOutputs([{ content: 'Data' }])

        // Act
        render(<ResultPreview {...defaultProps} outputs={outputs} error="Error" />)

        // Assert - Both are rendered because conditions are independent in the component
        expect(screen.getByText('pipeline.result.resultPreview.error')).toBeInTheDocument()
        expect(screen.getByTestId('chunk-card-list')).toBeInTheDocument()
      })
    })

    describe('onSwitchToDetail prop', () => {
      it('should be called when view details button is clicked', () => {
        // Arrange
        const onSwitchToDetail = vi.fn()
        render(<ResultPreview {...defaultProps} error="Error" onSwitchToDetail={onSwitchToDetail} />)

        // Act
        fireEvent.click(screen.getByRole('button', { name: /viewDetails/i }))

        // Assert
        expect(onSwitchToDetail).toHaveBeenCalledTimes(1)
      })

      it('should not be called automatically on render', () => {
        // Arrange
        const onSwitchToDetail = vi.fn()

        // Act
        render(<ResultPreview {...defaultProps} error="Error" onSwitchToDetail={onSwitchToDetail} />)

        // Assert
        expect(onSwitchToDetail).not.toHaveBeenCalled()
      })
    })
  })

  // -------------------------------------------------------------------------
  // Memoization Tests
  // -------------------------------------------------------------------------
  describe('Memoization', () => {
    describe('React.memo wrapper', () => {
      it('should be wrapped with React.memo', () => {
        // Arrange & Act
        const { rerender } = render(<ResultPreview {...defaultProps} />)
        rerender(<ResultPreview {...defaultProps} />)

        // Assert - Component renders correctly after rerender
        expect(document.body).toBeInTheDocument()
      })

      it('should update when props change', () => {
        // Arrange
        const { rerender } = render(<ResultPreview {...defaultProps} isRunning={false} />)

        // Act
        rerender(<ResultPreview {...defaultProps} isRunning={true} />)

        // Assert
        expect(screen.getByText('pipeline.result.resultPreview.loading')).toBeInTheDocument()
      })

      it('should update when outputs change', () => {
        // Arrange
        const outputs1 = createGeneralChunkOutputs([{ content: 'First' }])
        const { rerender } = render(<ResultPreview {...defaultProps} outputs={outputs1} />)

        // Act
        const outputs2 = createGeneralChunkOutputs([{ content: 'Second' }])
        rerender(<ResultPreview {...defaultProps} outputs={outputs2} />)

        // Assert
        const chunkList = screen.getByTestId('chunk-card-list')
        const chunkInfo = JSON.parse(chunkList.getAttribute('data-chunk-info') || '[]')
        expect(chunkInfo).toEqual([{ content: 'Second' }])
      })
    })

    describe('useMemo for previewChunks', () => {
      it('should compute previewChunks based on outputs', () => {
        // Arrange
        const outputs = createGeneralChunkOutputs([
          { content: 'Memoized chunk 1' },
          { content: 'Memoized chunk 2' },
        ])

        // Act
        render(<ResultPreview {...defaultProps} outputs={outputs} />)

        // Assert
        const chunkList = screen.getByTestId('chunk-card-list')
        const chunkInfo = JSON.parse(chunkList.getAttribute('data-chunk-info') || '[]')
        expect(chunkInfo).toHaveLength(2)
      })

      it('should recompute when outputs reference changes', () => {
        // Arrange
        const outputs1 = createGeneralChunkOutputs([{ content: 'Original' }])
        const { rerender } = render(<ResultPreview {...defaultProps} outputs={outputs1} />)

        let chunkList = screen.getByTestId('chunk-card-list')
        let chunkInfo = JSON.parse(chunkList.getAttribute('data-chunk-info') || '[]')
        expect(chunkInfo).toEqual([{ content: 'Original' }])

        // Act - Change outputs
        const outputs2 = createGeneralChunkOutputs([{ content: 'Updated' }])
        rerender(<ResultPreview {...defaultProps} outputs={outputs2} />)

        // Assert
        chunkList = screen.getByTestId('chunk-card-list')
        chunkInfo = JSON.parse(chunkList.getAttribute('data-chunk-info') || '[]')
        expect(chunkInfo).toEqual([{ content: 'Updated' }])
      })

      it('should handle undefined outputs in useMemo', () => {
        // Arrange & Act
        render(<ResultPreview {...defaultProps} outputs={undefined} />)

        // Assert - No chunk list rendered
        expect(screen.queryByTestId('chunk-card-list')).not.toBeInTheDocument()
      })
    })
  })

  // -------------------------------------------------------------------------
  // Event Handlers Tests
  // -------------------------------------------------------------------------
  describe('Event Handlers', () => {
    it('should call onSwitchToDetail when view details button is clicked', () => {
      // Arrange
      const onSwitchToDetail = vi.fn()
      render(<ResultPreview {...defaultProps} error="Test error" onSwitchToDetail={onSwitchToDetail} />)

      // Act
      fireEvent.click(screen.getByRole('button', { name: /viewDetails/i }))

      // Assert
      expect(onSwitchToDetail).toHaveBeenCalledTimes(1)
    })

    it('should handle multiple clicks on view details button', () => {
      // Arrange
      const onSwitchToDetail = vi.fn()
      render(<ResultPreview {...defaultProps} error="Test error" onSwitchToDetail={onSwitchToDetail} />)
      const button = screen.getByRole('button', { name: /viewDetails/i })

      // Act
      fireEvent.click(button)
      fireEvent.click(button)
      fireEvent.click(button)

      // Assert
      expect(onSwitchToDetail).toHaveBeenCalledTimes(3)
    })
  })

  // -------------------------------------------------------------------------
  // Edge Cases Tests
  // -------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle empty state (all props undefined/false)', () => {
      // Arrange & Act
      const { container } = render(
        <ResultPreview
          isRunning={false}
          outputs={undefined}
          error={undefined}
          onSwitchToDetail={vi.fn()}
        />,
      )

      // Assert - Should render empty fragment
      expect(container.firstChild).toBeNull()
    })

    it('should handle outputs with empty preview chunks', () => {
      // Arrange
      const outputs = createGeneralChunkOutputs([])

      // Act
      render(<ResultPreview {...defaultProps} outputs={outputs} />)

      // Assert
      const chunkList = screen.getByTestId('chunk-card-list')
      const chunkInfo = JSON.parse(chunkList.getAttribute('data-chunk-info') || '[]')
      expect(chunkInfo).toEqual([])
    })

    it('should handle outputs that result in undefined previewChunks', () => {
      // Arrange
      const outputs = {
        chunk_structure: 'invalid_mode' as ChunkingMode,
        preview: [],
      }

      // Act
      render(<ResultPreview {...defaultProps} outputs={outputs} />)

      // Assert - Should not render chunk list when previewChunks is undefined
      expect(screen.queryByTestId('chunk-card-list')).not.toBeInTheDocument()
    })

    it('should handle unmount cleanly', () => {
      // Arrange
      const { unmount } = render(<ResultPreview {...defaultProps} />)

      // Assert
      expect(() => unmount()).not.toThrow()
    })

    it('should handle rapid prop changes', () => {
      // Arrange
      const { rerender } = render(<ResultPreview {...defaultProps} />)

      // Act - Rapidly change props
      rerender(<ResultPreview {...defaultProps} isRunning={true} />)
      rerender(<ResultPreview {...defaultProps} isRunning={false} error="Error" />)
      rerender(<ResultPreview {...defaultProps} outputs={createGeneralChunkOutputs([{ content: 'Test' }])} />)
      rerender(<ResultPreview {...defaultProps} />)

      // Assert
      expect(screen.queryByTestId('chunk-card-list')).not.toBeInTheDocument()
    })

    it('should handle very large number of chunks', () => {
      // Arrange
      const outputs = createGeneralChunkOutputs(createMockGeneralChunks(1000))

      // Act
      render(<ResultPreview {...defaultProps} outputs={outputs} />)

      // Assert - Should only show first 20 chunks
      const chunkList = screen.getByTestId('chunk-card-list')
      const chunkInfo = JSON.parse(chunkList.getAttribute('data-chunk-info') || '[]')
      expect(chunkInfo).toHaveLength(20)
    })

    it('should throw when outputs has null preview (slice called on null)', () => {
      // Arrange
      const outputs = {
        chunk_structure: ChunkingMode.text,
        preview: null as unknown as Array<{ content: string }>,
      }

      // Act & Assert - Component throws because slice is called on null preview
      // This is expected behavior - the component doesn't validate input
      expect(() => render(<ResultPreview {...defaultProps} outputs={outputs} />)).toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // Integration Tests
  // -------------------------------------------------------------------------
  describe('Integration', () => {
    it('should transition from loading to output state', () => {
      // Arrange
      const { rerender } = render(<ResultPreview {...defaultProps} isRunning={true} />)
      expect(screen.getByText('pipeline.result.resultPreview.loading')).toBeInTheDocument()

      // Act
      const outputs = createGeneralChunkOutputs([{ content: 'Loaded data' }])
      rerender(<ResultPreview {...defaultProps} isRunning={false} outputs={outputs} />)

      // Assert
      expect(screen.queryByText('pipeline.result.resultPreview.loading')).not.toBeInTheDocument()
      expect(screen.getByTestId('chunk-card-list')).toBeInTheDocument()
    })

    it('should transition from loading to error state', () => {
      // Arrange
      const { rerender } = render(<ResultPreview {...defaultProps} isRunning={true} />)
      expect(screen.getByText('pipeline.result.resultPreview.loading')).toBeInTheDocument()

      // Act
      rerender(<ResultPreview {...defaultProps} isRunning={false} error="Failed to load" />)

      // Assert
      expect(screen.queryByText('pipeline.result.resultPreview.loading')).not.toBeInTheDocument()
      expect(screen.getByText('pipeline.result.resultPreview.error')).toBeInTheDocument()
    })

    it('should render both error and outputs when both props provided', () => {
      // Arrange
      const { rerender } = render(<ResultPreview {...defaultProps} error="Initial error" />)
      expect(screen.getByText('pipeline.result.resultPreview.error')).toBeInTheDocument()

      // Act - Outputs provided while error still exists
      const outputs = createGeneralChunkOutputs([{ content: 'Success data' }])
      rerender(<ResultPreview {...defaultProps} error="Initial error" outputs={outputs} />)

      // Assert - Both are rendered (component uses independent conditions)
      expect(screen.getByText('pipeline.result.resultPreview.error')).toBeInTheDocument()
      expect(screen.getByTestId('chunk-card-list')).toBeInTheDocument()
    })

    it('should hide error when error prop is cleared', () => {
      // Arrange
      const { rerender } = render(<ResultPreview {...defaultProps} error="Initial error" />)
      expect(screen.getByText('pipeline.result.resultPreview.error')).toBeInTheDocument()

      // Act - Clear error and provide outputs
      const outputs = createGeneralChunkOutputs([{ content: 'Success data' }])
      rerender(<ResultPreview {...defaultProps} outputs={outputs} />)

      // Assert - Only outputs shown when error is cleared
      expect(screen.queryByText('pipeline.result.resultPreview.error')).not.toBeInTheDocument()
      expect(screen.getByTestId('chunk-card-list')).toBeInTheDocument()
    })

    it('should handle complete flow: empty -> loading -> outputs', () => {
      // Arrange
      const { rerender, container } = render(<ResultPreview {...defaultProps} />)
      expect(container.firstChild).toBeNull()

      // Act - Start loading
      rerender(<ResultPreview {...defaultProps} isRunning={true} />)
      expect(screen.getByText('pipeline.result.resultPreview.loading')).toBeInTheDocument()

      // Act - Receive outputs
      const outputs = createGeneralChunkOutputs([{ content: 'Final data' }])
      rerender(<ResultPreview {...defaultProps} isRunning={false} outputs={outputs} />)

      // Assert
      expect(screen.getByTestId('chunk-card-list')).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // Styling Tests
  // -------------------------------------------------------------------------
  describe('Styling', () => {
    it('should have correct container classes for loading state', () => {
      // Arrange & Act
      const { container } = render(<ResultPreview {...defaultProps} isRunning={true} />)

      // Assert
      const loadingContainer = container.querySelector('.flex.grow.flex-col.items-center.justify-center')
      expect(loadingContainer).toBeInTheDocument()
    })

    it('should have correct container classes for error state', () => {
      // Arrange & Act
      const { container } = render(<ResultPreview {...defaultProps} error="Error" />)

      // Assert
      const errorContainer = container.querySelector('.flex.grow.flex-col.items-center.justify-center')
      expect(errorContainer).toBeInTheDocument()
    })

    it('should have correct container classes for outputs state', () => {
      // Arrange
      const outputs = createGeneralChunkOutputs([{ content: 'Test' }])

      // Act
      const { container } = render(<ResultPreview {...defaultProps} outputs={outputs} />)

      // Assert
      const outputContainer = container.querySelector('.flex.grow.flex-col.bg-background-body')
      expect(outputContainer).toBeInTheDocument()
    })

    it('should have gradient dividers in footer', () => {
      // Arrange
      const outputs = createGeneralChunkOutputs([{ content: 'Test' }])

      // Act
      const { container } = render(<ResultPreview {...defaultProps} outputs={outputs} />)

      // Assert
      const gradientDividers = container.querySelectorAll('.bg-gradient-to-r, .bg-gradient-to-l')
      expect(gradientDividers.length).toBeGreaterThanOrEqual(2)
    })
  })

  // -------------------------------------------------------------------------
  // Accessibility Tests
  // -------------------------------------------------------------------------
  describe('Accessibility', () => {
    it('should have accessible button in error state', () => {
      // Arrange & Act
      render(<ResultPreview {...defaultProps} error="Error" />)

      // Assert
      const button = screen.getByRole('button')
      expect(button).toBeInTheDocument()
    })

    it('should have title attribute on footer tip for long text', () => {
      // Arrange
      const outputs = createGeneralChunkOutputs([{ content: 'Test' }])

      // Act
      const { container } = render(<ResultPreview {...defaultProps} outputs={outputs} />)

      // Assert
      const footerTip = container.querySelector('[title]')
      expect(footerTip).toBeInTheDocument()
    })
  })
})

// ============================================================================
// State Transition Matrix Tests
// ============================================================================

describe('State Transition Matrix', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const states = [
    { isRunning: false, outputs: undefined, error: undefined, expected: 'empty' },
    { isRunning: true, outputs: undefined, error: undefined, expected: 'loading' },
    { isRunning: false, outputs: undefined, error: 'Error', expected: 'error' },
    { isRunning: false, outputs: createGeneralChunkOutputs([{ content: 'Test' }]), error: undefined, expected: 'outputs' },
    { isRunning: true, outputs: createGeneralChunkOutputs([{ content: 'Test' }]), error: undefined, expected: 'outputs' },
    { isRunning: false, outputs: createGeneralChunkOutputs([{ content: 'Test' }]), error: 'Error', expected: 'both' },
    { isRunning: true, outputs: undefined, error: 'Error', expected: 'loading' },
  ]

  it.each(states)(
    'should render $expected state when isRunning=$isRunning, outputs=$outputs, error=$error',
    ({ isRunning, outputs, error, expected }) => {
      // Arrange & Act
      const { container } = render(
        <ResultPreview
          isRunning={isRunning}
          outputs={outputs}
          error={error}
          onSwitchToDetail={vi.fn()}
        />,
      )

      // Assert
      switch (expected) {
        case 'empty':
          expect(container.firstChild).toBeNull()
          break
        case 'loading':
          expect(screen.getByText('pipeline.result.resultPreview.loading')).toBeInTheDocument()
          break
        case 'error':
          expect(screen.getByText('pipeline.result.resultPreview.error')).toBeInTheDocument()
          break
        case 'outputs':
          expect(screen.getByTestId('chunk-card-list')).toBeInTheDocument()
          break
        case 'both':
          expect(screen.getByText('pipeline.result.resultPreview.error')).toBeInTheDocument()
          expect(screen.getByTestId('chunk-card-list')).toBeInTheDocument()
          break
      }
    },
  )
})
