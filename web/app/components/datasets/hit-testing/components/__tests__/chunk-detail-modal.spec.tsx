import type { HitTesting } from '@/models/datasets'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ChunkDetailModal from '../chunk-detail-modal'

vi.mock('@/app/components/base/file-uploader/file-type-icon', () => ({
  default: () => <span data-testid="file-icon" />,
}))

vi.mock('@/app/components/base/markdown', () => ({
  Markdown: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div>,
}))

vi.mock('@/app/components/base/modal', () => ({
  default: ({ children, title, onClose }: { children: React.ReactNode, title: string, onClose: () => void }) => (
    <div data-testid="modal">
      <div data-testid="modal-title">{title}</div>
      <button data-testid="modal-close" onClick={onClose}>close</button>
      {children}
    </div>
  ),
}))

vi.mock('../../../common/image-list', () => ({
  default: () => <div data-testid="image-list" />,
}))

vi.mock('../../../documents/detail/completed/common/dot', () => ({
  default: () => <span data-testid="dot" />,
}))

vi.mock('../../../documents/detail/completed/common/segment-index-tag', () => ({
  SegmentIndexTag: ({ positionId }: { positionId: number }) => <span data-testid="segment-index-tag">{positionId}</span>,
}))

vi.mock('../../../documents/detail/completed/common/summary-text', () => ({
  default: ({ value }: { value: string }) => <div data-testid="summary-text">{value}</div>,
}))

vi.mock('@/app/components/datasets/documents/detail/completed/common/tag', () => ({
  default: ({ text }: { text: string }) => <span data-testid="tag">{text}</span>,
}))

vi.mock('../child-chunks-item', () => ({
  default: ({ payload }: { payload: { id: string } }) => <div data-testid="child-chunk">{payload.id}</div>,
}))

vi.mock('../mask', () => ({
  default: () => <div data-testid="mask" />,
}))

vi.mock('../score', () => ({
  default: ({ value }: { value: number }) => <span data-testid="score">{value}</span>,
}))

const makePayload = (overrides: Record<string, unknown> = {}): HitTesting => {
  const segmentOverrides = (overrides.segment ?? {}) as Record<string, unknown>
  const segment = {
    position: 1,
    content: 'chunk content',
    sign_content: '',
    keywords: [],
    document: { name: 'file.pdf' },
    answer: '',
    word_count: 100,
    ...segmentOverrides,
  }
  return {
    segment,
    content: segment,
    score: 0.85,
    tsne_position: { x: 0, y: 0 },
    child_chunks: (overrides.child_chunks ?? []) as HitTesting['child_chunks'],
    files: (overrides.files ?? []) as HitTesting['files'],
    summary: (overrides.summary ?? '') as string,
  } as unknown as HitTesting
}

describe('ChunkDetailModal', () => {
  const onHide = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render modal with title', () => {
    render(<ChunkDetailModal payload={makePayload()} onHide={onHide} />)
    expect(screen.getByTestId('modal-title')).toHaveTextContent('chunkDetail')
  })

  it('should render segment index tag and score', () => {
    render(<ChunkDetailModal payload={makePayload()} onHide={onHide} />)
    expect(screen.getByTestId('segment-index-tag')).toHaveTextContent('1')
    expect(screen.getByTestId('score')).toHaveTextContent('0.85')
  })

  it('should render markdown content', () => {
    render(<ChunkDetailModal payload={makePayload()} onHide={onHide} />)
    expect(screen.getByTestId('markdown')).toHaveTextContent('chunk content')
  })

  it('should render QA content when answer exists', () => {
    const payload = makePayload({
      segment: { answer: 'answer text', content: 'question text' },
    })
    render(<ChunkDetailModal payload={payload} onHide={onHide} />)
    expect(screen.getByText('question text')).toBeInTheDocument()
    expect(screen.getByText('answer text')).toBeInTheDocument()
  })

  it('should render keywords when present and not parent-child', () => {
    const payload = makePayload({
      segment: { keywords: ['k1', 'k2'] },
    })
    render(<ChunkDetailModal payload={payload} onHide={onHide} />)
    expect(screen.getAllByTestId('tag')).toHaveLength(2)
  })

  it('should render child chunks section for parent-child retrieval', () => {
    const payload = makePayload({
      child_chunks: [{ id: 'c1' }, { id: 'c2' }],
    })
    render(<ChunkDetailModal payload={payload} onHide={onHide} />)
    expect(screen.getAllByTestId('child-chunk')).toHaveLength(2)
  })

  it('should render summary text when summary exists', () => {
    const payload = makePayload({ summary: 'test summary' })
    render(<ChunkDetailModal payload={payload} onHide={onHide} />)
    expect(screen.getByTestId('summary-text')).toHaveTextContent('test summary')
  })

  it('should render mask overlay', () => {
    render(<ChunkDetailModal payload={makePayload()} onHide={onHide} />)
    expect(screen.getByTestId('mask')).toBeInTheDocument()
  })
})
