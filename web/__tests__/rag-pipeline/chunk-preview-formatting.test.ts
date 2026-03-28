/**
 * Integration test: Chunk preview formatting pipeline
 *
 * Tests the formatPreviewChunks utility across all chunking modes
 * (text, parentChild, QA) with real data structures.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/config', () => ({
  RAG_PIPELINE_PREVIEW_CHUNK_NUM: 3,
}))

vi.mock('@/models/datasets', () => ({
  ChunkingMode: {
    text: 'text',
    parentChild: 'parent-child',
    qa: 'qa',
  },
}))

const { formatPreviewChunks } = await import(
  '@/app/components/rag-pipeline/components/panel/test-run/result/result-preview/utils',
)

describe('Chunk Preview Formatting', () => {
  describe('general text chunks', () => {
    it('should format text chunks correctly', () => {
      const outputs = {
        chunk_structure: 'text',
        preview: [
          { content: 'Chunk 1 content', summary: 'Summary 1' },
          { content: 'Chunk 2 content' },
        ],
      }

      const result = formatPreviewChunks(outputs)

      expect(Array.isArray(result)).toBe(true)
      const chunks = result as Array<{ content: string, summary?: string }>
      expect(chunks).toHaveLength(2)
      expect(chunks[0].content).toBe('Chunk 1 content')
      expect(chunks[0].summary).toBe('Summary 1')
      expect(chunks[1].content).toBe('Chunk 2 content')
    })

    it('should limit chunks to RAG_PIPELINE_PREVIEW_CHUNK_NUM', () => {
      const outputs = {
        chunk_structure: 'text',
        preview: Array.from({ length: 10 }, (_, i) => ({
          content: `Chunk ${i + 1}`,
        })),
      }

      const result = formatPreviewChunks(outputs)
      const chunks = result as Array<{ content: string }>

      expect(chunks).toHaveLength(3) // Mocked limit
    })
  })

  describe('parent-child chunks — paragraph mode', () => {
    it('should format paragraph parent-child chunks', () => {
      const outputs = {
        chunk_structure: 'parent-child',
        parent_mode: 'paragraph',
        preview: [
          {
            content: 'Parent paragraph',
            child_chunks: ['Child 1', 'Child 2'],
            summary: 'Parent summary',
          },
        ],
      }

      const result = formatPreviewChunks(outputs) as {
        parent_child_chunks: Array<{
          parent_content: string
          parent_summary?: string
          child_contents: string[]
          parent_mode: string
        }>
        parent_mode: string
      }

      expect(result.parent_mode).toBe('paragraph')
      expect(result.parent_child_chunks).toHaveLength(1)
      expect(result.parent_child_chunks[0].parent_content).toBe('Parent paragraph')
      expect(result.parent_child_chunks[0].parent_summary).toBe('Parent summary')
      expect(result.parent_child_chunks[0].child_contents).toEqual(['Child 1', 'Child 2'])
    })

    it('should limit parent chunks in paragraph mode', () => {
      const outputs = {
        chunk_structure: 'parent-child',
        parent_mode: 'paragraph',
        preview: Array.from({ length: 10 }, (_, i) => ({
          content: `Parent ${i + 1}`,
          child_chunks: [`Child of ${i + 1}`],
        })),
      }

      const result = formatPreviewChunks(outputs) as {
        parent_child_chunks: unknown[]
      }

      expect(result.parent_child_chunks).toHaveLength(3) // Mocked limit
    })
  })

  describe('parent-child chunks — full-doc mode', () => {
    it('should format full-doc parent-child chunks', () => {
      const outputs = {
        chunk_structure: 'parent-child',
        parent_mode: 'full-doc',
        preview: [
          {
            content: 'Full document content',
            child_chunks: ['Section 1', 'Section 2', 'Section 3'],
          },
        ],
      }

      const result = formatPreviewChunks(outputs) as {
        parent_child_chunks: Array<{
          parent_content: string
          child_contents: string[]
          parent_mode: string
        }>
      }

      expect(result.parent_child_chunks).toHaveLength(1)
      expect(result.parent_child_chunks[0].parent_content).toBe('Full document content')
      expect(result.parent_child_chunks[0].parent_mode).toBe('full-doc')
    })

    it('should limit child chunks in full-doc mode', () => {
      const outputs = {
        chunk_structure: 'parent-child',
        parent_mode: 'full-doc',
        preview: [
          {
            content: 'Document',
            child_chunks: Array.from({ length: 20 }, (_, i) => `Section ${i + 1}`),
          },
        ],
      }

      const result = formatPreviewChunks(outputs) as {
        parent_child_chunks: Array<{ child_contents: string[] }>
      }

      expect(result.parent_child_chunks[0].child_contents).toHaveLength(3) // Mocked limit
    })
  })

  describe('QA chunks', () => {
    it('should format QA chunks correctly', () => {
      const outputs = {
        chunk_structure: 'qa',
        qa_preview: [
          { question: 'What is AI?', answer: 'Artificial Intelligence is...' },
          { question: 'What is ML?', answer: 'Machine Learning is...' },
        ],
      }

      const result = formatPreviewChunks(outputs) as {
        qa_chunks: Array<{ question: string, answer: string }>
      }

      expect(result.qa_chunks).toHaveLength(2)
      expect(result.qa_chunks[0].question).toBe('What is AI?')
      expect(result.qa_chunks[0].answer).toBe('Artificial Intelligence is...')
    })

    it('should limit QA chunks', () => {
      const outputs = {
        chunk_structure: 'qa',
        qa_preview: Array.from({ length: 10 }, (_, i) => ({
          question: `Q${i + 1}`,
          answer: `A${i + 1}`,
        })),
      }

      const result = formatPreviewChunks(outputs) as {
        qa_chunks: unknown[]
      }

      expect(result.qa_chunks).toHaveLength(3) // Mocked limit
    })
  })

  describe('edge cases', () => {
    it('should return undefined for null outputs', () => {
      expect(formatPreviewChunks(null)).toBeUndefined()
    })

    it('should return undefined for undefined outputs', () => {
      expect(formatPreviewChunks(undefined)).toBeUndefined()
    })

    it('should return undefined for unknown chunk_structure', () => {
      const outputs = {
        chunk_structure: 'unknown-type',
        preview: [],
      }

      expect(formatPreviewChunks(outputs)).toBeUndefined()
    })
  })
})
