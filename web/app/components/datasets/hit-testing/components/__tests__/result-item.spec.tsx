import type { HitTesting } from '@/models/datasets'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ResultItem from '../result-item'

vi.mock('@/app/components/base/markdown', () => ({
  Markdown: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div>,
}))

vi.mock('../../../common/image-list', () => ({
  default: () => <div data-testid="image-list" />,
}))

vi.mock('../child-chunks-item', () => ({
  default: ({ payload }: { payload: { id: string } }) => <div data-testid="child-chunk">{payload.id}</div>,
}))

vi.mock('../chunk-detail-modal', () => ({
  default: () => <div data-testid="chunk-detail-modal" />,
}))

vi.mock('../result-item-footer', () => ({
  default: ({ docTitle }: { docTitle: string }) => <div data-testid="result-item-footer">{docTitle}</div>,
}))

vi.mock('../result-item-meta', () => ({
  default: ({ positionId }: { positionId: number }) => <div data-testid="result-item-meta">{positionId}</div>,
}))

vi.mock('@/app/components/datasets/documents/detail/completed/common/summary-label', () => ({
  default: ({ summary }: { summary: string }) => <div data-testid="summary-label">{summary}</div>,
}))

vi.mock('@/app/components/datasets/documents/detail/completed/common/tag', () => ({
  default: ({ text }: { text: string }) => <span data-testid="tag">{text}</span>,
}))

vi.mock('@/app/components/datasets/hit-testing/utils/extension-to-file-type', () => ({
  extensionToFileType: () => 'pdf',
}))

const makePayload = (overrides: Record<string, unknown> = {}): HitTesting => {
  const segmentOverrides = (overrides.segment ?? {}) as Record<string, unknown>
  const segment = {
    position: 1,
    word_count: 100,
    content: 'test content',
    sign_content: '',
    keywords: [],
    document: { name: 'file.pdf' },
    answer: '',
    ...segmentOverrides,
  }
  return {
    segment,
    content: segment,
    score: 0.95,
    tsne_position: { x: 0, y: 0 },
    child_chunks: (overrides.child_chunks ?? []) as HitTesting['child_chunks'],
    files: (overrides.files ?? []) as HitTesting['files'],
    summary: (overrides.summary ?? '') as string,
  } as unknown as HitTesting
}

describe('ResultItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render meta, content, and footer', () => {
    render(<ResultItem payload={makePayload()} />)
    expect(screen.getByTestId('result-item-meta')).toHaveTextContent('1')
    expect(screen.getByTestId('markdown')).toHaveTextContent('test content')
    expect(screen.getByTestId('result-item-footer')).toHaveTextContent('file.pdf')
  })

  it('should render keywords when no child_chunks', () => {
    const payload = makePayload({
      segment: { keywords: ['key1', 'key2'] },
    })
    render(<ResultItem payload={payload} />)
    expect(screen.getAllByTestId('tag')).toHaveLength(2)
  })

  it('should render child chunks when present', () => {
    const payload = makePayload({
      child_chunks: [{ id: 'c1' }, { id: 'c2' }],
    })
    render(<ResultItem payload={payload} />)
    expect(screen.getAllByTestId('child-chunk')).toHaveLength(2)
  })

  it('should render summary label when summary exists', () => {
    const payload = makePayload({ summary: 'test summary' })
    render(<ResultItem payload={payload} />)
    expect(screen.getByTestId('summary-label')).toHaveTextContent('test summary')
  })

  it('should show chunk detail modal on click', () => {
    render(<ResultItem payload={makePayload()} />)
    fireEvent.click(screen.getByTestId('markdown'))
    expect(screen.getByTestId('chunk-detail-modal')).toBeInTheDocument()
  })

  it('should render images when files exist', () => {
    const payload = makePayload({
      files: [{ name: 'img.png', mime_type: 'image/png', source_url: 'url', size: 100, extension: 'png' }],
    })
    render(<ResultItem payload={payload} />)
    expect(screen.getByTestId('image-list')).toBeInTheDocument()
  })

  it('should not render keywords when child_chunks are present', () => {
    const payload = makePayload({
      segment: { keywords: ['k1'] },
      child_chunks: [{ id: 'c1' }],
    })
    render(<ResultItem payload={payload} />)
    expect(screen.queryByTestId('tag')).not.toBeInTheDocument()
  })

  it('should not render keywords section when keywords array is empty', () => {
    const payload = makePayload({
      segment: { keywords: [] },
    })
    render(<ResultItem payload={payload} />)
    expect(screen.queryByTestId('tag')).not.toBeInTheDocument()
  })

  it('should toggle child chunks fold state', async () => {
    const payload = makePayload({
      child_chunks: [{ id: 'c1' }],
    })
    render(<ResultItem payload={payload} />)
    expect(screen.getByTestId('child-chunk')).toBeInTheDocument()

    const header = screen.getByText(/hitChunks/i)
    fireEvent.click(header.closest('div')!)

    await waitFor(() => {
      expect(screen.queryByTestId('child-chunk')).not.toBeInTheDocument()
    })
  })
})
