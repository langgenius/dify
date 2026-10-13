import type { HitTesting } from '@/models/datasets'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vite-plus/test'
import { ResultItem } from '../result-item'

function makePayload(
  overrides: Partial<Omit<HitTesting, 'segment' | 'content'>> & {
    segment?: Partial<HitTesting['segment']>
  } = {},
): HitTesting {
  const segment: HitTesting['segment'] = {
    id: 'segment-1',
    position: 1,
    word_count: 100,
    content: 'Original content',
    sign_content: '',
    keywords: [],
    document: {
      id: 'document-1',
      name: 'file.pdf',
      data_source_type: 'upload_file',
      doc_type: 'book',
    },
    answer: '',
    tokens: 20,
    hit_count: 1,
    index_node_hash: 'hash-1',
    ...overrides.segment,
  }
  return {
    score: 0.85,
    tsne_position: { x: 0, y: 0 },
    child_chunks: [],
    files: [],
    ...overrides,
    segment,
    content: segment,
  }
}

async function openDetail(payload: HitTesting) {
  const user = userEvent.setup()
  render(<ResultItem payload={payload} />)
  await user.click(screen.getByRole('button', { name: 'datasetHitTesting.open file.pdf' }))
  return within(screen.getByRole('dialog', { name: 'datasetHitTesting.chunkDetail' }))
}

describe('ChunkDetailDialog content through its result entry', () => {
  it('shows signed content in preference to the original chunk alongside its document and score', async () => {
    const detail = await openDetail(
      makePayload({ segment: { sign_content: '**Signed content**' } }),
    )
    expect(await detail.findByText('Signed content')).toBeInTheDocument()
    expect(detail.queryByText('Original content')).not.toBeInTheDocument()
    expect(detail.getByText('file.pdf')).toBeInTheDocument()
    expect(detail.getByText('0.85')).toBeInTheDocument()
  })

  it('shows the original question and answer rather than the signed Markdown for Q/A chunks', async () => {
    const detail = await openDetail(
      makePayload({
        segment: {
          content: 'Original question',
          sign_content: 'Signed question',
          answer: 'Answer text',
        },
      }),
    )
    expect(detail.getByText('Original question')).toBeInTheDocument()
    expect(detail.getByText('Answer text')).toBeInTheDocument()
    expect(detail.queryByText('Signed question')).not.toBeInTheDocument()
  })

  it('includes keywords, a read-only summary and named attachments for a regular chunk', async () => {
    const detail = await openDetail(
      makePayload({
        segment: { keywords: ['Retrieval', 'Knowledge'] },
        summary: 'Summary text',
        files: [
          {
            id: 'image-1',
            name: 'Diagram.png',
            mime_type: 'image/png',
            source_url: 'https://example.com/diagram.png',
            size: 100,
            extension: 'png',
          },
        ],
      }),
    )
    expect(detail.getByText('Retrieval')).toBeInTheDocument()
    expect(detail.getByText('Knowledge')).toBeInTheDocument()
    expect(detail.getByRole('textbox', { name: 'datasetDocuments.segment.summary' })).toHaveValue(
      'Summary text',
    )
    expect(detail.getByRole('textbox', { name: 'datasetDocuments.segment.summary' })).toBeDisabled()
    expect(detail.getByRole('button', { name: 'Diagram.png' })).toBeInTheDocument()
  })

  it('keeps all retrieved child chunks visible in detail and omits parent keywords', async () => {
    const detail = await openDetail(
      makePayload({
        segment: { keywords: ['Parent keyword'] },
        child_chunks: [
          { id: 'child-1', content: 'First child', position: 1, score: 0.8 },
          { id: 'child-2', content: 'Second child', position: 2, score: 0.7 },
        ],
      }),
    )
    expect(await detail.findByText('Original content')).toBeInTheDocument()
    expect(detail.getByText('First child')).toBeInTheDocument()
    expect(detail.getByText('Second child')).toBeInTheDocument()
    expect(detail.queryByText('Parent keyword')).not.toBeInTheDocument()
  })
})
