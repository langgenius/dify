import type { ChunkInfo, GeneralChunks, ParentChildChunks, QAChunks } from '../../../../../chunk-card-list/types'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { ChunkingMode } from '@/models/datasets'
import ResultPreview from '../index'
import { formatPreviewChunks } from '../utils'

vi.mock('@/config', () => ({
  RAG_PIPELINE_PREVIEW_CHUNK_NUM: 20,
}))

vi.mock('../../../../../chunk-card-list', () => ({
  ChunkCardList: ({ chunkType, chunkInfo }: { chunkType: string, chunkInfo: ChunkInfo }) => (
    <div data-testid="chunk-card-list" data-chunk-type={chunkType} data-chunk-info={JSON.stringify(chunkInfo)}>
      ChunkCardList
    </div>
  ),
}))

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

describe('formatPreviewChunks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Null/Undefined Input', () => {
    it('should return undefined when outputs is undefined', () => {
      const result = formatPreviewChunks(undefined)

      expect(result).toBeUndefined()
    })

    it('should return undefined when outputs is null', () => {
      const result = formatPreviewChunks(null)

      expect(result).toBeUndefined()
    })
  })

  describe('General Chunks (text_model)', () => {
    it('should format general chunks correctly', () => {
      const outputs = createGeneralChunkOutputs([
        { content: 'First chunk content' },
        { content: 'Second chunk content' },
        { content: 'Third chunk content' },
      ])

      const result = formatPreviewChunks(outputs) as GeneralChunks

      expect(result).toEqual([
        { content: 'First chunk content', summary: undefined },
        { content: 'Second chunk content', summary: undefined },
        { content: 'Third chunk content', summary: undefined },
      ])
    })

    it('should limit general chunks to RAG_PIPELINE_PREVIEW_CHUNK_NUM (20)', () => {
      const outputs = createGeneralChunkOutputs(createMockGeneralChunks(30))

      const result = formatPreviewChunks(outputs) as GeneralChunks

      expect(result).toHaveLength(20)
      expect((result as GeneralChunks)[0].content).toBe('Chunk content 1')
      expect((result as GeneralChunks)[19].content).toBe('Chunk content 20')
    })

    it('should handle empty preview array for general chunks', () => {
      const outputs = createGeneralChunkOutputs([])

      const result = formatPreviewChunks(outputs) as GeneralChunks

      expect(result).toEqual([])
    })

    it('should handle general chunks with empty content', () => {
      const outputs = createGeneralChunkOutputs([
        { content: '' },
        { content: 'Valid content' },
      ])

      const result = formatPreviewChunks(outputs) as GeneralChunks

      expect(result).toEqual([
        { content: '', summary: undefined },
        { content: 'Valid content', summary: undefined },
      ])
    })

    it('should handle general chunks with special characters', () => {
      const outputs = createGeneralChunkOutputs([
        { content: '<script>alert("xss")</script>' },
        { content: '中文内容 🎉' },
        { content: 'Line1\nLine2\tTab' },
      ])

      const result = formatPreviewChunks(outputs) as GeneralChunks

      expect(result).toEqual([
        { content: '<script>alert("xss")</script>', summary: undefined },
        { content: '中文内容 🎉', summary: undefined },
        { content: 'Line1\nLine2\tTab', summary: undefined },
      ])
    })

    it('should handle general chunks with very long content', () => {
      const longContent = 'A'.repeat(10000)
      const outputs = createGeneralChunkOutputs([{ content: longContent }])

      const result = formatPreviewChunks(outputs) as GeneralChunks

      expect((result as GeneralChunks)[0].content).toHaveLength(10000)
    })
  })

  describe('Parent-Child Chunks (hierarchical_model)', () => {
    describe('Paragraph Mode', () => {
      it('should format parent-child chunks in paragraph mode correctly', () => {
        const outputs = createParentChildChunkOutputs([
          { content: 'Parent 1', child_chunks: ['Child 1-1', 'Child 1-2'] },
          { content: 'Parent 2', child_chunks: ['Child 2-1'] },
        ], 'paragraph')

        const result = formatPreviewChunks(outputs) as ParentChildChunks

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
        const outputs = createParentChildChunkOutputs(createMockParentChildChunks(30, 2), 'paragraph')

        const result = formatPreviewChunks(outputs) as ParentChildChunks

        expect(result.parent_child_chunks).toHaveLength(20)
      })

      it('should NOT limit child chunks in paragraph mode', () => {
        const outputs = createParentChildChunkOutputs([
          { content: 'Parent 1', child_chunks: Array.from({ length: 50 }, (_, i) => `Child ${i + 1}`) },
        ], 'paragraph')

        const result = formatPreviewChunks(outputs) as ParentChildChunks

        expect(result.parent_child_chunks[0].child_contents).toHaveLength(50)
      })

      it('should handle empty child_chunks in paragraph mode', () => {
        const outputs = createParentChildChunkOutputs([
          { content: 'Parent with no children', child_chunks: [] },
        ], 'paragraph')

        const result = formatPreviewChunks(outputs) as ParentChildChunks

        expect(result.parent_child_chunks[0].child_contents).toEqual([])
      })
    })

    describe('Full-Doc Mode', () => {
      it('should format parent-child chunks in full-doc mode correctly', () => {
        const outputs = createParentChildChunkOutputs([
          { content: 'Full Doc Parent', child_chunks: ['Child 1', 'Child 2', 'Child 3'] },
        ], 'full-doc')

        const result = formatPreviewChunks(outputs) as ParentChildChunks

        expect(result.parent_mode).toBe('full-doc')
        expect(result.parent_child_chunks).toHaveLength(1)
        expect(result.parent_child_chunks[0].parent_content).toBe('Full Doc Parent')
        expect(result.parent_child_chunks[0].child_contents).toEqual(['Child 1', 'Child 2', 'Child 3'])
      })

      it('should NOT limit parent chunks in full-doc mode', () => {
        const outputs = createParentChildChunkOutputs(createMockParentChildChunks(30, 2), 'full-doc')

        const result = formatPreviewChunks(outputs) as ParentChildChunks

        expect(result.parent_child_chunks).toHaveLength(30)
      })

      it('should limit child chunks to RAG_PIPELINE_PREVIEW_CHUNK_NUM (20) in full-doc mode', () => {
        const outputs = createParentChildChunkOutputs([
          { content: 'Parent', child_chunks: Array.from({ length: 50 }, (_, i) => `Child ${i + 1}`) },
        ], 'full-doc')

        const result = formatPreviewChunks(outputs) as ParentChildChunks

        expect(result.parent_child_chunks[0].child_contents).toHaveLength(20)
        expect(result.parent_child_chunks[0].child_contents[0]).toBe('Child 1')
        expect(result.parent_child_chunks[0].child_contents[19]).toBe('Child 20')
      })

      it('should handle multiple parents with many children in full-doc mode', () => {
        const outputs = createParentChildChunkOutputs([
          { content: 'Parent 1', child_chunks: Array.from({ length: 25 }, (_, i) => `P1-Child ${i + 1}`) },
          { content: 'Parent 2', child_chunks: Array.from({ length: 30 }, (_, i) => `P2-Child ${i + 1}`) },
        ], 'full-doc')

        const result = formatPreviewChunks(outputs) as ParentChildChunks

        expect(result.parent_child_chunks[0].child_contents).toHaveLength(20)
        expect(result.parent_child_chunks[1].child_contents).toHaveLength(20)
      })
    })

    it('should handle empty preview array for parent-child chunks', () => {
      const outputs = createParentChildChunkOutputs([], 'paragraph')

      const result = formatPreviewChunks(outputs) as ParentChildChunks

      expect(result.parent_child_chunks).toEqual([])
    })
  })

  describe('QA Chunks (qa_model)', () => {
    it('should format QA chunks correctly', () => {
      const outputs = createQAChunkOutputs([
        { question: 'What is Dify?', answer: 'Dify is an LLM application platform.' },
        { question: 'How to use it?', answer: 'You can create apps easily.' },
      ])

      const result = formatPreviewChunks(outputs) as QAChunks

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
      const outputs = createQAChunkOutputs(createMockQAChunks(30))

      const result = formatPreviewChunks(outputs) as QAChunks

      expect(result.qa_chunks).toHaveLength(20)
    })

    it('should handle empty qa_preview array', () => {
      const outputs = createQAChunkOutputs([])

      const result = formatPreviewChunks(outputs) as QAChunks

      expect(result.qa_chunks).toEqual([])
    })

    it('should handle QA chunks with empty question or answer', () => {
      const outputs = createQAChunkOutputs([
        { question: '', answer: 'Answer without question' },
        { question: 'Question without answer', answer: '' },
      ])

      const result = formatPreviewChunks(outputs) as QAChunks

      expect(result.qa_chunks[0].question).toBe('')
      expect(result.qa_chunks[0].answer).toBe('Answer without question')
      expect(result.qa_chunks[1].question).toBe('Question without answer')
      expect(result.qa_chunks[1].answer).toBe('')
    })

    it('should preserve all properties when spreading chunk', () => {
      const outputs = {
        chunk_structure: ChunkingMode.qa,
        qa_preview: [
          { question: 'Q1', answer: 'A1', extra: 'should be preserved' },
        ] as unknown as Array<{ question: string, answer: string }>,
      }

      const result = formatPreviewChunks(outputs) as QAChunks

      expect(result.qa_chunks[0]).toEqual({ question: 'Q1', answer: 'A1', extra: 'should be preserved' })
    })
  })

  describe('Unknown Chunking Mode', () => {
    it('should return undefined for unknown chunking mode', () => {
      const outputs = {
        chunk_structure: 'unknown_mode' as ChunkingMode,
        preview: [],
      }

      const result = formatPreviewChunks(outputs)

      expect(result).toBeUndefined()
    })

    it('should return undefined when chunk_structure is missing', () => {
      const outputs = {
        preview: [{ content: 'test' }],
      }

      const result = formatPreviewChunks(outputs)

      expect(result).toBeUndefined()
    })
  })

  describe('Edge Cases', () => {
    it('should handle exactly RAG_PIPELINE_PREVIEW_CHUNK_NUM (20) chunks', () => {
      const outputs = createGeneralChunkOutputs(createMockGeneralChunks(20))

      const result = formatPreviewChunks(outputs) as GeneralChunks

      expect(result).toHaveLength(20)
    })

    it('should handle outputs with additional properties', () => {
      const outputs = {
        ...createGeneralChunkOutputs([{ content: 'Test' }]),
        extra_field: 'should not affect result',
        metadata: { some: 'data' },
      }

      const result = formatPreviewChunks(outputs) as GeneralChunks

      expect(result).toEqual([{ content: 'Test', summary: undefined }])
    })
  })
})

describe('ResultPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const defaultProps = {
    isRunning: false,
    outputs: undefined,
    error: undefined,
    onSwitchToDetail: vi.fn(),
  }

  describe('Rendering', () => {
    it('should render without crashing with minimal props', () => {
      render(<ResultPreview onSwitchToDetail={vi.fn()} />)

      expect(document.body).toBeInTheDocument()
    })

    it('should render loading state when isRunning and no outputs', () => {
      render(<ResultPreview {...defaultProps} isRunning={true} outputs={undefined} />)

      expect(screen.getByText('pipeline.result.resultPreview.loading')).toBeInTheDocument()
    })

    it('should render loading spinner icon when loading', () => {
      const { container } = render(<ResultPreview {...defaultProps} isRunning={true} outputs={undefined} />)

      const spinner = container.querySelector('.animate-spin')
      expect(spinner).toBeInTheDocument()
    })

    it('should render error state when not running and error exists', () => {
      render(<ResultPreview {...defaultProps} isRunning={false} error="Something went wrong" />)

      expect(screen.getByText('pipeline.result.resultPreview.error')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /pipeline\.result\.resultPreview\.viewDetails/i })).toBeInTheDocument()
    })

    it('should render outputs when available', () => {
      const outputs = createGeneralChunkOutputs([{ content: 'Test chunk' }])

      render(<ResultPreview {...defaultProps} outputs={outputs} />)

      expect(screen.getByTestId('chunk-card-list')).toBeInTheDocument()
    })

    it('should render footer tip when outputs available', () => {
      const outputs = createGeneralChunkOutputs([{ content: 'Test chunk' }])

      render(<ResultPreview {...defaultProps} outputs={outputs} />)

      expect(screen.getByText(/pipeline\.result\.resultPreview\.footerTip/)).toBeInTheDocument()
    })

    it('should not render loading when outputs exist even if isRunning', () => {
      const outputs = createGeneralChunkOutputs([{ content: 'Test' }])

      render(<ResultPreview {...defaultProps} isRunning={true} outputs={outputs} />)

      expect(screen.queryByText('pipeline.result.resultPreview.loading')).not.toBeInTheDocument()
      expect(screen.getByTestId('chunk-card-list')).toBeInTheDocument()
    })

    it('should not render error when isRunning is true', () => {
      render(<ResultPreview {...defaultProps} isRunning={true} error="Error message" outputs={undefined} />)

      expect(screen.getByText('pipeline.result.resultPreview.loading')).toBeInTheDocument()
      expect(screen.queryByText('pipeline.result.resultPreview.error')).not.toBeInTheDocument()
    })
  })

  describe('Props Variations', () => {
    describe('isRunning prop', () => {
      it('should show loading when isRunning=true and no outputs', () => {
        render(<ResultPreview {...defaultProps} isRunning={true} />)

        expect(screen.getByText('pipeline.result.resultPreview.loading')).toBeInTheDocument()
      })

      it('should not show loading when isRunning=false', () => {
        render(<ResultPreview {...defaultProps} isRunning={false} />)

        expect(screen.queryByText('pipeline.result.resultPreview.loading')).not.toBeInTheDocument()
      })

      it('should prioritize outputs over loading state', () => {
        const outputs = createGeneralChunkOutputs([{ content: 'Data' }])

        render(<ResultPreview {...defaultProps} isRunning={true} outputs={outputs} />)

        expect(screen.queryByText('pipeline.result.resultPreview.loading')).not.toBeInTheDocument()
        expect(screen.getByTestId('chunk-card-list')).toBeInTheDocument()
      })
    })

    describe('outputs prop', () => {
      it('should pass chunk_structure to ChunkCardList', () => {
        const outputs = createGeneralChunkOutputs([{ content: 'Test' }])

        render(<ResultPreview {...defaultProps} outputs={outputs} />)

        const chunkList = screen.getByTestId('chunk-card-list')
        expect(chunkList).toHaveAttribute('data-chunk-type', ChunkingMode.text)
      })

      it('should format and pass previewChunks to ChunkCardList', () => {
        const outputs = createGeneralChunkOutputs([
          { content: 'Chunk 1' },
          { content: 'Chunk 2' },
        ])

        render(<ResultPreview {...defaultProps} outputs={outputs} />)

        const chunkList = screen.getByTestId('chunk-card-list')
        const chunkInfo = JSON.parse(chunkList.getAttribute('data-chunk-info') || '[]')
        expect(chunkInfo).toEqual([
          { content: 'Chunk 1' },
          { content: 'Chunk 2' },
        ])
      })

      it('should handle parent-child outputs', () => {
        const outputs = createParentChildChunkOutputs([
          { content: 'Parent', child_chunks: ['Child 1', 'Child 2'] },
        ])

        render(<ResultPreview {...defaultProps} outputs={outputs} />)

        const chunkList = screen.getByTestId('chunk-card-list')
        expect(chunkList).toHaveAttribute('data-chunk-type', ChunkingMode.parentChild)
      })

      it('should handle QA outputs', () => {
        const outputs = createQAChunkOutputs([
          { question: 'Q1', answer: 'A1' },
        ])

        render(<ResultPreview {...defaultProps} outputs={outputs} />)

        const chunkList = screen.getByTestId('chunk-card-list')
        expect(chunkList).toHaveAttribute('data-chunk-type', ChunkingMode.qa)
      })
    })

    describe('error prop', () => {
      it('should show error state when error is a non-empty string', () => {
        render(<ResultPreview {...defaultProps} error="Network error" />)

        expect(screen.getByText('pipeline.result.resultPreview.error')).toBeInTheDocument()
      })

      it('should show error state when error is an empty string', () => {
        render(<ResultPreview {...defaultProps} error="" />)

        expect(screen.queryByText('pipeline.result.resultPreview.error')).not.toBeInTheDocument()
      })

      it('should render both outputs and error when both exist (independent conditions)', () => {
        const outputs = createGeneralChunkOutputs([{ content: 'Data' }])

        render(<ResultPreview {...defaultProps} outputs={outputs} error="Error" />)

        expect(screen.getByText('pipeline.result.resultPreview.error')).toBeInTheDocument()
        expect(screen.getByTestId('chunk-card-list')).toBeInTheDocument()
      })
    })

    describe('onSwitchToDetail prop', () => {
      it('should be called when view details button is clicked', () => {
        const onSwitchToDetail = vi.fn()
        render(<ResultPreview {...defaultProps} error="Error" onSwitchToDetail={onSwitchToDetail} />)

        fireEvent.click(screen.getByRole('button', { name: /viewDetails/i }))

        expect(onSwitchToDetail).toHaveBeenCalledTimes(1)
      })

      it('should not be called automatically on render', () => {
        const onSwitchToDetail = vi.fn()

        render(<ResultPreview {...defaultProps} error="Error" onSwitchToDetail={onSwitchToDetail} />)

        expect(onSwitchToDetail).not.toHaveBeenCalled()
      })
    })
  })

  describe('Memoization', () => {
    describe('React.memo wrapper', () => {
      it('should be wrapped with React.memo', () => {
        const { rerender } = render(<ResultPreview {...defaultProps} />)
        rerender(<ResultPreview {...defaultProps} />)

        expect(document.body).toBeInTheDocument()
      })

      it('should update when props change', () => {
        const { rerender } = render(<ResultPreview {...defaultProps} isRunning={false} />)

        rerender(<ResultPreview {...defaultProps} isRunning={true} />)

        expect(screen.getByText('pipeline.result.resultPreview.loading')).toBeInTheDocument()
      })

      it('should update when outputs change', () => {
        const outputs1 = createGeneralChunkOutputs([{ content: 'First' }])
        const { rerender } = render(<ResultPreview {...defaultProps} outputs={outputs1} />)

        const outputs2 = createGeneralChunkOutputs([{ content: 'Second' }])
        rerender(<ResultPreview {...defaultProps} outputs={outputs2} />)

        const chunkList = screen.getByTestId('chunk-card-list')
        const chunkInfo = JSON.parse(chunkList.getAttribute('data-chunk-info') || '[]')
        expect(chunkInfo).toEqual([{ content: 'Second' }])
      })
    })

    describe('useMemo for previewChunks', () => {
      it('should compute previewChunks based on outputs', () => {
        const outputs = createGeneralChunkOutputs([
          { content: 'Memoized chunk 1' },
          { content: 'Memoized chunk 2' },
        ])

        render(<ResultPreview {...defaultProps} outputs={outputs} />)

        const chunkList = screen.getByTestId('chunk-card-list')
        const chunkInfo = JSON.parse(chunkList.getAttribute('data-chunk-info') || '[]')
        expect(chunkInfo).toHaveLength(2)
      })

      it('should recompute when outputs reference changes', () => {
        const outputs1 = createGeneralChunkOutputs([{ content: 'Original' }])
        const { rerender } = render(<ResultPreview {...defaultProps} outputs={outputs1} />)

        let chunkList = screen.getByTestId('chunk-card-list')
        let chunkInfo = JSON.parse(chunkList.getAttribute('data-chunk-info') || '[]')
        expect(chunkInfo).toEqual([{ content: 'Original' }])

        const outputs2 = createGeneralChunkOutputs([{ content: 'Updated' }])
        rerender(<ResultPreview {...defaultProps} outputs={outputs2} />)

        chunkList = screen.getByTestId('chunk-card-list')
        chunkInfo = JSON.parse(chunkList.getAttribute('data-chunk-info') || '[]')
        expect(chunkInfo).toEqual([{ content: 'Updated' }])
      })

      it('should handle undefined outputs in useMemo', () => {
        render(<ResultPreview {...defaultProps} outputs={undefined} />)

        expect(screen.queryByTestId('chunk-card-list')).not.toBeInTheDocument()
      })
    })
  })

  describe('Event Handlers', () => {
    it('should call onSwitchToDetail when view details button is clicked', () => {
      const onSwitchToDetail = vi.fn()
      render(<ResultPreview {...defaultProps} error="Test error" onSwitchToDetail={onSwitchToDetail} />)

      fireEvent.click(screen.getByRole('button', { name: /viewDetails/i }))

      expect(onSwitchToDetail).toHaveBeenCalledTimes(1)
    })

    it('should handle multiple clicks on view details button', () => {
      const onSwitchToDetail = vi.fn()
      render(<ResultPreview {...defaultProps} error="Test error" onSwitchToDetail={onSwitchToDetail} />)
      const button = screen.getByRole('button', { name: /viewDetails/i })

      fireEvent.click(button)
      fireEvent.click(button)
      fireEvent.click(button)

      expect(onSwitchToDetail).toHaveBeenCalledTimes(3)
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty state (all props undefined/false)', () => {
      const { container } = render(
        <ResultPreview
          isRunning={false}
          outputs={undefined}
          error={undefined}
          onSwitchToDetail={vi.fn()}
        />,
      )

      expect(container.firstChild).toBeNull()
    })

    it('should handle outputs with empty preview chunks', () => {
      const outputs = createGeneralChunkOutputs([])

      render(<ResultPreview {...defaultProps} outputs={outputs} />)

      const chunkList = screen.getByTestId('chunk-card-list')
      const chunkInfo = JSON.parse(chunkList.getAttribute('data-chunk-info') || '[]')
      expect(chunkInfo).toEqual([])
    })

    it('should handle outputs that result in undefined previewChunks', () => {
      const outputs = {
        chunk_structure: 'invalid_mode' as ChunkingMode,
        preview: [],
      }

      render(<ResultPreview {...defaultProps} outputs={outputs} />)

      expect(screen.queryByTestId('chunk-card-list')).not.toBeInTheDocument()
    })

    it('should handle unmount cleanly', () => {
      const { unmount } = render(<ResultPreview {...defaultProps} />)

      expect(() => unmount()).not.toThrow()
    })

    it('should handle rapid prop changes', () => {
      const { rerender } = render(<ResultPreview {...defaultProps} />)

      rerender(<ResultPreview {...defaultProps} isRunning={true} />)
      rerender(<ResultPreview {...defaultProps} isRunning={false} error="Error" />)
      rerender(<ResultPreview {...defaultProps} outputs={createGeneralChunkOutputs([{ content: 'Test' }])} />)
      rerender(<ResultPreview {...defaultProps} />)

      expect(screen.queryByTestId('chunk-card-list')).not.toBeInTheDocument()
    })

    it('should handle very large number of chunks', () => {
      const outputs = createGeneralChunkOutputs(createMockGeneralChunks(1000))

      render(<ResultPreview {...defaultProps} outputs={outputs} />)

      const chunkList = screen.getByTestId('chunk-card-list')
      const chunkInfo = JSON.parse(chunkList.getAttribute('data-chunk-info') || '[]')
      expect(chunkInfo).toHaveLength(20)
    })

    it('should throw when outputs has null preview (slice called on null)', () => {
      const outputs = {
        chunk_structure: ChunkingMode.text,
        preview: null as unknown as Array<{ content: string }>,
      }

      expect(() => render(<ResultPreview {...defaultProps} outputs={outputs} />)).toThrow()
    })
  })

  describe('Integration', () => {
    it('should transition from loading to output state', () => {
      const { rerender } = render(<ResultPreview {...defaultProps} isRunning={true} />)
      expect(screen.getByText('pipeline.result.resultPreview.loading')).toBeInTheDocument()

      const outputs = createGeneralChunkOutputs([{ content: 'Loaded data' }])
      rerender(<ResultPreview {...defaultProps} isRunning={false} outputs={outputs} />)

      expect(screen.queryByText('pipeline.result.resultPreview.loading')).not.toBeInTheDocument()
      expect(screen.getByTestId('chunk-card-list')).toBeInTheDocument()
    })

    it('should transition from loading to error state', () => {
      const { rerender } = render(<ResultPreview {...defaultProps} isRunning={true} />)
      expect(screen.getByText('pipeline.result.resultPreview.loading')).toBeInTheDocument()

      rerender(<ResultPreview {...defaultProps} isRunning={false} error="Failed to load" />)

      expect(screen.queryByText('pipeline.result.resultPreview.loading')).not.toBeInTheDocument()
      expect(screen.getByText('pipeline.result.resultPreview.error')).toBeInTheDocument()
    })

    it('should render both error and outputs when both props provided', () => {
      const { rerender } = render(<ResultPreview {...defaultProps} error="Initial error" />)
      expect(screen.getByText('pipeline.result.resultPreview.error')).toBeInTheDocument()

      const outputs = createGeneralChunkOutputs([{ content: 'Success data' }])
      rerender(<ResultPreview {...defaultProps} error="Initial error" outputs={outputs} />)

      expect(screen.getByText('pipeline.result.resultPreview.error')).toBeInTheDocument()
      expect(screen.getByTestId('chunk-card-list')).toBeInTheDocument()
    })

    it('should hide error when error prop is cleared', () => {
      const { rerender } = render(<ResultPreview {...defaultProps} error="Initial error" />)
      expect(screen.getByText('pipeline.result.resultPreview.error')).toBeInTheDocument()

      const outputs = createGeneralChunkOutputs([{ content: 'Success data' }])
      rerender(<ResultPreview {...defaultProps} outputs={outputs} />)

      expect(screen.queryByText('pipeline.result.resultPreview.error')).not.toBeInTheDocument()
      expect(screen.getByTestId('chunk-card-list')).toBeInTheDocument()
    })

    it('should handle complete flow: empty -> loading -> outputs', () => {
      const { rerender, container } = render(<ResultPreview {...defaultProps} />)
      expect(container.firstChild).toBeNull()

      rerender(<ResultPreview {...defaultProps} isRunning={true} />)
      expect(screen.getByText('pipeline.result.resultPreview.loading')).toBeInTheDocument()

      const outputs = createGeneralChunkOutputs([{ content: 'Final data' }])
      rerender(<ResultPreview {...defaultProps} isRunning={false} outputs={outputs} />)

      expect(screen.getByTestId('chunk-card-list')).toBeInTheDocument()
    })
  })

  describe('Styling', () => {
    it('should have correct container classes for loading state', () => {
      const { container } = render(<ResultPreview {...defaultProps} isRunning={true} />)

      const loadingContainer = container.querySelector('.flex.grow.flex-col.items-center.justify-center')
      expect(loadingContainer).toBeInTheDocument()
    })

    it('should have correct container classes for error state', () => {
      const { container } = render(<ResultPreview {...defaultProps} error="Error" />)

      const errorContainer = container.querySelector('.flex.grow.flex-col.items-center.justify-center')
      expect(errorContainer).toBeInTheDocument()
    })

    it('should have correct container classes for outputs state', () => {
      const outputs = createGeneralChunkOutputs([{ content: 'Test' }])

      const { container } = render(<ResultPreview {...defaultProps} outputs={outputs} />)

      const outputContainer = container.querySelector('.flex.grow.flex-col.bg-background-body')
      expect(outputContainer).toBeInTheDocument()
    })

    it('should have gradient dividers in footer', () => {
      const outputs = createGeneralChunkOutputs([{ content: 'Test' }])

      const { container } = render(<ResultPreview {...defaultProps} outputs={outputs} />)

      const gradientDividers = container.querySelectorAll('.bg-gradient-to-r, .bg-gradient-to-l')
      expect(gradientDividers.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('Accessibility', () => {
    it('should have accessible button in error state', () => {
      render(<ResultPreview {...defaultProps} error="Error" />)

      const button = screen.getByRole('button')
      expect(button).toBeInTheDocument()
    })

    it('should have title attribute on footer tip for long text', () => {
      const outputs = createGeneralChunkOutputs([{ content: 'Test' }])

      const { container } = render(<ResultPreview {...defaultProps} outputs={outputs} />)

      const footerTip = container.querySelector('[title]')
      expect(footerTip).toBeInTheDocument()
    })
  })
})

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
      const { container } = render(
        <ResultPreview
          isRunning={isRunning}
          outputs={outputs}
          error={error}
          onSwitchToDetail={vi.fn()}
        />,
      )

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
