import { ChunkingMode } from '@/models/datasets'
import { formatPreviewChunks } from '../utils'

vi.mock('@/config', () => ({
  RAG_PIPELINE_PREVIEW_CHUNK_NUM: 2,
}))

describe('result preview utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return undefined for empty outputs', () => {
    expect(formatPreviewChunks(undefined)).toBeUndefined()
    expect(formatPreviewChunks(null)).toBeUndefined()
  })

  it('should format text chunks and limit them to the preview length', () => {
    const result = formatPreviewChunks({
      chunk_structure: ChunkingMode.text,
      preview: [
        { content: 'Chunk 1', summary: 'S1' },
        { content: 'Chunk 2', summary: 'S2' },
        { content: 'Chunk 3', summary: 'S3' },
      ],
    })

    expect(result).toEqual([
      { content: 'Chunk 1', summary: 'S1' },
      { content: 'Chunk 2', summary: 'S2' },
    ])
  })

  it('should format paragraph and full-doc parent-child previews differently', () => {
    const paragraph = formatPreviewChunks({
      chunk_structure: ChunkingMode.parentChild,
      parent_mode: 'paragraph',
      preview: [
        { content: 'Parent 1', child_chunks: ['c1', 'c2', 'c3'] },
        { content: 'Parent 2', child_chunks: ['c4'] },
        { content: 'Parent 3', child_chunks: ['c5'] },
      ],
    })
    const fullDoc = formatPreviewChunks({
      chunk_structure: ChunkingMode.parentChild,
      parent_mode: 'full-doc',
      preview: [
        { content: 'Parent 1', child_chunks: ['c1', 'c2', 'c3'] },
      ],
    })

    expect(paragraph).toEqual({
      parent_mode: 'paragraph',
      parent_child_chunks: [
        { parent_content: 'Parent 1', parent_summary: undefined, child_contents: ['c1', 'c2', 'c3'], parent_mode: 'paragraph' },
        { parent_content: 'Parent 2', parent_summary: undefined, child_contents: ['c4'], parent_mode: 'paragraph' },
      ],
    })
    expect(fullDoc).toEqual({
      parent_mode: 'full-doc',
      parent_child_chunks: [
        { parent_content: 'Parent 1', child_contents: ['c1', 'c2'], parent_mode: 'full-doc' },
      ],
    })
  })

  it('should format qa previews and limit them to the preview size', () => {
    const result = formatPreviewChunks({
      chunk_structure: ChunkingMode.qa,
      qa_preview: [
        { question: 'Q1', answer: 'A1' },
        { question: 'Q2', answer: 'A2' },
        { question: 'Q3', answer: 'A3' },
      ],
    })

    expect(result).toEqual({
      qa_chunks: [
        { question: 'Q1', answer: 'A1' },
        { question: 'Q2', answer: 'A2' },
      ],
    })
  })
})
